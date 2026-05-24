import { CardData, NobleData } from '../types/game';

// Nobles - 12 total
// Requirement order: [White (D), Blue (S), Green (E), Red (R), Black (O)]
export const NOBLES: NobleData[] = [
    { id: 0, points: 3, requirement: [0, 0, 4, 4, 0] },   // Green, Red
    { id: 1, points: 3, requirement: [0, 0, 0, 4, 4] },   // Red, Black
    { id: 2, points: 3, requirement: [0, 4, 4, 0, 0] },   // Blue, Green
    { id: 3, points: 3, requirement: [4, 0, 0, 0, 4] },   // White, Black
    { id: 4, points: 3, requirement: [4, 4, 0, 0, 0] },   // White, Blue
    { id: 5, points: 3, requirement: [4, 0, 0, 4, 0] },   // White, Red
    { id: 6, points: 3, requirement: [3, 0, 0, 3, 3] },   // White, Red, Black
    { id: 7, points: 3, requirement: [3, 3, 3, 0, 0] },   // White, Blue, Green
    { id: 8, points: 3, requirement: [0, 0, 3, 3, 3] },   // Green, Red, Black
    { id: 9, points: 3, requirement: [0, 3, 3, 3, 0] },   // Blue, Green, Red
    { id: 10, points: 3, requirement: [3, 3, 0, 0, 3] },  // White, Blue, Black
    { id: 11, points: 3, requirement: [0, 3, 3, 0, 3] },  // Blue, Green, Black
];

