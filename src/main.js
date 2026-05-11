import { Scene } from './scene.js';
import { GameRoom } from './game.js';
import { HostNet, ClientNet } from './net.js';
import * as ui from './ui.js';
import { SoundFX } from './audio.js';
import { confettiBurst, coinShower, scorePopup, flashScreen, shake, centerOf, bloodSplat, comicBurstFlick, comicBurstHit } from './effects.js';
import { ITEMS } from './items.js';
import { colorHexForPlayer } from './colors.js';

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

// Live-update the bust countdown text every animation frame.
scene.onTick(() => {
  ui.tickBustCountdown(currentState, myId);
});

// Reposition the action bar so it doesn't obscure any die. Throttled to ~5 Hz
// so the move is smooth (CSS transition takes 0.35 s) and doesn't churn the
// layout every frame.
let _lastRepositionTs = 0;
scene.onTick(() => {
  const now = performance.now();
  if (now - _lastRepositionTs < 200) return;
  _lastRepositionTs = now;
  repositionActionBar();
});

const actionBarEl = document.getElementById('action-bar');
const DIE_SCREEN_RADIUS = 60;     // generous bound around each die in screen px
const DEFAULT_BAR_BOTTOM = 140;

function rectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function repositionActionBar() {
  if (!actionBarEl || actionBarEl.offsetParent === null) return;
  // Only nudge during active gameplay phases.
  if (!currentState || currentState.phase === 'lobby' || currentState.phase === 'game_over' || currentState.phase === 'opening_roll') {
    return;
  }
  const W = window.innerWidth, H = window.innerHeight;
  const barRect = actionBarEl.getBoundingClientRect();
  const barW = barRect.width, barH = barRect.height;

  // Collect visible-die screen rects.
  const diceRects = [];
  for (let i = 0; i < scene.dieMeshes.length; i++) {
    const m = scene.dieMeshes[i];
    if (!m.visible) continue;
    const p = scene.worldToScreen([m.position.x, m.position.y, m.position.z]);
    diceRects.push({
      left: p.x - DIE_SCREEN_RADIUS,
      right: p.x + DIE_SCREEN_RADIUS,
      top: p.y - DIE_SCREEN_RADIUS,
      bottom: p.y + DIE_SCREEN_RADIUS,
    });
  }

  // No dice visible → snap back to centered default.
  if (diceRects.length === 0) {
    if (actionBarEl.style.left || actionBarEl.style.bottom) {
      actionBarEl.style.left = '';
      actionBarEl.style.bottom = '';
      actionBarEl.style.transform = '';
    }
    return;
  }

  // Predicate: does a centered-at-cx, bottom=b position clear every die?
  const tryPos = (cx, bottom) => {
    const left = cx - barW / 2;
    const right = cx + barW / 2;
    const top = H - bottom - barH;
    const bot = H - bottom;
    if (left < 8 || right > W - 8 || top < 60 || bot > H - 8) return false;
    const rect = { left, right, top, bottom: bot };
    for (const dr of diceRects) {
      if (rectsOverlap(dr, rect)) return false;
    }
    return true;
  };

  const defaultCx = W / 2;
  if (tryPos(defaultCx, DEFAULT_BAR_BOTTOM)) {
    if (actionBarEl.style.left || actionBarEl.style.bottom) {
      actionBarEl.style.left = '';
      actionBarEl.style.bottom = '';
      actionBarEl.style.transform = '';
    }
    return;
  }

  // Step 1: try shifting left in 40 px increments until clear or out of room.
  for (let shift = 40; shift <= Math.min(600, defaultCx - barW / 2 - 8); shift += 40) {
    const cx = defaultCx - shift;
    if (tryPos(cx, DEFAULT_BAR_BOTTOM)) {
      actionBarEl.style.left = cx + 'px';
      actionBarEl.style.bottom = DEFAULT_BAR_BOTTOM + 'px';
      actionBarEl.style.transform = 'translateX(-50%)';
      return;
    }
  }

  // Step 2: random fallback — try 30 spots scattered around the lower half of
  // the screen until one is clear.
  for (let i = 0; i < 30; i++) {
    const cx = barW / 2 + 16 + Math.random() * (W - barW - 32);
    const bot = 80 + Math.random() * (H * 0.55);
    if (tryPos(cx, bot)) {
      actionBarEl.style.left = cx + 'px';
      actionBarEl.style.bottom = bot + 'px';
      actionBarEl.style.transform = 'translateX(-50%)';
      return;
    }
  }
  // If we couldn't find anything, leave the bar where it is rather than thrash.
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

// Hold-to-roll mechanic: pressing the Roll button starts the dice-shake
// audio (continuously) and tagging the button with a wiggle. Releasing the
// mouse / lifting the finger anywhere fires the actual roll. Adds tension.
let _rollHolding = false;
let _rollShakeInterval = null;
function startRollHold() {
  if (_rollHolding) return;
  if (!currentState || currentState.phase !== 'awaiting_roll') return;
  if (currentState.currentPlayerId !== myId) return;
  _rollHolding = true;
  sfx.diceShake();
  _rollShakeInterval = setInterval(() => sfx.diceShake(), 320);
  document.getElementById('roll-btn')?.classList.add('held');
}
function releaseRollHold() {
  if (!_rollHolding) return;
  _rollHolding = false;
  if (_rollShakeInterval) clearInterval(_rollShakeInterval);
  _rollShakeInterval = null;
  document.getElementById('roll-btn')?.classList.remove('held');
  sendAction({ name: 'request_roll' });
}

ui.bindGame({
  onRollHold: startRollHold,
  onRollRelease: releaseRollHold,
  onKeepReroll: () => commitSelection('reroll'),
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

    // Surface effects
    scene.syncDookieZones(state.dookieZones || []);
    scene.setIceRink(!!state.iceRinkActive);

    // If we're not in awaiting_keep, clear local selection set
    if (state.phase !== 'awaiting_keep') {
      selection.clear();
    }

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
      sfx.diceShake();
      ui.log('Dice rolling...');
      break;
    case 'collision':
      sfx.collide(event.kind, event.intensity);
      break;
    case 'selection_removed':
      // Server detected a die was disturbed mid-keep — sync local optimistic set.
      for (const i of event.indices || []) selection.delete(i);
      redrawSelection();
      break;
    case 'portable_hole_animate':
      scene.playPortableHoleAnimation(event.dieIndex, event.position);
      sfx.glide(900, 90, 0.5, 'sine', 0.32);
      break;
    case 'blood_splat': {
      if (!event.point) break;
      const screen = scene.worldToScreen(event.point);
      bloodSplat(screen.x, screen.y, 24 + Math.floor((event.intensity || 0.5) * 18));
      break;
    }
    case 'score': {
      const big = event.score >= 500;
      if (big) sfx.scoreBig(); else sfx.scoreSmall(event.score);
      const where = centerOf(document.getElementById('action-bar'));
      scorePopup(`+${event.score}`, where.x, where.y - 60, { big });
      if (big) confettiBurst(where.x, where.y - 40, 50);
      else confettiBurst(where.x, where.y - 40, 16);
      break;
    }
    case 'bank': {
      sfx.bank();
      const where = centerOf(document.getElementById('action-bar'));
      scorePopup(`BANKED +${event.banked}`, where.x, where.y - 40, { bank: true });
      // Scale celebration size + duration with banked points.
      // 100 pts ≈ 0.9s of coins; 1000 ≈ 2.3s; 3000 ≈ 5.3s; 10000 ≈ 8s (capped).
      const count = Math.min(220, 20 + Math.floor(event.banked / 50));
      const durMs = Math.min(8000, 800 + event.banked * 1.5);
      coinShower(where.x, where.y - 30, count, durMs);
      flashScreen('#7cf3a0', 0.18);
      // Extra cha-ching pulses spaced across the celebration for large banks
      const extras = Math.min(5, Math.floor(event.banked / 600));
      for (let i = 1; i <= extras; i++) {
        setTimeout(() => sfx.bank(), (durMs / (extras + 1)) * i);
      }
      break;
    }
    case 'bust': {
      sfx.bust();
      const banner = document.getElementById('turn-banner');
      banner?.classList.add('bust');
      setTimeout(() => banner?.classList.remove('bust'), 1200);
      shake(document.getElementById('canvas-root'), 8, 500);
      flashScreen('#ff4d68', 0.3);
      const where = centerOf(banner);
      scorePopup(`BUST! −${event.lost}`, where.x, where.y + 60, { bust: true });
      break;
    }
    case 'hot_dice': {
      sfx.hotDice();
      const banner = document.getElementById('turn-banner');
      banner?.classList.add('hot');
      setTimeout(() => banner?.classList.remove('hot'), 2400);
      flashScreen('#ffd400', 0.3);
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      confettiBurst(cx, cy, 80);
      scorePopup('🔥 HOT DICE 🔥', cx, cy - 80, { big: true });
      break;
    }
    case 'transforms':
      for (let i = 0; i < event.t.length; i++) {
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
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      const item = ITEMS[event.itemId];
      if (item) scorePopup(`${item.icon} ${item.name}!`, cx, cy - 60, { big: true });
      flashScreen('#ffd400', 0.18);
      // Cartoony comic burst at the flick hit point
      if (event.itemId === 'flick' && Array.isArray(event.hitPoint)) {
        const screen = scene.worldToScreen(event.hitPoint);
        comicBurstFlick(screen.x, screen.y);
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
        setTimeout(() => {
          confettiBurst(cx + (Math.random() - 0.5) * 400, cy + (Math.random() - 0.5) * 200, 50);
          coinShower(cx + (Math.random() - 0.5) * 400, cy, 20);
        }, i * 350);
      }
      flashScreen('#ffd400', 0.45);
      break;
    }
  }
}

function redrawSelection() {
  for (let i = 0; i < 5; i++) {
    scene.setSelected(i, selection.has(i));
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
