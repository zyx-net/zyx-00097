import { z } from 'zod';
import type { Level, ErrorRecord } from '../types';
import { ERROR_CODES, ERROR_MESSAGES } from '../types';
import basicEmergency from '../config/levels/basic-emergency.json';
import massCasualty from '../config/levels/mass-casualty.json';
import pediatricTriage from '../config/levels/pediatric-triage.json';

const channelSchema = z.enum(['RED', 'YELLOW', 'GREEN', 'BLACK']);
const difficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD']);

const vitalSignsSchema = z.object({
  hr: z.number().int().min(0).max(300),
  bp: z.string().regex(/^\d{1,3}\/\d{1,3}$/, '血压格式需为「收缩压/舒张压」'),
  spo2: z.number().int().min(0).max(100),
  gcs: z.number().int().min(3).max(15),
  respRate: z.number().int().min(0).max(100),
  temperature: z.number().min(30).max(45),
});

const resourceRequirementSchema = z.object({
  resourceId: z.string().min(1),
  count: z.number().int().positive(),
  reason: z.string().optional(),
});

const patientSchema = z.object({
  id: z.string().min(1),
  sequenceNo: z.number().int().positive(),
  name: z.string().min(1),
  age: z.string().min(1),
  gender: z.string().min(1),
  chiefComplaint: z.string().min(1),
  history: z.string(),
  allergies: z.string(),
  injuryMechanism: z.string(),
  vitalSigns: vitalSignsSchema,
  tags: z.array(z.string()),
  correctChannel: channelSchema,
  reasoning: z.string().min(1),
  requiredResources: z.array(resourceRequirementSchema),
});

const resourceSlotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  initialCount: z.number().int().nonnegative(),
  description: z.string(),
  consumable: z.boolean(),
});

const scoringRulesSchema = z.object({
  correctScore: z.number().nonnegative(),
  channelWrongPenalty: z.number().nonnegative(),
  severityMismatchPenalty: z.number().nonnegative(),
  resourceMissPenalty: z.number().nonnegative(),
  resourceOverusePenalty: z.number().nonnegative(),
  timeoutPenaltyPerSec: z.number().nonnegative(),
  pausePenalty: z.number().nonnegative(),
  perfectChannelBonus: z.number().nonnegative(),
  resourceEfficiencyBonus: z.number().nonnegative(),
});

const levelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号需为语义化格式 x.y.z'),
  description: z.string().min(1),
  difficulty: difficultySchema,
  timeLimitSeconds: z.number().int().positive(),
  patients: z.array(patientSchema).min(1),
  resourceSlots: z.array(resourceSlotSchema).min(1),
  scoringRules: scoringRulesSchema,
});

export interface ValidationResult {
  valid: boolean;
  errors: ErrorRecord[];
  level?: Level;
}

export function validateLevelConfig(raw: unknown, sourceName = 'unknown'): ValidationResult {
  const errors: ErrorRecord[] = [];
  const ts = Date.now();

  const parsed = levelSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '(root)';
      errors.push({
        code: ERROR_CODES.E_INVALID_CONFIG,
        message: `配置错误 [${sourceName}] 字段 ${path}: ${issue.message}`,
        suggestion: '请对照关卡配置模板修正该字段',
        timestamp: ts,
      });
    }
    return { valid: false, errors };
  }

  const level = parsed.data as Level;

  const patientIds = new Set<string>();
  for (const p of level.patients) {
    if (patientIds.has(p.id)) {
      errors.push({
        code: ERROR_CODES.E_INVALID_CONFIG,
        message: `配置错误 [${sourceName}] 患者ID重复: ${p.id}`,
        suggestion: '请确保患者ID全局唯一',
        patientId: p.id,
        timestamp: ts,
      });
    }
    patientIds.add(p.id);
  }

  const seqNos = new Set<number>();
  for (const p of level.patients) {
    if (seqNos.has(p.sequenceNo)) {
      errors.push({
        code: ERROR_CODES.E_INVALID_CONFIG,
        message: `配置错误 [${sourceName}] 患者序号重复: ${p.sequenceNo}`,
        suggestion: '请确保sequenceNo在关卡内唯一',
        patientId: p.id,
        timestamp: ts,
      });
    }
    seqNos.add(p.sequenceNo);
  }

  const resourceIds = new Set<string>();
  for (const r of level.resourceSlots) {
    if (resourceIds.has(r.id)) {
      errors.push({
        code: ERROR_CODES.E_INVALID_CONFIG,
        message: `配置错误 [${sourceName}] 资源ID重复: ${r.id}`,
        suggestion: '请确保资源槽ID全局唯一',
        resourceId: r.id,
        timestamp: ts,
      });
    }
    resourceIds.add(r.id);
  }

  for (const p of level.patients) {
    for (const req of p.requiredResources) {
      if (!resourceIds.has(req.resourceId)) {
        errors.push({
          code: ERROR_CODES.E_INVALID_CONFIG,
          message: `配置错误 [${sourceName}] 患者${p.id}引用了不存在的资源: ${req.resourceId}`,
          suggestion: '请检查资源槽配置或修正患者推荐资源',
          patientId: p.id,
          resourceId: req.resourceId,
          timestamp: ts,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors, level };
}

const rawLevels: unknown[] = [basicEmergency, massCasualty, pediatricTriage];

interface LevelRegistryEntry {
  level: Level;
  source: string;
}

let registryCache: LevelRegistryEntry[] | null = null;
let validationCache: ValidationResult[] | null = null;

export function loadAllLevels(): { levels: Level[]; errors: ErrorRecord[]; validations: ValidationResult[] } {
  if (registryCache && validationCache) {
    return {
      levels: registryCache.map((e) => e.level),
      errors: validationCache.flatMap((v) => v.errors),
      validations: validationCache,
    };
  }

  const validations: ValidationResult[] = rawLevels.map((raw, idx) => {
    const names = ['basic-emergency.json', 'mass-casualty.json', 'pediatric-triage.json'];
    return validateLevelConfig(raw, names[idx] ?? `level-${idx}`);
  });

  const registry: LevelRegistryEntry[] = [];
  const names = ['basic-emergency.json', 'mass-casualty.json', 'pediatric-triage.json'];
  for (let i = 0; i < validations.length; i++) {
    const v = validations[i];
    if (v.valid && v.level) {
      registry.push({ level: v.level, source: names[i] });
    }
  }

  registryCache = registry;
  validationCache = validations;

  return {
    levels: registry.map((e) => e.level),
    errors: validations.flatMap((v) => v.errors),
    validations,
  };
}

export function getLevelById(id: string): Level | null {
  const { levels } = loadAllLevels();
  return levels.find((l) => l.id === id) ?? null;
}

export function getLevelValidation(id: string): ValidationResult | null {
  const { validations } = loadAllLevels();
  const idx = ['basic-emergency', 'mass-casualty', 'pediatric-triage'].indexOf(id);
  return validations[idx] ?? null;
}

export { ERROR_MESSAGES };
