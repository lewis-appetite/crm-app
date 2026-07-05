import { NextResponse } from 'next/server';

const FOLDER_ID = '1mPAHo4-sknl3BdkEe6vFzbAUqpQe-rDJ';
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;

export interface CakeImage {
  name: string;       // filename without .png
  fileId: string;
  viewLink: string;
}

export async function GET() {
  try {
    const q = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType='image/png' and trashed=false`);
    const fields = encodeURIComponent('files(id,name,webViewLink)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&key=${API_KEY}`;

    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err?.error?.message || 'Drive API error');
    }

    const data = await res.json();
    const images: CakeImage[] = (data.files || []).map((f: { id: string; name: string; webViewLink: string }) => ({
      name: f.name.replace(/\.png$/i, ''),
      fileId: f.id,
      viewLink: f.webViewLink,
    }));

    return NextResponse.json({ images });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
