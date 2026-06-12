import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import type { Channel } from '../types';

export function useGameEngine() {
  const {
    session,
    level,
    startGame,
    pause,
    resume,
    abandon,
    selectPatient,
    allocate,
    deallocate,
    useResource,
    returnResource,
    submit,
    pushError,
    clearLastError,
  } = useGameStore();

  const allocateSelected = useCallback(
    (channel: Channel) => {
      if (!session?.selectedPatientId) return { ok: false };
      return allocate(session.selectedPatientId, channel);
    },
    [session?.selectedPatientId, allocate]
  );

  const clearSelectedAssignment = useCallback(() => {
    if (!session?.selectedPatientId) return { ok: false };
    return deallocate(session.selectedPatientId);
  }, [session?.selectedPatientId, deallocate]);

  const isAllAllocated = useCallback(() => {
    if (!level || !session) return false;
    return level.patients.every((p) => session.assignments[p.id]);
  }, [level, session]);

  const progress = useCallback(() => {
    if (!level || !session) return 0;
    const done = level.patients.filter((p) => session.assignments[p.id]).length;
    return Math.round((done / level.patients.length) * 100);
  }, [level, session]);

  const startNew = useCallback(
    (lv: NonNullable<typeof level>) => startGame(lv, false),
    [startGame]
  );
  const resumeSaved = useCallback(
    (lv: NonNullable<typeof level>) => startGame(lv, true),
    [startGame]
  );

  return {
    session,
    level,
    startNew,
    resumeSaved,
    pause,
    resume,
    abandon,
    selectPatient,
    allocate,
    allocateSelected,
    deallocate,
    clearSelectedAssignment,
    useResource,
    returnResource,
    submit,
    pushError,
    clearLastError,
    isAllAllocated,
    progress,
  };
}
