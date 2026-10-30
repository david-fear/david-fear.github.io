CREATE TABLE IF NOT EXISTS bingo_rooms (
  room_code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bingo_players (
  room_code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL CHECK (length(player_name) BETWEEN 1 AND 24),
  marked INTEGER NOT NULL DEFAULT 0 CHECK (marked BETWEEN 0 AND 22),
  bingo INTEGER NOT NULL DEFAULT 0 CHECK (bingo IN (0, 1)),
  joined_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (room_code, player_id)
);

CREATE INDEX IF NOT EXISTS bingo_players_room_joined
  ON bingo_players (room_code, joined_at, player_id);

CREATE INDEX IF NOT EXISTS bingo_rooms_created
  ON bingo_rooms (created_at);