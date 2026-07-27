import { NextRequest, NextResponse } from 'next/server';
import { getDlsplendorEngine } from '@/lib/server/dlsplendorEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    const body: unknown = await request.json();
    const payload =
      body && typeof body === 'object'
        ? (body as { actionIndex?: unknown })
        : {};
    const actionIndex =
      typeof payload.actionIndex === 'number'
        ? Math.trunc(payload.actionIndex)
        : Number.parseInt(String(payload.actionIndex ?? ''), 10);
    if (!Number.isInteger(actionIndex) || actionIndex < 0) {
      return NextResponse.json(
        { error: '合法手の指定が不正です。' },
        { status: 400 },
      );
    }

    const result = await getDlsplendorEngine().request<Record<string, unknown>>(
      'human_action',
      {
        session_id: sessionId,
        action_index: actionIndex,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to apply human action', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : '着手の適用に失敗しました。',
      },
      { status: 500 },
    );
  }
}
