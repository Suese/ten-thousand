import { evaluateKeep } from './rules.js';
import { ITEMS, isUsable } from './items.js';
import { colorForPlayer } from './colors.js';
import { scheduleAfter } from './clock.js';

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
  shareDiscord: () => $('share-discord'),
  shareMessenger: () => $('share-messenger'),
  shareCopy: () => $('share-copy'),
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
  logPanel: () => $('log-panel'),
  logToggle: () => $('log-toggle'),
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
    scheduleAfter(0, () => els.nameInput().focus());
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

function currentRoomLink() {
  const raw = (els.roomCode().textContent || '').trim();
  if (!raw) return '';
  return raw.includes('://') ? raw : buildRoomUrl(raw);
}

function flashButton(btn, msg, ms = 1500) {
  const original = btn.textContent;
  btn.textContent = msg;
  scheduleAfter(ms, () => { btn.textContent = original; });
}

const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

async function tryWebShare(link) {
  if (!navigator.share) return false;
  try {
    await navigator.share({ url: link, title: 'Ten Thousand Dice', text: 'Join my dice game!' });
    return true;
  } catch (err) {
    // AbortError = user cancelled the share; treat as success-ish (don't fall back to copy)
    if (err?.name === 'AbortError') return true;
    return false;
  }
}

export function bindWaiting({ onCopy, onStart }) {
  // Copy Link — always copies the room URL to clipboard.
  els.shareCopy().addEventListener('click', () => {
    const link = currentRoomLink();
    if (!link) return;
    navigator.clipboard?.writeText(link).catch(() => {});
    flashButton(els.shareCopy(), '✅ Copied!');
    onCopy?.();
  });

  // Discord — no public sharer URL exists. The most useful chain is:
  //   1. Web Share API (mobile + Safari): native share sheet includes Discord if installed.
  //   2. Otherwise: copy + open Discord so the user pastes in their channel of choice.
  els.shareDiscord().addEventListener('click', async () => {
    const link = currentRoomLink();
    if (!link) return;
    navigator.clipboard?.writeText(link).catch(() => {});
    if (await tryWebShare(link)) {
      flashButton(els.shareDiscord(), '✅ Shared!');
      return;
    }
    flashButton(els.shareDiscord(), '✅ Copied — paste!');
    window.open('https://discord.com/channels/@me', '_blank', 'noopener,noreferrer');
  });

  // Messenger — proper chain:
  //   1. Mobile: fb-messenger://share/?link=URL deep link (official Messenger app share).
  //   2. Web Share API (Safari/Edge desktop, mobile fallback).
  //   3. Otherwise: copy + open messenger.com so the user pastes manually.
  els.shareMessenger().addEventListener('click', async () => {
    const link = currentRoomLink();
    if (!link) return;
    navigator.clipboard?.writeText(link).catch(() => {});
    if (isMobile()) {
      flashButton(els.shareMessenger(), '✅ Opening Messenger…');
      window.location.href = `fb-messenger://share/?link=${encodeURIComponent(link)}`;
      return;
    }
    if (await tryWebShare(link)) {
      flashButton(els.shareMessenger(), '✅ Shared!');
      return;
    }
    flashButton(els.shareMessenger(), '✅ Copied — paste!');
    window.open('https://www.messenger.com/', '_blank', 'noopener,noreferrer');
  });

  els.startBtn().addEventListener('click', onStart);
}

// Wire up the log minimize / restore toggle. Clicking flips the .minimized
// class on the panel; CSS handles the slide + fade animation.
{
  const toggle = els.logToggle();
  if (toggle) {
    toggle.addEventListener('click', () => {
      const panel = els.logPanel();
      if (!panel) return;
      panel.classList.toggle('minimized');
      const minimized = panel.classList.contains('minimized');
      toggle.title = minimized ? 'Expand log' : 'Minimize log';
      toggle.setAttribute('aria-label', minimized ? 'Expand log' : 'Minimize log');
    });
  }
}

export function bindGame({ onHold, onRelease, onKeepBank }) {
  // Both Roll and Keep buttons use hold-to-shake / release-anywhere-to-throw.
  // Bank stays a plain click — it doesn't roll dice.
  const wireHold = (btn) => {
    const onDown = (e) => {
      if (btn.disabled) return;
      e.preventDefault();
      onHold?.(btn.id);
    };
    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('touchstart', onDown, { passive: false });
  };
  wireHold(els.rollBtn());
  wireHold(els.keepBtn());
  window.addEventListener('mouseup', () => onRelease?.());
  window.addEventListener('touchend', () => onRelease?.());
  els.bankBtn().addEventListener('click', onKeepBank);
}

