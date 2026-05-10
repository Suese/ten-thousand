import { DicePhysics } from './physics.js';
import { evaluateKeep, rollHasScore } from './rules.js';

const WIN_SCORE = 10000;

// Authoritative game-state machine. Lives only on the host.
//
// Phases:
//   lobby          — players joining, host can start
//   opening_roll   — each player rolls one die to decide first; ties re-roll
//   awaiting_roll  — current player must press Roll to begin / continue turn
//   rolling        — physics in progress
//   awaiting_keep  — dice settled; player picks scoring dice and chooses bank vs reroll
//   busted         — brief pause then turn ends with 0 banked
//   game_over
export class GameRoom {
  constructor({ onState, onEvent }) {
    this.onState = onState;
    this.onEvent = onEvent;

    this.physics = new DicePhysics();
    this.players = [];           // [{id, name}]
    this.totalScores = {};       // id -> total banked
    this.phase = 'lobby';
    this.hostId = null;

    this.order = [];             // turn order (player ids)
    this.currentIdx = 0;

    this.diceState = [];         // [{value, locked}] — locked = kept this turn
    this.turnPoints = 0;

    // Opening-roll state
    this.openingPending = [];    // ids still to roll this opening round
    this.openingResults = {};    // id -> die value
    this.openingActiveId = null;

    // Final round
    this.finalTriggeredBy = null;
    this.finalRemaining = [];

    this.broadcastTimer = 0;
    this.streaming = false;
  }

  setHostId(id) { this.hostId = id; }

  handleAction(fromId, action) {
    if (!action || typeof action !== 'object') return;
    switch (action.name) {
      case 'set_name':    this.setName(fromId, action.value); break;
      case 'start_game':  this.startGame(fromId); break;
      case 'request_roll': this.requestRoll(fromId); break;
      case 'commit':      this.commit(fromId, action.action, action.indices); break;
      case 'rematch':     this.rematch(fromId); break;
    }
  }

  addPlayer(id, name) {
    if (this.players.find(p => p.id === id)) return false;
    name = (name || 'Player').slice(0, 16);
    this.players.push({ id, name });
    this.totalScores[id] = 0;
    // Hot-join: if the rotation has already been built, append them to the end.
    // (During opening_roll, this.order is still empty — resolveOpeningRoll picks up
    //  whoever is in this.players at that moment.)
    if (this.order.length > 0 && !this.order.includes(id)) {
      this.order.push(id);
    }
    if (this.phase !== 'lobby') {
      this.emitEvent({ type: 'log', text: `${name} joined.` });
    }
    this.emitState();
    return true;
  }

  getCurrentTransforms() {
    return this.physics.getTransforms();
  }

  setName(id, name) {
    const p = this.players.find(p => p.id === id);
    if (p && name) {
      p.name = name.slice(0, 16);
      this.emitState();
    }
  }

  removePlayer(id) {
    const wasInOrder = this.order.includes(id);
    this.players = this.players.filter(p => p.id !== id);
    delete this.totalScores[id];
    if (this.phase === 'lobby') { this.emitState(); return; }
    if (!wasInOrder) { this.emitState(); return; }

    const wasCurrent = this.order[this.currentIdx] === id;
    this.order = this.order.filter(p => p !== id);
    this.finalRemaining = this.finalRemaining.filter(p => p !== id);

    if (this.order.length === 0) {
      this.phase = 'game_over';
      this.emitEvent({ type: 'log', text: 'All other players left.' });
      this.emitState();
      return;
    }
    if (this.currentIdx >= this.order.length) this.currentIdx = 0;
    if (wasCurrent) {
      this.turnPoints = 0;
      this.diceState = freshDice();
      this.phase = 'awaiting_roll';
      this.emitEvent({ type: 'log', text: `${this.nameOf(this.order[this.currentIdx])}'s turn.` });
    }
    this.emitState();
  }

  startGame(byId) {
    if (byId !== this.hostId) return;
    if (this.phase !== 'lobby') return;
    if (this.players.length < 1) return;
    this.beginOpeningRoll();
  }

  // --- Opening roll ----

  beginOpeningRoll() {
    if (this.players.length === 1) {
      // Skip; single player goes first.
      this.order = this.players.map(p => p.id);
      this.currentIdx = 0;
      this.startTurn();
      return;
    }
    this.phase = 'opening_roll';
    this.openingPending = this.players.map(p => p.id);
    this.openingResults = {};
    this.emitEvent({ type: 'log', text: 'Rolling for first turn.' });
    this.emitState();
    this.beginNextOpeningRoll();
  }

  beginNextOpeningRoll() {
    if (this.openingPending.length === 0) {
      this.resolveOpeningRoll();
      return;
    }
    this.openingActiveId = this.openingPending.shift();
    this.physics.parkAll();
    this.physics.throwDice([0]);
    this.streaming = true;
    this.phase = 'rolling';
    this.emitEvent({ type: 'log', text: `${this.nameOf(this.openingActiveId)} rolls...` });
    this.emitState();
  }

