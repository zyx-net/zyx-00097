export type Channel = 'RED' | 'YELLOW' | 'GREEN' | 'BLACK';

export const CHANNEL_ORDER: Channel[] = ['RED', 'YELLOW', 'GREEN', 'BLACK'];

export const CHANNEL_LABEL: Record<Channel, string> = {
  RED: '红色通道',
  YELLOW: '黄色通道',
  GREEN: '绿色通道',
  BLACK: '黑色通道',
};

export const CHANNEL_SHORT: Record<Channel, string> = {
  RED: '紧急',
  YELLOW: '危重',
  GREEN: '轻症',
  BLACK: '无望',
};

export const CHANNEL_COLOR: Record<Channel, { bg: string; border: string; text: string; glow: string }> = {
  RED: { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', glow: 'shadow-red-200' },
  YELLOW: { bg: 'bg-amber-50', border: 'border-amber-500', text: 'text-amber-700', glow: 'shadow-amber-200' },
  GREEN: { bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-700', glow: 'shadow-emerald-200' },
  BLACK: { bg: 'bg-slate-100', border: 'border-slate-700', text: 'text-slate-800', glow: 'shadow-slate-300' },
};

export type GameStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'ABANDONED';

export type ActionType =
  | 'ALLOCATE'
  | 'DEALLOCATE'
  | 'REALLOCATE'
  | 'RESOURCE_USE'
  | 'RESOURCE_RETURN'
  | 'PAUSE'
  | 'RESUME'
  | 'SUBMIT'
  | 'SELECT_PATIENT';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: '简单',
  MEDIUM: '中等',
  HARD: '困难',
};

export const DIFFICULTY_LABEL_COLOR: Record<Difficulty, string> = {
  EASY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  HARD: 'bg-red-50 text-red-700 border-red-200',
};

export interface VitalSigns {
  hr: number;
  bp: string;
  spo2: number;
  gcs: number;
  respRate: number;
  temperature: number;
}

export interface ResourceRequirement {
  resourceId: string;
  count: number;
  reason?: string;
}

export interface Patient {
  id: string;
  sequenceNo: number;
  name: string;
  age: string;
  gender: string;
  chiefComplaint: string;
  history: string;
  allergies: string;
  injuryMechanism: string;
  vitalSigns: VitalSigns;
  tags: string[];
  correctChannel: Channel;
  reasoning: string;
  requiredResources: ResourceRequirement[];
}

export interface ResourceSlot {
  id: string;
  name: string;
  icon: string;
  initialCount: number;
  description: string;
  consumable: boolean;
}

export interface ResourceAssignment {
  id: string;
  patientId: string;
  resourceId: string;
  assignedAt: number;
  returnedAt?: number;
}

export interface ScoringRules {
  correctScore: number;
  channelWrongPenalty: number;
  severityMismatchPenalty: number;
  resourceMissPenalty: number;
  resourceOverusePenalty: number;
  timeoutPenaltyPerSec: number;
  pausePenalty: number;
  perfectChannelBonus: number;
  resourceEfficiencyBonus: number;
}

export interface Level {
  id: string;
  name: string;
  version: string;
  description: string;
  difficulty: Difficulty;
  timeLimitSeconds: number;
  patients: Patient[];
  resourceSlots: ResourceSlot[];
  scoringRules: ScoringRules;
}

export interface ActionLog {
  timestamp: number;
  type: ActionType;
  patientId?: string;
  fromChannel?: Channel | null;
  toChannel?: Channel | null;
  resourceId?: string;
  resourceAssignmentId?: string;
  note?: string;
}

export interface ErrorRecord {
  code: string;
  message: string;
  suggestion: string;
  patientId?: string;
  channel?: Channel;
  resourceId?: string;
  timestamp: number;
}

export interface GameSession {
  id: string;
  levelId: string;
  levelVersion: string;
  status: GameStatus;
  startTime: number;
  pausedAt: number | null;
  totalPausedMs: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  selectedPatientId: string | null;
  assignments: Record<string, Channel | null>;
  resourceUsage: Record<string, number>;
  resourceAssignments: ResourceAssignment[];
  operationLog: ActionLog[];
  errors: ErrorRecord[];
  savedAt?: number;
  legacySave?: boolean;
}

export interface ScoringDetail {
  patientId: string;
  patientName: string;
  correctChannel: Channel;
  assignedChannel: Channel | null;
  score: number;
  baseScore: number;
  penalties: { type: string; amount: number; reason: string }[];
  bonuses: { type: string; amount: number; reason: string }[];
}

export interface ScoreResult {
  total: number;
  maxScore: number;
  accuracy: number;
  details: ScoringDetail[];
  resourceScore: number;
  timeScore: number;
  finalPenalty: number;
  finalBonus: number;
  recalcProof: { ruleKey: string; input: unknown; output: number }[];
}

export interface GameRecord {
  id: string;
  levelId: string;
  levelName: string;
  levelVersion: string;
  difficulty: Difficulty;
  totalScore: number;
  maxScore: number;
  accuracy: number;
  usedSeconds: number;
  completed: boolean;
  createdAt: number;
  sessionSnapshot: GameSession;
  scoreSnapshot: ScoreResult;
  imported?: boolean;
  importedAt?: number;
  replayHash?: string;
  originalExportVersion?: number;
}

export interface InProgressSave {
  version: number;
  savedAt: number;
  session: GameSession;
  levelId: string;
}

export type ConflictType =
  | 'DUPLICATE_ID'
  | 'LEVEL_VERSION_MISMATCH'
  | 'MISSING_FIELDS_LEGACY';

export interface ConflictInfo {
  type: ConflictType;
  title: string;
  description: string;
  localRecord?: GameRecord;
  importedLevelVersion?: string;
  localLevelVersion?: string;
  missingFields?: string[];
}

export type ConflictResolution =
  | 'SKIP'
  | 'OVERWRITE'
  | 'KEEP_BOTH'
  | 'IMPORT_AS_IS';

export interface ImportValidationResult {
  ok: boolean;
  replayPackage?: ReplayPackage;
  normalizedRecord?: GameRecord;
  conflicts?: ConflictInfo[];
  errors?: ImportError[];
  warnings?: ImportWarning[];
}

export interface ImportError {
  code: string;
  message: string;
  suggestion?: string;
  field?: string;
}

export interface ImportWarning {
  code: string;
  message: string;
}

export interface ReplayPackageLevelInfo {
  id: string;
  name: string;
  version: string;
  difficulty: Difficulty;
  scoringRules?: ScoringRules;
  patients?: Patient[];
  resourceSlots?: ResourceSlot[];
}

export interface ReplayPackageRecordInfo {
  id: string;
  createdAt: string | number;
  totalScore: number;
  maxScore: number;
  accuracy: number;
  usedSeconds: number;
  completed: boolean;
}

export interface ReplayPackage {
  exportVersion: number;
  exportedAt: string | number;
  replayHash?: string;
  level: ReplayPackageLevelInfo;
  record: ReplayPackageRecordInfo;
  session: GameSession;
  scoreResult: ScoreResult;
  annotations?: CoachAnnotation[];
  annotationVersion?: number;
  caseInfo?: CaseInfo;
  caseVersion?: number;
  reviewListItem?: ReviewListItem;
  reviewListVersion?: number;
}

export interface AnnotationImportLogEntry {
  id: string;
  timestamp: number;
  fileName: string;
  recordId: string;
  success: boolean;
  localCountBefore: number;
  importedCount: number;
  finalCount: number;
  resolution?: AnnotationConflictResolution;
  conflicts?: string[];
  errors?: string[];
}

export interface ImportLogEntry {
  id: string;
  timestamp: number;
  fileName: string;
  success: boolean;
  recordId?: string;
  levelId?: string;
  errors?: ImportError[];
  warnings?: ImportWarning[];
  conflictsResolved?: { type: ConflictType; resolution: ConflictResolution }[];
}

export type AnnotationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const ANNOTATION_SEVERITY_LABEL: Record<AnnotationSeverity, string> = {
  LOW: '轻微',
  MEDIUM: '一般',
  HIGH: '严重',
  CRITICAL: '致命',
};

export const ANNOTATION_SEVERITY_COLOR: Record<AnnotationSeverity, { bg: string; border: string; text: string; dot: string }> = {
  LOW: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  MEDIUM: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', dot: 'bg-amber-500' },
  HIGH: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', dot: 'bg-orange-500' },
  CRITICAL: { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', dot: 'bg-red-600' },
};

export type AnnotationTargetType = 'TIMESTAMP' | 'PATIENT' | 'GLOBAL';

export interface CoachAnnotation {
  id: string;
  recordId: string;
  targetType: AnnotationTargetType;
  timestampMs?: number;
  patientId?: string;
  severity: AnnotationSeverity;
  content: string;
  suggestion: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  source: 'LOCAL' | 'IMPORTED';
}

export interface AnnotationStore {
  version: number;
  annotations: Record<string, CoachAnnotation[]>;
  exportMeta?: {
    lastExportedAt?: number;
    exportVersion?: number;
  };
}

export interface AnnotationConflict {
  type: 'DUPLICATE_ANNOTATION' | 'ANNOTATION_VERSION_DIFF' | 'TIMESTAMP_CONFLICT' | 'HAS_LOCAL_ANNOTATIONS';
  title: string;
  description: string;
  localAnnotations?: CoachAnnotation[];
  importedAnnotations?: CoachAnnotation[];
  annotationVersionLocal?: number;
  annotationVersionImported?: number;
}

export type AnnotationConflictResolution = 'KEEP_LOCAL' | 'MERGE' | 'OVERWRITE_LOCAL' | 'SKIP';

export interface AnnotationImportResult {
  annotations: CoachAnnotation[];
  conflicts: AnnotationConflict[];
  log: { action: string; detail: string; timestamp: number }[];
}

export const MAX_HISTORY = 200;
export const MAX_IMPORT_LOG = 100;
export const MAX_ANNOTATION_IMPORT_LOG = 100;
export const SUPPORTED_EXPORT_VERSIONS = [1, 2] as const;
export const CURRENT_EXPORT_VERSION = 2 as const;
export const ANNOTATION_VERSION_CURRENT = 1 as const;

export interface CaseInfo {
  id: string;
  recordId: string;
  title: string;
  description: string;
  tags: string[];
  recommended: boolean;
  archived: boolean;
  source: 'LOCAL' | 'IMPORTED';
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface CaseStore {
  version: number;
  cases: Record<string, CaseInfo>;
}

export type CaseConflictType =
  | 'HAS_LOCAL_CASE'
  | 'TAG_CONFLICT'
  | 'ARCHIVED_STATUS_CONFLICT'
  | 'CASE_VERSION_DIFF';

export interface CaseConflict {
  type: CaseConflictType;
  title: string;
  description: string;
  localCase?: CaseInfo;
  importedCase?: CaseInfo;
  localTags?: string[];
  importedTags?: string[];
  localArchived?: boolean;
  importedArchived?: boolean;
  caseVersionLocal?: number;
  caseVersionImported?: number;
}

export type CaseConflictResolution = 'KEEP_LOCAL' | 'MERGE' | 'OVERWRITE_LOCAL' | 'SKIP';

export interface CaseImportLogEntry {
  id: string;
  timestamp: number;
  fileName: string;
  recordId: string;
  success: boolean;
  hasLocalCase: boolean;
  importedHasCase: boolean;
  finalHasCase: boolean;
  resolution?: CaseConflictResolution;
  conflicts?: string[];
  errors?: string[];
  tagsAdded?: string[];
  tagsRemoved?: string[];
}

export const CASE_VERSION_CURRENT = 1 as const;
export const MAX_CASE_IMPORT_LOG = 100;

export type ReviewPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export const REVIEW_PRIORITY_LABEL: Record<ReviewPriority, string> = {
  HIGH: '高优先级',
  MEDIUM: '中优先级',
  LOW: '低优先级',
};

export const REVIEW_PRIORITY_COLOR: Record<ReviewPriority, { bg: string; border: string; text: string; dot: string }> = {
  HIGH: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', dot: 'bg-red-500' },
  MEDIUM: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', dot: 'bg-amber-500' },
  LOW: { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-600', dot: 'bg-slate-400' },
};

export type ReviewStatus = 'PENDING' | 'REVIEWED';

export interface ReviewListItem {
  recordId: string;
  status: ReviewStatus;
  priority: ReviewPriority;
  assignee: string;
  remark: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  source: 'LOCAL' | 'IMPORTED';
}

export interface ReviewListStore {
  version: number;
  items: Record<string, ReviewListItem>;
}

export type ReviewListConflictType =
  | 'HAS_LOCAL_REVIEW'
  | 'PRIORITY_CONFLICT'
  | 'STATUS_CONFLICT'
  | 'REMARK_CONFLICT'
  | 'ASSIGNEE_CONFLICT'
  | 'REVIEW_VERSION_DIFF';

export interface ReviewListConflict {
  type: ReviewListConflictType;
  title: string;
  description: string;
  localReview?: ReviewListItem;
  importedReview?: ReviewListItem;
  localPriority?: ReviewPriority;
  importedPriority?: ReviewPriority;
  localStatus?: ReviewStatus;
  importedStatus?: ReviewStatus;
  localRemark?: string;
  importedRemark?: string;
  localAssignee?: string;
  importedAssignee?: string;
  reviewVersionLocal?: number;
  reviewVersionImported?: number;
}

export type ReviewListConflictResolution = 'KEEP_LOCAL' | 'MERGE_REMARK' | 'OVERWRITE_LOCAL' | 'SKIP';

export interface ReviewListImportLogEntry {
  id: string;
  timestamp: number;
  fileName: string;
  recordId: string;
  success: boolean;
  hasLocalReview: boolean;
  importedHasReview: boolean;
  finalHasReview?: boolean;
  finalStatus?: ReviewStatus;
  finalPriority?: ReviewPriority;
  resolution?: ReviewListConflictResolution;
  conflicts?: string[];
  errors?: string[];
  priorityChanged?: boolean;
  statusChanged?: boolean;
  assigneeChanged?: boolean;
  remarkChanged?: boolean;
}

export const REVIEW_VERSION_CURRENT = 1 as const;
export const MAX_REVIEW_LIST_IMPORT_LOG = 100;

export const STORAGE_KEYS = {
  IN_PROGRESS: 'triage:in-progress',
  HISTORY: 'triage:history',
  IMPORT_LOG: 'triage:import-log',
  READONLY_RECORDS: 'triage:readonly-records',
  ANNOTATIONS: 'triage:annotations',
  ANNOTATION_IMPORT_LOG: 'triage:annotation-import-log',
  CASES: 'triage:cases',
  CASE_IMPORT_LOG: 'triage:case-import-log',
  HISTORY_FILTERS: 'triage:history-filters',
  REVIEW_LIST: 'triage:review-list',
  REVIEW_LIST_IMPORT_LOG: 'triage:review-list-import-log',
  STORAGE_VERSION: 1,
  ANNOTATION_VERSION: 1,
  CASE_VERSION: 1,
  REVIEW_VERSION: 1,
} as const;

export const ERROR_CODES = {
  E_PAUSED_LOCKED: 'E_PAUSED_LOCKED',
  E_GAME_ENDED: 'E_GAME_ENDED',
  E_RESOURCE_DEPLETED: 'E_RESOURCE_DEPLETED',
  E_ALREADY_SUBMITTED: 'E_ALREADY_SUBMITTED',
  E_NOT_ALL_ASSIGNED: 'E_NOT_ALL_ASSIGNED',
  E_INVALID_TARGET: 'E_INVALID_TARGET',
  E_RESOURCE_NOT_USED: 'E_RESOURCE_NOT_USED',
  E_INVALID_CONFIG: 'E_INVALID_CONFIG',
  E_CONFIG_NOT_FOUND: 'E_CONFIG_NOT_FOUND',
  E_NO_PATIENT_SELECTED: 'E_NO_PATIENT_SELECTED',
} as const;

export const ERROR_MESSAGES: Record<string, { message: string; suggestion: string }> = {
  [ERROR_CODES.E_PAUSED_LOCKED]: {
    message: '游戏已暂停，无法进行操作',
    suggestion: '请点击「继续」按钮恢复游戏后再操作',
  },
  [ERROR_CODES.E_GAME_ENDED]: {
    message: '本局已结束，无法修改答案',
    suggestion: '可以重玩本关开始新的训练',
  },
  [ERROR_CODES.E_RESOURCE_DEPLETED]: {
    message: '资源不足，无法消耗',
    suggestion: '请选择其他资源或归还已使用的资源',
  },
  [ERROR_CODES.E_ALREADY_SUBMITTED]: {
    message: '已提交过答案，请勿重复提交',
    suggestion: '本关已完成，请查看结果页',
  },
  [ERROR_CODES.E_NOT_ALL_ASSIGNED]: {
    message: '仍有患者未完成分诊',
    suggestion: '请将所有患者分配到通道后再提交',
  },
  [ERROR_CODES.E_INVALID_TARGET]: {
    message: '目标患者或通道无效',
    suggestion: '请检查患者和通道选择是否正确',
  },
  [ERROR_CODES.E_RESOURCE_NOT_USED]: {
    message: '该资源未被消耗，无法归还',
    suggestion: '请检查资源消耗记录',
  },
  [ERROR_CODES.E_INVALID_CONFIG]: {
    message: '关卡配置非法',
    suggestion: '请联系管理员修复关卡配置文件',
  },
  [ERROR_CODES.E_CONFIG_NOT_FOUND]: {
    message: '关卡配置不存在',
    suggestion: '请返回首页选择其他关卡',
  },
  [ERROR_CODES.E_NO_PATIENT_SELECTED]: {
    message: '请先选择患者再操作资源',
    suggestion: '点击左侧患者队列选择一名患者后，再为其分配或归还资源',
  },
};
