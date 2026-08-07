import { NextResponse } from 'next/server';
import { getDlsplendorEngine } from '@/lib/server/dlsplendorEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    const result = await getDlsplendorEngine().request<Record<string, unknown>>(
      'ai_action',
      { session_id: sessionId },
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to get AI action', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'AIの着手に失敗しました。',
      },
      { status: 500 },
    );
  }
}
