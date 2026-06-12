import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Search, ChevronDown, ChevronUp, Calendar, Award, Activity, Clock, Download, FileText, ScrollText, X } from 'lucide-react';
import { useHistoryStore } from '../store/historyStore';
import { useConfigStore } from '../store/configStore';
import { Timeline } from '../components/result/Timeline';
import { ErrorTable } from '../components/result/ErrorTable';
import { ImportButton } from '../components/result/ImportButton';
import { DIFFICULTY_LABEL, DIFFICULTY_LABEL_COLOR, type Difficulty } from '../types';
import { classNames, formatTime, formatDateTime } from '../utils/uuid';
import { computeReplayHash, loadImportLog } from '../utils/storage';
import { downloadReplayJSON, downloadReplayTXT } from '../utils/export';
import type { ImportLogEntry } from '../types';

export default function HistoryPage() {
  const navigate = useNavigate();
  const { records, filterLevelId, filterDifficulty, searchKeyword, expandedRecordId,
    setFilterLevel, setFilterDifficulty, setSearch, setExpanded, getRecord, refresh, clearAll } = useHistoryStore();
  const { levels, init, getLevel } = useConfigStore();

  useEffect(() => {
    init();
    refresh();
  }, [init, refresh]);

  const [showClearConfirm, setShowClearConfirm] = React.useState(false);
  const [showImportLog, setShowImportLog] = React.useState(false);

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
          <div className="flex items-center gap-2">
            <ImportButton
              getLevel={getLevel}
              getRecord={getRecord}
              onAnyChange={() => refresh()}
              variant="accent"
              size="sm"
            />
            <button onClick={() => setShowImportLog(true)} className="btn-ghost text-sm">
              <ScrollText size={14} /> 导入日志
            </button>
            {records.length > 0 && (
              <button onClick={() => setShowClearConfirm(true)} className="btn-soft-red">
                <Trash2 size={14} /> 清空所有
              </button>
            )}
          </div>
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
            onChange={(e) => setFilterDifficulty((e.target.value as Difficulty || null))}
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
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => navigate('/')} className="btn-primary">
                开始训练
              </button>
              <ImportButton
                getLevel={getLevel}
                getRecord={getRecord}
                onAnyChange={() => refresh()}
                variant="ghost"
                size="md"
              />
            </div>
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
                        {r.imported && (
                          <span className="chip bg-sky-50 text-sky-700 border-sky-200 text-[10px]">
                            <Download size={10} className="inline mr-0.5" />已导入
                          </span>
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
                          {expandedRecord.imported && expandedRecord.importedAt && (
                            <span className="ml-2 text-sky-600">
                              · 导入于 {formatDateTime(expandedRecord.importedAt)}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadReplayJSON(expandedLevel, expandedRecord);
                            }}
                            className="btn-ghost text-xs"
                          >
                            <FileText size={12} /> 导出 JSON
                          </button>
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

      {showImportLog && <ImportLogDialog onClose={() => setShowImportLog(false)} />}
    </div>
  );
}

function ImportLogDialog({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = React.useState<ImportLogEntry[]>([]);

  useEffect(() => {
    setLogs(loadImportLog());
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">导入日志</h3>
            <p className="text-xs text-slate-500 mt-0.5">共 {logs.length} 条记录</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {logs.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <ScrollText size={32} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">暂无导入记录</div>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={classNames(
                    'rounded-xl border p-4',
                    log.success ? 'border-slate-200 bg-white' : 'border-red-100 bg-red-50/30'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={classNames(
                          'text-xs font-bold px-1.5 py-0.5 rounded',
                          log.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        )}>
                          {log.success ? '✓ 成功' : '✗ 失败'}
                        </span>
                        <span className="text-sm font-mono text-slate-700 truncate">{log.fileName}</span>
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                        <span>{formatDateTime(log.timestamp)}</span>
                        {log.levelId && <span>关卡 {log.levelId}</span>}
                        {log.recordId && <span className="font-mono text-[10px]">ID: {log.recordId.slice(0, 8)}...</span>}
                      </div>

                      {log.errors && log.errors.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {log.errors.map((e, i) => (
                            <div key={i} className="text-xs text-red-600">
                              <span className="font-mono text-[10px] mr-1">[{e.code}]</span>
                              {e.message}
                            </div>
                          ))}
                        </div>
                      )}

                      {log.warnings && log.warnings.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {log.warnings.map((w, i) => (
                            <div key={i} className="text-xs text-amber-600">
                              <span className="font-mono text-[10px] mr-1">[{w.code}]</span>
                              {w.message}
                            </div>
                          ))}
                        </div>
                      )}

                      {log.conflictsResolved && log.conflictsResolved.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {log.conflictsResolved.map((c, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                              {c.type}: {c.resolution}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorTableLite(props: React.ComponentProps<typeof ErrorTable>) {
  return <ErrorTable {...props} />;
}
