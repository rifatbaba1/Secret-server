//
//  server.js
//  rgfb
//
//  Created by Rifat Erdoğan on 24.08.2025.
//

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Kullanıcılar için havuz
let waitingChat = null;
let waitingCall = null;
let waitingFace = null;

io.on("connection", (socket) => {
  console.log("Yeni kullanıcı:", socket.id);

  // Rastgele chat
  socket.on("joinChat", () => {
    if (waitingChat) {
      io.to(waitingChat).emit("match", socket.id);
      io.to(socket.id).emit("match", waitingChat);
      waitingChat = null;
    } else {
      waitingChat = socket.id;
    }
  });

  // Rastgele sesli arama
  socket.on("joinCall", () => {
    if (waitingCall) {
      io.to(waitingCall).emit("matchCall", socket.id);
      io.to(socket.id).emit("matchCall", waitingCall);
      waitingCall = null;
    } else {
      waitingCall = socket.id;
    }
  });

  // Rastgele görüntülü arama
  socket.on("joinFace", () => {
    if (waitingFace) {
      io.to(waitingFace).emit("matchFace", socket.id);
      io.to(socket.id).emit("matchFace", waitingFace);
      waitingFace = null;
    } else {
      waitingFace = socket.id;
    }
  });

  // Kullanıcı ayrıldığında havuzdan çıkar
  socket.on("disconnect", () => {
    if (waitingChat === socket.id) waitingChat = null;
    if (waitingCall === socket.id) waitingCall = null;
    if (waitingFace === socket.id) waitingFace = null;
    console.log("Çıkış yaptı:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
