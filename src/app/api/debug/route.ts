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

  const sample = contacts
    .filter(c => c.message && !c.reply)
    .slice(0, 20)
    .map(c => ({
      name: c.fullName,
      message: c.message,
      reply: c.reply,
      lastContacted: c.lastContacted,
      parsedDate: parseDate(c.lastContacted)?.toISOString() ?? null,
      daysAgo: daysAgo(c.lastContacted),
      passesInterval: (daysAgo(c.lastContacted) ?? 0) >= INTERVAL,
    }));

  return NextResponse.json({ interval: INTERVAL, sample });
}
