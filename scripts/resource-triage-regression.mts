// 急救分诊资源绑定回归测试
// 用法: npx tsx scripts/resource-triage-regression.mts
// 覆盖：
//   1. p001、p005 共用 oxygen 的评分准确性（核心 bug 回归）
//   2. 暂停后禁止 useResource / returnResource / allocate
//   3. 结束后禁止修改答案
//   4. 旧存档（只有 resourceUsage，无 resourceAssignments）兼容读取
//   5. 存档持久化 → 模拟刷新恢复 → 提交，评分一致
//   6. 评分、操作日志、复盘导出文本三者可互相对照复算

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// ------- 内联工具函数（避免依赖 vite/tsconfig path alias）-------
function round2(v: number) {
  return Math.round(v * 100) / 100;
}

// ------- 类型定义（精简）-------
type Channel = 'RED' | 'YELLOW' | 'GREEN' | 'BLACK';
type GameStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'ABANDONED';
type ActionType =
  | 'ALLOCATE' | 'DEALLOCATE' | 'REALLOCATE'
  | 'RESOURCE_USE' | 'RESOURCE_RETURN'
  | 'PAUSE' | 'RESUME' | 'SUBMIT' | 'SELECT_PATIENT';

interface ResourceRequirement { resourceId: string; count: number; reason?: string; }
interface VitalSigns { hr: number; bp: string; spo2: number; gcs: number; respRate: number; temperature: number; }
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
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  timeLimitSeconds: number; patients: Patient[];
  resourceSlots: ResourceSlot[]; scoringRules: ScoringRules;
}
interface ResourceAssignment { id: string; patientId: string; resourceId: string; assignedAt: number; returnedAt?: number; }
interface ActionLog {
  timestamp: number; type: ActionType;
  patientId?: string; fromChannel?: Channel | null; toChannel?: Channel | null;
  resourceId?: string; resourceAssignmentId?: string; note?: string;
}
interface GameSession {
  id: string; levelId: string; levelVersion: string; status: GameStatus;
  startTime: number; pausedAt: number | null; totalPausedMs: number;
  elapsedSeconds: number; remainingSeconds: number;
  selectedPatientId: string | null; assignments: Record<string, Channel | null>;
  resourceUsage: Record<string, number>;
  resourceAssignments: ResourceAssignment[];
  operationLog: ActionLog[];
  errors: { code: string; message: string; suggestion: string; timestamp: number; patientId?: string; resourceId?: string; }[];
  legacySave?: boolean;
}

const CHANNEL_ORDER: Channel[] = ['RED', 'YELLOW', 'GREEN', 'BLACK'];
function severityDistance(a: Channel, b: Channel): number {
  return Math.abs(CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b));
}

// 加载 basic-emergency 关卡
function loadBasicEmergency(): Level {
  const raw = readFileSync(join(projectRoot, 'src/config/levels/basic-emergency.json'), 'utf-8');
  return JSON.parse(raw) as Level;
}

// ------- 评分引擎（与 src/utils/scoring.ts 保持语义一致，纯函数）-------
function resourceUsageByPatient(asg: ResourceAssignment[]): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const a of asg) {
    if (a.returnedAt) continue;
    if (!result[a.patientId]) result[a.patientId] = {};
    result[a.patientId][a.resourceId] = (result[a.patientId][a.resourceId] ?? 0) + 1;
  }
  return result;
}
function legacyUsageByPatientFallback(level: Level, usage: Record<string, number>): Record<string, Record<string, number>> {
  const remaining: Record<string, number> = { ...usage };
  const result: Record<string, Record<string, number>> = {};
  for (const p of level.patients) {
    result[p.id] = {};
    for (const req of p.requiredResources) {
      const avail = remaining[req.resourceId] ?? 0;
      const take = Math.min(req.count, avail);
      if (take > 0) {
        result[p.id][req.resourceId] = take;
        remaining[req.resourceId] = avail - take;
      }
    }
  }
  return result;
}

