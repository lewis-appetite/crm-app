import { NextRequest, NextResponse } from 'next/server';
import { postToAppsScript, AppsScriptPayload } from '@/lib/appsScript';

export async function POST(req: NextRequest) {
  try {
    const { rowIndex, cells, log, campaign, experiment }: AppsScriptPayload = await req.json();
    if ((!cells || cells.length === 0) && !log && !campaign && !experiment) {
      return NextResponse.json({ ok: true });
    }
    const result = await postToAppsScript({ rowIndex, cells: cells ?? [], log, campaign, experiment });
    return NextResponse.json({ ok: true, appsScript: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
