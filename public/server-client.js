const serverState = {
  room: null,
  playerId: localStorage.getItem('mahjongPlayerId') || '',
  eventSource: null,
  localStarted: false
};

function api(path, options = {}) {
  return fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  });
}

function roomCodeDisplay(code) {
  return code ? `${code.slice(0, 3)} ${code.slice(3)}` : '—— ——';
}

function showRoom(room) {
  serverState.room = room;
  const me = room.players.find(player => player.id === serverState.playerId);
  if (window.gameState) {
    window.gameState.room = room.code;
    window.gameState.name = me?.name || window.gameState.name;
  }
  $('roomCodeLabel').textContent = room.code;
  $('roomCodePreview').textContent = roomCodeDisplay(room.code);
  $('roundLabel').textContent = room.round;
  $('lobbyName').textContent = me?.name || room.players[0]?.name || '牌友';
  $('meLabel').textContent = `${me?.name || '牌友'} · 你`;
  $('scoreList').innerHTML = room.players.map(player => `
    <div class="score-row ${player.id === serverState.playerId ? 'active' : ''}">
      <span>${player.id === serverState.playerId ? '你 · ' : ''}${player.name}</span>
      <b>${player.score.toLocaleString('zh-CN')}</b>
    </div>`).join('');

  const startButton = $('startRoomBtn');
  if (startButton) startButton.style.display = me?.isHost && room.status !== 'playing' ? 'inline-block' : 'none';

  if (room.status === 'playing') {
    showView('game');
    if (!serverState.localStarted) {
      serverState.localStarted = true;
      startGame();
    }
  }
}

function subscribeRoom() {
  if (serverState.eventSource) serverState.eventSource.close();
  serverState.eventSource = new EventSource(`/api/events?room=${serverState.room.code}&playerId=${serverState.playerId}`);
  serverState.eventSource.addEventListener('room', event => showRoom(JSON.parse(event.data)));
  serverState.eventSource.addEventListener('settlement', event => {
    const data = JSON.parse(event.data);
    showRoom(data.room);
    const lines = data.settlement.changes.map(line => `<div><span>${line.name}</span><b>${line.change > 0 ? '+' : ''}${line.change}</b></div>`).join('');
    openModal(`<h2>自动计分完成</h2><p>${data.settlement.winnerName} 胡牌，${data.settlement.fan} 番，底分 ${data.settlement.base}。</p><div class="result-lines">${lines}</div><div class="modal-actions"><button class="primary" id="closeServerResult">知道了</button></div>`);
    $('closeServerResult').onclick = closeModal;
  });
}

function createServerRoom() {
  const name = $('nameInput').value.trim() || '蜀中客';
  api('/api/rooms', { method: 'POST', body: JSON.stringify({ name, baseScore: 2 }) })
    .then(data => {
      serverState.playerId = data.playerId;
      serverState.localStarted = false;
      localStorage.setItem('mahjongPlayerId', data.playerId);
      showRoom(data.room);
      subscribeRoom();
      showView('room');
      updateLobby();
      toast('房间已创建，点击“开始一局”即可进入牌桌。');
    })
    .catch(error => toast(error.message));
}

function joinServerRoom() {
  const code = $('joinCodeInput').value.trim().toUpperCase();
  const name = $('joinNameInput').value.trim() || '锦江过客';
  if (code.length !== 6) return toast('请输入六位房间号');
  api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ name }) })
    .then(data => {
      serverState.playerId = data.playerId;
      serverState.localStarted = false;
      localStorage.setItem('mahjongPlayerId', data.playerId);
      showRoom(data.room);
      subscribeRoom();
      showView('room');
      toast('已加入私人房间。');
    })
    .catch(error => toast(error.message));
}

function startServerGame() {
  if (typeof startGame !== 'function') return toast('牌桌脚本没有加载，请按 Ctrl+F5 刷新页面');
  if (!serverState.room) return toast('请先创建房间');
  api(`/api/rooms/${serverState.room.code}/start`, {
    method: 'POST',
    body: JSON.stringify({ playerId: serverState.playerId })
  }).then(showRoom).catch(error => toast(error.message));
}

function settleServerGame(winnerId, fan, base) {
  if (!serverState.room) return Promise.resolve();
  return api(`/api/rooms/${serverState.room.code}/settle`, {
    method: 'POST',
    body: JSON.stringify({ playerId: serverState.playerId, winnerId, fan, base })
  });
}

$('createBtn').onclick = () => { showView('room'); serverState.room = null; updateLobby(); };
$('joinBtn').onclick = () => showView('join');
$('makeRoomBtn').onclick = createServerRoom;
$('randomRoomBtn').onclick = createServerRoom;
$('enterRoomBtn').onclick = joinServerRoom;
$('startRoomBtn').onclick = startServerGame;

const baseHu = window.hu;
window.hu = () => {
  const me = serverState.room?.players.find(player => player.id === serverState.playerId);
  if (me && serverState.room.status === 'playing') {
    settleServerGame(me.id, 1, serverState.room.settings.baseScore).catch(error => toast(error.message));
  }
  baseHu();
};


