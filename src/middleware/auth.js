import jwt from 'jsonwebtoken';

/**
 * Middleware Hono untuk memverifikasi JWT.
 * Token diambil dari header Authorization: Bearer <token>
 * atau dari query param ?token=<token> (untuk koneksi WebSocket dari browser)
 */
export async function authMiddleware(c, next) {
  let token = null;

  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Fallback ke query param (diperlukan saat upgrade ke WebSocket)
  if (!token) {
    token = c.req.query('token');
  }

  if (!token) {
    return c.json({ error: 'Unauthorized: No token provided' }, 401);
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Simpan user payload ke context Hono agar bisa diakses di route handler
    c.set('user', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
  }
}

/**
 * Helper untuk generate JWT setelah login Google berhasil.
 */
export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      google_id: user.google_id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}
