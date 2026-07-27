import { NextRequest, NextResponse } from 'next/server';
import { getDlsplendorEngine } from '@/lib/server/dlsplendorEngine';
import { resolveDlsplendorModel } from '@/lib/server/dlsplendorModels';
import type { PlayMode } from '@/types/play';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const payload =
      body && typeof body === 'object'
        ? (body as {
            mode?: unknown;
            modelId?: unknown;
            player0ModelId?: unknown;
            player1ModelId?: unknown;
            humanSeat?: unknown;
            simulations?: unknown;
            seed?: unknown;
          })
        : {};
    const mode: PlayMode =
      payload.mode === 'ai-vs-ai' ? 'ai-vs-ai' : 'human-vs-ai';
    if (
      payload.mode !== undefined &&
      payload.mode !== 'human-vs-ai' &&
      payload.mode !== 'ai-vs-ai'
    ) {
      return NextResponse.json(
        { error: '対局モードの指定が不正です。' },
        { status: 400 },
      );
    }
    const modelId = typeof payload.modelId === 'string' ? payload.modelId : '';
    const player0ModelId =
      typeof payload.player0ModelId === 'string' ? payload.player0ModelId : '';
    const player1ModelId =
      typeof payload.player1ModelId === 'string' ? payload.player1ModelId : '';
    const humanSeat = parseInteger(payload.humanSeat, 0);
    const simulations = parseInteger(payload.simulations, 400);
    const seed =
      payload.seed === undefined || payload.seed === null || payload.seed === ''
        ? null
        : parseInteger(payload.seed, -1);

    if (humanSeat !== 0 && humanSeat !== 1) {
      return NextResponse.json(
        { error: '先手・後手の指定が不正です。' },
        { status: 400 },
      );
    }
    if (simulations < 1) {
      return NextResponse.json(
        { error: 'simulationsは1以上で指定してください。' },
        { status: 400 },
      );
    }
    if (seed !== null && seed < 0) {
      return NextResponse.json(
        { error: 'seedは0以上で指定してください。' },
        { status: 400 },
      );
    }

    const playerModels:
      [
        Awaited<ReturnType<typeof resolveDlsplendorModel>> | null,
        Awaited<ReturnType<typeof resolveDlsplendorModel>> | null,
      ] =
      mode === 'ai-vs-ai'
        ? [
            await resolveDlsplendorModel(player0ModelId),
            await resolveDlsplendorModel(player1ModelId),
          ]
        : humanSeat === 0
          ? [null, await resolveDlsplendorModel(modelId)]
          : [await resolveDlsplendorModel(modelId), null];
    const result = await getDlsplendorEngine().request<Record<string, unknown>>(
      'new_game',
      {
        mode,
        player_kinds: playerModels.map((model) => model?.kind ?? null),
        model_ids: playerModels.map((model) => model?.id ?? null),
        model_paths: playerModels.map((model) => model?.absolutePath ?? null),
        model_config_paths: playerModels.map(
          (model) => model?.configAbsolutePath ?? null,
        ),
        human_seat: mode === 'human-vs-ai' ? humanSeat : null,
        simulations,
        seed,
      },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to start AI game', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : '対局の開始に失敗しました。',
      },
      { status: 500 },
    );
  }
}
