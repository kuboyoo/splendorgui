import { NextResponse } from 'next/server';
import { getDlsplendorEngine } from '@/lib/server/dlsplendorEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    const result = await getDlsplendorEngine().request<Record<string, unknown>>(
      'delete_game',
      { session_id: sessionId },
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to delete AI game', error);
    return NextResponse.json(
      { error: '対局セッションの終了に失敗しました。' },
      { status: 500 },
    );
  }
}
