import type {
  GameRecord,
  GameSession,
  InProgressSave,
  ScoreResult,
  ResourceAssignment,
  ImportLogEntry,
} from '../types';
import { STORAGE_KEYS, MAX_HISTORY, MAX_IMPORT_LOG } from '../types';
import { generateUUID } from './uuid';

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

export function normalizeSession(s: GameSession): GameSession {
  const legacy = !Array.isArray(s.resourceAssignments);
  return {
    ...s,
    resourceAssignments: (s.resourceAssignments as ResourceAssignment[] | undefined) ?? [],
    resourceUsage: s.resourceUsage ?? {},
    legacySave: legacy,
  };
}

export function saveInProgress(levelId: string, session: GameSession) {
  const payload: InProgressSave = {
    version: STORAGE_KEYS.STORAGE_VERSION,
    savedAt: Date.now(),
    levelId,
    session: { ...normalizeSession(session), savedAt: Date.now() },
  };
  write(STORAGE_KEYS.IN_PROGRESS, payload);
}

export function loadInProgress(): InProgressSave | null {
  const raw = read<InProgressSave | null>(STORAGE_KEYS.IN_PROGRESS, null);
  if (!raw) return null;
  if (raw.version !== STORAGE_KEYS.STORAGE_VERSION) return null;
  if (!raw.session || !raw.levelId) return null;
  raw.session = normalizeSession(raw.session);
  return raw;
}

export function clearInProgress() {
  localStorage.removeItem(STORAGE_KEYS.IN_PROGRESS);
}

export function loadHistory(): GameRecord[] {
  const arr = read<GameRecord[]>(STORAGE_KEYS.HISTORY, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => (r.sessionSnapshot ? { ...r, sessionSnapshot: normalizeSession(r.sessionSnapshot) } : r))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function appendHistory(record: GameRecord): GameRecord[] {
  const list = loadHistory();
  list.unshift(record);
  const trimmed = list.slice(0, MAX_HISTORY);
  write(STORAGE_KEYS.HISTORY, trimmed);
  return trimmed;
}

export function upsertHistory(record: GameRecord, mode: 'insert' | 'overwrite' = 'insert'): GameRecord[] {
  const list = loadHistory();
  const idx = list.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    if (mode === 'overwrite') {
      list[idx] = record;
    } else {
      list.unshift(record);
    }
  } else {
    list.unshift(record);
  }
  const trimmed = list.slice(0, MAX_HISTORY);
  write(STORAGE_KEYS.HISTORY, trimmed);
  return trimmed;
}

export function deleteHistoryRecord(id: string): GameRecord[] {
  const list = loadHistory().filter((r) => r.id !== id);
  write(STORAGE_KEYS.HISTORY, list);
  const readonly = loadReadonlyRecords();
  const newReadonly = readonly.filter((x) => x !== id);
  if (newReadonly.length !== readonly.length) {
    write(STORAGE_KEYS.READONLY_RECORDS, newReadonly);
  }
  return list;
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEYS.HISTORY);
  localStorage.removeItem(STORAGE_KEYS.READONLY_RECORDS);
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

export function loadImportLog(): ImportLogEntry[] {
  const arr = read<ImportLogEntry[]>(STORAGE_KEYS.IMPORT_LOG, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.timestamp - a.timestamp);
}

export function appendImportLog(entry: Omit<ImportLogEntry, 'id' | 'timestamp'>): ImportLogEntry {
  const full: ImportLogEntry = {
    id: generateUUID(),
    timestamp: Date.now(),
    ...entry,
  };
  const list = loadImportLog();
  list.unshift(full);
  const trimmed = list.slice(0, MAX_IMPORT_LOG);
  write(STORAGE_KEYS.IMPORT_LOG, trimmed);
  return full;
}

export function clearImportLog() {
  localStorage.removeItem(STORAGE_KEYS.IMPORT_LOG);
}

export function loadReadonlyRecords(): string[] {
  const arr = read<string[]>(STORAGE_KEYS.READONLY_RECORDS, []);
  return Array.isArray(arr) ? arr : [];
}

export function markRecordReadonly(recordId: string): void {
  const list = loadReadonlyRecords();
  if (!list.includes(recordId)) {
    list.push(recordId);
    write(STORAGE_KEYS.READONLY_RECORDS, list);
  }
}

export function isRecordReadonly(recordId: string): boolean {
  return loadReadonlyRecords().includes(recordId);
}

export function syncReadonlyFromHistory(): void {
  const importedIds = loadHistory()
    .filter((r) => r.imported || r.sessionSnapshot?.status === 'ENDED' || r.sessionSnapshot?.status === 'ABANDONED')
    .map((r) => r.id);
  const existing = new Set(loadReadonlyRecords());
  for (const id of importedIds) existing.add(id);
  write(STORAGE_KEYS.READONLY_RECORDS, [...existing]);
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
