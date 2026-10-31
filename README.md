# MOAB: Warfront

Online, turn-based island-conquest strategy for 2–6 players, in the spirit of *Mother Of All Battles*. Start with one coastal city on a map of the Earth, build units, capture cities and ferry armies across the sea. One codebase will run on the web, on iOS and Android (Capacitor) and inside Discord.

Phase 1 (the rules engine, eight maps and a hot-seat web version) and phase 2 (online play: a Node server with Socket.IO and PostgreSQL, guest accounts, lobbies and live turns) are built. Async play, Discord and the mobile apps come next.

## Run it

```bash
npm install
npm run dev        # hot-seat web version at http://localhost:5173
npm test           # rules engine tests
npm run typecheck
npm run build      # production build of the web version
npm run maps       # rebuild every map from Natural Earth data
```

Node 20.12 or newer.

### Game server

Needs Docker for the local database.

```bash
cp apps/server/.env.example apps/server/.env
npm run db:up      # Postgres 17 on localhost:5434
npm run server     # http://localhost:3100, migrates the database first
curl localhost:3100/health
```

## Deploy

The web client is a static site on **Vercel**; the game server is one long-running Node process on **Render**, because it keeps live matches in memory, holds a WebSocket per player and runs the turn clock. The database is **Neon** Postgres, added from the Vercel Marketplace.

1. **Vercel**: import the repository. `vercel.json` sets the build. Add the environment variable `VITE_SERVER_URL` = the Render service URL (for example `https://moab-warfront-server.onrender.com`) and redeploy, since Vite bakes it in at build time.
2. **Neon**: in the Vercel project, Storage, create a Neon database. Copy its **unpooled** connection string (`DATABASE_URL_UNPOOLED`).
3. **Render**: New, Blueprint, pick the repository. `render.yaml` creates the server. Fill in `DATABASE_URL` (the Neon unpooled string) and `CLIENT_ORIGINS` (the Vercel site address). `AUTH_SECRET` is generated. The server applies migrations when it starts.
4. Open the Vercel site, sign in as a guest and create a match; `/health` on the Render URL should answer `{"ok":true,"db":"up"}`.

On Render's free plan the server sleeps after 15 minutes without requests and takes about a minute to wake. Matches survive it: the server reloads them from the database, and turn clocks that ran out meanwhile fire when it wakes.

## Layout

```
packages/shared/   Rules engine, world map and shared types. Pure TypeScript, no I/O.
  src/world/       24 maps (8 regions x 3 sizes) and the GameMap class
  src/engine.ts    createMatch, applyAction, finishPicking
  src/view.ts      viewFor: the fogged view one player may see
  src/bot.ts       a simple bot for empty seats
  scripts/         build-world.mjs and the city source list
  test/            Vitest suites
apps/web/          React + Vite. Phase 1: hot-seat play-test harness drawn on a canvas.
apps/server/       Express, Socket.IO and PostgreSQL. Phase 2: scaffold, health route, schema.
```

## The engine in one minute

```ts
import { createMatch, applyAction, viewFor, DEFAULT_SETTINGS } from '@warfront/shared';

let game = createMatch({ settings: DEFAULT_SETTINGS, players: [{ name: 'Ana' }, { name: 'Ben' }], seed: 'secret' });
const view = viewFor(game, 0);                      // what seat 0 is allowed to know
game = applyAction(game, 0, { type: 'endTurn' }).state;
```

- `applyAction` never changes the state it is given. It returns the new state and the events the action caused, each tagged with the seats that saw it. A refused action throws a `RuleError` with a `code`.
- Randomness comes from the match seed and a counter in the state, so the same seed and actions always replay the same match. The seed never appears in a player's view.
- `viewFor` leaves out enemy units out of sight, submarines not next to your destroyers, other players' cargo and production, and other players' start picks before turn 1.

## Rules decisions made while building

These follow the design doc. A few details the doc left open:

- **Stacking:** a tile holds units of one owner only, with no limit on how many.
- **Combat:** the attacker never moves into the tile it won; taking a city needs a separate move.
- **Aircraft:** at the end of a turn, an aircraft outside a base flies to the nearest of your cities or carriers it can reach with the moves it has left. If none is in reach, it is lost.
- **Starting units:** none. Each player starts with one coastal city building tanks.
- **Bot:** a simple land-only bot. It builds tanks, keeps one home as a garrison and sends the rest at the nearest city it does not own. Better bots are phase 3.

## Map data

Coastlines come from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via the `world-atlas` package. Mountain ranges are approximate boxes, for terrain only. `npm run maps` regenerates the maps in `packages/shared/src/world/maps/`. Velgard's coastline and names are original, drawn for this game.
