import { useGameStore } from '../store/gameStore';
import type { Level, GameRecord, ScoreResult } from '../types';
import { generateUUID, round2 } from '../utils/uuid';
import { calculateScore } from '../utils/scoring';

export function useScoring() {
  const { level, session, commitScoreRecord, currentResult } = useGameStore();

  const recompute = (l?: Level | null, s?: typeof session): ScoreResult | null => {
    const lv = l ?? level;
    const ss = s ?? session;
    if (!lv || !ss) return null;
    return calculateScore(lv, ss);
  };

  const buildRecord = (result: ScoreResult): GameRecord | null => {
    if (!level || !session) return null;
    const completed =
      session.status === 'ENDED' &&
      level.patients.every((p) => session.assignments[p.id]);
    return {
      id: generateUUID(),
      levelId: level.id,
      levelName: level.name,
      levelVersion: level.version,
      difficulty: level.difficulty,
      totalScore: round2(result.total),
      maxScore: result.maxScore,
      accuracy: result.accuracy,
      usedSeconds: session.elapsedSeconds,
      completed,
      createdAt: Date.now(),
      sessionSnapshot: JSON.parse(JSON.stringify(session)),
      scoreSnapshot: JSON.parse(JSON.stringify(result)),
    };
  };

  const finalize = (result: ScoreResult): GameRecord | null => {
    const rec = buildRecord(result);
    if (!rec) return null;
    commitScoreRecord(rec);
    return rec;
  };

  return {
    recompute,
    buildRecord,
    finalize,
    currentResult,
  };
}
