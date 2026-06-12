import { create } from 'zustand';
import type {
  GameSession,
  Level,
  Channel,
  ActionLog,
  ErrorRecord,
  ActionType,
  GameStatus,
  ScoreResult,
  GameRecord,
  ResourceAssignment,
} from '../types';
import { generateUUID } from '../utils/uuid';
import {
  checkStatusAllowsMutation,
  checkPatientExists,
  checkChannelExists,
  checkResourceExists,
  checkResourceAvailable,
  checkResourceCanReturn,
  checkSubmitAllowed,
  checkAllAllocated,
} from '../validators/runtimeValidator';
import { saveInProgress, clearInProgress, appendHistory, loadInProgress, adjustSessionForResume } from '../utils/storage';
import { calculateScore } from '../utils/scoring';
import { ERROR_CODES, ERROR_MESSAGES } from '../types';

type MutationFn = (state: GameStoreState) => Partial<GameStoreState> | void;

interface GameStoreState {
  level: Level | null;
  session: GameSession | null;
  currentResult: ScoreResult | null;
  currentRecord: GameRecord | null;
  lastError: ErrorRecord | null;
  pendingResumeWarning: string | null;

  startGame: (level: Level, resumeFromSave?: boolean) => { ok: boolean; errors?: ErrorRecord[] };
  pause: () => void;
  resume: () => void;
  abandon: () => void;
  tick: () => void;
  selectPatient: (patientId: string | null) => void;
  allocate: (patientId: string, channel: Channel) => { ok: boolean; error?: ErrorRecord };
  deallocate: (patientId: string) => { ok: boolean; error?: ErrorRecord };
  useResource: (resourceId: string) => { ok: boolean; error?: ErrorRecord };
  returnResource: (resourceId: string) => { ok: boolean; error?: ErrorRecord };
  submit: () => { ok: boolean; error?: ErrorRecord; result?: ScoreResult };
  pushError: (e: ErrorRecord) => void;
  clearLastError: () => void;
  clearState: () => void;
  commitScoreRecord: (record: GameRecord) => void;
  loadResumeSnapshot: (level: Level) => { ok: boolean; warning?: string } | null;
}

const emptySession = (): GameSession => ({
  id: '',
  levelId: '',
  levelVersion: '',
  status: 'IDLE',
  startTime: 0,
  pausedAt: null,
  totalPausedMs: 0,
  elapsedSeconds: 0,
  remainingSeconds: 0,
  selectedPatientId: null,
  assignments: {},
  resourceUsage: {},
  resourceAssignments: [],
  operationLog: [],
  errors: [],
});

function addLog(session: GameSession, type: ActionType, patch: Partial<ActionLog> = {}): GameSession {
  return {
    ...session,
    operationLog: [
      ...session.operationLog,
      { timestamp: Date.now(), type, ...patch },
    ],
  };
}

