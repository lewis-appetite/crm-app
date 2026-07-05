import { NextResponse } from 'next/server';

const FOLDER_ID = '1mPAHo4-sknl3BdkEe6vFzbAUqpQe-rDJ';
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;

export async function GET() {
  const q = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType='image/png' and trashed=false`);
  const fields = encodeURIComponent('files(id,name,webViewLink)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=10&key=${API_KEY}`;

  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  return NextResponse.json({ status: res.status, data });
}
