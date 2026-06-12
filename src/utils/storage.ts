import type {
  GameRecord,
  GameSession,
  InProgressSave,
  ScoreResult,
} from '../types';
import { STORAGE_KEYS, MAX_HISTORY } from '../types';

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const write = <T>(key: string, value: T) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export function saveInProgress(levelId: string, session: GameSession) {
  const payload: InProgressSave = {
    version: STORAGE_KEYS.STORAGE_VERSION,
    savedAt: Date.now(),
    levelId,
    session: { ...session, savedAt: Date.now() },
  };
  write(STORAGE_KEYS.IN_PROGRESS, payload);
}

export function loadInProgress(): InProgressSave | null {
  const raw = read<InProgressSave | null>(STORAGE_KEYS.IN_PROGRESS, null);
  if (!raw) return null;
  if (raw.version !== STORAGE_KEYS.STORAGE_VERSION) return null;
  if (!raw.session || !raw.levelId) return null;
  return raw;
}

export function clearInProgress() {
  localStorage.removeItem(STORAGE_KEYS.IN_PROGRESS);
}

export function loadHistory(): GameRecord[] {
  const arr = read<GameRecord[]>(STORAGE_KEYS.HISTORY, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.createdAt - a.createdAt);
}

export function appendHistory(record: GameRecord): GameRecord[] {
  const list = loadHistory();
  list.unshift(record);
  const trimmed = list.slice(0, MAX_HISTORY);
  write(STORAGE_KEYS.HISTORY, trimmed);
  return trimmed;
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEYS.HISTORY);
}

export function getBestScore(levelId: string): { score: number; accuracy: number } | null {
  const records = loadHistory().filter((r) => r.levelId === levelId && r.completed);
  if (records.length === 0) return null;
  const best = records.reduce((a, b) => (a.totalScore >= b.totalScore ? a : b));
  return { score: best.totalScore, accuracy: best.accuracy };
}

export function getHistoryById(id: string): GameRecord | null {
  return loadHistory().find((r) => r.id === id) ?? null;
}

export interface ResumeAdjustment {
  wasPaused: boolean;
  elapsedAwayMs: number;
  levelVersionMatch: boolean;
  warning?: string;
}

export function adjustSessionForResume(
  saved: InProgressSave,
  levelVersionCurrent: string
): { session: GameSession; adjustment: ResumeAdjustment } {
  const session = { ...saved.session };
  const now = Date.now();
  const awayMs = Math.max(0, now - (saved.savedAt ?? now));
  const wasPaused = session.status === 'PAUSED';
  const versionMatch = session.levelVersion === levelVersionCurrent;
  let warning: string | undefined;

  if (!versionMatch) {
    warning = `关卡已更新（当前 v${levelVersionCurrent} / 存档 v${session.levelVersion}），恢复结果可能不完全一致`;
  }

  if (!wasPaused && session.status === 'RUNNING') {
    const awaySeconds = Math.floor(awayMs / 1000);
    session.elapsedSeconds = session.elapsedSeconds + awaySeconds;
    session.remainingSeconds = Math.max(0, session.remainingSeconds - awaySeconds);
    session.totalPausedMs = session.totalPausedMs ?? 0;
    session.status = 'RUNNING';
  }

  return {
    session,
    adjustment: {
      wasPaused,
      elapsedAwayMs: awayMs,
      levelVersionMatch: versionMatch,
      warning,
    },
  };
}

export function computeReplayHash(result: ScoreResult): string {
  const s = JSON.stringify({
    total: result.total,
    accuracy: result.accuracy,
    proofLen: result.recalcProof.length,
  });
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
