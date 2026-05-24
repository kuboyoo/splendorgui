'use client';

import React from 'react';
import { Crown } from 'lucide-react';
import { NobleData } from '@/types/game';
import Noble from './Noble';

interface NobleRowProps {
    nobles: (NobleData | null)[];
    onNobleClick?: (id: number) => void;
    onSlotClick?: (slot: number) => void;
    highlightedIds?: number[];
    onNobleContextMenu?: (annotationId: string, event: React.MouseEvent<HTMLElement>) => void;
    annotationSelectedId?: string | null;
}

const NobleRow: React.FC<NobleRowProps> = ({
    nobles,
    onNobleClick,
    onSlotClick,
    highlightedIds = [],
    onNobleContextMenu,
    annotationSelectedId = null,
}) => {
    return (
        <div className="flex justify-center gap-2 w-full py-1">
            {nobles.map((noble, slotIdx) => {
                if (!noble) {
                    return (
                        <button
                            key={`noble-slot-empty-${slotIdx}`}
                            type="button"
                            onClick={onSlotClick ? () => onSlotClick(slotIdx) : undefined}
                            className={`
                                w-32 h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-colors
                                ${onSlotClick ? 'border-amber-300 bg-amber-50/70 hover:border-amber-400 cursor-pointer' : 'border-slate-200 bg-slate-50'}
                            `}
                        >
                            <Crown size={22} className={onSlotClick ? 'text-amber-500' : 'text-slate-300'} />
                        </button>
                    );
                }

                if (onSlotClick) {
                    const annotationId = `noble:${noble.id}`;
                    return (
                        <button
                            key={`noble-slot-${slotIdx}-${noble.id}`}
                            type="button"
                            onClick={() => onSlotClick(slotIdx)}
                            className="rounded-2xl"
                        >
                            <Noble
                                noble={noble}
                                isHighlighted={highlightedIds.includes(noble.id)}
                                isAnnotationSelected={annotationSelectedId === annotationId}
                                annotationId={annotationId}
                                onContextMenu={(event) => onNobleContextMenu?.(annotationId, event)}
                                isSelectable
                            />
                        </button>
                    );
                }

                const annotationId = `noble:${noble.id}`;
                return (
                    <Noble
                        key={noble.id}
                        noble={noble}
                        isHighlighted={highlightedIds.includes(noble.id)}
                        isAnnotationSelected={annotationSelectedId === annotationId}
                        annotationId={annotationId}
                        onContextMenu={(event) => onNobleContextMenu?.(annotationId, event)}
                        onClick={() => onNobleClick?.(noble.id)}
                        isSelectable={!!onNobleClick}
                    />
                );
            })}
        </div>
    );
};

export default NobleRow;
