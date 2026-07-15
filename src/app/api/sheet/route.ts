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
import { fetchSheetRange } from '@/lib/sheetsApi';

const INTERVAL = parseInt(process.env.FOLLOW_UP_INTERVAL_DAYS || '14');
const DAILY_NEW_GOAL = parseInt(process.env.DAILY_NEW_GOAL || '25');
const GONE_COLD_DAYS = parseInt(process.env.GONE_COLD_DAYS || '8');

export async function GET() {
  try {
    const [connectionRows, messageRows, activityRows, campaignRows] = await Promise.all([
      fetchSheetRange('Connections'),
      fetchSheetRange('Messages'),
      fetchSheetRange('Activity').catch(() => [] as string[][]),
      fetchSheetRange('Campaigns').catch(() => [] as string[][]),
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
