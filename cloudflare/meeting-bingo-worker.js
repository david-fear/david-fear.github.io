const ALLOWED_ORIGIN = 'https://david-fear.github.io';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 32;
const PLAYER_TIMEOUT_SECONDS = 300;
const ROOM_TTL_SECONDS = 86400;

function responseHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders() });
}

function validPlayerId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{20,64}$/.test(value);
}

function cleanPlayerName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
}

function validRoomCode(value) {
  return typeof value === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(value);
}

function makeRoomCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => CODE_CHARS[byte % CODE_CHARS.length]).join('');
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function readProgress(body) {
  const marked = Number(body?.marked);
  if (!Number.isInteger(marked) || marked < 0 || marked > 22 || typeof body?.bingo !== 'boolean') {
    return null;
  }
  return { marked, bingo: body.bingo ? 1 : 0 };
}

async function upsertPlayer(db, roomCode, playerId, playerName, progress, now) {
  await db.prepare(`
    INSERT INTO bingo_players (room_code, player_id, player_name, marked, bingo, joined_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(room_code, player_id) DO UPDATE SET
      player_name = excluded.player_name,
      marked = excluded.marked,
      bingo = excluded.bingo,
      last_seen = excluded.last_seen
  `).bind(roomCode, playerId, playerName, progress.marked, progress.bingo, now, now).run();
}

async function roomExists(db, roomCode) {
  return Boolean(await db.prepare('SELECT room_code FROM bingo_rooms WHERE room_code = ?').bind(roomCode).first());
}

async function roomState(db, roomCode, playerId) {
  const now = Math.floor(Date.now() / 1000);
  if (playerId && validPlayerId(playerId)) {
    await db.prepare('UPDATE bingo_players SET last_seen = ? WHERE room_code = ? AND player_id = ?')
      .bind(now, roomCode, playerId).run();
  }
  await db.prepare('DELETE FROM bingo_players WHERE room_code = ? AND last_seen < ?')
    .bind(roomCode, now - PLAYER_TIMEOUT_SECONDS).run();
  const players = await db.prepare(`
    SELECT player_id, player_name, marked, bingo, joined_at, last_seen
    FROM bingo_players
    WHERE room_code = ?
    ORDER BY joined_at, player_id
  `).bind(roomCode).all();
  return {
    roomCode,
    players: players.results.map(player => ({
      id: player.player_id,
      name: player.player_name,
      marked: player.marked,
      bingo: Boolean(player.bingo),
      joinedAt: player.joined_at,
      online: now - player.last_seen <= 20
    }))
  };
}

