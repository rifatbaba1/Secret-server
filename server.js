// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ---- Basit durumlar
app.get("/", (_, res) => res.send("ok"));
app.get("/status", (_, res) => {
  res.json({
    waiting: waiting.face.map(s => s.id),
    pairs: [...pairs.entries()].map(([a,b]) => [a,b])
  });
});

// ---- Eşleştirme durumu
const waiting = { face: [] };      // sıradaki kullanıcılar
const pairs   = new Map();          // socketId -> peerSocketId

function removeFromWaiting(sock) {
  waiting.face = waiting.face.filter(s => s.id !== sock.id);
}

function unpair(sock, informPeer = true) {
  const peerId = pairs.get(sock.id);
  if (peerId) {
    pairs.delete(sock.id);
    pairs.delete(peerId);
    if (informPeer) {
      const peer = io.sockets.sockets.get(peerId);
      peer?.emit("peer-left");
      removeFromWaiting(peer); // emniyet
    }
  }
}

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  // İstemci “face” için arama ister
  socket.on("find", (mode = "face") => {
    // önce eski durumları temizle
    unpair(socket, false);
    removeFromWaiting(socket);

    // sırada biri var mı? (kendimiz değil)
    const other = waiting.face.find(s => s.id !== socket.id);
    if (other) {
      // kuyuktan çıkar ve eşleştir
      waiting.face = waiting.face.filter(s => s.id !== other.id);

      const room = `room_face_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      console.log("match!", room, socket.id, other.id);

      pairs.set(socket.id,  other.id);
      pairs.set(other.id,   socket.id);

      socket.join(room);
      other.join(room);

      socket.emit("matched", { room, mode: "face", peerId: other.id });
      other.emit ("matched", { room, mode: "face", peerId: socket.id });
    } else {
      // sıraya al
      waiting.face.push(socket);
      socket.emit("waiting", { mode: "face" });
      console.log("waiting", socket.id);
    }
  });

  // WebRTC sinyalleşme
  socket.on("signal", (payload) => {
    const peerId = pairs.get(socket.id);
    if (!peerId) return;
    io.to(peerId).emit("signal", payload);
  });

  // manuel sonlandırma / tekrar arama öncesi
  socket.on("hangup", () => {
    removeFromWaiting(socket);
    unpair(socket);
  });

  socket.on("disconnect", () => {
    console.log("disconnected", socket.id);
    removeFromWaiting(socket);
    unpair(socket);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Server çalışıyor:", PORT));
