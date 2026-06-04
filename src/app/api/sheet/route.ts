import { NextResponse } from 'next/server';
import {
  parseConnections,
  parseMessages,
  getFollowUpQueue,
  getNewContactsQueue,
} from '@/lib/sheets';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;
const INTERVAL = parseInt(process.env.FOLLOW_UP_INTERVAL_DAYS || '14');

async function fetchRange(range: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || 'Sheets API error');
  }
  const data = await res.json();
  return (data.values || []) as string[][];
}

export async function GET() {
  try {
    const [connectionRows, messageRows] = await Promise.all([
      fetchRange('Connections'),
      fetchRange('Messages'),
    ]);

    const contacts = parseConnections(connectionRows);
    const messages = parseMessages(messageRows);

    const followUps = getFollowUpQueue(contacts, INTERVAL);
    const newContacts = getNewContactsQueue(contacts);

    return NextResponse.json({
      followUps,
      newContacts,
      messages,
      allContacts: contacts,
      intervalDays: INTERVAL,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
