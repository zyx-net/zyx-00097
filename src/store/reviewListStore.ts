import { create } from 'zustand';
import type { ReviewListItem, ReviewListConflict, ReviewListConflictResolution, ReviewPriority, ReviewStatus } from '../types';
import {
  loadReviewList,
  loadReviewItem,
  createReviewItem as storageCreate,
  updateReviewItem as storageUpdate,
  deleteReviewItem as storageDelete,
  hasReviewItem,
  replaceReviewItem,
  mergeReviewItem as storageMerge,
  markAsReviewed as storageMarkReviewed,
  markAsPending as storageMarkPending,
  appendReviewListImportLog,
  getPendingReviewCount,
  getReviewedCount,
} from '../utils/storage';

interface ReviewListState {
  itemMap: Record<string, ReviewListItem>;
  pendingCount: number;
  reviewedCount: number;
  addDialogOpen: boolean;
  addingRecordId: string | null;
  conflictDialogOpen: boolean;
  pendingConflicts: ReviewListConflict[];
  pendingImportedReview: ReviewListItem | null;
  pendingRecordId: string | null;
  pendingFileName: string;

  refresh: () => void;
  getItem: (recordId: string) => ReviewListItem | null;
  hasItem: (recordId: string) => boolean;
  create: (
    recordId: string,
    data: Omit<ReviewListItem, 'recordId' | 'createdAt' | 'updatedAt' | 'version' | 'source'>
  ) => ReviewListItem;
  update: (
    recordId: string,
    updates: Partial<Pick<ReviewListItem, 'status' | 'priority' | 'assignee' | 'remark'>>
  ) => ReviewListItem | null;
  remove: (recordId: string) => boolean;
  replace: (recordId: string, item: ReviewListItem) => void;
  merge: (recordId: string, incoming: ReviewListItem) => ReviewListItem;
  markReviewed: (recordId: string) => ReviewListItem | null;
  markPending: (recordId: string) => ReviewListItem | null;

  openAddDialog: (recordId: string) => void;
  closeAddDialog: () => void;
  saveAdd: (data: { priority: ReviewPriority; assignee: string; remark: string }) => void;

  openConflictDialog: (
    conflicts: ReviewListConflict[],
    imported: ReviewListItem,
    recordId: string,
    fileName: string
  ) => void;
  closeConflictDialog: () => void;
  resolveConflicts: (resolution: ReviewListConflictResolution) => void;
}

