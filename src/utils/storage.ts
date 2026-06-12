import type {
  GameRecord,
  GameSession,
  InProgressSave,
  ScoreResult,
  ResourceAssignment,
  ImportLogEntry,
  CoachAnnotation,
  AnnotationStore,
  AnnotationImportLogEntry,
  CaseInfo,
  CaseStore,
  CaseImportLogEntry,
  Difficulty,
} from '../types';
import { STORAGE_KEYS, MAX_HISTORY, MAX_IMPORT_LOG, MAX_ANNOTATION_IMPORT_LOG, ANNOTATION_VERSION_CURRENT, CASE_VERSION_CURRENT, MAX_CASE_IMPORT_LOG } from '../types';
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

function loadAnnotationStore(): AnnotationStore {
  const raw = read<AnnotationStore | null>(STORAGE_KEYS.ANNOTATIONS, null);
  if (!raw || !raw.annotations) {
    return { version: ANNOTATION_VERSION_CURRENT, annotations: {} };
  }
  return raw;
}

function writeAnnotationStore(store: AnnotationStore): void {
  write(STORAGE_KEYS.ANNOTATIONS, store);
}

export function loadAnnotations(recordId: string): CoachAnnotation[] {
  const store = loadAnnotationStore();
  return store.annotations[recordId] ?? [];
}

export function saveAnnotations(recordId: string, annotations: CoachAnnotation[]): void {
  const store = loadAnnotationStore();
  store.annotations[recordId] = annotations;
  writeAnnotationStore(store);
}

export function addAnnotation(recordId: string, annotation: Omit<CoachAnnotation, 'id' | 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>): CoachAnnotation {
  const now = Date.now();
  const full: CoachAnnotation = {
    ...annotation,
    id: generateUUID(),
    recordId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    source: 'LOCAL',
  };
  const list = loadAnnotations(recordId);
  list.push(full);
  saveAnnotations(recordId, list);
  return full;
}

export function updateAnnotation(recordId: string, annotationId: string, updates: Partial<Pick<CoachAnnotation, 'severity' | 'content' | 'suggestion'>>): CoachAnnotation | null {
  const list = loadAnnotations(recordId);
  const idx = list.findIndex((a) => a.id === annotationId);
  if (idx < 0) return null;
  list[idx] = {
    ...list[idx],
    ...updates,
    updatedAt: Date.now(),
    version: list[idx].version + 1,
  };
  saveAnnotations(recordId, list);
  return list[idx];
}

export function deleteAnnotation(recordId: string, annotationId: string): boolean {
  const list = loadAnnotations(recordId);
  const idx = list.findIndex((a) => a.id === annotationId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  saveAnnotations(recordId, list);
  return true;
}

export function getAnnotationCount(recordId: string): number {
  return loadAnnotations(recordId).length;
}

export function hasAnnotations(recordId: string): boolean {
  return getAnnotationCount(recordId) > 0;
}

export function replaceAnnotations(recordId: string, annotations: CoachAnnotation[]): void {
  saveAnnotations(recordId, annotations);
}

export function mergeAnnotations(recordId: string, incoming: CoachAnnotation[]): CoachAnnotation[] {
  const local = loadAnnotations(recordId);
  const localKeys = new Set(local.map((a) => a.id));
  const localSigKeys = new Set(
    local.map((a) => `${a.targetType}:${a.timestampMs ?? ''}:${a.patientId ?? ''}`)
  );
  const merged = [...local];
  for (const ann of incoming) {
    if (localKeys.has(ann.id)) continue;
    const sig = `${ann.targetType}:${ann.timestampMs ?? ''}:${ann.patientId ?? ''}`;
    if (localSigKeys.has(sig)) continue;
    merged.push({ ...ann, source: 'IMPORTED' as const });
  }
  saveAnnotations(recordId, merged);
  return merged;
}

export function clearAnnotationsForRecord(recordId: string): void {
  const store = loadAnnotationStore();
  delete store.annotations[recordId];
  writeAnnotationStore(store);
}

export function clearAllAnnotations(): void {
  localStorage.removeItem(STORAGE_KEYS.ANNOTATIONS);
}

export function getAnnotationStoreVersion(): number {
  const store = loadAnnotationStore();
  return store.version;
}

export function loadAnnotationImportLog(): AnnotationImportLogEntry[] {
  const arr = read<AnnotationImportLogEntry[]>(STORAGE_KEYS.ANNOTATION_IMPORT_LOG, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.timestamp - a.timestamp);
}

export function appendAnnotationImportLog(entry: Omit<AnnotationImportLogEntry, 'id' | 'timestamp'>): AnnotationImportLogEntry {
  const full: AnnotationImportLogEntry = {
    id: generateUUID(),
    timestamp: Date.now(),
    ...entry,
  };
  const list = loadAnnotationImportLog();
  list.unshift(full);
  const trimmed = list.slice(0, MAX_ANNOTATION_IMPORT_LOG);
  write(STORAGE_KEYS.ANNOTATION_IMPORT_LOG, trimmed);
  return full;
}

export function clearAnnotationImportLog(): void {
  localStorage.removeItem(STORAGE_KEYS.ANNOTATION_IMPORT_LOG);
}

function loadCaseStore(): CaseStore {
  const raw = read<CaseStore | null>(STORAGE_KEYS.CASES, null);
  if (!raw || !raw.cases) {
    return { version: CASE_VERSION_CURRENT, cases: {} };
  }
  return raw;
}

function writeCaseStore(store: CaseStore): void {
  write(STORAGE_KEYS.CASES, store);
}

export function loadCase(recordId: string): CaseInfo | null {
  const store = loadCaseStore();
  return store.cases[recordId] ?? null;
}

export function saveCase(recordId: string, caseInfo: CaseInfo): void {
  const store = loadCaseStore();
  store.cases[recordId] = caseInfo;
  writeCaseStore(store);
}

export function createCase(
  recordId: string,
  data: Omit<CaseInfo, 'id' | 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>
): CaseInfo {
  const now = Date.now();
  const full: CaseInfo = {
    ...data,
    id: generateUUID(),
    recordId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    source: 'LOCAL',
  };
  saveCase(recordId, full);
  return full;
}

export function updateCase(
  recordId: string,
  updates: Partial<Pick<CaseInfo, 'title' | 'description' | 'tags' | 'recommended' | 'archived'>>
): CaseInfo | null {
  const existing = loadCase(recordId);
  if (!existing) return null;
  const updated: CaseInfo = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
    version: existing.version + 1,
  };
  saveCase(recordId, updated);
  return updated;
}

