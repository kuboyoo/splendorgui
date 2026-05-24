'use client';

import React from 'react';
import { GemType } from '@/types/game';
import GemToken from './GemToken';

interface GemBankProps {
    bank: [number, number, number, number, number, number];
    onGemClick?: (type: GemType) => void;
    selectedGems?: GemType[];
}

const GemBank: React.FC<GemBankProps> = ({
    bank,
    onGemClick,
    selectedGems = [],
}) => {
    const totalSelected = selectedGems.length;
    const hasDoubleSelection = selectedGems.some(t => selectedGems.filter(x => x === t).length >= 2);
    const gemTypes: GemType[] = [0, 1, 2, 3, 4, 5];

    return (
        <div className="flex justify-center gap-4 w-full py-2 bg-slate-50/80 rounded-xl border border-slate-200">
            {gemTypes.map((type) => {
                const selectedCount = selectedGems.filter(t => t === type).length;
                const effectiveCount = bank[type] - selectedCount;

                // Rule-based selectability
                let isSelectable = !!onGemClick && type !== 5; // Start with basic
                if (isSelectable) {
                    if (hasDoubleSelection) {
                        isSelectable = false; // Already took 2 of same color
                    } else if (selectedCount === 0) {
                        isSelectable = totalSelected < 3 && effectiveCount > 0;
                    } else if (selectedCount === 1) {
                        isSelectable = totalSelected === 1 && bank[type] >= 4;
                    } else {
                        isSelectable = false; // Already selected 2 of this color
                    }
                }

                return (
                    <div key={type} data-gem-bank={type}>
                        <GemToken
                            gemType={type}
                            count={effectiveCount}
                            selectedCount={selectedCount}
                            isSelectable={isSelectable}
                            isSelected={selectedCount > 0}
                            onClick={() => onGemClick?.(type)}
                            size="md"
                        />
                    </div>
                );
            })}
        </div>
    );
};

export default GemBank;
