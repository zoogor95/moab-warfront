# MOAB: Warfront

Online, turn-based island-conquest strategy for 2–6 players, in the spirit of *Mother Of All Battles*. Start with one coastal city on a map of the Earth, build units, capture cities and ferry armies across the sea. One codebase will run on the web, on iOS and Android (Capacitor) and inside Discord.

This repository is at **phase 1** of the roadmap: the rules engine, the world map and a hot-seat web version for play-testing on one device. Online play (Node server, Socket.IO, PostgreSQL) is phase 2.

## Run it

```bash
npm install
npm run dev        # hot-seat web version at http://localhost:5173
npm test           # rules engine tests
npm run typecheck
npm run build      # production build of the web version
npm run world      # rebuild the world map from Natural Earth data
```

Node 20.12 or newer.

### Game server (phase 2, in progress)

Needs Docker for the local database.

```bash
cp apps/server/.env.example apps/server/.env
npm run db:up      # Postgres 17 on localhost:5434
npm run server     # http://localhost:3100, migrates the database first
curl localhost:3100/health
```

## Layout

```
packages/shared/   Rules engine, world map and shared types. Pure TypeScript, no I/O.
  src/world/       world-v1.json (180 x 90 tiles, 134 cities) and map helpers
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

Coastlines come from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via the `world-atlas` package. Mountain ranges are approximate boxes, for terrain only. `npm run world` regenerates `packages/shared/src/world/world-v1.json`.
