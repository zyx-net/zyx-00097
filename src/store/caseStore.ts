import { create } from 'zustand';
import type { CaseInfo, CaseConflict, CaseConflictResolution } from '../types';
import {
  loadCase,
  createCase as storageCreate,
  updateCase as storageUpdate,
  deleteCase as storageDelete,
  getAllCases,
  getCaseTags,
  replaceCase,
  mergeCase as storageMerge,
  hasCase,
  appendCaseImportLog,
} from '../utils/storage';

interface CaseState {
  caseMap: Record<string, CaseInfo>;
  allTags: string[];
  editDialogOpen: boolean;
  editingRecordId: string | null;
  editingCase: CaseInfo | null;
  conflictDialogOpen: boolean;
  pendingConflicts: CaseConflict[];
  pendingImportedCase: CaseInfo | null;
  pendingRecordId: string | null;
  pendingFileName: string;

  refresh: () => void;
  getCase: (recordId: string) => CaseInfo | null;
  hasCase: (recordId: string) => boolean;
  create: (recordId: string, data: Omit<CaseInfo, 'id' | 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>) => CaseInfo;
  update: (recordId: string, updates: Partial<Pick<CaseInfo, 'title' | 'description' | 'tags' | 'recommended' | 'archived'>>) => CaseInfo | null;
  remove: (recordId: string) => boolean;
  replace: (recordId: string, caseInfo: CaseInfo) => void;
  merge: (recordId: string, incoming: CaseInfo) => CaseInfo;

  openEditDialog: (recordId: string) => void;
  closeEditDialog: () => void;
  saveEdit: (data: Omit<CaseInfo, 'id' | 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>) => void;

  openConflictDialog: (conflicts: CaseConflict[], imported: CaseInfo, recordId: string, fileName: string) => void;
  closeConflictDialog: () => void;
  resolveConflicts: (resolution: CaseConflictResolution) => void;
}

export const useCaseStore = create<CaseState>((set, get) => ({
  caseMap: {},
  allTags: [],
  editDialogOpen: false,
  editingRecordId: null,
  editingCase: null,
  conflictDialogOpen: false,
  pendingConflicts: [],
  pendingImportedCase: null,
  pendingRecordId: null,
  pendingFileName: '',

  refresh: () => {
    const cases = getAllCases();
    const caseMap: Record<string, CaseInfo> = {};
    for (const c of cases) {
      caseMap[c.recordId] = c;
    }
    set({ caseMap, allTags: getCaseTags() });
  },

  getCase: (recordId) => {
    const cached = get().caseMap[recordId];
    if (cached) return cached;
    const loaded = loadCase(recordId);
    if (loaded) {
      set((s) => ({ caseMap: { ...s.caseMap, [recordId]: loaded } }));
    }
    return loaded;
  },

  hasCase: (recordId) => {
    if (get().caseMap[recordId]) return true;
    return hasCase(recordId);
  },

  create: (recordId, data) => {
    const c = storageCreate(recordId, data);
    set((s) => ({
      caseMap: { ...s.caseMap, [recordId]: c },
      allTags: getCaseTags(),
    }));
    return c;
  },

  update: (recordId, updates) => {
    const updated = storageUpdate(recordId, updates);
    if (updated) {
      set((s) => ({
        caseMap: { ...s.caseMap, [recordId]: updated },
        allTags: getCaseTags(),
      }));
    }
    return updated;
  },

  remove: (recordId) => {
    const ok = storageDelete(recordId);
    if (ok) {
      set((s) => {
        const next = { ...s.caseMap };
        delete next[recordId];
        return { caseMap: next, allTags: getCaseTags() };
      });
    }
    return ok;
  },

  replace: (recordId, caseInfo) => {
    replaceCase(recordId, caseInfo);
    const loaded = loadCase(recordId);
    if (loaded) {
      set((s) => ({
        caseMap: { ...s.caseMap, [recordId]: loaded },
        allTags: getCaseTags(),
      }));
    }
  },

  merge: (recordId, incoming) => {
    const merged = storageMerge(recordId, incoming);
    set((s) => ({
      caseMap: { ...s.caseMap, [recordId]: merged },
      allTags: getCaseTags(),
    }));
    return merged;
  },

  openEditDialog: (recordId) => {
    const existing = get().getCase(recordId);
    set({
      editDialogOpen: true,
      editingRecordId: recordId,
      editingCase: existing,
    });
  },

  closeEditDialog: () => {
    set({
      editDialogOpen: false,
      editingRecordId: null,
      editingCase: null,
    });
  },

  saveEdit: (data) => {
    const { editingRecordId, editingCase } = get();
    if (!editingRecordId) return;
    if (editingCase) {
      get().update(editingRecordId, data);
    } else {
      get().create(editingRecordId, data);
    }
    get().closeEditDialog();
  },

  openConflictDialog: (conflicts, imported, recordId, fileName) => {
    set({
      conflictDialogOpen: true,
      pendingConflicts: conflicts,
      pendingImportedCase: imported,
      pendingRecordId: recordId,
      pendingFileName: fileName,
    });
  },

  closeConflictDialog: () => {
    set({
      conflictDialogOpen: false,
      pendingConflicts: [],
      pendingImportedCase: null,
      pendingRecordId: null,
      pendingFileName: '',
    });
  },

  resolveConflicts: (resolution) => {
    const { pendingRecordId, pendingImportedCase, pendingFileName, pendingConflicts } = get();
    if (!pendingRecordId || !pendingImportedCase) {
      set({ conflictDialogOpen: false });
      return;
    }

    const hasLocalCase = get().hasCase(pendingRecordId);
    const conflictTypes = pendingConflicts.map((c) => c.type);

    if (resolution === 'KEEP_LOCAL') {
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        hasLocalCase,
        importedHasCase: true,
        finalHasCase: hasLocalCase,
        resolution: 'KEEP_LOCAL',
        conflicts: conflictTypes,
      });
    } else if (resolution === 'OVERWRITE_LOCAL') {
      get().replace(pendingRecordId, pendingImportedCase);
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        hasLocalCase,
        importedHasCase: true,
        finalHasCase: true,
        resolution: 'OVERWRITE_LOCAL',
        conflicts: conflictTypes,
      });
    } else if (resolution === 'MERGE') {
      const merged = get().merge(pendingRecordId, pendingImportedCase);
      const tagsAdded = pendingImportedCase.tags.filter(
        (t) => !(get().caseMap[pendingRecordId]?.tags ?? []).includes(t)
      );
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        hasLocalCase,
        importedHasCase: true,
        finalHasCase: true,
        resolution: 'MERGE',
        conflicts: conflictTypes,
        tagsAdded,
      });
    } else {
      appendCaseImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: false,
        hasLocalCase,
        importedHasCase: true,
        finalHasCase: hasLocalCase,
        resolution: 'SKIP',
        conflicts: conflictTypes,
        errors: ['用户选择跳过案例导入'],
      });
    }

    set({
      conflictDialogOpen: false,
      pendingConflicts: [],
      pendingImportedCase: null,
      pendingRecordId: null,
      pendingFileName: '',
    });
  },
}));
