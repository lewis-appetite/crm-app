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

// Column indices for Connections sheet (0-based)
const COL = {
  FIRST_NAME: 0,
  LAST_NAME: 1,
  URL: 2,
  COMPANY: 3,
  POSITION: 4,
  LIST: 5,
  FUNCTION: 6,
  CONNECTED_ON: 7,
  MESSAGE: 8,
  REPLY: 9,
  FOLLOW_UPS: 10,
  FOLLOW_UP_MESSAGE_1: 11,
  FOLLOW_UP_MESSAGE_2: 12,
  LAST_CONTACTED: 13,
  COMMENT: 14,
  EMAIL: 15,
  PHONE: 16,
};

// Column letters for Sheets API updates (1-based column letters)
export const SHEET_COLS = {
  REPLY: 'J',       // col 9 (0-based) = J
  LAST_CONTACTED: 'N', // col 13 (0-based) = N
};

export function parseConnections(rows: string[][]): Contact[] {
  // Skip header row (index 0)
  return rows.slice(1).map((row, i) => ({
    rowIndex: i + 2, // 1-based, +1 for header
    firstName: (row[COL.FIRST_NAME] || '').trim(),
    lastName: (row[COL.LAST_NAME] || '').trim(),
    fullName: `${(row[COL.FIRST_NAME] || '').trim()} ${(row[COL.LAST_NAME] || '').trim()}`.trim(),
    url: (row[COL.URL] || '').trim(),
    company: (row[COL.COMPANY] || '').trim(),
    position: (row[COL.POSITION] || '').trim(),
    list: (row[COL.LIST] || '').trim(),
    function: (row[COL.FUNCTION] || '').trim(),
    connectedOn: (row[COL.CONNECTED_ON] || '').trim(),
    message: (row[COL.MESSAGE] || '').trim(),
    reply: (row[COL.REPLY] || '').trim(),
    followUps: (row[COL.FOLLOW_UPS] || '').trim(),
    followUpMessage1: (row[COL.FOLLOW_UP_MESSAGE_1] || '').trim(),
    followUpMessage2: (row[COL.FOLLOW_UP_MESSAGE_2] || '').trim(),
    lastContacted: (row[COL.LAST_CONTACTED] || '').trim(),
    comment: (row[COL.COMMENT] || '').trim(),
    email: cleanContactField(row[COL.EMAIL]),
    phone: cleanContactField(row[COL.PHONE]),
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

// Campaigns tab: A Company | B Status | C Cake sent (date) | D Notes
export interface CampaignEntry {
  company: string;
  status: string;
  cakeSentDate: string;
  notes: string;
}

export function parseCampaigns(rows: string[][]): CampaignEntry[] {
  return rows
    .slice(1)
    .map(row => ({
      company: (row[0] || '').trim(),
      status: (row[1] || '').trim(),
      cakeSentDate: (row[2] || '').trim(),
      notes: (row[3] || '').trim(),
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

export function getFollowUpQueue(contacts: Contact[], intervalDays: number): Contact[] {
  return contacts
    .filter(c => {
      if (!c.message) return false;
      if (!FOLLOW_UP_WORTHY.includes(c.reply.toLowerCase())) return false;
      const days = daysAgo(c.lastContacted);
      if (days === null) return false;
      return days >= intervalDays;
    })
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

// Same normalization used for cake-image filename matching — reused here so
// Campaigns tab company names match Connections company names consistently
export function normalizeCompany(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const CLOSED_CAMPAIGN_KEYWORDS = ['closed', 'won', 'lost', 'dead'];

export function isCampaignClosed(status: string): boolean {
  const s = status.toLowerCase();
  return CLOSED_CAMPAIGN_KEYWORDS.some(k => s.includes(k));
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
}

export interface CompanyGroup {
  company: string;
  tier: Tier;
  contacts: TierContact[];
  maxOverdueDays: number | null;
}

// Unified "Today" queue: groups the highest-priority follow-ups by company —
// cake-campaign accounts (Tier 1) and contacts who replied positively then
// went quiet (Tier 2). Companies marked closed in the Campaigns tab
// (Closed-Lost, Closed Won, etc.) drop out of Tier 1 entirely.
export function getTodayQueue(
  contacts: Contact[],
  campaigns: CampaignEntry[],
  goneColdDays: number,
  snoozes: Record<number, Date> = {}
): CompanyGroup[] {
  const cakeCompanies = new Set(
    campaigns
      .filter(c => !isCampaignClosed(c.status))
      .map(c => normalizeCompany(c.company))
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groups = new Map<string, CompanyGroup>();

  contacts.forEach(c => {
    if (isDead(c)) return;
    if (!c.company) return;
    const snoozedUntil = snoozes[c.rowIndex];
    if (snoozedUntil && snoozedUntil.getTime() >= today.getTime()) return;

    const isCakeCompany = cakeCompanies.has(normalizeCompany(c.company));
    const isPositive = POSITIVE_REPLIES.includes(c.reply.toLowerCase());
    const days = daysAgo(c.lastContacted);

    let tier: Tier | null = null;
    let overdueDays: number | null = null;

    if (isCakeCompany) {
      tier = 1;
      overdueDays = days !== null ? days - goneColdDays : null;
    } else if (isPositive && days !== null && days >= goneColdDays) {
      tier = 2;
      overdueDays = days - goneColdDays;
    }

    if (tier === null) return;

    const key = normalizeCompany(c.company);
    if (!groups.has(key)) {
      groups.set(key, { company: c.company, tier, contacts: [], maxOverdueDays: null });
    }
    const group = groups.get(key)!;
    if (tier < group.tier) group.tier = tier;
    group.contacts.push({ ...c, tier, overdueDays });
  });

  const result = Array.from(groups.values());
  result.forEach(g => {
    g.contacts.sort((a, b) => a.tier - b.tier || (b.overdueDays ?? -Infinity) - (a.overdueDays ?? -Infinity));
    g.maxOverdueDays = g.contacts.reduce<number | null>(
      (max, c) => (c.overdueDays !== null && (max === null || c.overdueDays > max) ? c.overdueDays : max),
      null
    );
  });
  result.sort((a, b) => a.tier - b.tier || (b.maxOverdueDays ?? -Infinity) - (a.maxOverdueDays ?? -Infinity));

  return result;
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
