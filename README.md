# Pixel Town

A cozy pixel-art town where three generative agents (Asha, Rohan, Meera) live their day,
remember, plan and gossip — inspired by *Generative Agents* (Park et al., 2023). Seed a rumour
into one agent and watch it spread through conversation.

## Setup

```bash
pnpm install
cp server/.env.example server/.env   # then fill in ANTHROPIC_API_KEY and the Neon URLs
pnpm db:migrate                      # apply migrations (uses DATABASE_URL_UNPOOLED)
pnpm db:seed                         # create a fresh sim with Asha, Rohan and Meera
pnpm dev                             # client → http://localhost:5173, server → :3001
```

- **Database:** Neon Postgres + pgvector via Drizzle. `DATABASE_URL` is the pooled (`-pooler`)
  string the app uses; `DATABASE_URL_UNPOOLED` is the direct one for migrations. `STORE=memory`
  runs with no database at all (nothing persists).
- **Scripts:** `db:generate` (new migration from `server/src/db/schema.ts`), `db:migrate`,
  `db:studio`, `db:seed`, `db:import-json <world.json>` (one-time import of an old save; refuses
  a file it already imported), `snapshot:export <snapshotId> [file]` / `snapshot:import <file>`
  (JSON copy of a snapshot and its history, for sharing or debugging), `test` (set
  `TEST_DATABASE_URL` to also run the postgres tests against a disposable database, e.g. a Neon branch or
  `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg17`).

- **Live mode:** `ANTHROPIC_API_KEY=sk-ant-...` and `MOCK_LLM=0` in `server/.env`. Calls use
  `claude-haiku-4-5-20251001` (override with `LLM_MODEL`). Token usage is logged per call.
- **Mock mode:** `MOCK_LLM=1` (or no key). A deterministic mock returns canned but plausible JSON,
  so the whole sim — including the rumour demo — runs with no network. Use this as the stage fallback.
- The key lives only in `server/.env`; the client never imports it.
- First server start downloads the `all-MiniLM-L6-v2` embedding model (~23 MB). If that fails,
  retrieval falls back to keyword overlap and the sim carries on.

## Demo script (≈5 min)

1. Load **Snapshots → 00-fresh-start-day1-0700** (created with every new sim; loading it forks a fresh copy).
2. Press **Tab** to lock onto Asha, **3** for 4× speed.
3. Around 08:30 press **T**, type `free samosas at the café at 3pm`, **Enter**.
   Asha's memory panel shows the gold *seeded* memory, and she **drops everything**: her plan gets a
   ★ TOP PRIORITY block starting right now, and she heads off immediately.
4. Watch Asha tell Meera (café, late morning) and Rohan (café, lunch). Their memory panels show the
   rumour with a gold dashed border, the event log says who told whom, and both replan to be at the
   café around 15:00.
5. Tip: once the rumour is seeded, **Snapshots → + Save current** gives you a "just before it
   spreads" restore point.

## Controls

| Input | Action |
|---|---|
| W A S D | Pan camera (breaks a lock) |
| Q / E | Zoom out / in (2×–5×) |
| Space | Pause / resume |
| 1 / 2 / 3 | Sim speed 1× / 2× / 4× |
| Tab | Cycle camera lock through agents |
| Esc | Unlock camera → free pan |
| T | Seed a thought into the locked (or selected) agent |
| Click agent | Select it in the inspector (doesn't lock) |

## How the sim works

- **Time:** 1 tick = 10 game minutes = 2.5 s real at 1×. Day 1 starts 07:00; agents sleep 22:00–07:00
  and make no LLM calls while asleep.
- **Movement:** A* over the walk grid (`server/src/sim/pathfinding.ts`), 1 tile per 400 ms at 1×.
  Agents set off early enough to arrive when the next plan block starts.
- **Perception:** each tick, agents note other agents within 5 tiles and where they arrived —
  only when something changed.
- **Memory & retrieval:** `recency (0.995^hours) + importance/10 + relevance (cosine)`, each
  min-max normalised, top 8. Every retrieval is broadcast so the inspector can show the score bars.
- **LLM calls** (all JSON; prompts in `server/src/prompts/`): batched importance scoring, daily plan
  at wake-up, reactive replan when a memory scores ≥ 7, and conversations (decide → generate all
  lines + what each person learned). At most 2 calls in flight.
- **Seeds are top priority:** a seeded thought wakes the agent, cuts short any chat, and forces an
  immediate replan (no cooldown) whose first block starts *now* and is marked `priority`. Priority
  blocks override bedtime and survive later replans. Agents with unshared seeded news always stop
  to tell whoever they meet (no "should we talk?" call), the news must come up in the first two
  lines, and chats are kept short when someone is on a priority errand.
- **Rumour tracking:** conversation memories that repeat a seeded memory (by embedding similarity)
  get `seedId`, shown as gold dashed rows in the inspector.
- **Persistence:** Postgres is the source of truth. Writes are buffered during a tick and persisted
  in one transaction per tick (at most one in flight; a failed batch is retried next tick). A restart
  resumes the newest non-archived sim (or `SIM_ID`). Snapshots are rows; loading one forks a new sim
  from it and archives the current one, so history is never rewritten.

## Socket contract

All payload types are in [`shared/events.ts`](shared/events.ts).

**Server → browser:** `world:snapshot`, `world:tick`, `agent:path`, `memory:add`,
`memory:retrieved`, `conversation`, `plan:update`, `log`, plus `snapshots:list`.

**Browser → server:** `sim:control { cmd: 'pause'|'play'|'speed', value? }`,
`event:seed { agentId, text }`, `replay:load { file }`, `snapshot:save`.

Additions beyond the original contract (browser-facing only): `world:snapshot` also carries
`memories`, `plans`, `conversations` and `snapshots`; `world:tick` carries `paused`/`speed`;
`conversation` carries `ts`/`locationId`; memories may carry `seedId`; new `snapshots:list` event.

## Layout

```
client/   Vite + React + Tailwind v4 + Phaser 3 (React = HUD, Phaser = canvas)
server/   Express + Socket.IO sim server, prompts, LLM client
shared/   Map layout (ASCII), domain types, socket contract
```

- Edit the map in `shared/map.ts`, then run `pnpm check-map` to verify row
  widths and that every location is reachable.
- Art is procedural (`client/src/game/art/`). To use a real tileset, set `TEXTURE_SOURCE` in
  `client/src/game/textures.ts` to `spritesheet` and map each logical frame to an index.
