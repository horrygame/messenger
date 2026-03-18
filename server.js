const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const upload = multer({ dest: 'uploads/' });

app.use(express.static(__dirname));
app.use(express.json());
app.use(cookieParser());

// Секретный ключ для JWT
const JWT_SECRET = 'your-secret-key-change-this-in-production';

// Файлы для хранения данных
const DATA_DIR = './data';
const USERS_FILE = `${DATA_DIR}/users.json`;
const GAMES_FILE = `${DATA_DIR}/games.json`;
const BOTS_FILE = `${DATA_DIR}/bots.json`;
const CHANNELS_FILE = `${DATA_DIR}/channels.json`;
const MESSAGES_FILE = `${DATA_DIR}/messages.json`;
const ADMINS_FILE = `${DATA_DIR}/admins.json`;

// Инициализация файлов данных
async function initDataFiles() {
    await fs.ensureDir(DATA_DIR);
    
    const files = [
        USERS_FILE, GAMES_FILE, BOTS_FILE, CHANNELS_FILE, MESSAGES_FILE, ADMINS_FILE
    ];
    
    for (const file of files) {
        if (!await fs.pathExists(file)) {
            await fs.writeJson(file, []);
        }
    }
    
    // Создаем админа по умолчанию
    const admins = await fs.readJson(ADMINS_FILE);
    if (admins.length === 0) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        admins.push({
            id: '1',
            username: 'admin',
            password: hashedPassword,
            role: 'superadmin'
        });
        await fs.writeJson(ADMINS_FILE, admins);
    }
}

initDataFiles();

// Вспомогательные функции
async function getUsers() {
    return await fs.readJson(USERS_FILE);
}

async function saveUsers(users) {
    await fs.writeJson(USERS_FILE, users);
}

async function getGames() {
    return await fs.readJson(GAMES_FILE);
}

async function saveGames(games) {
    await fs.writeJson(GAMES_FILE, games);
}

async function getBots() {
    return await fs.readJson(BOTS_FILE);
}

async function saveBots(bots) {
    await fs.writeJson(BOTS_FILE, bots);
}

async function getChannels() {
    return await fs.readJson(CHANNELS_FILE);
}

async function saveChannels(channels) {
    await fs.writeJson(CHANNELS_FILE, channels);
}

async function getMessages() {
    return await fs.readJson(MESSAGES_FILE);
}

async function saveMessages(messages) {
    await fs.writeJson(MESSAGES_FILE, messages);
}

async function getAdmins() {
    return await fs.readJson(ADMINS_FILE);
}

// Middleware для проверки админа
async function isAdmin(req, res, next) {
    try {
        const token = req.cookies.adminToken;
        if (!token) {
            return res.status(401).json({ error: 'Не авторизован' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const admins = await getAdmins();
        const admin = admins.find(a => a.id === decoded.id);
        
        if (!admin) {
            return res.status(401).json({ error: 'Не авторизован' });
        }
        
        req.admin = admin;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Не авторизован' });
    }
}

// ============ ОБЫЧНЫЕ ПОЛЬЗОВАТЕЛИ ============

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const users = await getUsers();
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        online: false,
        registeredAt: new Date().toISOString()
    };
    
    users.push(newUser);
    await saveUsers(users);
    
    const token = jwt.sign({ id: newUser.id, username }, JWT_SECRET);
    res.cookie('token', token, { httpOnly: true });
    
    res.json({ success: true, user: { id: newUser.id, username } });
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const users = await getUsers();
    const user = users.find(u => u.username === username);
    
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    
    const token = jwt.sign({ id: user.id, username }, JWT_SECRET);
    res.cookie('token', token, { httpOnly: true });
    
    res.json({ success: true, user: { id: user.id, username } });
});

// Выход
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// Получение текущего пользователя
app.get('/api/me', async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.json({ user: null });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const users = await getUsers();
        const user = users.find(u => u.id === decoded.id);
        
        if (!user) {
            res.clearCookie('token');
            return res.json({ user: null });
        }
        
        res.json({ user: { id: user.id, username: user.username } });
    } catch (error) {
        res.clearCookie('token');
        res.json({ user: null });
    }
});