  resolveOpeningRoll() {
    const max = Math.max(...Object.values(this.openingResults));
    const top = this.players.filter(p => this.openingResults[p.id] === max).map(p => p.id);
    if (top.length === 1) {
      const winnerId = top[0];
      // Order: winner first, then the rest in their join order
      const others = this.players.map(p => p.id).filter(id => id !== winnerId);
      this.order = [winnerId, ...others];
      this.currentIdx = 0;
      this.emitEvent({ type: 'log', text: `${this.nameOf(winnerId)} goes first.` });
      this.startTurn();
    } else {
      // Tie — re-roll among tied players
      const names = top.map(id => this.nameOf(id)).join(', ');
      this.emitEvent({ type: 'log', text: `Tie at ${max} between ${names} — rerolling.` });
      this.openingPending = top.slice();
      this.openingResults = {};
      this.beginNextOpeningRoll();
    }
  }

  // --- Turn lifecycle ----

  startTurn() {
    this.turnPoints = 0;
    this.diceState = freshDice();
    this.phase = 'awaiting_roll';
    this.physics.parkAll();
    // Pulse transforms so all clients clear the previous turn's dice off the table.
    this.emitEvent({ type: 'transforms', t: this.physics.getTransforms() });
    this.emitEvent({ type: 'log', text: `${this.nameOf(this.order[this.currentIdx])}'s turn.` });
    this.emitState();
  }

  requestRoll(byId) {
    if (this.phase !== 'awaiting_roll') return;
    if (this.order[this.currentIdx] !== byId) return;
    this.beginRoll();
  }

