/* ══════════════════════════════════════════════════════
   gameLogic.js  v5
   - generateQuestion(settings)  ← pakai room settings
   - pickRandomPunishment
   - generateRoomCode
   - calculatePoints(elapsed, timeLimit, streakBonus)
   ══════════════════════════════════════════════════════ */

const OPS = ['+', '-', '×', '÷'];

/**
 * Generate soal berdasarkan room settings
 * @param {Object} settings - room settings dari host
 * @param {number} questionIndex - nomor soal (0-based), untuk progressive difficulty
 */
export function generateQuestion(settings = {}, questionIndex = 0) {
  const difficulty = settings.difficulty || 'medium';   // easy | medium | hard | chaos
  const allowedOps = settings.operators || ['+', '-'];

  let a, b, op, answer, question;

  // Progressive: soal makin susah seiring pertandingan
  const progress = questionIndex / (settings.totalQuestions || 10); // 0.0 – 1.0

  switch (difficulty) {
    case 'easy': {
      a  = rand(1, 20 + Math.floor(progress * 10));
      b  = rand(1, 15 + Math.floor(progress * 5));
      op = pick(allowedOps.filter(o => o !== '÷' && o !== '×'));
      break;
    }
    case 'medium': {
      a  = rand(5, 50 + Math.floor(progress * 30));
      b  = rand(2, 25 + Math.floor(progress * 15));
      op = pick(allowedOps);
      break;
    }
    case 'hard': {
      a  = rand(10, 100 + Math.floor(progress * 50));
      b  = rand(2,  20  + Math.floor(progress * 10));
      op = pick(allowedOps);
      // Soal bertingkat di babak akhir
      if (progress > 0.6 && allowedOps.includes('×')) {
        const c = rand(2, 10);
        op = pick(['+', '-']);
        const mul = rand(2, 12);
        question = `${a} ${op} ${b} × ${mul}`;
        const inner = b * mul;
        answer = op === '+' ? a + inner : a - inner;
        return { question, answer };
      }
      break;
    }
    case 'chaos': {
      // Angka besar, semua operator, soal bertingkat sejak awal
      a  = rand(10, 200 + Math.floor(progress * 100));
      b  = rand(2,  50  + Math.floor(progress * 30));
      op = pick(allowedOps);
      // 50% chance soal bertingkat
      if (Math.random() > 0.5) {
        const c = rand(2, 15);
        const op2 = pick(['+', '-', '×']);
        question = `(${a} ${op} ${b}) ${op2} ${c}`;
        const inner = compute(a, b, op);
        answer = compute(inner, c, op2);
        if (answer !== Math.floor(answer)) { answer = Math.round(answer); }
        return { question, answer };
      }
      break;
    }
    default:
      a  = rand(1, 30);
      b  = rand(1, 20);
      op = '+';
  }

  answer = compute(a, b, op);
  // Pastikan tidak negatif untuk soal mudah
  if (difficulty === 'easy' && answer < 0) { [a, b] = [b, a]; answer = compute(a, b, op); }
  // Hindari desimal
  if (answer !== Math.floor(answer)) { answer = Math.round(answer); }

  question = `${a} ${op} ${b}`;
  return { question, answer };
}

// ── Helpers ──────────────────────────────────────────────────
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function compute(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': {
      // Pastikan hasil bulat
      const result = b !== 0 ? a / b : a;
      return Math.round(result);
    }
    default:  return a + b;
  }
}

/**
 * Pilih satu hukuman dari pool
 */
export function pickRandomPunishment(pool) {
  if (!pool || pool.length === 0) return '🐔 Berkokok seperti ayam 3× di depan semua orang!';
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate kode room unik 6 karakter
 */
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Kalkulasi poin berdasarkan waktu + streak bonus
 * @param {number} elapsedMs   - waktu yang sudah berlalu sejak soal muncul
 * @param {number} timeLimitMs - batas waktu total
 * @param {number} streak      - berapa soal berturut-turut dijawab benar
 */
export function calculatePoints(elapsedMs, timeLimitMs = 15000, streak = 0) {
  const BASE   = 100;
  const ratio  = Math.max(0, 1 - elapsedMs / timeLimitMs);
  const base   = Math.floor(BASE * ratio) + 10;
  // Streak bonus: +10% per streak, maks 50%
  const bonus  = Math.min(streak, 5) * 0.1;
  return Math.floor(base * (1 + bonus));
}

/**
 * Default room settings
 */
export function defaultRoomSettings() {
  return {
    isPrivate:      false,      // room publik / private
    difficulty:     'medium',   // easy | medium | hard | chaos
    operators:      ['+', '-', '×'],
    totalQuestions: 10,         // 5 | 10 | 15 | 20
    timePerQuestion: 15,        // detik: 10 | 15 | 20 | 30
    collectTime:    60,         // detik input hukuman: 30 | 60 | 90
    showStreak:     true,       // tampilkan streak bonus
  };
}

/**
 * Validasi & sanitasi settings dari frontend
 */
export function sanitizeSettings(raw = {}) {
  const def = defaultRoomSettings();
  return {
    isPrivate:       typeof raw.isPrivate === 'boolean' ? raw.isPrivate : def.isPrivate,
    difficulty:      ['easy','medium','hard','chaos'].includes(raw.difficulty) ? raw.difficulty : def.difficulty,
    operators:       Array.isArray(raw.operators) && raw.operators.length > 0
                       ? raw.operators.filter(o => ['+','-','×','÷'].includes(o))
                       : def.operators,
    totalQuestions:  [5,10,15,20].includes(raw.totalQuestions) ? raw.totalQuestions : def.totalQuestions,
    timePerQuestion: [10,15,20,30].includes(raw.timePerQuestion) ? raw.timePerQuestion : def.timePerQuestion,
    collectTime:     [30,60,90].includes(raw.collectTime) ? raw.collectTime : def.collectTime,
    showStreak:      typeof raw.showStreak === 'boolean' ? raw.showStreak : def.showStreak,
  };
}
