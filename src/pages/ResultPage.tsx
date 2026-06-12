import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useHistoryStore } from '../store/historyStore';
import { useConfigStore } from '../store/configStore';
import { useGameStore } from '../store/gameStore';
import { useScoring } from '../hooks/useScoring';
import { ScoreGauge } from '../components/result/ScoreGauge';
import { ErrorTable } from '../components/result/ErrorTable';
import { Timeline } from '../components/result/Timeline';
import { ExportButtons } from '../components/result/ExportButtons';
import { WarningBanner } from '../components/layout/Toasts';
import { formatTime } from '../utils/uuid';
import type { GameRecord, Level } from '../types';

export default function ResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const refresh = useHistoryStore((s) => s.refresh);
  const getRecord = useHistoryStore((s) => s.getRecord);
  const init = useConfigStore((s) => s.init);
  const getLevel = useConfigStore((s) => s.getLevel);
  const activeSession = useGameStore((s) => s.session);
  const activeLevel = useGameStore((s) => s.level);
  const { recompute, buildRecord } = useScoring();

  const [record, setRecord] = React.useState<GameRecord | null>(null);
  const [level, setLevel] = React.useState<Level | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    refresh();
    let rec: GameRecord | null = null;
    if (sessionId) {
      rec = getRecord(sessionId);
    }

    if (!rec && activeSession?.status === 'ENDED' && activeLevel) {
      const scoreRes = recompute(activeLevel, activeSession);
      if (scoreRes) {
        const built = buildRecord(scoreRes);
        if (built) {
          rec = built;
          setLevel(activeLevel);
        }
      }
    }

    if (!rec) {
      setError('未找到该训练记录');
      return;
    }
    setRecord(rec);
    if (!level) {
      setLevel(getLevel(rec.levelId));
    }
  }, [sessionId]);

  const handleReplay = () => {
    if (record) {
      navigate(`/game/${record.levelId}`);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md w-full text-center">
          <h3 className="font-title text-xl text-slate-900 mb-2">{error}</h3>
          <p className="text-sm text-slate-500 mb-5">
            可能已被清除或链接无效。请返回首页开始新训练。
          </p>
          <button onClick={() => navigate('/')} className="btn-primary">
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (!record || !level) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        正在加载...
      </div>
    );
  }

  const result = record.scoreSnapshot;
  const session = record.sessionSnapshot;

  const patientMap: Record<string, { name: string; tags: string[] }> = {};
  const reasoningMap: Record<string, string> = {};
  for (const p of level.patients) {
    patientMap[p.id] = { name: p.name, tags: p.tags };
    reasoningMap[p.id] = p.reasoning;
  }

  const patientNames: Record<string, string> = {};
  for (const p of level.patients) {
    patientNames[p.id] = `${p.sequenceNo}号·${p.name}`;
  }
  const resourceNames: Record<string, string> = {};
  for (const r of level.resourceSlots) {
    resourceNames[r.id] = r.name;
  }

  const usedSeconds = session.elapsedSeconds;
  const overtime = usedSeconds > level.timeLimitSeconds;

  return (
    <div className="min-h-screen px-4 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 text-center">
          <h1 className="font-title text-2xl md:text-3xl text-slate-900 mb-1">训练完成</h1>
          <p className="text-slate-500 text-sm">
            {level.name} · v{level.version} · 用时 {formatTime(usedSeconds)} / 限时{' '}
            {formatTime(level.timeLimitSeconds)}
          </p>
        </div>

        {overtime && (
          <WarningBanner text={`⚠️ 本局超时 ${formatTime(usedSeconds - level.timeLimitSeconds)}，已按规则计算超时惩罚。`} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1 space-y-5">
            <ScoreGauge result={result} maxScore={result.maxScore} />
            <div className="card p-5">
              <h3 className="section-title mb-3">分项统计</h3>
              <div className="space-y-2.5">
                <RowStat label="基础总分" value={result.details.reduce((a, b) => a + b.baseScore, 0)} />
                <RowStat label="时间得分" value={result.timeScore} suffix="/ 100" />
                <RowStat label="资源使用" value={result.resourceScore} suffix="/ 100" />
                <RowStat label="奖励加分" value={`+${result.finalBonus}`} positive />
                <RowStat label="惩罚扣分" value={`-${result.finalPenalty}`} negative />
                <div className="pt-2 border-t border-slate-100 flex justify-between font-bold">
                  <span className="text-slate-800">最终总分</span>
                  <span className="font-mono text-xl text-sky-700">{result.total} / {result.maxScore}</span>
                </div>
              </div>
            </div>
            <ExportButtons level={level} record={record} onReplay={handleReplay} />
          </div>

          <div className="lg:col-span-2 space-y-5">
            <ErrorTable
              result={result}
              patientMap={patientMap}
              reasoningMap={reasoningMap}
            />
            <Timeline
              logs={session.operationLog}
              startTime={session.startTime}
              patientNames={patientNames}
              resourceNames={resourceNames}
            />
            {session.errors.length > 0 && (
              <div className="card p-5">
                <h3 className="section-title mb-3">拦截与错误记录</h3>
                <div className="space-y-1.5 max-h-60 overflow-auto scrollbar-thin pr-2">
                  {session.errors.map((e, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-800"
                    >
                      <span className="font-mono text-[10px] text-red-500 mr-2">{e.code}</span>
                      <span>{e.message}</span>
                      <div className="text-[10px] text-red-600/80 mt-0.5">建议：{e.suggestion}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowStat({
  label,
  value,
  suffix,
  positive,
  negative,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span
        className={
          'font-mono font-semibold ' +
          (positive ? 'text-emerald-600' : negative ? 'text-red-600' : 'text-slate-800')
        }
      >
        {value}
        {suffix}
      </span>
    </div>
  );
}