export function deleteCase(recordId: string): boolean {
  const store = loadCaseStore();
  if (!store.cases[recordId]) return false;
  delete store.cases[recordId];
  writeCaseStore(store);
  return true;
}

export function hasCase(recordId: string): boolean {
  return loadCase(recordId) !== null;
}

export function getAllCases(): CaseInfo[] {
  const store = loadCaseStore();
  return Object.values(store.cases);
}

export function getCaseCount(): number {
  return getAllCases().length;
}

export function getCaseTags(): string[] {
  const cases = getAllCases();
  const tagSet = new Set<string>();
  for (const c of cases) {
    for (const tag of c.tags) tagSet.add(tag);
  }
  return [...tagSet].sort();
}

export function replaceCase(recordId: string, caseInfo: CaseInfo): void {
  saveCase(recordId, { ...caseInfo, source: 'IMPORTED' });
}

export function mergeCase(recordId: string, incoming: CaseInfo): CaseInfo {
  const local = loadCase(recordId);
  if (!local) {
    const created: CaseInfo = { ...incoming, source: 'IMPORTED' };
    saveCase(recordId, created);
    return created;
  }
  const mergedTags = Array.from(new Set([...local.tags, ...incoming.tags])).sort();
  const merged: CaseInfo = {
    ...local,
    title: incoming.title || local.title,
    description: incoming.description || local.description,
    tags: mergedTags,
    recommended: local.recommended || incoming.recommended,
    archived: local.archived && incoming.archived,
    updatedAt: Date.now(),
    version: local.version + 1,
  };
  saveCase(recordId, merged);
  return merged;
}

export function clearCasesForRecord(recordId: string): void {
  deleteCase(recordId);
}

export function clearAllCases(): void {
  localStorage.removeItem(STORAGE_KEYS.CASES);
}

export function getCaseStoreVersion(): number {
  const store = loadCaseStore();
  return store.version;
}

export function loadCaseImportLog(): CaseImportLogEntry[] {
  const arr = read<CaseImportLogEntry[]>(STORAGE_KEYS.CASE_IMPORT_LOG, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.timestamp - a.timestamp);
}

export function appendCaseImportLog(entry: Omit<CaseImportLogEntry, 'id' | 'timestamp'>): CaseImportLogEntry {
  const full: CaseImportLogEntry = {
    id: generateUUID(),
    timestamp: Date.now(),
    ...entry,
  };
  const list = loadCaseImportLog();
  list.unshift(full);
  const trimmed = list.slice(0, MAX_CASE_IMPORT_LOG);
  write(STORAGE_KEYS.CASE_IMPORT_LOG, trimmed);
  return full;
}

export function clearCaseImportLog(): void {
  localStorage.removeItem(STORAGE_KEYS.CASE_IMPORT_LOG);
}

export interface HistoryFilters {
  filterLevelId: string | null;
  filterDifficulty: Difficulty | null;
  searchKeyword: string;
  filterTags: string[];
  filterHasAnnotations: boolean | null;
  filterImported: boolean | null;
  filterRecommended: boolean | null;
  filterArchived: boolean | null;
}

export function loadHistoryFilters(): HistoryFilters {
  const raw = read<HistoryFilters | null>(STORAGE_KEYS.HISTORY_FILTERS, null);
  if (!raw) {
    return {
      filterLevelId: null,
      filterDifficulty: null,
      searchKeyword: '',
      filterTags: [],
      filterHasAnnotations: null,
      filterImported: null,
      filterRecommended: null,
      filterArchived: null,
    };
  }
  return raw;
}

export function saveHistoryFilters(filters: HistoryFilters): void {
  write(STORAGE_KEYS.HISTORY_FILTERS, filters);
}

export function clearHistoryFilters(): void {
  localStorage.removeItem(STORAGE_KEYS.HISTORY_FILTERS);
}
