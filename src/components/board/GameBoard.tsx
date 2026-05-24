'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GameState, GemType } from '@/types/game';
import { type AnnotationArrow } from '@/lib/positionSnapshot';
import { getNobleById, getCardById } from '@/constants/gameData';
import NobleRow from './NobleRow';
import CardGrid from './CardGrid';
import GemBank from './GemBank';
import PlayerArea from '../player/PlayerArea';
import WinRateBar from '../ai/WinRateBar';

interface GameBoardProps {
    state: GameState;
    perspective: 0 | 1;
    boardNobleSlots?: number[];
    playerNobleSlots?: [number[], number[]];
    onCardClick?: (cardId: number) => void;
    onBoardNobleSlotClick?: (slot: 0 | 1 | 2) => void;
    onVisibleSlotClick?: (level: 1 | 2 | 3, slot: 0 | 1 | 2 | 3, cardId: number | null) => void;
    onDeckClick?: (level: number) => void;
    onGemClick?: (type: GemType) => void;
    onPlayerGemClick?: (player: 0 | 1, type: GemType) => void;
    onPlayerNobleSlotClick?: (player: 0 | 1, slot: 0 | 1 | 2) => void;
    onReservedCardClick?: (cardId: number) => void;
    onReservedSlotClick?: (player: 0 | 1, slot: 0 | 1 | 2) => void;
    selectedGems?: GemType[];
    selectedCardId?: number | null;
    selectedDeckLevel?: number | null;
    aiEnabled?: boolean;
    winRates?: [number, number];
    publicReservedCardIds?: number[];
    onResourceClick?: (type: GemType) => void;
    returningGems?: [number, number, number, number, number, number];
    isReturnSelectable?: (type: GemType) => boolean;
    isPaymentSelectable?: (type: GemType) => boolean;
    payingGems?: [number, number, number, number, number, number] | null;
    onPurchasedCountClick?: (player: 0 | 1, color: 0 | 1 | 2 | 3 | 4) => void;
    onPlayerPointClick?: (player: 0 | 1) => void;
    onPlayerNameClick?: (player: 0 | 1) => void;
    onPlayerAreaClick?: (player: 0 | 1) => void;
    purchasedCardOverrides?: [ReturnType<typeof getCardById>[], ReturnType<typeof getCardById>[]];
    onNobleClick?: (id: number) => void;
    eligibleNobleIds?: number[];
    isHumanTurn?: boolean;
    aiStatus?: 'idle' | 'loading' | 'thinking';
    player0Name?: string;
    player1Name?: string;
    selectedVisibleSlot?: { level: 1 | 2 | 3; slot: 0 | 1 | 2 | 3 } | null;
    allowOpponentReservedCardClick?: boolean;
    enableCardAnnotations?: boolean;
    reservedSlotCount?: number;
    annotationArrows?: AnnotationArrow[];
    onAnnotationArrowsChange?: (arrows: AnnotationArrow[]) => void;
}


