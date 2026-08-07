import { NextResponse } from 'next/server';
import { getDlsplendorEngine } from '@/lib/server/dlsplendorEngine';
import { listDlsplendorModels } from '@/lib/server/dlsplendorModels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [models, engine] = await Promise.all([
      listDlsplendorModels(),
      getDlsplendorEngine().request<Record<string, unknown>>('ping'),
    ]);
    return NextResponse.json(
      { models, engine },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to initialize dlsplendor engine', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'AIエンジンの初期化に失敗しました。',
      },
      { status: 503 },
    );
  }
}
