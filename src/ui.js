import { evaluateKeep } from './rules.js';
import { ITEMS, isUsable } from './items.js';

const $ = (id) => document.getElementById(id);

const els = {
  lobby: () => $('lobby'),
  waiting: () => $('waiting'),
  gameUi: () => $('game-ui'),
  endScreen: () => $('end-screen'),
  shopModal: () => $('shop-modal'),
  shopBtn: () => $('shop-btn'),
  shopClose: () => $('shop-close'),
  shopGrid: () => $('shop-grid'),
  shopBalance: () => $('shop-balance'),
  inventory: () => $('inventory'),
  nameInput: () => $('name-input'),
  joinCode: () => $('join-code'),
  hostBtn: () => $('host-btn'),
  joinBtn: () => $('join-btn'),
  lobbyStatus: () => $('lobby-status'),
  roomCode: () => $('room-code'),
  copyCode: () => $('copy-code'),
  playerList: () => $('player-list'),
  startBtn: () => $('start-btn'),
  hostControls: () => $('host-controls'),
  waitingTag: () => $('waiting-tag'),
  scoreboard: () => $('scoreboard'),
  turnBanner: () => $('turn-banner'),
  selectionInfo: () => $('selection-info'),
  rollBtn: () => $('roll-btn'),
  keepBtn: () => $('keep-btn'),
  bankBtn: () => $('bank-btn'),
  log: () => $('log'),
  endTitle: () => $('end-title'),
  finalScores: () => $('final-scores'),
  playAgainBtn: () => $('play-again-btn'),
};

export function show(which) {
  const all = ['lobby', 'waiting', 'gameUi', 'endScreen'];
  for (const k of all) els[k]().classList.add('hidden');
  els[which]().classList.remove('hidden');
}

export function setLobbyStatus(text) {
  els.lobbyStatus().textContent = text || '';
}

export function readNameInput() {
  return (els.nameInput().value || '').trim().slice(0, 16);
}

export function readJoinCode() {
  return (els.joinCode().value || '').trim();
}

export function bindLobby({ onHost, onJoin }) {
  els.hostBtn().addEventListener('click', onHost);
  els.joinBtn().addEventListener('click', onJoin);
  // Convenience: enter to host (if no code) or join (if code present)
  els.nameInput().addEventListener('keydown', e => {
    if (e.key === 'Enter') els.hostBtn().click();
  });
  els.joinCode().addEventListener('keydown', e => {
    if (e.key === 'Enter') els.joinBtn().click();
  });

  // Prefill saved name
  const saved = localStorage.getItem('diceName');
  if (saved) els.nameInput().value = saved;

  // If URL has ?room= , prefill the code and focus the name field so the
  // arriving friend's first action is to type their name.
  const url = new URL(window.location.href);
  const room = url.searchParams.get('room');
  if (room) {
    els.joinCode().value = room;
    setTimeout(() => els.nameInput().focus(), 0);
  }
}

export function persistName(name) {
  try { localStorage.setItem('diceName', name); } catch {}
}

export function buildRoomUrl(roomCode) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set('room', roomCode);
  return url.toString();
}

export function renderWaitingRoom({ players, hostId, myId, roomCode, isHost }) {
  els.roomCode().textContent = roomCode ? buildRoomUrl(roomCode) : '';
  const list = els.playerList();
  list.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = p.name + (p.id === myId ? ' (you)' : '');
    const right = document.createElement('span');
    if (p.id === hostId) {
      right.className = 'badge';
      right.textContent = 'host';
    }
    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  }
  els.hostControls().style.display = isHost ? 'flex' : 'none';
  els.waitingTag().textContent = isHost
    ? (players.length < 2 ? 'You can play solo, or wait for friends to join.' : '')
    : 'Waiting for host to start the game.';
  els.startBtn().disabled = players.length < 1;
}

export function bindWaiting({ onCopy, onStart }) {
  els.copyCode().addEventListener('click', () => {
    const raw = (els.roomCode().textContent || '').trim();
    // If the element somehow contains a bare peer id, normalize to a full URL.
    const link = raw && !raw.includes('://') ? buildRoomUrl(raw) : raw;
    if (!link) return;
    navigator.clipboard?.writeText(link).catch(() => {});
    els.copyCode().textContent = 'Copied!';
    setTimeout(() => { els.copyCode().textContent = 'Copy link'; }, 1200);
    onCopy?.();
  });
  els.startBtn().addEventListener('click', onStart);
}

