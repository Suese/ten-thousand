import { Scene } from './scene.js';
import { GameRoom } from './game.js';
import { HostNet, ClientNet } from './net.js';
import * as ui from './ui.js';
import { SoundFX } from './audio.js';
import { confettiBurst, coinShower, coinBurst, scorePopup, flashScreen, shake, centerOf, bloodSplat, comicBurstFlick, comicBurstHit, qFlash } from './effects.js';
import { ITEMS } from './items.js';
import { colorHexForPlayer, colorForPlayer } from './colors.js';
import { scheduleAfter, tickClock } from './clock.js';

// ---- Bootstrap scene + audio ----
const scene = new Scene(document.getElementById('canvas-root'));
const sfx = new SoundFX();

// Optional logo — drop a PNG at ./logo.png and it'll be baked INTO the felt and ice
// textures themselves (fibers/scratches cross over it). Failure to load is silent.
{
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => scene.applyLogoImage(img);
  img.onerror = () => {/* no logo present, silent */};
  img.src = './logo.png';
}

// Browsers block audio until a user gesture, and some browsers re-suspend the
// audio context whenever the tab loses focus. Resume on every gesture (cheap
// no-op when already running) and on visibility change.
const wakeAudio = () => sfx.resume();
window.addEventListener('pointerdown', wakeAudio);
window.addEventListener('keydown', wakeAudio);
window.addEventListener('touchstart', wakeAudio, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sfx.resume();
});

const muteBtn = document.getElementById('mute-btn');
let muted = localStorage.getItem('diceMute') === '1';
function refreshMuteBtn() { muteBtn.textContent = muted ? '🔇' : '🔊'; sfx.setMuted(muted); }
refreshMuteBtn();
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('diceMute', muted ? '1' : '0'); } catch {}
  refreshMuteBtn();
  if (!muted) sfx.resume();
});

// Click sound on any button press for tactile feel
document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLButtonElement) sfx.click();
});

// Drain the tick-driven scheduler every frame. Anything that needs a delay
// (bank animation, banner class cleanup, etc.) goes through scheduleAfter().
scene.onTick(() => {
  tickClock();
});

// Live-update the bust countdown text every animation frame.
scene.onTick(() => {
  ui.tickBustCountdown(currentState, myId);
});

// Clock-tick sfx for the final 5 s of either the turn-start countdown or the
// play timer. Fires once per second-boundary change.
let _lastTickSec = 0;
scene.onTick(() => {
  if (!currentState) { _lastTickSec = 0; return; }
  let remaining = 0;
  const now = Date.now();
  if (currentState.phase === 'awaiting_keep' && currentState.playTimerTs) {
    remaining = Math.max(0, Math.ceil((currentState.playTimerTs - now) / 1000));
  } else if (currentState.phase === 'awaiting_roll' && currentState.turnTimeoutTs) {
    remaining = Math.max(0, Math.ceil((currentState.turnTimeoutTs - now) / 1000));
  }
  if (remaining >= 1 && remaining <= 5 && remaining !== _lastTickSec) {
    _lastTickSec = remaining;
    sfx.clockTick();
  } else if (remaining === 0 || remaining > 5) {
    _lastTickSec = 0;
  }
});

// Reposition the action bar only when it's actually in the player's way:
// during `awaiting_keep`, only considering still-selectable (un-locked) dice.
// Runs at 2 Hz so the move is subtle, animated by CSS transition (0.35 s).
let _lastRepositionTs = 0;
scene.onTick(() => {
  const now = performance.now();
  if (now - _lastRepositionTs < 500) return;
  _lastRepositionTs = now;
  repositionActionBar();
});

const actionBarEl = document.getElementById('action-bar');
const DIE_SCREEN_RADIUS = 55;
const DEFAULT_BAR_BOTTOM = 140;

function rectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function resetActionBarPosition() {
  if (actionBarEl.style.left || actionBarEl.style.bottom) {
    actionBarEl.style.left = '';
    actionBarEl.style.bottom = '';
    actionBarEl.style.transform = '';
  }
}

