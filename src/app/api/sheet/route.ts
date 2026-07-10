import { NextResponse } from 'next/server';
import {
  parseConnections,
  parseMessages,
  parseActivity,
  parseCampaigns,
  getFollowUpQueue,
  getNewContactsQueue,
  getTodayQueue,
  getActiveSnoozes,
} from '@/lib/sheets';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;
const INTERVAL = parseInt(process.env.FOLLOW_UP_INTERVAL_DAYS || '14');
const DAILY_NEW_GOAL = parseInt(process.env.DAILY_NEW_GOAL || '25');
const GONE_COLD_DAYS = parseInt(process.env.GONE_COLD_DAYS || '8');

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
    const [connectionRows, messageRows, activityRows, campaignRows] = await Promise.all([
      fetchRange('Connections'),
      fetchRange('Messages'),
      fetchRange('Activity').catch(() => [] as string[][]),
      fetchRange('Campaigns').catch(() => [] as string[][]),
    ]);

    const contacts = parseConnections(connectionRows);
    const messages = parseMessages(messageRows);
    const activity = parseActivity(activityRows);
    const campaigns = parseCampaigns(campaignRows);

    const followUps = getFollowUpQueue(contacts, INTERVAL);
    const newContacts = getNewContactsQueue(contacts);
    const snoozes = getActiveSnoozes(activity);
    const today = getTodayQueue(contacts, campaigns, GONE_COLD_DAYS, snoozes);

    return NextResponse.json({
      followUps,
      newContacts,
      today,
      messages,
      allContacts: contacts,
      activity,
      campaigns,
      intervalDays: INTERVAL,
      dailyNewGoal: DAILY_NEW_GOAL,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
