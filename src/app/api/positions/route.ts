import { NextRequest, NextResponse } from 'next/server';
import { sanitizeSnapshot } from '@/lib/positionSnapshot';
import { createSavedPosition, listSavedPositions } from '@/lib/server/firestorePositions';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const entries = await listSavedPositions();
    return NextResponse.json(entries, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to list saved positions', error);
    return NextResponse.json({ error: '局面一覧の取得に失敗しました。' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const payload = body && typeof body === 'object'
      ? body as { name?: unknown; snapshot?: unknown }
      : {};
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';

    if (!name) {
      return NextResponse.json({ error: '保存名を入力してください。' }, { status: 400 });
    }

    const entry = await createSavedPosition(name, sanitizeSnapshot(payload.snapshot));
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('Failed to create saved position', error);
    return NextResponse.json({ error: '局面保存に失敗しました。' }, { status: 500 });
  }
}
