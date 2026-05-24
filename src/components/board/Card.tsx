'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Gem } from 'lucide-react';
import { GEM_COLORS } from '@/constants/gemColors';
import { CardData, GemType } from '@/types/game';

interface CardProps {
    card: CardData | null;
    isSelectable?: boolean;
    isHighlighted?: boolean;
    isSelected?: boolean;
    onClick?: () => void;
    size?: 'sm' | 'md' | 'lg' | 'xs';
}

const Card: React.FC<CardProps> = ({
    card,
    isSelectable = false,
    isHighlighted = false,
    isSelected = false,
    onClick,
    size = 'md',
}) => {
    const bonusColor = card ? GEM_COLORS[card.bonus] : GEM_COLORS[0]; // Fallback for loading/empty
    const cardSurfaceByBonus: Record<GemType, string> = {
        0: '#E2E8F0',
        1: '#BFDBFE',
        2: '#A7F3D0',
        3: '#FECACA',
        4: '#9CA3AF',
        5: '#FDE68A',
    };

    if (!card) {
        return (
            <motion.div
                whileHover={isSelectable ? { y: -4, scale: 1.02 } : {}}
                whileTap={isSelectable ? { scale: 0.98 } : {}}
                onClick={isSelectable ? onClick : undefined}
                className={`
        ${size === 'xs' ? 'w-14 h-20' : (size === 'sm' ? 'w-24 h-32' : (size === 'md' ? 'w-32 h-44' : 'w-40 h-56'))}
        group border-2 border-dashed rounded-xl flex items-center justify-center transition-all
        ${isSelectable ? 'cursor-pointer border-indigo-300 bg-indigo-50/40 hover:border-indigo-400 hover:border-solid' : 'cursor-default border-gray-300 bg-gray-50/50'}
        ${isSelected ? 'ring-4 ring-amber-400 ring-offset-2 border-amber-400' : ''}
      `}
            >
                <div
                    className={`w-8 h-8 rounded-full border-2 border-dashed transition-all ${isSelectable ? 'border-indigo-300 group-hover:border-indigo-400 group-hover:border-solid' : 'border-gray-300'}`}
                />
            </motion.div>
        );
    }

    const Icon = Gem;

    const sizeClasses = {
        xs: 'w-14 h-20 text-[6px]',
        sm: 'w-24 h-32 text-xs',
        md: 'w-32 h-44 text-sm',
        lg: 'w-40 h-56 text-base',
    };

    return (
        <motion.div
            whileHover={isSelectable ? { y: -5, scale: 1.02, zIndex: 10 } : {}}
            whileTap={isSelectable ? { scale: 0.98 } : {}}
            onClick={isSelectable ? onClick : undefined}
            className={`
        relative rounded-xl border-2 shadow-sm overflow-hidden flex flex-col justify-between
        ${sizeClasses[size]}
        ${isSelectable ? 'cursor-pointer' : 'cursor-default'}
        ${isSelected ? 'ring-4 ring-amber-400 ring-offset-2 border-amber-400' : ''}
        ${isHighlighted ? 'animate-pulse-glow border-blue-400' : ''}
        transition-all
      `}
            style={{
                backgroundColor: cardSurfaceByBonus[card.bonus],
                borderColor: isSelected ? undefined : bonusColor.dark,
            }}
        >
            {/* Top Bar: Points and Bonus */}
            <div className={`flex justify-between items-start ${size === 'xs' ? 'p-1' : 'p-2'} z-10`}>
                <div
                    className={`font-bold ${size === 'xs' ? 'text-[10px]' : 'text-2xl'} drop-shadow-sm`}
                    style={{ color: card.bonus === 4 ? '#F8FAFC' : '#0F172A' }}
                >
                    {card.points > 0 ? card.points : ''}
                </div>
                <div
                    className={`${size === 'xs' ? 'p-0.5 rounded' : 'p-1 rounded-lg'} shadow-md shadow-black/10`}
                    style={card.bonus === 0
                        ? { backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1' }
                        : { backgroundColor: bonusColor.primary }
                    }
                >
                    <Icon
                        size={size === 'xs' ? 10 : (size === 'sm' ? 20 : 28)}
                        style={{ color: card.bonus === 0 ? bonusColor.dark : '#FFFFFF' }}
                    />
                </div>
            </div>

            {/* Center: Large Faded Icon */}
            <div className="absolute inset-0 flex items-center justify-center opacity-[0.05] pointer-events-none">
                <Icon size={size === 'xs' ? 30 : (size === 'sm' ? 60 : 100)} style={{ color: bonusColor.dark }} />
            </div>

            {/* Bottom: Cost */}
            <div className={`${size === 'xs' ? 'p-1 gap-1' : 'p-2 gap-1.5'} flex flex-wrap items-end justify-start z-10`}>
                {card.cost.map((amount, index) => {
                    if (amount === 0) return null;
                    const costGem = GEM_COLORS[index as GemType];
                    const isWhiteGem = index === 0; // Diamond (0) only

                    return (
                        <div
                            key={index}
                            className={`
                ${size === 'xs' ? 'w-3.5 h-3.5 border' : 'w-7 h-7 border-2'} 
                rounded-full flex items-center justify-center border-white/80 shadow-sm
              `}
                            style={{ backgroundColor: costGem.primary }}
                            title={costGem.name}
                        >
                            <span
                                className={`font-bold ${size === 'xs' ? 'text-[7px]' : 'text-sm'} leading-none`}
                                style={{
                                    color: isWhiteGem ? '#111827' : '#FFFFFF',
                                    textShadow: isWhiteGem ? 'none' : '0 1px 1px rgba(0,0,0,0.3)',
                                }}
                            >
                                {amount}
                            </span>
                        </div>
                    );
                })}
            </div>
        </motion.div>
    );
};

export default Card;
