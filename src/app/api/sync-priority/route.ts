import { NextRequest, NextResponse } from 'next/server';
import { parseConnections, parseCampaigns, normalizeCompany, isCampaignActive, computePriorityLabel, PRIORITY_COL } from '@/lib/sheets';
import { fetchSheetRange } from '@/lib/sheetsApi';
import { postToAppsScript } from '@/lib/appsScript';

// Recomputes and writes the Priority column (S) for every contact at a given
// company, based on the company's current campaign stage. Called after a
// company's stage changes, since that can flip Priority for many rows at
// once. Only rows whose value actually changed are written.
export async function POST(req: NextRequest) {
  try {
    const { company } = await req.json();
    if (!company) return NextResponse.json({ error: 'company is required' }, { status: 400 });

    const [connectionRows, campaignRows] = await Promise.all([
      fetchSheetRange('Connections'),
      fetchSheetRange('Campaigns').catch(() => [] as string[][]),
    ]);
    const contacts = parseConnections(connectionRows);
    const campaigns = parseCampaigns(campaignRows);

    const key = normalizeCompany(company);
    const campaign = campaigns.find(c => normalizeCompany(c.company) === key);
    const isActive = campaign ? isCampaignActive(campaign.status) : false;

    const batch = contacts
      .filter(c => normalizeCompany(c.company) === key)
      .map(c => ({ rowIndex: c.rowIndex, label: computePriorityLabel(c, isActive), current: c.priority }))
      .filter(x => x.label !== x.current)
      .map(x => ({ rowIndex: x.rowIndex, cells: [{ col: PRIORITY_COL, value: x.label }] }));

    if (batch.length > 0) {
      await postToAppsScript({ batch });
    }

    return NextResponse.json({ ok: true, updated: batch.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
