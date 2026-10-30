DROP TABLE IF EXISTS bingo_players;
DROP TABLE IF EXISTS bingo_rooms;

CREATE TABLE IF NOT EXISTS bingo_live_players (
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL CHECK (length(player_name) BETWEEN 1 AND 24),
  marked INTEGER NOT NULL DEFAULT 0 CHECK (marked BETWEEN 0 AND 22),
  bingo INTEGER NOT NULL DEFAULT 0 CHECK (bingo IN (0, 1)),
  joined_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (player_id)
);

CREATE INDEX IF NOT EXISTS bingo_live_players_joined
  ON bingo_live_players (joined_at, player_id);

CREATE INDEX IF NOT EXISTS bingo_live_players_last_seen
  ON bingo_live_players (last_seen);