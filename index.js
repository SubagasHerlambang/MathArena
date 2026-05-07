import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { initDB } from './src/config/db.js';
import { authMiddleware } from './src/middleware/auth.js';
import { authRouter } from './src/routes/authRoutes.js';
import { createWsHandler, rooms } from './src/ws/wsHandler.js';
import { generateRoomCode, sanitizeSettings } from './src/utils/gameLogic.js';

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/static/*', serveStatic({ root: './' }));
// Serve semua file di /public (termasuk menu.mp3 dan game.mp3)
app.use('/*', serveStatic({ root: './public' }));
app.get('/', serveStatic({ path: './public/index.html' }));

app.route('/auth', authRouter);
app.use('/auth/me', authMiddleware);

/* ══════════════════════════════════════════════════════════
   POST /room/create
   Buat room baru, simpan settings + info host
   ══════════════════════════════════════════════════════════ */
app.post('/room/create', authMiddleware, async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch {}

  const user     = c.get('user');
  const settings = sanitizeSettings(body.settings || {});

  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));

  rooms.set(code, {
    code,
    hostId:          user.id,
    hostName:        user.name,       // ← untuk daftar publik
    hostAvatar:      user.avatar,
    createdAt:       Date.now(),
    status:          'waiting',
    players:         new Map(),
    currentQuestion: null,
    questionIndex:   0,
    totalQuestions:  settings.totalQuestions,
    questionTimer:   null,
    collectTimer:    null,
    sessionId:       null,
    punishmentPool:  [],
    settings,
  });

  console.log(`[${code}] Room dibuat oleh ${user.name} (${settings.isPrivate ? 'PRIVATE' : 'PUBLIC'}, ${settings.difficulty})`);

  return c.json({
    roomCode: code,
    settings,
    ...(settings.isPrivate ? { password: settings.password } : {}),
  });
});

/* ══════════════════════════════════════════════════════════
   GET /room/list
   Daftar semua room PUBLIK yang masih waiting
   Hanya tampilkan room yang: isPrivate=false, status=waiting, belum full
   ══════════════════════════════════════════════════════════ */
app.get('/room/list', (c) => {
  const publicRooms = [];

  for (const [code, room] of rooms) {
    if (room.settings?.isPrivate) continue;          // skip private
    if (room.status !== 'waiting') continue;          // hanya yang waiting (belum mulai)
    if (room.players.size >= 10) continue;            // skip yang penuh

    const diffEmoji = { easy: '😊', medium: '😤', hard: '🔥', chaos: '💀' };

    publicRooms.push({
      code,
      hostName:        room.hostName || 'Unknown',
      hostAvatar:      room.hostAvatar || '🎮',
      playerCount:     room.players.size,
      maxPlayers:      10,
      difficulty:      room.settings?.difficulty || 'medium',
      diffEmoji:       diffEmoji[room.settings?.difficulty] || '😤',
      totalQuestions:  room.settings?.totalQuestions || 10,
      timePerQuestion: room.settings?.timePerQuestion || 15,
      showStreak:      room.settings?.showStreak || false,
      createdAt:       room.createdAt || Date.now(),
    });
  }

  // Sort: yang paling banyak pemain di atas, baru berdasarkan waktu terbaru
  publicRooms.sort((a, b) => {
    if (b.playerCount !== a.playerCount) return b.playerCount - a.playerCount;
    return b.createdAt - a.createdAt;
  });

  return c.json({ rooms: publicRooms, total: publicRooms.length });
});

/* ══════════════════════════════════════════════════════════
   GET /room/check/:code
   Validasi room sebelum join
   ══════════════════════════════════════════════════════════ */
app.get('/room/check/:code', (c) => {
  const code = c.req.param('code').toUpperCase();
  if (!rooms.has(code)) return c.json({ exists: false, message: 'Room tidak ditemukan.' }, 404);

  const room     = rooms.get(code);
  const full     = room.players.size >= 10;
  const active   = ['active', 'spinning'].includes(room.status);
  const private_ = room.settings?.isPrivate || false;

  return c.json({
    exists:      true,
    isFull:      full,
    isActive:    active,
    isPrivate:   private_,
    status:      room.status,
    playerCount: room.players.size,
    maxPlayers:  10,
    canJoin:     !full && !active,
    difficulty:  room.settings?.difficulty || 'medium',
    hostName:    room.hostName || '—',
    message:     full
      ? `⛔ Room penuh! (${room.players.size}/10)`
      : active
        ? '🎮 Game sedang berlangsung.'
        : private_
          ? `🔒 Room private (${room.players.size}/10 pemain) — butuh password`
          : `✅ Room ditemukan! (${room.players.size}/10 pemain)`,
  });
});

/* ══════════════════════════════════════════════════════════
   GET /health
   ══════════════════════════════════════════════════════════ */
app.get('/health', (c) => c.json({
  status:     'ok',
  totalRooms: rooms.size,
  publicRooms: [...rooms.values()].filter(r => !r.settings?.isPrivate && r.status === 'waiting').length,
  ts:         new Date().toISOString(),
}));

app.get('/ws', createWsHandler(upgradeWebSocket));

const PORT = parseInt(process.env.PORT) || 3000;
const server = serve({ fetch: app.fetch, port: PORT }, async (info) => {
  injectWebSocket(server);
  await initDB();
  console.log(`\n🚀 MathArena FINAL → http://localhost:${info.port}`);
  console.log(`📡 WebSocket       → ws://localhost:${info.port}/ws`);
  console.log(`🌐 Room List       → http://localhost:${info.port}/room/list\n`);
});

export default app;
