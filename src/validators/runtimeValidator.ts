import type {
  GameSession,
  Level,
  Channel,
  ErrorRecord,
  GameStatus,
  Patient,
  ResourceSlot,
} from '../types';
import { ERROR_CODES, ERROR_MESSAGES, CHANNEL_ORDER } from '../types';

export interface RuntimeCheck {
  ok: boolean;
  error?: ErrorRecord;
}

const now = () => Date.now();

function err(
  code: string,
  overrides: Partial<ErrorRecord> = {}
): ErrorRecord {
  const base = ERROR_MESSAGES[code];
  return {
    code,
    message: overrides.message ?? base?.message ?? '未知错误',
    suggestion: overrides.suggestion ?? base?.suggestion ?? '请重试',
    timestamp: now(),
    ...overrides,
  };
}

export function checkStatusAllowsMutation(
  status: GameStatus
): RuntimeCheck {
  if (status === 'PAUSED') {
    return { ok: false, error: err(ERROR_CODES.E_PAUSED_LOCKED) };
  }
  if (status === 'ENDED' || status === 'ABANDONED') {
    return { ok: false, error: err(ERROR_CODES.E_GAME_ENDED) };
  }
  if (status === 'IDLE') {
    return { ok: false, error: err(ERROR_CODES.E_GAME_ENDED, { message: '游戏尚未开始' }) };
  }
  return { ok: true };
}

export function checkPatientExists(
  level: Level,
  patientId: string
): RuntimeCheck {
  const found = level.patients.some((p) => p.id === patientId);
  if (!found) {
    return {
      ok: false,
      error: err(ERROR_CODES.E_INVALID_TARGET, {
        message: `患者不存在: ${patientId}`,
        patientId,
      }),
    };
  }
  return { ok: true };
}

export function checkChannelExists(channel: unknown): RuntimeCheck {
  if (!CHANNEL_ORDER.includes(channel as Channel)) {
    return {
      ok: false,
      error: err(ERROR_CODES.E_INVALID_TARGET, {
        message: `通道无效: ${String(channel)}`,
      }),
    };
  }
  return { ok: true };
}

export function checkResourceExists(
  level: Level,
  resourceId: string
): RuntimeCheck {
  const found = level.resourceSlots.some((r) => r.id === resourceId);
  if (!found) {
    return {
      ok: false,
      error: err(ERROR_CODES.E_INVALID_TARGET, {
        message: `资源不存在: ${resourceId}`,
        resourceId,
      }),
    };
  }
  return { ok: true };
}

export function checkResourceAvailable(
  level: Level,
  resourceUsage: Record<string, number>,
  resourceId: string
): RuntimeCheck {
  const slot = level.resourceSlots.find((r) => r.id === resourceId);
  if (!slot) {
    return {
      ok: false,
      error: err(ERROR_CODES.E_INVALID_TARGET, { resourceId }),
    };
  }
  const used = resourceUsage[resourceId] ?? 0;
  if (used >= slot.initialCount) {
    return {
      ok: false,
      error: err(ERROR_CODES.E_RESOURCE_DEPLETED, {
        message: `资源「${slot.name}」已耗尽（剩余 0/${slot.initialCount}）`,
        resourceId,
      }),
    };
  }
  return { ok: true };
}

export function checkResourceCanReturn(
  level: Level,
  resourceUsage: Record<string, number>,
  resourceId: string
): RuntimeCheck {
  const slot = level.resourceSlots.find((r) => r.id === resourceId);
  if (!slot) {
    return {
      ok: false,
      error: err(ERROR_CODES.E_INVALID_TARGET, { resourceId }),
    };
  }
  const used = resourceUsage[resourceId] ?? 0;
  if (used <= 0) {
    return {
      ok: false,
      error: err(ERROR_CODES.E_RESOURCE_NOT_USED, {
        message: `资源「${slot.name}」当前未被消耗，无法归还`,
        resourceId,
      }),
    };
  }
  return { ok: true };
}

export function checkAllAllocated(
  level: Level,
  assignments: Record<string, Channel | null>
): RuntimeCheck {
  const pending = level.patients.filter((p) => !assignments[p.id]);
  if (pending.length > 0) {
    const names = pending.map((p) => `${p.sequenceNo}号·${p.name}`).join('、');
    return {
      ok: false,
      error: err(ERROR_CODES.E_NOT_ALL_ASSIGNED, {
        message: `还有 ${pending.length} 名患者未分诊: ${names}`,
        suggestion: `请先分配 ${names}`,
      }),
    };
  }
  return { ok: true };
}

export function checkNotSubmitted(session: GameSession): RuntimeCheck {
  const submitted = session.operationLog.some((log) => log.type === 'SUBMIT');
  if (submitted) {
    return { ok: false, error: err(ERROR_CODES.E_ALREADY_SUBMITTED) };
  }
  return { ok: true };
}

export function checkSubmitAllowed(
  session: GameSession,
  level: Level
): RuntimeCheck {
  const statusCheck = checkStatusAllowsMutation(session.status);
  if (!statusCheck.ok) return statusCheck;
  const submitted = checkNotSubmitted(session);
  if (!submitted.ok) return submitted;
  return checkAllAllocated(level, session.assignments);
}

export function severityDistance(a: Channel, b: Channel): number {
  return Math.abs(CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b));
}

export interface AllowedResourcesForPatient {
  recommendedIds: string[];
  allowedButNotRecommended: string[];
}

export function getAllowedResourcesForPatient(
  patient: Patient,
  level: Level
): AllowedResourcesForPatient {
  const recommendedIds = patient.requiredResources.map((r) => r.resourceId);
  const allowedButNotRecommended = level.resourceSlots
    .map((r) => r.id)
    .filter((id) => !recommendedIds.includes(id));
  return { recommendedIds, allowedButNotRecommended };
}

export function getResourceRemaining(
  slot: ResourceSlot,
  usage: Record<string, number>
): number {
  return Math.max(0, slot.initialCount - (usage[slot.id] ?? 0));
}
