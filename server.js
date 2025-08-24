// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.get('/', (_, res) => res.send('secret-server OK'));
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);

// ---- Socket.IO
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket'], // gerekirse ['websocket','polling'] yap
});

// Basit kuyruklar ve eşleşmeler
const queues = { chat: [], voice: [], face: [] };   // socket.id listeleri
const partners = new Map();                          // socket.id -> {peer, roomId, mode}

function dequeue(arr, id) {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
}

io.on('connection', (socket) => {
  console.log('connected', socket.id);

  socket.on('join', (modeRaw) => {
    const mode = (modeRaw || 'chat').toLowerCase();
    if (!['chat', 'voice', 'face'].includes(mode)) return;

    // zaten eşleştiyse önce ayır
    const p = partners.get(socket.id);
    if (p) {
      socket.leave(p.roomId);
      partners.delete(socket.id);
    }
    // kuyrukta varsa çıkarıp en sona ekle
    Object.values(queues).forEach(q => dequeue(q, socket.id));
    const q = queues[mode];

    if (q.length > 0) {
      const peerId = q.shift();
      if (peerId === socket.id || !io.sockets.sockets.get(peerId)) {
        // eş eskimişse devam
      }
      const roomId = `room_${mode}_${Date.now()}_${Math.random()
        .toString(36).slice(2, 8)}`;

      // odaya al
      socket.join(roomId);
      io.sockets.sockets.get(peerId)?.join(roomId);

      partners.set(socket.id, { peer: peerId, roomId, mode });
      partners.set(peerId, { peer: socket.id, roomId, mode });

      // iki tarafa da bildir
      io.to(socket.id).emit('matched', { roomId, mode, you: socket.id, peer: peerId });
      io.to(peerId).emit('matched', { roomId, mode, you: peerId, peer: socket.id });

      console.log('matched', mode, roomId, socket.id, '<->', peerId);
    } else {
      // kuyruğa ekle
      q.push(socket.id);
      io.to(socket.id).emit('queued', { mode, size: q.length });
      console.log('queued', mode, socket.id, 'size', q.length);
    }
  });

  // Chat mesajı
  socket.on('chat', (text) => {
    const p = partners.get(socket.id);
    if (!p) return;
    io.to(p.roomId).emit('chat', { from: socket.id, text, at: Date.now() });
  });

  // WebRTC sinyalleri (SDP/ICE)
  socket.on('signal', (payload) => {
    const p = partners.get(socket.id);
    if (!p) return;
    socket.to(p.roomId).emit('signal', { from: socket.id, ...payload });
  });

  // Bitiş
  function cleanup() {
    // kuyruktan çıkar
    Object.values(queues).forEach(q => dequeue(q, socket.id));

    const p = partners.get(socket.id);
    if (p) {
      socket.leave(p.roomId);
      const peerSock = io.sockets.sockets.get(p.peer);
      partners.delete(socket.id);
      partners.delete(p.peer);
      peerSock?.leave(p.roomId);
      peerSock?.emit('hangup');
    }
  }

  socket.on('hangup', cleanup);
  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    cleanup();
  });
});

// Render/Heroku tarzı port
const PORT = process.env.PORT || 10000;
server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;
server.listen(PORT, () => console.log('Server çalışıyor:', PORT));
