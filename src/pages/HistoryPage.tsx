import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Search, ChevronDown, ChevronUp, Calendar, Award, Activity, Clock } from 'lucide-react';
import { useHistoryStore } from '../store/historyStore';
import { useConfigStore } from '../store/configStore';
import { Timeline } from '../components/result/Timeline';
import { ErrorTable } from '../components/result/ErrorTable';
import { DIFFICULTY_LABEL, DIFFICULTY_LABEL_COLOR } from '../types';
import { classNames, formatTime, formatDateTime } from '../utils/uuid';
import { computeReplayHash } from '../utils/storage';
import { downloadReplayTXT } from '../utils/export';

export default function HistoryPage() {
  const navigate = useNavigate();
  const { records, filterLevelId, filterDifficulty, searchKeyword, expandedRecordId,
    setFilterLevel, setFilterDifficulty, setSearch, setExpanded, getRecord, refresh, clearAll } = useHistoryStore();
  const { levels, init } = useConfigStore();

  useEffect(() => {
    init();
    refresh();
  }, [init, refresh]);

  const [showClearConfirm, setShowClearConfirm] = React.useState(false);

  const filtered = React.useMemo(() => {
    return records.filter((r) => {
      if (filterLevelId && r.levelId !== filterLevelId) return false;
      if (filterDifficulty && r.difficulty !== filterDifficulty) return false;
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        if (!r.levelName.toLowerCase().includes(kw) &&
            !r.levelId.toLowerCase().includes(kw) &&
            String(r.totalScore).includes(kw)) {
          return false;
        }
      }
      return true;
    });
  }, [records, filterLevelId, filterDifficulty, searchKeyword]);

  const expandedRecord = expandedRecordId ? getRecord(expandedRecordId) : null;
  const expandedLevel = expandedRecord ? levels.find((l) => l.id === expandedRecord.levelId) : null;

  return (
    <div className="min-h-screen px-4 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="btn-ghost">
              <ArrowLeft size={16} /> 返回
            </button>
            <div>
              <h1 className="font-title text-2xl text-slate-900">历史成绩</h1>
              <p className="text-sm text-slate-500">共 {records.length} 条训练记录</p>
            </div>
          </div>
          {records.length > 0 && (
            <button onClick={() => setShowClearConfirm(true)} className="btn-soft-red">
              <Trash2 size={14} /> 清空所有
            </button>
          )}
        </div>

        <div className="card p-4 mb-5 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索关卡或分数..."
              className="input pl-9"
            />
          </div>
          <select
            value={filterLevelId ?? ''}
            onChange={(e) => setFilterLevel(e.target.value || null)}
            className="input"
          >
            <option value="">全部关卡</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select
            value={filterDifficulty ?? ''}
            onChange={(e) => setFilterDifficulty((e.target.value as any) || null)}
            className="input"
          >
            <option value="">全部难度</option>
            <option value="EASY">简单</option>
            <option value="MEDIUM">中等</option>
            <option value="HARD">困难</option>
          </select>
          <div className="text-sm text-slate-500 flex items-center">
            显示 {filtered.length} / {records.length} 条
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <Activity size={40} className="mx-auto mb-3 text-slate-300" />
            <div className="text-slate-500 mb-1">暂无训练记录</div>
            <p className="text-xs text-slate-400 mb-4">完成至少一局训练后，成绩将保存在这里</p>
            <button onClick={() => navigate('/')} className="btn-primary">
              开始训练
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r, idx) => {
              const pct = Math.round((r.totalScore / r.maxScore) * 100);
              const expanded = expandedRecordId === r.id;
              return (
                <div key={r.id} className="card overflow-hidden fade-in" style={{ animationDelay: `${idx * 40}ms` }}>
                  <button
                    onClick={() => setExpanded(expanded ? null : r.id)}
                    className="w-full p-4 md:p-5 text-left flex items-center gap-4 flex-wrap md:flex-nowrap"
                  >
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-white flex flex-col items-center justify-center shrink-0 shadow-md">
                      <div className="font-mono font-bold text-xl leading-none">{r.totalScore}</div>
                      <div className="text-[10px] opacity-80">分</div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-title text-base text-slate-900 truncate">{r.levelName}</span>
                        <span className={classNames('chip text-[10px] font-bold', DIFFICULTY_LABEL_COLOR[r.difficulty])}>
                          {DIFFICULTY_LABEL[r.difficulty]}
                        </span>
                        {r.completed ? (
                          <span className="chip bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">已完成</span>
                        ) : (
                          <span className="chip bg-slate-100 text-slate-600 border-slate-200 text-[10px]">未完成</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {formatDateTime(r.createdAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Award size={12} />
                          准确率 {r.accuracy}%
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          用时 {formatTime(r.usedSeconds)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden max-w-md">
                        <div
                          className={classNames(
                            'h-full',
                            pct >= 85 ? 'bg-emerald-500' : pct >= 65 ? 'bg-amber-500' : 'bg-red-500'
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right hidden sm:block">
                        <div className="text-[10px] text-slate-400">排名前</div>
                        <div className="font-mono text-sm text-slate-700">
                          {Math.min(100, Math.round((idx + 1) / filtered.length * 100))}%
                        </div>
                      </div>
                      {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                    </div>
                  </button>

                  {expanded && expandedRecord && expandedLevel && (
                    <div className="border-t border-slate-100 p-4 md:p-5 bg-slate-50/50">
                      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                        <div className="text-xs text-slate-500">
                          关卡 v{expandedRecord.levelVersion} · 校验码{' '}
                          <span className="font-mono">{computeReplayHash(expandedRecord.scoreSnapshot)}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadReplayTXT(expandedLevel, expandedRecord);
                            }}
                            className="btn-ghost text-xs"
                          >
                            导出复盘
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/result/${expandedRecord.id}`);
                            }}
                            className="btn-accent text-xs"
                          >
                            查看详情
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <ErrorTableLite
                          result={expandedRecord.scoreSnapshot}
                          patientMap={Object.fromEntries(
                            expandedLevel.patients.map((p) => [p.id, { name: p.name, tags: p.tags }])
                          )}
                          reasoningMap={Object.fromEntries(
                            expandedLevel.patients.map((p) => [p.id, p.reasoning])
                          )}
                        />
                        <Timeline
                          logs={expandedRecord.sessionSnapshot.operationLog}
                          startTime={expandedRecord.sessionSnapshot.startTime}
                          patientNames={Object.fromEntries(
                            expandedLevel.patients.map((p) => [p.id, `${p.sequenceNo}号·${p.name}`])
                          )}
                          resourceNames={Object.fromEntries(
                            expandedLevel.resourceSlots.map((r) => [r.id, r.name])
                          )}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card p-6 max-w-sm w-full">
            <h3 className="font-title text-lg mb-2">确认清空所有历史？</h3>
            <p className="text-sm text-slate-600 mb-5">此操作不可恢复，将清除本地所有训练记录。</p>
            <div className="flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setShowClearConfirm(false)}>取消</button>
              <button
                className="btn-danger"
                onClick={() => {
                  clearAll();
                  setShowClearConfirm(false);
                }}
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorTableLite(props: React.ComponentProps<typeof ErrorTable>) {
  return <ErrorTable {...props} />;
}