const GameBoard: React.FC<GameBoardProps> = ({
    state,
    perspective,
    boardNobleSlots,
    playerNobleSlots,
    onCardClick,
    onBoardNobleSlotClick,
    onVisibleSlotClick,
    onDeckClick,
    onGemClick,
    onPlayerGemClick,
    onPlayerNobleSlotClick,
    onReservedCardClick,
    onReservedSlotClick,
    selectedGems = [],
    selectedCardId = null,
    selectedDeckLevel = null,
    aiEnabled = false,
    winRates = [50, 50],
    publicReservedCardIds = [],
    onResourceClick,
    returningGems = [0, 0, 0, 0, 0, 0],
    isReturnSelectable,
    isPaymentSelectable,
    payingGems = [0, 0, 0, 0, 0, 0],
    onPurchasedCountClick,
    onPlayerPointClick,
    onPlayerNameClick,
    onPlayerAreaClick,
    purchasedCardOverrides,
    onNobleClick,
    eligibleNobleIds = [],
    isHumanTurn = false,
    aiStatus = 'idle',
    player0Name,
    player1Name,
    selectedVisibleSlot = null,
    allowOpponentReservedCardClick = false,
    enableCardAnnotations = false,
    reservedSlotCount,
    annotationArrows: controlledAnnotationArrows,
    onAnnotationArrowsChange,
}) => {
    const currentPlayerIdx = state.board.current_player;
    const me = state.players[perspective];
    const opponent = state.players[1 - perspective];
    const mePurchasedCards = purchasedCardOverrides ? purchasedCardOverrides[perspective] : me.purchased_cards.map(getCardById);
    const opponentPurchasedCards = purchasedCardOverrides ? purchasedCardOverrides[1 - perspective] : opponent.purchased_cards.map(getCardById);
    const boardRootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const portalTarget = typeof window === 'undefined' ? null : document.body;

    const [annotationSourceId, setAnnotationSourceId] = useState<string | null>(null);
    const [internalAnnotationArrows, setInternalAnnotationArrows] = useState<AnnotationArrow[]>([]);
    const [annotationGeometryTick, setAnnotationGeometryTick] = useState(0);
    const annotationArrows = controlledAnnotationArrows ?? internalAnnotationArrows;
    const setAnnotationArrows = useCallback((next: React.SetStateAction<AnnotationArrow[]>) => {
        const resolved = typeof next === 'function' ? next(annotationArrows) : next;
        if (controlledAnnotationArrows !== undefined) {
            onAnnotationArrowsChange?.(resolved);
            return;
        }
        setInternalAnnotationArrows(resolved);
    }, [annotationArrows, controlledAnnotationArrows, onAnnotationArrowsChange]);

    const drawAnnotations = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const root = boardRootRef.current;
        if (!root) return;

        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (!enableCardAnnotations) return;

        const color = '#F97316';
        const lineWidth = 10;
        const startPad = 24;
        const arrowHeadLen = 28;
        const cardEdgePad = 10;
        const headHalfAngle = Math.PI / 6;

        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const [arrowIndex, arrow] of annotationArrows.entries()) {
            const fromEl = root.querySelector<HTMLElement>(`[data-annot-id="${arrow.fromId}"]`);
            const toEl = root.querySelector<HTMLElement>(`[data-annot-id="${arrow.toId}"]`);
            if (!fromEl || !toEl) continue;

            const fromRect = fromEl.getBoundingClientRect();
            const toRect = toEl.getBoundingClientRect();

            const fx = fromRect.left + fromRect.width / 2;
            const fy = fromRect.top + fromRect.height / 2;
            const tx = toRect.left + toRect.width / 2;
            const ty = toRect.top + toRect.height / 2;

            const dx = tx - fx;
            const dy = ty - fy;
            const dist = Math.hypot(dx, dy);
            if (dist < 1) continue;

            const ux = dx / dist;
            const uy = dy / dist;
            const angle = Math.atan2(dy, dx);

            // Shaft start (inset from source card center)
            const x1 = fx + ux * startPad;
            const y1 = fy + uy * startPad;

            // Arrowhead tip (inset from target card center)
            const tipX = tx - ux * cardEdgePad;
            const tipY = ty - uy * cardEdgePad;

            // Shaft end = arrowhead base
            const x2 = tipX - ux * arrowHeadLen;
            const y2 = tipY - uy * arrowHeadLen;

            // Draw shaft
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            // Draw filled arrowhead triangle
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(
                tipX - arrowHeadLen * Math.cos(angle - headHalfAngle),
                tipY - arrowHeadLen * Math.sin(angle - headHalfAngle),
            );
            ctx.lineTo(
                tipX - arrowHeadLen * Math.cos(angle + headHalfAngle),
                tipY - arrowHeadLen * Math.sin(angle + headHalfAngle),
            );
            ctx.closePath();
            ctx.fill();

            // Show the drawing order directly on the arrow.
            const label = String(arrowIndex + 1);
            const labelX = (x1 + x2) / 2;
            const labelY = (y1 + y2) / 2;
            const labelRadius = 10 + Math.max(0, label.length - 1) * 3;

            ctx.save();
            ctx.globalAlpha = 0.96;
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(labelX, labelY, labelRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, labelX, labelY + 0.5);
            ctx.restore();
        }
    }, [annotationArrows, enableCardAnnotations]);

    const handleAnnotationTargetContextMenu = useCallback((targetId: string, event: React.MouseEvent<HTMLElement>) => {
        if (!enableCardAnnotations) return;
        event.preventDefault();
        event.stopPropagation();

        setAnnotationSourceId((prevSource) => {
            if (prevSource === null) {
                return targetId;
            }

            if (prevSource === targetId) {
                return null;
            }

            setAnnotationArrows((prevArrows) => [
                ...prevArrows,
                {
                    fromId: prevSource,
                    toId: targetId,
                },
            ]);
            setAnnotationGeometryTick((prev) => prev + 1);

            return null;
        });
    }, [enableCardAnnotations, setAnnotationArrows]);

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => {
            drawAnnotations();
        });
        return () => window.cancelAnimationFrame(raf);
    }, [drawAnnotations, state, annotationGeometryTick]);

    useEffect(() => {
        if (!enableCardAnnotations) return;

        const refresh = () => setAnnotationGeometryTick((prev) => prev + 1);
        window.addEventListener('resize', refresh);
        window.addEventListener('scroll', refresh, true);

        return () => {
            window.removeEventListener('resize', refresh);
            window.removeEventListener('scroll', refresh, true);
        };
    }, [enableCardAnnotations]);

    useEffect(() => {
        if (!enableCardAnnotations) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setAnnotationArrows([]);
                setAnnotationSourceId(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enableCardAnnotations, setAnnotationArrows]);

    return (
        <div
            ref={boardRootRef}
            className="relative flex flex-col gap-2 w-full max-w-[1360px] mx-auto p-2 h-screen min-h-0"
            onContextMenu={enableCardAnnotations ? (event) => event.preventDefault() : undefined}
        >
            {enableCardAnnotations && portalTarget && createPortal(
                <canvas
                    ref={canvasRef}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        pointerEvents: 'none',
                        zIndex: 9999,
                    }}
                />,
                portalTarget,
            )}
            {/* 1. WinRate Bar */}
            <WinRateBar
                isEnabled={aiEnabled}
                player0Rate={winRates[0]}
                player1Rate={winRates[1]}
                player0Name={player0Name}
                player1Name={player1Name}
            />

            {/* 2. Player Areas */}
            <div className="grid grid-cols-2 gap-4 shrink-0 relative">
                {/* Player Area (Left) */}
                {/* Player Area (Left) */}
                <PlayerArea
                    player={{
                        ...me,
                        reserved_cards: me.reserved_cards.map(getCardById),
                        purchased_cards: mePurchasedCards,
                        acquired_nobles: me.acquired_nobles || []
                    }}
                    isCurrentPlayer={currentPlayerIdx === perspective}
                    isOpponent={false}
                    onReservedCardClick={onReservedCardClick}
                    onReservedSlotClick={onReservedSlotClick ? (playerIndex, slot) => onReservedSlotClick(playerIndex as 0 | 1, slot as 0 | 1 | 2) : undefined}
                    onReservedCardContextMenu={enableCardAnnotations ? handleAnnotationTargetContextMenu : undefined}
                    onPlayerNobleContextMenu={enableCardAnnotations ? handleAnnotationTargetContextMenu : undefined}
                    annotationSelectedId={annotationSourceId}
                    onGemClick={onResourceClick}
                    onOwnedGemClick={onPlayerGemClick ? (playerIndex, type) => onPlayerGemClick(playerIndex as 0 | 1, type) : undefined}
                    returningGems={currentPlayerIdx === perspective ? returningGems : undefined}
                    isReturnSelectable={isReturnSelectable}
                    onPaymentGemClick={onResourceClick}
                    payingGems={currentPlayerIdx === perspective ? payingGems : undefined}
                    isPaymentSelectable={isPaymentSelectable}
                    onPurchasedCountClick={onPurchasedCountClick ? (playerIndex, color) => onPurchasedCountClick(playerIndex as 0 | 1, color as 0 | 1 | 2 | 3 | 4) : undefined}
                    onPlayerPointClick={onPlayerPointClick ? (playerIndex) => onPlayerPointClick(playerIndex as 0 | 1) : undefined}
                    onPlayerNameClick={onPlayerNameClick ? (playerIndex) => onPlayerNameClick(playerIndex as 0 | 1) : undefined}
                    nobleSlots={playerNobleSlots?.[perspective]}
                    onNobleSlotClick={onPlayerNobleSlotClick ? (playerIndex, slot) => onPlayerNobleSlotClick(playerIndex as 0 | 1, slot as 0 | 1 | 2) : undefined}
                    onAreaClick={onPlayerAreaClick ? (playerIndex) => onPlayerAreaClick(playerIndex as 0 | 1) : undefined}
                    aiStatus={currentPlayerIdx === perspective ? aiStatus : 'idle'}
                    playerName={perspective === 0 ? player0Name : player1Name}
                    reservedSlotCount={reservedSlotCount}
                />

                {/* Opponent Area (Right) */}
                <PlayerArea
                    player={{
                        ...opponent,
                        reserved_cards: opponent.reserved_cards.map(getCardById),
                        purchased_cards: opponentPurchasedCards,
                        acquired_nobles: opponent.acquired_nobles || []
                    }}
                    isCurrentPlayer={currentPlayerIdx !== perspective}
                    isOpponent={true}
                    publicReservedCardIds={publicReservedCardIds}
                    onReservedCardClick={onReservedCardClick}
                    onReservedSlotClick={onReservedSlotClick ? (playerIndex, slot) => onReservedSlotClick(playerIndex as 0 | 1, slot as 0 | 1 | 2) : undefined}
                    onReservedCardContextMenu={enableCardAnnotations ? handleAnnotationTargetContextMenu : undefined}
                    onPlayerNobleContextMenu={enableCardAnnotations ? handleAnnotationTargetContextMenu : undefined}
                    annotationSelectedId={annotationSourceId}
                    allowReservedCardClick={allowOpponentReservedCardClick}
                    onGemClick={onResourceClick}
                    onOwnedGemClick={onPlayerGemClick ? (playerIndex, type) => onPlayerGemClick(playerIndex as 0 | 1, type) : undefined}
                    onPaymentGemClick={onResourceClick}
                    payingGems={currentPlayerIdx !== perspective ? payingGems : undefined}
                    isPaymentSelectable={isPaymentSelectable}
                    onPurchasedCountClick={onPurchasedCountClick ? (playerIndex, color) => onPurchasedCountClick(playerIndex as 0 | 1, color as 0 | 1 | 2 | 3 | 4) : undefined}
                    onPlayerPointClick={onPlayerPointClick ? (playerIndex) => onPlayerPointClick(playerIndex as 0 | 1) : undefined}
                    onPlayerNameClick={onPlayerNameClick ? (playerIndex) => onPlayerNameClick(playerIndex as 0 | 1) : undefined}
                    nobleSlots={playerNobleSlots?.[1 - perspective]}
                    onNobleSlotClick={onPlayerNobleSlotClick ? (playerIndex, slot) => onPlayerNobleSlotClick(playerIndex as 0 | 1, slot as 0 | 1 | 2) : undefined}
                    onAreaClick={onPlayerAreaClick ? (playerIndex) => onPlayerAreaClick(playerIndex as 0 | 1) : undefined}
                    aiStatus={currentPlayerIdx !== perspective ? aiStatus : 'idle'}
                    playerName={perspective === 0 ? player1Name : player0Name}
                    reservedSlotCount={reservedSlotCount}
                />
            </div>

            {/* 3. Central Board (Bank, Nobles, Cards) - Scrollable */}
            <div className="flex-1 flex flex-col gap-1 bg-white/50 backdrop-blur-sm px-4 py-2 rounded-3xl border border-white/20 shadow-xl overflow-y-auto min-h-0 z-0">
                {/* Gem Bank - Moved to top for better visibility */}
                <div className="mb-2">
                    <GemBank
                        bank={state.board.bank}
                        onGemClick={state.board.game_over || !isHumanTurn ? undefined : onGemClick}
                        selectedGems={selectedGems}
                    />
                </div>

                {/* Noble Tiles */}
                <NobleRow
                    nobles={(boardNobleSlots ?? state.board.nobles).map((nobleId) => (nobleId >= 0 ? getNobleById(nobleId) : null))}
                    onNobleClick={state.board.waiting_noble && isHumanTurn ? onNobleClick : undefined}
                    onSlotClick={onBoardNobleSlotClick ? (slot) => onBoardNobleSlotClick(slot as 0 | 1 | 2) : undefined}
                    highlightedIds={eligibleNobleIds}
                    onNobleContextMenu={enableCardAnnotations ? handleAnnotationTargetContextMenu : undefined}
                    annotationSelectedId={annotationSourceId}
                />

                {/* Card Grid */}
                <div className="pb-20"> {/* Add padding bottom to ensure last cards aren't cut off */}
                    <CardGrid
                        visibleCards={
                            state.board.visible_cards.map((row) =>
                                row.map((cardId) => (cardId >= 0 ? getCardById(cardId) : null))
                            ) as [
                                (ReturnType<typeof getCardById> | null)[],
                                (ReturnType<typeof getCardById> | null)[],
                                (ReturnType<typeof getCardById> | null)[]
                            ]
                        }
                        deckCounts={state.board.deck_counts}
                        onCardClick={state.board.game_over || !isHumanTurn ? undefined : onCardClick}
                        onCardContextMenu={enableCardAnnotations ? handleAnnotationTargetContextMenu : undefined}
                        onSlotClick={state.board.game_over || !isHumanTurn ? undefined : onVisibleSlotClick}
                        onDeckClick={state.board.game_over || !isHumanTurn ? undefined : onDeckClick}
                        selectedCardId={selectedCardId}
                        selectedDeckLevel={selectedDeckLevel}
                        selectedSlot={selectedVisibleSlot}
                        annotationSelectedId={annotationSourceId}
                    />
                </div>
            </div>
        </div>
    );
};

export default GameBoard;
