import React from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import type { ConflictInfo, ConflictResolution } from '../../types';
import { classNames, formatDateTime } from '../../utils/uuid';

interface ImportConflictDialogProps {
  open: boolean;
  conflicts: ConflictInfo[];
  onClose: () => void;
  onResolve: (resolutions: Record<number, ConflictResolution>) => void;
  warnings?: { code: string; message: string }[];
}

const CONFLICT_ICONS: Record<ConflictInfo['type'], typeof AlertTriangle> = {
  DUPLICATE_ID: AlertCircle,
  LEVEL_VERSION_MISMATCH: AlertTriangle,
  MISSING_FIELDS_LEGACY: Info,
};

const CONFLICT_COLORS: Record<ConflictInfo['type'], string> = {
  DUPLICATE_ID: 'text-amber-600 bg-amber-50 border-amber-200',
  LEVEL_VERSION_MISMATCH: 'text-orange-600 bg-orange-50 border-orange-200',
  MISSING_FIELDS_LEGACY: 'text-sky-600 bg-sky-50 border-sky-200',
};

const RESOLUTION_OPTIONS: Record<ConflictInfo['type'], { value: ConflictResolution; label: string; hint?: string }[]> = {
  DUPLICATE_ID: [
    { value: 'KEEP_BOTH', label: '两者都保留', hint: '为导入记录重新生成 ID' },
    { value: 'OVERWRITE', label: '覆盖本地记录', hint: '用导入的记录替换现有记录' },
    { value: 'SKIP', label: '跳过此记录', hint: '保留本地现有记录' },
  ],
  LEVEL_VERSION_MISMATCH: [
    { value: 'IMPORT_AS_IS', label: '仍然导入', hint: '接受复算偏差风险' },
    { value: 'SKIP', label: '取消导入', hint: '先更新关卡配置' },
  ],
  MISSING_FIELDS_LEGACY: [
    { value: 'IMPORT_AS_IS', label: '导入（自动补齐）', hint: '缺失字段将使用默认值' },
    { value: 'SKIP', label: '取消导入', hint: '建议用新版本系统重新导出' },
  ],
};

export function ImportConflictDialog({
  open,
  conflicts,
  onClose,
  onResolve,
  warnings = [],
}: ImportConflictDialogProps) {
  const [selections, setSelections] = React.useState<Record<number, ConflictResolution>>({});

  React.useEffect(() => {
    if (open) {
      const init: Record<number, ConflictResolution> = {};
      conflicts.forEach((c, idx) => {
        const defaults: Partial<Record<ConflictInfo['type'], ConflictResolution>> = {
          DUPLICATE_ID: 'KEEP_BOTH',
          LEVEL_VERSION_MISMATCH: 'IMPORT_AS_IS',
          MISSING_FIELDS_LEGACY: 'IMPORT_AS_IS',
        };
        init[idx] = defaults[c.type] ?? 'SKIP';
      });
      setSelections(init);
    }
  }, [open, conflicts]);

  if (!open) return null;

  const canConfirm = Object.keys(selections).length === conflicts.length;

  const handleConfirm = () => {
    onResolve(selections);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">导入冲突处理</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              检测到 {conflicts.length} 个冲突，请选择处理方式
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
            const options = RESOLUTION_OPTIONS[conflict.type];
            return (
              <div
                key={idx}
                className={classNames('rounded-xl border p-4', color.split(' ').slice(1, 3).join(' '))}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className={classNames('p-2 rounded-lg shrink-0', color.split(' ')[0], color.split(' ')[1])}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={classNames('font-semibold text-sm', color.split(' ')[0])}>
                      {conflict.title}
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{conflict.description}</p>

                    {conflict.type === 'DUPLICATE_ID' && conflict.localRecord && (
                      <div className="mt-3 bg-white/70 rounded-lg p-3 text-xs space-y-1 border border-slate-200">
                        <div className="font-mono text-[10px] text-slate-500 break-all">
                          ID: {conflict.localRecord.id}
                        </div>
                        <div className="flex items-center gap-4 text-slate-700">
                          <span>⏱ {formatDateTime(conflict.localRecord.createdAt)}</span>
                          <span className="font-semibold">
                            ⭐ {conflict.localRecord.totalScore} / {conflict.localRecord.maxScore}
                          </span>
                          <span>
                            🎯 {conflict.localRecord.accuracy}%
                          </span>
                        </div>
                        {conflict.localRecord.imported && (
                          <div className="text-sky-600">
                            💾 该记录本身也是导入的（{formatDateTime(conflict.localRecord.importedAt ?? 0)}）
                          </div>
                        )}
                      </div>
                    )}

                    {conflict.type === 'LEVEL_VERSION_MISMATCH' && (
                      <div className="mt-3 flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          导入 v{conflict.importedLevelVersion}
                        </span>
                        <span className="text-slate-400">→</span>
                        <span className="px-2 py-1 rounded bg-white/70 border border-slate-200">
                          本地 v{conflict.localLevelVersion}
                        </span>
                      </div>
                    )}

                    {conflict.type === 'MISSING_FIELDS_LEGACY' && conflict.missingFields && (
                      <div className="mt-3">
                        <div className="text-xs text-slate-500 mb-1">缺失字段：</div>
                        <div className="flex flex-wrap gap-1">
                          {conflict.missingFields.slice(0, 10).map((f) => (
                            <span
                              key={f}
                              className="px-1.5 py-0.5 rounded bg-white/70 border border-slate-200 text-[10px] font-mono text-slate-600"
                            >
                              {f}
                            </span>
                          ))}
                          {conflict.missingFields.length > 10 && (
                            <span className="text-[10px] text-slate-500">
                              +{conflict.missingFields.length - 10} 更多
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  {options.map((opt) => (
                    <label
                      key={opt.value}
                      className={classNames(
                        'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all',
                        selections[idx] === opt.value
                          ? 'bg-white border-2 border-sky-400 shadow-sm'
                          : 'bg-white/50 border border-slate-200 hover:bg-white'
                      )}
                    >
                      <input
                        type="radio"
                        name={`conflict-${idx}`}
                        checked={selections[idx] === opt.value}
                        onChange={() => setSelections({ ...selections, [idx]: opt.value })}
                        className="mt-0.5 accent-sky-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800">{opt.label}</div>
                        {opt.hint && (
                          <div className="text-[11px] text-slate-500 mt-0.5">{opt.hint}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {warnings.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                <Info size={14} className="text-slate-500" />
                其他提示 ({warnings.length})
              </div>
              <ul className="space-y-1">
                {warnings.map((w, i) => (
                  <li key={i} className="text-xs text-slate-600 flex gap-2">
                    <span className="text-slate-400 shrink-0">•</span>
                    <span>
                      <span className="font-mono text-[10px] text-slate-500 mr-1">[{w.code}]</span>
                      {w.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-3">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            确认处理并导入
          </button>
        </div>
      </div>
    </div>
  );
}
