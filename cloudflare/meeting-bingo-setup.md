# Meeting Bingo Cloudflare setup

This adds a separate Worker and D1 database for anonymous room progress. It does not modify `df-proxy` or store names, cards, or phrase contents.

## Create the database

1. In Cloudflare, open **Workers & Pages > D1 SQL Database** and create a database named `meeting-bingo`.
2. Open its SQL console and run the contents of `meeting-bingo-schema.sql`.

## Create the Worker

1. Open **Workers & Pages** and create a Worker named `meeting-bingo-api`.
2. In its code editor, replace the starter script with `meeting-bingo-worker.js` and deploy it.
3. Open the Worker **Settings > Bindings**, add a D1 database binding named `BINGO_DB`, select `meeting-bingo`, and deploy again.
4. Visit `https://meeting-bingo-api.david-fear.workers.dev/api/health`. It should return `{"ok":true}`.

The bingo page is configured for that Worker URL and only allows browser requests from `https://david-fear.github.io`. If Cloudflare assigns a different `workers.dev` URL, update `ROOM_API_URL` near the top of the bingo page's game script.

Keep the account on Cloudflare's no-cost Workers and D1 plans and do not attach a paid plan. The API stores an eight-character room code, the player names entered for that room, per-tab IDs, marked counts, bingo status, and timestamps. Players inactive for five minutes are removed; rooms older than one day are cleaned up when a new room is created. Anyone with a room code can see and submit progress for that room, so use it only for this casual game and do not put private information in it.