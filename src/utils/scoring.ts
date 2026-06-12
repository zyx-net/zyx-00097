import type { Level, GameSession, ScoreResult, ScoringDetail, Channel, ResourceAssignment } from '../types';
import { CHANNEL_ORDER } from '../types';
import { severityDistance } from '../validators/runtimeValidator';
import { round2 } from './uuid';

type ProofInput = { ruleKey: string; input: unknown; output: number };

function resourceUsageByPatient(
  assignments: ResourceAssignment[]
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const a of assignments) {
    if (a.returnedAt) continue;
    if (!result[a.patientId]) result[a.patientId] = {};
    result[a.patientId][a.resourceId] = (result[a.patientId][a.resourceId] ?? 0) + 1;
  }
  return result;
}

function legacyUsageByPatientFallback(
  level: Level,
  resourceUsage: Record<string, number>
): Record<string, Record<string, number>> {
  const remaining: Record<string, number> = { ...resourceUsage };
  const result: Record<string, Record<string, number>> = {};
  for (const p of level.patients) {
    result[p.id] = {};
    for (const req of p.requiredResources) {
      const needed = req.count;
      const avail = remaining[req.resourceId] ?? 0;
      const take = Math.min(needed, avail);
      if (take > 0) {
        result[p.id][req.resourceId] = take;
        remaining[req.resourceId] = avail - take;
      }
    }
  }
  return result;
}

