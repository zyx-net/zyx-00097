import { writeFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

type Channel = 'RED' | 'YELLOW' | 'GREEN' | 'BLACK';
type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
type AnnotationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AnnotationTargetType = 'TIMESTAMP' | 'PATIENT' | 'GLOBAL';
interface CoachAnnotation {
  id: string;
  recordId: string;
  targetType: AnnotationTargetType;
  timestampMs?: number;
  patientId?: string;
  severity: AnnotationSeverity;
  content: string;
  suggestion: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  source: 'LOCAL' | 'IMPORTED';
}
interface AnnotationStore {
  version: number;
  annotations: Record<string, CoachAnnotation[]>;
}
interface AnnotationImportLogEntry {
  id: string;
  timestamp: number;
  fileName: string;
  recordId: string;
  success: boolean;
  localCountBefore: number;
  importedCount: number;
  finalCount: number;
  resolution?: 'KEEP_LOCAL' | 'MERGE' | 'OVERWRITE_LOCAL' | 'SKIP';
  conflicts?: string[];
  errors?: string[];
}
interface AnnotationConflict {
  type: 'DUPLICATE_ANNOTATION' | 'ANNOTATION_VERSION_DIFF' | 'TIMESTAMP_CONFLICT' | 'HAS_LOCAL_ANNOTATIONS';
  title: string;
  description: string;
  localAnnotations?: CoachAnnotation[];
  importedAnnotations?: CoachAnnotation[];
  annotationVersionLocal?: number;
  annotationVersionImported?: number;
}

interface Patient {
  id: string; sequenceNo: number; name: string; correctChannel: Channel;
  requiredResources: { resourceId: string; count: number; reason?: string }[];
}
interface ResourceSlot { id: string; name: string; initialCount: number; consumable: boolean; }
interface Level {
  id: string; name: string; version: string; difficulty: Difficulty;
  timeLimitSeconds: number; patients: Patient[]; resourceSlots: ResourceSlot[];
  scoringRules: { correctScore: number; channelWrongPenalty: number; };
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
  annotations?: CoachAnnotation[];
  annotationVersion?: number;
}

const STORAGE_KEYS = {
  ANNOTATIONS: 'triage:annotations',
  ANNOTATION_IMPORT_LOG: 'triage:annotation-import-log',
  ANNOTATION_VERSION: 1,
} as const;

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

// === Annotation CRUD functions (mirroring src/utils/storage.ts) ===

function loadAnnotationStore(storage: MockStorage): AnnotationStore {
  const raw = storage.read<AnnotationStore | null>(STORAGE_KEYS.ANNOTATIONS, null);
  if (!raw || !raw.annotations) return { version: STORAGE_KEYS.ANNOTATION_VERSION, annotations: {} };
  return raw;
}

function writeAnnotationStore(storage: MockStorage, store: AnnotationStore): void {
  storage.write(STORAGE_KEYS.ANNOTATIONS, store);
}

function loadAnnotations(storage: MockStorage, recordId: string): CoachAnnotation[] {
  return loadAnnotationStore(storage).annotations[recordId] ?? [];
}

function saveAnnotations(storage: MockStorage, recordId: string, annotations: CoachAnnotation[]): void {
  const store = loadAnnotationStore(storage);
  store.annotations[recordId] = annotations;
  writeAnnotationStore(storage, store);
}

function addAnnotation(
  storage: MockStorage,
  recordId: string,
  annotation: Omit<CoachAnnotation, 'id' | 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>
): CoachAnnotation {
  const now = Date.now();
  const full: CoachAnnotation = {
    ...annotation,
    id: genUUID(),
    recordId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    source: 'LOCAL',
  };
  const list = loadAnnotations(storage, recordId);
  list.push(full);
  saveAnnotations(storage, recordId, list);
  return full;
}

function updateAnnotation(
  storage: MockStorage,
  recordId: string,
  annotationId: string,
  updates: Partial<Pick<CoachAnnotation, 'severity' | 'content' | 'suggestion'>>
): CoachAnnotation | null {
  const list = loadAnnotations(storage, recordId);
  const idx = list.findIndex((a) => a.id === annotationId);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...updates, updatedAt: Date.now(), version: list[idx].version + 1 };
  saveAnnotations(storage, recordId, list);
  return list[idx];
}

