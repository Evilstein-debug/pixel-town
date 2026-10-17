# Pixel Town

A cozy pixel-art town where three generative agents (Asha, Rohan, Meera) live their day,
remember, plan and gossip — inspired by *Generative Agents* (Park et al., 2023). Seed a rumour
into one agent and watch it spread through conversation.

## Setup

```bash
npm install
cp server/.env.example server/.env   # then put your key in ANTHROPIC_API_KEY
npm run dev                          # client → http://localhost:5173, server → :3001
```

- **Live mode:** `ANTHROPIC_API_KEY=sk-ant-...` and `MOCK_LLM=0` in `server/.env`. Calls use
  `claude-haiku-4-5-20251001` (override with `LLM_MODEL`). Token usage is logged per call.
- **Mock mode:** `MOCK_LLM=1` (or no key). A deterministic mock returns canned but plausible JSON,
  so the whole sim — including the rumour demo — runs with no network. Use this as the stage fallback.
- The key lives only in `server/.env`; the client never imports it.
- First server start downloads the `all-MiniLM-L6-v2` embedding model (~23 MB). If that fails,
  retrieval falls back to keyword overlap and the sim carries on.

## Demo script (≈5 min)

1. Load **Snapshots → 00-fresh-start-day1-0700** (always regenerated at server boot).
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

Wrist/watch controls (R recenter, M mouse-mock, dwell-to-lock) come in the next phase.

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
- **Persistence:** the world is written to `server/data/world.json` every tick; named snapshots live
  in `server/data/snapshots/`. Loading one restores the full state and keeps running live.

## Socket contract

All payload types are in [`shared/events.ts`](shared/events.ts).

**Watch → server** (namespace `/watch`): `wrist:orient { pitch, roll, yaw, ts }` — degrees, epoch
ms, 30–60 Hz. The server relays it unchanged to browsers as `wrist:orient` and emits
`watch:status { connected }` on connect/disconnect.

**Server → browser:** `world:snapshot`, `world:tick`, `agent:path`, `memory:add`,
`memory:retrieved`, `conversation`, `plan:update`, `log`, `wrist:orient`, `watch:status`,
plus `snapshots:list`.

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

- Edit the map in `shared/map.ts`, then run `npx tsx server/scripts/check-map.ts` to verify row
  widths and that every location is reachable.
- Art is procedural (`client/src/game/art/`). To use a real tileset, set `TEXTURE_SOURCE` in
  `client/src/game/textures.ts` to `spritesheet` and map each logical frame to an index.
