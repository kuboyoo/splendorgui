import { NextRequest, NextResponse } from 'next/server';
import { getCsplendorMateEngine } from '@/lib/server/csplendorMateEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BROWSER_FRONTIER_EDGES = 10_000;
const MAX_BROWSER_FRONTIER_BYTES = 16 * 1024 * 1024;

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name}は${minimum}以上${maximum}以下の整数で指定してください。`);
  }
  return value;
}

function actionCodes(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error('preferred_attacker_actionsは32要素以下の配列で指定してください。');
  }
  return value.map((action, index) => integer(
    action,
    `preferred_attacker_actions[${index}]`,
    0,
    Number.MAX_SAFE_INTEGER,
  ));
}

export async function POST(request: NextRequest) {
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('JSON objectが必要です。');
    const body = raw as Record<string, unknown>;
    const position = typeof body.position === 'string' ? body.position : undefined;
    const state = typeof body.state === 'string' ? body.state : undefined;
    if (!position && !state) throw new Error('positionまたはstateが必要です。');
    const attacker = integer(body.attacker, 'attacker', 0, 1);
    const depth = integer(body.depth, 'depth', 0, 31);
    const preferredAttackerActions = actionCodes(body.preferred_attacker_actions);
    const result = await getCsplendorMateEngine().request<Record<string, unknown>>(
      'expand_frontier',
      {
        position,
        state,
        attacker,
        depth,
        max_nodes: Math.floor(clamp(envNumber('CSPLENDOR_MATE_NODE_LIMIT', 5_000_000), 0, 20_000_000)),
        time_limit_seconds: clamp(envNumber('CSPLENDOR_MATE_TIME_LIMIT', 30), 0, 600),
        edge_limit: Math.floor(clamp(
          envNumber('CSPLENDOR_MATE_EDGE_LIMIT', MAX_BROWSER_FRONTIER_EDGES),
          0,
          MAX_BROWSER_FRONTIER_EDGES,
        )),
        preferred_attacker_actions: preferredAttackerActions,
      },
      request.signal,
    );
    const responseBody = JSON.stringify(result);
    if (Buffer.byteLength(responseBody, 'utf8') > MAX_BROWSER_FRONTIER_BYTES) {
      throw new Error('遅延応手の展開結果がブラウザの安全上限（16 MiB）を超えました。');
    }
    return new NextResponse(responseBody, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '詰み応手の展開に失敗しました。';
    const invalidRequest = /必要です|指定してください|JSON object/u.test(message);
    return NextResponse.json({ error: message }, { status: invalidRequest ? 400 : 503 });
  }
}