// Поиск пользователей
app.get('/api/users/search', async (req, res) => {
    const { query } = req.query;
    const users = await getUsers();
    
    const results = users
        .filter(u => u.username.toLowerCase().includes(query.toLowerCase()))
        .map(u => ({ id: u.id, username: u.username, online: u.online }));
    
    res.json(results);
});

// ============ ИГРЫ ============

// Создание игры
app.post('/api/games/create', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const { name, description, code, type } = req.body;
    
    const games = await getGames();
    const newGame = {
        id: Date.now().toString(),
        name,
        description,
        code,
        type,
        authorId: decoded.id,
        authorName: decoded.username,
        status: 'pending', // pending, approved, rejected
        createdAt: new Date().toISOString(),
        plays: 0,
        rating: 0
    };
    
    games.push(newGame);
    await saveGames(games);
    
    res.json({ success: true, game: newGame });
});

// Получение одобренных игр
app.get('/api/games', async (req, res) => {
    const games = await getGames();
    const approved = games.filter(g => g.status === 'approved');
    res.json(approved);
});

// Получение игры по ID
app.get('/api/games/:id', async (req, res) => {
    const games = await getGames();
    const game = games.find(g => g.id === req.params.id);
    
    if (!game) {
        return res.status(404).json({ error: 'Игра не найдена' });
    }
    
    res.json(game);
});

// Увеличение счетчика игр
app.post('/api/games/:id/play', async (req, res) => {
    const games = await getGames();
    const game = games.find(g => g.id === req.params.id);
    
    if (game) {
        game.plays++;
        await saveGames(games);
    }
    
    res.json({ success: true });
});

// ============ БОТЫ ============

// Создание бота
app.post('/api/bots/create', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const { name, description, code, commands } = req.body;
    
    const bots = await getBots();
    const newBot = {
        id: Date.now().toString(),
        name,
        description,
        code,
        commands: commands || [],
        authorId: decoded.id,
        authorName: decoded.username,
        status: 'pending',
        createdAt: new Date().toISOString(),
        isActive: false
    };
    
    bots.push(newBot);
    await saveBots(bots);
    
    res.json({ success: true, bot: newBot });
});

// Получение активных ботов
app.get('/api/bots', async (req, res) => {
    const bots = await getBots();
    const active = bots.filter(b => b.status === 'approved' && b.isActive);
    res.json(active);
});

// Выполнение команды бота
app.post('/api/bots/:id/command', async (req, res) => {
    const bots = await getBots();
    const bot = bots.find(b => b.id === req.params.id);
    
    if (!bot || !bot.isActive) {
        return res.status(404).json({ error: 'Бот не найден или не активен' });
    }
    
    const { command, args, userId } = req.body;
    
    // Здесь можно выполнить код бота в изолированной среде
    // В демо версии просто возвращаем заглушку
    res.json({
        response: `Бот ${bot.name} получил команду: ${command}`,
        timestamp: new Date().toISOString()
    });
});

// ============ КАНАЛЫ ============

// Создание канала
app.post('/api/channels/create', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const { name, description, type } = req.body;
    
    const channels = await getChannels();
    const newChannel = {
        id: Date.now().toString(),
        name,
        description,
        type: type || 'public', // public, private
        creatorId: decoded.id,
        creatorName: decoded.username,
        members: [decoded.id],
        createdAt: new Date().toISOString(),
        messages: []
    };
    
    channels.push(newChannel);
    await saveChannels(channels);
    
    res.json({ success: true, channel: newChannel });
});

// Получение каналов пользователя
app.get('/api/channels/my', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const channels = await getChannels();
    
    const myChannels = channels.filter(c => 
        c.members.includes(decoded.id) || c.type === 'public'
    );
    
    res.json(myChannels);
});

// Отправка сообщения в канал
app.post('/api/channels/:id/message', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const { text } = req.body;
    
    const channels = await getChannels();
    const channel = channels.find(c => c.id === req.params.id);
    
    if (!channel || !channel.members.includes(decoded.id)) {
        return res.status(403).json({ error: 'Нет доступа' });
    }
    
    const message = {
        id: Date.now().toString(),
        userId: decoded.id,
        username: decoded.username,
        text,
        timestamp: new Date().toISOString()
    };
    
    channel.messages.push(message);
    await saveChannels(channels);
    
    io.to(`channel-${channel.id}`).emit('channel-message', message);
    
    res.json({ success: true, message });
});

// ============ АДМИН ПАНЕЛЬ ============

