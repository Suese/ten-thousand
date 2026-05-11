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
    cost: 100,
    desc: 'Click an un-locked die to weight it toward 1 (or pick at random pre-roll). The bias only catches if the die has enough momentum.',
    when: 'anytime',
    needsAim: 'die',
  },
  portable_hole: {
    name: 'Portable Hole',
    icon: '🕳️',
    cost: 300,
    desc: "Suck a random un-locked die into the void. It comes back after one roll.",
    when: 'anytime',
  },
  flick: {
    name: 'Flick',
    icon: '👆',
    cost: 100,
    desc: "Click any un-locked die to send it tumbling. Aim where you want.",
    when: 'anytime',
    needsAim: 'die',
  },
  dookie: {
    name: 'Dookie Throw',
    icon: '💩',
    cost: 75,
    desc: "Aim and click anywhere on the table — splatters 7 sticky blobs in a shotgun spread.",
    when: 'anytime',
    needsAim: 'point',
  },
  ice_rink: {
    name: 'Ice Rink',
    icon: '🧊',
    cost: 150,
    desc: 'Turn the felt into a sheet of ice — dice slide and bounce forever, much easier to flick.',
    when: 'anytime',
  },
  tornado: {
    name: 'Tornado',
    icon: '🌪️',
    cost: 250,
    desc: 'Click any un-locked die to spin it into a tornado that knocks the other dice all over the table.',
    when: 'anytime',
    needsAim: 'die',
  },
};

export function isUsable(item, { phase, isMyTurn }) {
  switch (item.when) {
    case 'own_pre_roll':      return phase === 'awaiting_roll' && isMyTurn;
    case 'opp_pre_roll':      return phase === 'awaiting_roll' && !isMyTurn;
    case 'opp_awaiting_keep': return phase === 'awaiting_keep' && !isMyTurn;
    case 'anytime':           return phase === 'awaiting_roll' || phase === 'awaiting_keep' || phase === 'rolling' || phase === 'busted';
  }
  return false;
}
