# Migration plan: Pixel Town → Neon + Drizzle + pgvector

Phase 0 audit. Everything below was read from the code at commit `6256c67` and measured against
`server/data/world.json` as it exists on disk. Where the migration brief disagrees with the code,
the code is described as-is and the mismatch is flagged with **⚠ Mismatch**.

---

## 0. Mismatches between the brief and the code (read first)

| # | Brief assumes | Code actually does |
|---|---|---|
| M1 | `world.json` is the persistence layer and a restart resumes | **`world.json` is write-only.** `saveRolling` writes it every tick (`server/src/sim/world.ts:84`), but nothing ever reads it. Boot always calls `createWorld()` (`server/src/index.ts:19`), so every restart is a fresh Day 1 07:00. Resume-on-restart is a new feature in Phase 2, not a port. |
| M2 | A `/watch` namespace and a fake-watch script exist | **Neither exists.** The server never creates a `/watch` namespace and never emits `wrist:orient` / `watch:status`. No fake-watch script is in the repo. Watch code is limited to types, one HUD chip and comments (§5). The README's "Socket contract" section describes a relay that was never built. |
| M3 | Min-max with all-equal values → 0 | The current `normalise` returns **1** for an all-equal component (`memory.ts:54`). Switching to 0 changes ranking on small candidate sets, which is intended but is a behaviour change. |
| M4 | `relevance = cosine similarity` | Current relevance is **`(cos + 1) / 2`** (`embeddings.ts:53`). It falls back **per pair** to keyword Jaccard overlap when either side lacks an embedding. |
| M5 | `importance` smallint 1–10 | Unscored memories are stored with `importance = 0` (`UNSCORED`, `memory.ts:9`). Retrieval treats 0 as 3. The DB column needs to be **nullable** (null = unscored), or the constraint must allow 0. |
| M6 | "one importance LLM call per tick" | Already batched across all agents. The batch is **skipped** while a previous call is still in flight (`scoring` flag, `cognition.ts:79`), so it's "at most one in flight", not strictly one per tick. Memories created during the call wait for the next one. |
| M7 | Writes happen inside the tick | Most memories are created **asynchronously, outside the tick**: after `await runPrompt(...)` in plan, replan and conversation, after `embed()`, and from `seed()` triggered by a socket. "Collect writes per tick" therefore means a write buffer that any code can append to, flushed by the next tick. |
| M8 | Plans have history | Plans are **overwritten in place** (`agent.plan = ...`). There is no history; `planDay` only records which day the plan is for. |
| M9 | Memory `type` includes `reflection` | `MemoryType = 'observation' \| 'conversation' \| 'seeded' \| 'plan'` (`shared/types.ts:7`). Reflection doesn't exist yet (Phase 4). |
| M10 | `llm_calls.purpose` = importance/plan/replan/talk_decide/dialogue/reflect | Current `PromptSpec.kind` values are `importance`, `daily-plan`, `replan`, `should-talk`, `conversation`. Mapping: `daily-plan→plan`, `should-talk→talk_decide`, `conversation→dialogue`. |
| M11 | `agents.color` | Agents have an `appearance` object with **four** colours (`shirt`, `hair`, `skin`, `pants`), which the procedural sprites and portraits use. One `color` column can't hold it, so I propose `appearance jsonb` instead. |
| M12 | — | Memories carry **`seedId`** (rumour tracking), which the brief's schema doesn't have. Rumour spread, `knownRumours`, the "has news" conversation rule and the inspector's gold rows all depend on it. Needs a real column (§6). |

---

## 1. Where world and memory state lives today

### Files read or written
| Path | What | R/W |
|---|---|---|
| `server/data/world.json` | Whole `WorldState` serialised every tick (atomic tmp+rename) | **W only** (`world.ts:84–97`, called from `sim.ts:78`) |
| `server/data/snapshots/*.json` | Named full `WorldState` copies | W: `saveSnapshot` (`world.ts:101`), at boot (`index.ts:21`) and on `snapshot:save` (`sim.ts:137`). R: `loadSnapshot` (`world.ts:117`) on `replay:load` (`sim.ts:144`). List: `listSnapshots` (`world.ts:108`). |
| `server/data/snapshots/00-fresh-start-day1-0700.json` | Overwritten at every boot | W |

