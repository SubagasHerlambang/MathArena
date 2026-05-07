# ⚡ MathArena v3

> Real-time Multiplayer Math Quiz — Tugas Akhir

---

## 🚀 Cara Menjalankan

### 1. Prasyarat
- Node.js v18+
- MySQL berjalan di localhost

### 2. Setup Database
```bash
mysql -u root -p < setup.sql
```

### 3. Setup `.env`
```env
PORT=3000

# Google OAuth (opsional — kalau tidak dipakai, comment saja)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google

# JWT
JWT_SECRET=isi_random_string_panjang_minimal_32_karakter

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=password_mysql_kamu
DB_NAME=matharena
```

### 4. Install & Jalankan
```bash
npm install
npm run dev   # development (auto-restart)
npm start     # production
```

Buka browser: **http://localhost:3000**

---

## 🎮 Alur Permainan (v3)

```
1. LOGIN
   ├── Google OAuth  → klik "Login Google"
   └── Guest         → pilih emoji + ketik username

2. LOBBY
   ├── Host mendapat kode room (bagikan ke teman)
   ├── Pemain lain masukkan kode untuk join
   └── Host klik "Mulai Kumpulkan Hukuman!"

3. FASE INPUT HUKUMAN  ← SEBELUM GAME MULAI
   ├── Semua peserta wajib ketik 1 hukuman masing-masing
   ├── Progress bar menunjukkan siapa yang sudah isi
   ├── Setelah semua isi → game langsung mulai otomatis
   └── Auto-start setelah 60 detik (yang belum isi → default)

4. GAME (10 soal, 15 detik/soal)
   ├── Jawaban benar + cepat = poin lebih banyak
   └── Live scoreboard update real-time

5. SPIN WHEEL
   ├── Semua hukuman yang sudah dikumpulkan masuk ke roda
   ├── Roda di-spin secara animasi
   └── 1 hukuman terpilih → berlaku untuk SEMUA yang kalah (rank 6-10)

6. GAME OVER
   ├── Leaderboard final + banner hukuman
   └── Host bisa reset → kembali ke lobby untuk main lagi
```

---

## 📁 Struktur File

```
matharena/
├── index.js                    # Entry point Hono server
├── package.json
├── .env                        # Config (jangan di-commit!)
├── setup.sql
├── public/
│   └── index.html              # Seluruh UI frontend
└── src/
    ├── config/db.js            # MySQL pool + initDB()
    ├── middleware/auth.js      # JWT verify + generateToken()
    ├── routes/authRoutes.js    # Google OAuth + Guest login
    ├── utils/gameLogic.js      # Soal, poin, roomCode
    └── ws/wsHandler.js         # Core game loop WebSocket
```

---

## 🔑 Setup Google OAuth (opsional)

1. Buka [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials → Create OAuth 2.0 Client ID
3. Application type: **Web application**
4. Authorized redirect URI: `http://localhost:3000/auth/google`
5. Salin Client ID & Secret ke `.env`

Jika tidak diisi, fitur "Login Google" tidak akan berfungsi — tapi Guest login tetap jalan normal.