export function bindGame({ onRoll, onKeepReroll, onKeepBank }) {
  els.rollBtn().addEventListener('click', onRoll);
  els.keepBtn().addEventListener('click', onKeepReroll);
  els.bankBtn().addEventListener('click', onKeepBank);
}

export function bindEnd({ onPlayAgain }) {
  els.playAgainBtn().addEventListener('click', onPlayAgain);
}

let lastScoreboardSig = '';

export function renderGameState(state, myId) {
  const phase = state.phase;
  const isMyTurn = state.currentPlayerId === myId;

  // Scoreboard
  const sb = els.scoreboard();
  const sig = JSON.stringify({ p: state.players.map(p => p.id + p.name), s: state.totalScores, c: state.currentPlayerId });
  if (sig !== lastScoreboardSig) {
    lastScoreboardSig = sig;
    sb.innerHTML = '<h3>Scoreboard</h3>';
    for (const p of state.players) {
      const row = document.createElement('div');
      row.className = 'score-row' + (p.id === state.currentPlayerId ? ' active' : '');
      const name = document.createElement('span');
      name.textContent = p.name + (p.id === myId ? ' (you)' : '');
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = state.totalScores[p.id] ?? 0;
      row.appendChild(name);
      row.appendChild(pts);
      sb.appendChild(row);
    }
  }

  // Turn banner
  const banner = els.turnBanner();
  let bannerText = '';
  if (phase === 'opening_roll' || phase === 'rolling' && state.openingActiveId) {
    const name = state.players.find(p => p.id === state.openingActiveId)?.name || '...';
    bannerText = `Opening roll: ${name}`;
  } else if (phase === 'awaiting_roll') {
    const name = state.players.find(p => p.id === state.currentPlayerId)?.name || '...';
    bannerText = isMyTurn ? 'Your turn — roll!' : `${name}'s turn`;
  } else if (phase === 'rolling') {
    bannerText = 'Rolling...';
  } else if (phase === 'awaiting_keep') {
    const name = state.players.find(p => p.id === state.currentPlayerId)?.name || '...';
    bannerText = isMyTurn ? 'Pick scoring dice' : `${name} is picking dice`;
  } else if (phase === 'busted') {
    bannerText = 'BUST!';
  } else if (phase === 'game_over') {
    bannerText = 'Game over';
  } else {
    bannerText = '';
  }
  if (state.turnPoints > 0) {
    bannerText += `<span class="turn-pts">+${state.turnPoints} this turn</span>`;
  }
  banner.innerHTML = bannerText;

  // Action buttons
  els.rollBtn().disabled = !(phase === 'awaiting_roll' && isMyTurn);
  // keep+bank buttons activated during awaiting_keep & my turn (further gated by selection validity in updateSelectionUI)
  const inKeepPhase = phase === 'awaiting_keep' && isMyTurn;
  els.rollBtn().style.display = inKeepPhase ? 'none' : '';
  els.keepBtn().style.display = inKeepPhase ? '' : 'none';
  els.bankBtn().style.display = inKeepPhase ? '' : 'none';
}

export function updateSelectionUI(selectedValues, turnPoints) {
  const info = els.selectionInfo();
  if (selectedValues.length === 0) {
    info.innerHTML = `<span>Click dice to keep them. <strong>+${turnPoints}</strong> banked this turn.</span>`;
    els.keepBtn().disabled = true;
    els.bankBtn().disabled = true;
    return;
  }
  const r = evaluateKeep(selectedValues);
  if (!r.valid) {
    info.innerHTML = `<span class="reject">${r.reason}</span>`;
    els.keepBtn().disabled = true;
    els.bankBtn().disabled = true;
  } else {
    info.innerHTML = `<span class="accept">Selection scores +${r.score}</span>`;
    els.keepBtn().disabled = false;
    els.bankBtn().disabled = false;
  }
}