### In-process state (server)
| Where | State |
|---|---|
| `Sim.world: WorldState` (`sim/sim.ts:23`) | The whole world: clock, paused, speed, agents (incl. runtime fields), memories, log, conversations, lastTalk, seq. Swapped wholesale by `loadSnapshot`, and async code guards with `ctx.isCurrent(world)`. |
| `world.memories: Memory[]` | Every memory of every agent, embeddings included, unbounded. Linear-scanned by `retrieve`, `knownRumours`, `matchSeed`, `scoreImportance`, and the replan fact lookup. |
| `world.log` | Capped at 200 (`sim.ts:91`). The snapshot sends the last 60. |
| `world.conversations` | Capped at 50 (`social.ts:82`). The snapshot sends the last 20. |
| `world.lastTalk` | pairKey → game minute, for the conversation cooldown |
| `world.seq` | One counter shared by memory ids (`m<n>`) and conversation ids (`c<n>`) |
| `replanChains: Map<agentId, Promise>` (`cognition.ts:104`) | Serialises replans per agent (runtime only) |
| `scoring` flag (`cognition.ts:79`), `saving` flag (`world.ts:82`) | Module-level concurrency guards |
| `llm/client.ts` `totals`, queue | Token totals (console only) and the 2-slot request queue |
| `embeddings.ts` `extractor`, `status` | Loaded model |

### In-process state (client, a mirror only)
`client/src/world/store.ts` holds a mirror fed by socket events. It caps the log at 200 and conversations at 50. It's a projection, not a source of truth, so it stays as is.

---

## 2. Current shapes

### Agents (`AgentState`, `server/src/sim/types.ts:7`)
Seeded from the constant `AGENT_SEEDS` (`server/src/agents/seed.ts`): Asha, Rohan, Meera.

| Field | Kind | Notes |
|---|---|---|
| `id` | identity | Human slug `'asha'`. Used in pairKey, prompts, mock `CANNED` plans (`dailyPlan.ts:13`), and conversation `speakerId` |
| `name, age, occupation, bio` | identity | |
| `relationships` | identity | Free text, used in prompts (`prompts/common.ts:15`) |
| `homeId` | identity | Location id. **Homes are hard-coded zones in `shared/map.ts:100–102`** |
| `appearance {shirt,hair,skin,pants}` | identity | Hex colours for sprites |
| `tileX, tileY, facing` | state | |
| `path: Point[]` | state | Remaining tiles |
| `stepMs` | runtime | Sub-tile movement accumulator |
| `targetLocationId` | state | |
| `action` | state | |
| `plan: PlanBlock[]`, `planDay` | state | Current plan only |
| `asleep` | state | |
| `talkingWith`, `talkUntil` | state | Current conversation partner and end minute |
| `busy` | runtime | An LLM call is in flight (reset to false on load) |
| `lastPerceived {locationId, nearby[]}` | state | Perception dedupe |
| `lastReplanAt` | state | Replan cooldown. `-Infinity` serialises as `null` in JSON |

`statusIcon` and `locationId` are **derived** (`world.ts:41–56`), not stored.

### Memories (`Memory`, `shared/types.ts:9`)
`{ id: 'm<n>', agentId, createdAt, lastAccessed, type, text, importance (0 = unscored, else 1–10), embedding: number[384] (rounded to 1e-4), seedId? }`.
Created by `createMemory` (`memory.ts:11`). It embeds synchronously and tags `seedId` by embedding similarity against every seeded memory: threshold 0.78, or 0.5 for keyword fallback. Sent to browsers with `embedding: []`.

### Plans (`PlanBlock[]`, `shared/types.ts:24`)
`{ start: 'HH:MM', end: 'HH:MM', locationId, activity, priority? }`. One array per agent, overwritten by `makeDailyPlan` and `replan`. Each plan change also writes a `plan`-type memory.

### Conversations (`ConversationRecord`, `shared/types.ts:68`)
`{ id: 'c<n>', participants: [a, b] (always a pair), lines: {speakerId, text}[], ts, locationId }`. Each participant also gets a `conversation` memory (a summary). The record is emitted once via `conversation` and played back one line per tick on the client.

### Snapshots / replay
A snapshot is a **full `WorldState` JSON**, embeddings included (the Day 2 file is 172 KB), identified by file name. Loading one replaces `sim.world`, resets `busy`, and broadcasts a fresh `world:snapshot`. `00-fresh-start-day1-0700` is regenerated at boot.

