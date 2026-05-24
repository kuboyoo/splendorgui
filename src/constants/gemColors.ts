// src/constants/gemColors.ts
// Color order: [White (Diamond), Blue (Sapphire), Green (Emerald), Red (Ruby), Black (Onyx), Gold]
export const GEM_COLORS = {
    0: { // Diamond (White)
        primary: '#F8FAFC',
        light: '#E2E8F0',
        dark: '#64748B',
        name: 'Diamond',
        symbol: 'D',
    },
    1: { // Sapphire (Blue)
        primary: '#3B82F6',
        light: '#BFDBFE',
        dark: '#1D4ED8',
        name: 'Sapphire',
        symbol: 'S',
    },
    2: { // Emerald (Green)
        primary: '#10B981',
        light: '#A7F3D0',
        dark: '#047857',
        name: 'Emerald',
        symbol: 'E',
    },
    3: { // Ruby (Red)
        primary: '#EF4444',
        light: '#FECACA',
        dark: '#B91C1C',
        name: 'Ruby',
        symbol: 'R',
    },
    4: { // Onyx (Black)
        primary: '#4B5563',
        light: '#9CA3AF',
        dark: '#374151',
        name: 'Onyx',
        symbol: 'O',
    },
    5: { // Gold
        primary: '#F59E0B',
        light: '#FDE68A',
        dark: '#D97706',
        name: 'Gold',
        symbol: 'G',
    },
} as const;

export const CARD_LEVEL_BG = {
    1: 'bg-emerald-50',
    2: 'bg-amber-50',
    3: 'bg-violet-50',
} as const;
