// Shop item registry.
// `when` controls the phase predicate used to enable the "use" button:
//   own_pre_roll       - your turn, awaiting_roll
//   opp_pre_roll       - someone else's turn, awaiting_roll
//   opp_awaiting_keep  - someone else's turn, just settled
//   anytime            - any active game phase, on or off your turn

export const ITEMS = {
  weighted: {
    name: 'Weighted Die',
    icon: '🎲',
    cost: 200,
    desc: 'After your next roll, one un-locked die is forced to 1.',
    when: 'own_pre_roll',
  },
  portable_hole: {
    name: 'Portable Hole',
    icon: '🕳️',
    cost: 500,
    desc: "Suck a random un-locked die into the void. It comes back after one roll.",
    when: 'anytime',
  },
  flick: {
    name: 'Flick',
    icon: '👆',
    cost: 700,
    desc: "Click any un-locked die to send it tumbling. Aim where you want.",
    when: 'anytime',
    needsAim: 'die',
  },
  dookie: {
    name: 'Dookie Throw',
    icon: '💩',
    cost: 1200,
    desc: "Aim and click anywhere on the table to splat a sticky blob there. Gums up any dice that touch it.",
    when: 'anytime',
    needsAim: 'point',
  },
  ice_rink: {
    name: 'Ice Rink',
    icon: '🧊',
    cost: 900,
    desc: 'Turn the felt into a sheet of ice for the rest of the turn — dice slide forever.',
    when: 'anytime',
  },
  saw_blade: {
    name: 'Saw Blade',
    icon: '🪚',
    cost: 2000,
    desc: 'A random opponent die becomes a chainsaw of doom. Can miss. Destroys the saw die.',
    when: 'opp_awaiting_keep',
  },
};

export function isUsable(item, { phase, isMyTurn }) {
  switch (item.when) {
    case 'own_pre_roll':      return phase === 'awaiting_roll' && isMyTurn;
    case 'opp_pre_roll':      return phase === 'awaiting_roll' && !isMyTurn;
    case 'opp_awaiting_keep': return phase === 'awaiting_keep' && !isMyTurn;
    case 'anytime':           return phase !== 'lobby' && phase !== 'game_over' && phase !== 'opening_roll';
  }
  return false;
}