function repositionActionBar() {
  if (!actionBarEl || actionBarEl.offsetParent === null) return;
  // Only relevant during the keep phase — that's when the player is reading dice
  // values. During rolling / awaiting_roll / busted / lobby, return to default.
  if (!currentState || currentState.phase !== 'awaiting_keep') {
    resetActionBarPosition();
    return;
  }

  // Only avoid dice the player can still SELECT. Locked dice from earlier in
  // the turn don't matter (the bar may sit over them — they aren't being
  // re-considered). Destroyed / hidden / hiddenNow are out of play too.
  const destroyed = new Set(currentState.destroyed || []);
  const hidden    = new Set(currentState.hiddenIndices || []);
  const hiddenNow = new Set(currentState.hiddenNow || []);

  const W = window.innerWidth, H = window.innerHeight;
  const barRect = actionBarEl.getBoundingClientRect();
  const barW = barRect.width, barH = barRect.height;

  const diceRects = [];
  for (let i = 0; i < scene.dieMeshes.length; i++) {
    const m = scene.dieMeshes[i];
    if (!m.visible) continue;
    const d = currentState.diceState?.[i];
    if (!d || d.locked) continue;
    if (destroyed.has(i) || hidden.has(i) || hiddenNow.has(i)) continue;
    const p = scene.worldToScreen([m.position.x, m.position.y, m.position.z]);
    diceRects.push({
      left: p.x - DIE_SCREEN_RADIUS,
      right: p.x + DIE_SCREEN_RADIUS,
      top: p.y - DIE_SCREEN_RADIUS,
      bottom: p.y + DIE_SCREEN_RADIUS,
    });
  }

  if (diceRects.length === 0) {
    resetActionBarPosition();
    return;
  }

  const tryPos = (cx) => {
    const left = cx - barW / 2;
    const right = cx + barW / 2;
    const top = H - DEFAULT_BAR_BOTTOM - barH;
    const bot = H - DEFAULT_BAR_BOTTOM;
    if (left < 8 || right > W - 8) return false;
    const rect = { left, right, top, bottom: bot };
    for (const dr of diceRects) if (rectsOverlap(dr, rect)) return false;
    return true;
  };

  const defaultCx = W / 2;
  if (tryPos(defaultCx)) {
    resetActionBarPosition();
    return;
  }

  // Subtle left-shift only (no random hopping). 30 px steps, capped at 250 px
  // total. If we can't clear within that range, just leave the bar centered.
  for (let shift = 30; shift <= 250; shift += 30) {
    const cx = defaultCx - shift;
    if (cx - barW / 2 < 8) break;
    if (tryPos(cx)) {
      actionBarEl.style.left = cx + 'px';
      actionBarEl.style.bottom = DEFAULT_BAR_BOTTOM + 'px';
      actionBarEl.style.transform = 'translateX(-50%)';
      return;
    }
  }
  // Couldn't find a clear nearby position — accept the overlap rather than
  // bouncing around. The player can still read the bar; dice can still be picked.
}

// ---- Module state ----
let mode = null;            // 'host' | 'client'
let host = null;            // HostNet
let client = null;          // ClientNet
let gameRoom = null;        // GameRoom (host only)
let myId = null;
let myName = 'Player';
let currentState = null;
let selection = new Set();  // dice indices selected for keep
let lastSettledLocked = null;

// ---- Remote cursors -------------------------------------------------------
// Each remote player gets a DOM cursor div tracked here by playerId. We update
// it whenever a 'cursor' event lands and remove it when the player disappears
// from state.players. The cursor SVG is a stylized pointer with a name label.
const _remoteCursors = new Map();
const CURSOR_SVG = `
  <svg viewBox="0 0 14 16" width="20" height="22" aria-hidden="true">
    <path d="M1.2,1.2 L1.2,13.4 L4.5,10.4 L7.4,15.2 L9.5,14.1 L6.7,9.4 L11.2,9.4 Z"/>
  </svg>
`;
function ensureCursorEl(playerId) {
  let el = _remoteCursors.get(playerId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'remote-cursor';
    el.innerHTML = CURSOR_SVG + '<div class="remote-cursor-name"></div>';
    document.body.appendChild(el);
    _remoteCursors.set(playerId, el);
  }
  return el;
}
function applyRemoteCursor(playerId, tableX, tableZ) {
  if (playerId === myId) return;
  const el = ensureCursorEl(playerId);
  // Project the sender's table-plane point back to OUR screen so the cursor
  // lands on the same in-world spot regardless of camera/window differences.
  const screen = scene.worldToScreen([tableX, 0, tableZ]);
  el.style.left = screen.x + 'px';
  el.style.top = screen.y + 'px';
  // colorForPlayer always returns a CSS hex string from PLAYER_COLORS, even
  // when state isn't ready yet (it falls back to PLAYER_COLORS[0]). Set the
  // CSS variable AND the path's fill attribute directly so cursor color
  // works regardless of SVG inheritance quirks.
  const color = colorForPlayer(currentState, playerId);
  if (color) {
    el.style.setProperty('--cursor-color', color);
    const path = el.querySelector('svg path');
    if (path) path.setAttribute('fill', color);
  }
  if (currentState) {
    const name = currentState.players?.find(p => p.id === playerId)?.name;
    if (name) el.querySelector('.remote-cursor-name').textContent = name;
  }
}
function pruneCursors(state) {
  if (!state || !state.players) return;
  const valid = new Set(state.players.map(p => p.id));
  for (const [pid, el] of _remoteCursors) {
    if (!valid.has(pid)) {
      el.remove();
      _remoteCursors.delete(pid);
    }
  }
}

