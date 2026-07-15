import { NextRequest, NextResponse } from 'next/server';
import { postToAppsScript, AppsScriptPayload } from '@/lib/appsScript';

export async function POST(req: NextRequest) {
  try {
    const { rowIndex, cells, log, campaign }: AppsScriptPayload = await req.json();
    if ((!cells || cells.length === 0) && !log && !campaign) {
      return NextResponse.json({ ok: true });
    }
    await postToAppsScript({ rowIndex, cells: cells ?? [], log, campaign });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
