import { Scene } from './scene.js';
import { GameRoom } from './game.js';
import { HostNet, ClientNet } from './net.js';
import * as ui from './ui.js';
import { SoundFX } from './audio.js';
import { confettiBurst, coinShower, scorePopup, flashScreen, shake, centerOf } from './effects.js';
import { ITEMS } from './items.js';

// ---- Bootstrap scene + audio ----
const scene = new Scene(document.getElementById('canvas-root'));
const sfx = new SoundFX();

// Browsers block audio until a user gesture — wake on first interaction.
const wakeAudio = () => { sfx.resume(); window.removeEventListener('pointerdown', wakeAudio); window.removeEventListener('keydown', wakeAudio); };
window.addEventListener('pointerdown', wakeAudio);
window.addEventListener('keydown', wakeAudio);

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

ui.bindGame({
  onRoll: () => sendAction({ name: 'request_roll' }),
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
      enterAimMode(itemId, 'die', `${item.icon} Click any un-locked die to flick`);
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
    scene.setIceRink(!!state.iceRinkUntilTs && state.iceRinkUntilTs > Date.now());

    // If we're not in awaiting_keep, clear local selection set
    if (state.phase !== 'awaiting_keep') {
      selection.clear();
    }

    // Render selection rings — local set for active player (responsive),
    // authoritative state.selection for spectators.
    const isMyTurn = state.currentPlayerId === myId;
    if (isMyTurn) {
      for (let i = 0; i < 5; i++) scene.setSelected(i, selection.has(i), 0xffe07a);
    } else {
      const remoteSel = new Set(state.selection || []);
      for (let i = 0; i < 5; i++) scene.setSelected(i, remoteSel.has(i), 0x88c8ff);
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
        weighted:      () => { sfx.tone(880, 0.18, 'triangle', 0.22); sfx.tone(440, 0.25, 'sine', 0.2); },
        portable_hole: () => { sfx.glide(900, 120, 0.45, 'sine', 0.28); sfx.tone(60, 0.35, 'sine', 0.2); },
        flick:         () => { sfx.tone(1400, 0.05, 'square', 0.18); sfx.diceShake(); },
        dookie:        () => {
          // Shotgun blast + cascade of wet splats
          sfx.noiseBurst(0.07, 900, 0.4, 0.45);
          sfx.tone(60, 0.18, 'sine', 0.4);
          for (let i = 0; i < 6; i++) {
            setTimeout(() => sfx.noiseBurst(0.12 + Math.random() * 0.1, 160 + Math.random() * 220, 1.4, 0.22), 80 + i * 55 + Math.random() * 30);
          }
        },
        ice_rink:      () => { for (let i = 0; i < 8; i++) setTimeout(() => sfx.tone(1500 + i * 200, 0.18, 'sine', 0.18), i * 50); },
        saw_blade:     () => { sfx.glide(180, 250, 1.5, 'sawtooth', 0.32); sfx.glide(90, 110, 1.5, 'square', 0.25); },
      };
      idMap[event.itemId]?.();
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      const item = ITEMS[event.itemId];
      if (item) scorePopup(`${item.icon} ${item.name}!`, cx, cy - 60, { big: true });
      flashScreen('#ffd400', 0.18);
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
  ui.updateSelectionUI(values, currentState.turnPoints);
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