// Local cursor → broadcast at ~30 Hz so other players see it without flooding.
// We send the world-space (table plane) point the mouse hovers over so every
// peer can re-project it through their own camera and see the cursor anchored
// to the table, not to a window-sized normalized coord that drifts between
// clients with different aspect ratios / parallax shifts.
let _lastCursorSentTs = 0;
function maybeSendCursor(clientX, clientY) {
  const now = performance.now();
  if (now - _lastCursorSentTs < 33) return;
  if (mode !== 'host' && mode !== 'client') return;
  const shop = document.getElementById('shop-modal');
  if (shop && !shop.classList.contains('hidden')) return;
  const p = scene.screenToTablePoint(clientX, clientY);
  if (!p) return; // ray missed the table (looking above the horizon)
  _lastCursorSentTs = now;
  sendAction({ name: 'cursor', x: p.x, z: p.z });
}
window.addEventListener('pointermove', (e) => maybeSendCursor(e.clientX, e.clientY));
window.addEventListener('touchmove', (e) => {
  const t = e.touches?.[0];
  if (t) maybeSendCursor(t.clientX, t.clientY);
}, { passive: true });

// ---- Lobby wiring ----
ui.bindLobby({
  onHost: () => startHost(),
  onJoin: () => startClient(),
});

ui.bindWaiting({
  onCopy: () => {},
  onStart: () => {
    if (mode === 'host') gameRoom.startGame(myId);
  },
});

// Unified hold-to-roll for both the Roll button (start of turn) and the Keep
// button (subsequent rolls / hot dice). Active player sends `shake_start` on
// mousedown — host flips `state.shaking = true`, every client locally drives
// the dice-shake audio loop. Release sends the action that triggers the roll:
//   Roll button   → request_roll
//   Keep button   → commit('reroll', selection)
// Bank stays a regular click.
let _rollHoldKind = null;
function startRollHold(btnId) {
  if (_rollHoldKind) return;
  if (!currentState) return;
  if (currentState.currentPlayerId !== myId) return;
  if (btnId === 'roll-btn' && currentState.phase === 'awaiting_roll') {
    _rollHoldKind = 'roll';
    document.getElementById('roll-btn')?.classList.add('held');
  } else if (btnId === 'keep-btn' && currentState.phase === 'awaiting_keep') {
    // Require a non-empty selection — the Keep button is disabled by the UI
    // when nothing is selected, so this is a belt-and-suspenders check.
    if (selection.size === 0) return;
    _rollHoldKind = 'keep';
    document.getElementById('keep-btn')?.classList.add('held');
  } else {
    return;
  }
  sendAction({ name: 'shake_start' });
}
function releaseRollHold() {
  if (!_rollHoldKind) return;
  const kind = _rollHoldKind;
  _rollHoldKind = null;
  document.getElementById('roll-btn')?.classList.remove('held');
  document.getElementById('keep-btn')?.classList.remove('held');
  if (kind === 'roll')      sendAction({ name: 'request_roll' });
  else if (kind === 'keep') commitSelection('reroll');
}

// Shake audio driver — synced to state.shaking, so every client hears the
// shake while the active player is holding. Cancel-on-stop kills any queued
// noise bursts so the shake doesn't keep ringing after release.
let _shakeActive = false;
// Tracks which dice were "in hand" last frame so we can flash them only on the
// transition from visible → hidden, not every state update during the shake.
let _prevInHandSet = new Set();
// Dice currently in their post-commit lerp into the kept row — incoming
// transforms events for these indices are ignored so they don't fight the
// client-side animation.
const _animatingDice = new Set();
function _shakePulse() {
  if (!_shakeActive) return;
  sfx.diceShake();
  scheduleAfter(320, _shakePulse);
}
function syncShakeAudio(state) {
  const want = !!(state && state.shaking);
  if (want && !_shakeActive) {
    _shakeActive = true;
    _shakePulse();
  } else if (!want && _shakeActive) {
    _shakeActive = false;
    sfx.cancelShake();
  }
}