export const useReviewListStore = create<ReviewListState>((set, get) => ({
  itemMap: {},
  pendingCount: 0,
  reviewedCount: 0,
  addDialogOpen: false,
  addingRecordId: null,
  conflictDialogOpen: false,
  pendingConflicts: [],
  pendingImportedReview: null,
  pendingRecordId: null,
  pendingFileName: '',

  refresh: () => {
    const items = loadReviewList();
    const itemMap: Record<string, ReviewListItem> = {};
    for (const item of items) {
      itemMap[item.recordId] = item;
    }
    set({
      itemMap,
      pendingCount: getPendingReviewCount(),
      reviewedCount: getReviewedCount(),
    });
  },

  getItem: (recordId) => {
    const cached = get().itemMap[recordId];
    if (cached) return cached;
    const loaded = loadReviewItem(recordId);
    if (loaded) {
      set((s) => ({ itemMap: { ...s.itemMap, [recordId]: loaded } }));
    }
    return loaded;
  },

  hasItem: (recordId) => {
    if (get().itemMap[recordId]) return true;
    return hasReviewItem(recordId);
  },

  create: (recordId, data) => {
    const item = storageCreate(recordId, data);
    set((s) => ({
      itemMap: { ...s.itemMap, [recordId]: item },
      pendingCount: getPendingReviewCount(),
      reviewedCount: getReviewedCount(),
    }));
    return item;
  },

  update: (recordId, updates) => {
    const updated = storageUpdate(recordId, updates);
    if (updated) {
      set((s) => ({
        itemMap: { ...s.itemMap, [recordId]: updated },
        pendingCount: getPendingReviewCount(),
        reviewedCount: getReviewedCount(),
      }));
    }
    return updated;
  },

  remove: (recordId) => {
    const ok = storageDelete(recordId);
    if (ok) {
      set((s) => {
        const next = { ...s.itemMap };
        delete next[recordId];
        return {
          itemMap: next,
          pendingCount: getPendingReviewCount(),
          reviewedCount: getReviewedCount(),
        };
      });
    }
    return ok;
  },

  replace: (recordId, item) => {
    replaceReviewItem(recordId, item);
    const loaded = loadReviewItem(recordId);
    if (loaded) {
      set((s) => ({
        itemMap: { ...s.itemMap, [recordId]: loaded },
        pendingCount: getPendingReviewCount(),
        reviewedCount: getReviewedCount(),
      }));
    }
  },

  merge: (recordId, incoming) => {
    const merged = storageMerge(recordId, incoming);
    set((s) => ({
      itemMap: { ...s.itemMap, [recordId]: merged },
      pendingCount: getPendingReviewCount(),
      reviewedCount: getReviewedCount(),
    }));
    return merged;
  },

  markReviewed: (recordId) => {
    const updated = storageMarkReviewed(recordId);
    if (updated) {
      set((s) => ({
        itemMap: { ...s.itemMap, [recordId]: updated },
        pendingCount: getPendingReviewCount(),
        reviewedCount: getReviewedCount(),
      }));
    }
    return updated;
  },

  markPending: (recordId) => {
    const updated = storageMarkPending(recordId);
    if (updated) {
      set((s) => ({
        itemMap: { ...s.itemMap, [recordId]: updated },
        pendingCount: getPendingReviewCount(),
        reviewedCount: getReviewedCount(),
      }));
    }
    return updated;
  },

  openAddDialog: (recordId) => {
    set({
      addDialogOpen: true,
      addingRecordId: recordId,
    });
  },

  closeAddDialog: () => {
    set({
      addDialogOpen: false,
      addingRecordId: null,
    });
  },

  saveAdd: (data) => {
    const { addingRecordId } = get();
    if (!addingRecordId) return;
    get().create(addingRecordId, {
      status: 'PENDING',
      priority: data.priority,
      assignee: data.assignee,
      remark: data.remark,
    });
    get().closeAddDialog();
  },

  openConflictDialog: (conflicts, imported, recordId, fileName) => {
    set({
      conflictDialogOpen: true,
      pendingConflicts: conflicts,
      pendingImportedReview: imported,
      pendingRecordId: recordId,
      pendingFileName: fileName,
    });
  },

  closeConflictDialog: () => {
    set({
      conflictDialogOpen: false,
      pendingConflicts: [],
      pendingImportedReview: null,
      pendingRecordId: null,
      pendingFileName: '',
    });
  },

  resolveConflicts: (resolution) => {
    const { pendingRecordId, pendingImportedReview, pendingFileName, pendingConflicts } = get();
    if (!pendingRecordId || !pendingImportedReview) {
      set({ conflictDialogOpen: false });
      return;
    }

    const hasLocal = get().hasItem(pendingRecordId);
    const conflictTypes = pendingConflicts.map((c) => c.type);
    const localItem = get().getItem(pendingRecordId);
    const priorityChanged = localItem?.priority !== pendingImportedReview.priority;
    const statusChanged = localItem?.status !== pendingImportedReview.status;
    const assigneeChanged = localItem?.assignee !== pendingImportedReview.assignee;
    const remarkChanged = localItem?.remark !== pendingImportedReview.remark;

    if (resolution === 'KEEP_LOCAL') {
      appendReviewListImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        hasLocalReview: hasLocal,
        importedHasReview: true,
        finalHasReview: hasLocal,
        resolution: 'KEEP_LOCAL',
        conflicts: conflictTypes,
      });
    } else if (resolution === 'OVERWRITE_LOCAL') {
      get().replace(pendingRecordId, pendingImportedReview);
      appendReviewListImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        hasLocalReview: hasLocal,
        importedHasReview: true,
        finalHasReview: true,
        resolution: 'OVERWRITE_LOCAL',
        conflicts: conflictTypes,
        priorityChanged,
        statusChanged,
        assigneeChanged,
        remarkChanged,
      });
    } else if (resolution === 'MERGE_REMARK') {
      const merged = get().merge(pendingRecordId, pendingImportedReview);
      appendReviewListImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: true,
        hasLocalReview: hasLocal,
        importedHasReview: true,
        finalHasReview: true,
        resolution: 'MERGE_REMARK',
        conflicts: conflictTypes,
        priorityChanged: merged.priority !== localItem?.priority,
        statusChanged: merged.status !== localItem?.status,
        assigneeChanged: merged.assignee !== localItem?.assignee,
        remarkChanged: merged.remark !== localItem?.remark,
      });
    } else {
      appendReviewListImportLog({
        fileName: pendingFileName,
        recordId: pendingRecordId,
        success: false,
        hasLocalReview: hasLocal,
        importedHasReview: true,
        finalHasReview: hasLocal,
        resolution: 'SKIP',
        conflicts: conflictTypes,
        errors: ['用户选择跳过待讲清单导入'],
      });
    }

    set({
      conflictDialogOpen: false,
      pendingConflicts: [],
      pendingImportedReview: null,
      pendingRecordId: null,
      pendingFileName: '',
    });
  },
}));