### Event log (`LogEntry`, `shared/types.ts:57`)
`{ ts, text }`. There is no kind and no payload; entries are human-readable strings only (e.g. `"Meera told Rohan: …"`, `"⭐ Asha drops everything: …"`).

### Measured: current `world.json`
clock 4090 (Day 3 · 20:10), `seq` 115. 3 agents. **105 memories**: 56 observation, 24 plan, 20 conversation, 5 seeded. All 105 have 384-d embeddings, 4 are unscored (importance 0) and 13 carry `seedId`. 10 conversations, 63 log entries, 3 `lastTalk` pairs. Two agents were saved with `busy: true`; load has to reset that.

---

## 3. Embedding setup

- **Model:** `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` (transformers.js), `dtype: 'fp32'`, mean pooling, `normalize: true`.
- **Dimensions:** **384** (confirmed on all 105 stored memories). So `D = 384`.
- **Where it runs:** in-process on the Node server (CPU, ONNX). It's downloaded on first boot (~23 MB, cached by transformers.js), and loaded once in `initEmbeddings()` before the sim starts.
- **Calls:** one `embed()` per memory, plus one per `factHint`, plus one per retrieval query. There's no batching and no cache.
- **Failure mode:** if the model fails to load, `embed()` returns `[]`, and similarity falls back to keyword overlap **per pair**. With pgvector, a memory without an embedding can't take part in vector search. See risk R4.
- Vectors are rounded to 4 decimals before storage, which costs a little precision. I propose not rounding before writing to `vector(384)`.

---

## 4. Current retrieval and its weaknesses

`retrieve(world, agentId, query, k=8)` (`memory.ts:57`):
1. Candidates = **all** memories of the agent (linear filter over every memory in the world).
2. Embed the query.
3. Score each candidate: `recency = 0.995^hours(lastAccessed → now)`, `importance = (importance || 3)/10`, `relevance = similarity()`.
4. Min-max normalise each component across all candidates (all-equal → 1). `total` = unweighted sum.
5. Top k, then bump `lastAccessed = now` on those k (in place). Results are rounded to 3 decimals.
6. `recall()` (`cognition.ts:20`) broadcasts `memory:retrieved` to **all** clients.

Call sites: daily plan (k=8), replan (k=8), conversation (4 recalls at k=5 each, plus `shouldTalk`).

Weaknesses:
1. **O(N) full scan and an O(N) re-score per call.** That's fine at 105 memories but grows without bound. One conversation does 4 scans.
2. **Mixed relevance scales.** Cosine `(c+1)/2` sits in about [0.4, 1], while keyword Jaccard sits in [0, 1]. A partially embedded set mixes the two, and normalisation hides the problem without fixing it.
3. **`(cos+1)/2` compresses the range.** MiniLM cosines for unrelated text are rarely below 0, so the useful spread is narrow before normalisation.
4. **All-equal → 1** gives a constant +1 to everyone. It's harmless to ranking, but misleading in the inspector bars, where everything shows "full".
5. **Unscored = 3** means a freshly created memory gets a made-up importance until the batch call lands.
6. **No weights.** Weights are hard-coded to 1, and there's no config.
7. **No measurement.** There's no latency, candidate count or quality metric. Tokens only go to `console.log`.
8. **The query is embedded every call, uncached.** The same query string (e.g. `"Rohan"`) is re-embedded per conversation.
9. **The `lastAccessed` bump** applies to every k of every recall, including the speculative `shouldTalk` recall, which inflates recency for memories that weren't actually used.
10. **Normalisation is over the agent's entire memory set**, so one very old memory stretches the recency range for everyone. The brief's candidate-union design changes this to "normalise over candidates", which changes behaviour slightly. That's intended.
11. **Rumour helpers outside retrieval** (`knownRumours`, `matchSeed`) are also linear scans. `knownRumours` runs for every nearby pair **every tick** (`social.ts:27`) and does a nested `find`. It can't become a per-tick DB query, so see the cache decision (D5).

---

## 5. Watch-specific code to remove (Phase 1, pending your OK)

