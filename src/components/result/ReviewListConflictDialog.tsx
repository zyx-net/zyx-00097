import React from 'react';
import { AlertTriangle, AlertCircle, Info, X, GitMerge, Shield, Replace, SkipForward, User, MessageSquare, Flag, CheckCircle, Clock } from 'lucide-react';
import type { ReviewListConflict, ReviewListConflictResolution, ReviewPriority, ReviewStatus } from '../../types';
import { REVIEW_PRIORITY_LABEL, REVIEW_PRIORITY_COLOR } from '../../types';
import { classNames } from '../../utils/uuid';

interface ReviewListConflictDialogProps {
  open: boolean;
  conflicts: ReviewListConflict[];
  localHasReview: boolean;
  importedHasReview: boolean;
  onClose: () => void;
  onResolve: (resolution: ReviewListConflictResolution) => void;
}

const STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: '待讲',
  REVIEWED: '已讲',
};

const CONFLICT_ICONS: Record<ReviewListConflict['type'], typeof AlertTriangle> = {
  HAS_LOCAL_REVIEW: AlertCircle,
  PRIORITY_CONFLICT: Flag,
  STATUS_CONFLICT: CheckCircle,
  REMARK_CONFLICT: MessageSquare,
  ASSIGNEE_CONFLICT: User,
  REVIEW_VERSION_DIFF: Info,
};

const CONFLICT_COLORS: Record<ReviewListConflict['type'], string> = {
  HAS_LOCAL_REVIEW: 'text-amber-600 bg-amber-50 border-amber-200',
  PRIORITY_CONFLICT: 'text-red-600 bg-red-50 border-red-200',
  STATUS_CONFLICT: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  REMARK_CONFLICT: 'text-sky-600 bg-sky-50 border-sky-200',
  ASSIGNEE_CONFLICT: 'text-violet-600 bg-violet-50 border-violet-200',
  REVIEW_VERSION_DIFF: 'text-slate-600 bg-slate-50 border-slate-200',
};

interface ResolutionOption {
  value: ReviewListConflictResolution;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  {
    value: 'KEEP_LOCAL',
    label: '保留本地清单',
    hint: '忽略导入包中的清单数据，仅保留本地清单',
    icon: <Shield size={14} />,
  },
  {
    value: 'MERGE_REMARK',
    label: '合并备注（推荐）',
    hint: '保留本地清单，合并备注内容，优先级、负责人、状态以导入包为准',
    icon: <GitMerge size={14} />,
  },
  {
    value: 'OVERWRITE_LOCAL',
    label: '用导入包覆盖',
    hint: '删除本地清单，使用导入包中的清单替换',
    icon: <Replace size={14} />,
  },
  {
    value: 'SKIP',
    label: '跳过清单导入',
    hint: '不导入清单数据，保持现状',
    icon: <SkipForward size={14} />,
  },
];

function PriorityBadge({ priority }: { priority: ReviewPriority }) {
  const colors = REVIEW_PRIORITY_COLOR[priority];
  return (
    <span className={classNames('text-[10px] px-1.5 py-0.5 rounded border font-bold', colors.bg, colors.border, colors.text)}>
      <span className={classNames('inline-block w-1.5 h-1.5 rounded-full mr-1', colors.dot)}></span>
      {REVIEW_PRIORITY_LABEL[priority]}
    </span>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className={classNames(
      'text-[10px] px-1.5 py-0.5 rounded border font-bold',
      status === 'PENDING'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    )}>
      {status === 'PENDING' ? <Clock size={10} className="inline mr-1" /> : <CheckCircle size={10} className="inline mr-1" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ReviewListConflictDialog({
  open,
  conflicts,
  localHasReview,
  importedHasReview,
  onClose,
  onResolve,
}: ReviewListConflictDialogProps) {
  const [selected, setSelected] = React.useState<ReviewListConflictResolution>('MERGE_REMARK');

  React.useEffect(() => {
    if (open) {
      setSelected('MERGE_REMARK');
    }
  }, [open]);

  if (!open) return null;

  const localReview = conflicts.find((c) => c.localReview)?.localReview;
  const importedReview = conflicts.find((c) => c.importedReview)?.importedReview;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">待讲清单冲突处理</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              本地{localHasReview ? '有' : '无'}待讲记录 · 导入包{importedHasReview ? '有' : '无'}待讲记录
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

                    {conflict.type === 'PRIORITY_CONFLICT' && conflict.localPriority && conflict.importedPriority && (
                      <div className="mt-2 flex items-center gap-2 text-[11px]">
                        <span className="text-slate-500 w-12">本地：</span>
                        <PriorityBadge priority={conflict.localPriority} />
                        <span className="text-slate-400">vs</span>
                        <span className="text-slate-500 w-12">导入：</span>
                        <PriorityBadge priority={conflict.importedPriority} />
                      </div>
                    )}

                    {conflict.type === 'STATUS_CONFLICT' && conflict.localStatus && conflict.importedStatus && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-slate-500 w-12">本地：</span>
                        <StatusBadge status={conflict.localStatus} />
                        <span className="text-slate-400">vs</span>
                        <span className="text-slate-500 w-12">导入：</span>
                        <StatusBadge status={conflict.importedStatus} />
                      </div>
                    )}

                    {conflict.type === 'ASSIGNEE_CONFLICT' && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          本地：{conflict.localAssignee || '（未设置）'}
                        </span>
                        <span className="text-slate-400">vs</span>
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          导入：{conflict.importedAssignee || '（未设置）'}
                        </span>
                      </div>
                    )}

                    {conflict.type === 'REMARK_CONFLICT' && conflict.localRemark !== undefined && conflict.importedRemark !== undefined && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[11px]">
                          <span className="text-slate-500">本地备注：</span>
                          <span className="text-slate-700">{conflict.localRemark || '（空）'}</span>
                        </div>
                        <div className="text-[11px]">
                          <span className="text-slate-500">导入备注：</span>
                          <span className="text-slate-700">{conflict.importedRemark || '（空）'}</span>
                        </div>
                      </div>
                    )}

                    {conflict.type === 'REVIEW_VERSION_DIFF' && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          导入 v{conflict.reviewVersionImported}
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          本地 v{conflict.reviewVersionLocal}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {localReview && importedReview && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                <div className="text-xs font-semibold text-slate-500 mb-2">本地清单</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <StatusBadge status={localReview.status} />
                  <PriorityBadge priority={localReview.priority} />
                </div>
                {localReview.assignee && (
                  <div className="text-[11px] text-slate-600 mb-1 flex items-center gap-1">
                    <User size={10} /> {localReview.assignee}
                  </div>
                )}
                {localReview.remark && (
                  <div className="text-[11px] text-slate-600 line-clamp-2">
                    <MessageSquare size={10} className="inline mr-1" />{localReview.remark}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-sky-200 p-3 bg-sky-50">
                <div className="text-xs font-semibold text-sky-500 mb-2">导入清单</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <StatusBadge status={importedReview.status} />
                  <PriorityBadge priority={importedReview.priority} />
                </div>
                {importedReview.assignee && (
                  <div className="text-[11px] text-sky-700 mb-1 flex items-center gap-1">
                    <User size={10} /> {importedReview.assignee}
                  </div>
                )}
                {importedReview.remark && (
                  <div className="text-[11px] text-sky-700 line-clamp-2">
                    <MessageSquare size={10} className="inline mr-1" />{importedReview.remark}
                  </div>
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
                    name="review-resolution"
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
