import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Search, ChevronDown, ChevronUp, Calendar, Award, Activity, Clock, Download, FileText, ScrollText, X, MessageSquare, Star, Archive, BookMarked, Tag, Filter } from 'lucide-react';
import { useHistoryStore } from '../store/historyStore';
import { useConfigStore } from '../store/configStore';
import { useCaseStore } from '../store/caseStore';
import { Timeline } from '../components/result/Timeline';
import { ErrorTable } from '../components/result/ErrorTable';
import { ImportButton } from '../components/result/ImportButton';
import { CaseEditDialog } from '../components/result/CaseEditDialog';
import { DIFFICULTY_LABEL, DIFFICULTY_LABEL_COLOR, type Difficulty, type CaseInfo } from '../types';
import { classNames, formatTime, formatDateTime } from '../utils/uuid';
import { computeReplayHash, loadImportLog, loadAnnotationImportLog, loadCaseImportLog, getAnnotationCount, loadHistoryFilters, saveHistoryFilters } from '../utils/storage';
import { downloadReplayJSON, downloadReplayTXT } from '../utils/export';
import type { ImportLogEntry, AnnotationImportLogEntry, CaseImportLogEntry } from '../types';

export default function HistoryPage() {
  const navigate = useNavigate();
  const { records, filterLevelId, filterDifficulty, searchKeyword, expandedRecordId,
    setFilterLevel, setFilterDifficulty, setSearch, setExpanded, getRecord, refresh, clearAll } = useHistoryStore();
  const { levels, init, getLevel } = useConfigStore();
  const { caseMap, allTags, refresh: refreshCases, getCase, openEditDialog, hasCase } = useCaseStore();

  const [filterTags, setFilterTags] = React.useState<string[]>([]);
  const [filterHasAnnotations, setFilterHasAnnotations] = React.useState<boolean | null>(null);
  const [filterImported, setFilterImported] = React.useState<boolean | null>(null);
  const [filterRecommended, setFilterRecommended] = React.useState<boolean | null>(null);
  const [filterArchived, setFilterArchived] = React.useState<boolean | null>(null);
  const [showFilterPanel, setShowFilterPanel] = React.useState(false);

  const [showClearConfirm, setShowClearConfirm] = React.useState(false);
  const [showImportLog, setShowImportLog] = React.useState(false);

  useEffect(() => {
    init();
    refresh();
    refreshCases();
    const saved = loadHistoryFilters();
    if (saved.filterLevelId) setFilterLevel(saved.filterLevelId);
    if (saved.filterDifficulty) setFilterDifficulty(saved.filterDifficulty);
    if (saved.searchKeyword) setSearch(saved.searchKeyword);
    if (saved.filterTags) setFilterTags(saved.filterTags);
    if (saved.filterHasAnnotations !== null) setFilterHasAnnotations(saved.filterHasAnnotations);
    if (saved.filterImported !== null) setFilterImported(saved.filterImported);
    if (saved.filterRecommended !== null) setFilterRecommended(saved.filterRecommended);
    if (saved.filterArchived !== null) setFilterArchived(saved.filterArchived);
  }, [init, refresh, refreshCases, setFilterLevel, setFilterDifficulty, setSearch]);

  useEffect(() => {
    saveHistoryFilters({
      filterLevelId,
      filterDifficulty,
      searchKeyword,
      filterTags,
      filterHasAnnotations,
      filterImported,
      filterRecommended,
      filterArchived,
    });
  }, [filterLevelId, filterDifficulty, searchKeyword, filterTags, filterHasAnnotations, filterImported, filterRecommended, filterArchived]);

  const filtered = React.useMemo(() => {
    return records.filter((r) => {
      if (filterLevelId && r.levelId !== filterLevelId) return false;
      if (filterDifficulty && r.difficulty !== filterDifficulty) return false;
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const caseInfo = caseMap[r.id];
        const caseTitle = caseInfo?.title?.toLowerCase() ?? '';
        const caseDesc = caseInfo?.description?.toLowerCase() ?? '';
        const caseTags = caseInfo?.tags?.join(' ').toLowerCase() ?? '';
        if (!r.levelName.toLowerCase().includes(kw) &&
            !r.levelId.toLowerCase().includes(kw) &&
            !String(r.totalScore).includes(kw) &&
            !caseTitle.includes(kw) &&
            !caseDesc.includes(kw) &&
            !caseTags.includes(kw)) {
          return false;
        }
      }
      if (filterTags.length > 0) {
        const caseInfo = caseMap[r.id];
        if (!caseInfo) return false;
        if (!filterTags.every((t) => caseInfo.tags.includes(t))) return false;
      }
      if (filterHasAnnotations !== null) {
        const hasAnn = getAnnotationCount(r.id) > 0;
        if (filterHasAnnotations !== hasAnn) return false;
      }
      if (filterImported !== null) {
        if (filterImported !== !!r.imported) return false;
      }
      if (filterRecommended !== null) {
        const caseInfo = caseMap[r.id];
        if (filterRecommended !== !!(caseInfo?.recommended)) return false;
      }
      if (filterArchived !== null) {
        const caseInfo = caseMap[r.id];
        if (filterArchived !== !!(caseInfo?.archived)) return false;
      }
      return true;
    });
  }, [records, filterLevelId, filterDifficulty, searchKeyword, filterTags, filterHasAnnotations, filterImported, filterRecommended, filterArchived, caseMap]);

  const expandedRecord = expandedRecordId ? getRecord(expandedRecordId) : null;
  const expandedLevel = expandedRecord ? levels.find((l) => l.id === expandedRecord.levelId) : null;
  const expandedCase = expandedRecordId ? getCase(expandedRecordId) : null;

  const activeFilterCount = [
    filterTags.length > 0,
    filterHasAnnotations !== null,
    filterImported !== null,
    filterRecommended !== null,
    filterArchived !== null,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setFilterTags([]);
    setFilterHasAnnotations(null);
    setFilterImported(null);
    setFilterRecommended(null);
    setFilterArchived(null);
  };

  const toggleTagFilter = (tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="min-h-screen px-4 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="btn-ghost">
              <ArrowLeft size={16} /> 返回
            </button>
            <div>
              <h1 className="font-title text-2xl text-slate-900">历史成绩 & 案例夹</h1>
              <p className="text-sm text-slate-500">
                共 {records.length} 条训练记录 · {Object.keys(caseMap).length} 个案例
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ImportButton
              getLevel={getLevel}
              getRecord={getRecord}
              onAnyChange={() => { refresh(); refreshCases(); }}
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

        <div className="card p-4 mb-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索关卡、分数、案例标题/标签..."
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
            <button
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              className={classNames(
                'input flex items-center justify-between',
                activeFilterCount > 0 ? 'border-sky-400 bg-sky-50' : ''
              )}
            >
              <span className="flex items-center gap-2 text-sm text-slate-600">
                <Filter size={14} />
                更多筛选
                {activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-sky-500 text-white text-[10px] font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </span>
              <ChevronDown size={14} className={classNames('transition-transform', showFilterPanel && 'rotate-180')} />
            </button>
          </div>

          {showFilterPanel && (
            <div className="pt-3 border-t border-slate-100 space-y-3">
              {allTags.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1.5">
                    <Tag size={12} /> 案例标签
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTagFilter(tag)}
                        className={classNames(
                          'text-[11px] px-2 py-1 rounded-full border transition-all',
                          filterTags.includes(tag)
                            ? 'bg-sky-500 text-white border-sky-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                        )}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <FilterToggle
                  label="含教练批注"
                  icon={<MessageSquare size={12} />}
                  value={filterHasAnnotations}
                  onChange={setFilterHasAnnotations}
                />
                <FilterToggle
                  label="导入来源"
                  icon={<Download size={12} />}
                  value={filterImported}
                  onChange={setFilterImported}
                />
                <FilterToggle
                  label="推荐案例"
                  icon={<Star size={12} />}
                  value={filterRecommended}
                  onChange={setFilterRecommended}
                />
                <FilterToggle
                  label="已归档"
                  icon={<Archive size={12} />}
                  value={filterArchived}
                  onChange={setFilterArchived}
                />
              </div>

              {activeFilterCount > 0 && (
                <div className="flex justify-end">
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    清除所有筛选
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="text-sm text-slate-500 flex items-center">
            显示 {filtered.length} / {records.length} 条
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <Activity size={40} className="mx-auto mb-3 text-slate-300" />
            <div className="text-slate-500 mb-1">暂无匹配的训练记录</div>
            <p className="text-xs text-slate-400 mb-4">
              {activeFilterCount > 0 ? '试试调整筛选条件，或完成一局训练' : '完成至少一局训练后，成绩将保存在这里'}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => navigate('/')} className="btn-primary">
                开始训练
              </button>
              <ImportButton
                getLevel={getLevel}
                getRecord={getRecord}
                onAnyChange={() => { refresh(); refreshCases(); }}
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
              const caseInfo = caseMap[r.id];
              return (
                <div
                  key={r.id}
                  className={classNames(
                    'card overflow-hidden fade-in',
                    caseInfo?.recommended && 'border-amber-300 ring-1 ring-amber-200',
                    caseInfo?.archived && 'opacity-60'
                  )}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <button
                    onClick={() => setExpanded(expanded ? null : r.id)}
                    className="w-full p-4 md:p-5 text-left flex items-center gap-4 flex-wrap md:flex-nowrap"
                  >
                    <div className={classNames(
                      'w-14 h-14 rounded-xl text-white flex flex-col items-center justify-center shrink-0 shadow-md',
                      caseInfo?.recommended
                        ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                        : 'bg-gradient-to-br from-sky-400 to-blue-600'
                    )}>
                      <div className="font-mono font-bold text-xl leading-none">{r.totalScore}</div>
                      <div className="text-[10px] opacity-80">分</div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {caseInfo?.recommended && (
                          <span className="chip bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                            <Star size={10} className="inline mr-0.5 fill-current" />推荐
                          </span>
                        )}
                        <span className="font-title text-base text-slate-900 truncate">
                          {caseInfo?.title || r.levelName}
                        </span>
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
                        {(() => {
                          const cnt = getAnnotationCount(r.id);
                          if (cnt > 0) {
                            return (
                              <span className="chip bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                                <MessageSquare size={10} className="inline mr-0.5" />批注 {cnt}
                              </span>
                            );
                          }
                          return null;
                        })()}
                        {caseInfo?.archived && (
                          <span className="chip bg-slate-100 text-slate-600 border-slate-200 text-[10px]">
                            <Archive size={10} className="inline mr-0.5" />已归档
                          </span>
                        )}
                      </div>

                      {caseInfo?.description && (
                        <div className="text-xs text-slate-500 mb-1.5 line-clamp-1">
                          {caseInfo.description}
                        </div>
                      )}

                      {caseInfo?.tags && caseInfo.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {caseInfo.tags.slice(0, 5).map((tag, tagIdx) => (
                            <span
                              key={tagIdx}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200"
                            >
                              {tag}
                            </span>
                          ))}
                          {caseInfo.tags.length > 5 && (
                            <span className="text-[10px] text-slate-400">+{caseInfo.tags.length - 5}</span>
                          )}
                        </div>
                      )}

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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(r.id);
                        }}
                        className="btn-ghost text-xs"
                        title={hasCase(r.id) ? '编辑案例' : '保存为案例'}
                      >
                        <BookMarked size={14} />
                        {hasCase(r.id) ? '编辑案例' : '存为案例'}
                      </button>
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
                      {expandedCase && (
                        <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-100">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                <BookMarked size={14} className="text-sky-600" />
                                {expandedCase.title || '（案例无标题）'}
                                {expandedCase.recommended && (
                                  <span className="text-amber-500"><Star size={12} className="fill-current" /></span>
                                )}
                              </div>
                              {expandedCase.description && (
                                <div className="text-xs text-slate-600 mt-1">{expandedCase.description}</div>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(expandedRecord.id);
                              }}
                              className="btn-ghost text-xs shrink-0"
                            >
                              编辑
                            </button>
                          </div>
                          {expandedCase.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {expandedCase.tags.map((tag, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] px-2 py-0.5 rounded-full bg-white text-sky-700 border border-sky-200"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                        <div className="text-xs text-slate-500">
                          关卡 v{expandedRecord.levelVersion} · 校验码{' '}
                          <span className="font-mono">{computeReplayHash(expandedRecord.scoreSnapshot)}</span>
                          {expandedRecord.imported && expandedRecord.importedAt && (
                            <span className="ml-2 text-sky-600">
                              · 导入于 {formatDateTime(expandedRecord.importedAt)}
                            </span>
                          )}
                          {expandedCase && (
                            <span className="ml-2 text-violet-600">
                              · 案例 v{expandedCase.version} · {expandedCase.source === 'LOCAL' ? '本地创建' : '导入'}
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
            <p className="text-sm text-slate-600 mb-5">此操作不可恢复，将清除本地所有训练记录和案例数据。</p>
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

      <CaseEditDialog />
    </div>
  );
}

function FilterToggle({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const cycle = () => {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  };

  const labelText = value === null ? `全部${label}` : value ? `是（${label}）` : `否（无${label}）`;

  return (
    <button
      onClick={cycle}
      className={classNames(
        'text-xs px-3 py-2 rounded-lg border transition-all text-left flex items-center gap-2',
        value === null
          ? 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
          : value
            ? 'bg-sky-50 border-sky-300 text-sky-700'
            : 'bg-slate-100 border-slate-200 text-slate-500'
      )}
    >
      {icon}
      {labelText}
    </button>
  );
}

type UnifiedImportLog =
  | { kind: 'RECORD'; entry: ImportLogEntry }
  | { kind: 'ANNOTATION'; entry: AnnotationImportLogEntry }
  | { kind: 'CASE'; entry: CaseImportLogEntry };

const KIND_LABEL: Record<UnifiedImportLog['kind'], string> = {
  RECORD: '记录',
  ANNOTATION: '批注',
  CASE: '案例',
};

const KIND_COLOR: Record<UnifiedImportLog['kind'], string> = {
  RECORD: 'bg-slate-100 text-slate-700 border-slate-200',
  ANNOTATION: 'bg-violet-50 text-violet-700 border-violet-200',
  CASE: 'bg-amber-50 text-amber-700 border-amber-200',
};

function ImportLogDialog({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = React.useState<UnifiedImportLog[]>([]);

  useEffect(() => {
    const recordLogs: UnifiedImportLog[] = loadImportLog().map((e) => ({ kind: 'RECORD', entry: e }));
    const annotationLogs: UnifiedImportLog[] = loadAnnotationImportLog().map((e) => ({ kind: 'ANNOTATION', entry: e }));
    const caseLogs: UnifiedImportLog[] = loadCaseImportLog().map((e) => ({ kind: 'CASE', entry: e }));
    const combined = [...recordLogs, ...annotationLogs, ...caseLogs].sort(
      (a, b) => b.entry.timestamp - a.entry.timestamp
    );
    setLogs(combined);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">导入日志</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              共 {logs.length} 条 (记录 {logs.filter((l) => l.kind === 'RECORD').length} · 批注{' '}
              {logs.filter((l) => l.kind === 'ANNOTATION').length} · 案例{' '}
              {logs.filter((l) => l.kind === 'CASE').length})
            </p>
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
              {logs.map((item) => {
                const { kind, entry } = item;
                return (
                  <div
                    key={`${kind}-${entry.id}`}
                    className={classNames(
                      'rounded-xl border p-4',
                      entry.success ? 'border-slate-200 bg-white' : 'border-red-100 bg-red-50/30'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={classNames(
                            'text-xs font-bold px-1.5 py-0.5 rounded',
                            entry.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                          )}>
                            {entry.success ? '✓ 成功' : '✗ 失败'}
                          </span>
                          <span className={classNames(
                            'text-[10px] font-bold px-1.5 py-0.5 rounded border',
                            KIND_COLOR[kind]
                          )}>
                            {KIND_LABEL[kind]}
                          </span>
                          <span className="text-sm font-mono text-slate-700 truncate">{entry.fileName}</span>
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                          <span>{formatDateTime(entry.timestamp)}</span>
                          {'levelId' in entry && entry.levelId && <span>关卡 {entry.levelId}</span>}
                          {entry.recordId && <span className="font-mono text-[10px]">ID: {entry.recordId.slice(0, 8)}...</span>}
                          {'localCountBefore' in entry && (
                            <span>批注: {entry.localCountBefore} → {entry.finalCount} (导入 {entry.importedCount})</span>
                          )}
                          {'hasLocalCase' in entry && (
                            <span>
                              案例: {entry.hasLocalCase ? '本地有' : '本地无'} → {entry.finalHasCase ? '有' : '无'}
                              {entry.importedHasCase ? ' (导入包含)' : ' (导入包不含)'}
                            </span>
                          )}
                        </div>

                        {'errors' in entry && entry.errors && entry.errors.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {Array.isArray(entry.errors) && typeof entry.errors[0] === 'string'
                              ? (entry.errors as string[]).map((e, i) => (
                                  <div key={i} className="text-xs text-red-600">{e}</div>
                                ))
                              : (entry.errors as Array<{ code: string; message: string }>).map((e, i) => (
                                  <div key={i} className="text-xs text-red-600">
                                    <span className="font-mono text-[10px] mr-1">[{e.code}]</span>
                                    {e.message}
                                  </div>
                                ))}
                          </div>
                        )}

                        {'warnings' in entry && entry.warnings && entry.warnings.length > 0 && (
                          <div className="mt-1 space-y-1">
                            {entry.warnings.map((w, i) => (
                              <div key={i} className="text-xs text-amber-600">
                                <span className="font-mono text-[10px] mr-1">[{w.code}]</span>
                                {w.message}
                              </div>
                            ))}
                          </div>
                        )}

                        {'conflictsResolved' in entry && entry.conflictsResolved && entry.conflictsResolved.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {entry.conflictsResolved.map((c, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                                {c.type}: {c.resolution}
                              </span>
                            ))}
                          </div>
                        )}

                        {('conflicts' in entry) && entry.conflicts && entry.conflicts.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {entry.conflicts.map((c, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                                {c}
                              </span>
                            ))}
                          </div>
                        )}

                        {'resolution' in entry && entry.resolution && (
                          <div className="mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                              处理策略: {entry.resolution}
                            </span>
                          </div>
                        )}

                        {'tagsAdded' in entry && entry.tagsAdded && entry.tagsAdded.length > 0 && (
                          <div className="mt-1 text-[11px] text-emerald-700">
                            +标签: {entry.tagsAdded.map((t) => `#${t}`).join(' ')}
                          </div>
                        )}
                        {'tagsRemoved' in entry && entry.tagsRemoved && entry.tagsRemoved.length > 0 && (
                          <div className="mt-0.5 text-[11px] text-rose-700">
                            -标签: {entry.tagsRemoved.map((t) => `#${t}`).join(' ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