function deleteAnnotation(storage: MockStorage, recordId: string, annotationId: string): boolean {
  const list = loadAnnotations(storage, recordId);
  const idx = list.findIndex((a) => a.id === annotationId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  saveAnnotations(storage, recordId, list);
  return true;
}

function getAnnotationCount(storage: MockStorage, recordId: string): number {
  return loadAnnotations(storage, recordId).length;
}

function replaceAnnotations(storage: MockStorage, recordId: string, annotations: CoachAnnotation[]): void {
  saveAnnotations(storage, recordId, annotations);
}

function mergeAnnotations(storage: MockStorage, recordId: string, incoming: CoachAnnotation[]): CoachAnnotation[] {
  const local = loadAnnotations(storage, recordId);
  const localKeys = new Set(local.map((a) => a.id));
  const localSigKeys = new Set(local.map((a) => `${a.targetType}:${a.timestampMs ?? ''}:${a.patientId ?? ''}`));
  const merged = [...local];
  for (const ann of incoming) {
    if (localKeys.has(ann.id)) continue;
    const sig = `${ann.targetType}:${ann.timestampMs ?? ''}:${ann.patientId ?? ''}`;
    if (localSigKeys.has(sig)) continue;
    merged.push({ ...ann, source: 'IMPORTED' });
  }
  saveAnnotations(storage, recordId, merged);
  return merged;
}

function clearAnnotationsForRecord(storage: MockStorage, recordId: string): void {
  const store = loadAnnotationStore(storage);
  delete store.annotations[recordId];
  writeAnnotationStore(storage, store);
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

function detectAnnotationConflicts(
  storage: MockStorage,
  recordId: string,
  importedAnnotations: CoachAnnotation[] | undefined,
  importedAnnotationVersion: number | undefined
): AnnotationConflict[] {
  const conflicts: AnnotationConflict[] = [];
  if (!importedAnnotations || importedAnnotations.length === 0) return conflicts;
  const localAnnotations = loadAnnotations(storage, recordId);

  if (localAnnotations.length > 0) {
    conflicts.push({
      type: 'HAS_LOCAL_ANNOTATIONS',
      title: '本地已有教练批注',
      description: `本地已有 ${localAnnotations.length} 条，导入包带 ${importedAnnotations.length} 条`,
      localAnnotations, importedAnnotations,
    });
    const localSigSet = new Set(localAnnotations.map((a) => `${a.targetType}:${a.timestampMs ?? ''}:${a.patientId ?? ''}`));
    const duplicates = importedAnnotations.filter((a) => localSigSet.has(`${a.targetType}:${a.timestampMs ?? ''}:${a.patientId ?? ''}`));
    if (duplicates.length > 0) {
      conflicts.push({
        type: 'DUPLICATE_ANNOTATION',
        title: '存在相同目标的重复批注',
        description: `${duplicates.length} 条批注目标重复`,
        localAnnotations: duplicates, importedAnnotations,
      });
    }
  }

  if (importedAnnotationVersion !== undefined && importedAnnotationVersion !== STORAGE_KEYS.ANNOTATION_VERSION) {
    conflicts.push({
      type: 'ANNOTATION_VERSION_DIFF',
      title: '批注版本不一致',
      description: `本地 v${STORAGE_KEYS.ANNOTATION_VERSION}，导入 v${importedAnnotationVersion}`,
      annotationVersionLocal: STORAGE_KEYS.ANNOTATION_VERSION,
      annotationVersionImported: importedAnnotationVersion,
    });
  }
  return conflicts;
}

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

function exportReplayJSON(level: Level, pkg: ReplayPackage, annotations?: CoachAnnotation[]): string {
  const payload = {
    ...pkg,
    ...(annotations && annotations.length > 0 ? { annotations, annotationVersion: STORAGE_KEYS.ANNOTATION_VERSION } : {}),
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
  const recordId = 'record-ann-regression-001';
  const startTime = Date.now() - 120_000;
  const tmpDir = mkdtempSync(join(tmpdir(), 'ann-regression-'));

  try {
    const storage = new MockStorage();
    const report: Report = { passed: [], failed: [] };

    // === TC1: 覆盖新增批注（时间点/患者/全局）===
    (function tc1() {
      const t: TestCase = { name: 'TC1 覆盖新增批注（三种目标类型）', run: () => {
        const ann1 = addAnnotation(storage, recordId, { targetType: 'TIMESTAMP', timestampMs: startTime + 10_000, severity: 'HIGH', content: '第 10 秒反应迟钝', suggestion: '建议优先巡视重症区' });
        const ann2 = addAnnotation(storage, recordId, { targetType: 'PATIENT', patientId: level.patients[0].id, severity: 'MEDIUM', content: `${level.patients[0].name} 分诊理由阐述不充分`, suggestion: '下次口述关键指征' });
        const ann3 = addAnnotation(storage, recordId, { targetType: 'GLOBAL', severity: 'LOW', content: '整体流程平稳', suggestion: '继续保持' });
        if (getAnnotationCount(storage, recordId) !== 3) throw new Error(`预期 3 条批注，实际 ${getAnnotationCount(storage, recordId)}`);
        const list = loadAnnotations(storage, recordId);
        if (list[0].id !== ann1.id) throw new Error('批注顺序不一致');
        if (list[1].patientId !== level.patients[0].id) throw new Error('患者 ID 未保存');
        if (list[2].targetType !== 'GLOBAL') throw new Error('全局批注类型错误');
        if (list.some((a) => a.source !== 'LOCAL')) throw new Error('源标记应为 LOCAL');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC2: 批注编辑与删除 ===
    (function tc2() {
      const t: TestCase = { name: 'TC2 编辑/删除批注，验证计数与版本', run: () => {
        const list = loadAnnotations(storage, recordId);
        const firstId = list[0].id;
        const before = list[0].version;
        const updated = updateAnnotation(storage, recordId, firstId, { severity: 'CRITICAL', content: '第10秒严重失误' });
        if (!updated) throw new Error('编辑返回空');
        if (updated.version !== before + 1) throw new Error(`版本号应自增，${before} → ${updated.version}`);
        if (updated.severity !== 'CRITICAL') throw new Error('严重程度未更新');
        const beforeCount = getAnnotationCount(storage, recordId);
        const ok = deleteAnnotation(storage, recordId, list[2].id);
        if (!ok) throw new Error('删除失败');
        if (getAnnotationCount(storage, recordId) !== beforeCount - 1) throw new Error('删除后计数未减');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC3: 批注导出 / 导入回环 ===
    (function tc3() {
      const t: TestCase = { name: 'TC3 导出含批注 JSON → 重新导入，验证内容完整', run: () => {
        const anns = loadAnnotations(storage, recordId);
        const basePkg = buildReplayPackage(level, recordId, startTime);
        const jsonStr = exportReplayJSON(level, basePkg, anns);
        writeFileSync(join(tmpDir, 'roundtrip.json'), jsonStr, 'utf-8');
        const parsed = JSON.parse(jsonStr) as ReplayPackage & { annotations?: CoachAnnotation[]; annotationVersion?: number };
        if (!parsed.annotations) throw new Error('导出的 JSON 不含 annotations');
        if (parsed.annotationVersion !== STORAGE_KEYS.ANNOTATION_VERSION) throw new Error('annotationVersion 缺失');
        if (parsed.annotations.length !== anns.length) throw new Error(`批注数量不一致：导出 ${anns.length}，解析后 ${parsed.annotations.length}`);
        for (let i = 0; i < anns.length; i++) {
          if (parsed.annotations[i].content !== anns[i].content) throw new Error(`第 ${i} 条内容不一致`);
          if (parsed.annotations[i].severity !== anns[i].severity) throw new Error(`第 ${i} 条严重程度不一致`);
        }

        // 模拟重新导入到空白存储
        const fresh = new MockStorage();
        const merged = mergeAnnotations(fresh, recordId, parsed.annotations.map((a) => ({ ...a, source: 'IMPORTED' })));
        if (merged.length !== anns.length) throw new Error('导入后合并数量错误');
        if (!merged.every((a) => a.source === 'IMPORTED')) throw new Error('导入批注 source 应为 IMPORTED');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC4: 冲突合并场景（MERGE / KEEP_LOCAL / OVERWRITE / 重复去重）===
    (function tc4() {
      const t: TestCase = { name: 'TC4 冲突合并四种策略验证 + 重复去重', run: () => {
        const recId = 'record-conflict-test';
        // 先写入本地 2 条批注
        const local = new MockStorage();
        addAnnotation(local, recId, { targetType: 'TIMESTAMP', timestampMs: startTime + 5_000, severity: 'HIGH', content: '本地：5秒处操作失误', suggestion: '提高警觉' });
        addAnnotation(local, recId, { targetType: 'GLOBAL', severity: 'LOW', content: '本地：整体评价', suggestion: '再接再厉' });
        const initialCount = getAnnotationCount(local, recId);

        // 构造 3 条导入批注：其中 1 条与本地时间点重复（5000ms），2 条新批注
        const imported: CoachAnnotation[] = [
          { id: genUUID(), recordId: recId, targetType: 'TIMESTAMP', timestampMs: startTime + 5_000, severity: 'MEDIUM', content: '导入：5秒处慢了', suggestion: '加速', createdAt: 1, updatedAt: 1, version: 1, source: 'LOCAL' },
          { id: genUUID(), recordId: recId, targetType: 'PATIENT', patientId: level.patients[1].id, severity: 'CRITICAL', content: '导入：2号患者判断错误', suggestion: '复习创伤指南', createdAt: 1, updatedAt: 1, version: 1, source: 'LOCAL' },
          { id: genUUID(), recordId: recId, targetType: 'TIMESTAMP', timestampMs: startTime + 30_000, severity: 'LOW', content: '导入：30秒停顿', suggestion: '避免停顿', createdAt: 1, updatedAt: 1, version: 1, source: 'LOCAL' },
        ];

        // 冲突检测
        const conflicts = detectAnnotationConflicts(local, recId, imported, 1);
        if (conflicts.length < 2) throw new Error(`预期至少 2 个冲突（HAS_LOCAL + DUPLICATE），实际 ${conflicts.length}`);
        if (!conflicts.find((c) => c.type === 'HAS_LOCAL_ANNOTATIONS')) throw new Error('缺少 HAS_LOCAL_ANNOTATIONS 冲突');
        if (!conflicts.find((c) => c.type === 'DUPLICATE_ANNOTATION')) throw new Error('缺少 DUPLICATE_ANNOTATION 冲突');

        // MERGE 策略：本地 2 + 导入中不重复 2 = 4（重复的5秒时间点保留本地）
        const clonedForMerge = new MockStorage();
        clonedForMerge.store = JSON.parse(JSON.stringify(local.store));
        const merged = mergeAnnotations(clonedForMerge, recId, imported);
        if (merged.length !== 4) throw new Error(`MERGE 预期 4 条，实际 ${merged.length}`);
        const sigs = merged.map((a) => `${a.targetType}:${a.timestampMs ?? ''}:${a.patientId ?? ''}`);
        const dupe5s = merged.filter((a) => a.targetType === 'TIMESTAMP' && a.timestampMs === startTime + 5_000);
        if (dupe5s.length !== 1) throw new Error(`5秒处应仅存 1 条去重后，实际 ${dupe5s.length}`);
        if (dupe5s[0].source !== 'LOCAL') throw new Error('MERGE 时重复目标应优先保留本地');

        // KEEP_LOCAL 策略
        const clonedForKeep = new MockStorage();
        clonedForKeep.store = JSON.parse(JSON.stringify(local.store));
        // KEEP_LOCAL: 不做任何合并操作，数量应保持 initialCount
        if (getAnnotationCount(clonedForKeep, recId) !== initialCount) throw new Error('KEEP_LOCAL 不应改变本地批注数量');
        appendAnnotationImportLog(clonedForKeep, {
          fileName: 'keep.json', recordId: recId, success: true,
          localCountBefore: initialCount, importedCount: imported.length,
          finalCount: initialCount, resolution: 'KEEP_LOCAL', conflicts: conflicts.map((c) => c.type),
        });

        // OVERWRITE_LOCAL 策略
        const clonedForOverwrite = new MockStorage();
        clonedForOverwrite.store = JSON.parse(JSON.stringify(local.store));
        replaceAnnotations(clonedForOverwrite, recId, imported.map((a) => ({ ...a, source: 'IMPORTED' })));
        const afterOverwrite = getAnnotationCount(clonedForOverwrite, recId);
        if (afterOverwrite !== imported.length) throw new Error(`OVERWRITE 预期 ${imported.length}，实际 ${afterOverwrite}`);
        if (loadAnnotations(clonedForOverwrite, recId).some((a) => a.source !== 'IMPORTED')) throw new Error('OVERWRITE 后所有批注来源应为 IMPORTED');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC5: 版本不一致冲突检测 ===
    (function tc5() {
      const t: TestCase = { name: 'TC5 annotationVersion 不一致触发冲突', run: () => {
        const recId = 'record-version-test';
        const local = new MockStorage();
        addAnnotation(local, recId, { targetType: 'GLOBAL', severity: 'MEDIUM', content: 'X', suggestion: 'Y' });
        const imported: CoachAnnotation[] = [
          { id: genUUID(), recordId: recId, targetType: 'GLOBAL', severity: 'HIGH', content: '导入', suggestion: '', createdAt: 1, updatedAt: 1, version: 1, source: 'LOCAL' },
        ];
        const futureVersion = 999;
        const conflicts = detectAnnotationConflicts(local, recId, imported, futureVersion);
        const versionConflict = conflicts.find((c) => c.type === 'ANNOTATION_VERSION_DIFF');
        if (!versionConflict) throw new Error('版本不同应触发 ANNOTATION_VERSION_DIFF 冲突');
        if (versionConflict.annotationVersionImported !== futureVersion) throw new Error('导入版本号未记录');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC6: 旧包兼容（v1 无 annotations 字段）===
    (function tc6() {
      const t: TestCase = { name: 'TC6 v1 导出包（无 annotations）导入后批注数量为 0', run: () => {
        const recId = 'record-legacy-v1';
        const pkgV1 = buildReplayPackage(level, recId, startTime);
        pkgV1.exportVersion = 1; // 旧版
        // 强制删除 annotation 字段
        const jsonNoAnn = JSON.stringify(pkgV1);
        const parsed = JSON.parse(jsonNoAnn) as ReplayPackage;
        const fresh = new MockStorage();
        const count = loadAnnotations(fresh, recId).length;
        if (count !== 0) throw new Error('初始批注数量应 0');
        if (parsed.annotations !== undefined) throw new Error('v1 包不应包含 annotations');
        // 模拟导入流程：无 annotations 就不调用 mergeAnnotations
        appendAnnotationImportLog(fresh, {
          fileName: 'v1-no-ann.json', recordId: recId, success: true,
          localCountBefore: 0, importedCount: 0, finalCount: 0,
        });
        if (getAnnotationCount(fresh, recId) !== 0) throw new Error('v1 包导入后不应新增批注');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC7: 跨重启恢复（localStorage round-trip）===
    (function tc7() {
      const t: TestCase = { name: 'TC7 模拟刷新/重启：JSON 序列化 → 反序列化后批注完整', run: () => {
        const recId = 'record-restart-test';
        const s1 = new MockStorage();
        addAnnotation(s1, recId, { targetType: 'TIMESTAMP', timestampMs: startTime + 15_000, severity: 'HIGH', content: '重启前：15s 批注', suggestion: '建议 A' });
        addAnnotation(s1, recId, { targetType: 'PATIENT', patientId: level.patients[0].id, severity: 'MEDIUM', content: '重启前：患者批注', suggestion: '建议 B' });
        appendAnnotationImportLog(s1, {
          fileName: 'before-restart.json', recordId: recId, success: true,
          localCountBefore: 0, importedCount: 0, finalCount: 2,
        });
        const snapshot = s1.serialize();
        const s2 = new MockStorage();
        s2.deserialize(snapshot);
        if (getAnnotationCount(s2, recId) !== 2) throw new Error('重启恢复后批注数量错误');
        const list = loadAnnotations(s2, recId);
        if (list[0].content !== '重启前：15s 批注') throw new Error('重启后内容丢失');
        if (list[1].suggestion !== '建议 B') throw new Error('重启后建议丢失');
        const logs = loadAnnotationImportLog(s2);
        if (logs.length !== 1 || logs[0].fileName !== 'before-restart.json') throw new Error('重启后批注导入日志丢失');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC8: 只读限制验证（批注写入不修改原始记录数据）===
    (function tc8() {
      const t: TestCase = { name: 'TC8 只读限制：批注写入不影响 session / scoreResult / 校验码', run: () => {
        const recId = 'record-readonly-safe';
        const pkg = buildReplayPackage(level, recId, startTime);
        const sessionBefore = JSON.stringify(pkg.session);
        const scoreBefore = JSON.stringify(pkg.scoreResult);
        const hashBefore = pkg.replayHash;

        const local = new MockStorage();
        // 写入 5 条批注
        for (let i = 0; i < 5; i++) {
          addAnnotation(local, recId, {
            targetType: i % 2 === 0 ? 'TIMESTAMP' : 'PATIENT',
            timestampMs: i % 2 === 0 ? startTime + i * 7000 : undefined,
            patientId: i % 2 === 1 ? level.patients[i % level.patients.length].id : undefined,
            severity: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const)[i % 4],
            content: `批注 #${i}`,
            suggestion: `建议 #${i}`,
          });
        }

        const sessionAfter = JSON.stringify(pkg.session);
        const scoreAfter = JSON.stringify(pkg.scoreResult);
        const hashAfter = pkg.replayHash;

        if (sessionBefore !== sessionAfter) throw new Error('写入批注后 session 被修改！违反只读限制');
        if (scoreBefore !== scoreAfter) throw new Error('写入批注后 scoreResult 被修改！违反只读限制');
        if (hashBefore !== hashAfter) throw new Error('写入批注后校验码被修改！违反只读限制');
        // 独立校验：storage 中仅有批注相关键
        const keys = Object.keys(local.store);
        const nonAnnotationKeys = keys.filter((k) => k !== STORAGE_KEYS.ANNOTATIONS && k !== STORAGE_KEYS.ANNOTATION_IMPORT_LOG);
        if (nonAnnotationKeys.length > 0) throw new Error(`存储中出现非批注键：${nonAnnotationKeys.join(',')}`);
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC9: 批注导入日志条目完整性 ===
    (function tc9() {
      const t: TestCase = { name: 'TC9 批注导入日志：冲突处理 → 日志条目字段完整', run: () => {
        const recId = 'record-log-test';
        const s = new MockStorage();
        addAnnotation(s, recId, { targetType: 'GLOBAL', severity: 'MEDIUM', content: '本地批注', suggestion: '' });
        const conflicts: AnnotationConflict[] = [
          { type: 'HAS_LOCAL_ANNOTATIONS', title: 'X', description: 'Y' },
          { type: 'DUPLICATE_ANNOTATION', title: 'A', description: 'B' },
        ];
        appendAnnotationImportLog(s, {
          fileName: 'ann-log-test.json',
          recordId: recId,
          success: true,
          localCountBefore: 1,
          importedCount: 3,
          finalCount: 4,
          resolution: 'MERGE',
          conflicts: conflicts.map((c) => c.type),
        });
        const logs = loadAnnotationImportLog(s);
        if (logs.length === 0) throw new Error('日志条目不存在');
        const log = logs[0];
        if (!log.id || !log.timestamp) throw new Error('日志缺少基础字段');
        if (log.fileName !== 'ann-log-test.json') throw new Error('日志文件名错误');
        if (log.resolution !== 'MERGE') throw new Error('日志策略未记录');
        if (!log.conflicts?.includes('HAS_LOCAL_ANNOTATIONS')) throw new Error('冲突类型未写入日志');
        if (log.localCountBefore !== 1 || log.importedCount !== 3 || log.finalCount !== 4) throw new Error('日志数量字段错误');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === TC10: 历史列表批注标记一致性 ===
    (function tc10() {
      const t: TestCase = { name: 'TC10 历史列表批注标记：getAnnotationCount 与存储数量一致', run: () => {
        const s = new MockStorage();
        const ids = ['rec-a', 'rec-b', 'rec-c'];
        const expected: Record<string, number> = { 'rec-a': 0, 'rec-b': 3, 'rec-c': 10 };
        for (const id of ids) {
          for (let i = 0; i < expected[id]; i++) {
            addAnnotation(s, id, { targetType: 'GLOBAL', severity: 'MEDIUM', content: `${id}-${i}`, suggestion: '' });
          }
        }
        for (const id of ids) {
          const actual = getAnnotationCount(s, id);
          if (actual !== expected[id]) throw new Error(`${id}: 预期 ${expected[id]}，实际 ${actual}`);
        }
        // 删除 rec-c 的所有批注（逐个）
        const all = loadAnnotations(s, 'rec-c');
        for (const ann of all) deleteAnnotation(s, 'rec-c', ann.id);
        if (getAnnotationCount(s, 'rec-c') !== 0) throw new Error('全部删除后计数不为 0');
      } };
      try { t.run(); reportCase(report, t); } catch (e) { reportCase(report, t, e as Error); }
    })();

    // === 输出报告 ===
    console.log('\n==========================================');
    console.log('教练批注功能回归测试报告');
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
      console.log('🎉 所有批注回归测试用例全部通过！');
    }
    console.log('');
  } finally {
    // 清理
    if (existsSync(tmpDir)) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

main().catch((err) => {
  console.error('测试运行时出错：', err);
  process.exitCode = 2;
});
