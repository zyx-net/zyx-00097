import { create } from 'zustand';
import type { Level, ErrorRecord } from '../types';
import {
  loadAllLevels,
  getLevelById,
  validateLevelConfig,
  type ValidationResult,
} from '../validators/levelConfigValidator';

interface ConfigState {
  levels: Level[];
  configErrors: ErrorRecord[];
  validations: ValidationResult[];
  initialized: boolean;
  init: () => void;
  getLevel: (id: string) => Level | null;
  getValidation: (id: string) => ValidationResult | null;
  validateImportedJSON: (raw: unknown) => ValidationResult;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  levels: [],
  configErrors: [],
  validations: [],
  initialized: false,

  init: () => {
    if (get().initialized) return;
    const { levels, errors, validations } = loadAllLevels();
    set({ levels, configErrors: errors, validations, initialized: true });
  },

  getLevel: (id) => {
    const existing = get().levels.find((l) => l.id === id);
    return existing ?? getLevelById(id);
  },

  getValidation: (id) => {
    const idx = ['basic-emergency', 'mass-casualty', 'pediatric-triage'].indexOf(id);
    return get().validations[idx] ?? null;
  },

  validateImportedJSON: (raw) => validateLevelConfig(raw, 'imported'),
}));