async function createRoom(db, body) {
  if (!validPlayerId(body?.playerId)) return jsonResponse({ error: 'Invalid player session.' }, 400);
  const playerName = cleanPlayerName(body?.playerName);
  if (!playerName) return jsonResponse({ error: 'Enter your name before creating a room.' }, 400);
  const progress = readProgress(body);
  if (!progress) return jsonResponse({ error: 'Invalid progress data.' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - ROOM_TTL_SECONDS;
  await db.prepare('DELETE FROM bingo_players WHERE room_code IN (SELECT room_code FROM bingo_rooms WHERE created_at < ?)')
    .bind(cutoff).run();
  await db.prepare('DELETE FROM bingo_rooms WHERE created_at < ?').bind(cutoff).run();

  let roomCode;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = makeRoomCode();
    if (!await roomExists(db, candidate)) {
      roomCode = candidate;
      break;
    }
  }
  if (!roomCode) return jsonResponse({ error: 'Could not create a room. Please try again.' }, 503);

  await db.prepare('INSERT INTO bingo_rooms (room_code, created_at) VALUES (?, ?)').bind(roomCode, now).run();
  await upsertPlayer(db, roomCode, body.playerId, playerName, progress, now);
  return jsonResponse(await roomState(db, roomCode, body.playerId), 201);
}

async function joinRoom(db, roomCode, body) {
  if (!validRoomCode(roomCode) || !validPlayerId(body?.playerId)) {
    return jsonResponse({ error: 'Enter a valid room code.' }, 400);
  }
  const playerName = cleanPlayerName(body?.playerName);
  if (!playerName) return jsonResponse({ error: 'Enter your name before joining a room.' }, 400);
  if (!await roomExists(db, roomCode)) return jsonResponse({ error: 'Room not found. Check the code and try again.' }, 404);
  const progress = readProgress(body);
  if (!progress) return jsonResponse({ error: 'Invalid progress data.' }, 400);

  const existing = await db.prepare('SELECT player_id FROM bingo_players WHERE room_code = ? AND player_id = ?')
    .bind(roomCode, body.playerId).first();
  const count = await db.prepare('SELECT COUNT(*) AS player_count FROM bingo_players WHERE room_code = ?')
    .bind(roomCode).first();
  if (!existing && count.player_count >= MAX_PLAYERS) {
    return jsonResponse({ error: 'This room is full.' }, 409);
  }

  await upsertPlayer(db, roomCode, body.playerId, playerName, progress, Math.floor(Date.now() / 1000));
  return jsonResponse(await roomState(db, roomCode, body.playerId));
}

async function updateProgress(db, roomCode, body) {
  if (!validRoomCode(roomCode) || !validPlayerId(body?.playerId)) {
    return jsonResponse({ error: 'Invalid room or player session.' }, 400);
  }
  const playerName = cleanPlayerName(body?.playerName);
  if (!playerName) return jsonResponse({ error: 'Enter your name before updating room progress.' }, 400);
  const progress = readProgress(body);
  if (!progress) return jsonResponse({ error: 'Invalid progress data.' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`
    UPDATE bingo_players
    SET player_name = ?, marked = ?, bingo = ?, last_seen = ?
    WHERE room_code = ? AND player_id = ?
  `).bind(playerName, progress.marked, progress.bingo, now, roomCode, body.playerId).run();
  if (!result.meta.changes) return jsonResponse({ error: 'You are not in this room. Join again.' }, 404);
  return jsonResponse(await roomState(db, roomCode, body.playerId));
}

async function leaveRoom(db, roomCode, playerId) {
  if (!validRoomCode(roomCode) || !validPlayerId(playerId)) {
    return jsonResponse({ error: 'Invalid room or player session.' }, 400);
  }
  await db.prepare('DELETE FROM bingo_players WHERE room_code = ? AND player_id = ?').bind(roomCode, playerId).run();
  return jsonResponse({ ok: true });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED_ORIGIN) return jsonResponse({ error: 'Origin not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders() });
    if (request.method === 'GET' && new URL(request.url).pathname === '/api/health') {
      return jsonResponse({ ok: true });
    }

    if (!env.BINGO_DB) return jsonResponse({ error: 'D1 binding BINGO_DB is missing.' }, 500);
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'rooms') return jsonResponse({ error: 'Not found.' }, 404);

    try {
      if (parts.length === 2 && request.method === 'POST') {
        return await createRoom(env.BINGO_DB, await readBody(request));
      }
      if (parts.length === 4) {
        const [, , roomCode, action] = parts;
        if (action === 'join' && request.method === 'POST') {
          return await joinRoom(env.BINGO_DB, roomCode.toUpperCase(), await readBody(request));
        }
        if (action === 'progress' && request.method === 'POST') {
          return await updateProgress(env.BINGO_DB, roomCode.toUpperCase(), await readBody(request));
        }
        if (action === 'state' && request.method === 'GET') {
          const code = roomCode.toUpperCase();
          if (!validRoomCode(code) || !await roomExists(env.BINGO_DB, code)) {
            return jsonResponse({ error: 'Room not found.' }, 404);
          }
          return jsonResponse(await roomState(env.BINGO_DB, code, url.searchParams.get('playerId')));
        }
      }
      if (parts.length === 5 && parts[3] === 'players' && request.method === 'DELETE') {
        return await leaveRoom(env.BINGO_DB, parts[2].toUpperCase(), parts[4]);
      }
      return jsonResponse({ error: 'Not found.' }, 404);
    } catch (error) {
      return jsonResponse({ error: 'Room service error.' }, 500);
    }
  }
};