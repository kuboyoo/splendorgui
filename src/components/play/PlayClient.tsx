'use client';

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CirclePlay,
  Cpu,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  Swords,
  Timer,
  UserRound,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import GameBoard from '@/components/board/GameBoard';
import Header from '@/components/layout/Header';
import { Action, ActionType, GemType } from '@/types/game';
import {
  PlayAiMove,
  PlayEngineInfo,
  PlayGamePayload,
  PlayMode,
  PlayModelOption,
} from '@/types/play';

type BusyPhase = 'models' | 'starting' | 'human' | 'ai' | null;

type ActionFilter = {
  label: string;
  indices: number[];
  cardId?: number;
  deckLevel?: number;
};

const GEM_LABELS = ['白', '青', '緑', '赤', '黒', '金'] as const;
const GEM_LETTERS = ['W', 'U', 'G', 'R', 'K', 'D'] as const;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function formatGemVector(values: readonly number[] | undefined): string {
  if (!values) return '';
  const parts = values.flatMap((count, index) =>
    count > 0 ? [`${GEM_LABELS[index] ?? GEM_LETTERS[index]}×${count}`] : [],
  );
  return parts.join('・');
}

function hasReturnedGems(action: Action): boolean {
  return action.return_gems.some((count) => count > 0);
}

function formatReturnSuffix(action: Action): string {
  return hasReturnedGems(action)
    ? `／${formatGemVector(action.return_gems)}を返却`
    : '';
}

function formatGoldUsage(action: Action): string {
  const parts = action.gold_as.flatMap((count, index) =>
    count > 0 ? [`${GEM_LABELS[index]}として金×${count}`] : [],
  );
  return parts.length > 0 ? `（${parts.join('・')}）` : '';
}

function formatAction(action: Action): string {
  switch (action.type) {
    case ActionType.TAKE_GEMS:
      return `${formatGemVector(action.take)}を取る${formatReturnSuffix(action)}`;
    case ActionType.TAKE_TWO_GEMS:
      return `${formatGemVector(action.take)}を2枚取る${formatReturnSuffix(action)}`;
    case ActionType.RESERVE_CARD:
      return `C${action.card_id}を予約${formatReturnSuffix(action)}`;
    case ActionType.RESERVE_DECK:
      return `Level ${(action.deck_level ?? 0) + 1}の山札から予約${formatReturnSuffix(action)}`;
    case ActionType.PURCHASE:
      return `${action.from_reserved ? '予約済み' : '公開'}C${action.card_id}を購入${formatGoldUsage(action)}`;
    case ActionType.VISIT_NOBLE:
      return `貴族N${action.noble_choice}を獲得`;
    case ActionType.PASS:
      return 'パス';
    default:
      return action.usi || '不明な手';
  }
}

function resultLabel(game: PlayGamePayload): {
  title: string;
  detail: string;
  tone: string;
} | null {
  if (!game.state.board.game_over) return null;
  const winner = game.state.board.winner;
  if (winner === -2) {
    const reachedMaxTurns = game.termination_reason === 'max-turns';
    return {
      title: '引き分け',
      detail: reachedMaxTurns
        ? `${game.max_game_turns}ターンに達したため、対局を打ち切りました。`
        : '両者同点で対局終了です。',
      tone: 'border-slate-500 bg-slate-900/80 text-slate-100',
    };
  }
  if (game.mode === 'ai-vs-ai') {
    return {
      title: `P${winner}の勝ち`,
      detail: `AI同士の対局は${game.moves.length}手で終了しました。`,
      tone: 'border-amber-500 bg-amber-950/80 text-amber-100',
    };
  }
  if (winner === game.human_seat) {
    return {
      title: 'あなたの勝ち',
      detail: `P${winner}が勝利しました。`,
      tone: 'border-emerald-500 bg-emerald-950/80 text-emerald-100',
    };
  }
  return {
    title: 'AIの勝ち',
    detail: `P${winner}が勝利しました。`,
    tone: 'border-rose-500 bg-rose-950/80 text-rose-100',
  };
}

