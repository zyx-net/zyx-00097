import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, History, Trophy, Clock, Users, AlertTriangle, RefreshCw } from 'lucide-react';
import { useConfigStore } from '../store/configStore';
import { useHistoryStore } from '../store/historyStore';
import { loadInProgress, getBestScore } from '../utils/storage';
import { ConfigErrorBanner, WarningBanner } from '../components/layout/Toasts';
import { DIFFICULTY_LABEL, DIFFICULTY_LABEL_COLOR } from '../types';
import { classNames, formatTime } from '../utils/uuid';

export default function LevelSelectPage() {
  const navigate = useNavigate();
  const { levels, configErrors, init } = useConfigStore();
  const { records } = useHistoryStore();

  useEffect(() => {
    init();
  }, [init]);

  const [savedGame, setSavedGame] = React.useState<{
    levelId: string;
    levelName?: string;
    elapsedSeconds: number;
    remainingSeconds: number;
    assignedCount: number;
    totalPatients: number;
  } | null>(null);

  useEffect(() => {
    const raw = loadInProgress();
    if (raw && levels.length > 0) {
      const lv = levels.find((l) => l.id === raw.levelId);
      if (lv) {
        const assigned = Object.values(raw.session.assignments).filter(Boolean).length;
        setSavedGame({
          levelId: raw.levelId,
          levelName: lv.name,
          elapsedSeconds: raw.session.elapsedSeconds,
          remainingSeconds: raw.session.remainingSeconds,
          assignedCount: assigned,
          totalPatients: lv.patients.length,
        });
      }
    }
  }, [levels]);

  const handleStart = (levelId: string) => {
    navigate(`/game/${levelId}`);
  };

  const handleResume = () => {
    if (savedGame) navigate(`/game/${savedGame.levelId}?resume=1`);
  };

  return (
    <div className="min-h-screen px-4 py-8 md:py-12">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="font-title text-3xl md:text-4xl text-slate-900 mb-2">
            急救分诊训练系统
          </h1>
          <p className="text-slate-500 text-sm md:text-base">
            在真实模拟的急诊场景中，训练快速、准确的分诊决策能力
          </p>
        </div>

        {configErrors.length > 0 && <ConfigErrorBanner errors={configErrors} />}

        {savedGame && (
          <div className="mb-6 rounded-2xl bg-gradient-to-r from-indigo-50 to-sky-50 border-2 border-dashed border-indigo-300 p-5 fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                  <RefreshCw size={22} />
                </div>
                <div>
                  <div className="font-title text-base text-indigo-900 mb-0.5">
                    存在未完成的训练
                  </div>
                  <div className="text-sm text-indigo-700/90">
                    <span className="font-semibold">{savedGame.levelName}</span> · 已用{' '}
                    {formatTime(savedGame.elapsedSeconds)} · 已分诊{' '}
                    {savedGame.assignedCount}/{savedGame.totalPatients}
                  </div>
                  <div className="text-xs text-indigo-500 mt-0.5">
                    刷新页面后计时、进度、资源消耗将自动恢复
                  </div>
                </div>
              </div>
              <button onClick={handleResume} className="btn-accent md:shrink-0">
                <Play size={16} /> 继续游戏
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end mb-4">
          <button
            onClick={() => navigate('/history')}
            className="btn-ghost"
          >
            <History size={16} /> 查看历史成绩
          </button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {levels.map((lv, idx) => {
            const best = getBestScore(lv.id);
            const totalRecord = records.filter((r) => r.levelId === lv.id && r.completed).length;
            return (
              <div
                key={lv.id}
                className="card p-5 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 fade-in"
                style={{ animationDelay: `${idx * 80}ms` }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-title text-lg text-slate-900">{lv.name}</h3>
                      <span
                        className={classNames(
                          'chip text-[10px] font-bold',
                          DIFFICULTY_LABEL_COLOR[lv.difficulty]
                        )}
                      >
                        {DIFFICULTY_LABEL[lv.difficulty]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      v{lv.version}
                    </div>
                  </div>
                  {best && (
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400">最高分</div>
                      <div className="font-mono font-bold text-lg text-amber-500 flex items-center justify-end gap-1">
                        <Trophy size={14} />
                        {best.score}
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-sm text-slate-600 leading-relaxed mb-4 line-clamp-3">
                  {lv.description}
                </p>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <StatMini
                    icon={<Users size={12} />}
                    value={String(lv.patients.length)}
                    label="患者数"
                  />
                  <StatMini
                    icon={<Clock size={12} />}
                    value={formatTime(lv.timeLimitSeconds)}
                    label="限时"
                  />
                  <StatMini
                    icon={<Trophy size={12} />}
                    value={String(totalRecord)}
                    label="通关次数"
                  />
                </div>

                {best && (
                  <div className="mb-4 text-xs text-slate-500 flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                    <AlertTriangle size={12} className="text-amber-500" />
                    最佳准确率 {best.accuracy}%
                  </div>
                )}

                <button
                  onClick={() => handleStart(lv.id)}
                  className="w-full btn-primary !py-2.5"
                >
                  <Play size={16} /> 开始训练
                </button>
              </div>
            );
          })}

          {levels.length === 0 && configErrors.length === 0 && (
            <div className="col-span-full text-center py-16 text-slate-500">
              正在加载关卡配置...
            </div>
          )}
        </div>

        {levels.length > 0 && (
          <WarningBanner
            text="提示：本训练系统完全本地运行，所有数据仅存储在您的浏览器中，不会上传至任何服务器。刷新页面后未完成的局面可自动恢复。"
          />
        )}
      </div>
    </div>
  );
}

function StatMini({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2 text-center">
      <div className="text-xs text-slate-500 flex items-center justify-center gap-1 mb-0.5">
        {icon}
        {label}
      </div>
      <div className="font-mono font-bold text-slate-800">{value}</div>
    </div>
  );
}
