import { NextRequest, NextResponse } from 'next/server';
import { postToAppsScript } from '@/lib/appsScript';
import { draftEmailForContact } from '@/lib/draftEmail';

export const maxDuration = 60;

const API_BASE = 'https://app.fullenrich.com/api/v2/contact/enrich/bulk';

// POST: start an enrichment for one contact. Returns { enrichmentId }.
// Registers a webhook + the contact's rowIndex as a custom field, so the
// result can be written back and auto-drafted even if nobody polls for it
// (phone locked, app closed, etc) — see /api/enrich/webhook.
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.FULLENRICH_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'FULLENRICH_API_KEY is not configured' }, { status: 500 });
    }

    const { rowIndex, firstName, lastName, company, linkedinUrl, domain } = await req.json();
    if (!rowIndex || !firstName || !company) {
      return NextResponse.json({ error: 'rowIndex, firstName and company are required' }, { status: 400 });
    }

    const webhookUrl = `${req.nextUrl.origin}/api/enrich/webhook`;

    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `CRM app: ${firstName} ${lastName ?? ''} @ ${company}`.trim(),
        webhook_url: webhookUrl,
        webhook_events: { contact_finished: webhookUrl },
        data: [
          {
            first_name: firstName,
            last_name: lastName || '',
            company_name: company,
            ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
            ...(domain ? { domain } : {}),
            enrich_fields: ['contact.work_emails'],
            custom: { rowIndex: String(rowIndex) },
          },
        ],
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.message || json?.error || `FullEnrich responded ${res.status}`);
    }

    return NextResponse.json({ enrichmentId: json.enrichment_id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET ?id=...&rowIndex=...: poll an enrichment. If it's finished, this also
// writes the email and triggers the auto-draft server-side — the webhook is
// the safety net for when nobody's polling, this is the fast path for when
// they are. draftEmailForContact's same-day dedupe guard means both can fire
// safely without producing two drafts.
export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.FULLENRICH_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'FULLENRICH_API_KEY is not configured' }, { status: 500 });
    }

    const id = req.nextUrl.searchParams.get('id');
    const rowIndexParam = req.nextUrl.searchParams.get('rowIndex');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.message || json?.error || `FullEnrich responded ${res.status}`);
    }

    const status = json.status || 'UNKNOWN';
    const email: string | null = json.data?.[0]?.contact_info?.most_probable_work_email?.email ?? null;

    if (status === 'FINISHED' && email && rowIndexParam) {
      const rowIndex = parseInt(rowIndexParam);
      await postToAppsScript({ rowIndex, cells: [{ col: 'P', value: email }] });
      const draftResult = await draftEmailForContact(rowIndex, true);
      return NextResponse.json({
        status,
        email,
        drafted: draftResult.ok && !draftResult.skipped,
      });
    }

    return NextResponse.json({ status, email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