  beginRoll() {
    const active = [];
    const lockedTransforms = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) {
        lockedTransforms.push({ index: i, value: this.diceState[i].value });
      } else {
        active.push(i);
      }
    }
    // Hot dice: if everything was locked, reroll all five
    if (active.length === 0) {
      this.diceState = freshDice();
      for (let i = 0; i < 5; i++) active.push(i);
      lockedTransforms.length = 0;
      this.emitEvent({ type: 'log', text: 'Hot dice — rerolling all five!' });
    }
    this.phase = 'rolling';
    this.physics.throwDice(active, lockedTransforms);
    this.streaming = true;
    this.emitEvent({ type: 'roll_started', activeIndices: active });
    this.emitState();
  }

  // --- Physics tick: called by host's render loop ---

  tick(dt) {
    if (this.phase === 'rolling') {
      this.physics.step(dt);

      this.broadcastTimer += dt;
      if (this.broadcastTimer >= 1 / 30) {
        this.broadcastTimer = 0;
        this.emitEvent({ type: 'transforms', t: this.physics.getTransforms() });
      }

      // Settle detection
      if (!this._settleStart) this._settleStart = performance.now();
      const elapsed = performance.now() - this._settleStart;
      if (elapsed > 1000 && this.physics.isSettled()) {
        if (!this._stillStart) this._stillStart = performance.now();
        if (performance.now() - this._stillStart > 250) {
          this._settleStart = null;
          this._stillStart = null;
          this.onSettle();
        }
      } else {
        this._stillStart = null;
        if (elapsed > 8000) {
          this.physics.unstickIfNeeded();
          this._settleStart = performance.now() - 500;
        }
      }
    }
  }

  onSettle() {
    this.streaming = false;
    // Send one final transform snapshot so clients have authoritative resting positions.
    this.emitEvent({ type: 'transforms', t: this.physics.getTransforms() });

    if (this.openingActiveId) {
      // Opening-roll path: read die 0
      const v = this.physics.getValues()[0];
      this.openingResults[this.openingActiveId] = v;
      this.emitEvent({ type: 'log', text: `${this.nameOf(this.openingActiveId)} rolled ${v}.` });
      this.openingActiveId = null;
      this.phase = 'opening_roll';
      this.emitState();
      setTimeout(() => this.beginNextOpeningRoll(), 800);
      return;
    }

    // Game-turn path
    const values = this.physics.getValues();
    for (let i = 0; i < this.diceState.length; i++) {
      if (!this.diceState[i].locked) this.diceState[i].value = values[i];
    }
    this.emitEvent({
      type: 'roll_settled',
      values: this.diceState.map(d => d.value),
      locked: this.diceState.map(d => d.locked),
    });

    const activeValues = this.diceState.filter(d => !d.locked).map(d => d.value);
    if (!rollHasScore(activeValues)) {
      this.phase = 'busted';
      const player = this.order[this.currentIdx];
      this.emitEvent({ type: 'log', text: `${this.nameOf(player)} busted! Lost ${this.turnPoints}.`, kind: 'bust' });
      this.turnPoints = 0;
      this.emitState();
      setTimeout(() => this.endTurn(), 1500);
    } else {
      this.phase = 'awaiting_keep';
      this.emitState();
    }
  }

  // --- Player commit actions ---

  commit(byId, action, indices) {
    if (this.phase !== 'awaiting_keep') return;
    if (this.order[this.currentIdx] !== byId) return;
    // Validate selection
    const indexSet = new Set(indices || []);
    const keepValues = [];
    for (const i of indexSet) {
      if (i < 0 || i >= this.diceState.length) return;
      if (this.diceState[i].locked) return;
      keepValues.push(this.diceState[i].value);
    }
    const evalRes = evaluateKeep(keepValues);
    if (!evalRes.valid) {
      this.emitEvent({ type: 'log', text: `Invalid selection: ${evalRes.reason}`, kind: 'reject' });
      this.emitState();
      return;
    }
    // Apply: lock kept indices, add to turn points
    for (const i of indexSet) this.diceState[i].locked = true;
    this.turnPoints += evalRes.score;
    this.emitEvent({ type: 'log', text: `${this.nameOf(byId)} keeps ${formatKept(keepValues)} for +${evalRes.score}.` });

    if (action === 'bank') {
      const total = (this.totalScores[byId] || 0) + this.turnPoints;
      this.totalScores[byId] = total;
      this.emitEvent({ type: 'log', text: `${this.nameOf(byId)} banks ${this.turnPoints}. Total ${total}.`, kind: 'bank' });
      this.checkWinAndEndTurn(byId);
    } else if (action === 'reroll') {
      this.beginRoll();
    }
  }

  checkWinAndEndTurn(byId) {
    if (this.totalScores[byId] >= WIN_SCORE && this.finalTriggeredBy === null) {
      this.finalTriggeredBy = byId;
      this.finalRemaining = this.order.filter(id => id !== byId);
      this.emitEvent({
        type: 'log',
        text: `${this.nameOf(byId)} reached ${WIN_SCORE}! Final round for everyone else.`,
        kind: 'bank',
      });
    }
    this.endTurn();
  }

  endTurn() {
    if (this.finalTriggeredBy !== null) {
      // Remove current from finalRemaining if they were in it (they shouldn't be the trigger)
      const justFinishedId = this.order[this.currentIdx];
      this.finalRemaining = this.finalRemaining.filter(id => id !== justFinishedId);
      if (this.finalRemaining.length === 0) {
        this.endGame();
        return;
      }
    }
    this.currentIdx = (this.currentIdx + 1) % this.order.length;
    this.startTurn();
  }

  endGame() {
    this.phase = 'game_over';
    let winnerId = this.players[0]?.id;
    let max = -1;
    for (const p of this.players) {
      const s = this.totalScores[p.id] || 0;
      if (s > max) { max = s; winnerId = p.id; }
    }
    this.emitEvent({ type: 'log', text: `${this.nameOf(winnerId)} wins with ${max}!`, kind: 'bank' });
    this.emitEvent({ type: 'game_over', winnerId, scores: { ...this.totalScores } });
    this.emitState();
  }

  rematch(byId) {
    if (byId !== this.hostId) return;
    if (this.phase !== 'game_over') return;
    this.totalScores = {};
    for (const p of this.players) this.totalScores[p.id] = 0;
    this.order = [];
    this.currentIdx = 0;
    this.diceState = [];
    this.turnPoints = 0;
    this.finalTriggeredBy = null;
    this.finalRemaining = [];
    this.openingResults = {};
    this.openingPending = [];
    this.openingActiveId = null;
    this.phase = 'lobby';
    this.physics.parkAll();
    this.emitEvent({ type: 'log', text: 'Back to lobby.' });
    this.emitState();
  }

  // --- helpers ---

  nameOf(id) { return this.players.find(p => p.id === id)?.name || '???'; }

  emitState() {
    this.onState(this.snapshot());
  }

  emitEvent(ev) {
    this.onEvent(ev);
  }

  snapshot() {
    return {
      phase: this.phase,
      players: this.players.map(p => ({ id: p.id, name: p.name })),
      hostId: this.hostId,
      totalScores: { ...this.totalScores },
      order: this.order.slice(),
      currentPlayerId: this.order[this.currentIdx] || null,
      diceState: this.diceState.map(d => ({ ...d })),
      turnPoints: this.turnPoints,
      finalTriggeredBy: this.finalTriggeredBy,
      openingResults: { ...this.openingResults },
      openingActiveId: this.openingActiveId,
      winScore: WIN_SCORE,
    };
  }
}

function freshDice() {
  return Array.from({ length: 5 }, () => ({ value: 1, locked: false }));
}

function formatKept(values) {
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const parts = [];
  for (const v of [1,2,3,4,5,6]) {
    if (counts[v]) parts.push(`${counts[v]}× ${v}`);
  }
  return parts.join(', ');
}