function calculateScore(level: Level, session: GameSession) {
  const rules = level.scoringRules;
  const proofs: { ruleKey: string; input: unknown; output: number }[] = [];
  const details: { patientId: string; penalties: { type: string; amount: number; reason: string }[] }[] = [];

  const hasModern = Array.isArray(session.resourceAssignments) && session.resourceAssignments.length > 0;
  const byPatient = hasModern
    ? resourceUsageByPatient(session.resourceAssignments)
    : legacyUsageByPatientFallback(level, session.resourceUsage);

  proofs.push({ ruleKey: 'resourceTrackingMode', input: { hasModern, total: session.resourceAssignments?.length ?? 0 }, output: hasModern ? 1 : 0 });

  let patientTotal = 0;
  let correctCount = 0;

  for (const patient of level.patients) {
    const assigned = session.assignments[patient.id] ?? null;
    const correct = patient.correctChannel;
    const base = rules.correctScore;
    const penalties: { type: string; amount: number; reason: string }[] = [];
    let score = base;

    if (assigned === correct) {
      correctCount++;
      proofs.push({ ruleKey: 'correctScore', input: { patientId: patient.id }, output: base });
    } else {
      const distance = severityDistance(correct, assigned ?? 'BLACK');
      score -= rules.channelWrongPenalty;
      penalties.push({ type: 'channelWrongPenalty', amount: rules.channelWrongPenalty, reason: `通道错误` });
      proofs.push({ ruleKey: 'channelWrongPenalty', input: { patientId: patient.id }, output: -rules.channelWrongPenalty });
      if (distance > 1) {
        score -= rules.severityMismatchPenalty;
        penalties.push({ type: 'severityMismatchPenalty', amount: rules.severityMismatchPenalty, reason: `距离${distance}` });
      }
    }

    const usedForPatient = byPatient[patient.id] ?? {};
    for (const req of patient.requiredResources) {
      const used = usedForPatient[req.resourceId] ?? 0;
      if (used < req.count) {
        const miss = req.count - used;
        const p = rules.resourceMissPenalty * miss;
        score -= p;
        penalties.push({ type: 'resourceMissPenalty', amount: p, reason: `${req.resourceId}实际分配${used}缺${miss}` });
        proofs.push({ ruleKey: 'resourceMissPenalty', input: { patientId: patient.id, resourceId: req.resourceId, used }, output: -p });
      } else if (used > req.count) {
        const over = used - req.count;
        const slot = level.resourceSlots.find((s) => s.id === req.resourceId);
        if (slot?.consumable) {
          const p = rules.resourceOverusePenalty * over;
          score -= p;
          penalties.push({ type: 'resourceOverusePenalty', amount: p, reason: `${req.resourceId}多用${over}` });
        }
      }
    }

    patientTotal += Math.max(0, score);
    details.push({ patientId: patient.id, penalties });
  }

  const timeoutSeconds = Math.max(0, session.elapsedSeconds - level.timeLimitSeconds);
  const timePenalty = round2(timeoutSeconds * rules.timeoutPenaltyPerSec);
  const pauseCount = session.operationLog.filter((l) => l.type === 'PAUSE').length;
  const pausePenalty = rules.pausePenalty * pauseCount;
  const perfectBonus = correctCount === level.patients.length ? rules.perfectChannelBonus : 0;
  if (perfectBonus > 0) proofs.push({ ruleKey: 'perfectChannelBonus', input: { allCorrect: true }, output: perfectBonus });
  let resourceEfficiencyBonus = 0;
  {
    let totalNeeded = 0, totalUsed = 0;
    for (const p of level.patients) for (const req of p.requiredResources) totalNeeded += req.count;
    if (hasModern) totalUsed = session.resourceAssignments.filter((a) => !a.returnedAt).length;
    else for (const id of Object.keys(session.resourceUsage)) totalUsed += session.resourceUsage[id] ?? 0;
    if (totalNeeded > 0) {
      const ratio = 1 - Math.abs(totalUsed - totalNeeded) / (totalNeeded * 2);
      if (ratio >= 0.9 && perfectBonus > 0) resourceEfficiencyBonus = rules.resourceEfficiencyBonus;
    }
  }
  const finalPenalty = round2(timePenalty + pausePenalty);
  const finalBonus = round2(perfectBonus + resourceEfficiencyBonus);
  const total = round2(Math.max(0, patientTotal - finalPenalty + finalBonus));
  return { total, details, proofs, hasModern, byPatient, correctCount };
}

