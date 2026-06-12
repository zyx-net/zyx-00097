import React from 'react';
import { AlertTriangle, AlertCircle, Info, X, GitMerge, Shield, Replace, SkipForward } from 'lucide-react';
import type { AnnotationConflict, AnnotationConflictResolution } from '../../types';
import { classNames } from '../../utils/uuid';

interface AnnotationConflictDialogProps {
  open: boolean;
  conflicts: AnnotationConflict[];
  localCount: number;
  importedCount: number;
  onClose: () => void;
  onResolve: (resolution: AnnotationConflictResolution) => void;
}

const CONFLICT_ICONS: Record<AnnotationConflict['type'], typeof AlertTriangle> = {
  HAS_LOCAL_ANNOTATIONS: AlertCircle,
  DUPLICATE_ANNOTATION: AlertTriangle,
  ANNOTATION_VERSION_DIFF: Info,
  TIMESTAMP_CONFLICT: AlertCircle,
};

const CONFLICT_COLORS: Record<AnnotationConflict['type'], string> = {
  HAS_LOCAL_ANNOTATIONS: 'text-amber-600 bg-amber-50 border-amber-200',
  DUPLICATE_ANNOTATION: 'text-orange-600 bg-orange-50 border-orange-200',
  ANNOTATION_VERSION_DIFF: 'text-sky-600 bg-sky-50 border-sky-200',
  TIMESTAMP_CONFLICT: 'text-violet-600 bg-violet-50 border-violet-200',
};

interface ResolutionOption {
  value: AnnotationConflictResolution;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  {
    value: 'KEEP_LOCAL',
    label: '保留本地批注',
    hint: '忽略导入包中的批注，仅保留本地现有批注',
    icon: <Shield size={14} />,
  },
  {
    value: 'MERGE',
    label: '合并（推荐）',
    hint: '保留本地批注，并追加导入包中不重复的批注',
    icon: <GitMerge size={14} />,
  },
  {
    value: 'OVERWRITE_LOCAL',
    label: '用导入包覆盖',
    hint: '删除本地所有批注，使用导入包中的批注替换',
    icon: <Replace size={14} />,
  },
  {
    value: 'SKIP',
    label: '跳过批注导入',
    hint: '不导入任何批注，保持现状',
    icon: <SkipForward size={14} />,
  },
];

export function AnnotationConflictDialog({
  open,
  conflicts,
  localCount,
  importedCount,
  onClose,
  onResolve,
}: AnnotationConflictDialogProps) {
  const [selected, setSelected] = React.useState<AnnotationConflictResolution>('MERGE');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">批注冲突处理</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              本地 {localCount} 条批注 · 导入包 {importedCount} 条批注
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

                    {conflict.type === 'ANNOTATION_VERSION_DIFF' && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          导入 v{conflict.annotationVersionImported}
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          本地 v{conflict.annotationVersionLocal}
                        </span>
                      </div>
                    )}

                    {conflict.type === 'DUPLICATE_ANNOTATION' && (
                      <div className="mt-2 text-xs text-amber-700">
                        同一时间点或患者的批注将保留本地版本
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

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
                    name="annotation-resolution"
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
