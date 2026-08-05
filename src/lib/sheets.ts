// Types
export interface Contact {
  rowIndex: number;
  firstName: string;
  lastName: string;
  fullName: string;
  url: string;
  company: string;
  position: string;
  list: string;
  function: string;
  connectedOn: string;
  message: string;
  reply: string;
  followUps: string;
  followUpMessage1: string;
  followUpMessage2: string;
  lastContacted: string;
  comment: string;
  email: string;
  phone: string;
  callBooked: string;
  priority: string;
  region: string;
}

export interface Message {
  messageType: string;
  target: string;
  abbreviation: string;
  fullMessage: string;
}

export interface SuggestedMessage {
  abbreviation: string;
  fullMessage: string;
  replyRate: number | null;
  sentCount: number;
  repliedCount: number;
}

// Connections columns are resolved by HEADER TEXT, not fixed position — the
// sheet can be reordered (columns inserted/moved) without touching any code.
// Only the header row's wording matters; keep these strings in sync with it.
const CONNECTIONS_FIELD_HEADERS: Record<string, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  url: 'URL',
  company: 'Company',
  position: 'Position',
  list: 'List',
  function: 'Function',
  connectedOn: 'Connected On',
  message: 'Message',
  reply: 'Reply?',
  followUps: 'Follow ups',
  followUpMessage1: 'Follow Up Message 1',
  followUpMessage2: 'Follow Up Message 2',
  lastContacted: 'Last Contacted',
  comment: 'Comment',
  email: 'Email',
  phone: 'Phone',
  callBooked: 'Call booked',
  priority: 'Priority',
  region: 'Region',
};

