import { Scene } from './scene.js';
import { GameRoom } from './game.js';
import { HostNet, ClientNet } from './net.js';
import * as ui from './ui.js';
import { SoundFX } from './audio.js';
import { confettiBurst, coinShower, scorePopup, flashScreen, shake, centerOf } from './effects.js';

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

// Click-to-select dice when it's my turn in awaiting_keep
window.addEventListener('click', (e) => {
  if (!currentState) return;
  if (currentState.phase !== 'awaiting_keep') return;
  if (currentState.currentPlayerId !== myId) return;
  if (e.target.closest('#game-ui') || e.target.closest('.overlay') || e.target.id === 'mute-btn') return;
  const idx = scene.pickDie(e.clientX, e.clientY);
  if (idx < 0) return;
  if (currentState.diceState[idx]?.locked) return;
  if (selection.has(idx)) { selection.delete(idx); sfx.deselectDie(); }
  else { selection.add(idx); sfx.selectDie(); }
  redrawSelection();
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
    ui.show('waiting');
    ui.renderWaitingRoom({
      players: state.players,
      hostId: state.hostId,
      myId,
      roomCode: state.hostId,
      isHost: state.hostId === myId,
    });
  } else if (state.phase === 'game_over') {
    ui.show('endScreen');
    ui.renderEnd(state, myId);
  } else {
    ui.show('gameUi');
    ui.renderGameState(state, myId);
    // Lock rings reflect locked dice
    for (let i = 0; i < state.diceState.length; i++) {
      scene.setLocked(i, !!state.diceState[i].locked);
    }
    // If we're not in awaiting_keep, clear selection
    if (state.phase !== 'awaiting_keep') {
      selection.clear();
      for (let i = 0; i < 5; i++) scene.setSelected(i, false);
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
      coinShower(where.x, where.y - 30, Math.min(60, 15 + Math.floor(event.banked / 100)));
      flashScreen('#7cf3a0', 0.18);
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
    if (action.name === 'start_game') gameRoom.startGame(myId);
    else if (action.name === 'request_roll') gameRoom.requestRoll(myId);
    else if (action.name === 'commit') gameRoom.commit(myId, action.action, action.indices);
    else if (action.name === 'rematch') gameRoom.rematch(myId);
  } else if (mode === 'client') {
    client.send({ type: 'action', action });
  }
}