// Вход админа
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    const admins = await getAdmins();
    const admin = admins.find(a => a.username === username);
    
    if (!admin || !await bcrypt.compare(password, admin.password)) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    
    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET);
    res.cookie('adminToken', token, { httpOnly: true });
    
    res.json({ success: true, admin: { id: admin.id, username: admin.username, role: admin.role } });
});

// Получение игр на проверку
app.get('/api/admin/games/pending', isAdmin, async (req, res) => {
    const games = await getGames();
    const pending = games.filter(g => g.status === 'pending');
    res.json(pending);
});

// Одобрение/отклонение игры
app.post('/api/admin/games/:id/review', isAdmin, async (req, res) => {
    const { status } = req.body; // approved, rejected
    
    const games = await getGames();
    const game = games.find(g => g.id === req.params.id);
    
    if (game) {
        game.status = status;
        game.reviewedBy = req.admin.username;
        game.reviewedAt = new Date().toISOString();
        await saveGames(games);
    }
    
    res.json({ success: true });
});

// Получение ботов на проверку
app.get('/api/admin/bots/pending', isAdmin, async (req, res) => {
    const bots = await getBots();
    const pending = bots.filter(b => b.status === 'pending');
    res.json(pending);
});

// Одобрение/отклонение бота
app.post('/api/admin/bots/:id/review', isAdmin, async (req, res) => {
    const { status, isActive } = req.body;
    
    const bots = await getBots();
    const bot = bots.find(b => b.id === req.params.id);
    
    if (bot) {
        bot.status = status;
        bot.isActive = isActive || false;
        bot.reviewedBy = req.admin.username;
        bot.reviewedAt = new Date().toISOString();
        await saveBots(bots);
    }
    
    res.json({ success: true });
});

// Экспорт данных
app.get('/api/admin/export/:type', isAdmin, async (req, res) => {
    const { type } = req.params;
    
    let data;
    switch (type) {
        case 'users':
            data = await getUsers();
            break;
        case 'games':
            data = await getGames();
            break;
        case 'bots':
            data = await getBots();
            break;
        case 'channels':
            data = await getChannels();
            break;
        default:
            return res.status(400).json({ error: 'Неверный тип' });
    }
    
    res.json(data);
});

// Импорт данных
app.post('/api/admin/import/:type', isAdmin, upload.single('file'), async (req, res) => {
    const { type } = req.params;
    
    try {
        const fileContent = await fs.readFile(req.file.path, 'utf8');
        const data = JSON.parse(fileContent);
        
        switch (type) {
            case 'users':
                await saveUsers(data);
                break;
            case 'games':
                await saveGames(data);
                break;
            case 'bots':
                await saveBots(data);
                break;
            case 'channels':
                await saveChannels(data);
                break;
            default:
                return res.status(400).json({ error: 'Неверный тип' });
        }
        
        await fs.remove(req.file.path);
        res.json({ success: true, count: data.length });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка импорта' });
    }
});

// Создание нового админа
app.post('/api/admin/create', isAdmin, async (req, res) => {
    if (req.admin.role !== 'superadmin') {
        return res.status(403).json({ error: 'Недостаточно прав' });
    }
    
    const { username, password, role } = req.body;
    
    const admins = await getAdmins();
    
    if (admins.find(a => a.username === username)) {
        return res.status(400).json({ error: 'Админ уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        role: role || 'admin'
    };
    
    admins.push(newAdmin);
    await fs.writeJson(ADMINS_FILE, admins);
    
    res.json({ success: true });
});

// Socket.IO подключения
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    
    socket.on('authenticate', async (userId) => {
        socket.userId = userId;
        
        // Обновляем статус пользователя
        const users = await getUsers();
        const user = users.find(u => u.id === userId);
        if (user) {
            user.online = true;
            await saveUsers(users);
        }
    });
    
    socket.on('join-channel', (channelId) => {
        socket.join(`channel-${channelId}`);
    });
    
    socket.on('disconnect', async () => {
        if (socket.userId) {
            const users = await getUsers();
            const user = users.find(u => u.id === socket.userId);
            if (user) {
                user.online = false;
                await saveUsers(users);
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Админ панель: http://localhost:${PORT}/admin.html`);
    console.log('Логин админа по умолчанию: admin / admin123');
});
