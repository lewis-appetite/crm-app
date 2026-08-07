import { NextResponse } from 'next/server';
import {
  parseConnections,
  parseMessages,
  parseActivity,
  parseCampaigns,
  parseExperiments,
  computeExperimentResults,
  parseProspects,
  groupProspects,
  getFollowUpQueue,
  getNewContactsQueue,
  getFocusQueue,
  getFocusSuggestions,
  getActiveSnoozes,
  buildConnectionsColumnMap,
  normalizeCompany,
} from '@/lib/sheets';
import { fetchSheetRange } from '@/lib/sheetsApi';

const INTERVAL = parseInt(process.env.FOLLOW_UP_INTERVAL_DAYS || '7');
const DAILY_NEW_GOAL = parseInt(process.env.DAILY_NEW_GOAL || '25');
const CAKE_TOUCH_DAYS = parseInt(process.env.CAKE_TOUCH_DAYS || '3');
const HOT_TOUCH_DAYS = parseInt(process.env.HOT_TOUCH_DAYS || '2');

export async function GET() {
  try {
    const [connectionRows, messageRows, activityRows, campaignRows, experimentRows, prospectRows] = await Promise.all([
      fetchSheetRange('Connections'),
      fetchSheetRange('Messages'),
      fetchSheetRange('Activity').catch(() => [] as string[][]),
      fetchSheetRange('Campaigns').catch(() => [] as string[][]),
      fetchSheetRange('Experiments').catch(() => [] as string[][]),
      fetchSheetRange('Prospects').catch(() => [] as string[][]),
    ]);

    const contacts = parseConnections(connectionRows);
    const columns = buildConnectionsColumnMap(connectionRows[0] || []).letter;
    const messages = parseMessages(messageRows);
    const activity = parseActivity(activityRows);
    const campaigns = parseCampaigns(campaignRows);
    const experiments = parseExperiments(experimentRows);
    const experimentResults = experiments.map(e => computeExperimentResults(e, activity, contacts));
    const prospects = groupProspects(parseProspects(prospectRows), contacts, campaigns);

    const focusedCompanyKeys = new Set(campaigns.filter(c => c.focus).map(c => normalizeCompany(c.company)));
    const followUps = getFollowUpQueue(contacts, INTERVAL, focusedCompanyKeys);
    const newContacts = getNewContactsQueue(contacts);
    const snoozes = getActiveSnoozes(activity);
    const focus = getFocusQueue(contacts, campaigns, CAKE_TOUCH_DAYS, HOT_TOUCH_DAYS, INTERVAL, snoozes);
    const focusSuggestions = getFocusSuggestions(contacts, campaigns);

    return NextResponse.json({
      followUps,
      newContacts,
      focus,
      focusSuggestions,
      experiments,
      experimentResults,
      prospects,
      messages,
      allContacts: contacts,
      activity,
      campaigns,
      columns,
      intervalDays: INTERVAL,
      dailyNewGoal: DAILY_NEW_GOAL,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
