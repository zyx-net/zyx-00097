import React from 'react';
import {
  Activity, Users, Clock, X, Pause, Play, ChevronLeft, Home,
} from 'lucide-react';
import { useGameEngine } from '../../hooks/useGameEngine';
import { formatTime, classNames } from '../../utils/uuid';
import { useNavigate } from 'react-router-dom';

export function GameTopBar() {
  const navigate = useNavigate();
  const { session, level, pause, resume, progress, abandon } = useGameEngine();
  const [confirmAbandon, setConfirmAbandon] = React.useState(false);

  if (!level || !session) return null;
  const remaining = session.remainingSeconds;
  const lowTime = remaining <= 30;
  const paused = session.status === 'PAUSED';
  const ended = session.status === 'ENDED' || session.status === 'ABANDONED';
  const pct = progress();
  const allocated = level.patients.filter((p) => session.assignments[p.id]).length;

  return (
    <>
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/75 border-b border-slate-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-5 h-16 flex items-center gap-5">
          <button
            onClick={() => setConfirmAbandon(true)}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition"
          >
            <ChevronLeft size={18} />
            <Home size={18} />
          </button>

          <div className="min-w-0">
            <div className="font-title text-slate-900 truncate leading-tight">{level.name}</div>
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <span className="font-mono">v{level.version}</span>
              <span>·</span>
              <Users size={12} />
              <span>{allocated}/{level.patients.length} 已分诊</span>
            </div>
          </div>

          <div className="flex-1 max-w-md mx-4 hidden md:block">
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={classNames(
                  'h-full transition-all duration-500',
                  pct === 100
                    ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                    : 'bg-gradient-to-r from-sky-400 to-blue-600'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div
            className={classNames(
              'flex items-center gap-2 px-4 py-1.5 rounded-xl font-mono font-bold tracking-wider text-lg',
              lowTime && !ended
                ? 'bg-red-50 text-red-700 border border-red-200 pulse-red'
                : 'bg-slate-900 text-white'
            )}
          >
            <Clock size={18} />
            <span>{formatTime(remaining)}</span>
          </div>

          <div className="flex items-center gap-2">
            {!ended && (
              paused ? (
                <button onClick={resume} className="btn-soft-green" title="继续">
                  <Play size={16} /> 继续
                </button>
              ) : (
                <button onClick={pause} className="btn-ghost" title="暂停">
                  <Pause size={16} /> 暂停
                </button>
              )
            )}
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-50 text-sky-700 border border-sky-100">
              <Activity size={16} />
              <span className="text-sm font-semibold">进度 {pct}%</span>
            </div>
          </div>
        </div>

        {paused && (
          <div className="bg-indigo-50 border-y border-indigo-100 px-5 py-2 text-center text-sm text-indigo-800 font-medium">
            游戏已暂停 · 计时冻结 · 操作已锁定
          </div>
        )}
      </header>

      {confirmAbandon && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card p-6 max-w-sm w-full fade-in">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-title text-lg">放弃本局？</h3>
              <button onClick={() => setConfirmAbandon(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-5">
              未完成的局面会被保留，下次可以继续。但本局不会记入成绩。
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirmAbandon(false)}>取消</button>
              <button
                className="btn-danger"
                onClick={() => {
                  abandon();
                  setConfirmAbandon(false);
                  navigate('/');
                }}
              >
                确认放弃
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