export function calculateScore(level: Level, session: GameSession): ScoreResult {
  const rules = level.scoringRules;
  const proofs: ProofInput[] = [];
  const details: ScoringDetail[] = [];

  const hasModernAssignments = Array.isArray(session.resourceAssignments) && session.resourceAssignments.length > 0;
  const byPatient = hasModernAssignments
    ? resourceUsageByPatient(session.resourceAssignments)
    : legacyUsageByPatientFallback(level, session.resourceUsage);

  proofs.push({
    ruleKey: 'resourceTrackingMode',
    input: {
      hasModernAssignments,
      totalAssignments: session.resourceAssignments?.length ?? 0,
      legacyUsage: session.resourceUsage,
    },
    output: hasModernAssignments ? 1 : 0,
  });

  let patientTotal = 0;
  let correctCount = 0;

  for (const patient of level.patients) {
    const assigned = session.assignments[patient.id] ?? null;
    const correct = patient.correctChannel;
    const base = rules.correctScore;
    const penalties: ScoringDetail['penalties'] = [];
    const bonuses: ScoringDetail['bonuses'] = [];
    let score = base;

    if (assigned === correct) {
      correctCount++;
      proofs.push({
        ruleKey: 'correctScore',
        input: { patientId: patient.id, assigned, correct },
        output: base,
      });
    } else {
      const distance = severityDistance(correct, assigned ?? 'BLACK');
      score -= rules.channelWrongPenalty;
      penalties.push({
        type: 'channelWrongPenalty',
        amount: rules.channelWrongPenalty,
        reason: `通道错误：正确为${correct}，分配为${assigned ?? '未分配'}`,
      });
      proofs.push({
        ruleKey: 'channelWrongPenalty',
        input: { patientId: patient.id, assigned, correct },
        output: -rules.channelWrongPenalty,
      });
      if (distance > 1) {
        const penalty = rules.severityMismatchPenalty;
        score -= penalty;
        penalties.push({
          type: 'severityMismatchPenalty',
          amount: penalty,
          reason: `严重等级偏差距离 ${distance} 级`,
        });
        proofs.push({
          ruleKey: 'severityMismatchPenalty',
          input: { patientId: patient.id, distance },
          output: -penalty,
        });
      }
    }

    const usedForPatient = byPatient[patient.id] ?? {};
    for (const req of patient.requiredResources) {
      const used = usedForPatient[req.resourceId] ?? 0;
      if (used < req.count) {
        const miss = req.count - used;
        const p = rules.resourceMissPenalty * miss;
        score -= p;
        penalties.push({
          type: 'resourceMissPenalty',
          amount: p,
          reason: `资源「${req.resourceId}」未足量（该患者实际分配 ${used}，缺 ${miss}）`,
        });
        proofs.push({
          ruleKey: 'resourceMissPenalty',
          input: {
            patientId: patient.id,
            resourceId: req.resourceId,
            required: req.count,
            usedForPatient: used,
          },
          output: -p,
        });
      } else if (used > req.count) {
        const over = used - req.count;
        const slot = level.resourceSlots.find((s) => s.id === req.resourceId);
        if (slot?.consumable) {
          const p = rules.resourceOverusePenalty * over;
          score -= p;
          penalties.push({
            type: 'resourceOverusePenalty',
            amount: p,
            reason: `消耗型资源「${req.resourceId}」过量（该患者多用 ${over}）`,
          });
          proofs.push({
            ruleKey: 'resourceOverusePenalty',
            input: {
              patientId: patient.id,
              resourceId: req.resourceId,
              required: req.count,
              usedForPatient: used,
            },
            output: -p,
          });
        }
      }
    }

    score = Math.max(0, score);
    patientTotal += score;
    details.push({
      patientId: patient.id,
      patientName: `${patient.sequenceNo}号·${patient.name}`,
      correctChannel: correct,
      assignedChannel: assigned,
      baseScore: base,
      score,
      penalties,
      bonuses,
    });
  }

  const timeoutSeconds = Math.max(0, session.elapsedSeconds - level.timeLimitSeconds);
  const timePenalty = round2(timeoutSeconds * rules.timeoutPenaltyPerSec);
  if (timePenalty > 0) {
    proofs.push({
      ruleKey: 'timeoutPenaltyPerSec',
      input: { timeoutSeconds, rate: rules.timeoutPenaltyPerSec },
      output: -timePenalty,
    });
  }

  const pauseCount = session.operationLog.filter((l) => l.type === 'PAUSE').length;
  const pausePenalty = rules.pausePenalty * pauseCount;
  if (pausePenalty > 0) {
    proofs.push({
      ruleKey: 'pausePenalty',
      input: { pauseCount, rate: rules.pausePenalty },
      output: -pausePenalty,
    });
  }

  let perfectBonus = 0;
  if (correctCount === level.patients.length) {
    perfectBonus = rules.perfectChannelBonus;
    proofs.push({
      ruleKey: 'perfectChannelBonus',
      input: { allCorrect: true },
      output: perfectBonus,
    });
    for (const d of details) {
      d.bonuses.push({
        type: 'perfectChannelBonus',
        amount: perfectBonus / level.patients.length,
        reason: '全对均分完美奖励',
      });
    }
  }

  let resourceScore = 0;
  let resourceEfficiencyBonus = 0;
  {
    let totalNeeded = 0;
    let totalUsed = 0;
    for (const p of level.patients) {
      for (const req of p.requiredResources) {
        totalNeeded += req.count;
      }
    }
    if (hasModernAssignments) {
      totalUsed = session.resourceAssignments.filter((a) => !a.returnedAt).length;
    } else {
      for (const id of Object.keys(session.resourceUsage)) {
        totalUsed += session.resourceUsage[id] ?? 0;
      }
    }
    if (totalNeeded > 0) {
      const ratio = 1 - Math.abs(totalUsed - totalNeeded) / (totalNeeded * 2);
      resourceScore = round2(Math.max(0, ratio) * 100);
      if (ratio >= 0.9 && perfectBonus > 0) {
        resourceEfficiencyBonus = rules.resourceEfficiencyBonus;
        proofs.push({
          ruleKey: 'resourceEfficiencyBonus',
          input: { ratio, threshold: 0.9 },
          output: resourceEfficiencyBonus,
        });
      }
    } else {
      resourceScore = 100;
    }
  }

  const timeScore = round2(
    Math.max(0, 100 - (session.elapsedSeconds / level.timeLimitSeconds) * 100)
  );

  const finalPenalty = round2(timePenalty + pausePenalty);
  const finalBonus = round2(perfectBonus + resourceEfficiencyBonus);

  const maxScore =
    level.patients.length * rules.correctScore +
    rules.perfectChannelBonus +
    rules.resourceEfficiencyBonus;

  const total = round2(Math.max(0, patientTotal - finalPenalty + finalBonus));
  const accuracy = round2((correctCount / level.patients.length) * 100);

  return {
    total: Math.min(total, maxScore),
    maxScore,
    accuracy,
    details,
    resourceScore,
    timeScore,
    finalPenalty,
    finalBonus,
    recalcProof: proofs,
  };
}

export const CHANNEL_SEVERITY: Record<Channel, number> = {
  RED: 4,
  YELLOW: 3,
  GREEN: 2,
  BLACK: 1,
};

export { CHANNEL_ORDER };
