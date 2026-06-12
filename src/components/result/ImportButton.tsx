import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileJson } from 'lucide-react';
import type { Level, GameRecord, ConflictInfo, ConflictResolution, ImportValidationResult } from '../../types';
import {
  validateAndNormalizeImport,
  applyResolution,
  readFileAsJSON,
} from '../../utils/import';
import {
  upsertHistory,
  markRecordReadonly,
  appendImportLog,
} from '../../utils/storage';
import { ImportConflictDialog } from './ImportConflictDialog';
import { classNames } from '../../utils/uuid';

interface ImportButtonProps {
  getLevel: (id: string) => Level | null;
  getRecord: (id: string) => GameRecord | null;
  onImported?: (record: GameRecord) => void;
  onAnyChange?: () => void;
  variant?: 'primary' | 'ghost' | 'accent';
  size?: 'sm' | 'md';
}

type ToastKind = 'success' | 'error' | 'warn';
interface ToastState {
  kind: ToastKind;
  title: string;
  detail?: string;
}

export function ImportButton({
  getLevel,
  getRecord,
  onImported,
  onAnyChange,
  variant = 'ghost',
  size = 'md',
}: ImportButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [conflictOpen, setConflictOpen] = React.useState(false);
  const [pendingResult, setPendingResult] = React.useState<ImportValidationResult | null>(null);
  const [pendingFileName, setPendingFileName] = React.useState<string>('');
  const [toast, setToast] = React.useState<ToastState | null>(null);

  const showToast = React.useCallback((t: ToastState) => {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  }, []);

  const finalizeImport = React.useCallback(
    (
      record: GameRecord,
      conflicts: ConflictInfo[] | undefined,
      resolutions: Record<number, ConflictResolution> | undefined,
      fileName: string,
      warnings: ImportValidationResult['warnings'],
      errors: ImportValidationResult['errors']
    ) => {
      let finalRecord = record;
      const resolved: { type: ConflictInfo['type']; resolution: ConflictResolution }[] = [];
      let skipped = false;

      if (conflicts && resolutions) {
        for (let i = 0; i < conflicts.length; i++) {
          const conflict = conflicts[i];
          const resolution = resolutions[i];
          if (!resolution) continue;
          resolved.push({ type: conflict.type, resolution });
          const applied = applyResolution(finalRecord, resolution, conflict);
          if (applied.skip) {
            skipped = true;
            break;
          }
          finalRecord = applied.record;
        }
      }

      if (skipped) {
        appendImportLog({
          fileName,
          success: false,
          recordId: record.id,
          levelId: record.levelId,
          errors: [{ code: 'USER_SKIPPED', message: '用户选择跳过该记录' }],
          conflictsResolved: resolved,
        });
        showToast({ kind: 'warn', title: '已跳过导入', detail: '用户选择不导入该记录' });
        setBusy(false);
        return;
      }

      const overwriteMode =
        resolved.find((r) => r.type === 'DUPLICATE_ID' && r.resolution === 'OVERWRITE') !== undefined;
      upsertHistory(finalRecord, overwriteMode ? 'overwrite' : 'insert');
      markRecordReadonly(finalRecord.id);

      appendImportLog({
        fileName,
        success: true,
        recordId: finalRecord.id,
        levelId: finalRecord.levelId,
        warnings,
        errors,
        conflictsResolved: resolved.length > 0 ? resolved : undefined,
      });

      const detailParts: string[] = [];
      if (warnings?.length) detailParts.push(`${warnings.length} 条提示`);
      if (resolved.length) detailParts.push(`${resolved.length} 个冲突已处理`);

      showToast({
        kind: 'success',
        title: '导入成功',
        detail: detailParts.length > 0 ? detailParts.join('，') : undefined,
      });

      onImported?.(finalRecord);
      onAnyChange?.();
      setBusy(false);
    },
    [onImported, onAnyChange, showToast]
  );

  const handleFile = React.useCallback(
    async (file: File) => {
      setBusy(true);
      const fileName = file.name;

      let raw: unknown;
      try {
        raw = await readFileAsJSON(file);
      } catch (e) {
        const message = e instanceof Error ? e.message : '未知错误';
        appendImportLog({
          fileName,
          success: false,
          errors: [{ code: 'READ_FAILED', message, suggestion: '请检查文件编码是否为 UTF-8' }],
        });
        showToast({ kind: 'error', title: '读取文件失败', detail: message });
        setBusy(false);
        return;
      }

      const result = validateAndNormalizeImport(raw, getLevel, getRecord);

      if (!result.ok || !result.normalizedRecord) {
        appendImportLog({
          fileName,
          success: false,
          errors: result.errors,
          warnings: result.warnings,
        });
        const fatal = result.errors?.find((e) =>
          ['EMPTY', 'NOT_OBJECT', 'MISSING_EXPORT_VERSION', 'UNSUPPORTED_VERSION', 'NO_LEVEL_ID', 'LEVEL_NOT_FOUND'].includes(e.code)
        );
        showToast({
          kind: 'error',
          title: '导入失败',
          detail: fatal?.message ?? result.errors?.[0]?.message ?? '校验未通过',
        });
        setBusy(false);
        return;
      }

      if (result.conflicts && result.conflicts.length > 0) {
        setPendingResult(result);
        setPendingFileName(fileName);
        setConflictOpen(true);
        setBusy(false);
        return;
      }

      finalizeImport(
        result.normalizedRecord,
        undefined,
        undefined,
        fileName,
        result.warnings,
        result.errors
      );
    },
    [getLevel, getRecord, showToast, finalizeImport]
  );

  const handleOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    e.target.value = '';
  };

  const handleResolve = (resolutions: Record<number, ConflictResolution>) => {
    if (!pendingResult?.normalizedRecord) return;
    setConflictOpen(false);
    setBusy(true);
    finalizeImport(
      pendingResult.normalizedRecord,
      pendingResult.conflicts,
      resolutions,
      pendingFileName,
      pendingResult.warnings,
      pendingResult.errors
    );
    setPendingResult(null);
    setPendingFileName('');
  };

  const variantCls =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'accent'
        ? 'btn-accent'
        : 'btn-ghost';

  const sizeCls = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <>
      <label className={classNames('cursor-pointer inline-flex items-center gap-2', variantCls, sizeCls)}>
        <FileJson size={14} />
        {busy ? '处理中...' : '导入 JSON'}
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleOnChange}
          className="hidden"
          disabled={busy}
        />
      </label>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] animate-in fade-in slide-in-from-bottom-4">
          <div
            className={classNames(
              'card shadow-xl px-4 py-3 flex items-start gap-3 max-w-sm',
              toast.kind === 'success' && 'border-emerald-200',
              toast.kind === 'error' && 'border-red-200',
              toast.kind === 'warn' && 'border-amber-200'
            )}
          >
            {toast.kind === 'success' && <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />}
            {toast.kind === 'error' && <XCircle size={18} className="text-red-600 shrink-0 mt-0.5" />}
            {toast.kind === 'warn' && <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800">{toast.title}</div>
              {toast.detail && (
                <div className="text-xs text-slate-600 mt-0.5">{toast.detail}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <ImportConflictDialog
        open={conflictOpen}
        conflicts={pendingResult?.conflicts ?? []}
        warnings={pendingResult?.warnings}
        onClose={() => {
          if (pendingResult?.normalizedRecord) {
            appendImportLog({
              fileName: pendingFileName,
              success: false,
              recordId: pendingResult.normalizedRecord.id,
              levelId: pendingResult.normalizedRecord.levelId,
              errors: [{ code: 'USER_CANCELLED', message: '用户关闭了冲突处理对话框' }],
            });
          }
          setConflictOpen(false);
          setPendingResult(null);
          setPendingFileName('');
        }}
        onResolve={handleResolve}
      />
    </>
  );
}