let logEntries = 0;
export function log(text, kind = '') {
  const log = els.log();
  const e = document.createElement('div');
  e.className = 'entry' + (kind ? ' ' + kind : '');
  e.textContent = text;
  log.appendChild(e);
  log.scrollTop = log.scrollHeight;
  logEntries++;
  // Trim old entries
  while (logEntries > 80 && log.firstChild) {
    log.removeChild(log.firstChild);
    logEntries--;
  }
}

export function clearLog() {
  els.log().innerHTML = '';
  logEntries = 0;
}

// ---- Shop modal ----

let _shopHandlers = null;

export function bindShop({ onPurchase, onUse }) {
  _shopHandlers = { onPurchase, onUse };
  els.shopBtn().addEventListener('click', () => {
    els.shopModal().classList.remove('hidden');
  });
  els.shopClose().addEventListener('click', () => {
    els.shopModal().classList.add('hidden');
  });
  els.shopModal().addEventListener('click', (e) => {
    if (e.target === els.shopModal()) els.shopModal().classList.add('hidden');
  });
}

export function setShopVisible(visible) {
  els.shopBtn().classList.toggle('hidden', !visible);
  if (!visible) els.shopModal().classList.add('hidden');
}

export function renderShop(state, myId) {
  const balance = state?.totalScores?.[myId] ?? 0;
  els.shopBalance().textContent = balance;

  const grid = els.shopGrid();
  grid.innerHTML = '';
  const myInv = (state?.inventories?.[myId]) || {};
  for (const [id, item] of Object.entries(ITEMS)) {
    const card = document.createElement('div');
    card.className = 'shop-card';
    const owned = myInv[id] || 0;
    const canAfford = balance >= item.cost;
    card.innerHTML = `
      <div class="icon">${item.icon}</div>
      <div class="name">${item.name}</div>
      <div class="desc">${item.desc}</div>
      <div class="footer">
        <span class="cost">${item.cost}</span>
        ${owned > 0 ? `<span class="own">×${owned} owned</span>` : ''}
        <button data-buy="${id}" ${canAfford ? '' : 'disabled'}>Buy</button>
      </div>
    `;
    grid.appendChild(card);
  }
  // Wire buy buttons (re-bound each render because innerHTML wipes them)
  grid.querySelectorAll('button[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => {
      _shopHandlers?.onPurchase?.(btn.dataset.buy);
    });
  });
}

export function renderInventory(state, myId) {
  const tray = els.inventory();
  if (!state || state.phase === 'lobby' || state.phase === 'game_over') {
    tray.classList.add('hidden');
    return;
  }
  const inv = (state.inventories?.[myId]) || {};
  const ids = Object.keys(inv).filter(id => inv[id] > 0);
  if (!ids.length) {
    tray.classList.add('hidden');
    tray.innerHTML = '';
    return;
  }
  tray.classList.remove('hidden');
  tray.innerHTML = '';
  const isMyTurn = state.currentPlayerId === myId;
  for (const id of ids) {
    const item = ITEMS[id];
    if (!item) continue;
    const usable = isUsable(item, { phase: state.phase, isMyTurn });
    const el = document.createElement('div');
    el.className = 'inv-item' + (usable ? ' usable' : ' disabled');
    el.title = item.desc + (usable ? '' : ' (not usable right now)');
    el.innerHTML = `<span class="ic">${item.icon}</span><span class="ct">×${inv[id]}</span>`;
    if (usable) {
      el.addEventListener('click', () => {
        _shopHandlers?.onUse?.(id);
      });
    }
    tray.appendChild(el);
  }
}

export function renderEnd(state, myId) {
  const list = els.finalScores();
  list.innerHTML = '';
  const sorted = state.players.slice().sort((a, b) => (state.totalScores[b.id] || 0) - (state.totalScores[a.id] || 0));
  const top = state.totalScores[sorted[0]?.id] || 0;
  for (const p of sorted) {
    const li = document.createElement('li');
    if ((state.totalScores[p.id] || 0) === top) li.className = 'winner';
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === myId ? ' (you)' : '');
    const pts = document.createElement('span');
    pts.textContent = state.totalScores[p.id] || 0;
    li.appendChild(name);
    li.appendChild(pts);
    list.appendChild(li);
  }
  els.endTitle().textContent = sorted[0] ? `${sorted[0].name} wins!` : 'Game over';
}
