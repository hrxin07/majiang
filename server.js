const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();
const clients = new Map();

function makeCode() {
  let code;
  do code = crypto.randomBytes(4).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  while (rooms.has(code));
  return code;
}
function uid() { return crypto.randomUUID(); }
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function broadcast(room, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const member of room.players) {
    const res = clients.get(member.id);
    if (res && !res.writableEnded) res.write(payload);
  }
}
function playerView(player) {
  return { id: player.id, name: player.name, seat: player.seat, score: player.score, ready: player.ready, isHost: player.isHost };
}
function roomView(room) {
  return {
    code: room.code,
    createdAt: room.createdAt,
    status: room.status,
    settings: room.settings,
    players: room.players.map(playerView),
    round: room.round,
    lastSettlement: room.lastSettlement || null
  };
}
function getRoomAndPlayer(url) {
  const code = String(url.searchParams.get('room') || '').toUpperCase();
  const playerId = String(url.searchParams.get('playerId') || '');
  const room = rooms.get(code);
  const player = room?.players.find(p => p.id === playerId);
  return { room, player, code };
}
function calculateSettlement(room, body) {
  const winner = room.players.find(p => p.id === body.winnerId);
  if (!winner) throw new Error('获胜玩家不在房间中');
  const fan = Math.max(1, Math.min(16, Number(body.fan) || 1));
  const base = Math.max(1, Math.min(100, Number(body.base) || room.settings.baseScore));
  const payerIds = Array.isArray(body.payerIds) && body.payerIds.length
    ? body.payerIds.filter(id => id !== winner.id && room.players.some(p => p.id === id))
    : room.players.filter(p => p.id !== winner.id).map(p => p.id);
  if (!payerIds.length) throw new Error('至少需要一名付款玩家');
  const multiplier = 2 ** (fan - 1);
  const eachLoss = base * multiplier;
  let total = 0;
  const changes = room.players.map(player => {
    if (player.id === winner.id) return { playerId: player.id, name: player.name, change: 0 };
    const change = payerIds.includes(player.id) ? -eachLoss : 0;
    total += -change;
    return { playerId: player.id, name: player.name, change };
  });
  const winChange = changes.find(x => x.playerId === winner.id);
  winChange.change = total;
  for (const line of changes) room.players.find(p => p.id === line.playerId).score += line.change;
  room.round += 1;
  room.lastSettlement = { winnerId: winner.id, winnerName: winner.name, fan, base, multiplier, changes, at: new Date().toISOString() };
  return room.lastSettlement;
}
function parseJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 100_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('请求数据不是有效 JSON')); } });
    req.on('error', reject);
  });
}
function contentType(file) {
  const ext = path.extname(file);
  return ({ '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8' })[ext] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, rooms: rooms.size });
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const { room, player } = getRoomAndPlayer(url);
      if (!room || !player) return send(res, 404, { error: '房间或玩家不存在' });
      res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
      res.write(`event: connected\ndata: ${JSON.stringify(roomView(room))}\n\n`);
      clients.set(player.id, res);
      req.on('close', () => { if (clients.get(player.id) === res) clients.delete(player.id); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const body = await parseJson(req);
      const name = String(body.name || '牌友').trim().slice(0, 12) || '牌友';
      const code = makeCode();
      const host = { id: uid(), name, seat: 0, score: Number(body.initialScore) || 1000, ready: true, isHost: true };
      const room = { code, createdAt: new Date().toISOString(), status:'waiting', settings:{ baseScore: Math.max(1, Number(body.baseScore) || 2), mode:'换三张 · 定缺 · 血战到底' }, players:[host], round:1, lastSettlement:null };
      rooms.set(code, room);
      return send(res, 201, { room: roomView(room), playerId: host.id });
    }
    if (req.method === 'GET' && /^\/api\/rooms\/[A-Z0-9]{6}$/.test(url.pathname)) {
      const code = url.pathname.split('/').pop(); const room = rooms.get(code);
      return room ? send(res, 200, roomView(room)) : send(res, 404, { error:'房间不存在或已过期' });
    }
    if (req.method === 'POST' && /^\/api\/rooms\/[A-Z0-9]{6}\/join$/.test(url.pathname)) {
      const code = url.pathname.split('/')[3]; const room = rooms.get(code); const body = await parseJson(req);
      if (!room) return send(res, 404, { error:'房间不存在或已过期' });
      if (room.players.length >= 4) return send(res, 409, { error:'房间已满' });
      const name = String(body.name || '牌友').trim().slice(0, 12) || '牌友';
      const player = { id:uid(), name, seat:room.players.length, score:1000, ready:true, isHost:false };
      room.players.push(player); broadcast(room, 'room', roomView(room));
      return send(res, 200, { room:roomView(room), playerId:player.id });
    }
    if (req.method === 'POST' && /^\/api\/rooms\/[A-Z0-9]{6}\/start$/.test(url.pathname)) {
      const code = url.pathname.split('/')[3]; const room = rooms.get(code); const body = await parseJson(req);
      if (!room) return send(res, 404, { error:'房间不存在' });
      if (!room.players.some(p => p.id === body.playerId && p.isHost)) return send(res, 403, { error:'只有房主可以开始' });
      room.status = 'playing'; broadcast(room, 'room', roomView(room)); return send(res, 200, roomView(room));
    }
    if (req.method === 'POST' && /^\/api\/rooms\/[A-Z0-9]{6}\/settle$/.test(url.pathname)) {
      const code = url.pathname.split('/')[3]; const room = rooms.get(code); const body = await parseJson(req);
      if (!room) return send(res, 404, { error:'房间不存在' });
      if (!room.players.some(p => p.id === body.playerId)) return send(res, 403, { error:'玩家身份无效' });
      const settlement = calculateSettlement(room, body); broadcast(room, 'settlement', { room:roomView(room), settlement }); return send(res, 200, { room:roomView(room), settlement });
    }
    if (req.method === 'POST' && /^\/api\/rooms\/[A-Z0-9]{6}\/leave$/.test(url.pathname)) {
      const code = url.pathname.split('/')[3]; const room = rooms.get(code); const body = await parseJson(req);
      if (!room) return send(res, 404, { error:'房间不存在' });
      const index = room.players.findIndex(p => p.id === body.playerId);
      if (index >= 0) { room.players.splice(index, 1); room.players.forEach((p,i)=>p.seat=i); if(room.players[0]) room.players[0].isHost=true; }
      if (!room.players.length) rooms.delete(code); else broadcast(room, 'room', roomView(room));
      return send(res, 200, { ok:true });
    }
    if (req.method === 'GET') {
      const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
      const file = path.resolve(PUBLIC_DIR, requested);
      if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    return send(res, 405, { error:'方法不支持' });
  } catch (error) { return send(res, 400, { error:error.message || '请求失败' }); }
});
server.listen(PORT, () => console.log(`四川麻将服务已启动：http://localhost:${PORT}`));