export function bindEnd({ onPlayAgain }) {
  els.playAgainBtn().addEventListener('click', onPlayAgain);
}

let lastScoreboardSig = '';

export function renderGameState(state, myId) {
  const phase = state.phase;
  const isMyTurn = state.currentPlayerId === myId;

  // Scoreboard — each player named in their assigned color
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
      name.style.color = colorForPlayer(state, p.id);
      name.style.fontWeight = '700';
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = state.totalScores[p.id] ?? 0;
      row.appendChild(name);
      row.appendChild(pts);
      sb.appendChild(row);
    }
  }

  // Turn banner — minimalist: colored player name + their current unbanked total. e.g. "Dan +100"
  const banner = els.turnBanner();
  let bannerText = '';
  if (phase === 'opening_roll' || (phase === 'rolling' && state.openingActiveId)) {
    const opener = state.players.find(p => p.id === state.openingActiveId);
    const c = colorForPlayer(state, state.openingActiveId);
    bannerText = `<span class="banner-name" style="color:${c}">${opener?.name || '...'}</span>`;
  } else if (phase === 'game_over') {
    bannerText = `<span class="banner-name">GAME OVER</span>`;
  } else if (phase === 'busted') {
    bannerText = `<span class="banner-bust">BUST!</span>`;
  } else if (state.bustPendingUntilTs && state.bustPendingUntilTs > Date.now()) {
    const player = state.players.find(p => p.id === state.currentPlayerId);
    const c = colorForPlayer(state, state.currentPlayerId);
    const remaining = Math.max(1, Math.ceil((state.bustPendingUntilTs - Date.now()) / 1000));
    bannerText = `<span class="banner-name" style="color:${c}">${player?.name || '...'}</span> <span class="banner-bust-pending">Bust in ${remaining}s</span>`;
  } else {
    const player = state.players.find(p => p.id === state.currentPlayerId);
    const c = colorForPlayer(state, state.currentPlayerId);
    const tp = state.turnPoints || 0;
    bannerText = `<span class="banner-name" style="color:${c}">${player?.name || '...'}</span> <span class="turn-pts">+${tp}</span>`;
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

// Per-frame ticker — lets the bust countdown AND the turn-start countdown
// decrement live without requiring the host to spam state updates every second.
// Also toggles the shake class on the banner whenever a critical countdown is
// active.
let _bannerLastShownSec = -1;
let _bannerLastShownKind = null;
export function tickBustCountdown(state, myId) {
  const banner = els.turnBanner();
  if (!state) return;

  // Bust grace takes priority.
  if (state.bustPendingUntilTs && state.bustPendingUntilTs > Date.now()) {
    if (!banner.classList.contains('shaking')) banner.classList.add('shaking');
    const remaining = Math.max(1, Math.ceil((state.bustPendingUntilTs - Date.now()) / 1000));
    if (remaining === _bannerLastShownSec && _bannerLastShownKind === 'bust') return;
    _bannerLastShownSec = remaining;
    _bannerLastShownKind = 'bust';
    const player = state.players.find(p => p.id === state.currentPlayerId);
    const c = colorForPlayer(state, state.currentPlayerId);
    banner.innerHTML =
      `<span class="banner-name" style="color:${c}">${player?.name || '...'}</span> ` +
      `<span class="banner-bust-pending">Bust in ${remaining}s</span>`;
    return;
  }

  // Play timer (awaiting_keep): only shown in the last 5 s, then expiry =
  // auto-bust on the host. Suppressed while bust grace is already pending
  // (handled above) so the two countdowns don't compete.
  if (
    state.phase === 'awaiting_keep'
    && state.playTimerTs
    && state.playTimerTs > Date.now()
    && state.playTimerTs - Date.now() <= 5000
  ) {
    if (!banner.classList.contains('shaking')) banner.classList.add('shaking');
    const remaining = Math.max(1, Math.ceil((state.playTimerTs - Date.now()) / 1000));
    if (remaining === _bannerLastShownSec && _bannerLastShownKind === 'play') return;
    _bannerLastShownSec = remaining;
    _bannerLastShownKind = 'play';
    const player = state.players.find(p => p.id === state.currentPlayerId);
    const c = colorForPlayer(state, state.currentPlayerId);
    banner.innerHTML =
      `<span class="banner-name" style="color:${c}">${player?.name || '...'}</span> ` +
      `<span class="turn-pts">+${state.turnPoints || 0}</span> ` +
      `<span class="banner-bust-pending">Skip in ${remaining}s</span>`;
    return;
  }

  // Turn-start auto-pass timeout.
  if (state.phase === 'awaiting_roll' && state.turnTimeoutTs && state.turnTimeoutTs > Date.now()) {
    const remaining = Math.max(1, Math.ceil((state.turnTimeoutTs - Date.now()) / 1000));
    // Shake when ≤ 5 s remaining for visual urgency.
    if (remaining <= 5) { if (!banner.classList.contains('shaking')) banner.classList.add('shaking'); }
    else { banner.classList.remove('shaking'); }
    if (remaining === _bannerLastShownSec && _bannerLastShownKind === 'pass') return;
    _bannerLastShownSec = remaining;
    _bannerLastShownKind = 'pass';
    const player = state.players.find(p => p.id === state.currentPlayerId);
    const c = colorForPlayer(state, state.currentPlayerId);
    const cls = remaining <= 5 ? 'banner-bust-pending' : 'banner-pass-pending';
    banner.innerHTML =
      `<span class="banner-name" style="color:${c}">${player?.name || '...'}</span> ` +
      `<span class="turn-pts">+${state.turnPoints || 0}</span> ` +
      `<span class="${cls}">Pass in ${remaining}s</span>`;
    return;
  }

  // No countdown active — clear our flags so the regular banner from
  // renderGameState stands.
  _bannerLastShownSec = -1;
  _bannerLastShownKind = null;
  banner.classList.remove('shaking');
}

export function updateSelectionUI(selectedValues, turnPoints, opts = {}) {
  const info = els.selectionInfo();
  const eligibleCount = opts.eligibleCount ?? -1;
  // "Hot dice imminent": the player has selected every eligible die. Locking them
  // all means the next roll uses all 5 — show only Roll, hide Bank.
  const hotDicePending = eligibleCount > 0 && selectedValues.length === eligibleCount;

  if (selectedValues.length === 0) {
    info.innerHTML = `<span>Click dice to keep them. <strong>+${turnPoints}</strong> banked this turn.</span>`;
    els.keepBtn().disabled = true;
    els.bankBtn().disabled = true;
    els.keepBtn().classList.remove('hot');
    els.bankBtn().style.display = '';
    return;
  }
  const r = evaluateKeep(selectedValues);
  if (!r.valid) {
    info.innerHTML = `<span class="reject">${r.reason}</span>`;
    els.keepBtn().disabled = true;
    els.bankBtn().disabled = true;
    els.keepBtn().classList.remove('hot');
    els.bankBtn().style.display = '';
  } else if (hotDicePending) {
    info.innerHTML = `<span class="accept">🔥 HOT DICE — keep all 5 for +${r.score} and roll again</span>`;
    els.keepBtn().disabled = false;
    els.keepBtn().classList.add('hot');
    els.bankBtn().style.display = 'none';
  } else {
    info.innerHTML = `<span class="accept">Selection scores +${r.score}</span>`;
    els.keepBtn().disabled = false;
    els.bankBtn().disabled = false;
    els.keepBtn().classList.remove('hot');
    els.bankBtn().style.display = '';
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
  // Sort items cheapest-first
  const items = Object.entries(ITEMS).sort((a, b) => a[1].cost - b[1].cost);

  for (const [id, item] of items) {
    const owned = myInv[id] || 0;
    const canAfford = balance >= item.cost;
    const card = document.createElement('button');
    card.className = 'shop-card' + (canAfford ? ' available' : ' broke');
    card.disabled = !canAfford;
    card.title = item.desc; // hover tooltip retains description
    card.innerHTML = `
      <div class="icon">${item.icon}</div>
      <div class="name">${item.name}</div>
      <div class="cost">${item.cost}</div>
      ${owned > 0 ? `<div class="own">×${owned}</div>` : ''}
    `;
    card.addEventListener('click', () => {
      _shopHandlers?.onPurchase?.(id);
    });
    grid.appendChild(card);
  }
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