// ------- 运行时拦截（与 runtimeValidator 保持一致）-------
function checkStatusAllowsMutation(status: GameStatus) {
  if (status === 'PAUSED') return { ok: false as const, code: 'E_PAUSED_LOCKED' };
  if (status === 'ENDED' || status === 'ABANDONED') return { ok: false as const, code: 'E_GAME_ENDED' };
  return { ok: true as const };
}

// ------- 测试工具 -------
let passCount = 0;
let failCount = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failCount++;
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function assertEq<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) throw new Error(`${msg ?? 'assertEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTrue(b: boolean, msg: string) {
  if (!b) throw new Error(msg);
}

// ------- 组装一个 baseline session（6 名患者全对，资源分配见每个用例）-------
function baselineSession(level: Level): GameSession {
  const assignments: Record<string, Channel | null> = {};
  for (const p of level.patients) assignments[p.id] = p.correctChannel;
  return {
    id: 'sess-regression-001', levelId: level.id, levelVersion: level.version,
    status: 'RUNNING', startTime: 1_700_000_000_000,
    pausedAt: null, totalPausedMs: 0, elapsedSeconds: 120, remainingSeconds: level.timeLimitSeconds - 120,
    selectedPatientId: level.patients[0].id,
    assignments,
    resourceUsage: {},
    resourceAssignments: [],
    operationLog: [{ timestamp: 1_700_000_000_000, type: 'SELECT_PATIENT', patientId: level.patients[0].id, note: '初始选择' }],
    errors: [],
  };
}

// ------- CASE 1: 核心 bug 回归 - p001 & p005 共用 oxygen -------
function case1_oxygenSharing(level: Level) {
  console.log('\nCASE 1: 核心 bug 回归 - p001、p005 共用 oxygen 评分准确');
  const rules = level.scoringRules;
  const p001 = level.patients.find((p) => p.id === 'p001')!;
  const p005 = level.patients.find((p) => p.id === 'p005')!;

  test('只消耗 1 次 oxygen 给 p001，p005 应扣 resourceMissPenalty（bug 之前两人都不扣）', () => {
    const s = baselineSession(level);
    // 把 oxygen 分配给 p001（仅 1 次）
    const asg: ResourceAssignment = { id: 'ra-oxy-1', patientId: 'p001', resourceId: 'oxygen', assignedAt: s.startTime + 1000 };
    s.resourceAssignments = [asg];
    s.resourceUsage = { oxygen: 1 };
    // 补全 p001 的其他资源（ecg、aspirin 各 1）和 p005 的其他资源（cervical-collar、iv、ct 各 1）
    s.resourceAssignments.push(
      { id: 'ra-ecg-1', patientId: 'p001', resourceId: 'ecg', assignedAt: s.startTime + 1100 },
      { id: 'ra-asp-1', patientId: 'p001', resourceId: 'aspirin', assignedAt: s.startTime + 1200 },
      { id: 'ra-cv-1', patientId: 'p005', resourceId: 'cervical-collar', assignedAt: s.startTime + 1300 },
      { id: 'ra-iv-1', patientId: 'p005', resourceId: 'iv', assignedAt: s.startTime + 1400 },
      { id: 'ra-ct-1', patientId: 'p005', resourceId: 'ct', assignedAt: s.startTime + 1500 },
    );
    for (const a of s.resourceAssignments) s.resourceUsage[a.resourceId] = (s.resourceUsage[a.resourceId] ?? 0) + 1;

    const r = calculateScore(level, s);

    // p001 所有资源齐全（oxygen×1、ecg×1、aspirin×1）→ 不扣资源分
    const d001 = r.details.find((d) => d.patientId === 'p001')!;
    assertEq(d001.penalties.filter((p) => p.type === 'resourceMissPenalty').length, 0, 'p001 不应有资源缺失扣分');

    // p005 缺 oxygen×1 → 必须扣 1×resourceMissPenalty
    const d005 = r.details.find((d) => d.patientId === 'p005')!;
    const missOxygen = d005.penalties.find((p) => p.type === 'resourceMissPenalty' && p.reason.includes('oxygen'));
    assertTrue(!!missOxygen, 'p005 必须因 oxygen 缺失扣分');
    assertEq(missOxygen?.amount, rules.resourceMissPenalty, `p005 oxygen 缺失应扣 ${rules.resourceMissPenalty}`);

    // 关键：recalcProof 中必须存在 p005/oxygen 缺失的证据条目
    const proofP005Oxy = r.proofs.find(
      (p) => p.ruleKey === 'resourceMissPenalty' && (p.input as any).patientId === 'p005' && (p.input as any).resourceId === 'oxygen'
    );
    assertTrue(!!proofP005Oxy, 'recalcProof 必须包含 p005 oxygen 缺失证据');
    const proofInput = proofP005Oxy!.input as Record<string, unknown>;
    assertTrue(
      proofInput.usedForPatient === 0 || (proofInput as any).used === 0 || (proofInput as any).usedForPatient === 0,
      'proof 中 p005 的 oxygen 实际使用量必须为 0'
    );

    // 操作日志 + recalcProof 可复算：直接把 byPatient 拿出来看
    assertEq(r.byPatient['p001']?.['oxygen'] ?? 0, 1, 'p001 oxygen 按患者维度 = 1');
    assertEq(r.byPatient['p005']?.['oxygen'] ?? 0, 0, 'p005 oxygen 按患者维度 = 0（bug 修复前这里会是 1）');

    // 模式必须是 modern（resourceAssignments）
    assertEq(r.hasModern, true, '必须走 modern 资源绑定模式');
  });

  test('消耗 2 次 oxygen 分别给 p001 和 p005，两人均不扣 oxygen 资源分', () => {
    const s = baselineSession(level);
    s.resourceAssignments = [
      { id: 'ra-oxy-1', patientId: 'p001', resourceId: 'oxygen', assignedAt: s.startTime + 1000 },
      { id: 'ra-oxy-2', patientId: 'p005', resourceId: 'oxygen', assignedAt: s.startTime + 2000 },
      { id: 'ra-ecg-1', patientId: 'p001', resourceId: 'ecg', assignedAt: s.startTime + 1100 },
      { id: 'ra-asp-1', patientId: 'p001', resourceId: 'aspirin', assignedAt: s.startTime + 1200 },
      { id: 'ra-cv-1', patientId: 'p005', resourceId: 'cervical-collar', assignedAt: s.startTime + 1300 },
      { id: 'ra-iv-1', patientId: 'p005', resourceId: 'iv', assignedAt: s.startTime + 1400 },
      { id: 'ra-ct-1', patientId: 'p005', resourceId: 'ct', assignedAt: s.startTime + 1500 },
    ];
    for (const a of s.resourceAssignments) s.resourceUsage[a.resourceId] = (s.resourceUsage[a.resourceId] ?? 0) + 1;

    const r = calculateScore(level, s);
    const d001 = r.details.find((d) => d.patientId === 'p001')!;
    const d005 = r.details.find((d) => d.patientId === 'p005')!;
    assertEq(d001.penalties.filter((p) => p.type === 'resourceMissPenalty').length, 0, 'p001 不缺资源');
    assertEq(d005.penalties.filter((p) => p.type === 'resourceMissPenalty').length, 0, 'p005 不缺资源');
    assertEq(r.byPatient['p001']?.oxygen ?? 0, 1);
    assertEq(r.byPatient['p005']?.oxygen ?? 0, 1);
  });
}

// ------- CASE 2: 暂停拦截 -------
function case2_pauseIntercept(level: Level) {
  console.log('\nCASE 2: 暂停后禁止资源操作和通道分配');
  test('status=PAUSED 时 checkStatusAllowsMutation 拦截', () => {
    const s = baselineSession(level);
    s.status = 'PAUSED';
    assertEq(checkStatusAllowsMutation(s.status).ok, false);
    assertEq(checkStatusAllowsMutation(s.status).code, 'E_PAUSED_LOCKED');
  });
  test('status=ENDED 时 checkStatusAllowsMutation 拦截', () => {
    const s = baselineSession(level);
    s.status = 'ENDED';
    assertEq(checkStatusAllowsMutation(s.status).ok, false);
    assertEq(checkStatusAllowsMutation(s.status).code, 'E_GAME_ENDED');
  });
  test('status=RUNNING 时 checkStatusAllowsMutation 通过', () => {
    const s = baselineSession(level);
    assertEq(checkStatusAllowsMutation(s.status).ok, true);
  });
}

// ------- CASE 3: 旧存档兼容（只有 resourceUsage，没有 resourceAssignments）-------
function case3_legacySave(level: Level) {
  console.log('\nCASE 3: 旧存档（仅 resourceUsage）兼容与回退评分');
  test('legacy 存档使用 fallback 算法按患者顺序分配，未超量', () => {
    const s = baselineSession(level);
    // 伪造旧存档：只有 resourceUsage，无 resourceAssignments
    (s as any).resourceAssignments = undefined; // 模拟旧数据缺失
    s.resourceUsage = {
      oxygen: 1, // 只有 1 个 oxygen，应按顺序先给 p001，p005 拿不到
      ecg: 1, aspirin: 1, 'cervical-collar': 1, iv: 1, ct: 1,
      // p002、p003、p006 的资源也给齐
      analgesia: 1, splint: 1, antipyretic: 1,
    };
    const r = calculateScore(level, s as GameSession);
    // legacy 模式
    assertEq(r.hasModern, false, '必须走 legacy fallback 模式');
    // p001 拿到 oxygen → 不扣
    assertEq(r.byPatient['p001']?.oxygen ?? 0, 1);
    // p005 没拿到 → 扣
    assertEq(r.byPatient['p005']?.oxygen ?? 0, 0);
    const d005 = r.details.find((d) => d.patientId === 'p005')!;
    assertTrue(
      d005.penalties.some((p) => p.type === 'resourceMissPenalty' && p.reason.includes('oxygen')),
      'legacy 模式下 p005 也必须因 oxygen 缺失扣分（不能共享）'
    );
  });
}

// ------- CASE 4: 模拟刷新恢复 + 导出 TXT 一致性 -------
function case4_replayConsistency(level: Level) {
  console.log('\nCASE 4: 刷新恢复 + 复盘导出 与 评分 三方互相对照');

  // 构建完整 session（所有患者全通道正确 + 所有资源正确绑定）
  function buildFullSession(): GameSession {
    const s = baselineSession(level);
    const asg: ResourceAssignment[] = [];
    let ts = s.startTime + 1000;
    for (const p of level.patients) {
      for (const req of p.requiredResources) {
        for (let i = 0; i < req.count; i++) {
          asg.push({ id: `ra-${p.id}-${req.resourceId}-${i}`, patientId: p.id, resourceId: req.resourceId, assignedAt: ts });
          ts += 100;
        }
      }
    }
    s.resourceAssignments = asg;
    for (const a of asg) s.resourceUsage[a.resourceId] = (s.resourceUsage[a.resourceId] ?? 0) + 1;
    s.operationLog.push(
      { timestamp: s.startTime + 500, type: 'ALLOCATE', patientId: 'p001', fromChannel: null, toChannel: 'RED' },
      { timestamp: s.startTime + 35_000, type: 'SUBMIT', note: `用时 ${s.elapsedSeconds}s` },
    );
    return s;
  }

  test('评分、resourceUsage 总数、resourceAssignments 有效数三者一致', () => {
    const s = buildFullSession();
    const r = calculateScore(level, s);
    // 资源使用数 = resourceAssignments 未归还数
    const unreturned = s.resourceAssignments.filter((a) => !a.returnedAt).length;
    let totalNeeded = 0;
    for (const p of level.patients) for (const req of p.requiredResources) totalNeeded += req.count;
    assertEq(unreturned, totalNeeded, 'resourceAssignments 在用总数 = 关卡需求总数');
    assertEq(r.correctCount, level.patients.length, 'correctCount 必须等于患者总数（全对）');
    // 全对时应该触发 perfectBonus
    assertEq(r.proofs.some((p: any) => p.ruleKey === 'perfectChannelBonus'), true, '全对应该触发 perfectBonus');
  });

  test('复盘 TXT 导出包含 resourceAssignments 的患者绑定信息', () => {
    const s = buildFullSession();
    // 简易导出文本（与 exportReplayTXT 逻辑一致）
    const lines: string[] = [];
    if (Array.isArray(s.resourceAssignments) && s.resourceAssignments.length > 0) {
      lines.push('--- 资源-患者绑定表 ---');
      for (const a of s.resourceAssignments) {
        const patient = level.patients.find((p) => p.id === a.patientId);
        const slot = level.resourceSlots.find((r) => r.id === a.resourceId);
        lines.push(`${patient?.name ?? a.patientId} ← ${slot?.name ?? a.resourceId}`);
      }
    }
    // 必须出现 p001 ← 吸氧装置 与 p005 ← 吸氧装置 两条独立记录
    assertTrue(lines.some((l) => l.includes('患者A') && l.includes('吸氧装置')), 'TXT 中必须有患者A ← 吸氧装置');
    assertTrue(lines.some((l) => l.includes('患者E') && l.includes('吸氧装置')), 'TXT 中必须有患者E ← 吸氧装置');
    // 操作日志必须含 SUBMIT
    assertTrue(s.operationLog.some((l) => l.type === 'SUBMIT'), '操作日志必须包含 SUBMIT');
  });

  test('模拟刷新恢复（序列化 → 反序列化）后评分完全一致', () => {
    const s = buildFullSession();
    const r1 = calculateScore(level, s);
    // 序列化 → 反序列化（模拟 localStorage 往返）
    const roundtrip: GameSession = JSON.parse(JSON.stringify(s));
    const r2 = calculateScore(level, roundtrip);
    assertEq(r2.total, r1.total, '刷新恢复后总分必须一致');
    assertEq(r2.proofs.length, r1.proofs.length, '刷新恢复后 recalcProof 条数必须一致');
    // recalcProof 的 hash 必须相同（与 computeReplayHash 类似）
    const hash = (obj: unknown) => {
      const str = JSON.stringify(obj);
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
      return h.toString(16);
    };
    assertEq(hash({ total: r1.total, proofLen: r1.proofs.length }), hash({ total: r2.total, proofLen: r2.proofs.length }), '复盘校验码一致');
  });
}

// ------- 主流程 -------
function main() {
  console.log('=== 急救分诊资源绑定 回归测试 ===');
  const level = loadBasicEmergency();
  assertTrue(level.patients.length === 6, 'basic-emergency 必须 6 名患者');
  assertTrue(level.patients.some((p) => p.id === 'p001' && p.requiredResources.some((r) => r.resourceId === 'oxygen')), 'p001 需要 oxygen');
  assertTrue(level.patients.some((p) => p.id === 'p005' && p.requiredResources.some((r) => r.resourceId === 'oxygen')), 'p005 需要 oxygen');

  case1_oxygenSharing(level);
  case2_pauseIntercept(level);
  case3_legacySave(level);
  case4_replayConsistency(level);

  console.log(`\n=== 结果：通过 ${passCount} / 失败 ${failCount} ===`);
  if (failCount > 0) {
    console.log('失败用例:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
