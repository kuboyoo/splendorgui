'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface WinRateBarProps {
    player0Rate: number;
    player1Rate: number;
    isEnabled: boolean;
    player0Name?: string;
    player1Name?: string;
}

const WinRateBar: React.FC<WinRateBarProps> = ({
    player0Rate,
    player1Rate,
    isEnabled,
    player0Name = 'Player 0',
    player1Name = 'Player 1',
}) => {
    if (!isEnabled) {
        return (
            <div className="w-full h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 text-sm font-medium border border-gray-300">
                AI Analysis is OFF
            </div>
        );
    }

    return (
        <div className="w-full flex flex-col gap-1">
            <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-slate-500 px-2">
                <span>{player0Name}</span>
                <span>{player1Name}</span>
            </div>
            <div className="relative w-full h-8 bg-slate-200 rounded-full overflow-hidden flex border border-slate-300 shadow-inner">
                <motion.div
                    initial={{ width: '50%' }}
                    animate={{ width: `${player0Rate}%` }}
                    transition={{ type: 'spring', stiffness: 50, damping: 15 }}
                    className="h-full bg-blue-500 flex items-center justify-start pl-4"
                >
                    <span className="text-white font-bold text-sm">{Math.round(player0Rate)}%</span>
                </motion.div>
                <motion.div
                    initial={{ width: '50%' }}
                    animate={{ width: `${player1Rate}%` }}
                    transition={{ type: 'spring', stiffness: 50, damping: 15 }}
                    className="h-full bg-slate-400 flex items-center justify-end pr-4 flex-1"
                >
                    <span className="text-white font-bold text-sm">{Math.round(player1Rate)}%</span>
                </motion.div>

                {/* Center line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/30 -translate-x-1/2" />
            </div>
        </div>
    );
};

export default WinRateBar;
