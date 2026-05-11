// Pure scoring logic for 10,000.
//
// Of-a-kind values:
//   3 of a kind: three 1s = 1000, three Ns (N>=2) = N*100.
//   4 of a kind: double the 3-of-a-kind value (four 1s = 2000, four Ns = N*200).
//   5 of a kind: five 1s = 5000, five Ns (N>=2) = N*500.
// Singles outside an of-a-kind: 1 = 100, 5 = 50.
// Hot dice: when ALL 5 dice are kept across a turn, the player rerolls all 5
// keeping their banked turn points.

export function rollHasScore(values) {
  const counts = countByFace(values);
  if (counts[1]) return true;
  if (counts[5]) return true;
  for (const f in counts) if (counts[f] >= 3) return true;
  return false;
}

// Of-a-kind value for `count` dice all showing face `v`. Returns 0 if count < 3.
function ofAKindValue(v, count) {
  if (count >= 5) return v === 1 ? 5000 : v * 500;
  if (count === 4) return v === 1 ? 2000 : v * 200;
  if (count === 3) return v === 1 ? 1000 : v * 100;
  return 0;
}

// Validate a player's chosen kept-subset and compute its score.
// Returns { valid, score, reason? }.
export function evaluateKeep(keptValues) {
  if (!keptValues.length) return { valid: false, score: 0, reason: 'Select at least one die' };
  const counts = countByFace(keptValues);
  let score = 0;
  for (const face in counts) {
    const v = +face;
    let c = counts[v];
    if (c >= 3) {
      // Take the of-a-kind (3, 4, or 5) as a single group.
      score += ofAKindValue(v, c);
      c = 0;
    }
    if (c > 0) {
      if (v === 1) score += c * 100;
      else if (v === 5) score += c * 50;
      else return { valid: false, score: 0, reason: `${c}× ${v} cannot be kept` };
    }
  }
  return { valid: true, score };
}

// Greedy "best score if you kept everything that could score".
export function bestPossibleScore(rolledValues) {
  const counts = countByFace(rolledValues);
  let score = 0;
  let kept = 0;
  for (const face in counts) {
    const v = +face;
    let c = counts[v];
    if (c >= 3) {
      score += ofAKindValue(v, c);
      kept += c;
      c = 0;
    }
    if (c > 0) {
      if (v === 1) { score += c * 100; kept += c; }
      else if (v === 5) { score += c * 50; kept += c; }
    }
  }
  return { score, kept };
}

function countByFace(values) {
  const c = {};
  for (const v of values) c[v] = (c[v] || 0) + 1;
  return c;
}