// 0-based column index -> spreadsheet letter (A, B, ..., Z, AA, AB, ...)
export function colLetter(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface ConnectionsColumnMap {
  index: Record<string, number>; // field key -> 0-based column index
  letter: Record<string, string>; // field key -> column letter, for writes
}

// Generic header-text column resolver, shared by any tab that wants
// reorder-safe column access — match a field key to whatever column
// currently has the matching header text, instead of a fixed position.
function buildColumnMap(headerRow: string[], fieldHeaders: Record<string, string>): ConnectionsColumnMap {
  const index: Record<string, number> = {};
  const letter: Record<string, string> = {};
  const normalized = (headerRow || []).map(h => (h || '').trim().toLowerCase());
  for (const [key, headerText] of Object.entries(fieldHeaders)) {
    const target = headerText.toLowerCase();
    const idx = normalized.findIndex(h => h === target);
    if (idx !== -1) {
      index[key] = idx;
      letter[key] = colLetter(idx);
    }
  }
  return { index, letter };
}

export function buildConnectionsColumnMap(headerRow: string[]): ConnectionsColumnMap {
  return buildColumnMap(headerRow, CONNECTIONS_FIELD_HEADERS);
}

export function parseConnections(rows: string[][]): Contact[] {
  const { index: col } = buildConnectionsColumnMap(rows[0] || []);
  const get = (row: string[], key: string) => (row[col[key]] ?? '').trim();

  // Skip header row (index 0)
  return rows.slice(1).map((row, i) => ({
    rowIndex: i + 2, // 1-based, +1 for header
    firstName: get(row, 'firstName'),
    lastName: get(row, 'lastName'),
    fullName: `${get(row, 'firstName')} ${get(row, 'lastName')}`.trim(),
    url: get(row, 'url'),
    company: get(row, 'company'),
    position: get(row, 'position'),
    list: get(row, 'list'),
    function: get(row, 'function'),
    connectedOn: get(row, 'connectedOn'),
    message: get(row, 'message'),
    reply: get(row, 'reply'),
    followUps: get(row, 'followUps'),
    followUpMessage1: get(row, 'followUpMessage1'),
    followUpMessage2: get(row, 'followUpMessage2'),
    lastContacted: get(row, 'lastContacted'),
    comment: get(row, 'comment'),
    email: cleanContactField(row[col.email]),
    phone: cleanContactField(row[col.phone]),
    callBooked: get(row, 'callBooked'),
    priority: get(row, 'priority'),
    region: get(row, 'region'),
  }));
}

// "Not Found" / "None" placeholders from manual research sheets shouldn't be treated as real values
function cleanContactField(v: string | undefined): string {
  const s = (v || '').trim();
  return /^(not found|none|n\/a)$/i.test(s) ? '' : s;
}

// Activity tab: A Date | B Row | C Name | D Company | E Action | F Template | G Detail
export interface ActivityEvent {
  date: string;
  rowIndex: number;
  action: string; // 'new' | 'followup1' | 'followup2' | 'followup3' | 'reply' | 'snooze'
  template: string;
  detail: string;
}

export function parseActivity(rows: string[][]): ActivityEvent[] {
  return rows
    .slice(1)
    .map(row => ({
      date: (row[0] || '').trim(),
      rowIndex: parseInt(row[1]) || 0,
      action: (row[4] || '').trim().toLowerCase(),
      template: (row[5] || '').trim(),
      detail: (row[6] || '').trim(),
    }))
    .filter(e => e.date && e.action);
}

// Campaigns tab — like Connections, columns are resolved by HEADER TEXT, not
// fixed position (see buildCampaignsColumnMap below). The sheet has grown a
// firmographic/ICP section (Industry, Company Size, Funding Stage, ICP Fit)
// alongside the original cake-campaign columns; a field simply reads as ''
// if its header isn't found, rather than silently reading the wrong column.
//
// Not every row is a real campaign — the firmographic/ICP fields let signal
// from ordinary (no-cake) outreach live alongside real cake campaigns, so
// patterns can be found across both. Status/Cake sent stay meaningful only
// for actual campaigns; blank Status is normal and expected for ICP-only rows.
//
// Focus is independent of Status: it's "do I want this company in my Focus
// shortlist right now", set explicitly (or via a one-tap suggestion), not
// implied by cake-campaign stage.
const CAMPAIGNS_FIELD_HEADERS: Record<string, string> = {
  company: 'Company',
  status: 'Status',
  cakeSentDate: 'Cake sent',
  notes: 'Notes',
  industry: 'Industry',
  companySize: 'Company Size',
  fundingStage: 'Funding Stage',
  region: 'Region',
  icpFit: 'ICP Fit',
  focus: 'Focus',
};

export function buildCampaignsColumnMap(headerRow: string[]): ConnectionsColumnMap {
  return buildColumnMap(headerRow, CAMPAIGNS_FIELD_HEADERS);
}

export interface CampaignEntry {
  company: string;
  status: string;
  cakeSentDate: string;
  notes: string;
  industry: string;
  companySize: string;
  fundingStage: string;
  region: string;
  icpFit: string;
  focus: boolean;
}

export function parseCampaigns(rows: string[][]): CampaignEntry[] {
  const { index: col } = buildCampaignsColumnMap(rows[0] || []);
  const get = (row: string[], key: string) => (row[col[key]] ?? '').trim();

  return rows
    .slice(1)
    .map(row => ({
      company: get(row, 'company'),
      status: get(row, 'status'),
      cakeSentDate: get(row, 'cakeSentDate'),
      notes: get(row, 'notes'),
      industry: get(row, 'industry'),
      companySize: get(row, 'companySize'),
      fundingStage: get(row, 'fundingStage'),
      region: get(row, 'region'),
      icpFit: get(row, 'icpFit'),
      focus: get(row, 'focus').toUpperCase() === 'TRUE',
    }))
    .filter(c => c.company);
}

export function parseMessages(rows: string[][]): Message[] {
  return rows.slice(1).map(row => ({
    messageType: (row[0] || '').trim(),
    target: (row[1] || '').trim(),
    abbreviation: (row[2] || '').trim(),
    fullMessage: (row[3] || '').trim(),
  }));
}

// Experiments tab — header-driven like Campaigns/Connections: Test ID | Name |
// Stage | Variant A | Variant B | Status | Started | Ended | Winner | Notes.
// One Active test per stage at a time (enforced by the Tests screen, not the
// sheet itself) - but Initial Message / Follow-up 1 / Follow-up 2 each run
// independently, so up to three tests can be active simultaneously.
const EXPERIMENTS_FIELD_HEADERS: Record<string, string> = {
  testId: 'Test ID',
  name: 'Name',
  stage: 'Stage',
  variantA: 'Variant A',
  variantB: 'Variant B',
  status: 'Status',
  started: 'Started',
  ended: 'Ended',
  winner: 'Winner',
  notes: 'Notes',
};

export function buildExperimentsColumnMap(headerRow: string[]): ConnectionsColumnMap {
  return buildColumnMap(headerRow, EXPERIMENTS_FIELD_HEADERS);
}

// Matches the app's existing new/followup1/followup2 action-type vocabulary
// (see getFocusQueue, handleAction) rather than inventing new stage names.
export type ExperimentStage = 'new' | 'followup1' | 'followup2';

export const EXPERIMENT_STAGE_LABELS: Record<ExperimentStage, string> = {
  new: 'Initial Message',
  followup1: 'Follow-up 1',
  followup2: 'Follow-up 2',
};

function normalizeStage(raw: string): ExperimentStage {
  const s = raw.trim().toLowerCase();
  if (s === 'followup1' || s === 'follow-up 1' || s === 'fu1') return 'followup1';
  if (s === 'followup2' || s === 'follow-up 2' || s === 'fu2') return 'followup2';
  return 'new';
}

export interface Experiment {
  testId: string;
  name: string;
  stage: ExperimentStage;
  variantA: string; // template abbreviation
  variantB: string; // template abbreviation
  status: string; // 'Active' | 'Completed' | ...
  started: string; // DD/MM/YYYY
  ended: string;
  winner: string; // '' | 'A' | 'B' | 'No clear winner'
  notes: string;
}

export function parseExperiments(rows: string[][]): Experiment[] {
  const { index: col } = buildExperimentsColumnMap(rows[0] || []);
  const get = (row: string[], key: string) => (row[col[key]] ?? '').trim();

  return rows
    .slice(1)
    .map(row => ({
      testId: get(row, 'testId'),
      name: get(row, 'name'),
      stage: normalizeStage(get(row, 'stage')),
      variantA: get(row, 'variantA'),
      variantB: get(row, 'variantB'),
      status: get(row, 'status'),
      started: get(row, 'started'),
      ended: get(row, 'ended'),
      winner: get(row, 'winner'),
      notes: get(row, 'notes'),
    }))
    .filter(e => e.testId);
}

export function isExperimentActive(e: Experiment): boolean {
  return e.status.trim().toLowerCase() === 'active';
}

export function getActiveExperiment(experiments: Experiment[], stage: ExperimentStage): Experiment | null {
  return experiments.find(e => e.stage === stage && isExperimentActive(e)) ?? null;
}

// Deterministic hash of (rowIndex, testId) so the same contact always lands
// on the same variant for a given test - nothing needs to be written or
// tracked per-contact. Deliberately not rowIndex % 2: sheet position
// correlates with import batch/company/region and would confound results.
export function assignVariant(rowIndex: number, testId: string): 'A' | 'B' {
  const str = `${rowIndex}:${testId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return (hash & 1) === 0 ? 'A' : 'B';
}

export function assignedTemplate(e: Experiment, rowIndex: number): string {
  return assignVariant(rowIndex, e.testId) === 'A' ? e.variantA : e.variantB;
}

export interface ExperimentVariantStats {
  variant: 'A' | 'B';
  template: string;
  sent: number;
  eligible: number; // subset old enough (or already replied) to fairly count toward the rate
  replied: number;
  rate: number | null; // null until eligible sample clears MIN_SAMPLE_PER_VARIANT - "too early to call"
}

export interface ExperimentResults {
  testId: string;
  a: ExperimentVariantStats;
  b: ExperimentVariantStats;
}

const MIN_SAMPLE_PER_VARIANT = 20;

// Driven off the Activity log (timestamped, per-send) rather than current
// sheet state, filtered to the test's date window - so pre-existing use of
// the same templates before the test started never gets miscounted in.
export function computeExperimentResults(
  experiment: Experiment,
  activity: ActivityEvent[],
  contacts: Contact[]
): ExperimentResults {
  const contactByRow = new Map(contacts.map(c => [c.rowIndex, c]));
  const startDate = parseDate(experiment.started);
  const endDate = experiment.ended ? parseDate(experiment.ended) : null;

  function statsFor(variant: 'A' | 'B', template: string): ExperimentVariantStats {
    // Dedup by rowIndex - a contact only counts once per variant even if
    // touched at this stage more than once during the test window
    const rowIndexes = new Set<number>();
    activity.forEach(a => {
      if (a.action !== experiment.stage) return;
      if (!template || normAbbr(a.template) !== normAbbr(template)) return;
      const d = parseDate(a.date);
      if (!d) return;
      if (startDate && d.getTime() < startDate.getTime()) return;
      if (endDate && d.getTime() > endDate.getTime()) return;
      rowIndexes.add(a.rowIndex);
    });

    let eligible = 0;
    let replied = 0;
    rowIndexes.forEach(rowIndex => {
      const c = contactByRow.get(rowIndex);
      if (!c || !countsForReplyRate(c)) return;
      eligible++;
      if (POSITIVE_REPLIES.includes(c.reply.toLowerCase())) replied++;
    });

    const sent = rowIndexes.size;
    const rate = eligible >= MIN_SAMPLE_PER_VARIANT ? Math.round((replied / eligible) * 100) : null;
    return { variant, template, sent, eligible, replied, rate };
  }

  return {
    testId: experiment.testId,
    a: statsFor('A', experiment.variantA),
    b: statsFor('B', experiment.variantB),
  };
}

// 'referred' means the contact pointed us elsewhere, not that they're
// personally interested — excluded from positive-reply stats and follow-ups
export const POSITIVE_REPLIES = ['interested', 'yes'];

// Contacts messaged recently who haven't replied yet shouldn't drag down
// reply rates — they haven't had a fair chance to respond
const REPLY_WINDOW_DAYS = 7;

export function countsForReplyRate(c: Contact): boolean {
  if (c.reply) return true;
  const days = daysAgo(c.lastContacted);
  return days !== null && days >= REPLY_WINDOW_DAYS;
}

// Template abbreviations in Connections have case/punctuation variants
// ("One-off" / "one-off" / "One off") — compare normalized
export function normAbbr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// "One-off" is a placeholder for custom messages, not a real template —
// it stays in stats for comparison but is never suggested
function isOneOff(abbr: string): boolean {
  return normAbbr(abbr) === 'oneoff';
}

// Replies that still warrant a follow-up, in priority order
const FOLLOW_UP_WORTHY = ['interested', 'yes', ''];
const REPLY_PRIORITY: Record<string, number> = { interested: 0, yes: 1, '': 2 };

export function isDead(contact: Contact): boolean {
  return !FOLLOW_UP_WORTHY.includes(contact.reply.toLowerCase());
}

export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();

  // DD/MM/YYYY or D/M/YYYY (sheet format) — must come before JS Date() which assumes MM/DD
  const slashParts = cleaned.split('/');
  if (slashParts.length === 3) {
    const day = parseInt(slashParts[0]);
    const month = parseInt(slashParts[1]) - 1;
    const year = parseInt(slashParts[2]);
    const fullYear = year < 100 ? 2000 + year : year;
    const attempt = new Date(fullYear, month, day);
    if (!isNaN(attempt.getTime())) return attempt;
  }

  // YYYY-MM-DD (ISO format)
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;

  return null;
}

export function daysAgo(dateStr: string): number | null {
  const d = parseDate(dateStr);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function businessDaysAgo(dateStr: string): number | null {
  const days = daysAgo(dateStr);
  if (days === null) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let count = 0;
  const cursor = new Date(today);
  for (let i = 0; i < days; i++) {
    cursor.setDate(cursor.getDate() - 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function isFollowUpDue(c: Contact, intervalDays: number): boolean {
  if (!c.message) return false;
  if (!FOLLOW_UP_WORTHY.includes(c.reply.toLowerCase())) return false;
  const days = daysAgo(c.lastContacted);
  if (days === null) return false;
  return days >= intervalDays;
}

// focusedCompanyKeys (normalizeCompany'd) are excluded here — those contacts
// surface in the Focus tab instead, badged "follow-up due", so they're never
// shown in both places at once.
export function getFollowUpQueue(
  contacts: Contact[],
  intervalDays: number,
  focusedCompanyKeys: Set<string> = new Set()
): Contact[] {
  return contacts
    .filter(c => isFollowUpDue(c, intervalDays) && !focusedCompanyKeys.has(normalizeCompany(c.company)))
    .sort((a, b) => {
      // Sort by reply priority first (Interested → Yes → Blank → Referred)
      const aPri = REPLY_PRIORITY[a.reply.toLowerCase()] ?? 2;
      const bPri = REPLY_PRIORITY[b.reply.toLowerCase()] ?? 2;
      if (aPri !== bPri) return aPri - bPri;
      // Within priority: no follow-up sent yet floats to top
      const aHasFollowUp = !!a.followUpMessage1;
      const bHasFollowUp = !!b.followUpMessage1;
      if (aHasFollowUp !== bHasFollowUp) return aHasFollowUp ? 1 : -1;
      // Then oldest last contacted first
      const da = parseDate(a.lastContacted);
      const db = parseDate(b.lastContacted);
      if (!da || !db) return 0;
      return da.getTime() - db.getTime();
    });
}

export function getNewContactsQueue(contacts: Contact[]): Contact[] {
  return contacts.filter(c => !c.message && !c.lastContacted && !isDead(c));
}

// Region-based time-of-day prioritization: UK waking hours favor UK contacts,
// US waking hours favor US contacts. Blank region is never deprioritized
// (still tagging in progress) - it sorts between the two, never last.
const REGION_ALIASES: Record<string, 'uk' | 'us'> = {
  'united kingdom': 'uk',
  uk: 'uk',
  gb: 'uk',
  'great britain': 'uk',
  'united states': 'us',
  us: 'us',
  usa: 'us',
};

export function normalizeRegion(region: string): 'uk' | 'us' | '' {
  return REGION_ALIASES[region.trim().toLowerCase()] ?? '';
}

// 06:00-21:59 favors UK contacts, 22:00-05:59 favors US contacts
export function getRegionMode(now: Date = new Date()): 'uk' | 'us' {
  const h = now.getHours();
  return h >= 6 && h < 22 ? 'uk' : 'us';
}

export function regionSortRank(region: string, mode: 'uk' | 'us'): number {
  const r = normalizeRegion(region);
  if (!r) return 1;
  return r === mode ? 0 : 2;
}

// Same normalization used for cake-image filename matching — reused here so
// Campaigns tab company names match Connections company names consistently
export function normalizeCompany(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Campaign lifecycle — mirrors the Appetite platform's stages.
// "Closed-lost" (legacy hyphenated form) still matches the closed keywords.
export const CAMPAIGN_STAGES = ['Planned', 'Delivered', 'Reply', 'Meeting', 'Pipeline', 'Closed Won', 'Closed Lost'] as const;

const CLOSED_CAMPAIGN_KEYWORDS = ['closed', 'won', 'lost', 'dead'];
const ACTIVE_CAMPAIGN_KEYWORDS = ['delivered', 'reply', 'meeting', 'pipeline', 'cake sent'];

export function isCampaignClosed(status: string): boolean {
  const s = status.toLowerCase();
  return CLOSED_CAMPAIGN_KEYWORDS.some(k => s.includes(k));
}

export function isCampaignPlanned(status: string): boolean {
  return status.toLowerCase().includes('planned');
}

// Active = the cake is out in the world and the account is being worked.
// Deliberately an ALLOWLIST, not "anything that isn't closed/planned" - the
// Campaigns tab also holds no-cake ICP-signal rows (see CampaignEntry) whose
// Status is blank. Those must default to inactive, or they'd silently get
// pulled into Today's Tier 1 cake-chase cadence.
export function isCampaignActive(status: string): boolean {
  const s = status.toLowerCase();
  return ACTIVE_CAMPAIGN_KEYWORDS.some(k => s.includes(k));
}

// Materializes "why is this contact being tracked closely" into a plain-text
// label written back to Connections col S (Priority) — so it's visible when
// browsing the raw sheet, not just inside the Today tab. This mirrors
// getFocusQueue's tier assignment but deliberately skips the cadence/due-date
// gating: Priority reflects the stable reason (cake company / positive
// reply), not "due today", so it doesn't need rewriting every day.
export function computePriorityLabel(contact: Contact, isActiveCakeCompany: boolean): string {
  if (isDead(contact)) return '';
  if (isActiveCakeCompany) return '\u{1F382} Cake';
  if (POSITIVE_REPLIES.includes(contact.reply.toLowerCase())) return '\u{1F525} Interested';
  return '';
}

// No "Next Follow-up Date" column exists, so snoozing a Today-view contact
// is recorded as an Activity log entry instead — the most recent 'snooze'
// action per contact holds the date they should reappear
export function getActiveSnoozes(activity: ActivityEvent[]): Record<number, Date> {
  const result: Record<number, Date> = {};
  activity.forEach(a => {
    if (a.action !== 'snooze') return;
    const until = parseDate(a.detail);
    if (until) result[a.rowIndex] = until;
  });
  return result;
}

// Tier 3 ("chasing silence" — regular overdue follow-ups) was dropped from
// this queue: it's high-volume and already lives in the Follow-ups tab.
// Today is deliberately small — only the two tiers worth daily attention.
export type Tier = 1 | 2;

export interface TierContact extends Contact {
  tier: Tier;
  overdueDays: number | null;
  followUpDue: boolean; // also independently due in Follow-ups — badged, not duplicated there
}

export interface CompanyGroup {
  company: string;
  tier: Tier;
  stage: string | null; // campaign stage for Tier 1 companies, null for pure Tier 2 groups
  contacts: TierContact[];
  maxOverdueDays: number | null;
}

// Focus queue, cadence-based, scoped to companies the user has explicitly
// shortlisted (Campaigns!Focus = TRUE) — this is the "manual shortlist"
// half of the Focus tab; getFocusSuggestions surfaces auto-suggest candidates
// for one-tap adding to the shortlist.
// - Tier 1: shortlisted companies with an active cake campaign (Delivered/
//   Reply/Meeting/Pipeline). Due when never touched, or >= cakeTouchDays
//   WORKING days since last touch.
// - Tier 2: shortlisted companies' Interested/Yes replies, due >= hotTouchDays
//   calendar days after last touch.
// - A booked call (col R) graduates a contact out of both tiers.
export function getFocusQueue(
  contacts: Contact[],
  campaigns: CampaignEntry[],
  cakeTouchDays: number,
  hotTouchDays: number,
  intervalDays: number,
  snoozes: Record<number, Date> = {}
): CompanyGroup[] {
  const stageByCompany = new Map<string, string>();
  const focusedKeys = new Set<string>();
  campaigns.forEach(c => {
    const key = normalizeCompany(c.company);
    if (isCampaignActive(c.status)) stageByCompany.set(key, c.status);
    if (c.focus) focusedKeys.add(key);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groups = new Map<string, CompanyGroup>();

  contacts.forEach(c => {
    if (isDead(c)) return;
    if (!c.company) return;
    if (c.callBooked) return;
    const key = normalizeCompany(c.company);
    if (!focusedKeys.has(key)) return;
    const snoozedUntil = snoozes[c.rowIndex];
    if (snoozedUntil && snoozedUntil.getTime() >= today.getTime()) return;

    const campaignStage = stageByCompany.get(key) ?? null;
    const isPositive = POSITIVE_REPLIES.includes(c.reply.toLowerCase());

    let tier: Tier | null = null;
    let overdueDays: number | null = null;

    if (campaignStage) {
      const bdays = businessDaysAgo(c.lastContacted);
      if (bdays === null || bdays >= cakeTouchDays) {
        tier = 1;
        overdueDays = bdays !== null ? bdays - cakeTouchDays : null;
      }
    } else if (isPositive) {
      const days = daysAgo(c.lastContacted);
      if (days === null || days >= hotTouchDays) {
        tier = 2;
        overdueDays = days !== null ? days - hotTouchDays : null;
      }
    }

    if (tier === null) return;

    if (!groups.has(key)) {
      groups.set(key, { company: c.company, tier, stage: campaignStage, contacts: [], maxOverdueDays: null });
    }
    const group = groups.get(key)!;
    if (tier < group.tier) group.tier = tier;
    group.contacts.push({ ...c, tier, overdueDays, followUpDue: isFollowUpDue(c, intervalDays) });
  });

  const result = Array.from(groups.values());
  result.forEach(g => {
    g.contacts.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // Within a company: engaged contacts (positive reply) come first
      const aPos = POSITIVE_REPLIES.includes(a.reply.toLowerCase()) ? 0 : 1;
      const bPos = POSITIVE_REPLIES.includes(b.reply.toLowerCase()) ? 0 : 1;
      if (aPos !== bPos) return aPos - bPos;
      return (b.overdueDays ?? -Infinity) - (a.overdueDays ?? -Infinity);
    });
    g.maxOverdueDays = g.contacts.reduce<number | null>(
      (max, c) => (c.overdueDays !== null && (max === null || c.overdueDays > max) ? c.overdueDays : max),
      null
    );
  });
  result.sort((a, b) => a.tier - b.tier || (b.maxOverdueDays ?? -Infinity) - (a.maxOverdueDays ?? -Infinity));

  return result;
}

// Auto-suggest candidates for the Focus shortlist: companies with an active
// cake campaign, or any contact with an Interested/Yes reply, not already
// shortlisted. One-tap-add surface, not automatic membership.
export function getFocusSuggestions(contacts: Contact[], campaigns: CampaignEntry[]): string[] {
  const focusedKeys = new Set(campaigns.filter(c => c.focus).map(c => normalizeCompany(c.company)));
  const candidates = new Map<string, string>(); // key -> display name

  campaigns.forEach(c => {
    const key = normalizeCompany(c.company);
    if (isCampaignActive(c.status) && !focusedKeys.has(key)) candidates.set(key, c.company);
  });
  contacts.forEach(c => {
    if (!c.company) return;
    const key = normalizeCompany(c.company);
    if (focusedKeys.has(key)) return;
    if (POSITIVE_REPLIES.includes(c.reply.toLowerCase())) candidates.set(key, c.company);
  });

  return Array.from(candidates.values()).sort((a, b) => a.localeCompare(b));
}

export function suggestMessage(
  contact: Contact,
  allContacts: Contact[],
  messages: Message[],
  isFollowUp: boolean
): SuggestedMessage | null {
  // Never suggest a template this contact has already received
  const alreadySent = new Set(
    [contact.message, contact.followUpMessage1, contact.followUpMessage2].filter(Boolean).map(normAbbr)
  );
  const wantedType = isFollowUp ? 'Follow Up' : 'Initial Outreach';
  const candidates = messages.filter(
    m => m.messageType === wantedType && !alreadySent.has(normAbbr(m.abbreviation)) && !isOneOff(m.abbreviation)
  );
  if (candidates.length === 0) return null;

  const roleKeyword = contact.position.toLowerCase().split(' ')[0];
  const func = contact.function.toLowerCase();

  const similarStats: Record<string, { sent: number; replied: number }> = {};
  const overallStats: Record<string, { sent: number; replied: number }> = {};
  const bump = (stats: Record<string, { sent: number; replied: number }>, abbr: string, replied: boolean) => {
    if (!stats[abbr]) stats[abbr] = { sent: 0, replied: 0 };
    stats[abbr].sent++;
    if (replied) stats[abbr].replied++;
  };

  allContacts.forEach(c => {
    if (!countsForReplyRate(c)) return;
    const abbrs = isFollowUp
      ? [c.followUpMessage1, c.followUpMessage2].filter(Boolean)
      : c.message ? [c.message] : [];
    if (abbrs.length === 0) return;

    const isPositive = POSITIVE_REPLIES.includes(c.reply.toLowerCase());
    const cRole = c.position.toLowerCase();
    const cFunc = c.function.toLowerCase();
    const isSimilar =
      (roleKeyword && cRole.includes(roleKeyword)) ||
      (func && cFunc === func);

    abbrs.forEach(abbr => {
      bump(overallStats, normAbbr(abbr), isPositive);
      if (isSimilar) bump(similarStats, normAbbr(abbr), isPositive);
    });
  });

  const pickBest = (stats: Record<string, { sent: number; replied: number }>): string | null => {
    let best: string | null = null;
    let bestRate = -1;
    candidates.forEach(m => {
      const s = stats[normAbbr(m.abbreviation)];
      if (!s || s.sent < 2) return; // need at least 2 data points
      const rate = s.replied / s.sent;
      if (rate > bestRate) {
        bestRate = rate;
        best = m.abbreviation;
      }
    });
    return best;
  };

  // Best for similar roles → best overall → first unused template of the right type
  const chosenAbbr = pickBest(similarStats) || pickBest(overallStats) || candidates[0].abbreviation;
  const messageRecord = candidates.find(m => m.abbreviation === chosenAbbr)!;

  const s = similarStats[normAbbr(chosenAbbr)] ?? overallStats[normAbbr(chosenAbbr)];
  const replyRate = s && s.sent >= 2 ? Math.round((s.replied / s.sent) * 100) : null;

  return {
    abbreviation: chosenAbbr,
    fullMessage: personalise(messageRecord.fullMessage, contact),
    replyRate,
    sentCount: s?.sent ?? 0,
    repliedCount: s?.replied ?? 0,
  };
}

function personalise(template: string, contact: Contact): string {
  return template
    .replace(/\{NAME\}/gi, contact.firstName || '')
    .replace(/NAME/g, contact.firstName || 'there')
    .replace(/COMPANY NAME/gi, contact.company || 'your company')
    .replace(/COMPANY/gi, contact.company || 'your company')
    .replace(/XX/gi, contact.position || 'professional');
}

export interface MessageStats {
  abbreviation: string;
  sent: number; // true total times this template was used, ever
  eligible: number; // subset old enough (or already replied) to fairly count toward the rate
  replied: number;
  replyRate: number | null; // replied / eligible
}

export function getMessageStats(contacts: Contact[], messages: Message[]): MessageStats[] {
  const stats: Record<string, { sent: number; eligible: number; replied: number }> = {};

  contacts.forEach(c => {
    const isPositive = POSITIVE_REPLIES.includes(c.reply.toLowerCase());
    const eligible = countsForReplyRate(c);
    [c.message, c.followUpMessage1, c.followUpMessage2].filter(Boolean).forEach(abbr => {
      const key = normAbbr(abbr);
      if (!stats[key]) stats[key] = { sent: 0, eligible: 0, replied: 0 };
      stats[key].sent++;
      if (eligible) {
        stats[key].eligible++;
        if (isPositive) stats[key].replied++;
      }
    });
  });

  return messages.map(m => {
    const s = stats[normAbbr(m.abbreviation)];
    return {
      abbreviation: m.abbreviation,
      sent: s?.sent ?? 0,
      eligible: s?.eligible ?? 0,
      replied: s?.replied ?? 0,
      replyRate: s && s.eligible >= 2 ? Math.round((s.replied / s.eligible) * 100) : null,
    };
  });
}

// Positive replies count Interested/Yes/Referred/Opportunity - deliberately
// broader than the app-wide POSITIVE_REPLIES constant (Interested/Yes only,
// used for follow-up-cadence/Tier-2 gating). This is a reporting split only,
// scoped to this breakdown, not a change to how those contacts are treated
// elsewhere in the app.
const REPLY_BREAKDOWN_POSITIVE = ['interested', 'yes', 'referred', 'opportunity'];
// "Did they reply at all" - excludes Blocked and the disqualification-only
// values (Dead lead/Wrong location/Wrong role/Wrong business), since those
// are the sender's own call, not something the contact said.
const REPLY_BREAKDOWN_ANY = [...REPLY_BREAKDOWN_POSITIVE, 'not interested', 'gone cold'];

export interface ReplyBreakdownRow {
  stage: ExperimentStage;
  template: string;
  sent: number;
  eligible: number;
  replied: number; // any-reply count among eligible
  positive: number; // positive-reply count among eligible
  replyRate: number | null; // replied / eligible, null under min sample
  positiveRate: number | null; // positive / eligible, null under min sample
}

// Per-template, per-stage reply/positive-reply rates - same "eligible 7+ days
// or already replied" gating as getMessageStats, just split by stage
// (new/followup1/followup2) instead of merged into one "Follow Up" bucket,
// since a template can be used at either follow-up stage.
export function getReplyBreakdown(contacts: Contact[]): ReplyBreakdownRow[] {
  const groups = new Map<string, { stage: ExperimentStage; template: string; sent: number; eligible: number; replied: number; positive: number }>();

  function record(stage: ExperimentStage, templateRaw: string, c: Contact) {
    if (!templateRaw) return;
    const key = `${stage}|${normAbbr(templateRaw)}`;
    if (!groups.has(key)) groups.set(key, { stage, template: templateRaw, sent: 0, eligible: 0, replied: 0, positive: 0 });
    const g = groups.get(key)!;
    g.sent++;
    if (!countsForReplyRate(c)) return;
    g.eligible++;
    const r = c.reply.toLowerCase();
    if (REPLY_BREAKDOWN_ANY.includes(r)) g.replied++;
    if (REPLY_BREAKDOWN_POSITIVE.includes(r)) g.positive++;
  }

  contacts.forEach(c => {
    if (c.message) record('new', c.message, c);
    if (c.followUpMessage1) record('followup1', c.followUpMessage1, c);
    if (c.followUpMessage2) record('followup2', c.followUpMessage2, c);
  });

  return Array.from(groups.values())
    .map(g => ({
      ...g,
      replyRate: g.eligible >= 2 ? Math.round((g.replied / g.eligible) * 100) : null,
      positiveRate: g.eligible >= 2 ? Math.round((g.positive / g.eligible) * 100) : null,
    }))
    .sort((a, b) => (b.replyRate ?? -1) - (a.replyRate ?? -1));
}

export function todayDMY(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Stats ──────────────────────────────────────────────────────────────────

export interface WeekBucket {
  weekStart: Date;
  label: string;
  newOutreach: number;
  followUps: number;
  total: number;
}

export interface StageRate {
  sent: number;
  replied: number;
  rate: number | null;
}

export interface Stats {
  todayCount: number;
  todayNew: number;
  todayFollowUps: number;
  streak: number;
  thisWeek: WeekBucket;
  lastWeek: WeekBucket;
  sixWeeks: WeekBucket[];
  replyRates: {
    initialMessage: StageRate;
    firstFollowUp: StageRate;
    secondFollowUp: StageRate;
  };
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function weekLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function contactStage(c: Contact): 'new' | 'followup' {
  return (c.followUpMessage1 || c.followUpMessage2) ? 'followup' : 'new';
}

function emptyBucket(weekStart: Date): WeekBucket {
  return { weekStart, label: weekLabel(weekStart), newOutreach: 0, followUps: 0, total: 0 };
}

export function getStats(contacts: Contact[], activity: ActivityEvent[] = [], dailyNewGoal = 25): Stats {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build 6 week buckets (most recent first)
  const buckets: WeekBucket[] = [];
  for (let i = 0; i < 6; i++) {
    const ws = getWeekStart(new Date(today));
    ws.setDate(ws.getDate() - i * 7);
    buckets.unshift(emptyBucket(ws));
  }

  // Merge activity log with lastContacted-derived events.
  // Log wins on same contact+day, so re-touches don't erase history and
  // events aren't double-counted during the transition period.
  const logged = new Set<string>();
  const events: { date: Date; stage: 'new' | 'followup' }[] = [];

  const logDates = activity
    .filter(a => a.action !== 'reply')
    .map(a => parseDate(a.date))
    .filter((d): d is Date => !!d);
  const firstLogTime = logDates.length ? Math.min(...logDates.map(d => d.getTime())) : null;

  activity.forEach(a => {
    if (a.action === 'reply') return;
    const d = parseDate(a.date);
    if (!d) return;
    const key = `${a.rowIndex}|${dayKey(d)}`;
    if (logged.has(key)) return;
    logged.add(key);
    events.push({ date: d, stage: a.action === 'new' ? 'new' : 'followup' });
  });

  contacts.forEach(c => {
    const d = parseDate(c.lastContacted);
    if (!d) return;
    if (logged.has(`${c.rowIndex}|${dayKey(d)}`)) return;
    events.push({ date: d, stage: contactStage(c) });
  });

  const dayNew: Record<string, number> = {};
  const dayFollowUp: Record<string, number> = {};

  events.forEach(({ date, stage }) => {
    const k = dayKey(date);
    if (stage === 'new') dayNew[k] = (dayNew[k] || 0) + 1;
    else dayFollowUp[k] = (dayFollowUp[k] || 0) + 1;

    const ws = getWeekStart(date);
    const bucket = buckets.find(b => b.weekStart.getTime() === ws.getTime());
    if (!bucket) return;

    bucket.total++;
    if (stage === 'new') bucket.newOutreach++;
    else bucket.followUps++;
  });

  const todayNew = dayNew[dayKey(today)] || 0;
  const todayFollowUps = dayFollowUp[dayKey(today)] || 0;

  // Streak: goal-based once the activity log exists; any-activity for
  // days before it (history from lastContacted can't measure daily volume)
  const qualifies = (d: Date): boolean => {
    const k = dayKey(d);
    if (firstLogTime !== null && d.getTime() >= firstLogTime) {
      return (dayNew[k] || 0) >= dailyNewGoal;
    }
    return (dayNew[k] || 0) + (dayFollowUp[k] || 0) >= 1;
  };

  let streak = 0;
  const cursor = new Date(today);
  if (!qualifies(cursor)) cursor.setDate(cursor.getDate() - 1); // today still in progress
  while (qualifies(cursor)) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const thisWeek = buckets[5];
  const lastWeek = buckets[4];

  // Reply rates by stage
  const stages = { initialMessage: { sent: 0, replied: 0 }, firstFollowUp: { sent: 0, replied: 0 }, secondFollowUp: { sent: 0, replied: 0 } };
  contacts.forEach(c => {
    if (!c.message) return;
    if (!countsForReplyRate(c)) return;
    const isPositive = POSITIVE_REPLIES.includes(c.reply.toLowerCase());
    if (c.followUpMessage2) {
      stages.secondFollowUp.sent++;
      if (isPositive) stages.secondFollowUp.replied++;
    } else if (c.followUpMessage1) {
      stages.firstFollowUp.sent++;
      if (isPositive) stages.firstFollowUp.replied++;
    } else {
      stages.initialMessage.sent++;
      if (isPositive) stages.initialMessage.replied++;
    }
  });

  const toRate = (s: { sent: number; replied: number }): StageRate => ({
    ...s,
    rate: s.sent >= 2 ? Math.round((s.replied / s.sent) * 100) : null,
  });

  return {
    todayCount: todayNew + todayFollowUps,
    todayNew,
    todayFollowUps,
    streak,
    thisWeek,
    lastWeek,
    sixWeeks: buckets,
    replyRates: {
      initialMessage: toRate(stages.initialMessage),
      firstFollowUp: toRate(stages.firstFollowUp),
      secondFollowUp: toRate(stages.secondFollowUp),
    },
  };
}