export default function PlayClient() {
  const [models, setModels] = useState<PlayModelOption[]>([]);
  const [engine, setEngine] = useState<PlayEngineInfo | null>(null);
  const [mode, setMode] = useState<PlayMode>('human-vs-ai');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [player0ModelId, setPlayer0ModelId] = useState('');
  const [player1ModelId, setPlayer1ModelId] = useState('');
  const [humanSeat, setHumanSeat] = useState<0 | 1>(0);
  const [simulations, setSimulations] = useState(400);
  const [seed, setSeed] = useState('');
  const [spectatorDelaySeconds, setSpectatorDelaySeconds] = useState(1);
  const [spectatorPaused, setSpectatorPaused] = useState(false);
  const [spectatorStepRequest, setSpectatorStepRequest] = useState(0);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const [game, setGame] = useState<PlayGamePayload | null>(null);
  const [lastAiMove, setLastAiMove] = useState<PlayAiMove | null>(null);
  const [busyPhase, setBusyPhase] = useState<BusyPhase>('models');
  const [error, setError] = useState('');
  const [actionFilter, setActionFilter] = useState<ActionFilter | null>(null);
  const [aiRetry, setAiRetry] = useState(0);
  const aiInFlightRef = useRef(false);
  const lastAiTriggerRef = useRef('');
  const consumedStepRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    void fetchJson<{ models: PlayModelOption[]; engine: PlayEngineInfo }>(
      '/api/play/models',
    )
      .then((payload) => {
        if (!active) return;
        setModels(payload.models);
        setEngine(payload.engine);
        const preferred =
          payload.models.find((model) => model.recommended && model.available) ??
          payload.models.find((model) => model.available);
        const comparison =
          payload.models.find(
            (model) =>
              model.family === 'selfplay10' &&
              model.available,
          ) ??
          payload.models.find(
            (model) =>
              model.family === 'selfplay9' &&
              model.available,
          ) ??
          payload.models.find(
            (model) =>
              model.family === 'selfplay8' &&
              model.iteration === 8 &&
              model.available,
          ) ??
          payload.models.find(
            (model) =>
              model.family === 'selfplay7' &&
              model.iteration === 30 &&
              model.available,
          ) ??
          preferred;
        setSelectedModelId(preferred?.id ?? '');
        setPlayer0ModelId(comparison?.id ?? '');
        setPlayer1ModelId(preferred?.id ?? '');
        setError(
          preferred
            ? ''
            : '利用可能なdlsplendorモデルが見つかりません。',
        );
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'AIエンジンの確認に失敗しました。',
        );
      })
      .finally(() => {
        if (active) setBusyPhase(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setActionFilter(null);
  }, [game?.moves.length]);

  useEffect(() => {
    const isAiTurn =
      !!game &&
      !game.state.board.game_over &&
      (game.mode === 'ai-vs-ai' ||
        game.state.board.current_player !== game.human_seat);
    if (!game || !isAiTurn || aiInFlightRef.current) {
      setCountdownMs(null);
      return;
    }

    const isSpectator = game.mode === 'ai-vs-ai';
    const stepRequested =
      isSpectator &&
      spectatorPaused &&
      spectatorStepRequest > consumedStepRequestRef.current;
    if (isSpectator && spectatorPaused && !stepRequested) {
      setCountdownMs(null);
      return;
    }

    const trigger = `${game.session_id}:${game.moves.length}:${game.state.board.current_player}:${aiRetry}`;
    if (lastAiTriggerRef.current === trigger) return;

    const delayMs =
      isSpectator && !stepRequested
        ? Math.max(0, spectatorDelaySeconds * 1_000)
        : 0;
    const deadline = Date.now() + delayMs;
    let requestTimer: ReturnType<typeof setTimeout> | null = null;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;

    const requestAiMove = () => {
      if (
        aiInFlightRef.current ||
        lastAiTriggerRef.current === trigger
      ) {
        return;
      }
      if (stepRequested) {
        consumedStepRequestRef.current = spectatorStepRequest;
      }
      if (countdownTimer !== null) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      lastAiTriggerRef.current = trigger;
      aiInFlightRef.current = true;
      setCountdownMs(null);
      setBusyPhase('ai');
      setError('');

      void fetchJson<PlayGamePayload>(
        `/api/play/games/${encodeURIComponent(game.session_id)}/ai`,
        { method: 'POST', body: '{}' },
      )
        .then((payload) => {
          setGame(payload);
          if (payload.ai_move) setLastAiMove(payload.ai_move);
        })
        .catch((caught: unknown) => {
          setError(
            caught instanceof Error ? caught.message : 'AIの着手に失敗しました。',
          );
        })
        .finally(() => {
          aiInFlightRef.current = false;
          setBusyPhase(null);
        });
    };

    if (delayMs === 0) {
      requestAiMove();
    } else {
      const updateCountdown = () =>
        setCountdownMs(Math.max(0, deadline - Date.now()));
      updateCountdown();
      countdownTimer = setInterval(updateCountdown, 100);
      requestTimer = setTimeout(requestAiMove, delayMs);
    }

    return () => {
      if (requestTimer !== null) clearTimeout(requestTimer);
      if (countdownTimer !== null) clearInterval(countdownTimer);
    };
  }, [
    aiRetry,
    game,
    spectatorDelaySeconds,
    spectatorPaused,
    spectatorStepRequest,
  ]);

  const isBusy = busyPhase !== null;
  const isCurrentAiTurn =
    !!game &&
    !game.state.board.game_over &&
    (game.mode === 'ai-vs-ai' ||
      game.state.board.current_player !== game.human_seat);
  const isHumanTurn =
    !!game &&
    game.mode === 'human-vs-ai' &&
    game.human_seat !== null &&
    !game.state.board.game_over &&
    game.state.board.current_player === game.human_seat &&
    !isBusy;
  const filteredActions = useMemo(() => {
    if (!game) return [];
    const indexed = game.state.legal_actions.map((action, index) => ({
      action,
      index,
    }));
    if (!actionFilter) return indexed;
    const allowed = new Set(actionFilter.indices);
    return indexed.filter(({ index }) => allowed.has(index));
  }, [actionFilter, game]);
  const outcome = game ? resultLabel(game) : null;
  const selectedModelsAvailable =
    mode === 'human-vs-ai'
      ? Boolean(selectedModelId)
      : Boolean(player0ModelId && player1ModelId);
  const modelForId = (modelId: string | null | undefined) =>
    models.find((model) => model.id === modelId);
  const playerName = (seat: 0 | 1) => {
    if (!game) return `P${seat}`;
    if (game.human_seat === seat) return 'あなた';
    return (
      modelForId(game.player_model_ids[seat])?.label ??
      `P${seat} dlsplendor AI`
    );
  };

  const startGame = async () => {
    if (!selectedModelsAvailable || isBusy) return;
    const previousSessionId = game?.session_id;
    setBusyPhase('starting');
    setError('');
    setActionFilter(null);
    setLastAiMove(null);
    setCountdownMs(null);
    setSpectatorPaused(false);
    setSpectatorStepRequest(0);
    consumedStepRequestRef.current = 0;
    lastAiTriggerRef.current = '';

    try {
      const payload = await fetchJson<PlayGamePayload>('/api/play/games', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          modelId: selectedModelId,
          player0ModelId,
          player1ModelId,
          humanSeat,
          simulations,
          seed: seed.trim() || null,
        }),
      });
      setGame(payload);
      if (previousSessionId && previousSessionId !== payload.session_id) {
        void fetch(
          `/api/play/games/${encodeURIComponent(previousSessionId)}`,
          { method: 'DELETE' },
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '対局の開始に失敗しました。',
      );
    } finally {
      setBusyPhase(null);
    }
  };

  const playHumanAction = async (actionIndex: number) => {
    if (!game || !isHumanTurn) return;
    setBusyPhase('human');
    setError('');
    try {
      const payload = await fetchJson<PlayGamePayload>(
        `/api/play/games/${encodeURIComponent(game.session_id)}/action`,
        {
          method: 'POST',
          body: JSON.stringify({ actionIndex }),
        },
      );
      setGame(payload);
      setActionFilter(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '着手に失敗しました。',
      );
    } finally {
      setBusyPhase(null);
    }
  };

  const selectMatchingActions = (
    label: string,
    predicate: (action: Action) => boolean,
    selection: Omit<ActionFilter, 'label' | 'indices'> = {},
  ) => {
    if (!game || !isHumanTurn) return;
    const indices = game.state.legal_actions.flatMap((action, index) =>
      predicate(action) ? [index] : [],
    );
    if (indices.length === 0) {
      setError(`${label}に対応する合法手はありません。`);
      return;
    }
    setError('');
    setActionFilter({ label, indices, ...selection });
  };

  const handleVisibleCard = (cardId: number) => {
    selectMatchingActions(
      `公開カード C${cardId}`,
      (action) =>
        action.card_id === cardId &&
        (action.type === ActionType.RESERVE_CARD ||
          (action.type === ActionType.PURCHASE && !action.from_reserved)),
      { cardId },
    );
  };

  const handleReservedCard = (cardId: number) => {
    selectMatchingActions(
      `予約済みカード C${cardId}`,
      (action) =>
        action.type === ActionType.PURCHASE &&
        action.from_reserved &&
        action.card_id === cardId,
      { cardId },
    );
  };

  const handleDeck = (level: number) => {
    selectMatchingActions(
      `Level ${level} 山札`,
      (action) =>
        action.type === ActionType.RESERVE_DECK &&
        action.deck_level === level - 1,
      { deckLevel: level },
    );
  };

  const handleGem = (gem: GemType) => {
    selectMatchingActions(
      `${GEM_LABELS[gem]}トークンを含む取得手`,
      (action) =>
        (action.type === ActionType.TAKE_GEMS ||
          action.type === ActionType.TAKE_TWO_GEMS) &&
        action.take[gem] > 0,
    );
  };

  const handleNoble = (nobleId: number) => {
    selectMatchingActions(
      `貴族 N${nobleId}`,
      (action) =>
        action.type === ActionType.VISIT_NOBLE &&
        action.noble_choice === nobleId,
    );
  };

  const player0Name = playerName(0);
  const player1Name = playerName(1);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-slate-900 text-slate-100">
      <Header />

      <div className="mx-auto max-w-[1780px] space-y-5 px-4 py-5 sm:px-6">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                <Swords size={15} />
                Play &amp; Spectate
              </div>
              <h1 className="mt-2 text-2xl font-black text-white">
                dlsplendor モデル対局・観戦
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                人間対AIで腕試しするか、AI同士の棋譜を任意の間隔で観戦できます。
              </p>
            </div>

            {engine && (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <CheckCircle2 size={15} />
                Engine {engine.device.toUpperCase()} / Torch {engine.torch_threads} threads
              </div>
            )}
          </div>

          <div className="mt-5 inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setMode('human-vs-ai')}
              disabled={isBusy}
              className={`rounded-lg px-4 py-2 text-sm font-black transition disabled:opacity-50 ${
                mode === 'human-vs-ai'
                  ? 'bg-emerald-500 text-emerald-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              人間 vs AI
            </button>
            <button
              type="button"
              onClick={() => setMode('ai-vs-ai')}
              disabled={isBusy}
              className={`rounded-lg px-4 py-2 text-sm font-black transition disabled:opacity-50 ${
                mode === 'ai-vs-ai'
                  ? 'bg-amber-400 text-amber-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              AI vs AI 観戦
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            {mode === 'human-vs-ai' ? (
              <>
                <label className="space-y-1.5 xl:col-span-2">
                  <span className="text-xs font-bold text-slate-400">
                    対戦モデル
                  </span>
                  <select
                    value={selectedModelId}
                    onChange={(event) => setSelectedModelId(event.target.value)}
                    disabled={isBusy}
                    className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {models.map((model) => (
                      <option
                        key={model.id}
                        value={model.id}
                        disabled={!model.available}
                      >
                        {model.label} — {model.note}
                        {!model.available ? '（未配置）' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-400">
                    あなたの手番
                  </span>
                  <select
                    value={humanSeat}
                    onChange={(event) =>
                      setHumanSeat(Number(event.target.value) === 1 ? 1 : 0)
                    }
                    disabled={isBusy}
                    className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    <option value={0}>先手（P0）</option>
                    <option value={1}>後手（P1）</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="space-y-1.5 xl:col-span-2">
                  <span className="text-xs font-bold text-slate-400">
                    先手AI（P0）
                  </span>
                  <select
                    value={player0ModelId}
                    onChange={(event) => setPlayer0ModelId(event.target.value)}
                    disabled={isBusy}
                    className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {models.map((model) => (
                      <option
                        key={model.id}
                        value={model.id}
                        disabled={!model.available}
                      >
                        {model.label} — {model.note}
                        {!model.available ? '（未配置）' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5 xl:col-span-2">
                  <span className="text-xs font-bold text-slate-400">
                    後手AI（P1）
                  </span>
                  <select
                    value={player1ModelId}
                    onChange={(event) => setPlayer1ModelId(event.target.value)}
                    disabled={isBusy}
                    className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {models.map((model) => (
                      <option
                        key={model.id}
                        value={model.id}
                        disabled={!model.available}
                      >
                        {model.label} — {model.note}
                        {!model.available ? '（未配置）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-400">simulations</span>
              <input
                type="number"
                min={1}
                value={simulations}
                onChange={(event) =>
                  setSimulations(Number.parseInt(event.target.value, 10) || 1)
                }
                disabled={isBusy}
                className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              />
            </label>

            {mode === 'ai-vs-ai' && (
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-400">
                  着手間隔（秒）
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={spectatorDelaySeconds}
                  onChange={(event) => {
                    const parsed = Number.parseFloat(event.target.value);
                    setSpectatorDelaySeconds(
                      Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
                    );
                  }}
                  className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm font-bold text-white"
                />
              </label>
            )}

            <label
              className={`space-y-1.5 ${
                mode === 'ai-vs-ai' ? 'xl:col-span-2' : ''
              }`}
            >
              <span className="text-xs font-bold text-slate-400">
                seed（空欄でランダム）
              </span>
              <input
                inputMode="numeric"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                disabled={isBusy}
                placeholder="random"
                className="w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm font-bold text-white placeholder:text-slate-600 disabled:opacity-50"
              />
            </label>

            <button
              type="button"
              onClick={() => void startGame()}
              disabled={!selectedModelsAvailable || isBusy}
              className="self-end rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-emerald-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyPhase === 'starting' ? (
                <span className="flex items-center justify-center gap-2">
                  <LoaderCircle size={16} className="animate-spin" />
                  モデル読込中
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <CirclePlay size={16} />
                  {game
                    ? mode === 'ai-vs-ai'
                      ? '新しく観戦'
                      : '新しく対局'
                    : mode === 'ai-vs-ai'
                      ? '観戦開始'
                      : '対局開始'}
                </span>
              )}
            </button>
          </div>
        </section>

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/60 px-4 py-3 text-sm text-rose-100">
            <span className="flex items-center gap-2">
              <AlertTriangle size={17} />
              {error}
            </span>
            {isCurrentAiTurn && (
                <button
                  type="button"
                  onClick={() => {
                    lastAiTriggerRef.current = '';
                    if (game?.mode === 'ai-vs-ai' && spectatorPaused) {
                      setSpectatorStepRequest((value) => value + 1);
                    }
                    setAiRetry((value) => value + 1);
                  }}
                  disabled={isBusy}
                  className="rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-bold hover:bg-rose-900 disabled:opacity-40"
                >
                  AI着手を再試行
                </button>
              )}
          </div>
        )}

        {!game ? (
          <section className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
            <Bot size={52} className="text-emerald-400" />
            <h2 className="mt-5 text-xl font-black text-white">
              モデルとモードを選んで開始してください
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              初回だけモデル読込に少し時間がかかります。AI探索は学習時と同じ
              400 simulationsが既定で、観戦中は一時停止や1手進行もできます。
            </p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Matchup
                </div>
                <div
                  className="mt-1 truncate text-sm font-black text-white"
                  title={`${player0Name} vs ${player1Name}`}
                >
                  P0 {player0Name} vs P1 {player1Name}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Search
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm font-black text-white">
                  <Cpu size={15} className="text-emerald-400" />
                  {game.simulations} simulations
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Seat / Seed
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm font-black text-white">
                  <UserRound size={15} className="text-sky-400" />
                  {game.mode === 'ai-vs-ai'
                    ? `AI観戦 / ${game.seed}`
                    : `あなた P${game.human_seat} / ${game.seed}`}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Status
                </div>
                <div className="mt-1 text-sm font-black text-white">
                  {game.state.board.game_over
                    ? '対局終了'
                    : busyPhase === 'ai'
                      ? `P${game.state.board.current_player} AI考慮中`
                      : game.mode === 'ai-vs-ai' && spectatorPaused
                        ? '一時停止中'
                        : countdownMs !== null
                          ? `次の着手まで ${(countdownMs / 1_000).toFixed(1)}秒`
                      : game.state.board.waiting_noble
                        ? `P${game.state.board.current_player} 貴族選択`
                        : `P${game.state.board.current_player} の手番`}
                </div>
              </div>
            </section>

            {outcome && (
              <section className={`rounded-3xl border p-6 text-center ${outcome.tone}`}>
                <div className="text-2xl font-black">{outcome.title}</div>
                <div className="mt-1 text-sm opacity-80">{outcome.detail}</div>
              </section>
            )}

            <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_390px]">
              <section className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/70 shadow-2xl shadow-black/30">
                <GameBoard
                  state={game.state}
                  perspective={game.human_seat ?? 0}
                  isHumanTurn={isHumanTurn}
                  aiStatus={busyPhase === 'ai' ? 'thinking' : 'idle'}
                  player0Name={player0Name}
                  player1Name={player1Name}
                  publicReservedCardIds={game.public_reserved_card_ids}
                  hiddenReservedLevels={game.hidden_reserved_levels}
                  onCardClick={isHumanTurn ? handleVisibleCard : undefined}
                  onReservedCardClick={isHumanTurn ? handleReservedCard : undefined}
                  onDeckClick={isHumanTurn ? handleDeck : undefined}
                  onGemClick={isHumanTurn ? handleGem : undefined}
                  onNobleClick={isHumanTurn ? handleNoble : undefined}
                  eligibleNobleIds={
                    game.state.board.waiting_noble
                      ? game.state.legal_actions.flatMap((action) =>
                          action.type === ActionType.VISIT_NOBLE &&
                          action.noble_choice !== null
                            ? [action.noble_choice]
                            : [],
                        )
                      : []
                  }
                  selectedCardId={actionFilter?.cardId ?? null}
                  selectedDeckLevel={actionFilter?.deckLevel ?? null}
                  reservedSlotCount={3}
                />
              </section>

              <aside className="space-y-4 2xl:sticky 2xl:top-20">
                <section className="rounded-3xl border border-white/10 bg-zinc-900/90 p-4 shadow-2xl shadow-black/30">
                  {game.mode === 'ai-vs-ai' ? (
                    <>
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-amber-400">
                        <Timer size={15} />
                        Spectator controls
                      </div>
                      <h2 className="mt-1 text-lg font-black text-white">
                        AI対AI 自動進行
                      </h2>

                      <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                        <div className="flex items-center gap-3">
                          <LoaderCircle
                            size={18}
                            className={busyPhase === 'ai' ? 'animate-spin' : ''}
                          />
                          {game.state.board.game_over
                            ? '対局は終了しました'
                            : busyPhase === 'ai'
                              ? `P${game.state.board.current_player} が考慮中`
                              : spectatorPaused
                                ? '一時停止中'
                                : countdownMs !== null
                                  ? `次の着手まで ${(countdownMs / 1_000).toFixed(1)}秒`
                                  : '次の着手を準備中'}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSpectatorPaused((value) => !value);
                            setCountdownMs(null);
                          }}
                          disabled={game.state.board.game_over}
                          className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-40"
                        >
                          {spectatorPaused ? (
                            <>
                              <Play size={16} />
                              再開
                            </>
                          ) : (
                            <>
                              <Pause size={16} />
                              一時停止
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            lastAiTriggerRef.current = '';
                            setSpectatorStepRequest((value) => value + 1);
                          }}
                          disabled={
                            !spectatorPaused ||
                            busyPhase === 'ai' ||
                            game.state.board.game_over
                          }
                          className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-sm font-black text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-40"
                        >
                          <StepForward size={16} />
                          1手進む
                        </button>
                      </div>

                      <label className="mt-4 block space-y-1.5">
                        <span className="text-xs font-bold text-slate-400">
                          着手間隔（秒・観戦中も変更可）
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={spectatorDelaySeconds}
                          onChange={(event) => {
                            const parsed = Number.parseFloat(event.target.value);
                            setSpectatorDelaySeconds(
                              Number.isFinite(parsed)
                                ? Math.max(0, parsed)
                                : 0,
                            );
                          }}
                          className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2.5 text-sm font-bold text-white"
                        />
                      </label>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        各着手前の待機時間です。AIの探索時間は別に加わります。
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                            Legal moves
                          </div>
                          <h2 className="mt-1 text-lg font-black text-white">
                            {actionFilter?.label ?? 'すべての合法手'}
                          </h2>
                        </div>
                        {actionFilter && (
                          <button
                            type="button"
                            onClick={() => setActionFilter(null)}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10"
                          >
                            すべて表示
                          </button>
                        )}
                      </div>

                      {!isHumanTurn && !game.state.board.game_over && (
                        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                          <LoaderCircle
                            size={18}
                            className={busyPhase === 'ai' ? 'animate-spin' : ''}
                          />
                          AIの着手を待っています
                        </div>
                      )}

                      {isHumanTurn && (
                        <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                          {filteredActions.map(({ action, index }) => (
                            <button
                              key={`${index}-${action.usi ?? formatAction(action)}`}
                              type="button"
                              onClick={() => void playHumanAction(index)}
                              disabled={isBusy}
                              className="block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left transition hover:border-emerald-500/50 hover:bg-emerald-500/10 disabled:opacity-40"
                            >
                              <span className="block text-sm font-bold text-slate-100">
                                {formatAction(action)}
                              </span>
                              <span className="mt-1 block break-all font-mono text-[10px] text-slate-500">
                                {action.usi}
                              </span>
                            </button>
                          ))}
                          {filteredActions.length === 0 && (
                            <div className="rounded-xl border border-dashed border-white/15 px-3 py-6 text-center text-sm text-slate-500">
                              表示できる合法手がありません。
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </section>

                {lastAiMove && (
                  <section className="rounded-3xl border border-sky-500/20 bg-sky-950/30 p-4">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-400">
                      Last AI search
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="font-mono text-sm font-bold text-sky-100">
                        {lastAiMove.usi}
                      </span>
                      <span className="truncate text-[10px] font-bold text-sky-300">
                        P{lastAiMove.player}{' '}
                        {modelForId(lastAiMove.model_id)?.label ??
                          lastAiMove.model_id}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl bg-black/20 px-3 py-2">
                        <dt className="text-slate-500">simulations</dt>
                        <dd className="mt-0.5 font-black text-white">
                          {lastAiMove.simulations}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-black/20 px-3 py-2">
                        <dt className="text-slate-500">elapsed</dt>
                        <dd className="mt-0.5 font-black text-white">
                          {(lastAiMove.elapsed_ms / 1_000).toFixed(2)}秒
                        </dd>
                      </div>
                      <div className="rounded-xl bg-black/20 px-3 py-2">
                        <dt className="text-slate-500">root value</dt>
                        <dd className="mt-0.5 font-black text-white">
                          {lastAiMove.value.toFixed(3)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-black/20 px-3 py-2">
                        <dt className="text-slate-500">tree</dt>
                        <dd className="mt-0.5 font-black text-white">
                          {lastAiMove.tree_reused ? 'reused' : 'new'}
                        </dd>
                      </div>
                    </dl>
                  </section>
                )}

                <section className="rounded-3xl border border-white/10 bg-zinc-900/90 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-black text-white">棋譜</h2>
                    <span className="text-xs text-slate-500">{game.moves.length}手</span>
                  </div>
                  <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
                    {game.moves.length === 0 ? (
                      <div className="py-5 text-center text-xs text-slate-600">
                        まだ着手はありません
                      </div>
                    ) : (
                      game.moves.map((move) => (
                        <div
                          key={`${move.number}-${move.usi}`}
                          className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs"
                        >
                          <span className="w-6 text-right text-slate-600">
                            {move.number}.
                          </span>
                          <span
                            className={
                              move.actor === 'ai'
                                ? 'font-bold text-emerald-400'
                                : 'font-bold text-sky-400'
                            }
                          >
                            P{move.player}
                          </span>
                          {move.model_id && (
                            <span className="shrink-0 text-[10px] font-bold text-slate-500">
                              iter{' '}
                              {modelForId(move.model_id)?.iteration ??
                                move.model_id}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 break-all font-mono text-slate-300">
                            {move.usi}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <button
                  type="button"
                  onClick={() => void startGame()}
                  disabled={isBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
                >
                  <RotateCcw size={16} />
                  上の設定で
                  {mode === 'ai-vs-ai' ? '新規観戦' : '新規対局'}
                </button>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
