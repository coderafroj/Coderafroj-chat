const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs'); // फाइल सेव करने के लिए

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// यूजर्स को स्टोर करने के लिए ऑब्जेक्ट
const users = {};

io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    // यूजर जॉइन करता है
    socket.on('new user', (username) => {
        users[socket.id] = username;
        io.emit('user list', Object.values(users)); // सभी को यूजर्स की लिस्ट भेजो
        io.emit('chat message', {
            user: 'System',
            msg: `${username} ने चैट जॉइन की!`,
            time: new Date().toLocaleTimeString()
        });
    });

    // टेक्स्ट मैसेज भेजना
    socket.on('chat message', (data) => {
        io.emit('chat message', {
            user: users[socket.id],
            msg: data.msg,
            time: new Date().toLocaleTimeString()
        });
    });

    // फाइल अपलोड (इमेज/डॉक्यूमेंट)
    socket.on('file upload', (file) => {
        const fileName = `uploads/${Date.now()}_${file.name}`;
        
        // फाइल सेव करें (अगर "uploads" फोल्डर नहीं है तो बनाएँ)
        if (!fs.existsSync('public/uploads')) {
            fs.mkdirSync('public/uploads');
        }
        fs.writeFileSync(`public/${fileName}`, file.data.split(',')[1], 'base64');

        // सभी यूजर्स को फाइल भेजें
        io.emit('file uploaded', {
            user: users[socket.id],
            file: fileName,
            time: new Date().toLocaleTimeString()
        });
    });

    // डिस्कनेक्ट
    socket.on('disconnect', () => {
        if (users[socket.id]) {
            io.emit('chat message', {
                user: 'System',
                msg: `${users[socket.id]} ने चैट छोड़ दी!`,
                time: new Date().toLocaleTimeString()
            });
            delete users[socket.id];
            io.emit('user list', Object.values(users));
        }
    });
});

// सर्वर स्टार्ट करें
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
