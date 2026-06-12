import { writeFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

type Channel = 'RED' | 'YELLOW' | 'GREEN' | 'BLACK';
type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
type ReviewPriority = 'HIGH' | 'MEDIUM' | 'LOW';
type ReviewStatus = 'PENDING' | 'REVIEWED';
type ReviewListConflictResolution = 'KEEP_LOCAL' | 'MERGE' | 'OVERWRITE_LOCAL' | 'SKIP';

interface ReviewListItem {
  recordId: string;
  status: ReviewStatus;
  priority: ReviewPriority;
  assignee: string;
  remark: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  source: 'LOCAL' | 'IMPORTED';
}

interface ReviewListStore {
  version: number;
  items: Record<string, ReviewListItem>;
}

interface ReviewListConflict {
  type: 'HAS_LOCAL_REVIEW' | 'PRIORITY_CONFLICT' | 'STATUS_CONFLICT' | 'ASSIGNEE_CONFLICT' | 'REMARK_CONFLICT' | 'REVIEW_VERSION_DIFF';
  title: string;
  description: string;
  localReview?: ReviewListItem;
  importedReview?: ReviewListItem;
}

interface ReviewListImportLogEntry {
  id: string;
  timestamp: number;
  fileName: string;
  recordId: string;
  success: boolean;
  hasLocalReview: boolean;
  importedHasReview: boolean;
  finalStatus?: ReviewStatus;
  finalPriority?: ReviewPriority;
  resolution?: ReviewListConflictResolution;
  conflicts?: string[];
  errors?: string[];
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
  reviewListItem?: ReviewListItem;
  reviewListVersion?: number;
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
  filterReviewStatus: ReviewStatus | 'ALL' | null;
}

const STORAGE_KEYS = {
  REVIEW_LIST: 'triage:review-list',
  REVIEW_LIST_IMPORT_LOG: 'triage:review-list-import-log',
  REVIEW_VERSION: 1,
  HISTORY_FILTERS: 'triage:history-filters',
  IMPORT_LOG: 'triage:import-log',
  ANNOTATION_IMPORT_LOG: 'triage:annotation-import-log',
  CASE_IMPORT_LOG: 'triage:case-import-log',
} as const;

interface ImportLogEntry {
  id: string; timestamp: number; fileName: string; success: boolean;
  recordId?: string; levelId?: string;
  errors?: Array<{ code: string; message: string }>;
  warnings?: Array<{ code: string; message: string }>;
  conflictsResolved?: Array<{ type: string; resolution: string }>;
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

// === Review List CRUD functions (mirroring src/utils/storage.ts) ===

function loadReviewListStore(storage: MockStorage): ReviewListStore {
  const raw = storage.read<ReviewListStore | null>(STORAGE_KEYS.REVIEW_LIST, null);
  if (!raw || !raw.items) return { version: STORAGE_KEYS.REVIEW_VERSION, items: {} };
  return raw;
}

function writeReviewListStore(storage: MockStorage, store: ReviewListStore): void {
  storage.write(STORAGE_KEYS.REVIEW_LIST, store);
}

function loadReviewItem(storage: MockStorage, recordId: string): ReviewListItem | null {
  return loadReviewListStore(storage).items[recordId] ?? null;
}

function hasReviewItem(storage: MockStorage, recordId: string): boolean {
  return loadReviewItem(storage, recordId) !== null;
}

function loadReviewList(storage: MockStorage): ReviewListItem[] {
  return Object.values(loadReviewListStore(storage).items);
}

function getPendingReviewCount(storage: MockStorage): number {
  return loadReviewList(storage).filter((item) => item.status === 'PENDING').length;
}

function getReviewedCount(storage: MockStorage): number {
  return loadReviewList(storage).filter((item) => item.status === 'REVIEWED').length;
}

function createReviewItem(
  storage: MockStorage,
  recordId: string,
  data: Omit<ReviewListItem, 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>
): ReviewListItem {
  const now = Date.now();
  const full: ReviewListItem = {
    ...data,
    recordId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    source: 'LOCAL',
  };
  const store = loadReviewListStore(storage);
  store.items[recordId] = full;
  writeReviewListStore(storage, store);
  return full;
}

function updateReviewItem(
  storage: MockStorage,
  recordId: string,
  updates: Partial<Pick<ReviewListItem, 'status' | 'priority' | 'assignee' | 'remark'>>
): ReviewListItem | null {
  const existing = loadReviewItem(storage, recordId);
  if (!existing) return null;
  const updated: ReviewListItem = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
    version: existing.version + 1,
  };
  const store = loadReviewListStore(storage);
  store.items[recordId] = updated;
  writeReviewListStore(storage, store);
  return updated;
}

function deleteReviewItem(storage: MockStorage, recordId: string): boolean {
  const store = loadReviewListStore(storage);
  if (!store.items[recordId]) return false;
  delete store.items[recordId];
  writeReviewListStore(storage, store);
  return true;
}

function markAsReviewed(storage: MockStorage, recordId: string): ReviewListItem | null {
  return updateReviewItem(storage, recordId, { status: 'REVIEWED' });
}

function markAsPending(storage: MockStorage, recordId: string): ReviewListItem | null {
  return updateReviewItem(storage, recordId, { status: 'PENDING' });
}

function replaceReviewItem(storage: MockStorage, recordId: string, incoming: ReviewListItem): void {
  const now = Date.now();
  const replaced: ReviewListItem = {
    ...incoming,
    updatedAt: now,
    version: (loadReviewItem(storage, recordId)?.version || 0) + 1,
    source: 'IMPORTED',
  };
  const store = loadReviewListStore(storage);
  store.items[recordId] = replaced;
  writeReviewListStore(storage, store);
}

function mergeReviewItem(storage: MockStorage, recordId: string, incoming: ReviewListItem): ReviewListItem {
  const local = loadReviewItem(storage, recordId);
  if (!local) {
    const created: ReviewListItem = { ...incoming, source: 'IMPORTED' };
    const store = loadReviewListStore(storage);
    store.items[recordId] = created;
    writeReviewListStore(storage, store);
    return created;
  }
  const mergedRemark = local.remark && incoming.remark
    ? `${local.remark}\n--- 导入备注 ---\n${incoming.remark}`
    : local.remark || incoming.remark || '';
  const merged: ReviewListItem = {
    ...local,
    priority: incoming.priority || local.priority,
    assignee: incoming.assignee || local.assignee,
    remark: mergedRemark,
    status: incoming.status || local.status,
    updatedAt: Date.now(),
    version: local.version + 1,
  };
  const store = loadReviewListStore(storage);
  store.items[recordId] = merged;
  writeReviewListStore(storage, store);
  return merged;
}

function clearReviewItemForRecord(storage: MockStorage, recordId: string): void {
  deleteReviewItem(storage, recordId);
}

function loadReviewListImportLog(storage: MockStorage): ReviewListImportLogEntry[] {
  const arr = storage.read<ReviewListImportLogEntry[]>(STORAGE_KEYS.REVIEW_LIST_IMPORT_LOG, []);
  if (!Array.isArray(arr)) return [];
  return arr.sort((a, b) => b.timestamp - a.timestamp);
}

function appendReviewListImportLog(storage: MockStorage, entry: Omit<ReviewListImportLogEntry, 'id' | 'timestamp'>): ReviewListImportLogEntry {
  const full: ReviewListImportLogEntry = { id: genUUID(), timestamp: Date.now(), ...entry };
  const list = loadReviewListImportLog(storage);
  list.unshift(full);
  storage.write(STORAGE_KEYS.REVIEW_LIST_IMPORT_LOG, list.slice(0, 100));
  return full;
}

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
      filterReviewStatus: null,
    };
  }
  return raw;
}

