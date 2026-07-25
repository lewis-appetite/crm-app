import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { postToAppsScript } from '@/lib/appsScript';
import { draftEmailForContact } from '@/lib/draftEmail';
import { resolveConnectionsColumn } from '@/lib/sheetsApi';

export const maxDuration = 60;

// FullEnrich calls this when a "contact_finished" enrichment completes —
// independent of whether the phone that started it is still around. Runs
// the same write-email + auto-draft path the client's polling would have,
// so a locked screen can't lose a found email or a paid-for lookup.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) {
    console.error('FullEnrich webhook received but FULLENRICH_API_KEY is not configured');
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const signature = req.headers.get('x-signature-sha1');
  const expected = crypto.createHmac('sha1', apiKey).update(rawBody).digest('hex');
  const valid =
    !!signature &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) {
    console.error('FullEnrich webhook signature mismatch');
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody);
    const entry = payload?.data?.[0];
    const rowIndex = parseInt(entry?.custom?.rowIndex);
    const email: string | null = entry?.contact_info?.most_probable_work_email?.email ?? null;

    if (!rowIndex || !email) {
      // no email found, or we can't tell which contact this was for — nothing to do
      return NextResponse.json({ ok: true, skipped: true });
    }

    const emailCol = await resolveConnectionsColumn('email');
    await postToAppsScript({ rowIndex, cells: [{ col: emailCol, value: email }] });
    const draftResult = await draftEmailForContact(rowIndex, true);
    if (!draftResult.ok) {
      console.error('FullEnrich webhook: auto-draft failed', draftResult.error);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('FullEnrich webhook processing error', err);
    // still 200 — the email/draft failure is logged, but we don't want FullEnrich retrying forever
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