ui.bindGame({
  onHold: startRollHold,
  onRelease: releaseRollHold,
  onKeepBank: () => commitSelection('bank'),
});

ui.bindEnd({
  onPlayAgain: () => sendAction({ name: 'rematch' }),
});

// ---- Aim mode (for items that need targeting) ----
let aimMode = null; // { itemId, type: 'point' | 'die', hint }
const reticleEl = document.getElementById('reticle');
const reticleHint = reticleEl.querySelector('.hint');

function enterAimMode(itemId, type, hint) {
  aimMode = { itemId, type, hint };
  reticleHint.textContent = hint;
  reticleEl.classList.remove('hidden');
  document.body.classList.add('aiming');
  document.body.classList.toggle('aiming-die', type === 'die');
}

function exitAimMode() {
  aimMode = null;
  reticleEl.classList.add('hidden');
  document.body.classList.remove('aiming', 'aiming-die');
}

window.addEventListener('mousemove', (e) => {
  if (!aimMode) return;
  reticleEl.style.left = e.clientX + 'px';
  reticleEl.style.top = e.clientY + 'px';
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && aimMode) exitAimMode();
});
window.addEventListener('contextmenu', (e) => {
  if (aimMode) { e.preventDefault(); exitAimMode(); }
});

// Click handler — handles both aim-mode targeting and normal dice selection
window.addEventListener('click', (e) => {
  if (e.target.closest('.overlay') || e.target.closest('#shop-btn') || e.target.closest('#mute-btn') || e.target.closest('#inventory') || e.target.closest('#action-bar')) return;

  // Aim-mode interception comes first
  if (aimMode) {
    if (aimMode.type === 'point') {
      const p = scene.pickTablePoint(e.clientX, e.clientY);
      if (p) {
        sendAction({ name: 'use_item', itemId: aimMode.itemId, params: { x: p.x, z: p.z } });
        exitAimMode();
      }
      return;
    } else if (aimMode.type === 'die') {
      const { index, point } = scene.pickDie(e.clientX, e.clientY);
      if (index >= 0) {
        sendAction({ name: 'use_item', itemId: aimMode.itemId, params: { dieIndex: index, hitPoint: point } });
        exitAimMode();
      }
      return;
    }
  }

  // Normal dice selection during awaiting_keep on my turn
  if (!currentState) return;
  if (currentState.phase !== 'awaiting_keep') return;
  if (currentState.currentPlayerId !== myId) return;
  const { index } = scene.pickDie(e.clientX, e.clientY);
  if (index < 0) return;
  if (currentState.diceState[index]?.locked) return;
  if ((currentState.destroyed || []).includes(index)) return;
  if ((currentState.hiddenNow || []).includes(index)) return;
  if (selection.has(index)) { selection.delete(index); sfx.deselectDie(); }
  else { selection.add(index); sfx.selectDie(); }
  redrawSelection();
  sendAction({ name: 'set_selection', indices: [...selection] });
});

// Shop wiring
ui.bindShop({
  onPurchase: (itemId) => sendAction({ name: 'purchase', itemId }),
  onUse:      (itemId) => {
    const item = ITEMS[itemId];
    if (item?.needsAim === 'point') {
      enterAimMode(itemId, 'point', `${item.icon} Click on the table to throw`);
    } else if (item?.needsAim === 'die') {
      // Weighted before any roll: no dice are on the table to aim at — pick at random.
      if (itemId === 'weighted' && currentState?.phase === 'awaiting_roll') {
        sendAction({ name: 'use_item', itemId });
        return;
      }
      let hint;
      if (itemId === 'weighted')      hint = `${item.icon} Click the die to weight toward 1`;
      else if (itemId === 'tornado')  hint = `${item.icon} Click a die to spin into a tornado`;
      else                            hint = `${item.icon} Click any un-locked die`;
      enterAimMode(itemId, 'die', hint);
    } else {
      sendAction({ name: 'use_item', itemId });
    }
  },
});

