// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.get("/", (_req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

const PORT = process.env.PORT || 10000;

// Bekleyenler ve eşleşenler
// mode: "face" (istersen "voice" / "chat" de eklenir)
const waiting = new Map(); // mode -> Array<socketId>
const pairs   = new Map(); // socketId -> peerId

function getQueue(mode){
  if(!waiting.has(mode)) waiting.set(mode, []);
  return waiting.get(mode);
}
function removeFromQueue(mode, id){
  const q = getQueue(mode);
  const i = q.indexOf(id);
  if(i >= 0) q.splice(i,1);
}
function cleanup(socket){
  // kuyruktan çıkar
  for (const [mode, q] of waiting) {
    const i = q.indexOf(socket.id);
    if (i >= 0) q.splice(i,1);
  }
  // eşleşmeyi kopar
  const peerId = pairs.get(socket.id);
  if (peerId){
    pairs.delete(peerId);
    pairs.delete(socket.id);
    io.to(peerId).emit("peer-left");
  }
}

io.on("connection", (socket)=>{
  console.log("socket:", socket.id);

  socket.on("find", (mode="face")=>{
    cleanup(socket);
    const q = getQueue(mode);
    if (q.length === 0){
      // beklemeye al
      q.push(socket.id);
      socket.emit("waiting");
      return;
    }
    // birini al ve eşle
    const otherId = q.shift();
    if (!io.sockets.sockets.get(otherId) || otherId === socket.id) {
      // peer yoksa tekrar beklemeye al
      q.push(socket.id);
      socket.emit("waiting");
      return;
    }
    pairs.set(socket.id, otherId);
    pairs.set(otherId, socket.id);

    const room = `room_${mode}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const initiatorId = Math.random() < 0.5 ? socket.id : otherId;

    io.to(socket.id).emit("matched", { room, mode, peerId: otherId, initiator: socket.id === initiatorId });
    io.to(otherId).emit ("matched", { room, mode, peerId: socket.id, initiator: otherId  === initiatorId });
  });

  socket.on("signal", (payload)=>{
    const peerId = pairs.get(socket.id);
    if (!peerId) return;
    io.to(peerId).emit("signal", payload);
  });

  socket.on("hangup", ()=>{
    cleanup(socket);
  });

  socket.on("disconnect", ()=>{
    cleanup(socket);
  });
});

server.listen(PORT, ()=> {
  console.log("Server çalışıyor:", PORT);
});
