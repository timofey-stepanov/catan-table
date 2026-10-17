export const RESOURCES = {
  wood: {
    id: 'wood',
    name: 'Wood',
    terrain: 'Forest',
    emoji: '🌲',
    terrainEmoji: '🌲',
    color: '#2d6a4f',
    fillColor: '#40916c',
    strokeColor: '#1b4332'
  },
  brick: {
    id: 'brick',
    name: 'Brick',
    terrain: 'Hills',
    emoji: '🧱',
    terrainEmoji: '🧱',
    color: '#bc4749',
    fillColor: '#c95d39',
    strokeColor: '#78290f'
  },
  sheep: {
    id: 'sheep',
    name: 'Sheep',
    terrain: 'Pasture',
    emoji: '🐑',
    terrainEmoji: '🐑',
    color: '#70a9a1',
    fillColor: '#95d5b2',
    strokeColor: '#40916c'
  },
  wheat: {
    id: 'wheat',
    name: 'Wheat',
    terrain: 'Fields',
    emoji: '🌾',
    terrainEmoji: '🌾',
    color: '#e9c46a',
    fillColor: '#f4d35e',
    strokeColor: '#b5830d'
  },
  ore: {
    id: 'ore',
    name: 'Ore',
    terrain: 'Mountains',
    emoji: '⛰️',
    terrainEmoji: '⛰️',
    color: '#6c757d',
    fillColor: '#8d99ae',
    strokeColor: '#495057'
  }
};

export const RESOURCE_KEYS = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const DESERT_TERRAIN = {
  id: 'desert',
  name: 'Desert',
  emoji: '🏜️',
  fillColor: '#e6ccb2',
  strokeColor: '#b08968'
};

// Standard 19-hex Catan tile distribution
export const TILE_DISTRIBUTION = [
  'wood', 'wood', 'wood', 'wood',
  'sheep', 'sheep', 'sheep', 'sheep',
  'wheat', 'wheat', 'wheat', 'wheat',
  'brick', 'brick', 'brick',
  'ore', 'ore', 'ore',
  'desert'
];

// Standard 18 number tokens
export const NUMBER_TOKENS = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
];

// Pips (probability dots out of 36)
export const NUMBER_PIPS = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1
};

// Standard 9 Harbors (4 generic 3:1, 5 specific 2:1)
export const HARBOR_TYPES = [
  { type: 'any', ratio: 3, label: '3:1', emoji: '⚓' },
  { type: 'any', ratio: 3, label: '3:1', emoji: '⚓' },
  { type: 'any', ratio: 3, label: '3:1', emoji: '⚓' },
  { type: 'any', ratio: 3, label: '3:1', emoji: '⚓' },
  { type: 'wood', ratio: 2, label: '2:1', emoji: '🌲' },
  { type: 'brick', ratio: 2, label: '2:1', emoji: '🧱' },
  { type: 'sheep', ratio: 2, label: '2:1', emoji: '🐑' },
  { type: 'wheat', ratio: 2, label: '2:1', emoji: '🌾' },
  { type: 'ore', ratio: 2, label: '2:1', emoji: '⛰️' }
];

export const BUILD_COSTS = {
  road: { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 0 },
  city: { wood: 0, brick: 0, sheep: 0, wheat: 2, ore: 3 },
  devCard: { wood: 0, brick: 0, sheep: 1, wheat: 1, ore: 1 }
};

export const PIECE_LIMITS = {
  roads: 15,
  settlements: 5,
  cities: 4
};

export const DEV_CARD_INFO = {
  knight: {
    id: 'knight',
    name: 'Knight',
    emoji: '⚔️',
    shortDesc: 'Move Robber & steal 1 card',
    desc: 'Move the Robber to any hex and steal 1 random resource from an adjacent player. Counts toward Largest Army (3+ Knights = 2 VP).'
  },
  vp: {
    id: 'vp',
    name: 'Victory Point',
    emoji: '🏆',
    shortDesc: '+1 Secret Victory Point',
    desc: 'Grants +1 secret Victory Point! Automatically revealed when your total reaches 10 VP to win.'
  },
  roadBuilding: {
    id: 'roadBuilding',
    name: 'Road Building',
    emoji: '🛣️',
    shortDesc: 'Place 2 free Roads',
    desc: 'Immediately place up to 2 Roads on the board at no resource cost.'
  },
  yearOfPlenty: {
    id: 'yearOfPlenty',
    name: 'Year of Plenty',
    emoji: '🎁',
    shortDesc: 'Take any 2 resources from Bank',
    desc: 'Immediately take any 2 resource cards of your choice from the Bank.'
  },
  monopoly: {
    id: 'monopoly',
    name: 'Monopoly',
    emoji: '👑',
    shortDesc: 'Claim all of 1 resource type',
    desc: 'Name 1 resource type. All other players must give you all of their cards of that type!'
  }
};

// Standard 25 Development Card deck distribution
export const DEV_DECK_DISTRIBUTION = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('vp'),
  ...Array(2).fill('roadBuilding'),
  ...Array(2).fill('yearOfPlenty'),
  ...Array(2).fill('monopoly')
];

export const PLAYER_PRESETS = [
  {
    id: 0,
    defaultName: 'Red',
    emoji: '🔴',
    color: '#ef4444',
    darkColor: '#991b1b',
    lightColor: '#fee2e2',
    seat: 'bottom'
  },
  {
    id: 1,
    defaultName: 'Blue',
    emoji: '🔵',
    color: '#3b82f6',
    darkColor: '#1e40af',
    lightColor: '#dbeafe',
    seat: 'left'
  },
  {
    id: 2,
    defaultName: 'Orange',
    emoji: '🟠',
    color: '#f97316',
    darkColor: '#9a3412',
    lightColor: '#ffedd5',
    seat: 'top'
  },
  {
    id: 3,
    defaultName: 'Purple',
    emoji: '🟣',
    color: '#a855f7',
    darkColor: '#6b21a8',
    lightColor: '#f3e8ff',
    seat: 'right'
  }
];