// ---- Host bootstrap ----
async function startHost() {
  myName = ui.readNameInput();
  if (!myName) { ui.setLobbyStatus('Enter your name first.'); return; }
  ui.persistName(myName);
  ui.setLobbyStatus('Connecting to peer network...');

  host = new HostNet();
  try {
    const id = await host.start();
    myId = id;
  } catch (err) {
    ui.setLobbyStatus('Could not connect to PeerJS network: ' + (err?.message || err));
    return;
  }

  gameRoom = new GameRoom({
    onState: (state) => {
      host.broadcast({ type: 'state', state });
      applyState(state);
    },
    onEvent: (event) => {
      host.broadcast({ type: 'event', event });
      applyEvent(event);
    },
  });
  gameRoom.setHostId(myId);
  gameRoom.addPlayer(myId, myName);

  host.on('connect', (peerId) => {
    // Wait for them to send a 'join' action with their name
  });
  host.on('disconnect', (peerId) => {
    gameRoom.removePlayer(peerId);
  });
  host.on('action', (fromId, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== 'action') return;
    const action = msg.action;
    if (!action) return;
    if (action.name === 'join') {
      gameRoom.addPlayer(fromId, action.value);
      // Catch the new peer up: state + a full dice snapshot (pos/quat/velocity)
      // so they see exactly what everyone else sees, even mid-roll.
      host.sendTo(fromId, { type: 'state', state: gameRoom.snapshot() });
      host.sendTo(fromId, { type: 'event', event: { type: 'dice_snapshot', dice: gameRoom.getFullDiceSnapshot() } });
    } else {
      gameRoom.handleAction(fromId, action);
    }
  });

  // Host's render-loop physics tick
  scene.onTick((dt) => {
    if (gameRoom) gameRoom.tick(dt);
  });

  mode = 'host';
  enterWaitingRoom(myId);
  ui.log(`Hosting as ${myName}.`);
}

// ---- Client bootstrap ----
function extractRoomCode(input) {
  const s = (input || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const r = u.searchParams.get('room');
    if (r) return r;
  } catch {}
  return s;
}

async function startClient() {
  const code = extractRoomCode(ui.readJoinCode());
  if (!code) { ui.setLobbyStatus('Enter a room link or code first.'); return; }
  myName = ui.readNameInput();
  if (!myName) { ui.setLobbyStatus('Enter your name first.'); return; }
  ui.persistName(myName);
  ui.setLobbyStatus('Connecting...');

  client = new ClientNet();
  try {
    const id = await client.start();
    myId = id;
  } catch (err) {
    ui.setLobbyStatus('Could not initialize peer: ' + (err?.message || err));
    return;
  }
  client.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'state') applyState(msg.state);
    else if (msg.type === 'event') applyEvent(msg.event);
  });
  client.on('close', () => {
    ui.log('Disconnected from host.', 'bust');
  });
  client.on('error', (err) => {
    ui.log('Network error: ' + (err?.message || err), 'bust');
  });

  try {
    await client.connect(code);
  } catch (err) {
    ui.setLobbyStatus('Connection failed: ' + (err?.message || err));
    return;
  }
  client.send({ type: 'action', action: { name: 'join', value: myName } });

  mode = 'client';
  enterWaitingRoom(code);
  ui.log(`Joined ${code}.`);
}

function enterWaitingRoom(roomCode) {
  ui.show('waiting');
  // Initial render before we have state
  ui.renderWaitingRoom({
    players: [{ id: myId, name: myName }],
    hostId: mode === 'host' ? myId : null,
    myId,
    roomCode,
    isHost: mode === 'host',
  });
}

