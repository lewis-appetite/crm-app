import { NextResponse } from 'next/server';

const FOLDER_ID = '1mPAHo4-sknl3BdkEe6vFzbAUqpQe-rDJ';
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;

export interface CakeImage {
  name: string;       // filename without its .png/.jpg/.jpeg extension
  fileId: string;
  viewLink: string;
}

export async function GET() {
  try {
    const q = encodeURIComponent(`'${FOLDER_ID}' in parents and (mimeType='image/png' or mimeType='image/jpeg') and trashed=false`);
    const fields = encodeURIComponent('files(id,name,webViewLink,mimeType)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&key=${API_KEY}`;

    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err?.error?.message || 'Drive API error');
    }

    const data = await res.json();
    type DriveFile = { id: string; name: string; webViewLink: string; mimeType: string };
    // PNGs first, so when a company has both a PNG and a JPEG the PNG is the one kept
    const files: DriveFile[] = (data.files || []).sort(
      (a: DriveFile, b: DriveFile) => Number(b.mimeType === 'image/png') - Number(a.mimeType === 'image/png')
    );
    const seen = new Set<string>();
    const images: CakeImage[] = [];
    files.forEach(f => {
      const name = f.name.replace(/\.(png|jpe?g)$/i, '');
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) return;
      seen.add(key);
      images.push({ name, fileId: f.id, viewLink: f.webViewLink });
    });

    return NextResponse.json({ images });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
