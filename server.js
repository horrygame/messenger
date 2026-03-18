const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));
app.use(express.json());

// Хранилища данных
const users = new Map(); // username -> {online: boolean, socketId: string}
const messages = []; // [{from, to, text, timestamp, deleteTimer}]

// Очистка старых сообщений (запускается каждую минуту)
setInterval(() => {
    const now = Date.now();
    const beforeLength = messages.length;
    
    // Удаляем сообщения старше 24 часов
    for (let i = messages.length - 1; i >= 0; i--) {
        if (now - messages[i].timestamp > 24 * 60 * 60 * 1000) {
            messages.splice(i, 1);
        }
    }
    
    if (messages.length !== beforeLength) {
        console.log(`Очищено старых сообщений: ${beforeLength - messages.length}`);
        io.emit('messages-cleaned');
    }
}, 60 * 1000); // Проверка каждую минуту

// Регистрация пользователя
app.post('/register', (req, res) => {
    const { username } = req.body;
    
    if (!username || username.trim() === '') {
        return res.status(400).json({ error: 'Имя пользователя не может быть пустым' });
    }
    
    if (users.has(username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    users.set(username, { online: false, socketId: null });
    res.json({ success: true, username });
});

// Поиск пользователей
app.get('/search-users', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.json([]);
    }
    
    const results = [];
    for (const [username, userData] of users.entries()) {
        if (username.toLowerCase().includes(query.toLowerCase())) {
            results.push({
                username,
                online: userData.online
            });
        }
    }
    
    res.json(results);
});

// Получение истории сообщений между двумя пользователями
app.get('/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    
    const userMessages = messages.filter(m => 
        (m.from === user1 && m.to === user2) || 
        (m.from === user2 && m.to === user1)
    );
    
    res.json(userMessages);
});

io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    
    // Аутентификация пользователя
    socket.on('authenticate', (username) => {
        if (users.has(username)) {
            const user = users.get(username);
            user.online = true;
            user.socketId = socket.id;
            users.set(username, user);
            
            socket.username = username;
            
            // Уведомляем всех о новом онлайн пользователе
            io.emit('user-status-change', { username, online: true });
            
            console.log(`Пользователь ${username} вошел в систему`);
        }
    });
    
    // Отправка сообщения
    socket.on('send-message', (data) => {
        const { to, text } = data;
        const from = socket.username;
        
        if (!from || !to || !text) return;
        
        const message = {
            from,
            to,
            text,
            timestamp: Date.now(),
            deleteTimer: 24 * 60 * 60 * 1000 // 24 часа в миллисекундах
        };
        
        messages.push(message);
        
        // Отправляем сообщение получателю, если он онлайн
        const recipient = users.get(to);
        if (recipient && recipient.online) {
            io.to(recipient.socketId).emit('receive-message', message);
        }
        
        // Отправляем подтверждение отправителю
        socket.emit('message-sent', message);
    });
    
    // Отключение пользователя
    socket.on('disconnect', () => {
        if (socket.username) {
            const user = users.get(socket.username);
            if (user) {
                user.online = false;
                user.socketId = null;
                users.set(socket.username, user);
                
                io.emit('user-status-change', { username: socket.username, online: false });
                console.log(`Пользователь ${socket.username} отключился`);
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
