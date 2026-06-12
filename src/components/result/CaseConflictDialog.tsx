import React from 'react';
import { AlertTriangle, AlertCircle, Info, X, GitMerge, Shield, Replace, SkipForward, Tag, Archive } from 'lucide-react';
import type { CaseConflict, CaseConflictResolution } from '../../types';
import { classNames } from '../../utils/uuid';

interface CaseConflictDialogProps {
  open: boolean;
  conflicts: CaseConflict[];
  localHasCase: boolean;
  importedHasCase: boolean;
  onClose: () => void;
  onResolve: (resolution: CaseConflictResolution) => void;
}

const CONFLICT_ICONS: Record<CaseConflict['type'], typeof AlertTriangle> = {
  HAS_LOCAL_CASE: AlertCircle,
  TAG_CONFLICT: Tag,
  ARCHIVED_STATUS_CONFLICT: Archive,
  CASE_VERSION_DIFF: Info,
};

const CONFLICT_COLORS: Record<CaseConflict['type'], string> = {
  HAS_LOCAL_CASE: 'text-amber-600 bg-amber-50 border-amber-200',
  TAG_CONFLICT: 'text-sky-600 bg-sky-50 border-sky-200',
  ARCHIVED_STATUS_CONFLICT: 'text-violet-600 bg-violet-50 border-violet-200',
  CASE_VERSION_DIFF: 'text-slate-600 bg-slate-50 border-slate-200',
};

interface ResolutionOption {
  value: CaseConflictResolution;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  {
    value: 'KEEP_LOCAL',
    label: '保留本地案例',
    hint: '忽略导入包中的案例数据，仅保留本地案例',
    icon: <Shield size={14} />,
  },
  {
    value: 'MERGE',
    label: '合并标签（推荐）',
    hint: '保留本地案例，合并标签，推荐状态取并集，归档取交集',
    icon: <GitMerge size={14} />,
  },
  {
    value: 'OVERWRITE_LOCAL',
    label: '用导入包覆盖',
    hint: '删除本地案例，使用导入包中的案例替换',
    icon: <Replace size={14} />,
  },
  {
    value: 'SKIP',
    label: '跳过案例导入',
    hint: '不导入案例数据，保持现状',
    icon: <SkipForward size={14} />,
  },
];

export function CaseConflictDialog({
  open,
  conflicts,
  localHasCase,
  importedHasCase,
  onClose,
  onResolve,
}: CaseConflictDialogProps) {
  const [selected, setSelected] = React.useState<CaseConflictResolution>('MERGE');

  React.useEffect(() => {
    if (open) {
      setSelected('MERGE');
    }
  }, [open]);

  if (!open) return null;

  const localCase = conflicts.find((c) => c.localCase)?.localCase;
  const importedCase = conflicts.find((c) => c.importedCase)?.importedCase;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">案例冲突处理</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              本地{localHasCase ? '有' : '无'}案例 · 导入包{importedHasCase ? '有' : '无'}案例
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {conflicts.map((conflict, idx) => {
            const Icon = CONFLICT_ICONS[conflict.type];
            const color = CONFLICT_COLORS[conflict.type];
            return (
              <div
                key={idx}
                className={classNames('rounded-xl border p-4', color.split(' ').slice(1, 3).join(' '))}
              >
                <div className="flex items-start gap-3">
                  <div className={classNames('p-2 rounded-lg shrink-0', color.split(' ')[0], color.split(' ')[1])}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={classNames('font-semibold text-sm', color.split(' ')[0])}>
                      {conflict.title}
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{conflict.description}</p>

                    {conflict.type === 'TAG_CONFLICT' && conflict.localTags && conflict.importedTags && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-slate-500 w-12">本地：</span>
                          <div className="flex flex-wrap gap-1">
                            {conflict.localTags.map((tag, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-white/70 border border-slate-200 text-slate-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-slate-500 w-12">导入：</span>
                          <div className="flex flex-wrap gap-1">
                            {conflict.importedTags.map((tag, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-white/70 border border-slate-200 text-slate-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {conflict.type === 'ARCHIVED_STATUS_CONFLICT' && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          本地：{conflict.localArchived ? '已归档' : '未归档'}
                        </span>
                        <span className="text-slate-400">vs</span>
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          导入：{conflict.importedArchived ? '已归档' : '未归档'}
                        </span>
                      </div>
                    )}

                    {conflict.type === 'CASE_VERSION_DIFF' && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          导入 v{conflict.caseVersionImported}
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          本地 v{conflict.caseVersionLocal}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {localCase && importedCase && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                <div className="text-xs font-semibold text-slate-500 mb-2">本地案例</div>
                <div className="text-sm font-medium text-slate-800">{localCase.title || '（无标题）'}</div>
                {localCase.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {localCase.tags.slice(0, 3).map((tag, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                        {tag}
                      </span>
                    ))}
                    {localCase.tags.length > 3 && (
                      <span className="text-[10px] text-slate-400">+{localCase.tags.length - 3}</span>
                    )}
                  </div>
                )}
                {localCase.recommended && (
                  <div className="text-[10px] text-amber-600 mt-1">★ 推荐</div>
                )}
                {localCase.archived && (
                  <div className="text-[10px] text-slate-500 mt-1">已归档</div>
                )}
              </div>
              <div className="rounded-xl border border-sky-200 p-3 bg-sky-50">
                <div className="text-xs font-semibold text-sky-500 mb-2">导入案例</div>
                <div className="text-sm font-medium text-slate-800">{importedCase.title || '（无标题）'}</div>
                {importedCase.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {importedCase.tags.slice(0, 3).map((tag, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-sky-200 text-sky-600">
                        {tag}
                      </span>
                    ))}
                    {importedCase.tags.length > 3 && (
                      <span className="text-[10px] text-sky-400">+{importedCase.tags.length - 3}</span>
                    )}
                  </div>
                )}
                {importedCase.recommended && (
                  <div className="text-[10px] text-amber-600 mt-1">★ 推荐</div>
                )}
                {importedCase.archived && (
                  <div className="text-[10px] text-slate-500 mt-1">已归档</div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-700 mb-3">选择处理方式</div>
            <div className="space-y-2">
              {RESOLUTION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={classNames(
                    'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all',
                    selected === opt.value
                      ? 'bg-white border-2 border-sky-400 shadow-sm'
                      : 'bg-white/50 border border-slate-200 hover:bg-white'
                  )}
                >
                  <input
                    type="radio"
                    name="case-resolution"
                    checked={selected === opt.value}
                    onChange={() => setSelected(opt.value)}
                    className="mt-0.5 accent-sky-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                      {opt.icon} {opt.label}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-3">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={() => onResolve(selected)}
          >
            确认处理
          </button>
        </div>
      </div>
    </div>
  );
}
