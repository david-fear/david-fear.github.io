const ALLOWED_ORIGIN = 'https://david-fear.github.io';
const MAX_PLAYERS = 32;
const PLAYER_TIMEOUT_SECONDS = 600;

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

async function upsertPlayer(db, playerId, playerName, progress, now) {
  await db.prepare(`
    INSERT INTO bingo_live_players (player_id, player_name, marked, bingo, joined_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id) DO UPDATE SET
      player_name = excluded.player_name,
      marked = excluded.marked,
      bingo = excluded.bingo,
      last_seen = excluded.last_seen
  `).bind(playerId, playerName, progress.marked, progress.bingo, now, now).run();
}

async function liveRoomState(db, playerId) {
  const now = Math.floor(Date.now() / 1000);
  if (playerId && validPlayerId(playerId)) {
    await db.prepare('UPDATE bingo_live_players SET last_seen = ? WHERE player_id = ?')
      .bind(now, playerId).run();
  }
  await db.prepare('DELETE FROM bingo_live_players WHERE last_seen < ?')
    .bind(now - PLAYER_TIMEOUT_SECONDS).run();
  const players = await db.prepare(`
    SELECT player_id, player_name, marked, bingo, joined_at, last_seen
    FROM bingo_live_players
    ORDER BY joined_at, player_id
  `).all();
  const formattedPlayers = [];
  for (const player of players.results) {
    const lastSeen = Number(player.last_seen);
    const formattedPlayer = {};
    formattedPlayer.id = player.player_id;
    formattedPlayer.name = player.player_name;
    formattedPlayer.marked = player.marked;
    formattedPlayer.bingo = Boolean(player.bingo);
    formattedPlayer.joinedAt = player.joined_at;
    formattedPlayer.online = lastSeen + 20 > now;
    formattedPlayer.disconnectAt = lastSeen + PLAYER_TIMEOUT_SECONDS;
    formattedPlayers.push(formattedPlayer);
  }
  return { players: formattedPlayers };
}

async function connectToLiveRoom(db, body) {
  if (!validPlayerId(body?.playerId)) return jsonResponse({ error: 'Invalid player session.' }, 400);
  const playerName = cleanPlayerName(body?.playerName);
  if (!playerName) return jsonResponse({ error: 'Enter your name before connecting.' }, 400);
  const progress = readProgress(body);
  if (!progress) return jsonResponse({ error: 'Invalid progress data.' }, 400);

  const now = Math.floor(Date.now() / 1000);
  await db.prepare('DELETE FROM bingo_live_players WHERE last_seen < ?')
    .bind(now - PLAYER_TIMEOUT_SECONDS).run();
  const existing = await db.prepare('SELECT player_id FROM bingo_live_players WHERE player_id = ?')
    .bind(body.playerId).first();
  const count = await db.prepare('SELECT COUNT(*) AS player_count FROM bingo_live_players').first();
  if (!existing && count.player_count >= MAX_PLAYERS) {
    return jsonResponse({ error: 'The live room is full.' }, 409);
  }
  await upsertPlayer(db, body.playerId, playerName, progress, now);
  return jsonResponse(await liveRoomState(db, body.playerId));
}

async function updateProgress(db, body) {
  if (!validPlayerId(body?.playerId)) {
    return jsonResponse({ error: 'Invalid room or player session.' }, 400);
  }
  const playerName = cleanPlayerName(body?.playerName);
  if (!playerName) return jsonResponse({ error: 'Enter your name before updating room progress.' }, 400);
  const progress = readProgress(body);
  if (!progress) return jsonResponse({ error: 'Invalid progress data.' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`
    UPDATE bingo_live_players
    SET player_name = ?, marked = ?, bingo = ?, last_seen = ?
    WHERE player_id = ?
  `).bind(playerName, progress.marked, progress.bingo, now, body.playerId).run();
  if (!result.meta.changes) return jsonResponse({ error: 'Your live session expired. Connect again.' }, 404);
  return jsonResponse(await liveRoomState(db, body.playerId));
}

async function disconnectPlayer(db, playerId) {
  if (!validPlayerId(playerId)) return jsonResponse({ error: 'Invalid player session.' }, 400);
  await db.prepare('DELETE FROM bingo_live_players WHERE player_id = ?').bind(playerId).run();
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
    if (parts[0] !== 'api' || parts[1] !== 'live') return jsonResponse({ error: 'Not found.' }, 404);

    try {
      if (parts.length === 3 && parts[2] === 'connect' && request.method === 'POST') {
        return await connectToLiveRoom(env.BINGO_DB, await readBody(request));
      }
      if (parts.length === 3 && parts[2] === 'progress' && request.method === 'POST') {
        return await updateProgress(env.BINGO_DB, await readBody(request));
      }
      if (parts.length === 3 && parts[2] === 'state' && request.method === 'GET') {
        const playerId = url.searchParams.get('playerId');
        if (!validPlayerId(playerId)) return jsonResponse({ error: 'Invalid player session.' }, 400);
        return jsonResponse(await liveRoomState(env.BINGO_DB, playerId));
      }
      if (parts.length === 4 && parts[2] === 'players' && request.method === 'DELETE') {
        return await disconnectPlayer(env.BINGO_DB, parts[3]);
      }
      return jsonResponse({ error: 'Not found.' }, 404);
    } catch (error) {
      return jsonResponse({ error: 'Room service error.' }, 500);
    }
  }
};