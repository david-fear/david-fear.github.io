# Meeting Bingo Cloudflare setup

This adds a separate Worker and D1 database for one global live bingo room. It does not modify `df-proxy`. The page shares each connected player's name, marked count, and bingo status; each player's card stays local.

## Create the database

1. In Cloudflare, open **Workers & Pages > D1 SQL Database** and create a database named `meeting-bingo`.
2. Open its SQL console and run the contents of `meeting-bingo-schema.sql`.

If you already ran an earlier version of the bingo schema, run this updated schema too. It drops the obsolete `bingo_players` and `bingo_rooms` tables, permanently deleting their old room data, then creates `bingo_live_players` for the single global room.

## Create the Worker

1. Open **Workers & Pages** and create a Worker named `meeting-bingo-api`.
2. In its code editor, replace the starter script with `meeting-bingo-worker.js` and deploy it.
3. Open the Worker **Settings > Bindings**, add a D1 database binding named `BINGO_DB`, select `meeting-bingo`, and deploy again.
4. Visit `https://meeting-bingo-api.david-fear.workers.dev/api/health`. It should return `{"ok":true}`.

The bingo page is configured for that Worker URL and only allows browser requests from `https://david-fear.github.io`. If Cloudflare assigns a different `workers.dev` URL, update `ROOM_API_URL` near the top of the bingo page's game script.

All connected visitors join the same global room; there are no room codes or room creation. The Worker endpoints are `POST /api/live/connect`, `GET /api/live/state?playerId=...`, `POST /api/live/progress`, and `DELETE /api/live/players/{playerId}`. Players inactive for ten minutes are removed on the next room request; away players see a countdown to that expiry in the roster.

Keep the account on Cloudflare's no-cost Workers and D1 plans and do not attach a paid plan. This room is public to anyone who can open the page and submit API requests; names, marked counts, and bingo status are visible to all room participants. Use only for casual play, not private information.