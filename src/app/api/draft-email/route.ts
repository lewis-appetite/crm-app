import { NextRequest, NextResponse } from 'next/server';
import { draftEmailForContact } from '@/lib/draftEmail';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { rowIndex } = await req.json();
    if (!rowIndex) return NextResponse.json({ error: 'rowIndex is required' }, { status: 400 });

    const result = await draftEmailForContact(rowIndex, false);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
