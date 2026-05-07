import { Hono } from 'hono';
import { pool } from '../config/db.js';
import { generateToken } from '../middleware/auth.js';

export const authRouter = new Hono();

/* ══════════════════════════════════════════════════
   MANUAL GOOGLE OAUTH FLOW
   GET /google  → redirect ke Google (jika no code)
              → handle callback dari Google (jika ada code)
   ══════════════════════════════════════════════════ */

authRouter.get('/google', async (c) => {
  const code = c.req.query('code');
  
  // Jika tidak ada code, redirect ke Google login
  if (!code) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scope = 'openid email profile';
    
    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleAuthUrl.searchParams.append('client_id', clientId);
    googleAuthUrl.searchParams.append('redirect_uri', redirectUri);
    googleAuthUrl.searchParams.append('response_type', 'code');
    googleAuthUrl.searchParams.append('scope', scope);
    googleAuthUrl.searchParams.append('access_type', 'offline');
    
    return c.redirect(googleAuthUrl.toString());
  }

  // Ada code = ini callback dari Google
  try {
    console.log('🔵 Google OAuth Callback received with code');
    
    // 1. Exchange code untuk access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.statusText} - ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('✅ Token received');

    // 2. Gunakan access token untuk ambil user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      throw new Error(`User info fetch failed: ${userResponse.statusText}`);
    }

    const googleUser = await userResponse.json();
    console.log('✅ Google user info:', { name: googleUser.name, email: googleUser.email, id: googleUser.id });

    // 3. Simpan ke database
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM users WHERE google_id = ?', [googleUser.id]);

    let user;
    if (rows.length > 0) {
      await conn.query(
        'UPDATE users SET name = ?, email = ?, avatar = ? WHERE google_id = ?',
        [googleUser.name, googleUser.email, googleUser.picture, googleUser.id]
      );
      user = { ...rows[0], name: googleUser.name, email: googleUser.email, avatar: googleUser.picture };
    } else {
      const [result] = await conn.query(
        'INSERT INTO users (google_id, name, email, avatar) VALUES (?, ?, ?, ?)',
        [googleUser.id, googleUser.name, googleUser.email, googleUser.picture]
      );
      user = { id: result.insertId, google_id: googleUser.id, name: googleUser.name, email: googleUser.email, avatar: googleUser.picture };
    }
    conn.release();

    const token = generateToken(user);
    console.log('✅ Google login successful:', user.name);
    return c.redirect(`/?token=${token}&loginType=google`);
  } catch (err) {
    console.error('❌ Google OAuth Error:', err.message);
    return c.json({ error: 'Authentication failed', details: err.message }, 500);
  }
});

/* ══════════════════════════════════════════════════
   GUEST LOGIN FLOW
   POST /auth/guest  → { username, avatar }
   Tidak perlu password — langsung dapat JWT
   ══════════════════════════════════════════════════ */
authRouter.post('/guest', async (c) => {
  let body;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Body tidak valid' }, 400);
  }

  const username = body.username?.trim();
  const avatar   = body.avatar || '🎮';

  if (!username || username.length < 2 || username.length > 20) {
    return c.json({ error: 'Username harus 2–20 karakter' }, 400);
  }
  if (!/^[a-zA-Z0-9 _\-]+$/.test(username)) {
    return c.json({ error: 'Hanya huruf, angka, spasi, _ atau - ya!' }, 400);
  }

  try {
    const conn = await pool.getConnection();

    // Guest selalu buat akun baru dengan google_id unik
    // (supaya tidak clash dengan akun Google yang namanya sama)
    const guestId  = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const fakeEmail = `${guestId}@matharena.guest`;

    const [result] = await conn.query(
      'INSERT INTO users (google_id, name, email, avatar) VALUES (?, ?, ?, ?)',
      [guestId, username, fakeEmail, avatar]
    );
    const user = { id: result.insertId, google_id: guestId, name: username, email: fakeEmail, avatar };
    conn.release();

    const token = generateToken(user);
    return c.json({ token, user: { id: user.id, name: user.name, avatar: user.avatar, isGuest: true } });
  } catch (err) {
    console.error('Guest Auth Error:', err);
    return c.json({ error: 'Server error' }, 500);
  }
});

/* ══════════════════════════════════════════════════
   GET /auth/me — validasi token aktif
   ══════════════════════════════════════════════════ */
authRouter.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ user });
});
