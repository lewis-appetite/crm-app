// Types
export interface Contact {
  rowIndex: number;
  firstName: string;
  lastName: string;
  fullName: string;
  url: string;
  company: string;
  position: string;
  function: string;
  connectedOn: string;
  message: string;
  reply: string;
  followUps: string;
  followUpMessage1: string;
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
  FUNCTION: 5,
  CONNECTED_ON: 6,
  MESSAGE: 7,
  REPLY: 8,
  FOLLOW_UPS: 9,
  FOLLOW_UP_MESSAGE_1: 10,
  LAST_CONTACTED: 11,
  COMMENT: 12,
};

// Column letters for Sheets API updates (1-based column letters)
export const SHEET_COLS = {
  REPLY: 'I',       // col 9
  LAST_CONTACTED: 'L', // col 12
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
    function: (row[COL.FUNCTION] || '').trim(),
    connectedOn: (row[COL.CONNECTED_ON] || '').trim(),
    message: (row[COL.MESSAGE] || '').trim(),
    reply: (row[COL.REPLY] || '').trim(),
    followUps: (row[COL.FOLLOW_UPS] || '').trim(),
    followUpMessage1: (row[COL.FOLLOW_UP_MESSAGE_1] || '').trim(),
    lastContacted: (row[COL.LAST_CONTACTED] || '').trim(),
    comment: (row[COL.COMMENT] || '').trim(),
  }));
}

export function parseMessages(rows: string[][]): Message[] {
  return rows.slice(1).map(row => ({
    messageType: (row[0] || '').trim(),
    target: (row[1] || '').trim(),
    abbreviation: (row[2] || '').trim(),
    fullMessage: (row[3] || '').trim(),
  }));
}

const DEAD_STATUSES = ['dead lead', 'not interested', 'blocked', 'gone cold'];

export function isDead(contact: Contact): boolean {
  return DEAD_STATUSES.includes(contact.reply.toLowerCase());
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
      if (isDead(c)) return false;
      if (c.reply.toLowerCase() === 'interested') return false;
      const days = daysAgo(c.lastContacted);
      if (days === null) return false;
      return days >= intervalDays;
    })
    .sort((a, b) => {
      const aHasFollowUp = !!a.followUpMessage1;
      const bHasFollowUp = !!b.followUpMessage1;
      // No follow-up sent yet floats to top
      if (aHasFollowUp !== bHasFollowUp) return aHasFollowUp ? 1 : -1;
      // Within each group, oldest last contacted first
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
    if (c.reply.toLowerCase() === 'interested') stats[abbr].replied++;
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

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
