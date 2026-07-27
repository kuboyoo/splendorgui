'use client';

import React from 'react';
import { User, Trophy, BookOpen, Crown } from 'lucide-react';
import { PlayerState, GemType, CardData } from '@/types/game';
import GemToken from '../board/GemToken';
import Card from '../board/Card';
import { GEM_COLORS } from '@/constants/gemColors';
import { getNobleById } from '@/constants/gameData';

interface PlayerAreaProps {
    player: Omit<PlayerState, 'reserved_cards' | 'purchased_cards' | 'acquired_nobles'> & {
        reserved_cards: (CardData | null)[];
        purchased_cards: CardData[];
        acquired_nobles: number[];
    };
    isCurrentPlayer: boolean;
    isOpponent: boolean;
    onReservedCardClick?: (cardId: number) => void;
    onReservedCardContextMenu?: (annotationId: string, event: React.MouseEvent<HTMLElement>) => void;
    onPlayerNobleContextMenu?: (annotationId: string, event: React.MouseEvent<HTMLElement>) => void;
    annotationSelectedId?: string | null;
    publicReservedCardIds?: number[];
    onGemClick?: (type: GemType) => void;
    onOwnedGemClick?: (playerIndex: number, type: GemType) => void;
    returningGems?: [number, number, number, number, number, number];
    isReturnSelectable?: (type: GemType) => boolean;
    onPaymentGemClick?: (type: GemType) => void;
    payingGems?: [number, number, number, number, number, number] | null;
    isPaymentSelectable?: (type: GemType) => boolean;
    onPurchasedCountClick?: (playerIndex: number, color: 0 | 1 | 2 | 3 | 4) => void;
    onPlayerPointClick?: (playerIndex: number) => void;
    onPlayerNameClick?: (playerIndex: number) => void;
    onNobleSlotClick?: (playerIndex: number, slot: number) => void;
    onAreaClick?: (playerIndex: number) => void;
    aiStatus?: 'idle' | 'loading' | 'thinking';
    playerName?: string;
    nobleSlots?: number[];
    allowReservedCardClick?: boolean;
    onReservedSlotClick?: (playerIndex: number, slot: number) => void;
    reservedSlotCount?: number;
    hiddenReservedLevels?: Record<string, 1 | 2 | 3>;
}

