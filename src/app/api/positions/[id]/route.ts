import { NextResponse } from 'next/server';
import { getSavedPosition } from '@/lib/server/firestorePositions';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const entry = await getSavedPosition(id);

    if (!entry) {
      return NextResponse.json({ error: '保存済み局面が見つかりません。' }, { status: 404 });
    }

    return NextResponse.json(entry);
  } catch (error) {
    console.error('Failed to load saved position', error);
    return NextResponse.json({ error: '局面の読み込みに失敗しました。' }, { status: 500 });
  }
}