| Location | What |
|---|---|
| `shared/events.ts:1` | Comment "Share this file with the watch-backend teammate" |
| `shared/events.ts:6–18` | `WristOrient`, `WatchToServerEvents` |
| `shared/events.ts:70–71` | `'wrist:orient'` and `'watch:status'` in `ServerToClientEvents` (never emitted) |
| `client/src/bus.ts:6,15` | `InputSource` type (`'keyboard' \| 'mouse-mock' \| 'watch'`) and the `'input:source'` bus event (never emitted anywhere) |
| `client/src/hud/Hud.tsx:85–91` | Input-source chip in `TopRightHud` (always shows "Keyboard") |
| `client/src/game/CameraController.ts:1–3` | Comment mentioning wrist/mouse-mock input |
| `README.md` | "Wrist/watch controls … next phase" line, and the "Watch → server" paragraph and `wrist:orient`/`watch:status` in the socket contract |
| `CLAUDE.md` | No watch content today |

There's **no** `/watch` namespace, **no** fake-watch script and **no** server-side relay to delete (M2). `CameraController`'s normalised pan-velocity input is generic and stays.

---

## 6. Proposed mapping to the Phase 1 schema

### Decisions I need from you
- **D1 Agent ids.** Today ids are slugs (`'asha'`) that would collide across sims. **Recommendation:** `agents.id uuid` PK plus `agents.slug text`, `unique(sim_id, slug)`. Runtime `AgentState.id` becomes the uuid. Mock `CANNED` plans key by `slug`. Visitor-created agents get uuids naturally. (Alternative: composite PK `(sim_id, id text)`. That's less churn now, but every FK becomes two columns.)
- **D2 `seed_id`.** Add `memories.seed_id uuid null` FK→memories, indexed on `(sim_id, agent_id) where seed_id is not null`. It shouldn't live inside `source_ref`, because rumour logic queries it constantly.
- **D3 Importance.** `importance smallint null` with `check (importance between 1 and 10)`. `null` = unscored, replacing the 0 sentinel.
- **D4 Snapshot restore semantics.** With the DB as the source of truth, "load snapshot" either (a) **forks a new sim** from the checkpoint (`sims.parent_sim_id`, `sims.forked_from_snapshot_id`), or (b) restores in place by deleting rows after `at_game`. **Recommendation: (a).** History is never destroyed, which is what replay links and day recaps (future scope 3) need. The UI behaviour is unchanged: the current sim switches to the fork.
- **D5 Hot state vs DB reads.** The tick loop reads agent state and rumour facts synchronously every 50 ms / tick. **Recommendation:** the runtime keeps a working set in memory (agents + state, current plans, seeded memories and per-agent rumour knowledge, lastTalk), hydrated from the DB at boot and written back through the per-tick batch. **Retrieval candidates always come from the store** (pgvector in postgres mode). The DB is the durable source of truth; the working set is a cache of it, never a second store. The full memory list is *not* kept in memory in postgres mode.
- **D6 Normalisation all-equal → 0** (per brief), replacing the current 1. Confirm you're fine with the behaviour change.

### Table mapping
| Current | Table.column | Notes |
|---|---|---|
| `WorldState.clock` | `sims.game_minutes` | |
| `WorldState.paused` | `sims.status` (`running`/`paused`/`archived`) | |
| `WorldState.speed` | `sims.config.speed` | Not in the brief; it lives in `config`, not a column. *Doesn't fit cleanly.* |
| `TICK_MINUTES`, retrieval weights, `MODEL` | `sims.config` | `{ tickMinutes, tickRealMs, retrieval: {decay, wRecency, wImportance, wRelevance, kSim, kRecent, kImp, topN}, models: {llm, embedding} }`, validated with zod |
| `WorldState.seq` | — | Dropped; uuids replace `m<n>`/`c<n>` |
| `WorldState.lastTalk` | `sims.runtime jsonb` (new) **or** a `conversation_cooldowns` table | *Doesn't fit.* Recommendation: `sims.runtime jsonb` for small sim-wide runtime state (`lastTalk`), rewritten each tick batch. |
| — | `sims.seed` | No seeded RNG exists (`Math.random` in `chooseTile` and mock latency), so this is informational until one is added |
| `AgentSeed.name/age/occupation/bio` | `agents.*` | |
| `AgentSeed.id` | `agents.slug` | D1 |
| `relationships` | `agents.relationships text` | *Not in brief.* Used by every prompt. I'd add it as a column rather than bury it in `traits` |
| `homeId` | `agents.home_location_id` | |
| `appearance` | `agents.appearance jsonb` | Replaces `color` (M11) |
| — | `agents.traits jsonb` | New, empty for existing agents |
| — | `agents.created_by` | null for built-ins |
| `tileX, tileY, facing, path` | `agent_state.*` | |
| `action` | `agent_state.current_action` | |
| derived `statusIcon`, `locationId` | `agent_state.status_icon`, `location_id` | Stored for queries and recaps; still recomputed at runtime |
| `!asleep` | `agent_state.awake` | |
| `targetLocationId, planDay, talkingWith, talkUntil, lastPerceived, lastReplanAt` | `agent_state.runtime jsonb` (new) | *Don't fit the brief's columns.* They're needed for an exact mid-day resume. `talkingWith`/`talkUntil` could be real columns. Recommendation: one `runtime` jsonb, zod-validated |
| `stepMs`, `busy` | — | Not persisted; reset on load |
| — | `agent_state.updated_at_game` | |
| `Memory.*` | `memories.*` | `createdAt→created_at_game`, `lastAccessed→last_accessed_game`, `embedding→vector(384)`, `embedding_model='Xenova/all-MiniLM-L6-v2'`, `seedId→seed_id` (D2), `importance` nullable (D3) |
| conversation memory → its conversation | `memories.source_ref = {conversationId}` | New; today the link isn't stored |
| `agent.plan` + `planDay` | `plans` row (`day`, `blocks`), previous row gets `superseded_at_game` | History is new (M8). The current plan = the row with `superseded_at_game is null` |
| `ConversationRecord` | `conversations` + `conversation_lines` | `ts→started_at_game`, `participants text[]` (agent uuids; arrays allow future >2-party chats) |
| `LogEntry` | `events` | `ts→at_game`. `kind` is new. I propose tagging call sites (`sleep`, `plan`, `replan`, `priority`, `talk`, `told`, `seed`, `snapshot`, `system`) with structured `payload` (agent ids, conversation id, seed id), so day recaps don't have to parse prose |
| snapshot file | `snapshots` row | `state` = a checkpoint of agents, agent_state, current plans, runtime, clock. **Not** the full memory list with embeddings: memories are already in `memories` keyed by game time, so the checkpoint stores the `at_game` watermark and restore takes memories `<= at_game` (D4) |
| `[llm]` console token log | `llm_calls` | Recorded in `runPrompt`/`callOnce`, the single choke point. Mock calls are recorded as `model='mock'` with 0 tokens (proposal) |
| `memory:retrieved` | `retrieval_logs` (sampled) | |

### Import of `world.json` (Phase 1 `db:import-json`)
- One transaction. The id map `m<n>`/`c<n>`/`asha` → uuid is built in memory and used for `seed_id` and `participants`.
- Idempotency: store `sha256(file contents)` in `sims.config.importSourceHash` (or a dedicated `sims.import_hash unique` column; I prefer the column). A re-run with the same hash **refuses** with a clear message and the existing sim id.
- `importance 0 → null`. `lastReplanAt null → runtime -Infinity sentinel`. `busy` is dropped.
- Re-embed any memory whose `embedding.length !== 384` (none in the current file).
- Plans: the current `plan` becomes one `plans` row per agent for `planDay`. Earlier plans can't be recovered (only the `plan`-type memories hint at them).
- Expected counts for the current file: 3 agents, 3 agent_state, 105 memories, 3 plans, 10 conversations with their lines, 63 events.

---

## 7. Risks and unknowns

- **R1 pgvector version on Neon.** Iterative index scans (`hnsw.iterative_scan`) need pgvector ≥ 0.8.0. I'll check with `select extversion from pg_extension where extname='vector'` on your branch in Phase 3 rather than assume.
- **R2 HNSW is probably the wrong plan at this scale.** At ~35 memories per agent per game day, one agent reaches a few thousand memories only after ~100 game days. With a `(sim_id, agent_id)` filter, an exact scan over the btree-selected rows will likely be as fast or faster, and exact. I'll measure both in Phase 3 (`EXPLAIN ANALYZE`, p50/p95) and report numbers, not guesses. The HNSW index stays for when memory counts grow across many sims.
- **R3 Per-tick latency vs the 2.5 s tick.** A Neon round trip from a laptop is typically tens of ms, plus cold starts of seconds when the compute is suspended. The tick loop must never `await` the DB. The flush runs in the background, at most one in flight, and failed batches are retained and merged into the next (per brief). Retrieval *is* awaited, but only inside already-async LLM paths.
- **R4 Embedding fallback vs pgvector.** If the model fails to load, memories have no vector. Proposal: store `embedding null`, exclude them from the similarity query, and still return them via the recency and importance queries with relevance 0. Then `db:reembed` fills them later. Keyword fallback goes away in postgres mode, and the `memory` store keeps it. Please confirm.
- **R5 Async writes after a snapshot swap.** The `isCurrent(world)` pattern must extend to the write buffer. Writes are tagged with `sim_id` at enqueue time, so a late LLM result for a sim that was swapped out lands in the right sim, or is dropped (I'd drop it, matching today's behaviour).
- **R6 Memory id timing.** Today a memory's id exists synchronously. With buffered writes, ids are generated client-side (`crypto.randomUUID()`) at creation, so `memory:add`, `seed_id`, replan triggers and evidence links all keep working before the row is flushed. Retrieval from postgres can't see unflushed memories (up to one tick stale). Proposal: the retrieval fetcher unions the unflushed buffer for that agent.
- **R7 `lastAccessed` bump.** It's now a DB write per retrieval (`UPDATE … WHERE id = ANY($1)`), batched into the tick flush rather than issued immediately.
- **R8 Boot overwrites `00-fresh-start`.** That becomes "ensure a `fresh start` snapshot exists for the sim" rather than a re-write at every boot.
- **R9 `sims.seed` has no RNG to seed** (see the table). It's not a blocker.
- **R10 Two `world.json` files for import.** `server/data/snapshots/Day-2-08-20_142016.json` has the same shape and can be imported the same way, as its own sim.
- **Unsure:** whether you want `STORE=memory` to keep keyword-fallback retrieval (proposed: yes, as the no-DB/no-model path), and whether `llm_calls` should record mock calls (proposed: yes, with `model='mock'`, so integration tests can assert on counts).

### Things in the current design that would block future scope
| Future feature | Blocker today | Plan |
|---|---|---|
| 1. Visitor seed / interview | `event:seed` carries no actor identity, and `recall()` broadcasts `memory:retrieved` to every client via `io.emit`. A single global `Sim`, with no rooms per sim. | `seed()` becomes a server action `seed({simId, agentId, text, actor})`. The actor is recorded in `memories.source_ref` / `events.payload` (`actor: 'local'` for now). Emits go through a per-sim Socket.IO room. No rate limiting or interview UI is built. |
| 2. Visitor-created agents | Agents come from the constant `AGENT_SEEDS`. **Homes are hard-coded map zones (`asha_house` etc. in `shared/map.ts`)**, so a new agent has no home. Mock `CANNED` plans key by slug (there's already a fallback for unknown ids). The sim iterates `world.agents` per tick, so adding mid-run is fine once agents are rows. | Agents load from DB rows. Expose `Sim.addAgent(row)` internally only, with no UI, so a mid-run add is possible. **The homes problem is a map/design question for later**, e.g. a shared inn zone. It's flagged here, not built. |
| 3. Replay links and day recaps | The log is prose-only and capped at 200, conversations are capped at 50, and snapshots are files. | Unbounded `events` (with `kind` + `payload`), `conversations`, `plans` history and `snapshots` rows, all keyed by `sim_id` + game time. Fork-on-restore (D4) keeps history intact. |

---

## 8. Phase-by-phase notes

- **Phase 1** adds `db/`, `store/` (interfaces + `memory/` + `postgres/`), env validation and scripts. The sim still runs on the old path until Phase 2; Phase 1 only proves the schema, seed and import. Watch removal (§5) goes in Phase 1 if you approve it.
- **Phase 2** moves the sim onto the store interfaces, the write buffer and resume, and deletes `saveRolling`, the snapshot file I/O and `server/data/world.json` writes. The JSON snapshot export/import stays as a script.
- **Phase 3** is `server/src/retrieval/` (pure `score.ts` + `candidates.ts`) and replaces `memory.ts:retrieve`.
- **Tests:** none exist today. vitest arrives in Phase 1 (contract tests for the stores), and the full suite comes in Phase 5.
