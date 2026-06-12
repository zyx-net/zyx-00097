import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileJson } from 'lucide-react';
import type {
  Level,
  GameRecord,
  ConflictInfo,
  ConflictResolution,
  ImportValidationResult,
  CoachAnnotation,
  AnnotationConflict,
  AnnotationConflictResolution,
  CaseInfo,
  CaseConflict,
  CaseConflictResolution,
  ReplayPackage,
} from '../../types';
import {
  validateAndNormalizeImport,
  applyResolution,
  readFileAsJSON,
  detectAnnotationConflicts,
  detectCaseConflicts,
} from '../../utils/import';
import {
  upsertHistory,
  markRecordReadonly,
  appendImportLog,
  loadAnnotations,
  replaceAnnotations,
  mergeAnnotations,
  appendAnnotationImportLog,
  clearAnnotationsForRecord,
  hasCase,
  replaceCase,
  mergeCase,
  appendCaseImportLog,
  clearCasesForRecord,
} from '../../utils/storage';
import { ImportConflictDialog } from './ImportConflictDialog';
import { AnnotationConflictDialog } from './AnnotationConflictDialog';
import { CaseConflictDialog } from './CaseConflictDialog';
import { useAnnotationStore } from '../../store/annotationStore';
import { useCaseStore } from '../../store/caseStore';
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
  const [annotationConflictOpen, setAnnotationConflictOpen] = React.useState(false);
  const [caseConflictOpen, setCaseConflictOpen] = React.useState(false);
  const [pendingResult, setPendingResult] = React.useState<ImportValidationResult | null>(null);
  const [pendingFileName, setPendingFileName] = React.useState<string>('');
  const [pendingAnnotations, setPendingAnnotations] = React.useState<CoachAnnotation[] | null>(null);
  const [pendingAnnotationConflicts, setPendingAnnotationConflicts] = React.useState<AnnotationConflict[]>([]);
  const [pendingCase, setPendingCase] = React.useState<CaseInfo | null>(null);
  const [pendingCaseConflicts, setPendingCaseConflicts] = React.useState<CaseConflict[]>([]);
  const [pendingFinalRecord, setPendingFinalRecord] = React.useState<GameRecord | null>(null);
  const [pendingAfterAnnotations, setPendingAfterAnnotations] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState | null>(null);

  const openConflictDialog = useAnnotationStore((s) => s.openConflictDialog);
  const openCaseConflictDialog = useCaseStore((s) => s.openConflictDialog);

  const showToast = React.useCallback((t: ToastState) => {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  }, []);

  const handleCaseDirect = React.useCallback(
    (
      recordId: string,
      importedCase: CaseInfo | undefined,
      fileName: string
    ) => {
      if (!importedCase) {
        appendCaseImportLog({
          fileName,
          recordId,
          success: true,
          hasLocalCase: hasCase(recordId),
          importedHasCase: false,
          finalHasCase: hasCase(recordId),
        });
        return;
      }

      const caseConflicts = detectCaseConflicts(recordId, importedCase, 1);
      const hasLocal = hasCase(recordId);

      if (caseConflicts.length > 0) {
        setPendingCase(importedCase);
        setPendingCaseConflicts(caseConflicts);
        setCaseConflictOpen(true);
        setPendingFileName(fileName);
        openCaseConflictDialog(caseConflicts, importedCase, recordId, fileName);
        return;
      }

      const merged = mergeCase(recordId, importedCase);
      appendCaseImportLog({
        fileName,
        recordId,
        success: true,
        hasLocalCase: hasLocal,
        importedHasCase: true,
        finalHasCase: true,
        tagsAdded: importedCase.tags.filter((t) => !hasLocal ? true : !(hasCase(recordId) && useCaseStore.getState().getCase(recordId)?.tags.includes(t))),
      });
    },
    [openCaseConflictDialog]
  );

  const finalizeImport = React.useCallback(
    (
      record: GameRecord,
      conflicts: ConflictInfo[] | undefined,
      resolutions: Record<number, ConflictResolution> | undefined,
      fileName: string,
      warnings: ImportValidationResult['warnings'],
      errors: ImportValidationResult['errors'],
      rawPkg?: ReplayPackage
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

      if (overwriteMode) {
        clearAnnotationsForRecord(finalRecord.id);
        clearCasesForRecord(finalRecord.id);
      }

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

      setPendingFinalRecord(finalRecord);
      setPendingFileName(fileName);
      setPendingAfterAnnotations(false);

      if (rawPkg && rawPkg.annotations && rawPkg.annotations.length > 0) {
        const annConflicts = detectAnnotationConflicts(
          finalRecord.id,
          rawPkg.annotations,
          rawPkg.annotationVersion
        );
        if (annConflicts.length > 0) {
          setPendingAnnotations(rawPkg.annotations);
          setPendingAnnotationConflicts(annConflicts);
          setAnnotationConflictOpen(true);
        } else {
          const localCountBefore = loadAnnotations(finalRecord.id).length;
          const merged = mergeAnnotations(
            finalRecord.id,
            rawPkg.annotations.map((a) => ({ ...a, source: 'IMPORTED' as const }))
          );
          appendAnnotationImportLog({
            fileName,
            recordId: finalRecord.id,
            success: true,
            localCountBefore,
            importedCount: rawPkg.annotations.length,
            finalCount: merged.length,
          });
          if (merged.length > 0) {
            showToast({ kind: 'success', title: `${merged.length} 条批注已导入` });
          }
          if (rawPkg.caseInfo) {
            handleCaseDirect(finalRecord.id, rawPkg.caseInfo, fileName);
          } else {
            appendCaseImportLog({
              fileName,
              recordId: finalRecord.id,
              success: true,
              hasLocalCase: hasCase(finalRecord.id),
              importedHasCase: false,
              finalHasCase: hasCase(finalRecord.id),
            });
          }
        }
      } else {
        appendAnnotationImportLog({
          fileName,
          recordId: finalRecord.id,
          success: true,
          localCountBefore: loadAnnotations(finalRecord.id).length,
          importedCount: 0,
          finalCount: loadAnnotations(finalRecord.id).length,
        });
        if (rawPkg?.caseInfo) {
          handleCaseDirect(finalRecord.id, rawPkg.caseInfo, fileName);
        } else {
          appendCaseImportLog({
            fileName,
            recordId: finalRecord.id,
            success: true,
            hasLocalCase: hasCase(finalRecord.id),
            importedHasCase: false,
            finalHasCase: hasCase(finalRecord.id),
          });
        }
      }

      setBusy(false);
    },
    [onImported, onAnyChange, showToast, handleCaseDirect]
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

      const pkg = (raw as { replayPackage?: ReplayPackage } | undefined)?.replayPackage ?? (raw as ReplayPackage);
      finalizeImport(
        result.normalizedRecord,
        undefined,
        undefined,
        fileName,
        result.warnings,
        result.errors,
        pkg
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
    const rawPkg = pendingResult.replayPackage;
    finalizeImport(
      pendingResult.normalizedRecord,
      pendingResult.conflicts,
      resolutions,
      pendingFileName,
      pendingResult.warnings,
      pendingResult.errors,
      rawPkg
    );
    setPendingResult(null);
    setPendingFileName('');
  };

  const handleAnnotationResolve = (resolution: AnnotationConflictResolution) => {
    if (!pendingFinalRecord || !pendingAnnotations) {
      setAnnotationConflictOpen(false);
      return;
    }
    const localCountBefore = loadAnnotations(pendingFinalRecord.id).length;
    let finalCount = localCountBefore;
    const conflictTypes = pendingAnnotationConflicts.map((c) => c.type);

    if (resolution === 'KEEP_LOCAL') {
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: true,
        localCountBefore,
        importedCount: pendingAnnotations.length,
        finalCount: localCountBefore,
        resolution: 'KEEP_LOCAL',
        conflicts: conflictTypes,
      });
      showToast({ kind: 'warn', title: '保留本地批注', detail: `${localCountBefore} 条本地批注未被修改` });
    } else if (resolution === 'OVERWRITE_LOCAL') {
      const imported = pendingAnnotations.map((a) => ({ ...a, source: 'IMPORTED' as const }));
      replaceAnnotations(pendingFinalRecord.id, imported);
      finalCount = imported.length;
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: true,
        localCountBefore,
        importedCount: pendingAnnotations.length,
        finalCount,
        resolution: 'OVERWRITE_LOCAL',
        conflicts: conflictTypes,
      });
      showToast({ kind: 'success', title: '批注已覆盖', detail: `使用 ${finalCount} 条导入批注替换本地批注` });
    } else if (resolution === 'MERGE') {
      const merged = mergeAnnotations(pendingFinalRecord.id, pendingAnnotations);
      finalCount = merged.length;
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: true,
        localCountBefore,
        importedCount: pendingAnnotations.length,
        finalCount,
        resolution: 'MERGE',
        conflicts: conflictTypes,
      });
      const added = finalCount - localCountBefore;
      showToast({ kind: 'success', title: '批注已合并', detail: added > 0 ? `新增 ${added} 条不重复批注` : '已存在相同目标批注，无新增' });
    } else {
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: false,
        localCountBefore,
        importedCount: pendingAnnotations.length,
        finalCount: localCountBefore,
        resolution: 'SKIP',
        conflicts: conflictTypes,
        errors: ['用户选择跳过批注导入'],
      });
    }

    onAnyChange?.();

    const pkg = pendingResult?.replayPackage;
    if (pkg?.caseInfo) {
      handleCaseDirect(pendingFinalRecord.id, pkg.caseInfo, pendingFileName);
    } else {
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: true,
        hasLocalCase: hasCase(pendingFinalRecord.id),
        importedHasCase: false,
        finalHasCase: hasCase(pendingFinalRecord.id),
      });
    }

    setAnnotationConflictOpen(false);
    setPendingAnnotations(null);
    setPendingAnnotationConflicts([]);
    setPendingFinalRecord(null);
    setPendingFileName('');
  };

  const handleCaseResolve = (resolution: CaseConflictResolution) => {
    if (!pendingFinalRecord || !pendingCase) {
      setCaseConflictOpen(false);
      return;
    }
    const hasLocal = hasCase(pendingFinalRecord.id);
    const conflictTypes = pendingCaseConflicts.map((c) => c.type);

    if (resolution === 'KEEP_LOCAL') {
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: true,
        hasLocalCase: hasLocal,
        importedHasCase: true,
        finalHasCase: hasLocal,
        resolution: 'KEEP_LOCAL',
        conflicts: conflictTypes,
      });
      showToast({ kind: 'warn', title: '保留本地案例', detail: '本地案例未被修改' });
    } else if (resolution === 'OVERWRITE_LOCAL') {
      replaceCase(pendingFinalRecord.id, pendingCase);
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: true,
        hasLocalCase: hasLocal,
        importedHasCase: true,
        finalHasCase: true,
        resolution: 'OVERWRITE_LOCAL',
        conflicts: conflictTypes,
      });
      showToast({ kind: 'success', title: '案例已覆盖', detail: '使用导入案例替换了本地案例' });
    } else if (resolution === 'MERGE') {
      const merged = mergeCase(pendingFinalRecord.id, pendingCase);
      const tagsAdded = pendingCase.tags.filter(
        (t) => !useCaseStore.getState().getCase(pendingFinalRecord.id)?.tags.includes(t)
      );
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: true,
        hasLocalCase: hasLocal,
        importedHasCase: true,
        finalHasCase: true,
        resolution: 'MERGE',
        conflicts: conflictTypes,
        tagsAdded,
      });
      showToast({
        kind: 'success',
        title: '案例已合并',
        detail: tagsAdded.length > 0 ? `新增 ${tagsAdded.length} 个标签：${tagsAdded.join('、')}` : '标签已合并',
      });
    } else {
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingFinalRecord.id,
        success: false,
        hasLocalCase: hasLocal,
        importedHasCase: true,
        finalHasCase: hasLocal,
        resolution: 'SKIP',
        conflicts: conflictTypes,
        errors: ['用户选择跳过案例导入'],
      });
    }

    onAnyChange?.();
    setCaseConflictOpen(false);
    setPendingCase(null);
    setPendingCaseConflicts([]);
    setPendingFinalRecord(null);
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

      <AnnotationConflictDialog
        open={annotationConflictOpen}
        conflicts={pendingAnnotationConflicts}
        localCount={pendingFinalRecord ? loadAnnotations(pendingFinalRecord.id).length : 0}
        importedCount={pendingAnnotations?.length ?? 0}
        onClose={() => {
          if (pendingFinalRecord && pendingAnnotations) {
            appendAnnotationImportLog({
              fileName: pendingFileName,
              recordId: pendingFinalRecord.id,
              success: false,
              localCountBefore: loadAnnotations(pendingFinalRecord.id).length,
              importedCount: pendingAnnotations.length,
              finalCount: loadAnnotations(pendingFinalRecord.id).length,
              errors: ['用户取消了批注冲突处理'],
            });
          }
          setAnnotationConflictOpen(false);
          setPendingAnnotations(null);
          setPendingAnnotationConflicts([]);
          setPendingFinalRecord(null);
          setPendingFileName('');
        }}
        onResolve={handleAnnotationResolve}
      />

      <CaseConflictDialog
        open={caseConflictOpen}
        conflicts={pendingCaseConflicts}
        localHasCase={pendingFinalRecord ? hasCase(pendingFinalRecord.id) : false}
        importedHasCase={!!pendingCase}
        onClose={() => {
          if (pendingFinalRecord && pendingCase) {
            appendCaseImportLog({
              fileName: pendingFileName,
              recordId: pendingFinalRecord.id,
              success: false,
              hasLocalCase: hasCase(pendingFinalRecord.id),
              importedHasCase: true,
              finalHasCase: hasCase(pendingFinalRecord.id),
              errors: ['用户取消了案例冲突处理'],
            });
          }
          setCaseConflictOpen(false);
          setPendingCase(null);
          setPendingCaseConflicts([]);
          setPendingFinalRecord(null);
          setPendingFileName('');
        }}
        onResolve={handleCaseResolve}
      />
    </>
  );
}
