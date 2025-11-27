// Ultra Chat Backend — Enhanced Version
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const multer = require("multer");
const crypto = require("crypto");

// === ENHANCED TELEGRAM BOT SETTINGS ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "YOUR_CHAT_ID";

// Enhanced Telegram notification function
function sendToTelegram(text, type = "info") {
  const emoji = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    user: "👤",
    file: "📁",
    system: "⚡"
  }[type] || "📢";
  
  const message = `${emoji} ${text}`;
  
  axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "HTML"
  }).catch(err => console.log("Telegram Error:", err.message));
}

// Enhanced user tracking
const users = new Map();
const userActivity = new Map();
const messageHistory = [];

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "public/uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images, documents, and archives
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'application/zip', 
      'application/x-rar-compressed', 
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  maxHttpBufferSize: 10 * 1024 * 1024, // 10 MB file upload support
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enhanced file upload endpoint
app.post("/api/upload", upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ 
    success: true, 
    file: fileUrl,
    filename: req.file.originalname,
    size: req.file.size
  });
});

// API to get message history
app.get("/api/messages", (req, res) => {
  res.json(messageHistory.slice(-100)); // Last 100 messages
});

// API to get online users
app.get("/api/users", (req, res) => {
  const onlineUsers = Array.from(users.values()).map(user => ({
    username: user.username,
    id: user.id,
    joinTime: user.joinTime
  }));
  res.json(onlineUsers);
});

// Socket.IO connection handling
io.on("connection", socket => {
  const ip = socket.handshake.headers["x-forwarded-for"] || 
             socket.handshake.address || 
             socket.request.connection.remoteAddress;
  
  const userAgent = socket.handshake.headers["user-agent"];
  const connectionTime = new Date().toISOString();
  
  // Enhanced user connection tracking
  userActivity.set(socket.id, {
    ip,
    userAgent,
    connectionTime,
    lastActivity: Date.now()
  });

  sendToTelegram(
    `<b>New User Connected</b>\n` +
    `🆔 Socket: ${socket.id}\n` +
    `🌐 IP: ${ip}\n` +
    `🕒 Time: ${new Date().toLocaleString()}\n` +
    `📱 User Agent: ${userAgent?.substring(0, 50)}...`,
    "system"
  );

  // Send message history to new user
  socket.emit("message history", messageHistory.slice(-50));

  socket.on("new user", username => {
    const userData = {
      id: socket.id,
      username: username.trim() || "Anonymous",
      joinTime: new Date().toISOString(),
      ip: ip
    };
    
    users.set(socket.id, userData);
    
    // Update user list for all clients
    broadcastUserList();
    
    // System message about user joining
    const joinMessage = {
      id: generateMessageId(),
      user: "System",
      msg: `🟢 <b>${userData.username}</b> joined the chat!`,
      time: new Date().toLocaleTimeString(),
      timestamp: Date.now(),
      type: "system"
    };
    
    messageHistory.push(joinMessage);
    io.emit("chat message", joinMessage);

    sendToTelegram(
      `<b>User Joined</b>\n` +
      `👤 Name: ${userData.username}\n` +
      `🌐 IP: ${ip}\n` +
      `🆔 Socket: ${socket.id}`,
      "user"
    );
  });

  socket.on("chat message", (msg) => {
    if (!msg || !msg.trim()) return;
    
    const userData = users.get(socket.id);
    if (!userData) return;
    
    // Update last activity
    userActivity.get(socket.id).lastActivity = Date.now();
    
    const messageData = {
      id: generateMessageId(),
      user: userData.username,
      msg: msg.trim(),
      time: new Date().toLocaleTimeString(),
      timestamp: Date.now(),
      userId: socket.id,
      type: "message"
    };
    
    messageHistory.push(messageData);
    io.emit("chat message", messageData);

    // Telegram notification for important messages
    if (msg.length > 50 || msg.includes('@admin') || msg.includes('urgent')) {
      sendToTelegram(
        `<b>New Message</b>\n` +
        `👤 From: ${userData.username}\n` +
        `💬 Message: ${msg.substring(0, 100)}${msg.length > 100 ? '...' : ''}`,
        "info"
      );
    }
  });

  socket.on("typing", (isTyping) => {
    const userData = users.get(socket.id);
    if (userData) {
      socket.broadcast.emit("user typing", {
        user: userData.username,
        typing: isTyping
      });
    }
  });

  socket.on("file upload", (fileData) => {
    const userData = users.get(socket.id);
    if (!userData || !fileData) return;

    const folder = "public/uploads";
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    try {
      const fileName = `uploads/${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${fileData.name}`;
      const base64Data = fileData.data.split(",")[1] || fileData.data;
      
      fs.writeFileSync(path.join("public", fileName), base64Data, "base64");
      
      const isImage = fileData.type.startsWith("image/");
      const fileSize = Buffer.byteLength(base64Data, 'base64');

      const fileMessage = {
        id: generateMessageId(),
        user: userData.username,
        file: fileName,
        filename: fileData.name,
        isImage,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        type: "file",
        size: fileSize
      };

      messageHistory.push(fileMessage);
      io.emit("file uploaded", fileMessage);

      sendToTelegram(
        `<b>File Uploaded</b>\n` +
        `👤 By: ${userData.username}\n` +
        `📁 File: ${fileData.name}\n` +
        `📊 Size: ${formatFileSize(fileSize)}`,
        "file"
      );
    } catch (error) {
      console.error("File upload error:", error);
      socket.emit("upload error", "Failed to upload file");
    }
  });

  socket.on("disconnect", (reason) => {
    const userData = users.get(socket.id);
    const activity = userActivity.get(socket.id);
    
    if (userData) {
      const leaveMessage = {
        id: generateMessageId(),
        user: "System",
        msg: `🔴 <b>${userData.username}</b> left the chat!`,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        type: "system"
      };
      
      messageHistory.push(leaveMessage);
      socket.broadcast.emit("chat message", leaveMessage);

      sendToTelegram(
        `<b>User Left</b>\n` +
        `👤 Name: ${userData.username}\n` +
        `🌐 IP: ${activity?.ip}\n` +
        `📝 Reason: ${reason || "Unknown"}`,
        "warning"
      );

      users.delete(socket.id);
      userActivity.delete(socket.id);
      broadcastUserList();
    }
  });

  // Heartbeat to track active connections
  socket.on("heartbeat", () => {
    const activity = userActivity.get(socket.id);
    if (activity) {
      activity.lastActivity = Date.now();
    }
  });
});

// Helper functions
function generateMessageId() {
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function broadcastUserList() {
  const userList = Array.from(users.values()).map(user => ({
    username: user.username,
    id: user.id
  }));
  io.emit("user list", userList);
}

// Cleanup inactive users every 5 minutes
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes
  
  for (const [socketId, activity] of userActivity.entries()) {
    if (now - activity.lastActivity > timeout) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    }
  }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔥 Enhanced Server Running at http://localhost:${PORT}`);
  sendToTelegram(`🚀 <b>Chat Server Started</b>\nPort: ${PORT}\nTime: ${new Date().toLocaleString()}`, "success");
});