// ---- State / event handlers (run on host AND client) ----
function applyState(state) {
  currentState = state;
  syncShakeAudio(state);

  if (state.phase === 'lobby') {
    scene.hideAllDice();
    scene.syncDookieZones([]);
    scene.setIceRink(false);
    ui.show('waiting');
    ui.setShopVisible(false);
    ui.renderWaitingRoom({
      players: state.players,
      hostId: state.hostId,
      myId,
      roomCode: state.hostId,
      isHost: state.hostId === myId,
    });
  } else if (state.phase === 'game_over') {
    ui.show('endScreen');
    ui.setShopVisible(false);
    ui.renderEnd(state, myId);
  } else {
    ui.show('gameUi');
    ui.setShopVisible(true);
    ui.renderShop(state, myId);
    ui.renderInventory(state, myId);
    ui.renderGameState(state, myId);

    // Lock rings reflect locked dice
    for (let i = 0; i < state.diceState.length; i++) {
      scene.setLocked(i, !!state.diceState[i].locked);
    }
    // Hide destroyed dice (saw blade victims), parked-for-roll dice, and currently sucked-away dice
    const destroyed = new Set(state.destroyed || []);
    const hidden = new Set(state.hiddenIndices || []);
    const hiddenNow = new Set(state.hiddenNow || []);
    for (let i = 0; i < 5; i++) {
      if (destroyed.has(i) || hidden.has(i) || hiddenNow.has(i)) scene.hideDie(i);
    }

    // Yellow tint on weighted dice
    const weighted = new Set(state.weightedDice || []);
    for (let i = 0; i < 5; i++) scene.setDieWeighted(i, weighted.has(i));

    // Dice "in hand" during the hold-to-roll shake — hidden until thrown.
    // Just before we hide them, fire a Q-style flash at each newly-disappearing
    // die so it pops out of existence in Star Trek TNG fashion.
    const newInHand = new Set(state.inHand || []);
    for (const i of newInHand) {
      if (!_prevInHandSet.has(i)) {
        const pos = scene.getDieScreenPos(i);
        if (pos) qFlash(pos.x, pos.y);
      }
    }
    _prevInHandSet = newInHand;
    scene.setInHand(state.inHand || []);

    // Surface effects
    scene.syncDookieZones(state.dookieZones || []);
    scene.setIceRink(!!state.iceRinkActive);

    // If we're not in awaiting_keep, clear local selection set
    if (state.phase !== 'awaiting_keep') {
      selection.clear();
    }

    // Remove cursors for players who've left the room.
    pruneCursors(state);

    // Render selection rings — local set for active player (responsive),
    // authoritative state.selection for spectators. Color = the active player's color.
    const isMyTurn = state.currentPlayerId === myId;
    const ringColor = colorHexForPlayer(state, state.currentPlayerId);
    if (isMyTurn) {
      for (let i = 0; i < 5; i++) scene.setSelected(i, selection.has(i), ringColor);
    } else {
      const remoteSel = new Set(state.selection || []);
      for (let i = 0; i < 5; i++) scene.setSelected(i, remoteSel.has(i), ringColor);
    }

    redrawSelection();
  }
}

