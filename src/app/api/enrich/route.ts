import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'https://app.fullenrich.com/api/v2/contact/enrich/bulk';

// POST: start an enrichment for one contact. Returns { enrichmentId }.
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.FULLENRICH_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'FULLENRICH_API_KEY is not configured' }, { status: 500 });
    }

    const { firstName, lastName, company, linkedinUrl } = await req.json();
    if (!firstName || !company) {
      return NextResponse.json({ error: 'firstName and company are required' }, { status: 400 });
    }

    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `CRM app: ${firstName} ${lastName ?? ''} @ ${company}`.trim(),
        data: [
          {
            first_name: firstName,
            last_name: lastName || '',
            company_name: company,
            ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
            enrich_fields: ['contact.work_emails'],
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

// GET ?id=...: poll an enrichment. Returns { status, email? }.
export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.FULLENRICH_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'FULLENRICH_API_KEY is not configured' }, { status: 500 });
    }

    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.message || json?.error || `FullEnrich responded ${res.status}`);
    }

    const status = json.status || 'UNKNOWN';
    const email =
      json.data?.[0]?.contact_info?.most_probable_work_email?.email ?? null;

    return NextResponse.json({ status, email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
