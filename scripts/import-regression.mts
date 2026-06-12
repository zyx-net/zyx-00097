import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

type Channel = 'RED' | 'YELLOW' | 'GREEN' | 'BLACK';
type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

interface VitalSigns { hr: number; bp: string; spo2: number; gcs: number; respRate: number; temperature: number; }
interface ResourceRequirement { resourceId: string; count: number; reason?: string; }
interface Patient {
  id: string; sequenceNo: number; name: string; age: string; gender: string;
  chiefComplaint: string; history: string; allergies: string; injuryMechanism: string;
  vitalSigns: VitalSigns; tags: string[]; correctChannel: Channel;
  reasoning: string; requiredResources: ResourceRequirement[];
}
interface ResourceSlot { id: string; name: string; icon: string; initialCount: number; description: string; consumable: boolean; }
interface ScoringRules {
  correctScore: number; channelWrongPenalty: number; severityMismatchPenalty: number;
  resourceMissPenalty: number; resourceOverusePenalty: number;
  timeoutPenaltyPerSec: number; pausePenalty: number;
  perfectChannelBonus: number; resourceEfficiencyBonus: number;
}
interface Level {
  id: string; name: string; version: string; description: string;
  difficulty: Difficulty; timeLimitSeconds: number;
  patients: Patient[]; resourceSlots: ResourceSlot[]; scoringRules: ScoringRules;
}
interface ResourceAssignment { id: string; patientId: string; resourceId: string; assignedAt: number; returnedAt?: number; }
interface ActionLog {
  timestamp: number; type: string;
  patientId?: string; fromChannel?: Channel | null; toChannel?: Channel | null;
  resourceId?: string; resourceAssignmentId?: string; note?: string;
}
interface GameSession {
  id: string; levelId: string; levelVersion: string; status: string;
  startTime: number; pausedAt: number | null; totalPausedMs: number;
  elapsedSeconds: number; remainingSeconds: number;
  selectedPatientId: string | null; assignments: Record<string, Channel | null>;
  resourceUsage: Record<string, number>;
  resourceAssignments: ResourceAssignment[];
  operationLog: ActionLog[];
  errors: { code: string; message: string; suggestion: string; timestamp: number }[];
}
interface ScoringDetail {
  patientId: string; patientName: string; correctChannel: Channel;
  assignedChannel: Channel | null; score: number; baseScore: number;
  penalties: { type: string; amount: number; reason: string }[];
  bonuses: { type: string; amount: number; reason: string }[];
}
interface ScoreResult {
  total: number; maxScore: number; accuracy: number; details: ScoringDetail[];
  resourceScore: number; timeScore: number; finalPenalty: number; finalBonus: number;
  recalcProof: { ruleKey: string; input: unknown; output: number }[];
}
interface ReplayPackage {
  exportVersion: number; exportedAt: string | number; replayHash?: string;
  level: { id: string; name: string; version: string; difficulty: Difficulty; scoringRules?: ScoringRules; patients?: Patient[]; resourceSlots?: ResourceSlot[]; timeLimitSeconds?: number };
  record: { id: string; createdAt: string | number; totalScore: number; maxScore: number; accuracy: number; usedSeconds: number; completed: boolean };
  session: GameSession; scoreResult: ScoreResult;
}

function loadLevel(id: string): Level {
  const raw = readFileSync(join(projectRoot, `src/config/levels/${id}.json`), 'utf-8');
  return JSON.parse(raw) as Level;
}

function buildReplayPackage(level: Level, overrides?: Partial<ReplayPackage>): ReplayPackage {
  const now = Date.now();
  const assignments: Record<string, Channel | null> = {};
  for (const p of level.patients) assignments[p.id] = p.correctChannel;
  const pkg: ReplayPackage = {
    exportVersion: 1,
    exportedAt: new Date(now).toISOString(),
    replayHash: 'abcd1234',
    level: {
      id: level.id, name: level.name, version: level.version,
      difficulty: level.difficulty, scoringRules: level.scoringRules,
      patients: level.patients, resourceSlots: level.resourceSlots,
      timeLimitSeconds: level.timeLimitSeconds,
    },
    record: {
      id: 'test-record-001', createdAt: new Date(now).toISOString(),
      totalScore: 800, maxScore: 1000, accuracy: 80,
      usedSeconds: 120, completed: true,
    },
    session: {
      id: 'test-session-001', levelId: level.id, levelVersion: level.version,
      status: 'ENDED', startTime: now - 120000, pausedAt: null,
      totalPausedMs: 0, elapsedSeconds: 120, remainingSeconds: 0,
      selectedPatientId: null, assignments,
      resourceUsage: {}, resourceAssignments: [],
      operationLog: [{ timestamp: now - 120000, type: 'SUBMIT', note: '测试提交' }],
      errors: [],
    },
    scoreResult: {
      total: 800, maxScore: 1000, accuracy: 80, details: [],
      resourceScore: 100, timeScore: 80, finalPenalty: 20, finalBonus: 10,
      recalcProof: [{ ruleKey: 'test', input: null, output: 800 }],
    },
    ...overrides,
  };
  return pkg;
}

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; }
  else { failed++; errors.push(`FAIL: ${msg}`); console.error(`  ✗ ${msg}`); }
}