function applyEvent(event) {
  if (!event || !event.type) return;
  switch (event.type) {
    case 'roll_started':
      selection.clear();
      for (let i = 0; i < 5; i++) scene.setSelected(i, false);
      // Hard-cut any lingering shake (queued setTimeouts, active sources, and
      // the recurring setInterval) before the toss whoosh fires.
      _shakeActive = false;
      sfx.cancelShake();
      sfx.tossDice();
      // Lift sticky hides so the new throw can reveal dice, then immediately
      // re-apply hides for anything that's still meant to stay hidden this
      // roll (destroyed dice, portable-hole victims) so the upcoming
      // transforms event can't flash them on screen.
      scene.clearForceHidden();
      if (currentState) {
        const destroyed = new Set(currentState.destroyed || []);
        const hiddenIdx = new Set(currentState.hiddenIndices || []);
        const hiddenNow = new Set(currentState.hiddenNow || []);
        for (let i = 0; i < 5; i++) {
          if (destroyed.has(i) || hiddenIdx.has(i) || hiddenNow.has(i)) scene.hideDie(i);
        }
      }
      ui.log('Dice rolling...');
      break;
    case 'collision':
      sfx.collide(event.kind, event.intensity);
      break;
    case 'cursor':
      applyRemoteCursor(event.playerId, event.x, event.z);
      break;
    case 'kept_animation': {
      // Each newly-or-still-locked die slides into its kept-row pose, one at
      // a time, perDieMs apart. During each lerp the index is masked from
      // streaming transforms so the animation isn't yanked around.
      const perDieMs = event.perDieMs || 250;
      const lerpMs = event.lerpMs || 350;
      for (let k = 0; k < event.targets.length; k++) {
        const t = event.targets[k];
        // Mark synchronously so the very next streaming transforms event (which
        // already carries the snapped kept positions) is masked out before the
        // deferred lerp gets a chance to start.
        _animatingDice.add(t.index);
        scheduleAfter(k * perDieMs, () => {
          scene.animateDieTransform(
            t.index,
            [t.x, t.y, t.z],
            [t.qx, t.qy, t.qz, t.qw],
            lerpMs,
            () => _animatingDice.delete(t.index),
          );
        });
      }
      break;
    }
    case 'selection_removed':
      // Server detected a die was disturbed mid-keep — sync local optimistic set.
      for (const i of event.indices || []) selection.delete(i);
      redrawSelection();
      break;
    case 'portable_hole_animate': {
      const ringHex = currentState && event.playerId
        ? colorHexForPlayer(currentState, event.playerId)
        : null;
      scene.playPortableHoleAnimation(event.dieIndex, event.position, ringHex);
      sfx.glide(900, 90, 0.5, 'sine', 0.32);
      break;
    }
    case 'blood_splat': {
      if (!event.point) break;
      const screen = scene.worldToScreen(event.point);
      bloodSplat(screen.x, screen.y, 24 + Math.floor((event.intensity || 0.5) * 18));
      break;
    }
    case 'score': {
      const big = event.score >= 1000;
      if (big) sfx.scoreBig(); else sfx.scoreSmall(event.score);
      const where = centerOf(document.getElementById('action-bar'));
      scorePopup(`+${event.score}`, where.x, where.y - 60, { big });
      if (big) confettiBurst(where.x, where.y - 40, 50);
      else confettiBurst(where.x, where.y - 40, 16);
      break;
    }
    case 'bonus': {
      sfx.scoreBig();
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      scorePopup(`${event.label} +${event.score}`, cx, cy - 40, { bonus: true });
      confettiBurst(cx, cy - 20, 80);
      flashScreen('#ff3050', 0.35);
      break;
    }
    case 'turn_skipped': {
      sfx.turnSkipped();
      flashScreen('#ff5060', 0.22);
      break;
    }
    case 'bank': {
      const where = centerOf(document.getElementById('action-bar'));
      scorePopup(`BANKED +${event.banked}`, where.x, where.y - 40, { bank: true });

      // Unbanked dice Q-flash out instantly — they're not part of the bank,
      // so they vanish at the moment of click.
      for (const i of (event.remainingIndices || [])) {
        const pos = scene.getDieScreenPos(i);
        if (pos) qFlash(pos.x, pos.y);
        scene.hideDie(i);
      }

      // Banked dice are still lerping into the keep row — defer the coin
      // bursts until the lerp completes, then re-read screen positions (now at
      // the kept-row) and fire them left-to-right, perBurstMs apart.
      const lerpDelay = event.lerpDelayMs || 0;
      const perBurst = event.perBurstMs || 750;
      scheduleAfter(lerpDelay, () => {
        const bankedSeq = (event.indices || [])
          .map(i => ({ i, pos: scene.getDieScreenPos(i) }))
          .filter(d => d.pos)
          .sort((a, b) => a.pos.x - b.pos.x);
        for (let k = 0; k < bankedSeq.length; k++) {
          const { i, pos } = bankedSeq[k];
          scheduleAfter(k * perBurst, () => {
            sfx.bank();
            coinBurst(pos.x, pos.y, 18);
            scene.hideDie(i);
          });
        }
      });

      // Plus the existing center-of-screen shower scaled with banked points.
      const count = Math.min(220, 20 + Math.floor(event.banked / 50));
      const durMs = Math.min(8000, 800 + event.banked * 1.5);
      coinShower(where.x, where.y - 30, count, durMs);
      flashScreen('#7cf3a0', 0.18);
      break;
    }
    case 'bust': {
      sfx.bust();
      const banner = document.getElementById('turn-banner');
      banner?.classList.add('bust');
      scheduleAfter(1200, () => banner?.classList.remove('bust'));
      shake(document.getElementById('canvas-root'), 8, 500);
      flashScreen('#ff4d68', 0.3);
      const where = centerOf(banner);
      scorePopup(`BUST! −${event.lost}`, where.x, where.y + 60, { bust: true });
      // Every die on the table Q-flashes out simultaneously.
      for (const i of (event.indices || [])) {
        const pos = scene.getDieScreenPos(i);
        if (pos) qFlash(pos.x, pos.y);
        scene.hideDie(i);
      }
      break;
    }
    case 'hot_dice': {
      sfx.hotDice();
      const banner = document.getElementById('turn-banner');
      banner?.classList.add('hot');
      scheduleAfter(2400, () => banner?.classList.remove('hot'));
      flashScreen('#ffd400', 0.3);
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      confettiBurst(cx, cy, 80);
      scorePopup('🔥 HOT DICE 🔥', cx, cy - 80, { big: true });
      break;
    }
    case 'transforms':
      for (let i = 0; i < event.t.length; i++) {
        if (_animatingDice.has(i)) continue;
        const t = event.t[i];
        scene.setDieTransform(i, [t[0], t[1], t[2]], [t[3], t[4], t[5], t[6]], true);
      }
      // Visibility may have flipped; re-apply lock rings from the latest state.
      if (currentState && currentState.diceState) {
        for (let i = 0; i < currentState.diceState.length; i++) {
          scene.setLocked(i, !!currentState.diceState[i].locked);
        }
      }
      break;
    case 'dice_snapshot':
      for (let i = 0; i < event.dice.length; i++) {
        const d = event.dice[i];
        scene.setDieTransform(i, d.pos, d.quat, true);
      }
      if (currentState && currentState.diceState) {
        for (let i = 0; i < currentState.diceState.length; i++) {
          scene.setLocked(i, !!currentState.diceState[i].locked);
        }
      }
      break;
    case 'roll_settled':
      lastSettledLocked = event.locked;
      ui.log('Rolled: ' + event.values.map((v, i) => event.locked[i] ? `[${v}]` : v).join(' '));
      break;
    case 'log':
      ui.log(event.text, event.kind || '');
      break;
    case 'purchase': {
      sfx.bank();
      const btn = document.getElementById('shop-btn');
      if (btn) {
        const r = btn.getBoundingClientRect();
        coinShower(r.left + r.width / 2, r.top + r.height / 2, 12, 600);
      }
      break;
    }
    case 'item_used': {
      const idMap = {
        weighted:      () => sfx.thump(),
        portable_hole: () => sfx.portableHole(),
        flick:         () => sfx.slap(),
        dookie:        () => sfx.fart(),
        ice_rink:      () => sfx.swordUnsheathe(),
        tornado:       () => sfx.tableSaw(8),
      };
      idMap[event.itemId]?.();
      const item = ITEMS[event.itemId];
      // Activating player's color tints both the announcement sign and the
      // comic burst so observers can tell at a glance who pulled the trigger.
      const playerColor = currentState
        ? colorForPlayer(currentState, event.playerId)
        : null;
      if (item) {
        const px = window.innerWidth - 200;
        const py = window.innerHeight - 100;
        scorePopup(`${item.icon} ${item.name}!`, px, py, { big: true, color: playerColor });
      }
      flashScreen('#ffd400', 0.18);
      if (event.itemId === 'flick' && Array.isArray(event.hitPoint)) {
        const screen = scene.worldToScreen(event.hitPoint);
        comicBurstFlick(screen.x, screen.y, playerColor);
      }
      break;
    }
    case 'tornado_hit': {
      sfx.whack();
      if (Array.isArray(event.point)) {
        const screen = scene.worldToScreen(event.point);
        comicBurstHit(screen.x, screen.y);
      }
      break;
    }
    case 'game_over': {
      sfx.win();
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      for (let i = 0; i < 6; i++) {
        scheduleAfter(i * 350, () => {
          confettiBurst(cx + (Math.random() - 0.5) * 400, cy + (Math.random() - 0.5) * 200, 50);
          coinShower(cx + (Math.random() - 0.5) * 400, cy, 20);
        });
      }
      flashScreen('#ffd400', 0.45);
      break;
    }
  }
}

