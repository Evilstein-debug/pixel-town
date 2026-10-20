// Socket.IO contract between the sim server and browsers.
import type {
  AgentPublic, ConversationRecord, Facing, GameClock, LogEntry, Memory, PlanBlock, StatusIcon,
} from './types';

// ---------- Server → browser (default namespace "/") ----------

/** A saved checkpoint the browser can restore. */
export interface SnapshotInfo {
  id: string;
  name: string;
  /** Game minutes when it was taken. */
  atGame: GameClock;
}

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
  /** This sim's snapshots and its ancestors', newest first. */
  snapshots: SnapshotInfo[];
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
  'snapshots:list': (snapshots: SnapshotInfo[]) => void;
}

// ---------- Browser → server ----------

export interface SimControl {
  cmd: 'pause' | 'play' | 'speed';
  value?: number;
}

export interface ClientToServerEvents {
  'sim:control': (p: SimControl) => void;
  'event:seed': (p: { agentId: string; text: string }) => void;
  /** Restores a snapshot by forking a new sim from it; the current sim is archived. */
  'replay:load': (p: { snapshotId: string }) => void;
  'snapshot:save': () => void;
}