function addError(session: GameSession, error: ErrorRecord): GameSession {
  return { ...session, errors: [...session.errors, error] };
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  level: null,
  session: null,
  currentResult: null,
  currentRecord: null,
  lastError: null,
  pendingResumeWarning: null,

  clearState: () => {
    set({
      level: null,
      session: null,
      currentResult: null,
      currentRecord: null,
      lastError: null,
      pendingResumeWarning: null,
    });
  },

  startGame: (level, resumeFromSave = false) => {
    if (resumeFromSave) {
      const saved = loadInProgress();
      if (!saved || saved.levelId !== level.id) {
        return { ok: false, errors: [{ code: 'NO_SAVE', message: '无可用存档', suggestion: '重新开始', timestamp: Date.now() }] };
      }
      const { session, adjustment } = adjustSessionForResume(saved, level.version);
      if (session.status === 'RUNNING') {
        session.pausedAt = null;
      }
      set({
        level,
        session,
        pendingResumeWarning: adjustment.warning ?? null,
        currentResult: null,
        currentRecord: null,
      });
      if (session.status === 'RUNNING') saveInProgress(level.id, session);
      return { ok: true };
    }

    const now = Date.now();
    const assignments: Record<string, Channel | null> = {};
    for (const p of level.patients) assignments[p.id] = null;
    const resourceUsage: Record<string, number> = {};
    for (const r of level.resourceSlots) resourceUsage[r.id] = 0;
    const session: GameSession = {
      id: generateUUID(),
      levelId: level.id,
      levelVersion: level.version,
      status: 'RUNNING',
      startTime: now,
      pausedAt: null,
      totalPausedMs: 0,
      elapsedSeconds: 0,
      remainingSeconds: level.timeLimitSeconds,
      selectedPatientId: level.patients[0]?.id ?? null,
      assignments,
      resourceUsage,
      resourceAssignments: [],
      operationLog: [{ timestamp: now, type: 'SELECT_PATIENT', patientId: level.patients[0]?.id ?? null, note: '初始选择' }],
      errors: [],
    };
    clearInProgress();
    set({
      level,
      session,
      currentResult: null,
      currentRecord: null,
      pendingResumeWarning: null,
    });
    saveInProgress(level.id, session);
    return { ok: true };
  },

  pause: () => {
    const { session, level } = get();
    if (!session || !level) return;
    if (session.status !== 'RUNNING') return;
    const now = Date.now();
    const updated: GameSession = addLog(
      { ...session, status: 'PAUSED' as GameStatus, pausedAt: now },
      'PAUSE'
    );
    set({ session: updated });
    saveInProgress(level.id, updated);
  },

  resume: () => {
    const { session, level } = get();
    if (!session || !level) return;
    if (session.status !== 'PAUSED') return;
    const now = Date.now();
    const pausedMs = session.pausedAt ? now - session.pausedAt : 0;
    const updated: GameSession = addLog(
      {
        ...session,
        status: 'RUNNING' as GameStatus,
        pausedAt: null,
        totalPausedMs: session.totalPausedMs + pausedMs,
      },
      'RESUME',
      { note: `累计暂停 ${Math.floor(pausedMs / 1000)} 秒` }
    );
    set({ session: updated });
    saveInProgress(level.id, updated);
  },

  abandon: () => {
    const { session, level } = get();
    if (!session || !level) return;
    if (session.status === 'ENDED') return;
    set({ session: { ...session, status: 'ABANDONED' } });
    clearInProgress();
  },

  tick: () => {
    const { session, level } = get();
    if (!session || !level) return;
    if (session.status !== 'RUNNING') return;
    const elapsed = session.elapsedSeconds + 1;
    const remaining = Math.max(0, session.remainingSeconds - 1);
    const updated: GameSession = {
      ...session,
      elapsedSeconds: elapsed,
      remainingSeconds: remaining,
    };
    set({ session: updated });
    if (elapsed % 2 === 0) saveInProgress(level.id, updated);
    if (remaining === 0 && session.status === 'RUNNING') {
      const allOk = checkAllAllocated(level, updated.assignments);
      if (allOk.ok) {
        get().submit();
      }
    }
  },

  selectPatient: (patientId) => {
    const { session, level } = get();
    if (!session || !level) return;
    const s = checkStatusAllowsMutation(session.status);
    if (!s.ok && session.status !== 'PAUSED') return;
    if (patientId) {
      const p = checkPatientExists(level, patientId);
      if (!p.ok) return;
    }
    const updated = addLog(
      { ...session, selectedPatientId: patientId },
      'SELECT_PATIENT',
      { patientId }
    );
    set({ session: updated });
    if (level && session.status === 'RUNNING') saveInProgress(level.id, updated);
  },

  allocate: (patientId, channel) => {
    const { session, level } = get();
    if (!session || !level) return { ok: false };
    const checks = [
      checkStatusAllowsMutation(session.status),
      checkPatientExists(level, patientId),
      checkChannelExists(channel),
    ];
    for (const c of checks) {
      if (!c.ok && c.error) {
        set({
          session: addError(session, c.error),
          lastError: c.error,
        });
        return { ok: false, error: c.error };
      }
    }
    const prev = session.assignments[patientId] ?? null;
    const assignments = { ...session.assignments, [patientId]: channel };
    const logType: ActionType = prev ? 'REALLOCATE' : 'ALLOCATE';
    let updated: GameSession = addLog(
      { ...session, assignments },
      logType,
      { patientId, fromChannel: prev, toChannel: channel }
    );
    if (!session.selectedPatientId) {
      updated = { ...updated, selectedPatientId: patientId };
    }
    set({ session: updated, lastError: null });
    saveInProgress(level.id, updated);
    return { ok: true };
  },

  deallocate: (patientId) => {
    const { session, level } = get();
    if (!session || !level) return { ok: false };
    const checks = [
      checkStatusAllowsMutation(session.status),
      checkPatientExists(level, patientId),
    ];
    for (const c of checks) {
      if (!c.ok && c.error) {
        set({
          session: addError(session, c.error),
          lastError: c.error,
        });
        return { ok: false, error: c.error };
      }
    }
    const prev = session.assignments[patientId] ?? null;
    if (!prev) return { ok: true };
    const updated: GameSession = addLog(
      {
        ...session,
        assignments: { ...session.assignments, [patientId]: null },
      },
      'DEALLOCATE',
      { patientId, fromChannel: prev, toChannel: null }
    );
    set({ session: updated, lastError: null });
    saveInProgress(level.id, updated);
    return { ok: true };
  },

  useResource: (resourceId) => {
    const { session, level } = get();
    if (!session || !level) return { ok: false };
    if (!session.selectedPatientId) {
      const e: ErrorRecord = {
        code: ERROR_CODES.E_NO_PATIENT_SELECTED,
        message: ERROR_MESSAGES[ERROR_CODES.E_NO_PATIENT_SELECTED].message,
        suggestion: ERROR_MESSAGES[ERROR_CODES.E_NO_PATIENT_SELECTED].suggestion,
        timestamp: Date.now(),
        resourceId,
      };
      set({
        session: addError(session, e),
        lastError: e,
      });
      return { ok: false, error: e };
    }
    const patientId = session.selectedPatientId;
    const pCheck = checkPatientExists(level, patientId);
    const checks = [
      checkStatusAllowsMutation(session.status),
      checkResourceExists(level, resourceId),
      checkResourceAvailable(level, session.resourceUsage, resourceId),
      ...(pCheck.ok ? [] : [pCheck]),
    ];
    for (const c of checks) {
      if (!c.ok && c.error) {
        set({
          session: addError(session, c.error),
          lastError: c.error,
        });
        return { ok: false, error: c.error };
      }
    }
    const now = Date.now();
    const assignment: ResourceAssignment = {
      id: generateUUID(),
      patientId,
      resourceId,
      assignedAt: now,
    };
    const usage = {
      ...session.resourceUsage,
      [resourceId]: (session.resourceUsage[resourceId] ?? 0) + 1,
    };
    const patient = level.patients.find((p) => p.id === patientId);
    const updated: GameSession = addLog(
      { ...session, resourceUsage: usage, resourceAssignments: [...session.resourceAssignments, assignment] },
      'RESOURCE_USE',
      {
        patientId,
        resourceId,
        resourceAssignmentId: assignment.id,
        note: patient ? `为 ${patient.sequenceNo}号·${patient.name} 分配` : undefined,
      }
    );
    set({ session: updated, lastError: null });
    saveInProgress(level.id, updated);
    return { ok: true };
  },

  returnResource: (resourceId) => {
    const { session, level } = get();
    if (!session || !level) return { ok: false };
    if (!session.selectedPatientId) {
      const e: ErrorRecord = {
        code: ERROR_CODES.E_NO_PATIENT_SELECTED,
        message: ERROR_MESSAGES[ERROR_CODES.E_NO_PATIENT_SELECTED].message,
        suggestion: ERROR_MESSAGES[ERROR_CODES.E_NO_PATIENT_SELECTED].suggestion,
        timestamp: Date.now(),
        resourceId,
      };
      set({
        session: addError(session, e),
        lastError: e,
      });
      return { ok: false, error: e };
    }
    const patientId = session.selectedPatientId;
    const checks = [
      checkStatusAllowsMutation(session.status),
      checkResourceExists(level, resourceId),
      checkPatientExists(level, patientId),
    ];
    for (const c of checks) {
      if (!c.ok && c.error) {
        set({
          session: addError(session, c.error),
          lastError: c.error,
        });
        return { ok: false, error: c.error };
      }
    }
    const now = Date.now();
    const lastIndex = [...session.resourceAssignments]
      .map((a, i) => ({ a, i }))
      .reverse()
      .find(({ a }) => a.patientId === patientId && a.resourceId === resourceId && !a.returnedAt);
    if (!lastIndex) {
      const e: ErrorRecord = {
        code: ERROR_CODES.E_RESOURCE_NOT_USED,
        message: `该患者未分配过此资源`,
        suggestion: '请先为该患者分配资源再归还',
        timestamp: now,
        patientId,
        resourceId,
      };
      set({
        session: addError(session, e),
        lastError: e,
      });
      return { ok: false, error: e };
    }
    const updatedAssignments = session.resourceAssignments.map((a, idx) =>
      idx === lastIndex.i ? { ...a, returnedAt: now } : a
    );
    const usage = {
      ...session.resourceUsage,
      [resourceId]: Math.max(0, (session.resourceUsage[resourceId] ?? 0) - 1),
    };
    const patient = level.patients.find((p) => p.id === patientId);
    const updated: GameSession = addLog(
      { ...session, resourceUsage: usage, resourceAssignments: updatedAssignments },
      'RESOURCE_RETURN',
      {
        patientId,
        resourceId,
        resourceAssignmentId: lastIndex.a.id,
        note: patient ? `从 ${patient.sequenceNo}号·${patient.name} 归还` : undefined,
      }
    );
    set({ session: updated, lastError: null });
    saveInProgress(level.id, updated);
    return { ok: true };
  },

  submit: () => {
    const { session, level } = get();
    if (!session || !level) return { ok: false };
    const c = checkSubmitAllowed(session, level);
    if (!c.ok && c.error) {
      set({
        session: addError(session, c.error),
        lastError: c.error,
      });
      return { ok: false, error: c.error };
    }
    const endedSession: GameSession = addLog(
      { ...session, status: 'ENDED' as GameStatus },
      'SUBMIT',
      { note: `用时 ${session.elapsedSeconds}s` }
    );
    const result = calculateScore(level, endedSession);
    set({ session: endedSession, currentResult: result, lastError: null });
    clearInProgress();
    return { ok: true, result };
  },

  pushError: (e) => {
    const { session, level } = get();
    if (session) {
      const updated = addError(session, e);
      set({ session: updated, lastError: e });
      if (level && session.status === 'RUNNING') saveInProgress(level.id, updated);
    } else {
      set({ lastError: e });
    }
  },

  clearLastError: () => set({ lastError: null }),

  commitScoreRecord: (record) => {
    appendHistory(record);
    set({ currentRecord: record });
  },

  loadResumeSnapshot: (level) => {
    const saved = loadInProgress();
    if (!saved || saved.levelId !== level.id) return null;
    const { adjustment } = adjustSessionForResume(saved, level.version);
    return { ok: true, warning: adjustment.warning };
  },
}));
