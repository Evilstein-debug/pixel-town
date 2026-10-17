// Fixed limited palette for all procedural art (~16 colours + per-agent tints).
export const PAL = {
  ink: '#1f2a26',
  grassDark: '#3f8a3c',
  grass: '#5dae48',
  grassLight: '#83c95a',
  grassPale: '#a9dd73',
  dirt: '#d2a466',
  dirtDark: '#a97a45',
  stone: '#c9c2b0',
  stoneDark: '#9c9483',
  waterDark: '#3a7cc2',
  water: '#58a8e6',
  waterLight: '#aee0f7',
  wood: '#8a5a34',
  woodLight: '#b98049',
  cream: '#f6ecc9',
  plank: '#e6c690',
  plankDark: '#c39a5f',
  brick: '#a8553f',
  brickDark: '#73352a',
  brickLight: '#cf7a58',
  red: '#d9534f',
  yellow: '#f4d04c',
  white: '#fbfaf2',
} as const;

export type PalColor = (typeof PAL)[keyof typeof PAL];
