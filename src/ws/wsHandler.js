import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import {
  generateQuestion,
  pickRandomPunishment,
  generateRoomCode,
  calculatePoints,
  sanitizeSettings,
  defaultRoomSettings,
} from "../utils/gameLogic.js";

/* ══════════════════════════════════════════════════════════
   ROOM STATUS FLOW v5
   waiting → collecting → active → spinning → finished
   ══════════════════════════════════════════════════════════ */

export const rooms = new Map();
const MAX_PLAYERS = 10;

// ── Winner count rules ────────────────────────────────────────
function getWinnerCount(n) {
  return n < 5 ? 1 : 3;
}

// ── Helpers ───────────────────────────────────────────────────
function send(ws, type, payload = {}) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}
function broadcast(room, type, payload = {}, excludeId = null) {
  for (const [uid, p] of room.players) {
    if (excludeId && uid === excludeId) continue;
    send(p.ws, type, payload);
  }
}
function broadcastLobbyUpdate(room) {
  const n = room.players.size;
  broadcast(room, "LOBBY_UPDATE", {
    players: Array.from(room.players.values()).map((p) => ({
      id: p.user.id,
      name: p.user.name,
      avatar: p.user.avatar,
      isHost: p.user.id === room.hostId,
      hasSubmittedPunishment: p.hasSubmittedPunishment,
    })),
    roomIsFull: n >= MAX_PLAYERS,
    winnerCount: getWinnerCount(n),
    loserCount: Math.max(0, n - getWinnerCount(n)),
    settings: room.settings,
  });
}
function getScoreBoard(room) {
  return Array.from(room.players.values())
    .map((p) => ({
      id: p.user.id,
      name: p.user.name,
      avatar: p.user.avatar,
      score: p.score,
      streak: p.streak,
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Reset room ────────────────────────────────────────────────
function resetRoom(room) {
  room.status = "waiting";
  room.currentQuestion = null;
  room.questionIndex = 0;
  room.sessionId = null;
  room.punishmentPool = [];
  if (room.questionTimer) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
  }
  if (room.collectTimer) {
    clearTimeout(room.collectTimer);
    room.collectTimer = null;
  }
  for (const p of room.players.values()) {
    p.score = 0;
    p.answeredCurrent = false;
    p.isLoser = false;
    p.hasSubmittedPunishment = false;
    p.streak = 0;
  }
}

// ── Collecting phase ──────────────────────────────────────────
function startCollecting(room) {
  room.status = "collecting";
  room.punishmentPool = [];
  for (const p of room.players.values()) p.hasSubmittedPunishment = false;

  const n = room.players.size;
  const wc = getWinnerCount(n);
  const timeoutMs = room.settings.collectTime * 1000;

  broadcast(room, "COLLECT_PUNISHMENTS", {
    playerCount: n,
    winnerCount: wc,
    loserCount: Math.max(0, n - wc),
    timeLimit: timeoutMs,
    settings: room.settings,
  });
  broadcastLobbyUpdate(room);
  console.log(`[${room.code}] Collecting — ${n} pemain, ${wc} juara`);

  room.collectTimer = setTimeout(() => {
    for (const p of room.players.values()) {
      if (!p.hasSubmittedPunishment) {
        const def = `😴 ${p.user.name} males → wajib joget 30 detik!`;
        room.punishmentPool.push(def);
        p.hasSubmittedPunishment = true;
        send(p.ws, "PUNISHMENT_AUTO_FILLED", { punishment: def });
      }
    }
    beginGame(room);
  }, timeoutMs);
}

function checkAllPunishments(room) {
  if (
    Array.from(room.players.values()).every((p) => p.hasSubmittedPunishment)
  ) {
    clearTimeout(room.collectTimer);
    room.collectTimer = null;
    beginGame(room);
  }
}

// ── Begin game ────────────────────────────────────────────────
function beginGame(room) {
  room.status = "active";
  room.questionIndex = 0;
  for (const p of room.players.values()) {
    p.score = 0;
    p.answeredCurrent = false;
    p.streak = 0;
  }

  (async () => {
    try {
      const conn = await pool.getConnection();
      const [r] = await conn.query(
        "INSERT INTO game_sessions (room_code, host_id, status) VALUES (?,?,?)",
        [room.code, room.hostId, "active"],
      );
      room.sessionId = r.insertId;
      conn.release();
    } catch {}
  })();

  const n = room.players.size;
  broadcast(room, "GAME_STARTING", {
    totalQuestions: room.settings.totalQuestions,
    timePerQuestion: room.settings.timePerQuestion,
    winnerCount: getWinnerCount(n),
    loserCount: Math.max(0, n - getWinnerCount(n)),
    difficulty: room.settings.difficulty,
    showStreak: room.settings.showStreak,
  });
  setTimeout(() => sendQuestion(room), 3000);
}

// ── Question ──────────────────────────────────────────────────
function sendQuestion(room) {
  const { question, answer } = generateQuestion(
    { ...room.settings, totalQuestions: room.settings.totalQuestions },
    room.questionIndex,
  );
  const timeLimitMs = room.settings.timePerQuestion * 1000;

  room.currentQuestion = {
    question,
    answer,
    startTime: Date.now(),
    timeLimitMs,
  };
  for (const p of room.players.values()) p.answeredCurrent = false;

  broadcast(room, "NEW_QUESTION", {
    question,
    questionNumber: room.questionIndex + 1,
    totalQuestions: room.settings.totalQuestions,
    timeLimit: timeLimitMs,
    difficulty: room.settings.difficulty,
  });
  room.questionTimer = setTimeout(() => handleTimeout(room), timeLimitMs);
}

function handleTimeout(room) {
  broadcast(room, "QUESTION_TIMEOUT", {
    correctAnswer: room.currentQuestion.answer,
    scores: getScoreBoard(room),
  });
  // Reset streak bagi yang tidak menjawab
  for (const p of room.players.values()) {
    if (!p.answeredCurrent) p.streak = 0;
  }
  room.questionIndex++;
  if (room.questionIndex >= room.settings.totalQuestions) {
    setTimeout(() => startSpinPhase(room), 2500);
  } else {
    setTimeout(() => sendQuestion(room), 3000);
  }
}

// ── Spin phase ────────────────────────────────────────────────
function startSpinPhase(room) {
  room.status = "spinning";
  const sb = getScoreBoard(room);
  const wc = getWinnerCount(sb.length);
  const chosen = pickRandomPunishment(room.punishmentPool);
  const results = sb.map((p, i) => ({
    ...p,
    rank: i + 1,
    isWinner: i < wc,
    isLoser: i >= wc,
    punishment: i >= wc ? chosen : null,
  }));

  broadcast(room, "SPIN_WHEEL", {
    punishmentPool: room.punishmentPool,
    chosenPunishment: chosen,
    winners: results
      .filter((r) => r.isWinner)
      .map(({ id, name, avatar }) => ({ id, name, avatar })),
    losers: results
      .filter((r) => r.isLoser)
      .map(({ id, name, avatar }) => ({ id, name, avatar })),
    finalResults: results,
    spinDurationMs: 6000,
    winnerCount: wc,
  });

  setTimeout(async () => {
    room.status = "finished";
    try {
      if (room.sessionId) {
        const conn = await pool.getConnection();
        for (const r of results) {
          await conn.query(
            "INSERT INTO game_results (session_id,user_id,score,`rank`,punishment) VALUES (?,?,?,?,?)",
            [room.sessionId, r.id, r.score, r.rank, r.punishment],
          );
        }
        await conn.query("UPDATE game_sessions SET status=? WHERE id=?", [
          "finished",
          room.sessionId,
        ]);
        conn.release();
      }
    } catch {}
    broadcast(room, "GAME_OVER", { results });
  }, 8500);
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export function createWsHandler(upgradeWebSocket) {
  return upgradeWebSocket((c) => {
    const token = c.req.query("token");
    const roomCode = c.req.query("roomCode")?.toUpperCase() || "";
    const password = c.req.query("password") || ""; // untuk private room

    let user = null;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {}

    return {
      onOpen(evt, ws) {
        if (!user) {
          ws.send(
            JSON.stringify({ type: "ERROR", message: "Token tidak valid." }),
          );
          ws.close(4001, "Unauthorized");
          return;
        }
        if (!roomCode) {
          ws.send(
            JSON.stringify({ type: "ERROR", message: "Kode room diperlukan." }),
          );
          ws.close(4000, "No Code");
          return;
        }

        if (!rooms.has(roomCode)) {
          ws.send(
            JSON.stringify({ type: "ERROR", message: "Room tidak ditemukan." }),
          );
          ws.close(4004, "Not Found");
          return;
        }

        const room = rooms.get(roomCode);

        // ── Private room password check ──
        if (room.settings.isPrivate && room.settings.password) {
          if (password !== room.settings.password) {
            send(ws, "ERROR", {
              message: "🔒 Password salah! Room ini private.",
            });
            ws.close(4005, "Wrong Password");
            return;
          }
        }

        // ── Room full ──
        if (room.players.size >= MAX_PLAYERS) {
          send(ws, "ERROR", { message: "⛔ Room penuh! Maks 10 pemain." });
          ws.close(4002, "Full");
          return;
        }

        // ── Game in progress ──
        if (["active", "spinning"].includes(room.status)) {
          send(ws, "ERROR", { message: "🎮 Game sedang berlangsung." });
          ws.close(4003, "In Progress");
          return;
        }

        room.players.set(user.id, {
          ws,
          user: { id: user.id, name: user.name, avatar: user.avatar },
          score: 0,
          answeredCurrent: false,
          isLoser: false,
          hasSubmittedPunishment: false,
          streak: 0,
        });

        const n = room.players.size;
        send(ws, "JOINED", {
          roomCode,
          isHost: user.id === room.hostId,
          userId: user.id,
          playerCount: n,
          roomIsFull: n >= MAX_PLAYERS,
          roomStatus: room.status,
          winnerCount: getWinnerCount(n),
          settings: room.settings,
        });

        if (room.status === "collecting") {
          send(ws, "COLLECT_PUNISHMENTS", {
            playerCount: n,
            winnerCount: getWinnerCount(n),
            loserCount: Math.max(0, n - getWinnerCount(n)),
            timeLimit: room.settings.collectTime * 1000,
            settings: room.settings,
          });
        }

        broadcastLobbyUpdate(room);
        console.log(`[${roomCode}] ${user.name} join (${n}/10)`);
      },

      onMessage(evt, ws) {
        let data;
        try {
          data = JSON.parse(evt.data);
        } catch {
          return;
        }
        const room = rooms.get(roomCode);
        if (!room || !user) return;

        switch (data.type) {
          case "HOST_START_GAME": {
            if (user.id !== room.hostId) {
              send(ws, "ERROR", { message: "Hanya host!" });
              return;
            }
            if (room.players.size < 2) {
              send(ws, "ERROR", { message: "Minimal 2 pemain!" });
              return;
            }
            if (room.status !== "waiting") {
              send(ws, "ERROR", { message: "Game sudah jalan." });
              return;
            }
            startCollecting(room);
            break;
          }

          // Host update settings sebelum game mulai
          case "UPDATE_SETTINGS": {
            if (user.id !== room.hostId) {
              send(ws, "ERROR", {
                message: "Hanya host yang bisa ubah setting!",
              });
              return;
            }
            if (room.status !== "waiting") {
              send(ws, "ERROR", {
                message: "Tidak bisa ubah setting setelah game dimulai.",
              });
              return;
            }
            const newSettings = sanitizeSettings(data.settings);
            room.settings = { ...room.settings, ...newSettings };
            broadcast(room, "SETTINGS_UPDATED", { settings: room.settings });
            console.log(`[${roomCode}] Settings updated:`, room.settings);
            break;
          }

          case "SUBMIT_PUNISHMENT": {
            if (room.status !== "collecting") {
              send(ws, "ERROR", { message: "Bukan waktunya submit hukuman." });
              return;
            }
            const player = room.players.get(user.id);
            if (!player || player.hasSubmittedPunishment) {
              send(ws, "ERROR", { message: "Sudah submit!" });
              return;
            }
            const text = data.punishment?.trim();
            if (!text || text.length < 5 || text.length > 200) {
              send(ws, "ERROR", { message: "Hukuman 5–200 karakter!" });
              return;
            }
            player.hasSubmittedPunishment = true;
            room.punishmentPool.push(text);
            send(ws, "PUNISHMENT_SUBMITTED", { punishment: text });
            const submitted = Array.from(room.players.values()).filter(
              (p) => p.hasSubmittedPunishment,
            ).length;
            broadcast(room, "PUNISHMENT_PROGRESS", {
              submitted,
              total: room.players.size,
            });
            broadcastLobbyUpdate(room);
            checkAllPunishments(room);
            break;
          }

          case "SUBMIT_ANSWER": {
            if (room.status !== "active" || !room.currentQuestion) return;
            const player = room.players.get(user.id);
            if (!player || player.answeredCurrent) {
              send(ws, "ANSWER_RESULT", {
                correct: false,
                message: "Sudah menjawab!",
                yourScore: player?.score || 0,
              });
              return;
            }
            const ans = parseFloat(data.answer);
            const correct = ans === room.currentQuestion.answer;
            player.answeredCurrent = true;

            if (correct) {
              player.streak = (player.streak || 0) + 1;
              const elapsed = Date.now() - room.currentQuestion.startTime;
              const pts = calculatePoints(
                elapsed,
                room.currentQuestion.timeLimitMs,
                player.streak,
              );
              player.score += pts;
              const streakMsg =
                room.settings.showStreak && player.streak > 1
                  ? ` 🔥 ${player.streak}× Streak!`
                  : "";
              send(ws, "ANSWER_RESULT", {
                correct: true,
                points: pts,
                streak: player.streak,
                message: `Benar! +${pts} poin${streakMsg}`,
                yourScore: player.score,
              });
              broadcast(
                room,
                "PLAYER_ANSWERED",
                { playerName: user.name, streak: player.streak },
                user.id,
              );
              broadcast(room, "SCORE_UPDATE", { scores: getScoreBoard(room) });
              if (
                Array.from(room.players.values()).every(
                  (p) => p.answeredCurrent,
                )
              ) {
                clearTimeout(room.questionTimer);
                broadcast(room, "QUESTION_TIMEOUT", {
                  correctAnswer: room.currentQuestion.answer,
                  scores: getScoreBoard(room),
                });
                for (const p of room.players.values())
                  if (!p.answeredCurrent) p.streak = 0;
                room.questionIndex++;
                if (room.questionIndex >= room.settings.totalQuestions)
                  setTimeout(() => startSpinPhase(room), 2500);
                else setTimeout(() => sendQuestion(room), 3000);
              }
            } else {
              player.streak = 0;
              send(ws, "ANSWER_RESULT", {
                correct: false,
                message: `Salah! Jawaban: ${room.currentQuestion.answer}`,
                yourScore: player.score,
              });
            }
            break;
          }

          case "HOST_RESET_GAME": {
            if (user.id !== room.hostId) {
              send(ws, "ERROR", { message: "Hanya host!" });
              return;
            }
            if (!["finished", "spinning"].includes(room.status)) {
              send(ws, "ERROR", { message: "Game belum selesai." });
              return;
            }
            resetRoom(room);
            broadcast(room, "GAME_RESET", {
              message:
                "🔄 Game direset! Masukkan hukuman baru untuk ronde berikutnya.",
            });
            broadcastLobbyUpdate(room);
            break;
          }

          case "CHAT": {
            if (!data.message?.trim()) return;
            broadcast(room, "CHAT", {
              sender: user.name,
              avatar: user.avatar,
              message: data.message.trim().substring(0, 200),
            });
            break;
          }
        }
      },

      onClose(evt, ws) {
        const room = rooms.get(roomCode);
        if (!room || !user) return;
        const leaving = room.players.get(user.id);
        room.players.delete(user.id);
        console.log(
          `[${roomCode}] ${user.name} keluar. Sisa: ${room.players.size}`,
        );

        if (room.players.size === 0) {
          if (room.questionTimer) clearTimeout(room.questionTimer);
          if (room.collectTimer) clearTimeout(room.collectTimer);
          rooms.delete(roomCode);
          console.log(`[${roomCode}] Room dihapus.`);
          return;
        }

        if (room.status === "collecting") {
          if (leaving && !leaving.hasSubmittedPunishment) {
            room.punishmentPool.push(
              `🏃 ${user.name} kabur! Hukumannya: push-up 20x!`,
            );
          }
          const sub = Array.from(room.players.values()).filter(
            (p) => p.hasSubmittedPunishment,
          ).length;
          broadcast(room, "PUNISHMENT_PROGRESS", {
            submitted: sub,
            total: room.players.size,
          });
          checkAllPunishments(room);
        }

        if (
          user.id === room.hostId &&
          ["waiting", "collecting"].includes(room.status)
        ) {
          const next = room.players.entries().next().value;
          if (next) {
            room.hostId = next[0];
            send(next[1].ws, "PROMOTED_TO_HOST", {
              message: "Kamu sekarang jadi Host! 👑",
            });
          }
        }

        broadcastLobbyUpdate(room);
      },

      onError(evt) {
        console.error(`[WS Error] ${roomCode}:`, evt);
      },
    };
  });
}
