# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pixel Town: three generative agents (Asha, Rohan, Meera) living in a pixel-art town, after *Generative Agents* (Park et al., 2023). The user can seed a rumour into one agent and watch it spread through conversation. README.md has the demo script, controls and the full socket contract.

## Commands

pnpm workspace (`shared`, `server`, `client`; see `pnpm-workspace.yaml`). Run these from the repo root:

```bash
pnpm install
cp server/.env.example server/.env    # ANTHROPIC_API_KEY, Neon DATABASE_URL (pooled) + DATABASE_URL_UNPOOLED
pnpm dev                              # server (tsx watch, :3001) + client (Vite, :5173) via concurrently
pnpm typecheck                        # tsc --noEmit for every workspace
pnpm --filter @pixel-town/server typecheck   # one workspace
pnpm --filter @pixel-town/client build       # production client build
pnpm test                             # vitest (server); add TEST_DATABASE_URL to also run the postgres suite
pnpm --filter @pixel-town/server exec vitest run test/env.test.ts   # one test file
pnpm db:generate | db:migrate | db:studio | db:seed | db:import-json <file>
pnpm snapshot:export <snapshotId> [file] | snapshot:import <file>
pnpm check-map                        # check the ASCII map after editing shared/map.ts
```

There is no linter. Use pnpm, not npm: dependency build scripts are allowlisted in `pnpm-workspace.yaml`.

- **Mock mode:** with `MOCK_LLM=1`, or with no API key, every prompt returns its deterministic `mock()` output. The whole sim runs offline this way, rumour demo included. Use it for dev and verification so you don't spend tokens.
- The first server start downloads the `all-MiniLM-L6-v2` embedding model. If that fails, retrieval falls back to keyword overlap.
- State lives in Postgres (or in-process with `STORE=memory`). There is no file persistence; don't add any.

## Architecture

**shared/**: imported as `@pixel-town/shared` straight from the `.ts` source (there is no build step). It holds the ASCII map plus `LEGEND`/`LOCATIONS` (`map.ts`), domain types (`types.ts`), and the typed Socket.IO contract `ServerToClientEvents`/`ClientToServerEvents` (`events.ts`). To add or change a socket event, edit `events.ts` first. Both sides are typed against it.

**server/**: the server is authoritative. It owns the world state and all the LLM calls.
- `src/index.ts` starts Express + Socket.IO, creates one `Sim`, and wires browser events to it.
- `sim/sim.ts`: the `Sim` class runs two 50 ms intervals. One moves agents along A* paths. The other fires a game tick once enough speed-scaled real time has passed (1 tick = 10 game min; see `sim/time.ts`). Each tick runs `updateAgent` (behavior.ts: plan following, sleep, pathing) → `perceive` → `checkConversations` (social.ts) → `scoreImportance`, then emits `world:tick` and saves.
- `sim/cognition.ts`: perception, batched importance scoring, daily plans, and reactive replans when a memory scores ≥ 7 or is seeded. `sim/memory.ts` + `sim/embeddings.ts` handle memory creation and retrieval. A retrieval score is recency + importance + relevance, each min-max normalised.
- `SimContext` (`sim/context.ts`) is the interface that behavior/cognition/social code gets in place of `Sim`. **Async LLM work must capture `ctx.world` before it awaits, then check `ctx.isCurrent(world)` afterwards.** Loading a snapshot swaps `sim.world`, and stale results have to be dropped.
- `llm/client.ts`: every LLM call goes through a `PromptSpec` (`build`, `parse`, `mock`, `fallback`). The client runs at most 2 requests at once, expects JSON-only replies with one retry, falls back to `fallback()` on failure, and logs tokens. Each prompt lives in its own file in `src/prompts/`, and a new prompt has to implement all four members. The default model is `claude-haiku-4-5-20251001`, which `LLM_MODEL` overrides.
- Seeded thoughts are top priority: the agent wakes, any chat is cut short, a forced `priority` replan runs, and the agent always shares the news with whoever it meets. See README "How the sim works" for the exact rules, and keep them in sync if you change this behaviour.

**client/**: Vite + React 19 + Tailwind v4 + Phaser 3. Vite proxies `/socket.io` to :3001.
- `net/socket.ts` holds the single socket. Incoming events update the client mirror in `world/store.ts`, a mutable object plus `changed()`. React reads it through `useWorld()` (`useSyncExternalStore`).
- React (`hud/`) draws the HUD and Phaser (`game/`, `TownScene`) draws the canvas. They talk only through the typed `bus` (`bus.ts`), which carries discrete events and never per-frame state. Phaser can also read `world` directly.
- The art is procedural pixel art in `game/art/`. `TEXTURE_SOURCE` in `game/textures.ts` switches to a real spritesheet.
- `ANTHROPIC_API_KEY` must never reach the client. Only the server reads `server/.env`.
