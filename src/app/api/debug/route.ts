import { NextResponse } from 'next/server';
import { parseConnections, parseMessages, daysAgo, parseDate } from '@/lib/sheets';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;
const INTERVAL = parseInt(process.env.FOLLOW_UP_INTERVAL_DAYS || '14');

async function fetchRange(range: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  const data = await res.json();
  return (data.values || []) as string[][];
}

export async function GET() {
  const rows = await fetchRange('Connections');
  const contacts = parseConnections(rows);

  // Contacts with a message + blank reply + a lastContacted date (should be in follow-ups)
  const withDate = contacts
    .filter(c => c.message && !c.reply && c.lastContacted)
    .slice(0, 20)
    .map(c => ({
      name: c.fullName,
      message: c.message.slice(0, 40),
      reply: c.reply,
      lastContacted: c.lastContacted,
      parsedDate: parseDate(c.lastContacted)?.toISOString() ?? null,
      daysAgo: daysAgo(c.lastContacted),
      passesInterval: (daysAgo(c.lastContacted) ?? 0) >= INTERVAL,
    }));

  // Contacts with a message + blank reply + NO lastContacted (excluded from both queues)
  const noDate = contacts.filter(c => c.message && !c.reply && !c.lastContacted).length;

  return NextResponse.json({ interval: INTERVAL, withDate, noDateCount: noDate });
}
