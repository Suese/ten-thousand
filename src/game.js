import { DicePhysics, keptTargetTransform, snapBodyToTransform } from './physics.js';
import { evaluateKeep, rollHasScore } from './rules.js';
import { ITEMS } from './items.js';
import { MAX_PLAYERS } from './colors.js';

const WIN_SCORE = 10000;
const DOOKIE_DURATION_MS = 30000;
const SAW_BLADE_DURATION_MS = 8000;
const BUST_GRACE_MS = 5000;
const TURN_TIMEOUT_MS = 15000;
// Time the active player has to commit (keep / bank / use item) after the
// dice settle. Expiry = instant bust. Resets whenever the dice are disturbed.
const PLAY_TIMER_MS = 20000;

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
    this.physics.onCollision = (info) => {
      // Tornado-on-die hit — throttled "WHACK!" event for sound + comic burst.
      const saw = this.activeEffects.sawBlade;
      if (info.kind === 'dice' && saw && (info.aIndex === saw.dieIndex || info.bIndex === saw.dieIndex)) {
        const now = performance.now();
        if (!this._lastTornadoHitTs || now - this._lastTornadoHitTs > 120) {
          this._lastTornadoHitTs = now;
          this.emitEvent({ type: 'tornado_hit', point: info.point, intensity: info.intensity });
        }
      }
      // Throttled audio collision broadcast (dice-clatter sound).
      const now = performance.now();
      if (!this._lastCollideEv) this._lastCollideEv = 0;
      if (now - this._lastCollideEv < 25) return;
      this._lastCollideEv = now;
      this.emitEvent({ type: 'collision', kind: info.kind, intensity: info.intensity });
    };
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

    // Tick-driven timer queue. All deferred actions go through here instead
    // of setTimeout so they pause with the host's tick loop (e.g., when the
    // tab is unfocused) and stay in lockstep with physics state changes.
    this._timers = [];

    // ----- Shop / item state -----
    this.inventories = {};       // playerId -> { itemId: count }
    this.selection = [];         // dice indices the active player has highlighted
    this.activeEffects = {
      portableHole: {},          // playerId -> [dieIndex...] absent for next roll
      destroyed: new Set(),      // dice indices destroyed by saw blade for this turn
      weightedDice: new Set(),   // dice indices being torque-biased toward 1 (this turn)
      hiddenNow: new Set(),      // dice currently sucked into a portable hole, restored next roll
      dookieZones: [],           // [{x, z, r, untilTs}]
      iceRinkActive: false,      // active for the entire current turn once cast
      sawBlade: null,            // { dieIndex, untilTs } or null
    };
  }

  setHostId(id) { this.hostId = id; }

  handleAction(fromId, action) {
    if (!action || typeof action !== 'object') return;
    switch (action.name) {
      case 'set_name':      this.setName(fromId, action.value); break;
      case 'start_game':    this.startGame(fromId); break;
      case 'shake_start':   this.shakeStart(fromId); break;
      case 'request_roll':  this.requestRoll(fromId); break;
      case 'commit':        this.commit(fromId, action.action, action.indices); break;
      case 'rematch':       this.rematch(fromId); break;
      case 'set_selection': this.setSelection(fromId, action.indices); break;
      case 'purchase':      this.purchaseItem(fromId, action.itemId); break;
      case 'use_item':      this.useItem(fromId, action.itemId, action.params || {}); break;
      case 'cursor':        this.cursorRelay(fromId, action.x, action.y); break;
    }
  }

  // Cursor positions are ephemeral — no state snapshot, just re-broadcast as
  // an event so every peer can render the senders' cursors.
  cursorRelay(fromId, x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!this.players.find(p => p.id === fromId)) return;
    this.emitEvent({ type: 'cursor', playerId: fromId, x, y });
  }

  shakeStart(fromId) {
    if (this.phase !== 'awaiting_roll' && this.phase !== 'awaiting_keep') return;
    if (this.order[this.currentIdx] !== fromId) return;
    if (this._shaking) return;
    this._shaking = true;
    this._shakeStartTs = Date.now();
    this._inHand = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) continue;
      if (this.activeEffects.destroyed.has(i)) continue;
      if (this.activeEffects.hiddenNow.has(i)) continue;
      if (this.phase === 'awaiting_keep' && this.selection.includes(i)) continue;
      this._inHand.push(i);
    }
    this.emitState();
  }

  // Schedules the actual physics throw to fire at least 2 s after the shake
  // started. If the player held the button longer than 2 s, throws right away.
  _scheduleThrow() {
    if (this._rollPending) return;
    this._rollPending = true;
    const SHAKE_MIN_MS = 750;
    const elapsed = Date.now() - (this._shakeStartTs || Date.now());
    const remaining = Math.max(0, SHAKE_MIN_MS - elapsed);
    const doThrow = () => {
      this._rollPending = false;
      // If we drifted out of a rollable phase in the meantime (turn timeout,
      // disconnect, etc.) abandon the throw.
      if (this.phase !== 'rolling') {
        this._shaking = false;
        return;
      }
      this._shaking = false;
      this.beginRoll();
    };
    if (remaining === 0) doThrow();
    else this._scheduleAt(remaining, doThrow);
  }

  // Active player updates which dice they're highlighting; broadcast to all so spectators see it.
  setSelection(fromId, indices) {
    if (this.phase !== 'awaiting_keep') return;
    if (this.order[this.currentIdx] !== fromId) return;
    if (!Array.isArray(indices)) return;
    const filtered = [];
    for (const i of indices) {
      if (typeof i !== 'number' || i < 0 || i >= this.diceState.length) continue;
      if (this.diceState[i].locked) continue;
      if (!filtered.includes(i)) filtered.push(i);
    }
    this.selection = filtered;
    this.emitState();
  }

  purchaseItem(fromId, itemId) {
    const item = ITEMS[itemId];
    if (!item) return;
    if (this.phase === 'lobby' || this.phase === 'opening_roll' || this.phase === 'game_over') return;
    const balance = this.totalScores[fromId] || 0;
    if (balance < item.cost) {
      this.emitEvent({ type: 'log', text: `${this.nameOf(fromId)} can't afford ${item.name}.`, kind: 'reject' });
      return;
    }
    this.totalScores[fromId] = balance - item.cost;
    if (!this.inventories[fromId]) this.inventories[fromId] = {};
    this.inventories[fromId][itemId] = (this.inventories[fromId][itemId] || 0) + 1;
    this.emitEvent({ type: 'log', text: `${this.nameOf(fromId)} bought ${item.icon} ${item.name} (-${item.cost}).` });
    this.emitEvent({ type: 'purchase', playerId: fromId, itemId, cost: item.cost });
    // If a purchase drops every player back below WIN_SCORE, cancel sudden
    // death — there's nothing to race to anymore, so play continues normally.
    if (this.finalTriggeredBy !== null) {
      const anyoneOver = Object.values(this.totalScores).some(s => s >= WIN_SCORE);
      if (!anyoneOver) {
        this.finalTriggeredBy = null;
        this.finalRemaining = [];
        this.emitEvent({
          type: 'log',
          text: `No one's above ${WIN_SCORE} anymore — sudden death cancelled.`,
          kind: 'bank',
        });
      }
    }
    this.emitState();
  }

  useItem(fromId, itemId, params) {
    const item = ITEMS[itemId];
    if (!item) return;
    const inv = this.inventories[fromId];
    if (!inv || !inv[itemId]) return;
    const isMyTurn = this.order[this.currentIdx] === fromId;

    // Item use is blocked during the bank animation window — between the
    // bank commit and the next turn's startTurn, items would have nothing
    // useful to land on (locked dice all about to vanish) and just get wasted.
    if (this._bankingInProgress) {
      this.emitEvent({ type: 'log', text: `Can't use ${item.name} during a bank.`, kind: 'reject' });
      return;
    }

    // Phase gate
    const okPhase = (
      (item.when === 'own_pre_roll'      && this.phase === 'awaiting_roll'   && isMyTurn) ||
      (item.when === 'opp_pre_roll'      && this.phase === 'awaiting_roll'   && !isMyTurn) ||
      (item.when === 'opp_awaiting_keep' && this.phase === 'awaiting_keep'   && !isMyTurn) ||
      (item.when === 'anytime'           && this.phase !== 'lobby' && this.phase !== 'opening_roll' && this.phase !== 'game_over')
    );
    if (!okPhase) {
      this.emitEvent({ type: 'log', text: `Can't use ${item.name} right now.`, kind: 'reject' });
      return;
    }

    // Consume one
    inv[itemId]--;
    if (inv[itemId] <= 0) delete inv[itemId];

    const targetPlayerId = this.order[this.currentIdx];
    let extra = {};

    switch (itemId) {
      case 'weighted': {
        // Player chose a specific die OR (pre-roll) is letting the host pick one randomly.
        let idx = (params && typeof params.dieIndex === 'number') ? params.dieIndex : null;
        // Random pick — exclude dice that are already weighted so spamming this
        // item N times weights N distinct dice (up to 5).
        if (idx == null) idx = this.pickRandomEligibleDieIndex(this.activeEffects.weightedDice);
        if (idx == null
            || this.diceState[idx]?.locked
            || this.activeEffects.destroyed.has(idx)
            || this.activeEffects.hiddenNow.has(idx)
            || this.activeEffects.weightedDice.has(idx)) {
          inv[itemId] = (inv[itemId] || 0) + 1;
          this.emitEvent({ type: 'log', text: 'No eligible die to weight.', kind: 'reject' });
          return;
        }
        this.activeEffects.weightedDice.add(idx);
        this.physics.setDieWeightedTowardOne(idx, true);
        extra = { dieIndex: idx };
        break;
      }
      case 'portable_hole': {
        const idx = this.pickRandomEligibleDieIndex();
        if (idx == null) {
          inv[itemId] = (inv[itemId] || 0) + 1; // refund
          this.emitEvent({ type: 'log', text: 'No eligible dice for the Portable Hole.', kind: 'reject' });
          return;
        }
        if (!this.activeEffects.portableHole[targetPlayerId]) this.activeEffects.portableHole[targetPlayerId] = [];
        this.activeEffects.portableHole[targetPlayerId].push(idx);
        if (this.phase === 'awaiting_keep' || this.phase === 'rolling') {
          // Capture the die's current xz so clients can place the hole disc.
          // The physics body is ghosted (collisionResponse off + downward velocity)
          // so it physically falls through the felt under gravity. Host streams
          // transforms during the fall; after ~1.1 s we park the body offstage.
          const b = this.physics.bodies[idx];
          const pos = [b.position.x, b.position.y, b.position.z];
          this.activeEffects.hiddenNow.add(idx);
          this.selection = this.selection.filter(i => i !== idx);
          this.physics.enterPortableHole(idx);
          this.emitEvent({ type: 'portable_hole_animate', dieIndex: idx, position: pos });
          this._scheduleAt(1100, () => {
            this.physics.parkIndices([idx]); // also re-enables collision response
            // If the hole ate the last actionable die during awaiting_keep,
            // auto-bank what's already in the keep — otherwise the player
            // would just sit there until the play timer expires and busts.
            if (
              this.phase === 'awaiting_keep'
              && this.turnPoints > 0
              && this._currentActiveValues().length === 0
            ) {
              this._finalizeBank(this.order[this.currentIdx], 0);
            }
          });
        }
        extra = { targetPlayerId, dieIndex: idx };
        break;
      }
      case 'flick': {
        // Player chose a specific die (and hit point) to flick.
        let idx = (params && typeof params.dieIndex === 'number') ? params.dieIndex : null;
        if (idx == null || this.diceState[idx]?.locked || this.activeEffects.destroyed.has(idx) || this.activeEffects.hiddenNow.has(idx)) {
          // Refund — invalid target.
          inv[itemId] = (inv[itemId] || 0) + 1;
          this.emitEvent({ type: 'log', text: 'Invalid flick target.', kind: 'reject' });
          return;
        }
        const hit = Array.isArray(params.hitPoint) && params.hitPoint.length === 3 ? params.hitPoint : null;
        this.beginFlick(idx, hit);
        extra = { dieIndex: idx, hitPoint: hit };
        break;
      }
      case 'dookie': {
        // Shotgun-spread splatter: 1 main splotch where you aimed + 6 random outliers.
        let cx = (params && typeof params.x === 'number') ? params.x : (-4.5 + Math.random() * 9);
        let cz = (params && typeof params.z === 'number') ? params.z : (-3 + Math.random() * 6);
        cx = Math.max(-9.75, Math.min(9.75, cx));
        cz = Math.max(-6.75, Math.min(6.75, cz));
        const untilTs = Date.now() + DOOKIE_DURATION_MS;
        const splotches = [];
        splotches.push({ x: cx, z: cz, r: 0.85 + Math.random() * 0.25, untilTs });
        for (let k = 0; k < 6; k++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 0.6 + Math.random() * 1.8;
          const sx = Math.max(-6.5, Math.min(6.5, cx + Math.cos(angle) * dist));
          const sz = Math.max(-4.5, Math.min(4.5, cz + Math.sin(angle) * dist));
          splotches.push({ x: sx, z: sz, r: 0.32 + Math.random() * 0.45, untilTs });
        }
        for (const s of splotches) this.activeEffects.dookieZones.push(s);
        this.physics.setDookieZones(this.activeEffects.dookieZones);
        extra = { zones: splotches };
        break;
      }
      case 'ice_rink': {
        this.activeEffects.iceRinkActive = true;
        this.physics.setIceRink(true);
        // Stays active for the full turn — cleared on startTurn.
        break;
      }
      case 'tornado': {
        // Player picks the die that becomes the tornado.
        let idx = (params && typeof params.dieIndex === 'number') ? params.dieIndex : null;
        if (idx == null) idx = this.pickRandomEligibleDieIndex();
        if (idx == null || this.diceState[idx]?.locked || this.activeEffects.destroyed.has(idx) || this.activeEffects.hiddenNow.has(idx)) {
          inv[itemId] = (inv[itemId] || 0) + 1;
          this.emitEvent({ type: 'log', text: 'No eligible die for the Tornado.', kind: 'reject' });
          return;
        }
        this.beginTornado(idx);
        extra = { dieIndex: idx };
        break;
      }
    }

    this.emitEvent({ type: 'log', text: `${this.nameOf(fromId)} used ${item.icon} ${item.name}.`, kind: 'item' });
    this.emitEvent({ type: 'item_used', playerId: fromId, itemId, ...extra });
    this.emitState();
  }

  pickRandomEligibleDieIndex(excludeSet = null) {
    const candidates = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) continue;
      if (this.activeEffects.destroyed.has(i)) continue;
      if (this.activeEffects.hiddenNow.has(i)) continue;
      if (excludeSet && excludeSet.has(i)) continue;
      candidates.push(i);
    }
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  beginFlick(dieIndex, hitPoint = null) {
    this.physics.flickDie(dieIndex, hitPoint);
    this.phase = 'rolling';
    this.streaming = true;
    this._sawBladeUntil = 0;
    this._flickIndex = dieIndex;
  }

  beginTornado(dieIndex) {
    // Tornado spins a chosen die and uses it to knock other dice around. The
    // tornado die is NOT destroyed — once the chaos ends everyone settles to
    // new face values and the player can keep any of them like a normal roll.
    this.activeEffects.sawBlade = { dieIndex, untilTs: Date.now() + SAW_BLADE_DURATION_MS };
    this.physics.startSawBlade(dieIndex);
    this.phase = 'rolling';
    this.streaming = true;
  }

  addPlayer(id, name) {
    if (this.players.find(p => p.id === id)) return false;
    if (this.players.length >= MAX_PLAYERS) {
      this.emitEvent({ type: 'log', text: `Game is full (${MAX_PLAYERS} max).`, kind: 'reject' });
      return false;
    }
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

  getFullDiceSnapshot() {
    return this.physics.getFullSnapshot();
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
      this._turnTimeoutTs = Date.now() + TURN_TIMEOUT_MS;
      this._shaking = false;
      this._rollPending = false;
      this.emitEvent({ type: 'log', text: `${this.nameOf(this.order[this.currentIdx])}'s turn.` });
    }
    this.emitState();
  }

  startGame(byId) {
    if (byId !== this.hostId) return;
    if (this.phase !== 'lobby') return;
    if (this.players.length < 1) return;
    // Fresh game — wipe every player's shop inventory so leftovers from a
    // previous match don't carry over.
    this.inventories = {};
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
    this.selection = [];
    this.phase = 'awaiting_roll';
    this._turnTimeoutTs = Date.now() + TURN_TIMEOUT_MS;
    this._turnRollCount = 0;
    this._rollPending = false;
    this._shaking = false;
    this._bankingInProgress = false;
    this._playTimerTs = null;
    this.physics.parkAll();
    // Clear turn-scoped item effects.
    this.activeEffects.destroyed.clear();
    this.activeEffects.weightedDice.clear();
    this.physics.clearWeightedDice();
    this.activeEffects.hiddenNow.clear();
    this.activeEffects.dookieZones = [];
    this.physics.setDookieZones([]);
    this.activeEffects.iceRinkActive = false;
    this.physics.setIceRink(false);
    this.activeEffects.sawBlade = null;
    // Pulse transforms so all clients clear the previous turn's dice off the table.
    this.emitEvent({ type: 'transforms', t: this.physics.getTransforms() });
    this.emitEvent({ type: 'log', text: `${this.nameOf(this.order[this.currentIdx])}'s turn.` });
    this.emitState();
  }

  requestRoll(byId) {
    if (this.phase !== 'awaiting_roll') return;
    if (this.order[this.currentIdx] !== byId) return;
    if (this._rollPending) return;
    this._turnTimeoutTs = null;
    // Move to 'rolling' immediately so the button hides; shake audio keeps
    // going via state.shaking until _scheduleThrow fires beginRoll.
    this.phase = 'rolling';
    this.emitState();
    this._scheduleThrow();
  }

  beginRoll() {
    this._turnRollCount = (this._turnRollCount || 0) + 1;
    this._inHand = []; // dice leave the hand and go into the throw
    const playerId = this.order[this.currentIdx];
    const holes = (this.activeEffects.portableHole[playerId] || []).slice();

    const active = [];
    const lockedIndices = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) {
        lockedIndices.push(i);
      } else if (!holes.includes(i)) {
        active.push(i);
      }
    }
    // Sort locked dice left → right by current body X so the j-indexing here
    // matches the order commit() used to position them. Otherwise the throw
    // would snap them to a different j-layout than where the lerp landed.
    lockedIndices.sort((a, b) => this.physics.bodies[a].position.x - this.physics.bodies[b].position.x);
    const lockedTransforms = lockedIndices.map(i => ({ index: i, value: this.diceState[i].value }));
    // Hot dice: if everything was locked, reroll all five (clears portable holes too).
    if (active.length === 0 && holes.length === 0) {
      this.diceState = freshDice();
      for (let i = 0; i < 5; i++) active.push(i);
      lockedTransforms.length = 0;
      this.emitEvent({ type: 'hot_dice', playerId });
      this.emitEvent({ type: 'log', text: 'Hot dice — rerolling all five!' });
    }

    // Hide portable-hole dice for this single roll.
    this._hiddenForRoll = holes;
    this.physics.parkIndices(holes);
    // Once portable holes are queued for this roll, clear the "hiddenNow" flag —
    // the dice are now properly accounted for as roll-scoped holes.
    this.activeEffects.hiddenNow.clear();

    this.phase = 'rolling';
    this.physics.throwDice(active, lockedTransforms);
    this.streaming = true;
    // Ship state first so clients clear the shake audio before the
    // roll_started event triggers tossDice — ensures the throw sound never
    // overlaps the lingering rattle.
    this.emitState();
    this.emitEvent({ type: 'roll_started', activeIndices: active, hidden: holes });
  }

  // --- Physics tick: called by host's render loop ---

  // Schedules `action` to run after `delayMs`, from the tick loop. Drains in
  // arrival order on each tick; not high-precision (granularity = tick rate).
  _scheduleAt(delayMs, action) {
    this._timers.push({ atTs: Date.now() + delayMs, action });
  }

  _drainTimers() {
    if (!this._timers.length) return;
    const now = Date.now();
    const due = [];
    const rest = [];
    for (const t of this._timers) {
      if (t.atTs <= now) due.push(t.action);
      else rest.push(t);
    }
    this._timers = rest;
    for (const action of due) action();
  }

  tick(dt) {
    this._drainTimers();
    // Turn-start auto-pass: 15 s to begin the turn or you're skipped.
    if (this.phase === 'awaiting_roll' && this._turnTimeoutTs && Date.now() >= this._turnTimeoutTs) {
      const playerId = this.order[this.currentIdx];
      this._turnTimeoutTs = null;
      this._shaking = false;
      this.emitEvent({ type: 'turn_skipped', playerId });
      this.emitEvent({ type: 'log', text: `${this.nameOf(playerId)} ran out of time — turn skipped.`, kind: 'bust' });
      this.endTurn();
      return;
    }

    // (Ice rink no longer time-expires; it lives until the next startTurn.)
    if (this.activeEffects.dookieZones.length) {
      const before = this.activeEffects.dookieZones.length;
      this.activeEffects.dookieZones = this.activeEffects.dookieZones.filter(z => Date.now() < z.untilTs);
      if (this.activeEffects.dookieZones.length !== before) {
        this.physics.setDookieZones(this.activeEffects.dookieZones);
      }
    }

    // Note: requestRoll / commit('reroll') flip phase to 'rolling' immediately
    // (so the buttons hide) but defer beginRoll for up to 2 s to enforce the
    // shake-sound minimum. During that window streaming is still false, so the
    // physics-and-settle branch below must NOT run yet — otherwise it sees
    // stationary dice, fires onSettle prematurely, and leaves the shake stuck.
    if (this.phase === 'rolling' && this.streaming) {
      // Saw blade chaos: keep nudging the saw die for SAW_BLADE_DURATION_MS.
      if (this.activeEffects.sawBlade) {
        this.physics.tickSawBlade(this.activeEffects.sawBlade.dieIndex, dt);
        if (Date.now() > this.activeEffects.sawBlade.untilTs) {
          this.physics.endSawBlade(this.activeEffects.sawBlade.dieIndex);
          this.activeEffects.sawBlade = null;
        }
      }

      this.physics.applyDookieDrag();
      this.physics.applyWeightedTorques();
      this.physics.step(dt);
      this.physics.updateFaceTracker();

      this.broadcastTimer += dt;
      if (this.broadcastTimer >= 1 / 30) {
        this.broadcastTimer = 0;
        this.emitEvent({ type: 'transforms', t: this.physics.getTransforms() });
      }

      if (this.activeEffects.sawBlade) return;

      if (!this._settleStart) this._settleStart = performance.now();
      const elapsed = performance.now() - this._settleStart;
      // Minimum 750 ms in the rolling phase — the visual + audio of a throw
      // always get to play out, even when the dice would have settled sooner.
      if (elapsed > 750 && this.physics.isSettled()) {
        this._settleStart = null;
        this.onSettle();
      } else if (elapsed > 3000) {
        // Lingering too long — give the dice a gentle nudge. Reset to 500 ms
        // elapsed so the next nudge fires in another ~2.5 s if still unsettled.
        this.physics.unstickIfNeeded();
        this._settleStart = performance.now() - 500;
      }
    } else if (this.phase === 'awaiting_keep') {
      // Dice on ice keep sliding even after settling — physics has to run so we
      // can observe disturbances (flicks, dookie collisions, saw blade hits) and
      // unselect any selected die that lost its face-up alignment.
      this.physics.applyDookieDrag();
      this.physics.applyWeightedTorques();
      this.physics.step(dt);
      this.physics.updateFaceTracker();

      this.broadcastTimer += dt;
      if (this.broadcastTimer >= 1 / 30) {
        this.broadcastTimer = 0;
        this.emitEvent({ type: 'transforms', t: this.physics.getTransforms() });
      }

      // Skip disturbance + bust evaluation while a bank animation is playing
      // out — the player has already chosen to bank, and the un-banked dice
      // would otherwise trip a false "Bust in 5s" warning.
      if (!this._bankingInProgress) {
        this._checkAwaitingKeepDisturbances();
        if (this._evaluateBustState()) this.emitState();
        // Play timer: any unstable die means dice are still in motion — push
        // expiry forward so the player gets the full 20 s once they actually
        // settle again. Otherwise, if expired without a pending bust grace,
        // force a bust for inactivity.
        if (this._playTimerTs && this._anyDieUnstable()) {
          this._playTimerTs = Date.now() + PLAY_TIMER_MS;
        } else if (
          this._playTimerTs
          && !this._bustPendingTs
          && Date.now() >= this._playTimerTs
        ) {
          this._playTimerTs = null;
          this._bustPendingPlayer = this.order[this.currentIdx];
          this._bustPendingLost = this.turnPoints;
          this.emitEvent({
            type: 'log',
            text: `${this.nameOf(this._bustPendingPlayer)} ran out of time.`,
            kind: 'bust',
          });
          this._fireBust();
        }
      }
    }
  }

  // True if any non-locked, non-destroyed, non-hiddenNow die is currently
  // mid-tumble. Used by the play timer so it doesn't expire mid-disturbance.
  _anyDieUnstable() {
    const faceStates = this.physics.getFaceStates();
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) continue;
      if (this.activeEffects.destroyed.has(i)) continue;
      if (this.activeEffects.hiddenNow.has(i)) continue;
      const fs = faceStates[i];
      if (fs && !fs.stable) return true;
    }
    return false;
  }

  _checkAwaitingKeepDisturbances() {
    const faceStates = this.physics.getFaceStates();
    const disturbed = [];
    let stateChanged = false;
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) continue;
      if (this.activeEffects.destroyed.has(i)) continue;
      if (this.activeEffects.hiddenNow.has(i)) continue;
      const fs = faceStates[i];
      if (!fs) continue;
      if (fs.stable) {
        if (this.diceState[i].value !== fs.value) {
          this.diceState[i].value = fs.value;
          stateChanged = true;
        }
      } else {
        // Currently unstable (mid-flip / mid-tumble). Invalidate the stored
        // value with 0 so scoring/bust logic doesn't think it's still showing
        // its pre-disturbance face. Re-stabilization will update it.
        if (this.diceState[i].value !== 0) {
          this.diceState[i].value = 0;
          stateChanged = true;
        }
        if (this.selection.includes(i)) disturbed.push(i);
      }
    }
    if (disturbed.length) {
      this.selection = this.selection.filter(i => !disturbed.includes(i));
      this.emitEvent({ type: 'selection_removed', indices: disturbed });
      stateChanged = true;
    }
    if (stateChanged) this.emitState();
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
      this._scheduleAt(800, () => this.beginNextOpeningRoll());
      return;
    }

    // Game-turn path
    const values = this.physics.getValues();
    const playerId = this.order[this.currentIdx];

    // Flick: only the flicked die's value is updated; others retain their pre-flick state.
    if (this._flickIndex != null) {
      const idx = this._flickIndex;
      this._flickIndex = null;
      if (!this.diceState[idx].locked) this.diceState[idx].value = values[idx];
      this.emitEvent({
        type: 'roll_settled',
        values: this.diceState.map(d => d.value),
        locked: this.diceState.map(d => d.locked),
      });
      this.phase = 'awaiting_keep';
      this._playTimerTs = Date.now() + PLAY_TIMER_MS;
      this._evaluateBustState();
      this.emitState();
      return;
    }

    const hidden = this._hiddenForRoll || [];
    this._hiddenForRoll = null;
    for (let i = 0; i < this.diceState.length; i++) {
      if (!this.diceState[i].locked && !hidden.includes(i)) {
        this.diceState[i].value = values[i];
      }
    }

    // (Weighted dice are biased toward 1 by continuous torque in the physics tick;
    // beyond that they behave exactly like normal dice — no snapping, no overrides.)

    // Restore portable-hole dice after their skipped roll.
    if (hidden.length) {
      this.activeEffects.portableHole[playerId] = (this.activeEffects.portableHole[playerId] || []).filter(i => !hidden.includes(i));
      this.physics.restoreParked(hidden);
    }

    // Re-broadcast transforms once so any forced face-up shows up on clients.
    this.emitEvent({ type: 'transforms', t: this.physics.getTransforms() });

    this.emitEvent({
      type: 'roll_settled',
      values: this.diceState.map(d => d.value),
      locked: this.diceState.map(d => d.locked),
    });

    // For bust check: destroyed (saw-bladed) dice contribute nothing.
    const activeValues = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (!this.diceState[i].locked && !this.activeEffects.destroyed.has(i) && !hidden.includes(i)) {
        activeValues.push(this.diceState[i].value);
      }
    }
    // Transition to awaiting_keep. The bust state (or absence thereof) is
    // evaluated centrally by _evaluateBustState — both from the next tick
    // and as a one-shot here so the immediate state broadcast carries the
    // correct pending status.
    this.phase = 'awaiting_keep';
    // Start the play timer — player has PLAY_TIMER_MS to act before they get
    // auto-busted. Disturbances during awaiting_keep reset this from the tick.
    this._playTimerTs = Date.now() + PLAY_TIMER_MS;
    this._evaluateBustState();
    this.emitState();
  }

  _fireBust() {
    const player = this._bustPendingPlayer;
    const lost = this._bustPendingLost || 0;
    this._bustPendingTs = null;
    this._bustPendingPlayer = null;
    this._bustPendingLost = 0;
    this._playTimerTs = null;
    this.phase = 'busted';
    const visibleIndices = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.activeEffects.destroyed.has(i)) continue;
      if (this.activeEffects.hiddenNow.has(i)) continue;
      visibleIndices.push(i);
    }
    this.emitEvent({ type: 'bust', playerId: player, lost, indices: visibleIndices });
    this.emitEvent({ type: 'log', text: `${this.nameOf(player)} busted! Lost ${lost}.`, kind: 'bust' });
    this.turnPoints = 0;
    this.emitState();
    this._scheduleAt(1500, () => this.endTurn());
  }

  _currentActiveValues() {
    const out = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) continue;
      if (this.activeEffects.destroyed.has(i)) continue;
      if (this.activeEffects.hiddenNow.has(i)) continue;
      out.push(this.diceState[i].value);
    }
    return out;
  }

  // Centralised bust detection. Runs at end of onSettle (immediately when dice
  // come to rest) and again every awaiting_keep tick. This is what catches the
  // case where an item changes the dice during keep — even if the initial roll
  // was valid — and slides the state into a bust.
  // Returns true if state changed (caller should emit state).
  _evaluateBustState() {
    const activeValues = this._currentActiveValues();
    const hasScoring   = activeValues.length > 0 && rollHasScore(activeValues);
    const allStable    = activeValues.length > 0 && !activeValues.includes(0);

    if (hasScoring) {
      // Scoring available — cancel any pending bust.
      if (this._bustPendingTs) {
        this._bustPendingTs = null;
        this._bustPendingPlayer = null;
        this._bustPendingLost = 0;
        this.emitEvent({ type: 'log', text: 'Bust averted!', kind: 'bank' });
        return true;
      }
      return false;
    }

    // No scoring on the table.
    if (!allStable) return false; // wait for dice to stabilize first

    if (!this._bustPendingTs) {
      this._bustPendingPlayer = this.order[this.currentIdx];
      this._bustPendingLost = this.turnPoints;
      // Grace timer only exists so opponents can spend shop items (flick,
      // saw blade, tornado, etc.) to disturb the dice and potentially salvage
      // a roll. If nobody owns any items, there's no reason to wait.
      const anyItems = this.players.some(p => {
        const inv = this.inventories[p.id];
        return inv && Object.values(inv).some(count => count > 0);
      });
      if (!anyItems) {
        this._fireBust();
        return false; // _fireBust emits its own state
      }
      this._bustPendingTs = Date.now() + BUST_GRACE_MS;
      this.emitEvent({ type: 'bust_pending', playerId: this._bustPendingPlayer, untilTs: this._bustPendingTs });
      return true;
    }

    if (Date.now() >= this._bustPendingTs) {
      this._fireBust();
      return false; // _fireBust emits its own state
    }
    return false;
  }

  // --- Player commit actions ---

  // Shared bank finalization — called both by an explicit commit('bank') and
  // by the portable-hole auto-bank when the player gets stranded with no
  // actionable dice. lerpDelayMs is the time the client should wait before
  // starting the per-die coin-burst sequence (matches the kept-row lerp from
  // commit; auto-bank passes 0 because the locked dice are already in place).
  _finalizeBank(byId, lerpDelayMs) {
    const banked = this.turnPoints;
    const total = (this.totalScores[byId] || 0) + banked;
    this.totalScores[byId] = total;
    this._playTimerTs = null;
    const bankedIndices = [];
    const remainingIndices = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) {
        bankedIndices.push(i);
      } else if (!this.activeEffects.destroyed.has(i) && !this.activeEffects.hiddenNow.has(i)) {
        remainingIndices.push(i);
      }
    }
    // Banking lock: while set, the awaiting_keep tick skips disturbance /
    // bust evaluation so we don't briefly flash a "Bust in 5s" banner just
    // because the un-banked dice no longer score on their own. Also gates
    // shop-item use so nobody wastes items during the celebration.
    this._bankingInProgress = true;
    // Drop out of awaiting_keep right away so the active player's Keep /
    // Bank buttons disappear the instant the bank fires — they won't come
    // back until the next player's turn flips phase to awaiting_roll.
    this.phase = 'rolling';
    this.emitState();
    const perBurstMs = 375;
    const burstFadeMs = 1500;
    const bankAnimMs = lerpDelayMs
      + Math.max(0, bankedIndices.length - 1) * perBurstMs
      + burstFadeMs;
    this.emitEvent({
      type: 'bank',
      playerId: byId, banked, total,
      indices: bankedIndices,
      remainingIndices,
      lerpDelayMs,
      perBurstMs,
    });
    this.emitEvent({ type: 'log', text: `${this.nameOf(byId)} banks ${banked}. Total ${total}.`, kind: 'bank' });
    this._scheduleAt(bankAnimMs, () => {
      this._bankingInProgress = false;
      this.checkWinAndEndTurn(byId);
    });
  }

  commit(byId, action, indices) {
    if (this.phase !== 'awaiting_keep') return;
    if (this.order[this.currentIdx] !== byId) return;
    // Validate selection
    const indexSet = new Set(indices || []);
    const keepValues = [];
    for (const i of indexSet) {
      if (i < 0 || i >= this.diceState.length) return;
      if (this.diceState[i].locked) return;
      if (this.activeEffects.destroyed.has(i)) return; // can't keep a saw-bladed die
      if (this.activeEffects.hiddenNow.has(i)) return; // can't keep a die in a portable hole
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
    this.selection = [];
    this.turnPoints += evalRes.score;
    // Player acted in time — stop the play timer until dice settle again.
    this._playTimerTs = null;
    this.emitEvent({ type: 'score', playerId: byId, score: evalRes.score, kept: keepValues, turnPoints: this.turnPoints });
    this.emitEvent({ type: 'log', text: `${this.nameOf(byId)} keeps ${formatKept(keepValues)} for +${evalRes.score}.` });

    // Snap every locked die to its kept-row pose in physics, and emit a
    // 'kept_animation' event so clients can smoothly lerp the meshes from
    // their landed positions into the row, one at a time.
    //
    // Sort by CURRENT body X so each die takes the shortest path to its slot.
    // Previously-kept dice (already at leftmost positions) keep their slots
    // instead of getting bumped right when a new die with a lower dice-index
    // is locked — which used to make them appear to "start on the left then
    // slide back into position".
    const lockedIndices = [];
    for (let i = 0; i < this.diceState.length; i++) {
      if (this.diceState[i].locked) lockedIndices.push(i);
    }
    lockedIndices.sort((a, b) => this.physics.bodies[a].position.x - this.physics.bodies[b].position.x);
    const keptTargets = [];
    for (let jj = 0; jj < lockedIndices.length; jj++) {
      const i = lockedIndices[jj];
      const tgt = keptTargetTransform(jj, this.diceState[i].value);
      if (!this.activeEffects.destroyed.has(i)) {
        keptTargets.push({ index: i, value: this.diceState[i].value, ...tgt });
        snapBodyToTransform(this.physics.bodies[i], tgt);
      }
    }
    keptTargets.sort((a, b) => a.x - b.x);
    const lerpPerDieMs = 250;
    const lerpDurationMs = 350;
    const lerpTotalMs = keptTargets.length
      ? (keptTargets.length - 1) * lerpPerDieMs + lerpDurationMs
      : 0;
    if (keptTargets.length) {
      this.emitEvent({
        type: 'kept_animation',
        targets: keptTargets,
        perDieMs: lerpPerDieMs,
        lerpMs: lerpDurationMs,
      });
    }

    if (action === 'bank') {
      this._finalizeBank(byId, lerpTotalMs);
    } else if (action === 'reroll') {
      // Bonus check (only after the first roll, only on a hot-dice-bound commit).
      if (this._turnRollCount > 1 && this.diceState.every(d => d.locked)) {
        const counts = {};
        for (const d of this.diceState) counts[d.value] = (counts[d.value] || 0) + 1;
        const dist = Object.values(counts).sort((a, b) => b - a);
        let bonus = 0, label = '';
        if (dist.length === 1 && dist[0] === 5) {
          bonus = 1000;
          label = `🎉 All ${this.diceState[0].value}s!`;
        } else if (dist.length === 2 && dist[0] === 3 && dist[1] === 2) {
          bonus = 500;
          label = '🏠 Full House!';
        }
        if (bonus) {
          this.turnPoints += bonus;
          this.emitEvent({ type: 'bonus', playerId: byId, score: bonus, label, turnPoints: this.turnPoints });
          this.emitEvent({ type: 'log', text: `${label} +${bonus} bonus!`, kind: 'bank' });
        }
      }
      // Move to 'rolling' immediately so the keep/bank UI hides; shake audio
      // keeps going (state.shaking still true) until the throw fires. Defer
      // _scheduleThrow until the kept-row lerp completes so the locked dice
      // are visually in place before the new throw flings the rest.
      this.phase = 'rolling';
      this.emitState();
      this._scheduleAt(lerpTotalMs, () => this._scheduleThrow());
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
      // Shop state
      inventories: Object.fromEntries(
        Object.entries(this.inventories).map(([k, v]) => [k, { ...v }])
      ),
      selection: this.selection.slice(),
      destroyed: [...this.activeEffects.destroyed],
      weightedDice: [...this.activeEffects.weightedDice],
      hiddenNow: [...this.activeEffects.hiddenNow],
      bustPendingUntilTs: this._bustPendingTs || null,
      turnTimeoutTs: this._turnTimeoutTs || null,
      playTimerTs: this._playTimerTs || null,
      shaking: !!this._shaking,
      inHand: (this._inHand || []).slice(),
      hiddenIndices: this._hiddenForRoll || [],
      dookieZones: this.activeEffects.dookieZones.map(z => ({ ...z })),
      iceRinkActive: this.activeEffects.iceRinkActive,
      sawBlade: this.activeEffects.sawBlade ? { ...this.activeEffects.sawBlade } : null,
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
