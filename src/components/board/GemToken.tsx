'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Gem, Coins } from 'lucide-react';
import { GEM_COLORS } from '@/constants/gemColors';
import { GemType } from '@/types/game';

interface GemTokenProps {
    gemType: GemType;
    count: number;
    isSelectable?: boolean;
    isSelected?: boolean;
    selectedCount?: number;
    onClick?: () => void;
    showCount?: boolean;
    size?: 'sm' | 'md' | 'lg';
    returnedCount?: number;
}

const GemToken: React.FC<GemTokenProps> = ({
    gemType,
    count,
    isSelectable = false,
    isSelected = false,
    selectedCount = 0,
    onClick,
    showCount = true,
    size = 'md',
    returnedCount = 0,
}) => {
    const color = GEM_COLORS[gemType];

    const sizeClasses = {
        sm: 'w-8 h-8 text-xs',
        md: 'w-12 h-12 text-sm',
        lg: 'w-16 h-16 text-base',
    };

    const Icon = gemType === 5 ? Coins : Gem;

    return (
        <motion.div
            whileHover={isSelectable ? { scale: 1.05 } : {}}
            whileTap={isSelectable ? { scale: 0.95 } : {}}
            onClick={isSelectable ? onClick : undefined}
            className={`
        relative flex items-center justify-center rounded-full border-2 
        ${sizeClasses[size]}
        ${isSelectable ? 'cursor-pointer hover:scale-105 shadow-lg' : 'cursor-default'}
        ${isSelected ? 'ring-4 ring-yellow-400 ring-offset-2' : ''}
        transition-all shadow-md
      `}
            style={{
                backgroundColor: color.primary,
                borderColor: color.dark,
                color: gemType === 0 ? '#333' : '#fff', // Diamond (0) gets dark text
            }}
        >
            <Icon size={size === 'sm' ? 16 : (size === 'md' ? 24 : 32)} />

            {showCount && (
                <div
                    className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shadow-sm"
                    style={{
                        backgroundColor: '#F8FAFC',
                        color: '#111827',
                        border: '1px solid #9CA3AF',
                    }}
                >
                    {count}
                </div>
            )}

            {selectedCount > 0 && (
                <div
                    className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black shadow-md animate-in zoom-in-50 duration-200"
                    style={{
                        backgroundColor: '#FACC15',
                        color: '#111827',
                        border: '2px solid #F8FAFC',
                    }}
                >
                    +{selectedCount}
                </div>
            )}

            {returnedCount > 0 && (
                <div
                    className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black shadow-md animate-in zoom-in-50 duration-200"
                    style={{
                        backgroundColor: '#EF4444',
                        color: '#FFFFFF',
                        border: '2px solid #F8FAFC',
                    }}
                >
                    -{returnedCount}
                </div>
            )}
        </motion.div>
    );
};

export default GemToken;
