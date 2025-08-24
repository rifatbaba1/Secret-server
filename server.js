// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 10000;

const app = express();
app.use(cors({ origin: '*'}));

app.get('/', (_, res) => res.status(200).send('OK'));
app.get('/healthz', (_, res) => res.status(200).json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*'},
  transports: ['websocket', 'polling']
});

/** Kuyruklar (modlara göre) */
const queues = {
  face: [],
  voice: [],
  chat:  []
};

/** socket.id -> room, mode eşlemesi */
const socketRoom = new Map();   // socketId -> room
const socketMode = new Map();   // socketId -> mode

/** Kuyruktan soketi sil (disconnect/cancel için) */
function removeFromQueues(id){
  for (const key of Object.keys(queues)) {
    const i = queues[key].indexOf(id);
    if (i !== -1) queues[key].splice(i,1);
  }
}

/** Eşleştir ve odaya al */
function pairSockets(mode, aId, bId){
  const room = `room_${mode}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const a = io.sockets.sockets.get(aId);
  const b = io.sockets.sockets.get(bId);
  if (!a || !b) return;

  a.join(room);
  b.join(room);

  socketRoom.set(aId, room);
  socketRoom.set(bId, room);
  socketMode.set(aId, mode);
  socketMode.set(bId, mode);

  // İki tarafa da eşleşti bilgisi
  a.emit('matched', { room, mode, peerId: bId });
  b.emit('matched', { room, mode, peerId: aId });
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  /** Yeni kişi bul (mode: face|voice|chat) */
  socket.on('find', (mode = 'face') => {
    if (!['face','voice','chat'].includes(mode)) mode = 'face';

    // Önce kuyrukta birini var mı bak
    const q = queues[mode];
    let peerId = null;

    // Kendini kuyruktan temizle (double click vs.)
    removeFromQueues(socket.id);

    // Boşta bekleyen varsa eşleştir
    while (q.length && !peerId) {
      const candidate = q.shift();
      if (io.sockets.sockets.get(candidate)) peerId = candidate;
    }

    if (peerId) {
      pairSockets(mode, socket.id, peerId);
    } else {
      // beklemeye al
      q.push(socket.id);
      socket.emit('waiting', { mode });
    }
  });

  /** Aramayı iptal et (kuyruktan çık) */
  socket.on('cancelFind', () => {
    removeFromQueues(socket.id);
    socket.emit('waitingCanceled');
  });

  /** Karşı tarafa sinyal geç (tek event) */
  socket.on('signal', (data = {}) => {
    const room = data.room || socketRoom.get(socket.id);
    if (!room) return;
    socket.to(room).emit('signal', data);
  });

  /** Alternatif: ayrı offer/answer/ice isimleri kullanıyorsan hepsini relay et */
  ['webrtc-offer','webrtc-answer','webrtc-ice'].forEach(evt => {
    socket.on(evt, (payload = {}) => {
      const room = payload.room || socketRoom.get(socket.id);
      if (!room) return;
      io.to(room).emit(evt, { from: socket.id, ...payload });
      // ya da socket.to(room).emit(...) dersen kendine dönmez
      // çoğu istemci için kendine dönmesine gerek yok:
      // socket.to(room).emit(evt, { from: socket.id, ...payload });
    });
  });

  /** Chat mesajını odaya ilet (metin sohbeti varsa) */
  socket.on('chat', (payload = {}) => {
    const room = payload.room || socketRoom.get(socket.id);
    if (!room) return;
    socket.to(room).emit('chat', { from: socket.id, text: payload.text || '' });
  });

  /** Bitir/Hangup: odayı ve eşleşmeyi kapat */
  socket.on('hangup', () => {
    const room = socketRoom.get(socket.id);
    if (room) {
      socket.to(room).emit('peer-left');
      // odadaki herkesi çıkarmaya çalışma; bırak karşı taraf kalsın/temizlensin
    }
    cleanupSocket(socket);
  });

  /** Koparsa temizlik */
  socket.on('disconnect', () => {
    const room = socketRoom.get(socket.id);
    if (room) socket.to(room).emit('peer-left');
    cleanupSocket(socket);
    console.log('socket disconnected', socket.id);
  });
});

/** Tüm izleri sil */
function cleanupSocket(socket){
  removeFromQueues(socket.id);
  const room = socketRoom.get(socket.id);
  if (room) {
    try { socket.leave(room); } catch {}
    socketRoom.delete(socket.id);
  }
  socketMode.delete(socket.id);
}

server.listen(PORT, () => {
  console.log(`Server çalışıyor: ${PORT}`);
});
