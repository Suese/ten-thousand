import { Scene } from './scene.js';
import { GameRoom } from './game.js';
import { HostNet, ClientNet } from './net.js';
import * as ui from './ui.js';

// ---- Bootstrap scene (always running so it's behind every screen) ----
const scene = new Scene(document.getElementById('canvas-root'));

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
  if (e.target.closest('#game-ui') || e.target.closest('.overlay')) return;
  const idx = scene.pickDie(e.clientX, e.clientY);
  if (idx < 0) return;
  if (currentState.diceState[idx]?.locked) return;
  if (selection.has(idx)) selection.delete(idx);
  else selection.add(idx);
  redrawSelection();
});

// ---- Host bootstrap ----
async function startHost() {
  myName = ui.readNameInput();
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
      gameRoom.addPlayer(fromId, action.name);
      // Catch the new peer up: state + a transforms snapshot so dice positions
      // appear instantly if a turn is already in progress.
      host.sendTo(fromId, { type: 'state', state: gameRoom.snapshot() });
      host.sendTo(fromId, { type: 'event', event: { type: 'transforms', t: gameRoom.getCurrentTransforms() } });
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
  client.send({ type: 'action', action: { name: 'join', name: myName } });

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
      ui.log('Dice rolling...');
      break;
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
    case 'roll_settled':
      lastSettledLocked = event.locked;
      ui.log('Rolled: ' + event.values.map((v, i) => event.locked[i] ? `[${v}]` : v).join(' '));
      break;
    case 'log':
      ui.log(event.text, event.kind || '');
      break;
    case 'game_over':
      // handled via state change
      break;
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
