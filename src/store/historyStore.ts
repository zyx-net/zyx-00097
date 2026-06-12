import { create } from 'zustand';
import type { GameRecord, Difficulty } from '../types';
import {
  loadHistory,
  getHistoryById,
  clearHistory as clearStorageHistory,
  clearAllCases,
  clearHistoryFilters,
  clearAllAnnotations,
  clearImportLog,
  clearAnnotationImportLog,
  clearCaseImportLog,
  clearAllReviewList,
  clearReviewListImportLog,
} from '../utils/storage';

interface HistoryState {
  records: GameRecord[];
  filterLevelId: string | null;
  filterDifficulty: Difficulty | null;
  searchKeyword: string;
  expandedRecordId: string | null;
  refresh: () => void;
  setFilterLevel: (id: string | null) => void;
  setFilterDifficulty: (d: Difficulty | null) => void;
  setSearch: (k: string) => void;
  setExpanded: (id: string | null) => void;
  getRecord: (id: string) => GameRecord | null;
  clearAll: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  records: loadHistory(),
  filterLevelId: null,
  filterDifficulty: null,
  searchKeyword: '',
  expandedRecordId: null,

  refresh: () => set({ records: loadHistory() }),

  setFilterLevel: (id) => set({ filterLevelId: id }),
  setFilterDifficulty: (d) => set({ filterDifficulty: d }),
  setSearch: (k) => set({ searchKeyword: k }),
  setExpanded: (id) => set({ expandedRecordId: id }),

  getRecord: (id) => {
    const cached = get().records.find((r) => r.id === id);
    return cached ?? getHistoryById(id);
  },

  clearAll: () => {
    clearStorageHistory();
    clearAllCases();
    clearAllAnnotations();
    clearAllReviewList();
    clearHistoryFilters();
    clearImportLog();
    clearAnnotationImportLog();
    clearCaseImportLog();
    clearReviewListImportLog();
    set({
      records: [],
      filterLevelId: null,
      filterDifficulty: null,
      searchKeyword: '',
      expandedRecordId: null,
    });
  },
}));
