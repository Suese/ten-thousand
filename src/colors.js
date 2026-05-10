// Per-player palette. Max 8 players. Index in state.players => color.
export const PLAYER_COLORS = [
  '#ffd400', // gold
  '#b85cff', // purple
  '#5cd66b', // green
  '#c8d2e0', // silver
  '#ff4757', // red
  '#5a8cff', // blue
  '#ff5cd6', // pink
  '#ff8c2b', // orange
];

export const MAX_PLAYERS = PLAYER_COLORS.length;

export function colorForPlayer(state, playerId) {
  if (!state?.players) return PLAYER_COLORS[0];
  const idx = state.players.findIndex(p => p.id === playerId);
  if (idx < 0) return PLAYER_COLORS[0];
  return PLAYER_COLORS[idx % PLAYER_COLORS.length];
}

export function colorHexForPlayer(state, playerId) {
  return parseInt(colorForPlayer(state, playerId).slice(1), 16);
}