function redrawSelection() {
  // Active player drives rings from their LOCAL selection (responsive); every
  // other player mirrors the authoritative state.selection so they see what
  // the active player is picking in real time.
  const activeIsMe = currentState && currentState.currentPlayerId === myId;
  const ringColor = currentState
    ? colorHexForPlayer(currentState, currentState.currentPlayerId)
    : 0xffe07a;
  const shown = activeIsMe ? selection : new Set(currentState?.selection || []);
  for (let i = 0; i < 5; i++) {
    scene.setSelected(i, shown.has(i), ringColor);
  }
  if (!currentState) return;
  const values = [...selection].map(i => currentState.diceState[i]?.value).filter(v => v != null);

  // Count dice that the player can actually pick from (un-locked, not destroyed/parked).
  const destroyed = new Set(currentState.destroyed || []);
  const hidden    = new Set(currentState.hiddenIndices || []);
  const hiddenNow = new Set(currentState.hiddenNow || []);
  let eligibleCount = 0;
  for (let i = 0; i < currentState.diceState.length; i++) {
    const d = currentState.diceState[i];
    if (!d || d.locked) continue;
    if (destroyed.has(i) || hidden.has(i) || hiddenNow.has(i)) continue;
    eligibleCount++;
  }
  ui.updateSelectionUI(values, currentState.turnPoints, { eligibleCount });
}

function commitSelection(action) {
  if (!currentState || currentState.phase !== 'awaiting_keep') return;
  if (currentState.currentPlayerId !== myId) return;
  const indices = [...selection];
  if (indices.length === 0) return;
  sendAction({ name: 'commit', action, indices });
  selection.clear();
  for (let i = 0; i < 5; i++) scene.setSelected(i, false);
}

function sendAction(action) {
  if (mode === 'host') {
    gameRoom.handleAction(myId, action);
  } else if (mode === 'client') {
    client.send({ type: 'action', action });
  }
}