function saveHistoryFilters(storage: MockStorage, filters: HistoryFilters): void {
  storage.write(STORAGE_KEYS.HISTORY_FILTERS, filters);
}

function detectReviewListConflicts(
  storage: MockStorage,
  recordId: string,
  importedReview: ReviewListItem | undefined,
  importedReviewVersion: number | undefined
): ReviewListConflict[] {
  const conflicts: ReviewListConflict[] = [];
  if (!importedReview) return conflicts;

  const localReview = loadReviewItem(storage, recordId);

  if (localReview) {
    conflicts.push({
      type: 'HAS_LOCAL_REVIEW',
      title: '本地已有待讲清单数据',
      description: '该记录本地已在待讲清单中，导入包也携带清单数据',
      localReview,
      importedReview,
    });

    if (localReview.priority !== importedReview.priority) {
      conflicts.push({
        type: 'PRIORITY_CONFLICT',
        title: '优先级不一致',
        description: `本地优先级 ${localReview.priority}，导入包优先级 ${importedReview.priority}`,
        localReview,
        importedReview,
      });
    }

    if (localReview.status !== importedReview.status) {
      conflicts.push({
        type: 'STATUS_CONFLICT',
        title: '待讲状态不一致',
        description: `本地状态 ${localReview.status}，导入包状态 ${importedReview.status}`,
        localReview,
        importedReview,
      });
    }

    if (localReview.assignee !== importedReview.assignee) {
      conflicts.push({
        type: 'ASSIGNEE_CONFLICT',
        title: '负责人不一致',
        description: `本地负责人 "${localReview.assignee}"，导入包负责人 "${importedReview.assignee}"`,
        localReview,
        importedReview,
      });
    }

    if (localReview.remark !== importedReview.remark) {
      conflicts.push({
        type: 'REMARK_CONFLICT',
        title: '备注不一致',
        description: `本地备注长度 ${localReview.remark.length}，导入包备注长度 ${importedReview.remark.length}`,
        localReview,
        importedReview,
      });
    }
  }

  const localVersion = loadReviewListStore(storage).version;
  if (importedReviewVersion !== undefined && importedReviewVersion !== localVersion) {
    conflicts.push({
      type: 'REVIEW_VERSION_DIFF',
      title: '清单版本不一致',
      description: `本地清单版本 v${localVersion}，导入包清单版本 v${importedReviewVersion}`,
      localReview,
      importedReview,
    });
  }

  return conflicts;
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

function buildReviewListItem(recordId: string, overrides: Partial<ReviewListItem> = {}): ReviewListItem {
  const now = Date.now();
  return {
    recordId,
    status: 'PENDING',
    priority: 'MEDIUM',
    assignee: '张教练',
    remark: '需要重点讲解分诊逻辑',
    createdAt: now,
    updatedAt: now,
    version: 1,
    source: 'LOCAL',
    ...overrides,
  };
}

function exportReplayJSON(level: Level, pkg: ReplayPackage, reviewItem?: ReviewListItem): string {
  const payload = {
    ...pkg,
    ...(reviewItem ? { reviewListItem: reviewItem, reviewListVersion: STORAGE_KEYS.REVIEW_VERSION } : {}),
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

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}：预期 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertFalse(condition: boolean, message: string): void {
  if (condition) throw new Error(message);
}

async function main() {
  const level = loadLevel('basic-emergency');
  const recordId = 'record-review-regression-001';
  const startTime = Date.now() - 120_000;
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-list-regression-'));

  try {
    const storage = new MockStorage();
    const report: Report = { passed: [], failed: [] };

    // === TC1: 清单 CRUD（新增、编辑、删除）===
    (function tc1() {
      const t: TestCase = { name: 'TC1 清单 CRUD：新增 → 编辑 → 删除', run: () => {
        const created = createReviewItem(storage, recordId, {
          status: 'PENDING',
          priority: 'HIGH',
          assignee: '李教练',
          remark: '关注胸痛患者的分诊顺序',
        });

        assertEqual(created.recordId, recordId, 'recordId 不匹配');
        assertEqual(created.source, 'LOCAL', '新建 source 应为 LOCAL');
        assertEqual(created.version, 1, '新建版本应为 1');
        assertEqual(created.status, 'PENDING', '状态应为 PENDING');
        assertEqual(created.priority, 'HIGH', '优先级应为 HIGH');
        assertEqual(created.assignee, '李教练', '负责人不匹配');
        assertTrue(hasReviewItem(storage, recordId), 'hasReviewItem 应返回 true');

        const loaded = loadReviewItem(storage, recordId);
        assertEqual(loaded?.remark, '关注胸痛患者的分诊顺序', '备注未保存');

        const beforeVersion = loaded!.version;
        const updated = updateReviewItem(storage, recordId, {
          priority: 'MEDIUM',
          assignee: '王教练',
          remark: '已更新备注内容',
        });
        assertEqual(updated!.version, beforeVersion + 1, '版本号应自增');
        assertEqual(updated!.priority, 'MEDIUM', '优先级未更新');
        assertEqual(updated!.assignee, '王教练', '负责人未更新');
        assertEqual(updated!.remark, '已更新备注内容', '备注未更新');
        assertEqual(updated!.status, 'PENDING', '未修改的状态不应改变');

        const deleteOk = deleteReviewItem(storage, recordId);
        assertTrue(deleteOk, 'deleteReviewItem 应返回 true');
        assertFalse(hasReviewItem(storage, recordId), '删除后 hasReviewItem 应返回 false');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC2: 已讲状态切换 ===
    (function tc2() {
      const t: TestCase = { name: 'TC2 已讲切换：待讲 → 已讲 → 待讲', run: () => {
        const recId = 'rec-status-switch';
        const created = createReviewItem(storage, recId, {
          status: 'PENDING',
          priority: 'LOW',
          assignee: '赵教练',
          remark: '',
        });
        assertEqual(created.status, 'PENDING', '初始状态应为 PENDING');
        assertEqual(getPendingReviewCount(storage), 1, '待讲数量应为 1');
        assertEqual(getReviewedCount(storage), 0, '已讲数量应为 0');

        const reviewed = markAsReviewed(storage, recId);
        assertEqual(reviewed!.status, 'REVIEWED', '标记后状态应为 REVIEWED');
        assertEqual(reviewed!.version, created.version + 1, '标记已讲后版本应自增');
        assertEqual(getPendingReviewCount(storage), 0, '待讲数量应为 0');
        assertEqual(getReviewedCount(storage), 1, '已讲数量应为 1');

        const pending = markAsPending(storage, recId);
        assertEqual(pending!.status, 'PENDING', '撤回后状态应为 PENDING');
        assertEqual(pending!.version, reviewed!.version + 1, '撤回后版本应自增');
        assertEqual(getPendingReviewCount(storage), 1, '待讲数量应为 1');
        assertEqual(getReviewedCount(storage), 0, '已讲数量应为 0');

        deleteReviewItem(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC3: 导出/导入回环 ===
    (function tc3() {
      const t: TestCase = { name: 'TC3 导出含清单 JSON → 重新导入，验证内容完整', run: () => {
        const recId = 'rec-roundtrip-001';
        const original = createReviewItem(storage, recId, {
          status: 'PENDING',
          priority: 'HIGH',
          assignee: '陈教练',
          remark: '回环测试备注',
        });

        const basePkg = buildReplayPackage(level, recId, startTime);
        const jsonStr = exportReplayJSON(level, basePkg, original);
        writeFileSync(join(tmpDir, 'review-roundtrip.json'), jsonStr, 'utf-8');

        const parsed = JSON.parse(jsonStr) as ReplayPackage & { reviewListItem?: ReviewListItem; reviewListVersion?: number };
        assertTrue(!!parsed.reviewListItem, '导出的 JSON 不含 reviewListItem');
        assertEqual(parsed.reviewListVersion, STORAGE_KEYS.REVIEW_VERSION, 'reviewListVersion 缺失或不匹配');
        assertEqual(parsed.reviewListItem!.priority, original.priority, '优先级不一致');
        assertEqual(parsed.reviewListItem!.status, original.status, '状态不一致');
        assertEqual(parsed.reviewListItem!.assignee, original.assignee, '负责人不一致');
        assertEqual(parsed.reviewListItem!.remark, original.remark, '备注不一致');

        const fresh = new MockStorage();
        const merged = mergeReviewItem(fresh, recId, parsed.reviewListItem!);
        assertEqual(merged.priority, parsed.reviewListItem!.priority, '导入后优先级不一致');
        assertEqual(merged.source, 'IMPORTED', '导入 source 应为 IMPORTED');

        deleteReviewItem(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC4: 冲突处理四种策略 ===
    (function tc4() {
      const t: TestCase = { name: 'TC4 冲突处理四种策略：KEEP_LOCAL / MERGE / OVERWRITE / SKIP', run: () => {
        const recId = 'rec-conflict-strategies';
        const local = createReviewItem(storage, recId, {
          status: 'PENDING',
          priority: 'MEDIUM',
          assignee: '本地教练',
          remark: '本地备注内容',
        });

        const imported: ReviewListItem = buildReviewListItem(recId, {
          status: 'REVIEWED',
          priority: 'HIGH',
          assignee: '导入教练',
          remark: '导入备注内容',
        });

        const conflicts = detectReviewListConflicts(storage, recId, imported, STORAGE_KEYS.REVIEW_VERSION);
        assertTrue(conflicts.length >= 4, `预期至少 4 个冲突，实际 ${conflicts.length}`);
        assertTrue(conflicts.find((c) => c.type === 'HAS_LOCAL_REVIEW') !== undefined, '缺少 HAS_LOCAL_REVIEW 冲突');
        assertTrue(conflicts.find((c) => c.type === 'PRIORITY_CONFLICT') !== undefined, '缺少 PRIORITY_CONFLICT 冲突');
        assertTrue(conflicts.find((c) => c.type === 'STATUS_CONFLICT') !== undefined, '缺少 STATUS_CONFLICT 冲突');
        assertTrue(conflicts.find((c) => c.type === 'ASSIGNEE_CONFLICT') !== undefined, '缺少 ASSIGNEE_CONFLICT 冲突');
        assertTrue(conflicts.find((c) => c.type === 'REMARK_CONFLICT') !== undefined, '缺少 REMARK_CONFLICT 冲突');

        // KEEP_LOCAL: 不做修改
        const clonedKeep = new MockStorage();
        clonedKeep.deserialize(storage.serialize());
        const beforeKeep = loadReviewItem(clonedKeep, recId);
        appendReviewListImportLog(clonedKeep, {
          fileName: 'keep.json', recordId: recId, success: true,
          hasLocalReview: true, importedHasReview: true,
          finalStatus: local.status, finalPriority: local.priority,
          resolution: 'KEEP_LOCAL', conflicts: conflicts.map((c) => c.type),
        });
        const afterKeep = loadReviewItem(clonedKeep, recId);
        assertEqual(JSON.stringify(beforeKeep), JSON.stringify(afterKeep), 'KEEP_LOCAL 不应修改本地清单');

        // MERGE: 合并备注，取导入优先级/状态/负责人
        const clonedMerge = new MockStorage();
        clonedMerge.deserialize(storage.serialize());
        const merged = mergeReviewItem(clonedMerge, recId, imported);
        assertEqual(merged.priority, 'HIGH', 'MERGE 优先级应取导入值');
        assertEqual(merged.status, 'REVIEWED', 'MERGE 状态应取导入值');
        assertEqual(merged.assignee, '导入教练', 'MERGE 负责人应取导入值');
        assertTrue(merged.remark.includes('本地备注内容'), 'MERGE 备注应包含本地内容');
        assertTrue(merged.remark.includes('导入备注内容'), 'MERGE 备注应包含导入内容');
        assertTrue(merged.remark.includes('--- 导入备注 ---'), 'MERGE 备注应包含分隔符');
        assertEqual(merged.version, local.version + 1, 'MERGE 后版本号应自增');

        // OVERWRITE_LOCAL: 完全替换
        const clonedOverwrite = new MockStorage();
        clonedOverwrite.deserialize(storage.serialize());
        replaceReviewItem(clonedOverwrite, recId, imported);
        const overwritten = loadReviewItem(clonedOverwrite, recId);
        assertEqual(overwritten!.priority, 'HIGH', 'OVERWRITE 优先级应替换');
        assertEqual(overwritten!.status, 'REVIEWED', 'OVERWRITE 状态应替换');
        assertEqual(overwritten!.assignee, '导入教练', 'OVERWRITE 负责人应替换');
        assertEqual(overwritten!.remark, '导入备注内容', 'OVERWRITE 备注应替换');
        assertEqual(overwritten!.source, 'IMPORTED', 'OVERWRITE 后 source 应为 IMPORTED');

        // SKIP: 记录日志但不修改
        const clonedSkip = new MockStorage();
        clonedSkip.deserialize(storage.serialize());
        const beforeSkip = loadReviewItem(clonedSkip, recId);
        appendReviewListImportLog(clonedSkip, {
          fileName: 'skip.json', recordId: recId, success: false,
          hasLocalReview: true, importedHasReview: true,
          resolution: 'SKIP', conflicts: conflicts.map((c) => c.type),
          errors: ['用户选择跳过'],
        });
        const afterSkip = loadReviewItem(clonedSkip, recId);
        assertEqual(JSON.stringify(beforeSkip), JSON.stringify(afterSkip), 'SKIP 不应修改本地清单');

        deleteReviewItem(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC5: 旧包兼容（无清单数据的 JSON 导入）===
    (function tc5() {
      const t: TestCase = { name: 'TC5 旧包兼容：导入不含清单的 JSON 保持空状态', run: () => {
        const recId = 'rec-old-package';
        const basePkg = buildReplayPackage(level, recId, startTime);
        const jsonStr = exportReplayJSON(level, basePkg); // 不带 reviewListItem
        const parsed = JSON.parse(jsonStr) as ReplayPackage & { reviewListItem?: ReviewListItem };
        assertFalse(!!parsed.reviewListItem, '旧包不应含 reviewListItem');

        const fresh = new MockStorage();
        // 模拟导入旧包后调用 handleReviewListDirect
        const conflicts = detectReviewListConflicts(fresh, recId, parsed.reviewListItem, undefined);
        assertEqual(conflicts.length, 0, '旧包导入不应产生冲突');
        assertFalse(hasReviewItem(fresh, recId), '旧包导入后不应创建清单');

        appendReviewListImportLog(fresh, {
          fileName: 'old-package.json', recordId: recId, success: true,
          hasLocalReview: false, importedHasReview: false,
          resolution: 'KEEP_LOCAL',
        });

        const logs = loadReviewListImportLog(fresh);
        assertEqual(logs.length, 1, '应记录导入日志');
        assertEqual(logs[0].resolution, 'KEEP_LOCAL', '日志 resolution 应为 KEEP_LOCAL');
        assertFalse(logs[0].importedHasReview, '日志应记录导入包不含清单');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC6: 跨重启恢复（存储序列化/反序列化）===
    (function tc6() {
      const t: TestCase = { name: 'TC6 跨重启恢复：序列化后恢复验证', run: () => {
        const recId1 = 'rec-restart-a';
        const recId2 = 'rec-restart-b';
        createReviewItem(storage, recId1, {
          status: 'PENDING', priority: 'HIGH', assignee: 'A教练', remark: 'A备注',
        });
        createReviewItem(storage, recId2, {
          status: 'REVIEWED', priority: 'LOW', assignee: 'B教练', remark: 'B备注',
        });

        saveHistoryFilters(storage, {
          filterLevelId: null, filterDifficulty: null, searchKeyword: '',
          filterTags: [], filterHasAnnotations: null, filterImported: null,
          filterRecommended: null, filterArchived: null, filterReviewStatus: 'PENDING',
        });

        const savedState = storage.serialize();
        const newStorage = new MockStorage();
        newStorage.deserialize(savedState);

        assertEqual(loadReviewList(newStorage).length, 2, '恢复后清单数量应为 2');
        assertTrue(hasReviewItem(newStorage, recId1), '应恢复 recId1');
        assertTrue(hasReviewItem(newStorage, recId2), '应恢复 recId2');

        const item1 = loadReviewItem(newStorage, recId1);
        assertEqual(item1!.status, 'PENDING', '恢复后状态应一致');
        assertEqual(item1!.priority, 'HIGH', '恢复后优先级应一致');
        assertEqual(item1!.assignee, 'A教练', '恢复后负责人应一致');
        assertEqual(item1!.remark, 'A备注', '恢复后备注应一致');

        const filters = loadHistoryFilters(newStorage);
        assertEqual(filters.filterReviewStatus, 'PENDING', '筛选器状态应恢复');
        assertEqual(getPendingReviewCount(newStorage), 1, '恢复后待讲数量应为 1');
        assertEqual(getReviewedCount(newStorage), 1, '恢复后已讲数量应为 1');

        // 验证版本号和时间戳也被恢复
        assertEqual(item1!.version, 1, '版本号应恢复');
        assertTrue(item1!.createdAt > 0, 'createdAt 应恢复');
        assertTrue(item1!.updatedAt > 0, 'updatedAt 应恢复');

        deleteReviewItem(storage, recId1);
        deleteReviewItem(storage, recId2);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC7: 导入日志记录 ===
    (function tc7() {
      const t: TestCase = { name: 'TC7 导入日志：所有操作都应写入可查看日志', run: () => {
        const recId = 'rec-log-test';
        const beforeCount = loadReviewListImportLog(storage).length;

        appendReviewListImportLog(storage, {
          fileName: 'test-import-1.json', recordId: recId, success: true,
          hasLocalReview: false, importedHasReview: true,
          finalStatus: 'PENDING', finalPriority: 'HIGH',
          resolution: 'MERGE', conflicts: ['PRIORITY_CONFLICT'],
        });

        appendReviewListImportLog(storage, {
          fileName: 'test-import-2.json', recordId: recId, success: false,
          hasLocalReview: true, importedHasReview: true,
          errors: ['用户选择跳过'],
        });

        const logs = loadReviewListImportLog(storage);
        assertEqual(logs.length, beforeCount + 2, '应新增 2 条日志');
        assertEqual(logs[0].fileName, 'test-import-2.json', '日志应按时间倒序');
        assertEqual(logs[1].fileName, 'test-import-1.json', '第二条日志文件名应正确');
        assertTrue(logs[1].success, '第一条日志应为成功');
        assertFalse(logs[0].success, '第二条日志应为失败');
        assertEqual(logs[1].resolution, 'MERGE', 'resolution 应为 MERGE');
        assertEqual(logs[1].conflicts?.length, 1, '应记录冲突类型');
        assertTrue(logs[1].conflicts?.includes('PRIORITY_CONFLICT'), '应记录 PRIORITY_CONFLICT');
        assertEqual(logs[0].errors?.length, 1, '应记录错误信息');

        // 验证日志可与其他类型日志合并显示
        const allLogs = [
          ...loadReviewListImportLog(storage),
        ];
        assertEqual(allLogs.length, beforeCount + 2, '合并后日志数量正确');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC8: 清单数据隔离（不影响原始训练记录）===
    (function tc8() {
      const t: TestCase = { name: 'TC8 数据隔离：清单操作不影响原始记录数据', run: () => {
        const recId = 'rec-isolation';
        const basePkg = buildReplayPackage(level, recId, startTime);
        const originalPkg = JSON.stringify(basePkg);

        // 创建清单项
        const reviewItem = createReviewItem(storage, recId, {
          status: 'PENDING', priority: 'HIGH', assignee: '隔离测试', remark: '隔离测试备注',
        });

        // 验证 ReplayPackage 未被修改
        const currentPkg = JSON.stringify(basePkg);
        assertEqual(currentPkg, originalPkg, '创建清单不应修改 ReplayPackage');

        // 更新清单
        updateReviewItem(storage, recId, { status: 'REVIEWED', remark: '更新后的备注' });
        const afterUpdatePkg = JSON.stringify(basePkg);
        assertEqual(afterUpdatePkg, originalPkg, '更新清单不应修改 ReplayPackage');

        // 删除清单
        deleteReviewItem(storage, recId);
        const afterDeletePkg = JSON.stringify(basePkg);
        assertEqual(afterDeletePkg, originalPkg, '删除清单不应修改 ReplayPackage');

        // 验证存储中清单数据是独立的
        const reviewKey = STORAGE_KEYS.REVIEW_LIST;
        assertTrue(!!storage.store[reviewKey], '清单应有独立存储');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC9: overwrite 模式下清除清单 ===
    (function tc9() {
      const t: TestCase = { name: 'TC9 覆盖模式：overwrite 时应清除清单数据', run: () => {
        const recId = 'rec-overwrite';
        createReviewItem(storage, recId, {
          status: 'PENDING', priority: 'MEDIUM', assignee: '覆盖测试', remark: '',
        });
        assertTrue(hasReviewItem(storage, recId), '创建后应有清单');

        // 模拟 overwrite 模式导入
        clearReviewItemForRecord(storage, recId);
        assertFalse(hasReviewItem(storage, recId), 'overwrite 后清单应被清除');

        // 导入新的清单数据
        const imported = buildReviewListItem(recId, { priority: 'HIGH', assignee: '新教练' });
        const merged = mergeReviewItem(storage, recId, imported);
        assertEqual(merged.priority, 'HIGH', '新导入的优先级应正确');
        assertEqual(merged.assignee, '新教练', '新导入的负责人应正确');

        deleteReviewItem(storage, recId);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === 汇总报告 ===
    console.log('\n' + '='.repeat(70));
    console.log('  待讲清单回归测试报告');
    console.log('='.repeat(70));
    console.log(`\n  总计: ${report.passed.length + report.failed.length} 个测试用例`);
    console.log(`  ✅ 通过: ${report.passed.length}`);
    console.log(`  ❌ 失败: ${report.failed.length}`);

    if (report.passed.length > 0) {
      console.log('\n  通过的测试:');
      for (const name of report.passed) {
        console.log(`    ✅ ${name}`);
      }
    }

    if (report.failed.length > 0) {
      console.log('\n  失败的测试:');
      for (const fail of report.failed) {
        console.log(`    ❌ ${fail.name}`);
        console.log(`       错误: ${fail.error}`);
      }
    }

    console.log('');
    console.log('='.repeat(70));

    if (report.failed.length > 0) {
      process.exitCode = 1;
    } else {
      console.log('  🎉 所有测试通过！');
      console.log('='.repeat(70));
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('测试运行失败:', e);
  process.exitCode = 1;
});