// Cards - 90 total
// Cost order: [White (D), Blue (S), Green (E), Red (R), Black (O)]
// Bonus: 0=Diamond, 1=Sapphire, 2=Emerald, 3=Ruby, 4=Onyx
export const CARDS: CardData[] = [
    // Level 1 - Sapphire bonus (8 cards, id 0-7)
    { id: 0, level: 1, points: 0, bonus: 1, cost: [0, 0, 0, 0, 3] },
    { id: 1, level: 1, points: 0, bonus: 1, cost: [1, 0, 0, 0, 2] },
    { id: 2, level: 1, points: 0, bonus: 1, cost: [0, 0, 2, 0, 2] },
    { id: 3, level: 1, points: 0, bonus: 1, cost: [1, 0, 2, 2, 0] },
    { id: 4, level: 1, points: 0, bonus: 1, cost: [0, 1, 3, 1, 0] },
    { id: 5, level: 1, points: 0, bonus: 1, cost: [1, 0, 1, 1, 1] },
    { id: 6, level: 1, points: 0, bonus: 1, cost: [1, 0, 1, 2, 1] },
    { id: 7, level: 1, points: 1, bonus: 1, cost: [0, 0, 0, 4, 0] },

    // Level 1 - Ruby bonus (8 cards, id 8-15)
    { id: 8, level: 1, points: 0, bonus: 3, cost: [3, 0, 0, 0, 0] },
    { id: 9, level: 1, points: 0, bonus: 3, cost: [0, 2, 1, 0, 0] },
    { id: 10, level: 1, points: 0, bonus: 3, cost: [2, 0, 0, 2, 0] },
    { id: 11, level: 1, points: 0, bonus: 3, cost: [2, 0, 1, 0, 2] },
    { id: 12, level: 1, points: 0, bonus: 3, cost: [1, 0, 0, 1, 3] },
    { id: 13, level: 1, points: 0, bonus: 3, cost: [1, 1, 1, 0, 1] },
    { id: 14, level: 1, points: 0, bonus: 3, cost: [2, 1, 1, 0, 1] },
    { id: 15, level: 1, points: 1, bonus: 3, cost: [4, 0, 0, 0, 0] },

    // Level 1 - Onyx bonus (8 cards, id 16-23)
    { id: 16, level: 1, points: 0, bonus: 4, cost: [0, 0, 3, 0, 0] },
    { id: 17, level: 1, points: 0, bonus: 4, cost: [0, 0, 2, 1, 0] },
    { id: 18, level: 1, points: 0, bonus: 4, cost: [2, 0, 2, 0, 0] },
    { id: 19, level: 1, points: 0, bonus: 4, cost: [2, 2, 0, 1, 0] },
    { id: 20, level: 1, points: 0, bonus: 4, cost: [0, 0, 1, 3, 1] },
    { id: 21, level: 1, points: 0, bonus: 4, cost: [1, 1, 1, 1, 0] },
    { id: 22, level: 1, points: 0, bonus: 4, cost: [1, 2, 1, 1, 0] },
    { id: 23, level: 1, points: 1, bonus: 4, cost: [0, 4, 0, 0, 0] },

    // Level 1 - Diamond bonus (8 cards, id 24-31)
    { id: 24, level: 1, points: 0, bonus: 0, cost: [0, 3, 0, 0, 0] },
    { id: 25, level: 1, points: 0, bonus: 0, cost: [0, 0, 0, 2, 1] },
    { id: 26, level: 1, points: 0, bonus: 0, cost: [0, 2, 0, 0, 2] },
    { id: 27, level: 1, points: 0, bonus: 0, cost: [0, 2, 2, 0, 1] },
    { id: 28, level: 1, points: 0, bonus: 0, cost: [3, 1, 0, 0, 1] },
    { id: 29, level: 1, points: 0, bonus: 0, cost: [0, 1, 1, 1, 1] },
    { id: 30, level: 1, points: 0, bonus: 0, cost: [0, 1, 2, 1, 1] },
    { id: 31, level: 1, points: 1, bonus: 0, cost: [0, 0, 4, 0, 0] },

    // Level 1 - Emerald bonus (8 cards, id 32-39)
    { id: 32, level: 1, points: 0, bonus: 2, cost: [0, 0, 0, 3, 0] },
    { id: 33, level: 1, points: 0, bonus: 2, cost: [2, 1, 0, 0, 0] },
    { id: 34, level: 1, points: 0, bonus: 2, cost: [0, 2, 0, 2, 0] },
    { id: 35, level: 1, points: 0, bonus: 2, cost: [0, 1, 0, 2, 2] },
    { id: 36, level: 1, points: 0, bonus: 2, cost: [1, 3, 1, 0, 0] },
    { id: 37, level: 1, points: 0, bonus: 2, cost: [1, 1, 0, 1, 1] },
    { id: 38, level: 1, points: 0, bonus: 2, cost: [1, 1, 0, 1, 2] },
    { id: 39, level: 1, points: 1, bonus: 2, cost: [0, 0, 0, 0, 4] },

    // Level 2 - Sapphire bonus (6 cards, id 40-45)
    { id: 40, level: 2, points: 1, bonus: 1, cost: [0, 2, 2, 3, 0] },
    { id: 41, level: 2, points: 1, bonus: 1, cost: [0, 2, 3, 0, 3] },
    { id: 42, level: 2, points: 2, bonus: 1, cost: [0, 5, 0, 0, 0] },
    { id: 43, level: 2, points: 2, bonus: 1, cost: [5, 3, 0, 0, 0] },
    { id: 44, level: 2, points: 2, bonus: 1, cost: [2, 0, 0, 1, 4] },
    { id: 45, level: 2, points: 3, bonus: 1, cost: [0, 6, 0, 0, 0] },

    // Level 2 - Ruby bonus (6 cards, id 46-51)
    { id: 46, level: 2, points: 1, bonus: 3, cost: [2, 0, 0, 2, 3] },
    { id: 47, level: 2, points: 1, bonus: 3, cost: [0, 3, 0, 2, 3] },
    { id: 48, level: 2, points: 2, bonus: 3, cost: [0, 0, 0, 0, 5] },
    { id: 49, level: 2, points: 2, bonus: 3, cost: [3, 0, 0, 0, 5] },
    { id: 50, level: 2, points: 2, bonus: 3, cost: [1, 4, 2, 0, 0] },
    { id: 51, level: 2, points: 3, bonus: 3, cost: [0, 0, 0, 6, 0] },

    // Level 2 - Onyx bonus (6 cards, id 52-57)
    { id: 52, level: 2, points: 1, bonus: 4, cost: [3, 2, 2, 0, 0] },
    { id: 53, level: 2, points: 1, bonus: 4, cost: [3, 0, 3, 0, 2] },
    { id: 54, level: 2, points: 2, bonus: 4, cost: [5, 0, 0, 0, 0] },
    { id: 55, level: 2, points: 2, bonus: 4, cost: [0, 0, 5, 3, 0] },
    { id: 56, level: 2, points: 2, bonus: 4, cost: [0, 1, 4, 2, 0] },
    { id: 57, level: 2, points: 3, bonus: 4, cost: [0, 0, 0, 0, 6] },

    // Level 2 - Diamond bonus (6 cards, id 58-63)
    { id: 58, level: 2, points: 1, bonus: 0, cost: [0, 0, 3, 2, 2] },
    { id: 59, level: 2, points: 1, bonus: 0, cost: [2, 3, 0, 3, 0] },
    { id: 60, level: 2, points: 2, bonus: 0, cost: [0, 0, 0, 5, 0] },
    { id: 61, level: 2, points: 2, bonus: 0, cost: [0, 0, 0, 5, 3] },
    { id: 62, level: 2, points: 2, bonus: 0, cost: [0, 0, 1, 4, 2] },
    { id: 63, level: 2, points: 3, bonus: 0, cost: [6, 0, 0, 0, 0] },

    // Level 2 - Emerald bonus (6 cards, id 64-69)
    { id: 64, level: 2, points: 1, bonus: 2, cost: [2, 3, 0, 0, 2] },
    { id: 65, level: 2, points: 1, bonus: 2, cost: [3, 0, 2, 3, 0] },
    { id: 66, level: 2, points: 2, bonus: 2, cost: [0, 0, 5, 0, 0] },
    { id: 67, level: 2, points: 2, bonus: 2, cost: [0, 5, 3, 0, 0] },
    { id: 68, level: 2, points: 2, bonus: 2, cost: [4, 2, 0, 0, 1] },
    { id: 69, level: 2, points: 3, bonus: 2, cost: [0, 0, 6, 0, 0] },

    // Level 3 - Sapphire bonus (4 cards, id 70-73)
    { id: 70, level: 3, points: 3, bonus: 1, cost: [3, 0, 3, 3, 5] },
    { id: 71, level: 3, points: 4, bonus: 1, cost: [7, 0, 0, 0, 0] },
    { id: 72, level: 3, points: 4, bonus: 1, cost: [6, 3, 0, 0, 3] },
    { id: 73, level: 3, points: 5, bonus: 1, cost: [7, 3, 0, 0, 0] },

    // Level 3 - Ruby bonus (4 cards, id 74-77)
    { id: 74, level: 3, points: 3, bonus: 3, cost: [3, 5, 3, 0, 3] },
    { id: 75, level: 3, points: 4, bonus: 3, cost: [0, 0, 7, 0, 0] },
    { id: 76, level: 3, points: 4, bonus: 3, cost: [0, 3, 6, 3, 0] },
    { id: 77, level: 3, points: 5, bonus: 3, cost: [0, 0, 7, 3, 0] },

    // Level 3 - Onyx bonus (4 cards, id 78-81)
    { id: 78, level: 3, points: 3, bonus: 4, cost: [3, 3, 5, 3, 0] },
    { id: 79, level: 3, points: 4, bonus: 4, cost: [0, 0, 0, 7, 0] },
    { id: 80, level: 3, points: 4, bonus: 4, cost: [0, 0, 3, 6, 3] },
    { id: 81, level: 3, points: 5, bonus: 4, cost: [0, 0, 0, 7, 3] },

    // Level 3 - Diamond bonus (4 cards, id 82-85)
    { id: 82, level: 3, points: 3, bonus: 0, cost: [0, 3, 3, 5, 3] },
    { id: 83, level: 3, points: 4, bonus: 0, cost: [0, 0, 0, 0, 7] },
    { id: 84, level: 3, points: 4, bonus: 0, cost: [3, 0, 0, 3, 6] },
    { id: 85, level: 3, points: 5, bonus: 0, cost: [3, 0, 0, 0, 7] },

    // Level 3 - Emerald bonus (4 cards, id 86-89)
    { id: 86, level: 3, points: 3, bonus: 2, cost: [5, 3, 0, 3, 3] },
    { id: 87, level: 3, points: 4, bonus: 2, cost: [0, 7, 0, 0, 0] },
    { id: 88, level: 3, points: 4, bonus: 2, cost: [3, 6, 3, 0, 0] },
    { id: 89, level: 3, points: 5, bonus: 2, cost: [0, 7, 3, 0, 0] },
];

export const getNobleById = (id: number): NobleData => {
    const noble = NOBLES.find((n) => n.id === id);
    if (!noble) throw new Error(`Noble with id ${id} not found`);
    return noble;
};

export const getCardById = (id: number): CardData => {
    const card = CARDS.find((c) => c.id === id);
    if (!card) throw new Error(`Card with id ${id} not found`);
    return card;
};
