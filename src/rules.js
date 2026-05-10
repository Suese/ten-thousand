// Pure scoring logic for 10,000.
//
// Three of a kind: three 1s = 1000, three Ns (N>=2) = N*100.
// Singles outside a 3-of-a-kind: 1 = 100, 5 = 50.
// Hot dice: when ALL 5 dice are kept across a turn, the player rerolls all 5
// keeping their banked turn points.

export function rollHasScore(values) {
  const counts = countByFace(values);
  if (counts[1]) return true;
  if (counts[5]) return true;
  for (const f in counts) if (counts[f] >= 3) return true;
  return false;
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
      score += v === 1 ? 1000 : v * 100;
      c -= 3;
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
      score += v === 1 ? 1000 : v * 100;
      kept += 3;
      c -= 3;
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