const PlayerArea: React.FC<PlayerAreaProps> = ({
    player,
    isCurrentPlayer,
    isOpponent,
    onReservedCardClick,
    onReservedCardContextMenu,
    onPlayerNobleContextMenu,
    annotationSelectedId = null,
    publicReservedCardIds = [],
    onGemClick,
    onOwnedGemClick,
    returningGems = [0, 0, 0, 0, 0, 0],
    isReturnSelectable,
    onPaymentGemClick,
    payingGems, // Do not default here if we want to check null, or default in body
    isPaymentSelectable,
    onPurchasedCountClick,
    onPlayerPointClick,
    onPlayerNameClick,
    onNobleSlotClick,
    onAreaClick,
    aiStatus = 'idle',
    playerName,
    nobleSlots,
    allowReservedCardClick = false,
    onReservedSlotClick,
    reservedSlotCount,
    hiddenReservedLevels = {},
}) => {
    // Ensure lists are valid
    const safeReturningGems = returningGems || [0, 0, 0, 0, 0, 0];
    const safePayingGems = payingGems || [0, 0, 0, 0, 0, 0];
    const canEditPoints = !!onPlayerPointClick;
    const canEditName = !!onPlayerNameClick;
    const hiddenLevelAt = (slotIndex: number) =>
        hiddenReservedLevels[`${player.index}:${slotIndex}`];
    const reservedCardCount = player.reserved_cards.reduce(
        (count, card, slotIndex) => count + (card || hiddenLevelAt(slotIndex) ? 1 : 0),
        0,
    );
    const handleAreaClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!onAreaClick) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('button,input,textarea,select,a,[data-player-gem],[data-player-bonus],[data-player-noble],[data-player-reserved],[data-card-id],[data-annot-id]')) {
            return;
        }
        onAreaClick(player.index);
    };
    return (
        <div className={`
      w-full p-4 rounded-2xl border-2 transition-all
      ${isCurrentPlayer ? 'bg-[#6A6B76] border-[#888A98] shadow-md ring-2 ring-[#7A7C8A]' : 'bg-slate-50 border-slate-200'}
    `}
            onClick={handleAreaClick}
        >
            {/* Header: Name and Points */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-full ${isCurrentPlayer ? 'bg-[#7A7C8A] text-slate-100' : 'bg-slate-200 text-slate-600'}`}>
                        <User size={20} />
                    </div>
                    <div>
                        <div className="font-bold text-slate-800 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={canEditName ? () => onPlayerNameClick?.(player.index) : undefined}
                                disabled={!canEditName}
                                className={canEditName ? 'cursor-pointer rounded-lg px-2 py-1 -mx-2 hover:bg-white/70 transition-colors' : 'cursor-default'}
                            >
                                {playerName || (isOpponent ? 'Opponent' : 'You')}
                            </button>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${player.index === 0 ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                                {player.index === 0 ? '1st' : '2nd'}
                            </span>
                            {isCurrentPlayer && <span className="text-xs bg-[#A2A5B4] text-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">Turn</span>}
                        </div>
                        <div className="text-xs text-slate-500 font-medium">Player {player.index}</div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={canEditPoints ? () => onPlayerPointClick?.(player.index) : undefined}
                    disabled={!canEditPoints}
                    className={`flex items-center gap-1 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm transition-colors ${
                        canEditPoints ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
                    }`}
                >
                    <Trophy size={18} className="text-yellow-500" />
                    <span className="font-bold text-xl text-slate-800">{player.points}</span>
                </button>
            </div>

            {/* AI Status / Thinking Indicator */}
            {aiStatus !== 'idle' && (
                <div className={`mb-3 flex items-center gap-2 border py-1.5 px-3 rounded-lg animate-pulse ${aiStatus === 'loading' ? 'bg-indigo-50 border-indigo-100' : 'bg-emerald-50 border-emerald-100'
                    }`}>
                    <div className={`w-2 h-2 rounded-full ${aiStatus === 'loading' ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
                    <span className={`text-xs font-bold uppercase tracking-wider ${aiStatus === 'loading' ? 'text-indigo-700' : 'text-emerald-700'}`}>
                        {aiStatus === 'loading' ? 'AI着席中...' : '考慮中...'}
                    </span>
                    <span className={`text-[10px] font-medium ${aiStatus === 'loading' ? 'text-indigo-400' : 'text-emerald-400'}`}>
                        {aiStatus === 'loading' ? '(モデル読込中)' : '(最善手探索中)'}
                    </span>
                </div>
            )}

            <div className={`flex flex-col gap-4 overflow-visible transition-opacity ${aiStatus !== 'idle' ? 'opacity-60' : 'opacity-100'}`}>
                <div className="flex flex-wrap lg:flex-nowrap items-start gap-5 overflow-visible shrink-0">
                    <div className="flex flex-col gap-3 overflow-visible">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Resources</div>
                        <div className="flex gap-4 overflow-visible">
                            {([0, 1, 2, 3, 4, 5] as GemType[]).map((type) => {
                                const isReturning = safeReturningGems[type] > 0;
                                const isPaying = safePayingGems[type] > 0;
                                const returnSelectable = isReturnSelectable?.(type) || isReturning;
                                const paymentSelectable = isPaymentSelectable?.(type) || isPaying;

                                const isSelectable = !!onOwnedGemClick || (isCurrentPlayer && (
                                    (!!onGemClick && returnSelectable) ||
                                    (!!onPaymentGemClick && paymentSelectable)
                                ));

                                const handleClick = () => {
                                    if (onOwnedGemClick) {
                                        onOwnedGemClick(player.index, type);
                                    } else if (onPaymentGemClick && paymentSelectable) {
                                        onPaymentGemClick(type);
                                    } else if (onGemClick && returnSelectable) {
                                        onGemClick(type);
                                    }
                                };

                                const badgeCount = isPaying ? safePayingGems[type] : (isReturning ? safeReturningGems[type] : 0);

                                return (
                                    <div key={type} className="flex flex-col items-center gap-1">
                                        <div data-player-gem={`${player.index}-${type}`}>
                                            <GemToken
                                                gemType={type}
                                                count={player.gems[type]}
                                                size="sm"
                                                isSelectable={isSelectable}
                                                onClick={handleClick}
                                                returnedCount={badgeCount !== 0 ? badgeCount : undefined}
                                            />
                                        </div>
                                        {type < 5 ? (() => {
                                            const purchasedForColor = player.purchased_cards.filter(c => c.bonus === type);
                                            const canEditPurchasedCount = !!onPurchasedCountClick;
                                            return (
                                                <div className="relative group" data-player-bonus={`${player.index}-${type}`}>
                                                    <div
                                                        className={`
                                                            flex items-center justify-center min-w-8 h-8 rounded-lg text-sm font-bold shadow-sm transition-transform
                                                            ${canEditPurchasedCount ? 'cursor-pointer hover:scale-110' : 'cursor-default group-hover:scale-110'}
                                                        `}
                                                        style={{
                                                            backgroundColor: GEM_COLORS[type as 0 | 1 | 2 | 3 | 4].light,
                                                            color: GEM_COLORS[type as 0 | 1 | 2 | 3 | 4].dark,
                                                            border: `1px solid ${GEM_COLORS[type as 0 | 1 | 2 | 3 | 4].primary}40`
                                                        }}
                                                        title={`${GEM_COLORS[type as 0 | 1 | 2 | 3 | 4].name} Bonus`}
                                                        onClick={canEditPurchasedCount ? () => onPurchasedCountClick?.(player.index, type as 0 | 1 | 2 | 3 | 4) : undefined}
                                                    >
                                                        +{player.bonuses[type as 0 | 1 | 2 | 3 | 4]}
                                                    </div>
                                                    {purchasedForColor.length > 0 && (
                                                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-[9999]">
                                                            <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-white border-l border-t border-slate-200 transform rotate-45" />
                                                            <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-2 min-w-max">
                                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 text-center">
                                                                    {GEM_COLORS[type as 0 | 1 | 2 | 3 | 4].name} Cards ({purchasedForColor.length})
                                                                </div>
                                                                <div className="flex gap-1 flex-wrap max-w-[200px]">
                                                                    {purchasedForColor.map(card => (
                                                                        <Card key={card.id} card={card.id < 0 ? null : card} size="xs" />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })() : (
                                            <div className="w-8 h-8" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {((nobleSlots && nobleSlots.length > 0) || (player.acquired_nobles && player.acquired_nobles.length > 0)) && (
                        <div className="flex flex-col gap-3 min-w-[184px]">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Nobles</div>
                            <div className="flex gap-2 flex-wrap">
                                {(nobleSlots ?? player.acquired_nobles).map((nobleId, slotIdx) => {
                                    if (nobleId < 0) {
                                        if (!onNobleSlotClick) {
                                            return null;
                                        }
                                        return (
                                            <button
                                                key={`player-noble-empty-${player.index}-${slotIdx}`}
                                                type="button"
                                                data-player-noble={player.index}
                                                onClick={() => onNobleSlotClick(player.index, slotIdx)}
                                                className="w-14 h-14 rounded-lg border-2 border-dashed border-purple-300 bg-purple-50/70 flex items-center justify-center text-purple-500 hover:border-purple-400 transition-colors"
                                            >
                                                <Crown size={16} />
                                            </button>
                                        );
                                    }

                                    const noble = getNobleById(nobleId);
                                    const reqColors = noble.requirement
                                        .map((req, idx) => ({ req, idx }))
                                        .filter(({ req }) => req > 0);

                                    const content = (
                                        <>
                                            <Crown size={16} className="text-purple-600" />
                                            <div className="flex gap-1">
                                                {reqColors.map(({ req, idx }) => (
                                                    <div
                                                        key={idx}
                                                        className="w-3.5 h-3.5 rounded-full shadow-sm"
                                                        style={{
                                                            backgroundColor: GEM_COLORS[idx as 0 | 1 | 2 | 3 | 4].primary,
                                                            border: `1.5px solid ${GEM_COLORS[idx as 0 | 1 | 2 | 3 | 4].dark}`
                                                        }}
                                                        title={`${req} ${GEM_COLORS[idx as 0 | 1 | 2 | 3 | 4].name}`}
                                                    />
                                                ))}
                                            </div>
                                        </>
                                    );

                                    const annotationId = `noble:${nobleId}`;
                                    const isAnnotationSelected = annotationSelectedId === annotationId;

                                    if (onNobleSlotClick) {
                                        return (
                                            <button
                                                key={`player-noble-${player.index}-${slotIdx}-${nobleId}`}
                                                type="button"
                                                data-player-noble={player.index}
                                                data-annot-id={annotationId}
                                                onClick={() => onNobleSlotClick(player.index, slotIdx)}
                                                onContextMenu={(event) => onPlayerNobleContextMenu?.(annotationId, event)}
                                                className={`px-2 py-1.5 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-300 flex flex-col items-center shadow-sm gap-1 hover:border-purple-400 transition-colors ${
                                                    isAnnotationSelected ? 'outline outline-4 outline-lime-500 outline-offset-2' : ''
                                                }`}
                                                title={`Noble ${nobleId} (+3 points): ${reqColors.map(({ req, idx }) => `${req} ${GEM_COLORS[idx as 0 | 1 | 2 | 3 | 4].name}`).join(', ')}`}
                                            >
                                                {content}
                                            </button>
                                        );
                                    }

                                    return (
                                        <div
                                            key={nobleId}
                                            data-annot-id={annotationId}
                                            onContextMenu={(event) => onPlayerNobleContextMenu?.(annotationId, event)}
                                            className={`px-2 py-1.5 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-300 flex flex-col items-center shadow-sm gap-1 ${
                                                isAnnotationSelected ? 'outline outline-4 outline-lime-500 outline-offset-2' : ''
                                            }`}
                                            title={`Noble ${nobleId} (+3 points): ${reqColors.map(({ req, idx }) => `${req} ${GEM_COLORS[idx as 0 | 1 | 2 | 3 | 4].name}`).join(', ')}`}
                                        >
                                            {content}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Reserved Cards */}
                <div className="flex flex-col gap-3 w-full">
                    <div className="flex items-center gap-2">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Reserved</div>
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                            {reservedCardCount}
                        </div>
                    </div>
                    <div className="flex gap-3 min-h-[140px]" data-player-reserved={player.index}>
                        {reservedSlotCount ? (
                            Array.from({ length: reservedSlotCount }, (_, slotIdx) => {
                                const card = player.reserved_cards[slotIdx] ?? null;
                                const hiddenLevel = hiddenLevelAt(slotIdx);
                                const canEditSlot = !!onReservedSlotClick;

                                if (!card && hiddenLevel) {
                                    return (
                                        <div
                                            key={`reserved-hidden-${player.index}-${slotIdx}`}
                                            className={`
                                                w-24 h-32 rounded-xl bg-slate-200 border-2 border-slate-300 flex flex-col items-center justify-center shadow-inner
                                                ${canEditSlot ? 'cursor-pointer hover:bg-slate-300/70 transition-colors' : ''}
                                            `}
                                            title={`Level ${hiddenLevel} Deck Card`}
                                            onClick={canEditSlot ? () => onReservedSlotClick?.(player.index, slotIdx) : undefined}
                                        >
                                            <div className="w-16 h-20 rounded-lg border-2 border-dashed border-slate-400 flex items-center justify-center opacity-30">
                                                <span className="font-serif font-bold text-2xl text-slate-500">{hiddenLevel}</span>
                                            </div>
                                        </div>
                                    );
                                }

                                if (!card) {
                                    return (
                                        <div
                                            key={`reserved-empty-${player.index}-${slotIdx}`}
                                            className={`
                                                w-24 h-32 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors
                                                ${canEditSlot ? 'border-indigo-300 bg-indigo-50/40 cursor-pointer hover:border-indigo-400' : 'border-slate-200 bg-slate-50 text-slate-300'}
                                            `}
                                            onClick={canEditSlot ? () => onReservedSlotClick?.(player.index, slotIdx) : undefined}
                                        >
                                            <BookOpen size={20} />
                                        </div>
                                    );
                                }

                                const isVisible = !isOpponent || publicReservedCardIds.includes(card.id);
                                const canCardClick = canEditSlot || (!!onReservedCardClick && (!isOpponent || allowReservedCardClick));
                                const handleCardClick = canEditSlot
                                    ? () => onReservedSlotClick?.(player.index, slotIdx)
                                    : (canCardClick ? () => onReservedCardClick?.(card.id) : undefined);

                                if (isVisible) {
                                    const annotationId = `card:${card.id}`;
                                    const isAnnotationSelected = annotationSelectedId === annotationId;
                                    return (
                                        <div
                                            key={`reserved-slot-${player.index}-${slotIdx}-${card.id}`}
                                            data-annot-id={annotationId}
                                            onContextMenu={(event) => onReservedCardContextMenu?.(annotationId, event)}
                                            className={isAnnotationSelected ? 'rounded-xl outline outline-4 outline-lime-500 outline-offset-2' : undefined}
                                        >
                                            <Card
                                                card={card}
                                                size="sm"
                                                onClick={handleCardClick}
                                                isSelectable={canCardClick}
                                            />
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={`reserved-hidden-${player.index}-${slotIdx}-${card.id}`}
                                        className={`
                                            w-24 h-32 rounded-xl bg-slate-200 border-2 border-slate-300 flex flex-col items-center justify-center shadow-inner
                                            ${canEditSlot ? 'cursor-pointer hover:bg-slate-300/70 transition-colors' : ''}
                                        `}
                                        title={`Level ${card.level} Deck Card`}
                                        onClick={canEditSlot ? () => onReservedSlotClick?.(player.index, slotIdx) : undefined}
                                    >
                                        <div className="w-16 h-20 rounded-lg border-2 border-dashed border-slate-400 flex items-center justify-center opacity-30">
                                            <span className="font-serif font-bold text-2xl text-slate-500">{card.level}</span>
                                        </div>
                                    </div>
                                );
                            })
                        ) : player.reserved_cards.length > 0 ? (
                            player.reserved_cards.map((card, slotIdx) => {
                                const hiddenLevel = hiddenLevelAt(slotIdx);
                                if (!card && hiddenLevel) {
                                    return (
                                        <div
                                            key={`reserved-hidden-${player.index}-${slotIdx}`}
                                            className="w-24 h-32 rounded-xl bg-slate-200 border-2 border-slate-300 flex flex-col items-center justify-center shadow-inner"
                                            title={`Level ${hiddenLevel} Deck Card`}
                                        >
                                            <div className="w-16 h-20 rounded-lg border-2 border-dashed border-slate-400 flex items-center justify-center opacity-30">
                                                <span className="font-serif font-bold text-2xl text-slate-500">{hiddenLevel}</span>
                                            </div>
                                        </div>
                                    );
                                }
                                if (!card) return null;
                                const isVisible = !isOpponent || publicReservedCardIds.includes(card.id);
                                const canClick = !!onReservedCardClick && (!isOpponent || allowReservedCardClick);

                                if (isVisible) {
                                    const annotationId = `card:${card.id}`;
                                    const isAnnotationSelected = annotationSelectedId === annotationId;
                                    return (
                                        <div
                                            key={card.id}
                                            data-annot-id={annotationId}
                                            onContextMenu={(event) => onReservedCardContextMenu?.(annotationId, event)}
                                            className={isAnnotationSelected ? 'rounded-xl outline outline-4 outline-lime-500 outline-offset-2' : undefined}
                                        >
                                            <Card
                                                card={card}
                                                size="sm"
                                                onClick={canClick ? () => onReservedCardClick?.(card.id) : undefined}
                                                isSelectable={canClick}
                                            />
                                        </div>
                                    );
                                } else {
                                    return (
                                        <div
                                            key={card.id}
                                            className="w-24 h-32 rounded-xl bg-slate-200 border-2 border-slate-300 flex flex-col items-center justify-center shadow-inner"
                                            title={`Level ${card.level} Deck Card`}
                                        >
                                            <div className="w-16 h-20 rounded-lg border-2 border-dashed border-slate-400 flex items-center justify-center opacity-30">
                                                <span className="font-serif font-bold text-2xl text-slate-500">{card.level}</span>
                                            </div>
                                        </div>
                                    );
                                }
                            })
                        ) : (
                            <div className="flex-1 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-300">
                                <BookOpen size={24} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PlayerArea;
