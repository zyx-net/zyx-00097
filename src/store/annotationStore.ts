import { create } from 'zustand';
import type { CoachAnnotation, AnnotationSeverity, AnnotationTargetType, AnnotationConflict, AnnotationConflictResolution } from '../types';
import {
  loadAnnotations,
  addAnnotation as storageAdd,
  updateAnnotation as storageUpdate,
  deleteAnnotation as storageDelete,
  replaceAnnotations,
  mergeAnnotations as storageMerge,
  clearAnnotationsForRecord,
  getAnnotationCount,
  appendAnnotationImportLog,
} from '../utils/storage';

interface AnnotationState {
  annotationsMap: Record<string, CoachAnnotation[]>;
  conflictDialogOpen: boolean;
  pendingConflicts: AnnotationConflict[];
  pendingImportedAnnotations: CoachAnnotation[] | null;
  pendingRecordId: string | null;
  pendingFileName: string;

  loadForRecord: (recordId: string) => CoachAnnotation[];
  add: (recordId: string, data: { targetType: AnnotationTargetType; timestampMs?: number; patientId?: string; severity: AnnotationSeverity; content: string; suggestion: string }) => CoachAnnotation;
  update: (recordId: string, annotationId: string, updates: Partial<Pick<CoachAnnotation, 'severity' | 'content' | 'suggestion'>>) => void;
  remove: (recordId: string, annotationId: string) => void;
  replace: (recordId: string, annotations: CoachAnnotation[]) => void;
  merge: (recordId: string, incoming: CoachAnnotation[]) => CoachAnnotation[];
  clearForRecord: (recordId: string) => void;
  getCount: (recordId: string) => number;

  openConflictDialog: (conflicts: AnnotationConflict[], imported: CoachAnnotation[], recordId: string, fileName: string) => void;
  closeConflictDialog: () => void;
  resolveConflicts: (resolution: AnnotationConflictResolution) => void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  annotationsMap: {},
  conflictDialogOpen: false,
  pendingConflicts: [],
  pendingImportedAnnotations: null,
  pendingRecordId: null,
  pendingFileName: '',

  loadForRecord: (recordId) => {
    const cached = get().annotationsMap[recordId];
    if (cached) return cached;
    const loaded = loadAnnotations(recordId);
    set((s) => ({ annotationsMap: { ...s.annotationsMap, [recordId]: loaded } }));
    return loaded;
  },

  add: (recordId, data) => {
    const ann = storageAdd(recordId, data);
    const updated = loadAnnotations(recordId);
    set((s) => ({ annotationsMap: { ...s.annotationsMap, [recordId]: updated } }));
    return ann;
  },

  update: (recordId, annotationId, updates) => {
    storageUpdate(recordId, annotationId, updates);
    const updated = loadAnnotations(recordId);
    set((s) => ({ annotationsMap: { ...s.annotationsMap, [recordId]: updated } }));
  },

  remove: (recordId, annotationId) => {
    storageDelete(recordId, annotationId);
    const updated = loadAnnotations(recordId);
    set((s) => ({ annotationsMap: { ...s.annotationsMap, [recordId]: updated } }));
  },

  replace: (recordId, annotations) => {
    replaceAnnotations(recordId, annotations);
    set((s) => ({ annotationsMap: { ...s.annotationsMap, [recordId]: [...annotations] } }));
  },

  merge: (recordId, incoming) => {
    const merged = storageMerge(recordId, incoming);
    set((s) => ({ annotationsMap: { ...s.annotationsMap, [recordId]: [...merged] } }));
    return merged;
  },

  clearForRecord: (recordId) => {
    clearAnnotationsForRecord(recordId);
    set((s) => {
      const next = { ...s.annotationsMap };
      delete next[recordId];
      return { annotationsMap: next };
    });
  },

  getCount: (recordId) => {
    const list = get().annotationsMap[recordId];
    if (list) return list.length;
    return getAnnotationCount(recordId);
  },

  openConflictDialog: (conflicts, imported, recordId, fileName) => {
    set({
      conflictDialogOpen: true,
      pendingConflicts: conflicts,
      pendingImportedAnnotations: imported,
      pendingRecordId: recordId,
      pendingFileName: fileName,
    });
  },

  closeConflictDialog: () => {
    set({
      conflictDialogOpen: false,
      pendingConflicts: [],
      pendingImportedAnnotations: null,
      pendingRecordId: null,
      pendingFileName: '',
    });
  },

  resolveConflicts: (resolution) => {
    const { pendingRecordId, pendingImportedAnnotations, pendingFileName } = get();
    if (!pendingRecordId || !pendingImportedAnnotations) {
      set({ conflictDialogOpen: false });
      return;
    }

    const localCountBefore = get().getCount(pendingRecordId);
    let finalCount = localCountBefore;
    const conflictTypes = get().pendingConflicts.map((c) => c.type);

    if (resolution === 'KEEP_LOCAL') {
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        localCountBefore,
        importedCount: pendingImportedAnnotations.length,
        finalCount: localCountBefore,
        resolution: 'KEEP_LOCAL',
        conflicts: conflictTypes,
      });
    } else if (resolution === 'OVERWRITE_LOCAL') {
      replaceAnnotations(pendingRecordId, pendingImportedAnnotations.map((a) => ({ ...a, source: 'IMPORTED' as const })));
      const updated = loadAnnotations(pendingRecordId);
      finalCount = updated.length;
      set((s) => ({ annotationsMap: { ...s.annotationsMap, [pendingRecordId]: updated } }));
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        localCountBefore,
        importedCount: pendingImportedAnnotations.length,
        finalCount,
        resolution: 'OVERWRITE_LOCAL',
        conflicts: conflictTypes,
      });
    } else if (resolution === 'MERGE') {
      const merged = get().merge(pendingRecordId, pendingImportedAnnotations);
      finalCount = merged.length;
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        localCountBefore,
        importedCount: pendingImportedAnnotations.length,
        finalCount,
        resolution: 'MERGE',
        conflicts: conflictTypes,
      });
    } else {
      appendAnnotationImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: false,
        localCountBefore,
        importedCount: pendingImportedAnnotations.length,
        finalCount: localCountBefore,
        resolution: 'SKIP',
        conflicts: conflictTypes,
        errors: ['用户选择跳过批注导入'],
      });
    }

    set({
      conflictDialogOpen: false,
      pendingConflicts: [],
      pendingImportedAnnotations: null,
      pendingRecordId: null,
      pendingFileName: '',
    });
  },
}));
