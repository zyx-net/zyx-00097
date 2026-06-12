import { writeFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

type Channel = 'RED' | 'YELLOW' | 'GREEN' | 'BLACK';
type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

interface CaseInfo {
  id: string;
  recordId: string;
  title: string;
  description: string;
  tags: string[];
  recommended: boolean;
  archived: boolean;
  source: 'LOCAL' | 'IMPORTED';
  createdAt: number;
  updatedAt: number;
  version: number;
}

interface CaseStore {
  version: number;
  cases: Record<string, CaseInfo>;
}

interface CaseImportLogEntry {
  id: string;
  timestamp: number;
  fileName: string;
  recordId: string;
  success: boolean;
  hasLocalCase: boolean;
  importedHasCase: boolean;
  finalHasCase: boolean;
  resolution?: 'KEEP_LOCAL' | 'MERGE' | 'OVERWRITE_LOCAL' | 'SKIP';
  conflicts?: string[];
  errors?: string[];
  tagsAdded?: string[];
  tagsRemoved?: string[];
}

interface CaseConflict {
  type: 'HAS_LOCAL_CASE' | 'TAG_CONFLICT' | 'ARCHIVED_STATUS_CONFLICT' | 'CASE_VERSION_DIFF';
  title: string;
  description: string;
  localCase?: CaseInfo;
  importedCase?: CaseInfo;
  localTags?: string[];
  importedTags?: string[];
  localArchived?: boolean;
  importedArchived?: boolean;
  caseVersionLocal?: number;
  caseVersionImported?: number;
}

interface Patient {
  id: string; sequenceNo: number; name: string; correctChannel: Channel;
  requiredResources: { resourceId: string; count: number; reason?: string }[];
}
interface ResourceSlot { id: string; name: string; initialCount: number; consumable: boolean; }
interface Level {
  id: string; name: string; version: string; difficulty: Difficulty;
  timeLimitSeconds: number; patients: Patient[]; resourceSlots: ResourceSlot[];
}
interface ResourceAssignment { id: string; patientId: string; resourceId: string; assignedAt: number; }
interface ActionLog { timestamp: number; type: string; patientId?: string; }
interface GameSession {
  id: string; levelId: string; levelVersion: string; status: string;
  startTime: number; pausedAt: number | null; totalPausedMs: number;
  elapsedSeconds: number; remainingSeconds: number;
  selectedPatientId: string | null; assignments: Record<string, Channel | null>;
  resourceUsage: Record<string, number>; resourceAssignments: ResourceAssignment[];
  operationLog: ActionLog[];
  errors: { code: string; message: string; suggestion: string; timestamp: number }[];
}
interface ScoreResult {
  total: number; maxScore: number; accuracy: number; details: { patientId: string; score: number; }[];
  resourceScore: number; timeScore: number; finalPenalty: number; finalBonus: number;
  recalcProof: { ruleKey: string; input: unknown; output: number }[];
}
interface ReplayPackage {
  exportVersion: number; exportedAt: string | number; replayHash?: string;
  level: { id: string; name: string; version: string; difficulty: Difficulty; };
  record: { id: string; createdAt: string | number; totalScore: number; maxScore: number; accuracy: number; usedSeconds: number; completed: boolean };
  session: GameSession; scoreResult: ScoreResult;
  caseInfo?: CaseInfo;
  caseVersion?: number;
}

interface HistoryFilters {
  filterLevelId: string | null;
  filterDifficulty: Difficulty | null;
  searchKeyword: string;
  filterTags: string[];
  filterHasAnnotations: boolean | null;
  filterImported: boolean | null;
  filterRecommended: boolean | null;
  filterArchived: boolean | null;
}

const STORAGE_KEYS = {
  CASES: 'triage:cases',
  CASE_IMPORT_LOG: 'triage:case-import-log',
  CASE_VERSION: 1,
  HISTORY_FILTERS: 'triage:history-filters',
  IMPORT_LOG: 'triage:import-log',
  ANNOTATION_IMPORT_LOG: 'triage:annotation-import-log',
} as const;

interface ImportLogEntry {
  id: string; timestamp: number; fileName: string; success: boolean;
  recordId?: string; levelId?: string;
  errors?: Array<{ code: string; message: string }>;
  warnings?: Array<{ code: string; message: string }>;
  conflictsResolved?: Array<{ type: string; resolution: string }>;
}

interface AnnotationImportLogEntry {
  id: string; timestamp: number; fileName: string; recordId: string; success: boolean;
  localCountBefore: number; importedCount: number; finalCount: number;
  resolution?: 'KEEP_LOCAL' | 'MERGE' | 'OVERWRITE_LOCAL' | 'SKIP';
  conflicts?: string[]; errors?: string[];
}

function loadLevel(id: string): Level {
  const raw = readFileSync(join(projectRoot, `src/config/levels/${id}.json`), 'utf-8');
  return JSON.parse(raw) as Level;
}

function genUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

class MockStorage {
  store: Record<string, string> = {};
  constructor() {}
  write(key: string, value: unknown): void { this.store[key] = JSON.stringify(value); }
  read<T>(key: string, fallback: T): T {
    const raw = this.store[key];
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  remove(key: string): void { delete this.store[key]; }
  serialize(): string { return JSON.stringify(this.store); }
  deserialize(json: string): void { this.store = JSON.parse(json); }
  snapshot(): Record<string, string> { return { ...this.store }; }
}

// === Case CRUD functions (mirroring src/utils/storage.ts) ===

function loadCaseStore(storage: MockStorage): CaseStore {
  const raw = storage.read<CaseStore | null>(STORAGE_KEYS.CASES, null);
  if (!raw || !raw.cases) return { version: STORAGE_KEYS.CASE_VERSION, cases: {} };
  return raw;
}

function writeCaseStore(storage: MockStorage, store: CaseStore): void {
  storage.write(STORAGE_KEYS.CASES, store);
}

function loadCase(storage: MockStorage, recordId: string): CaseInfo | null {
  return loadCaseStore(storage).cases[recordId] ?? null;
}

function saveCase(storage: MockStorage, recordId: string, caseInfo: CaseInfo): void {
  const store = loadCaseStore(storage);
  store.cases[recordId] = caseInfo;
  writeCaseStore(storage, store);
}

function createCase(
  storage: MockStorage,
  recordId: string,
  data: Omit<CaseInfo, 'id' | 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>
): CaseInfo {
  const now = Date.now();
  const full: CaseInfo = {
    ...data,
    id: genUUID(),
    recordId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    source: 'LOCAL',
  };
  saveCase(storage, recordId, full);
  return full;
}

function updateCase(
  storage: MockStorage,
  recordId: string,
  updates: Partial<Pick<CaseInfo, 'title' | 'description' | 'tags' | 'recommended' | 'archived'>>
): CaseInfo | null {
  const existing = loadCase(storage, recordId);
  if (!existing) return null;
  const updated: CaseInfo = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
    version: existing.version + 1,
  };
  saveCase(storage, recordId, updated);
  return updated;
}

function deleteCase(storage: MockStorage, recordId: string): boolean {
  const store = loadCaseStore(storage);
  if (!store.cases[recordId]) return false;
  delete store.cases[recordId];
  writeCaseStore(storage, store);
  return true;
}

function hasCase(storage: MockStorage, recordId: string): boolean {
  return loadCase(storage, recordId) !== null;
}

function getAllCases(storage: MockStorage): CaseInfo[] {
  return Object.values(loadCaseStore(storage).cases);
}

function getCaseTags(storage: MockStorage): string[] {
  const tagSet = new Set<string>();
  for (const c of getAllCases(storage)) {
    for (const tag of c.tags) tagSet.add(tag);
  }
  return [...tagSet].sort();
}

function replaceCase(storage: MockStorage, recordId: string, caseInfo: CaseInfo): void {
  saveCase(storage, recordId, { ...caseInfo, source: 'IMPORTED' });
}

function mergeCase(storage: MockStorage, recordId: string, incoming: CaseInfo): CaseInfo {
  const local = loadCase(storage, recordId);
  if (!local) {
    const created: CaseInfo = { ...incoming, source: 'IMPORTED' };
    saveCase(storage, recordId, created);
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
  saveCase(storage, recordId, merged);
  return merged;
}

function clearCasesForRecord(storage: MockStorage, recordId: string): void {
  deleteCase(storage, recordId);
}

function clearAllCases(storage: MockStorage): void {
  storage.remove(STORAGE_KEYS.CASES);
}

function getCaseStoreVersion(storage: MockStorage): number {
  return loadCaseStore(storage).version;
}

function loadCaseImportLog(storage: MockStorage): CaseImportLogEntry[] {
  const arr = storage.read<CaseImportLogEntry[]>(STORAGE_KEYS.CASE_IMPORT_LOG, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.timestamp - a.timestamp);
}

function appendCaseImportLog(storage: MockStorage, entry: Omit<CaseImportLogEntry, 'id' | 'timestamp'>): CaseImportLogEntry {
  const full: CaseImportLogEntry = { id: genUUID(), timestamp: Date.now(), ...entry };
  const list = loadCaseImportLog(storage);
  list.unshift(full);
  storage.write(STORAGE_KEYS.CASE_IMPORT_LOG, list.slice(0, 100));
  return full;
}

function loadImportLog(storage: MockStorage): ImportLogEntry[] {
  const arr = storage.read<ImportLogEntry[]>(STORAGE_KEYS.IMPORT_LOG, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.timestamp - a.timestamp);
}

function appendImportLog(storage: MockStorage, entry: Omit<ImportLogEntry, 'id' | 'timestamp'>): ImportLogEntry {
  const full: ImportLogEntry = { id: genUUID(), timestamp: Date.now(), ...entry };
  const list = loadImportLog(storage);
  list.unshift(full);
  storage.write(STORAGE_KEYS.IMPORT_LOG, list.slice(0, 100));
  return full;
}

function loadAnnotationImportLog(storage: MockStorage): AnnotationImportLogEntry[] {
  const arr = storage.read<AnnotationImportLogEntry[]>(STORAGE_KEYS.ANNOTATION_IMPORT_LOG, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.timestamp - a.timestamp);
}

function appendAnnotationImportLog(storage: MockStorage, entry: Omit<AnnotationImportLogEntry, 'id' | 'timestamp'>): AnnotationImportLogEntry {
  const full: AnnotationImportLogEntry = { id: genUUID(), timestamp: Date.now(), ...entry };
  const list = loadAnnotationImportLog(storage);
  list.unshift(full);
  storage.write(STORAGE_KEYS.ANNOTATION_IMPORT_LOG, list.slice(0, 100));
  return full;
}

function loadUnifiedImportLog(storage: MockStorage): Array<{
  kind: 'RECORD' | 'ANNOTATION' | 'CASE';
  entry: ImportLogEntry | AnnotationImportLogEntry | CaseImportLogEntry;
}> {
  const recordLogs = loadImportLog(storage).map((e) => ({ kind: 'RECORD' as const, entry: e }));
  const annotationLogs = loadAnnotationImportLog(storage).map((e) => ({ kind: 'ANNOTATION' as const, entry: e }));
  const caseLogs = loadCaseImportLog(storage).map((e) => ({ kind: 'CASE' as const, entry: e }));
  return [...recordLogs, ...annotationLogs, ...caseLogs].sort(
    (a, b) => b.entry.timestamp - a.entry.timestamp
  );
}

function detectCaseConflicts(
  storage: MockStorage,
  recordId: string,
  importedCase: CaseInfo | undefined,
  importedCaseVersion: number | undefined
): CaseConflict[] {
  const conflicts: CaseConflict[] = [];
  if (!importedCase) return conflicts;

  const localCase = loadCase(storage, recordId);

  if (localCase) {
    conflicts.push({
      type: 'HAS_LOCAL_CASE',
      title: '本地已有案例',
      description: '该回放记录本地已有案例，导入包也携带案例数据',
      localCase,
      importedCase,
    });

    const localTagSet = new Set(localCase.tags);
    const importedTagSet = new Set(importedCase.tags);
    const hasTagDiff = localCase.tags.length !== importedCase.tags.length ||
      !localCase.tags.every((t) => importedTagSet.has(t)) ||
      !importedCase.tags.every((t) => localTagSet.has(t));
    if (hasTagDiff) {
      conflicts.push({
        type: 'TAG_CONFLICT',
        title: '案例标签不一致',
        description: `本地有 ${localCase.tags.length} 个标签，导入包有 ${importedCase.tags.length} 个标签`,
        localTags: localCase.tags,
        importedTags: importedCase.tags,
      });
    }

    if (localCase.archived !== importedCase.archived) {
      conflicts.push({
        type: 'ARCHIVED_STATUS_CONFLICT',
        title: '归档状态不一致',
        description: `本地${localCase.archived ? '已归档' : '未归档'}，导入包${importedCase.archived ? '已归档' : '未归档'}`,
        localArchived: localCase.archived,
        importedArchived: importedCase.archived,
      });
    }
  }

  const localVersion = getCaseStoreVersion(storage);
  if (importedCaseVersion !== undefined && importedCaseVersion !== localVersion) {
    conflicts.push({
      type: 'CASE_VERSION_DIFF',
      title: '案例版本不一致',
      description: `本地案例版本 v${localVersion}，导入包案例版本 v${importedCaseVersion}`,
      caseVersionLocal: localVersion,
      caseVersionImported: importedCaseVersion,
    });
  }

  return conflicts;
}

// === History filters ===

function loadHistoryFilters(storage: MockStorage): HistoryFilters {
  const raw = storage.read<HistoryFilters | null>(STORAGE_KEYS.HISTORY_FILTERS, null);
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

function saveHistoryFilters(storage: MockStorage, filters: HistoryFilters): void {
  storage.write(STORAGE_KEYS.HISTORY_FILTERS, filters);
}

// === Replay package helpers ===

function buildReplayPackage(level: Level, recordId: string, startTime: number): ReplayPackage {
  const assignments: Record<string, Channel | null> = {};
  for (const p of level.patients) assignments[p.id] = p.correctChannel;
  const total = level.patients.length * 100;
  return {
    exportVersion: 2,
    exportedAt: new Date().toISOString(),
    replayHash: 'abcd1234',
    level: { id: level.id, name: level.name, version: level.version, difficulty: level.difficulty },
    record: { id: recordId, createdAt: new Date(startTime).toISOString(), totalScore: total, maxScore: total, accuracy: 100, usedSeconds: 60, completed: true },
    session: {
      id: `session-${recordId}`, levelId: level.id, levelVersion: level.version, status: 'ENDED',
      startTime, pausedAt: null, totalPausedMs: 0, elapsedSeconds: 60, remainingSeconds: 0,
      selectedPatientId: null, assignments, resourceUsage: {}, resourceAssignments: [],
      operationLog: [{ timestamp: startTime, type: 'SUBMIT' }],
      errors: [],
    },
    scoreResult: {
      total, maxScore: total, accuracy: 100,
      details: level.patients.map((p) => ({ patientId: p.id, score: 100 })),
      resourceScore: 0, timeScore: 0, finalPenalty: 0, finalBonus: 0,
      recalcProof: [{ ruleKey: 'test', input: {}, output: total }],
    },
  };
}

function buildCaseInfo(recordId: string, overrides: Partial<CaseInfo> = {}): CaseInfo {
  const now = Date.now();
  return {
    id: genUUID(),
    recordId,
    title: '测试案例',
    description: '这是一个测试案例的描述',
    tags: ['标签A', '标签B'],
    recommended: false,
    archived: false,
    source: 'LOCAL',
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function exportReplayJSON(level: Level, pkg: ReplayPackage, caseInfo?: CaseInfo): string {
  const payload = {
    ...pkg,
    ...(caseInfo ? { caseInfo, caseVersion: STORAGE_KEYS.CASE_VERSION } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

// === Test runner ===

interface TestCase { name: string; run: () => void | Promise<void>; }

interface Report {
  passed: string[];
  failed: { name: string; error: string }[];
}

function reportCase(r: Report, case_: TestCase, err?: Error) {
  if (err) r.failed.push({ name: case_.name, error: err.message });
  else r.passed.push(case_.name);
}

async function main() {
  const level = loadLevel('basic-emergency');
  const recordId = 'record-case-regression-001';
  const startTime = Date.now() - 120_000;
  const tmpDir = mkdtempSync(join(tmpdir(), 'case-regression-'));

  try {
    const storage = new MockStorage();
    const report: Report = { passed: [], failed: [] };

    // === TC1: 案例 CRUD（新增、编辑、删除）===
    (function tc1() {
      const t: TestCase = { name: 'TC1 案例 CRUD：新增 → 编辑 → 删除', run: () => {
        const created = createCase(storage, recordId, {
          title: '典型胸痛分诊案例',
          description: '适用于初学者学习胸痛患者的快速分诊流程',
          tags: ['胸痛', '初学者', '基础'],
          recommended: true,
          archived: false,
        });

        if (!created.id) throw new Error('案例 ID 未生成');
        if (created.recordId !== recordId) throw new Error('案例 recordId 不匹配');
        if (created.source !== 'LOCAL') throw new Error('新建案例 source 应为 LOCAL');
        if (created.version !== 1) throw new Error('新建案例版本应为 1');
        if (created.tags.length !== 3) throw new Error('标签数量不正确');
        if (!created.recommended) throw new Error('推荐状态未设置');
        if (!hasCase(storage, recordId)) throw new Error('hasCase 应返回 true');

        const loaded = loadCase(storage, recordId);
        if (!loaded) throw new Error('loadCase 返回 null');
        if (loaded.title !== '典型胸痛分诊案例') throw new Error('案例标题未保存');

        const beforeVersion = loaded.version;
        const updated = updateCase(storage, recordId, {
          title: '胸痛分诊案例（更新）',
          tags: ['胸痛', '进阶', '重点'],
          archived: true,
        });
        if (!updated) throw new Error('updateCase 返回 null');
        if (updated.version !== beforeVersion + 1) throw new Error(`版本号应自增：${beforeVersion} → ${updated.version}`);
        if (updated.title !== '胸痛分诊案例（更新）') throw new Error('标题未更新');
        if (!updated.tags.includes('进阶')) throw new Error('标签未更新');
        if (!updated.archived) throw new Error('归档状态未更新');
        if (updated.recommended !== true) throw new Error('未修改的字段不应改变（recommended）');

        const deleteOk = deleteCase(storage, recordId);
        if (!deleteOk) throw new Error('deleteCase 返回 false');
        if (hasCase(storage, recordId)) throw new Error('删除后 hasCase 应返回 false');
        if (loadCase(storage, recordId) !== null) throw new Error('删除后 loadCase 应返回 null');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC2: 案例标签聚合与推荐/归档状态 ===
    (function tc2() {
      const t: TestCase = { name: 'TC2 标签聚合、推荐、归档状态管理', run: () => {
        const ids = ['rec-tag-a', 'rec-tag-b', 'rec-tag-c'];
        createCase(storage, ids[0], { title: 'A', description: '', tags: ['胸痛', '创伤'], recommended: true, archived: false });
        createCase(storage, ids[1], { title: 'B', description: '', tags: ['创伤', '中毒'], recommended: false, archived: true });
        createCase(storage, ids[2], { title: 'C', description: '', tags: ['胸痛', '呼吸'], recommended: true, archived: false });

        const allTags = getCaseTags(storage);
        const expectedTags = ['创伤', '呼吸', '中毒', '胸痛'].sort();
        const actualSorted = [...allTags].sort();
        if (JSON.stringify(actualSorted) !== JSON.stringify(expectedTags)) {
          throw new Error(`标签聚合错误：预期 ${JSON.stringify(expectedTags)}，实际 ${JSON.stringify(actualSorted)}`);
        }

        const all = getAllCases(storage);
        const recommendedCount = all.filter((c) => c.recommended).length;
        const archivedCount = all.filter((c) => c.archived).length;
        if (recommendedCount !== 2) throw new Error(`推荐案例数量错误：预期 2，实际 ${recommendedCount}`);
        if (archivedCount !== 1) throw new Error(`归档案例数量错误：预期 1，实际 ${archivedCount}`);

        if (getAllCases(storage).length !== 3) throw new Error('案例总数应为 3');

        for (const id of ids) deleteCase(storage, id);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC3: 案例导出 / 导入回环 ===
    (function tc3() {
      const t: TestCase = { name: 'TC3 导出含案例 JSON → 重新导入，验证内容完整', run: () => {
        const recId = 'rec-roundtrip-001';
        const original = createCase(storage, recId, {
          title: '回环测试案例',
          description: '用于验证导出导入回环一致性',
          tags: ['回环测试', '验证'],
          recommended: true,
          archived: false,
        });

        const basePkg = buildReplayPackage(level, recId, startTime);
        const jsonStr = exportReplayJSON(level, basePkg, original);
        writeFileSync(join(tmpDir, 'case-roundtrip.json'), jsonStr, 'utf-8');

        const parsed = JSON.parse(jsonStr) as ReplayPackage & { caseInfo?: CaseInfo; caseVersion?: number };
        if (!parsed.caseInfo) throw new Error('导出的 JSON 不含 caseInfo');
        if (parsed.caseVersion !== STORAGE_KEYS.CASE_VERSION) throw new Error('caseVersion 缺失或不匹配');
        if (parsed.caseInfo.title !== original.title) throw new Error('案例标题不一致');
        if (parsed.caseInfo.description !== original.description) throw new Error('案例描述不一致');
        if (JSON.stringify(parsed.caseInfo.tags.sort()) !== JSON.stringify(original.tags.sort())) {
          throw new Error('案例标签不一致');
        }
        if (parsed.caseInfo.recommended !== original.recommended) throw new Error('推荐状态不一致');
        if (parsed.caseInfo.archived !== original.archived) throw new Error('归档状态不一致');

        const fresh = new MockStorage();
        const merged = mergeCase(fresh, recId, parsed.caseInfo);
        if (merged.title !== parsed.caseInfo.title) throw new Error('导入后标题不一致');
        if (merged.source !== 'IMPORTED') throw new Error('导入案例 source 应为 IMPORTED');
        if (merged.tags.length !== 2) throw new Error('导入后标签数量错误');

        deleteCase(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC4: 冲突合并四种策略 ===
    (function tc4() {
      const t: TestCase = { name: 'TC4 冲突合并四种策略验证：KEEP_LOCAL / MERGE / OVERWRITE / SKIP', run: () => {
        const recId = 'rec-conflict-strategies';
        const localCase = createCase(storage, recId, {
          title: '本地案例标题',
          description: '本地的描述',
          tags: ['本地标签1', '共同标签'],
          recommended: false,
          archived: false,
        });

        const imported: CaseInfo = buildCaseInfo(recId, {
          title: '导入案例标题',
          description: '导入的描述',
          tags: ['导入标签1', '共同标签'],
          recommended: true,
          archived: true,
        });

        const conflicts = detectCaseConflicts(storage, recId, imported, STORAGE_KEYS.CASE_VERSION);
        if (conflicts.length < 3) throw new Error(`预期至少 3 个冲突（HAS_LOCAL + TAG + ARCHIVED），实际 ${conflicts.length}`);
        if (!conflicts.find((c) => c.type === 'HAS_LOCAL_CASE')) throw new Error('缺少 HAS_LOCAL_CASE 冲突');
        if (!conflicts.find((c) => c.type === 'TAG_CONFLICT')) throw new Error('缺少 TAG_CONFLICT 冲突');
        if (!conflicts.find((c) => c.type === 'ARCHIVED_STATUS_CONFLICT')) throw new Error('缺少 ARCHIVED_STATUS_CONFLICT 冲突');

        // KEEP_LOCAL: 不做修改
        const clonedKeep = new MockStorage();
        clonedKeep.store = JSON.parse(JSON.stringify(storage.store));
        const beforeKeep = loadCase(clonedKeep, recId);
        appendCaseImportLog(clonedKeep, {
          fileName: 'keep.json', recordId: recId, success: true,
          hasLocalCase: true, importedHasCase: true, finalHasCase: true,
          resolution: 'KEEP_LOCAL', conflicts: conflicts.map((c) => c.type),
        });
        const afterKeep = loadCase(clonedKeep, recId);
        if (JSON.stringify(beforeKeep) !== JSON.stringify(afterKeep)) {
          throw new Error('KEEP_LOCAL 不应修改本地案例');
        }

        // MERGE: 合并标签，推荐取 OR，归档取 AND
        const clonedMerge = new MockStorage();
        clonedMerge.store = JSON.parse(JSON.stringify(storage.store));
        const merged = mergeCase(clonedMerge, recId, imported);
        const expectedTags = ['共同标签', '导入标签1', '本地标签1'].sort();
        const actualTags = [...merged.tags].sort();
        if (JSON.stringify(actualTags) !== JSON.stringify(expectedTags)) {
          throw new Error(`MERGE 标签合并错误：预期 ${JSON.stringify(expectedTags)}，实际 ${JSON.stringify(actualTags)}`);
        }
        if (!merged.recommended) throw new Error('MERGE 推荐状态应取 OR，结果应为 true');
        if (merged.archived) throw new Error('MERGE 归档状态应取 AND，结果应为 false（本地未归档）');
        if (merged.version !== localCase.version + 1) throw new Error('MERGE 后版本号应自增');

        // OVERWRITE_LOCAL: 完全替换
        const clonedOverwrite = new MockStorage();
        clonedOverwrite.store = JSON.parse(JSON.stringify(storage.store));
        replaceCase(clonedOverwrite, recId, imported);
        const overwritten = loadCase(clonedOverwrite, recId);
        if (!overwritten) throw new Error('OVERWRITE 后案例不存在');
        if (overwritten.title !== '导入案例标题') throw new Error('OVERWRITE 标题未替换');
        if (overwritten.source !== 'IMPORTED') throw new Error('OVERWRITE 后 source 应为 IMPORTED');
        if (!overwritten.tags.includes('导入标签1')) throw new Error('OVERWRITE 标签未替换');
        if (overwritten.tags.includes('本地标签1')) throw new Error('OVERWRITE 不应保留本地标签');

        // SKIP: 不做修改
        const clonedSkip = new MockStorage();
        clonedSkip.store = JSON.parse(JSON.stringify(storage.store));
        const beforeSkip = loadCase(clonedSkip, recId);
        appendCaseImportLog(clonedSkip, {
          fileName: 'skip.json', recordId: recId, success: false,
          hasLocalCase: true, importedHasCase: true, finalHasCase: true,
          resolution: 'SKIP', conflicts: conflicts.map((c) => c.type),
          errors: ['用户选择跳过'],
        });
        const afterSkip = loadCase(clonedSkip, recId);
        if (JSON.stringify(beforeSkip) !== JSON.stringify(afterSkip)) {
          throw new Error('SKIP 不应修改本地案例');
        }

        deleteCase(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC5: 标签冲突与归档状态冲突检测 ===
    (function tc5() {
      const t: TestCase = { name: 'TC5 冲突类型检测：标签差异、归档差异、版本差异', run: () => {
        const recId = 'rec-detect-conflicts';

        createCase(storage, recId, {
          title: '本地', description: '', tags: ['A', 'B'], recommended: false, archived: false,
        });

        const caseTagDiff = buildCaseInfo(recId, { tags: ['B', 'C', 'D'], archived: false });
        const conflicts1 = detectCaseConflicts(storage, recId, caseTagDiff, undefined);
        if (!conflicts1.find((c) => c.type === 'TAG_CONFLICT')) throw new Error('标签不同应触发 TAG_CONFLICT');
        if (conflicts1.find((c) => c.type === 'ARCHIVED_STATUS_CONFLICT')) throw new Error('归档状态相同不应触发冲突');

        const caseArchivedDiff = buildCaseInfo(recId, { tags: ['A', 'B'], archived: true });
        const conflicts2 = detectCaseConflicts(storage, recId, caseArchivedDiff, undefined);
        if (!conflicts2.find((c) => c.type === 'ARCHIVED_STATUS_CONFLICT')) throw new Error('归档状态不同应触发 ARCHIVED_STATUS_CONFLICT');

        const caseVersionDiff = buildCaseInfo(recId, { tags: ['A', 'B'], archived: false });
        const conflicts3 = detectCaseConflicts(storage, recId, caseVersionDiff, 999);
        if (!conflicts3.find((c) => c.type === 'CASE_VERSION_DIFF')) throw new Error('版本不同应触发 CASE_VERSION_DIFF');

        deleteCase(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC6: 旧包兼容（无 caseInfo 字段）===
    (function tc6() {
      const t: TestCase = { name: 'TC6 旧版导出包（无 caseInfo）导入兼容', run: () => {
        const recId = 'rec-legacy-no-case';
        const pkgV1 = buildReplayPackage(level, recId, startTime);
        pkgV1.exportVersion = 1;

        const jsonNoCase = JSON.stringify(pkgV1);
        const parsed = JSON.parse(jsonNoCase) as ReplayPackage;
        if (parsed.caseInfo !== undefined) throw new Error('v1 包不应包含 caseInfo');
        if (parsed.caseVersion !== undefined) throw new Error('v1 包不应包含 caseVersion');

        const fresh = new MockStorage();
        if (hasCase(fresh, recId)) throw new Error('初始案例应不存在');
        appendCaseImportLog(fresh, {
          fileName: 'v1-no-case.json', recordId: recId, success: true,
          hasLocalCase: false, importedHasCase: false, finalHasCase: false,
        });
        if (hasCase(fresh, recId)) throw new Error('v1 包导入后不应新增案例');

        const logs = loadCaseImportLog(fresh);
        if (logs.length !== 1) throw new Error('导入日志条目缺失');
        if (logs[0].importedHasCase) throw new Error('日志应记录 importedHasCase=false');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC7: 跨重启恢复（localStorage round-trip）===
    (function tc7() {
      const t: TestCase = { name: 'TC7 模拟刷新/重启：序列化 → 反序列化后案例与筛选条件完整', run: () => {
        const recId = 'rec-restart-case';
        const s1 = new MockStorage();
        createCase(s1, recId, {
          title: '重启前案例',
          description: '这是重启前创建的案例',
          tags: ['重启测试', '持久化'],
          recommended: true,
          archived: false,
        });
        appendCaseImportLog(s1, {
          fileName: 'before-restart.json', recordId: recId, success: true,
          hasLocalCase: false, importedHasCase: true, finalHasCase: true,
          resolution: 'MERGE', tagsAdded: ['重启测试', '持久化'],
        });
        saveHistoryFilters(s1, {
          filterLevelId: level.id,
          filterDifficulty: 'HARD',
          searchKeyword: '胸痛',
          filterTags: ['重启测试'],
          filterHasAnnotations: true,
          filterImported: false,
          filterRecommended: true,
          filterArchived: null,
        });

        const snapshot = s1.serialize();
        const s2 = new MockStorage();
        s2.deserialize(snapshot);

        const restoredCase = loadCase(s2, recId);
        if (!restoredCase) throw new Error('重启恢复后案例不存在');
        if (restoredCase.title !== '重启前案例') throw new Error('重启后案例标题丢失');
        if (restoredCase.description !== '这是重启前创建的案例') throw new Error('重启后案例描述丢失');
        if (!restoredCase.tags.includes('重启测试')) throw new Error('重启后案例标签丢失');
        if (!restoredCase.recommended) throw new Error('重启后推荐状态丢失');

        const caseLogs = loadCaseImportLog(s2);
        if (caseLogs.length !== 1 || caseLogs[0].fileName !== 'before-restart.json') {
          throw new Error('重启后案例导入日志丢失');
        }

        const filters = loadHistoryFilters(s2);
        if (filters.filterLevelId !== level.id) throw new Error('重启后筛选关卡丢失');
        if (filters.filterDifficulty !== 'HARD') throw new Error('重启后筛选难度丢失');
        if (filters.searchKeyword !== '胸痛') throw new Error('重启后搜索关键词丢失');
        if (filters.filterTags[0] !== '重启测试') throw new Error('重启后标签筛选丢失');
        if (filters.filterHasAnnotations !== true) throw new Error('重启后含批注筛选丢失');
        if (filters.filterImported !== false) throw new Error('重启后导入来源筛选丢失');
        if (filters.filterRecommended !== true) throw new Error('重启后推荐筛选丢失');
        if (filters.filterArchived !== null) throw new Error('重启后归档筛选应为 null');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC8: 只读限制验证（案例写入不修改原始记录数据）===
    (function tc8() {
      const t: TestCase = { name: 'TC8 只读限制：案例写入不影响 session / scoreResult / 校验码', run: () => {
        const recId = 'rec-readonly-safe';
        const pkg = buildReplayPackage(level, recId, startTime);
        const sessionBefore = JSON.stringify(pkg.session);
        const scoreBefore = JSON.stringify(pkg.scoreResult);
        const hashBefore = pkg.replayHash;

        const local = new MockStorage();
        for (let i = 0; i < 5; i++) {
          createCase(local, `${recId}-${i}`, {
            title: `案例 #${i}`,
            description: `描述 #${i}`,
            tags: [`tag-${i}`, '批量测试'],
            recommended: i % 2 === 0,
            archived: i % 3 === 0,
          });
        }

        const sessionAfter = JSON.stringify(pkg.session);
        const scoreAfter = JSON.stringify(pkg.scoreResult);
        const hashAfter = pkg.replayHash;

        if (sessionBefore !== sessionAfter) throw new Error('写入案例后 session 被修改！违反只读限制');
        if (scoreBefore !== scoreAfter) throw new Error('写入案例后 scoreResult 被修改！违反只读限制');
        if (hashBefore !== hashAfter) throw new Error('写入案例后校验码被修改！违反只读限制');

        const keys = Object.keys(local.store);
        const allowedKeys = [STORAGE_KEYS.CASES, STORAGE_KEYS.CASE_IMPORT_LOG, STORAGE_KEYS.HISTORY_FILTERS];
        const nonCaseKeys = keys.filter((k) => !allowedKeys.includes(k));
        if (nonCaseKeys.length > 0) {
          throw new Error(`存储中出现非案例键：${nonCaseKeys.join(',')}`);
        }
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC9: 案例导入日志条目完整性 ===
    (function tc9() {
      const t: TestCase = { name: 'TC9 案例导入日志：冲突处理 → 日志字段完整验证', run: () => {
        const recId = 'rec-log-test';
        const s = new MockStorage();
        createCase(s, recId, { title: '本地案例', description: '', tags: ['本地'], recommended: false, archived: false });

        const conflicts: CaseConflict[] = [
          { type: 'HAS_LOCAL_CASE', title: 'X', description: 'Y' },
          { type: 'TAG_CONFLICT', title: 'A', description: 'B', localTags: ['本地'], importedTags: ['导入'] },
        ];

        appendCaseImportLog(s, {
          fileName: 'case-log-test.json',
          recordId: recId,
          success: true,
          hasLocalCase: true,
          importedHasCase: true,
          finalHasCase: true,
          resolution: 'MERGE',
          conflicts: conflicts.map((c) => c.type),
          tagsAdded: ['导入'],
        });

        const logs = loadCaseImportLog(s);
        if (logs.length === 0) throw new Error('日志条目不存在');
        const log = logs[0];
        if (!log.id || !log.timestamp) throw new Error('日志缺少基础字段（id/timestamp）');
        if (log.fileName !== 'case-log-test.json') throw new Error('日志文件名错误');
        if (log.resolution !== 'MERGE') throw new Error('日志策略未记录');
        if (!log.conflicts?.includes('HAS_LOCAL_CASE')) throw new Error('冲突类型未写入日志');
        if (!log.conflicts?.includes('TAG_CONFLICT')) throw new Error('标签冲突未写入日志');
        if (!log.hasLocalCase || !log.importedHasCase || !log.finalHasCase) throw new Error('案例存在状态未记录');
        if (!log.tagsAdded?.includes('导入')) throw new Error('新增标签未写入日志');

        deleteCase(s, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC10: 历史列表筛选标记一致性 ===
    (function tc10() {
      const t: TestCase = { name: 'TC10 筛选与案例状态一致性：getCaseTags、推荐、归档计数', run: () => {
        const s = new MockStorage();
        const testData: { id: string; tags: string[]; recommended: boolean; archived: boolean }[] = [
          { id: 'rec-filter-a', tags: ['胸痛', '高分'], recommended: true, archived: false },
          { id: 'rec-filter-b', tags: ['创伤'], recommended: false, archived: false },
          { id: 'rec-filter-c', tags: ['胸痛', '中毒'], recommended: true, archived: true },
          { id: 'rec-filter-d', tags: ['呼吸', '初学者'], recommended: false, archived: true },
          { id: 'rec-filter-e', tags: ['创伤', '重点'], recommended: false, archived: false },
        ];
        for (const d of testData) {
          createCase(s, d.id, { title: d.id, description: '', tags: d.tags, recommended: d.recommended, archived: d.archived });
        }

        const all = getAllCases(s);
        if (all.length !== 5) throw new Error(`案例总数应为 5，实际 ${all.length}`);

        const tags = getCaseTags(s);
        const expectedTags = ['创伤', '初学者', '呼吸', '中毒', '高分', '重点', '胸痛'].sort();
        const actualSorted = [...tags].sort();
        if (JSON.stringify(actualSorted) !== JSON.stringify(expectedTags)) {
          throw new Error(`标签聚合错误：预期 ${JSON.stringify(expectedTags)}，实际 ${JSON.stringify(actualSorted)}`);
        }

        const recCount = all.filter((c) => c.recommended).length;
        const archCount = all.filter((c) => c.archived).length;
        if (recCount !== 2) throw new Error(`推荐案例数量错误：预期 2，实际 ${recCount}`);
        if (archCount !== 2) throw new Error(`归档案例数量错误：预期 2，实际 ${archCount}`);

        for (const d of testData) deleteCase(s, d.id);
        if (getAllCases(s).length !== 0) throw new Error('批量删除后案例数应为 0');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC11: MERGE 策略边界：标题/描述为空时不应覆盖本地 ===
    (function tc11() {
      const t: TestCase = { name: 'TC11 MERGE 边界：导入标题/描述为空时保留本地值', run: () => {
        const recId = 'rec-merge-edge';
        createCase(storage, recId, {
          title: '本地完整标题',
          description: '本地详细描述内容',
          tags: ['本地标签'],
          recommended: false,
          archived: false,
        });

        const importedEmpty = buildCaseInfo(recId, {
          title: '',
          description: '',
          tags: ['导入标签'],
          recommended: true,
          archived: false,
        });

        const merged = mergeCase(storage, recId, importedEmpty);
        if (merged.title !== '本地完整标题') throw new Error('导入标题为空时应保留本地标题');
        if (merged.description !== '本地详细描述内容') throw new Error('导入描述为空时应保留本地描述');
        if (!merged.tags.includes('本地标签') || !merged.tags.includes('导入标签')) {
          throw new Error('MERGE 应合并两边标签');
        }
        if (!merged.recommended) throw new Error('MERGE 推荐应取 OR');

        deleteCase(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC12: 导入日志合并展示（有案例日志 / 三种共存 / 无日志 / 刷新后恢复）===
    (function tc12() {
      const t: TestCase = { name: 'TC12 日志合并链路：案例日志可见 · 三种共存 · 空 · 刷新后恢复', run: () => {
        // --- 场景 1：仅有案例导入日志 ---
        {
          const storage = new MockStorage();
          appendCaseImportLog(storage, {
            fileName: 'only-case.json', recordId: 'rec-only-case', success: true,
            hasLocalCase: true, importedHasCase: true, finalHasCase: true,
            resolution: 'MERGE', conflicts: ['TAG_CONFLICT'],
            tagsAdded: ['合并后新标签'], tagsRemoved: [],
          });
          const unified = loadUnifiedImportLog(storage);
          if (unified.length !== 1) throw new Error('场景1 应有 1 条日志');
          if (unified[0].kind !== 'CASE') throw new Error('场景1 日志 kind 应为 CASE');
          if ((unified[0].entry as CaseImportLogEntry).fileName !== 'only-case.json') {
            throw new Error('场景1 文件名不匹配');
          }
        }

        // --- 场景 2：三种日志共存，按 timestamp 倒序合并 ---
        {
          const storage = new MockStorage();
          const t0 = 1_700_000_000_000;
          storage.write(STORAGE_KEYS.IMPORT_LOG, [{
            id: 'r1', timestamp: t0 + 100, fileName: 'record-latest.json', success: true, levelId: level.id,
            conflictsResolved: [{ type: 'DUPLICATE_RECORD', resolution: 'OVERWRITE_LOCAL' }],
          }]);
          storage.write(STORAGE_KEYS.ANNOTATION_IMPORT_LOG, [{
            id: 'a1', timestamp: t0 + 50, fileName: 'ann-middle.json', recordId: 'rec-x', success: true,
            localCountBefore: 2, importedCount: 3, finalCount: 5, resolution: 'MERGE',
            conflicts: ['TIMESTAMP_CONFLICT'],
          }]);
          storage.write(STORAGE_KEYS.CASE_IMPORT_LOG, [{
            id: 'c1', timestamp: t0, fileName: 'case-earliest.json', recordId: 'rec-x', success: true,
            hasLocalCase: true, importedHasCase: true, finalHasCase: true, resolution: 'KEEP_LOCAL',
            conflicts: ['TAG_CONFLICT', 'ARCHIVED_STATUS_CONFLICT'],
            tagsAdded: ['本地优先'], tagsRemoved: ['导入多余标签'],
          }]);

          const unified = loadUnifiedImportLog(storage);
          if (unified.length !== 3) throw new Error('场景2 应有 3 条合并日志');
          if (unified[0].kind !== 'RECORD') throw new Error('场景2 最新日志应为 RECORD');
          if (unified[1].kind !== 'ANNOTATION') throw new Error('场景2 中间日志应为 ANNOTATION');
          if (unified[2].kind !== 'CASE') throw new Error('场景2 最早日志应为 CASE');
          if ((unified[2].entry as CaseImportLogEntry).conflicts?.length !== 2) {
            throw new Error('场景2 案例日志应包含 2 个冲突类型');
          }
        }

        // --- 场景 3：完全没有任何日志 ---
        {
          const storage = new MockStorage();
          const unified = loadUnifiedImportLog(storage);
          if (unified.length !== 0) throw new Error('场景3 无日志时长度应为 0');
          if (loadImportLog(storage).length !== 0) throw new Error('场景3 记录日志应为空');
          if (loadAnnotationImportLog(storage).length !== 0) throw new Error('场景3 批注日志应为空');
          if (loadCaseImportLog(storage).length !== 0) throw new Error('场景3 案例日志应为空');
        }

        // --- 场景 4：冲突合并后刷新页面（序列化→反序列化后依然可见）---
        {
          const s1 = new MockStorage();
          const recId = 'rec-merge-refresh';
          // 1) 创建本地案例
          createCase(s1, recId, {
            title: '本地案例', description: '本地描述',
            tags: ['本地标签A', '本地标签B'], recommended: false, archived: false,
          });
          // 2) 模拟导入 MERGE
          const importedCase: CaseInfo = {
            id: 'imp-case-1', recordId: recId,
            title: '', description: '导入描述补充',
            tags: ['本地标签A', '导入标签C'], recommended: true, archived: false,
            source: 'IMPORTED', createdAt: Date.now(), updatedAt: Date.now(), version: 1,
          };
          const merged = mergeCase(s1, recId, importedCase);
          const tagsAdded = importedCase.tags.filter((t) => !merged.tags.includes(t) === false).length;
          // 写入三种导入日志（记录/批注/案例），代表一次完整导入
          appendImportLog(s1, {
            fileName: 'roundtrip-bundle.json', success: true,
            recordId: recId, levelId: level.id,
          });
          appendAnnotationImportLog(s1, {
            fileName: 'roundtrip-bundle.json', recordId: recId, success: true,
            localCountBefore: 0, importedCount: 2, finalCount: 2, resolution: 'OVERWRITE_LOCAL',
          });
          appendCaseImportLog(s1, {
            fileName: 'roundtrip-bundle.json', recordId: recId, success: true,
            hasLocalCase: true, importedHasCase: true, finalHasCase: true,
            resolution: 'MERGE', conflicts: ['TAG_CONFLICT'],
            tagsAdded: ['导入标签C'], tagsRemoved: [],
          });

          const snapshot = s1.serialize();
          const s2 = new MockStorage();
          s2.deserialize(snapshot);

          const unified = loadUnifiedImportLog(s2);
          if (unified.length !== 3) throw new Error('场景4 刷新后应有 3 条日志');
          if (unified.filter((u) => u.kind === 'CASE').length !== 1) {
            throw new Error('场景4 刷新后应包含 1 条案例日志');
          }
          const caseLog = unified.find((u) => u.kind === 'CASE')!.entry as CaseImportLogEntry;
          if (caseLog.resolution !== 'MERGE') throw new Error('场景4 案例日志策略应为 MERGE');
          if (!caseLog.tagsAdded?.includes('导入标签C')) throw new Error('场景4 案例日志应记录 +导入标签C');
          const restoredCase = loadCase(s2, recId);
          if (!restoredCase) throw new Error('场景4 刷新后案例丢失');
          if (!restoredCase.tags.includes('导入标签C')) throw new Error('场景4 刷新后合并标签丢失');
          if (restoredCase.title !== '本地案例') throw new Error('场景4 刷新后本地标题应保留');
          if (!restoredCase.recommended) throw new Error('场景4 刷新后推荐状态取 OR 丢失');
          void tagsAdded;
        }
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === 输出报告 ===
    console.log('\n==========================================');
    console.log('训练案例夹功能回归测试报告');
    console.log(`测试时间：${new Date().toISOString()}`);
    console.log(`关卡：${level.id} v${level.version}`);
    console.log(`临时目录：${tmpDir}`);
    console.log('==========================================\n');

    console.log(`✅ 通过：${report.passed.length}`);
    console.log(`❌ 失败：${report.failed.length}`);
    console.log(`📊 总计：${report.passed.length + report.failed.length}\n`);

    if (report.passed.length > 0) {
      console.log('通过的用例：');
      for (const p of report.passed) console.log(`  ✅ ${p}`);
      console.log('');
    }

    if (report.failed.length > 0) {
      console.log('失败的用例：');
      for (const f of report.failed) {
        console.log(`  ❌ ${f.name}`);
        console.log(`       错误：${f.error}`);
      }
      console.log('');
      process.exitCode = 1;
    } else {
      console.log('🎉 所有案例回归测试用例全部通过！');
    }
    console.log('');
  } finally {
    if (existsSync(tmpDir)) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

main().catch((err) => {
  console.error('测试运行时出错：', err);
  process.exitCode = 2;
});
