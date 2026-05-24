'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Layers } from 'lucide-react';
import { CardData } from '@/types/game';
import Card from './Card';

interface CardGridProps {
    visibleCards: [(CardData | null | undefined)[], (CardData | null | undefined)[], (CardData | null | undefined)[]];
    deckCounts: [number, number, number];
    onCardClick?: (cardId: number) => void;
    onCardContextMenu?: (annotationId: string, event: React.MouseEvent<HTMLElement>) => void;
    onSlotClick?: (level: 1 | 2 | 3, slot: 0 | 1 | 2 | 3, cardId: number | null) => void;
    onDeckClick?: (level: number) => void;
    selectedCardId?: number | null;
    selectedDeckLevel?: number | null;
    selectedSlot?: { level: 1 | 2 | 3; slot: 0 | 1 | 2 | 3 } | null;
    annotationSelectedId?: string | null;
}

const CardGrid: React.FC<CardGridProps> = ({
    visibleCards,
    deckCounts,
    onCardClick,
    onCardContextMenu,
    onSlotClick,
    onDeckClick,
    selectedCardId,
    selectedDeckLevel,
    selectedSlot,
    annotationSelectedId,
}) => {
    const levels = [3, 2, 1] as const;

    return (
        <div className="flex flex-col gap-2 w-full py-1">
            {levels.map((level) => {
                const cards = visibleCards[level - 1]; // index 0 is level 1, 1 is level 2, 2 is level 3
                return (
                    <div key={level} className="flex gap-2 items-center justify-center">
                        {/* Deck */}
                        <motion.div
                            whileHover={onDeckClick ? { y: -5, scale: 1.02, backgroundColor: '#f1f5f9' } : {}}
                            whileTap={onDeckClick ? { scale: 0.98 } : {}}
                            onClick={() => onDeckClick?.(level)}
                            className={`
                relative w-32 h-44 rounded-xl border-2 flex flex-col items-center justify-center gap-2 shadow-inner transition-all
                ${selectedDeckLevel === level ? 'border-amber-400 bg-amber-50 ring-4 ring-amber-200 shadow-lg' : 'border-gray-300 bg-gray-100'}
                ${onDeckClick ? 'cursor-pointer' : 'cursor-default'}
              `}
                        >
                            <Layers className={selectedDeckLevel === level ? 'text-amber-500' : 'text-gray-400'} size={32} />
                            <div className={`font-bold text-lg ${selectedDeckLevel === level ? 'text-amber-700' : 'text-gray-600'}`}>
                                Level {level}
                            </div>
                            <div className={`absolute top-2 right-2 text-white text-xs px-2 py-0.5 rounded-full ${selectedDeckLevel === level ? 'bg-amber-500' : 'bg-gray-500'}`}>
                                {deckCounts[level - 1]}
                            </div>
                        </motion.div>

                        {/* Cards in row */}
                        <div className="flex gap-2">
                            {/* Ensure 4 slots always */}
                            {[0, 1, 2, 3].map((slotIdx) => {
                                const levelKey = level as 1 | 2 | 3;
                                const slotKey = slotIdx as 0 | 1 | 2 | 3;
                                const card = cards[slotIdx] ?? null;
                                const isSlotSelected = selectedSlot?.level === levelKey && selectedSlot?.slot === slotKey;
                                const isSelectable = !!onSlotClick || (!!onCardClick && !!card);
                                const handleClick = () => {
                                    if (onSlotClick) {
                                        onSlotClick(levelKey, slotKey, card ? card.id : null);
                                        return;
                                    }
                                    if (card) onCardClick?.(card.id);
                                };

                                const annotationId = card ? `card:${card.id}` : undefined;
                                const isAnnotationSelected = !!annotationId && annotationSelectedId === annotationId;

                                return (
                                    <div
                                        key={card ? card.id : `empty-${level}-${slotIdx}`}
                                        data-card-id={card?.id}
                                        data-annot-id={annotationId}
                                        onContextMenu={annotationId ? (event) => onCardContextMenu?.(annotationId, event) : undefined}
                                        className={isAnnotationSelected ? 'rounded-xl outline outline-4 outline-lime-500 outline-offset-2' : undefined}
                                    >
                                        <Card
                                            card={card || null}
                                            onClick={isSelectable ? handleClick : undefined}
                                            isSelected={onSlotClick ? isSlotSelected : card?.id === selectedCardId}
                                            isSelectable={isSelectable}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default CardGrid;
