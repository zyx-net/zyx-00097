import type { GameRecord, GameSession, Level, ScoreResult } from '../types';
import { CHANNEL_LABEL, DIFFICULTY_LABEL } from '../types';
import { formatDateTime, formatTime } from './uuid';
import { computeReplayHash } from './storage';

function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportReplayJSON(
  level: Level,
  record: GameRecord
): string {
  const payload = {
    exportVersion: 1,
    exportedAt: formatDateTime(Date.now()),
    replayHash: computeReplayHash(record.scoreSnapshot),
    level: {
      id: level.id,
      name: level.name,
      version: level.version,
      difficulty: level.difficulty,
      scoringRules: level.scoringRules,
    },
    record: {
      id: record.id,
      createdAt: formatDateTime(record.createdAt),
      totalScore: record.totalScore,
      maxScore: record.maxScore,
      accuracy: record.accuracy,
      usedSeconds: record.usedSeconds,
      completed: record.completed,
    },
    session: record.sessionSnapshot,
    scoreResult: record.scoreSnapshot,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportReplayTXT(
  level: Level,
  record: GameRecord
): string {
  const lines: string[] = [];
  const s = record.sessionSnapshot;
  const r = record.scoreSnapshot;

  lines.push('====================================');
  lines.push('     急救分诊训练 · 复盘报告');
  lines.push('====================================');
  lines.push('');
  lines.push(`关卡：${level.name} (v${level.version})`);
  lines.push(`难度：${DIFFICULTY_LABEL[level.difficulty]}`);
  lines.push(`训练时间：${formatDateTime(record.createdAt)}`);
  lines.push(`用时：${formatTime(record.usedSeconds)} / 限时 ${formatTime(level.timeLimitSeconds)}`);
  lines.push('');
  lines.push('------------ 成绩总览 ------------');
  lines.push(`总分：${record.totalScore} / ${record.maxScore}`);
  lines.push(`准确率：${record.accuracy}%`);
  lines.push(`资源使用得分：${r.resourceScore} / 100`);
  lines.push(`时间利用得分：${r.timeScore} / 100`);
  lines.push(`额外奖励：+${r.finalBonus}`);
  lines.push(`惩罚扣分：-${r.finalPenalty}`);
  lines.push(`复算校验码：${computeReplayHash(r)}`);
  lines.push('');
  lines.push('---------- 分诊明细 ----------');
  for (const d of r.details) {
    const ok = d.assignedChannel === d.correctChannel ? '✓' : '✗';
    lines.push(
      `[${ok}] ${d.patientName}  正确:${CHANNEL_LABEL[d.correctChannel]}  玩家:${
        d.assignedChannel ? CHANNEL_LABEL[d.assignedChannel] : '未分配'
      }  得分:${d.score}`
    );
    for (const pen of d.penalties) {
      lines.push(`    -${pen.amount} ${pen.reason}`);
    }
    for (const bon of d.bonuses) {
      lines.push(`    +${bon.amount} ${bon.reason}`);
    }
  }
  lines.push('');
  lines.push('---------- 资源使用明细 ----------');
  for (const slot of level.resourceSlots) {
    const used = s.resourceUsage[slot.id] ?? 0;
    lines.push(`· ${slot.name} (${slot.id}): ${used}/${slot.initialCount}${slot.consumable ? '（消耗型）' : ''}`);
  }
  if (Array.isArray(s.resourceAssignments) && s.resourceAssignments.length > 0) {
    lines.push('');
    lines.push('--- 资源-患者绑定表 ---');
    const patientName = (id: string) => {
      const p = level.patients.find((x) => x.id === id);
      return p ? `${p.sequenceNo}号·${p.name}` : id;
    };
    for (const a of s.resourceAssignments) {
      const status = a.returnedAt ? `（已归还 ${formatTime(Math.floor((a.returnedAt - s.startTime) / 1000))}）` : '（在用）';
      lines.push(`  [${formatTime(Math.floor((a.assignedAt - s.startTime) / 1000))}] ${patientName(a.patientId)} ← ${level.resourceSlots.find((r) => r.id === a.resourceId)?.name ?? a.resourceId} ${status}`);
    }
  }
  lines.push('');
  lines.push('---------- 操作时间线 ----------');
  for (const log of s.operationLog) {
    const t = formatTime(Math.floor((log.timestamp - s.startTime) / 1000));
    const extra: string[] = [];
    if (log.patientId) extra.push(`患者=${log.patientId}`);
    if (log.fromChannel) extra.push(`from=${log.fromChannel}`);
    if (log.toChannel) extra.push(`to=${log.toChannel}`);
    if (log.resourceId) extra.push(`资源=${log.resourceId}`);
    if (log.resourceAssignmentId) extra.push(`资源单=${log.resourceAssignmentId}`);
    if (log.note) extra.push(log.note);
    lines.push(`[${t}] ${log.type}  ${extra.join(' ')}`);
  }
  if (s.errors.length > 0) {
    lines.push('');
    lines.push('---------- 拦截/错误记录 ----------');
    for (const e of s.errors) {
      const t = formatTime(Math.floor((e.timestamp - s.startTime) / 1000));
      lines.push(`[${t}] ${e.code}: ${e.message} → 建议：${e.suggestion}`);
    }
  }
  lines.push('');
  lines.push('====================================');
  lines.push('  评分可由关卡配置+操作记录复算');
  lines.push('====================================');
  return lines.join('\n');
}

export function downloadReplayJSON(level: Level, record: GameRecord) {
  const fname = `triage-replay-${level.id}-${record.createdAt}.json`;
  downloadText(fname, exportReplayJSON(level, record), 'application/json');
}

export function downloadReplayTXT(level: Level, record: GameRecord) {
  const fname = `triage-replay-${level.id}-${record.createdAt}.txt`;
  downloadText(fname, exportReplayTXT(level, record));
}

export function downloadScoreResultAsCSV(level: Level, result: ScoreResult) {
  const header = ['患者', '正确通道', '分配通道', '得分', '基础分', '扣分合计', '加分合计'];
  const rows = result.details.map((d) => [
    d.patientName,
    CHANNEL_LABEL[d.correctChannel],
    d.assignedChannel ? CHANNEL_LABEL[d.assignedChannel] : '',
    String(d.score),
    String(d.baseScore),
    String(d.penalties.reduce((a, b) => a + b.amount, 0)),
    String(d.bonuses.reduce((a, b) => a + b.amount, 0)),
  ]);
  const summary = [
    ['总分', String(result.total)],
    ['满分', String(result.maxScore)],
    ['准确率%', String(result.accuracy)],
    ['资源分', String(result.resourceScore)],
    ['时间分', String(result.timeScore)],
    ['总惩罚', String(result.finalPenalty)],
    ['总奖励', String(result.finalBonus)],
  ];
  const csv = [header, ...rows, [], ...summary].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const fname = `triage-score-${level.id}-${Date.now()}.csv`;
  downloadText(fname, '\ufeff' + csv, 'text/csv;charset=utf-8');
}
