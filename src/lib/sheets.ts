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
  }));
}

// Activity tab: A Date | B Row | C Name | D Company | E Action | F Template | G Detail
export interface ActivityEvent {
  date: string;
  rowIndex: number;
  action: string; // 'new' | 'followup1' | 'followup2' | 'followup3' | 'reply'
  template: string;
}

export function parseActivity(rows: string[][]): ActivityEvent[] {
  return rows
    .slice(1)
    .map(row => ({
      date: (row[0] || '').trim(),
      rowIndex: parseInt(row[1]) || 0,
      action: (row[4] || '').trim().toLowerCase(),
      template: (row[5] || '').trim(),
    }))
    .filter(e => e.date && e.action);
}

export function parseMessages(rows: string[][]): Message[] {
  return rows.slice(1).map(row => ({
    messageType: (row[0] || '').trim(),
    target: (row[1] || '').trim(),
    abbreviation: (row[2] || '').trim(),
    fullMessage: (row[3] || '').trim(),
  }));
}

export const POSITIVE_REPLIES = ['interested', 'yes', 'referred'];

// Replies that still warrant a follow-up, in priority order
const FOLLOW_UP_WORTHY = ['interested', 'yes', '', 'referred'];
const REPLY_PRIORITY: Record<string, number> = { interested: 0, yes: 1, '': 2, referred: 3 };

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

export function suggestMessage(
  contact: Contact,
  allContacts: Contact[],
  messages: Message[],
  isFollowUp: boolean
): SuggestedMessage | null {
  const templateAbbr = isFollowUp ? contact.followUpMessage1 : contact.message;

  // Build stats: for similar roles, which templates got replies?
  const roleKeyword = contact.position.toLowerCase().split(' ')[0];
  const func = contact.function.toLowerCase();

  const stats: Record<string, { sent: number; replied: number }> = {};

  allContacts.forEach(c => {
    const abbr = isFollowUp ? c.followUpMessage1 : c.message;
    if (!abbr) return;

    const cRole = c.position.toLowerCase();
    const cFunc = c.function.toLowerCase();
    const isSimilar =
      (roleKeyword && cRole.includes(roleKeyword)) ||
      (func && cFunc === func);

    if (!isSimilar) return;

    if (!stats[abbr]) stats[abbr] = { sent: 0, replied: 0 };
    stats[abbr].sent++;
    if (POSITIVE_REPLIES.includes(c.reply.toLowerCase())) stats[abbr].replied++;
  });

  // Find best performing template for similar roles
  let bestAbbr: string | null = null;
  let bestRate = -1;
  Object.entries(stats).forEach(([abbr, s]) => {
    if (s.sent < 2) return; // need at least 2 data points
    const rate = s.replied / s.sent;
    if (rate > bestRate) {
      bestRate = rate;
      bestAbbr = abbr;
    }
  });

  // Use best template if found, otherwise fall back to contact's assigned template
  const chosenAbbr = bestAbbr || templateAbbr;
  if (!chosenAbbr) return null;

  const messageRecord = messages.find(m => m.abbreviation === chosenAbbr);
  if (!messageRecord) return null;

  const s = stats[chosenAbbr];
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
  sent: number;
  replied: number;
  replyRate: number | null;
}

export function getMessageStats(contacts: Contact[], messages: Message[]): MessageStats[] {
  const stats: Record<string, { sent: number; replied: number }> = {};

  contacts.forEach(c => {
    const isPositive = POSITIVE_REPLIES.includes(c.reply.toLowerCase());
    if (c.message) {
      if (!stats[c.message]) stats[c.message] = { sent: 0, replied: 0 };
      stats[c.message].sent++;
      if (isPositive) stats[c.message].replied++;
    }
    if (c.followUpMessage1) {
      if (!stats[c.followUpMessage1]) stats[c.followUpMessage1] = { sent: 0, replied: 0 };
      stats[c.followUpMessage1].sent++;
      if (isPositive) stats[c.followUpMessage1].replied++;
    }
  });

  return messages.map(m => {
    const s = stats[m.abbreviation];
    return {
      abbreviation: m.abbreviation,
      sent: s?.sent ?? 0,
      replied: s?.replied ?? 0,
      replyRate: s && s.sent >= 2 ? Math.round((s.replied / s.sent) * 100) : null,
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