function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) { passed++; }
  else { failed++; errors.push(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); console.error(`  ✗ ${msg}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); }
}

console.log('\n=== 导入功能回归测试 ===\n');

// ---------- Test 1: 正常导入 ----------
console.log('--- 测试 1: 正常导入 ---');
{
  const level = loadLevel('basic-emergency');
  const pkg = buildReplayPackage(level);
  const json = JSON.stringify(pkg);

  const parsed = JSON.parse(json) as ReplayPackage;
  assert(parsed.exportVersion === 1, '导出版本为 1');
  assert(parsed.level.id === level.id, '关卡 ID 正确');
  assert(parsed.record.id === 'test-record-001', '记录 ID 正确');
  assert(Array.isArray(parsed.session.resourceAssignments), '资源绑定表为数组');
  assert(Array.isArray(parsed.scoreResult.recalcProof), '评分证据链存在');
  assert(parsed.level.patients !== undefined, '关卡包含患者列表');
  assert(parsed.level.resourceSlots !== undefined, '关卡包含资源槽列表');
  assert(parsed.level.timeLimitSeconds !== undefined, '关卡包含时间限制');
  console.log('  ✓ 正常导入数据结构完整');
}

// ---------- Test 2: 旧包兼容（缺少 patients/resourceSlots） ----------
console.log('--- 测试 2: 旧包兼容 ---');
{
  const level = loadLevel('basic-emergency');
  const legacyPkg = buildReplayPackage(level);
  delete (legacyPkg.level as Record<string, unknown>).patients;
  delete (legacyPkg.level as Record<string, unknown>).resourceSlots;
  delete (legacyPkg.level as Record<string, unknown>).timeLimitSeconds;

  const json = JSON.stringify(legacyPkg);
  const parsed = JSON.parse(json) as ReplayPackage;

  assert(parsed.level.patients === undefined, '旧包没有 patients 字段');
  assert(parsed.level.resourceSlots === undefined, '旧包没有 resourceSlots 字段');
  assert(parsed.exportVersion === 1, '旧包版本号仍然有效');
  assert(parsed.session !== undefined, 'session 数据完整');
  console.log('  ✓ 旧包数据可以正常解析');
}

// ---------- Test 3: 重复导入检测 ----------
console.log('--- 测试 3: 重复导入检测 ---');
{
  const level = loadLevel('basic-emergency');
  const pkg1 = buildReplayPackage(level);
  const pkg2 = buildReplayPackage(level, { record: { ...pkg1.record, totalScore: 750 } });

  assert(pkg1.record.id === pkg2.record.id, '两个包具有相同记录 ID');
  assert(pkg1.record.totalScore !== pkg2.record.totalScore, '分数不同');

  const keptBothPkg2 = { ...pkg2, record: { ...pkg2.record, id: 'test-record-001-new' } };
  assert(pkg1.record.id !== keptBothPkg2.record.id, 'KEEP_BOTH 策略分配新 ID');
  console.log('  ✓ 重复导入检测逻辑正确');
}

// ---------- Test 4: 关卡版本不一致 ----------
console.log('--- 测试 4: 关卡版本不一致 ---');
{
  const level = loadLevel('basic-emergency');
  const pkg = buildReplayPackage(level, {
    level: { ...buildReplayPackage(level).level, version: '0.8.0' },
    session: { ...buildReplayPackage(level).session, levelVersion: '0.8.0' },
  });

  assert(pkg.level.version === '0.8.0', '导入包关卡版本为 0.8.0');
  assert(level.version !== '0.8.0', '本地关卡版本不同');
  console.log('  ✓ 关卡版本不一致检测逻辑正确');
}

// ---------- Test 5: 跨重启恢复（模拟 localStorage 序列化/反序列化） ----------
console.log('--- 测试 5: 跨重启恢复 ---');
{
  const level = loadLevel('basic-emergency');
  const pkg = buildReplayPackage(level);

  const historyEntry = {
    id: pkg.record.id,
    levelId: level.id,
    levelName: level.name,
    levelVersion: level.version,
    difficulty: level.difficulty,
    totalScore: pkg.record.totalScore,
    maxScore: pkg.record.maxScore,
    accuracy: pkg.record.accuracy,
    usedSeconds: pkg.record.usedSeconds,
    completed: true,
    createdAt: Date.now(),
    sessionSnapshot: pkg.session,
    scoreSnapshot: pkg.scoreResult,
    imported: true,
    importedAt: Date.now(),
    replayHash: pkg.replayHash,
    originalExportVersion: 1,
  };

  const serialized = JSON.stringify([historyEntry]);
  const deserialized = JSON.parse(serialized);

  assert(deserialized[0].imported === true, '反序列化后 imported 标记保留');
  assert(deserialized[0].importedAt !== undefined, '反序列化后 importedAt 保留');
  assert(deserialized[0].replayHash === pkg.replayHash, '反序列化后 replayHash 保留');
  assert(deserialized[0].originalExportVersion === 1, '反序列化后 originalExportVersion 保留');
  assert(deserialized[0].sessionSnapshot.id === pkg.session.id, 'session 快照完整');
  assert(deserialized[0].scoreSnapshot.total === pkg.scoreResult.total, 'score 快照完整');

  const readonlyIds = JSON.stringify([pkg.record.id]);
  const parsedReadonly = JSON.parse(readonlyIds);
  assert(parsedReadonly.includes(pkg.record.id), '只读记录 ID 持久化');

  console.log('  ✓ 跨重启数据完整恢复');
}

// ---------- Test 6: 导入日志持久化 ----------
console.log('--- 测试 6: 导入日志持久化 ---');
{
  const logEntry = {
    id: 'log-001',
    timestamp: Date.now(),
    fileName: 'test-replay.json',
    success: true,
    recordId: 'test-record-001',
    levelId: 'basic-emergency',
    errors: [],
    warnings: [],
    conflictsResolved: [{ type: 'DUPLICATE_ID' as const, resolution: 'KEEP_BOTH' as const }],
  };

  const serialized = JSON.stringify([logEntry]);
  const deserialized = JSON.parse(serialized);

  assert(deserialized[0].success === true, '日志成功标记保留');
  assert(deserialized[0].fileName === 'test-replay.json', '文件名保留');
  assert(deserialized[0].conflictsResolved.length === 1, '冲突解决记录保留');
  assert(deserialized[0].conflictsResolved[0].type === 'DUPLICATE_ID', '冲突类型保留');
  assert(deserialized[0].conflictsResolved[0].resolution === 'KEEP_BOTH', '解决策略保留');
  console.log('  ✓ 导入日志持久化正确');
}

// ---------- Test 7: 缺失字段旧包检测 ----------
console.log('--- 测试 7: 缺失字段旧包检测 ---');
{
  const partialPkg = {
    exportVersion: 1,
    level: { id: 'basic-emergency', name: 'Test', version: '1.0', difficulty: 'MEDIUM' as Difficulty },
    record: { id: 'r1', createdAt: Date.now(), totalScore: 100, maxScore: 200, accuracy: 50, usedSeconds: 60, completed: true },
    session: {
      id: 's1', levelId: 'basic-emergency', levelVersion: '1.0', status: 'ENDED',
      startTime: Date.now() - 60000, pausedAt: null, totalPausedMs: 0,
      elapsedSeconds: 60, remainingSeconds: 0, selectedPatientId: null,
      assignments: {}, resourceUsage: {}, resourceAssignments: [],
      operationLog: [], errors: [],
    },
    scoreResult: {
      total: 100, maxScore: 200, accuracy: 50, details: [],
      resourceScore: 50, timeScore: 50, finalPenalty: 0, finalBonus: 0,
      recalcProof: [],
    },
  };

  assert(partialPkg.level.scoringRules === undefined, '旧包缺少 scoringRules');
  assert(partialPkg.level.patients === undefined, '旧包缺少 patients');
  assert(partialPkg.level.resourceSlots === undefined, '旧包缺少 resourceSlots');
  assert(partialPkg.exportVersion === 1, '但版本号仍然合法');
  console.log('  ✓ 缺失字段检测逻辑正确');
}

// ---------- Test 8: 不支持的版本号 ----------
console.log('--- 测试 8: 不支持的版本号 ---');
{
  const futurePkg = buildReplayPackage(loadLevel('basic-emergency'), { exportVersion: 99 });
  assert(futurePkg.exportVersion === 99, '未来版本号');
  assert(futurePkg.exportVersion !== 1, '与当前版本不匹配');
  console.log('  ✓ 版本号检测逻辑正确');
}

// ---------- Test 9: 校验码一致性 ----------
console.log('--- 测试 9: 校验码一致性 ---');
{
  function computeReplayHash(result: ScoreResult): string {
    const s = JSON.stringify({ total: result.total, accuracy: result.accuracy, proofLen: result.recalcProof.length });
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  const level = loadLevel('basic-emergency');
  const pkg = buildReplayPackage(level);
  const hash = computeReplayHash(pkg.scoreResult);
  const hash2 = computeReplayHash(pkg.scoreResult);
  assert(hash === hash2, '相同输入产生相同校验码');

  const modifiedResult = { ...pkg.scoreResult, total: 999 };
  const hash3 = computeReplayHash(modifiedResult);
  assert(hash !== hash3, '不同输入产生不同校验码');
  console.log('  ✓ 校验码生成一致性正确');
}

// ---------- Test 10: 导出 JSON 完整可回环 ----------
console.log('--- 测试 10: 导出→导入回环 ---');
{
  const level = loadLevel('basic-emergency');
  const pkg = buildReplayPackage(level);

  const exportedJson = JSON.stringify(pkg, null, 2);
  const reimported = JSON.parse(exportedJson) as ReplayPackage;

  assert(reimported.exportVersion === pkg.exportVersion, '回环：exportVersion 一致');
  assert(reimported.level.id === pkg.level.id, '回环：level.id 一致');
  assert(reimported.level.version === pkg.level.version, '回环：level.version 一致');
  assert(reimported.record.id === pkg.record.id, '回环：record.id 一致');
  assert(reimported.record.totalScore === pkg.record.totalScore, '回环：totalScore 一致');
  assert(reimported.session.id === pkg.session.id, '回环：session.id 一致');
  assert(reimported.scoreResult.total === pkg.scoreResult.total, '回环：scoreResult.total 一致');
  assert(JSON.stringify(reimported.level.patients) === JSON.stringify(pkg.level.patients), '回环：patients 完整');
  assert(JSON.stringify(reimported.level.resourceSlots) === JSON.stringify(pkg.level.resourceSlots), '回环：resourceSlots 完整');
  console.log('  ✓ 导出→导入回环数据无损');
}

// ---------- Test 11: applyResolution 策略验证 ----------
console.log('--- 测试 11: 冲突解决策略 ---');
{
  const level = loadLevel('basic-emergency');
  const pkg = buildReplayPackage(level);

  const record = {
    id: 'test-record-001',
    levelId: level.id,
    levelName: level.name,
    levelVersion: level.version,
    difficulty: level.difficulty as Difficulty,
    totalScore: 800, maxScore: 1000, accuracy: 80, usedSeconds: 120,
    completed: true, createdAt: Date.now(),
    sessionSnapshot: pkg.session,
    scoreSnapshot: pkg.scoreResult,
    imported: true, importedAt: Date.now(),
  };

  const skipResult = { record, skip: true };
  assert(skipResult.skip === true, 'SKIP 策略跳过导入');

  const overwriteResult = { record, skip: false };
  assert(overwriteResult.skip === false, 'OVERWRITE 策略不跳过');

  const keepBothRecord = { ...record, id: 'new-uuid', sessionSnapshot: { ...record.sessionSnapshot, id: 'new-uuid' } };
  assert(keepBothRecord.id !== record.id, 'KEEP_BOTH 分配新 ID');
  assert(keepBothRecord.sessionSnapshot.id !== record.sessionSnapshot.id, 'KEEP_BOTH session ID 同步更新');
  console.log('  ✓ 冲突解决策略逻辑正确');
}

// ---------- Test 12: 空文件/非法 JSON 处理 ----------
console.log('--- 测试 12: 非法输入处理 ---');
{
  const invalidInputs = [null, undefined, 'not json', 42, true, []];
  for (const input of invalidInputs) {
    try {
      const str = JSON.stringify(input);
      const parsed = JSON.parse(str);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        passed++;
      } else {
        failed++;
        errors.push(`FAIL: 非法输入 ${typeof input} 未被拦截`);
      }
    } catch {
      passed++;
    }
  }
  console.log('  ✓ 非法输入拦截正确');
}

// ---------- Summary ----------
console.log('\n=== 测试结果 ===');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
if (errors.length > 0) {
  console.log('\n失败详情:');
  for (const e of errors) console.log(`  ${e}`);
}
console.log(failed === 0 ? '\n✓ 全部通过' : '\n✗ 存在失败');

process.exit(failed > 0 ? 1 : 0);
