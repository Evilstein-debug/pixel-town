// Socket.IO contract. Share this file with the watch-backend teammate.
import type {
  AgentPublic, ConversationRecord, Facing, GameClock, LogEntry, Memory, PlanBlock, StatusIcon,
} from './types';

// ---------- Watch → server (namespace "/watch") ----------

/** Degrees, epoch ms. Target 30–60 Hz. */
export interface WristOrient {
  pitch: number;
  roll: number;
  yaw: number;
  ts: number;
}

export interface WatchToServerEvents {
  'wrist:orient': (p: WristOrient) => void;
}

// ---------- Server → browser (default namespace "/") ----------

export interface WorldSnapshot {
  mapId: string;
  clock: GameClock;
  paused: boolean;
  speed: number;
  agents: AgentPublic[];
  log: LogEntry[];
  // Additions beyond the original contract, used by the inspector/HUD:
  memories: Memory[];
  plans: Record<string, PlanBlock[]>;
  conversations: ConversationRecord[];
  snapshots: string[];
}

export interface TickAgent {
  id: string;
  tileX: number;
  tileY: number;
  facing: Facing;
  action: string;
  statusIcon: StatusIcon;
  locationId: string | null;
}

export interface WorldTick {
  clock: GameClock;
  agents: TickAgent[];
  paused: boolean;
  speed: number;
}

export interface RetrievalResult {
  memoryId: string;
  recency: number;
  importance: number;
  relevance: number;
  total: number;
}

export interface ServerToClientEvents {
  'world:snapshot': (p: WorldSnapshot) => void;
  'world:tick': (p: WorldTick) => void;
  'agent:path': (p: { agentId: string; path: { x: number; y: number }[] }) => void;
  'memory:add': (p: { agentId: string; memory: Memory }) => void;
  'memory:retrieved': (p: { agentId: string; query: string; results: RetrievalResult[] }) => void;
  conversation: (p: ConversationRecord) => void;
  'plan:update': (p: { agentId: string; plan: PlanBlock[] }) => void;
  log: (p: LogEntry) => void;
  'wrist:orient': (p: WristOrient) => void;
  'watch:status': (p: { connected: boolean }) => void;
  /** Saved snapshot file names, newest first. */
  'snapshots:list': (files: string[]) => void;
}

// ---------- Browser → server ----------

export interface SimControl {
  cmd: 'pause' | 'play' | 'speed';
  value?: number;
}

export interface ClientToServerEvents {
  'sim:control': (p: SimControl) => void;
  'event:seed': (p: { agentId: string; text: string }) => void;
  'replay:load': (p: { file: string }) => void;
  'snapshot:save': () => void;
}
