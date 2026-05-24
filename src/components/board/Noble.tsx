'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { GEM_COLORS } from '@/constants/gemColors';
import { NobleData, GemType } from '@/types/game';

interface NobleProps {
    noble: NobleData;
    isSelectable?: boolean;
    isHighlighted?: boolean;
    isAnnotationSelected?: boolean;
    onClick?: () => void;
    onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
    annotationId?: string;
    size?: 'sm' | 'md' | 'lg';
}

const Noble: React.FC<NobleProps> = ({
    noble,
    isSelectable = false,
    isHighlighted = false,
    isAnnotationSelected = false,
    onClick,
    onContextMenu,
    annotationId,
    size = 'md',
}) => {
    const sizeClasses = {
        sm: 'w-24 h-24 p-2',
        md: 'w-32 h-32 p-3',
        lg: 'w-40 h-40 p-4',
    };

    return (
        <motion.div
            whileHover={isSelectable ? { scale: 1.05 } : {}}
            whileTap={isSelectable ? { scale: 0.95 } : {}}
            onClick={isSelectable ? onClick : undefined}
            onContextMenu={onContextMenu}
            data-annot-id={annotationId}
            className={`
        relative rounded-xl border-2 flex flex-col items-center justify-between shadow-md transition-all
        ${sizeClasses[size]}
        ${isSelectable ? 'cursor-pointer' : 'cursor-default'}
        ${isHighlighted ? 'animate-pulse-glow border-blue-400 ring-2 ring-blue-200' : ''}
        ${isAnnotationSelected ? 'outline outline-4 outline-lime-500 outline-offset-2' : ''}
      `}
            style={!isHighlighted ? {
                background: 'linear-gradient(135deg, #32363f 0%, #2a2e36 100%)',
                borderColor: '#52525b',
            } : undefined}
        >
            <div className="flex items-center gap-1 w-full">
                <Crown className="text-yellow-600" size={size === 'sm' ? 14 : 18} />
                <span className="font-bold text-xl leading-none text-slate-800">{noble.points}</span>
            </div>

            <div className="flex flex-col gap-1.5 w-full items-start mt-2">
                {noble.requirement.map((amount, index) => {
                    if (amount === 0) return null;
                    const reqGem = GEM_COLORS[index as GemType];
                    return (
                        <div
                            key={index}
                            className="flex items-center gap-2 group"
                            title={`${amount} ${reqGem.name} bonuses required`}
                        >
                            <div
                                className="w-5 h-5 rounded-sm shadow-sm"
                                style={{ backgroundColor: reqGem.primary }}
                            />
                            <span className="font-bold text-sm leading-none text-slate-700">{amount}</span>
                        </div>
                    );
                })}
            </div>
        </motion.div>
    );
};

export default Noble;
