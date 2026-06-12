import type {
  GameRecord,
  GameSession,
  Level,
  ReplayPackage,
  ImportValidationResult,
  ImportError,
  ImportWarning,
  ConflictInfo,
  ResourceAssignment,
  ScoreResult,
  CoachAnnotation,
  AnnotationConflict,
  CaseInfo,
  CaseConflict,
} from '../types';
import { SUPPORTED_EXPORT_VERSIONS, ANNOTATION_VERSION_CURRENT, CASE_VERSION_CURRENT } from '../types';
import { computeReplayHash, normalizeSession, loadAnnotations, getAnnotationStoreVersion, loadCase, getCaseStoreVersion } from './storage';
import { generateUUID } from './uuid';
import { calculateScore } from './scoring';

const REQUIRED_PACKAGE_FIELDS = [
  'exportVersion',
  'level',
  'record',
  'session',
  'scoreResult',
] as const;

const REQUIRED_LEVEL_FIELDS = ['id', 'name', 'version', 'difficulty'] as const;

const REQUIRED_RECORD_FIELDS = [
  'id',
  'createdAt',
  'totalScore',
  'maxScore',
  'accuracy',
  'usedSeconds',
  'completed',
] as const;

const REQUIRED_SESSION_FIELDS = [
  'id',
  'levelId',
  'levelVersion',
  'startTime',
  'assignments',
  'operationLog',
] as const;

const REQUIRED_SCORE_FIELDS = [
  'total',
  'maxScore',
  'accuracy',
  'details',
  'recalcProof',
] as const;

function parseISODateToMs(value: string | number): number {
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Date.now();
}

function findMissingFields(obj: unknown, required: readonly string[]): string[] {
  if (!obj || typeof obj !== 'object') return [...required];
  return required.filter((k) => !(k in (obj as Record<string, unknown>)));
}

export function validateReplayPackageShape(raw: unknown): {
  errors: ImportError[];
  warnings: ImportWarning[];
  missingFields: string[];
  pkg?: ReplayPackage;
} {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const missingFields: string[] = [];

  if (raw === null || raw === undefined) {
    errors.push({ code: 'EMPTY', message: '导入文件为空或无法解析' });
    return { errors, warnings, missingFields };
  }

  if (typeof raw !== 'object') {
    errors.push({ code: 'NOT_OBJECT', message: '导入文件格式错误，根节点必须是 JSON 对象' });
    return { errors, warnings, missingFields };
  }

  const obj = raw as Record<string, unknown>;

  const topMissing = findMissingFields(obj, REQUIRED_PACKAGE_FIELDS);
  missingFields.push(...topMissing.map((f) => `pkg.${f}`));
  for (const f of topMissing) {
    if (f === 'exportVersion') {
      errors.push({
        code: 'MISSING_EXPORT_VERSION',
        message: '缺少导出版本号 exportVersion，无法识别包格式',
        suggestion: '请使用本系统导出的 JSON 文件',
        field: 'exportVersion',
      });
    } else {
      warnings.push({ code: `MISSING_${f.toUpperCase()}`, message: `缺少顶层字段 ${f}，可能是旧版本导出` });
    }
  }

  const lvlMissing = findMissingFields(obj.level, REQUIRED_LEVEL_FIELDS);
  missingFields.push(...lvlMissing.map((f) => `level.${f}`));

  const recMissing = findMissingFields(obj.record, REQUIRED_RECORD_FIELDS);
  missingFields.push(...recMissing.map((f) => `record.${f}`));

  const sessMissing = findMissingFields(obj.session, REQUIRED_SESSION_FIELDS);
  missingFields.push(...sessMissing.map((f) => `session.${f}`));

  const scMissing = findMissingFields(obj.scoreResult, REQUIRED_SCORE_FIELDS);
  missingFields.push(...scMissing.map((f) => `scoreResult.${f}`));

  if (missingFields.length > 0) {
    warnings.push({
      code: 'LEGACY_PACKAGE',
      message: `检测到 ${missingFields.length} 个缺失字段，可能为旧版本导出包`,
    });
  }

  return { errors, warnings, missingFields, pkg: obj as unknown as ReplayPackage };
}

export function buildGameRecordFromPackage(
  pkg: ReplayPackage,
  localLevel: Level | null,
  existingLocalRecord: GameRecord | null
): {
  record: GameRecord;
  conflicts: ConflictInfo[];
  errors: ImportError[];
  warnings: ImportWarning[];
} {
  const conflicts: ConflictInfo[] = [];
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];

  const createdAt = parseISODateToMs(pkg.record.createdAt);
  const exportedAt = parseISODateToMs(pkg.exportedAt);

  const levelId = pkg.level?.id ?? pkg.session?.levelId;
  const levelName = pkg.level?.name ?? levelId;
  const levelVersion = pkg.level?.version ?? pkg.session?.levelVersion ?? 'unknown';
  const difficulty = pkg.level?.difficulty ?? 'MEDIUM';

  const session: GameSession = normalizeSession({
    ...(pkg.session ?? ({} as GameSession)),
    id: pkg.session?.id ?? pkg.record.id,
    levelId: pkg.session?.levelId ?? levelId,
    levelVersion: pkg.session?.levelVersion ?? levelVersion,
    resourceAssignments: (pkg.session?.resourceAssignments as ResourceAssignment[] | undefined) ?? [],
    resourceUsage: pkg.session?.resourceUsage ?? {},
    operationLog: pkg.session?.operationLog ?? [],
    errors: pkg.session?.errors ?? [],
    assignments: pkg.session?.assignments ?? {},
  });

  const scoreResult: ScoreResult = {
    ...(pkg.scoreResult ?? ({} as ScoreResult)),
    details: pkg.scoreResult?.details ?? [],
    recalcProof: pkg.scoreResult?.recalcProof ?? [],
  };

  if (localLevel) {
    if (localLevel.version !== levelVersion) {
      conflicts.push({
        type: 'LEVEL_VERSION_MISMATCH',
        title: '关卡版本不一致',
        description: `导入记录基于 v${levelVersion}，当前本地关卡为 v${localLevel.version}，复算结果可能与原始评分有偏差`,
        importedLevelVersion: levelVersion,
        localLevelVersion: localLevel.version,
      });
      warnings.push({
        code: 'LEVEL_VERSION_DIFF',
        message: `关卡版本 v${levelVersion} → v${localLevel.version}`,
      });
    }

    const patientIds = new Set(localLevel.patients.map((p) => p.id));
    const resourceIds = new Set(localLevel.resourceSlots.map((r) => r.id));

    const sessionPatientIds = Object.keys(session.assignments ?? {});
    const missingPatients = sessionPatientIds.filter((id) => !patientIds.has(id));
    if (missingPatients.length > 0) {
      errors.push({
        code: 'PATIENT_ID_MISMATCH',
        message: `导入包中 ${missingPatients.length} 个患者 ID 在本地关卡中不存在`,
        suggestion: '请确认导入的关卡与当前使用的关卡为同一份配置',
        field: 'session.assignments',
      });
    }

    const usedResourceIds = new Set<string>();
    for (const ra of session.resourceAssignments ?? []) usedResourceIds.add(ra.resourceId);
    for (const k of Object.keys(session.resourceUsage ?? {})) usedResourceIds.add(k);
    const missingResources = [...usedResourceIds].filter((id) => !resourceIds.has(id));
    if (missingResources.length > 0) {
      errors.push({
        code: 'RESOURCE_ID_MISMATCH',
        message: `导入包中 ${missingResources.length} 个资源 ID 在本地关卡中不存在`,
        suggestion: '请确认导入的关卡与当前使用的关卡为同一份配置',
        field: 'session.resourceUsage',
      });
    }
  } else {
    errors.push({
      code: 'LEVEL_NOT_FOUND',
      message: `本地未找到关卡 ${levelId}（${levelName}），无法进行复算校验`,
      suggestion: '请先将对应关卡配置文件放入 config/levels 目录，或选择跳过导入',
      field: 'level.id',
    });
  }

  if (existingLocalRecord) {
    conflicts.push({
      type: 'DUPLICATE_ID',
      title: '本地已存在相同记录',
      description: `ID=${pkg.record.id} 的训练记录已存在于本地，时间 ${new Date(existingLocalRecord.createdAt).toLocaleString()}，得分 ${existingLocalRecord.totalScore}`,
      localRecord: existingLocalRecord,
    });
  }

  let replayHash = pkg.replayHash;
  if (localLevel && !replayHash) {
    replayHash = computeReplayHash(scoreResult);
    warnings.push({ code: 'HASH_REGEN', message: '原包未携带校验码，已根据评分快照重新生成' });
  }

  if (localLevel && replayHash) {
    try {
      const recalc = calculateScore(localLevel, session);
      const recalcHash = computeReplayHash(recalc);
      if (recalcHash !== replayHash) {
        warnings.push({
          code: 'HASH_MISMATCH',
          message: `校验码不一致（原 ${replayHash} / 本地复算 ${recalcHash}）`,
        });
      }
    } catch {
      warnings.push({ code: 'RECALC_FAILED', message: '本地复算失败，跳过校验码比对' });
    }
  }

  const record: GameRecord = {
    id: pkg.record.id,
    levelId,
    levelName,
    levelVersion,
    difficulty,
    totalScore: Number.isFinite(pkg.record.totalScore) ? pkg.record.totalScore : 0,
    maxScore: Number.isFinite(pkg.record.maxScore) ? pkg.record.maxScore : 0,
    accuracy: Number.isFinite(pkg.record.accuracy) ? pkg.record.accuracy : 0,
    usedSeconds: Number.isFinite(pkg.record.usedSeconds) ? pkg.record.usedSeconds : 0,
    completed: Boolean(pkg.record.completed),
    createdAt: createdAt || exportedAt || Date.now(),
    sessionSnapshot: session,
    scoreSnapshot: scoreResult,
    imported: true,
    importedAt: Date.now(),
    replayHash,
    originalExportVersion: Number.isFinite(pkg.exportVersion) ? pkg.exportVersion : undefined,
  };

  return { record, conflicts, errors, warnings };
}

export function validateAndNormalizeImport(
  raw: unknown,
  getLocalLevel: (id: string) => Level | null,
  getLocalRecord: (id: string) => GameRecord | null
): ImportValidationResult {
  const shape = validateReplayPackageShape(raw);
  if (shape.errors.length > 0 && !shape.pkg) {
    return {
      ok: false,
      errors: shape.errors,
      warnings: shape.warnings,
    };
  }

  const pkg = shape.pkg!;
  const errors: ImportError[] = [...shape.errors];
  const warnings: ImportWarning[] = [...shape.warnings];

  if (pkg.exportVersion !== undefined) {
    const supported = (SUPPORTED_EXPORT_VERSIONS as readonly number[]).includes(pkg.exportVersion);
    if (!supported) {
      errors.push({
        code: 'UNSUPPORTED_VERSION',
        message: `不支持的导出版本 exportVersion=${pkg.exportVersion}`,
        suggestion: `当前仅支持版本 ${SUPPORTED_EXPORT_VERSIONS.join(', ')}，请升级系统或重新导出`,
        field: 'exportVersion',
      });
      return { ok: false, errors, warnings };
    }
  }

  const levelId = pkg.level?.id ?? pkg.session?.levelId;
  if (!levelId) {
    errors.push({ code: 'NO_LEVEL_ID', message: '无法从导入包中获取关卡 ID', field: 'level.id' });
    return { ok: false, errors, warnings };
  }

  const localLevel = getLocalLevel(levelId);
  const existingRecord = getLocalRecord(pkg.record?.id ?? '');

  const built = buildGameRecordFromPackage(pkg, localLevel, existingRecord);
  errors.push(...built.errors);
  warnings.push(...built.warnings);

  const conflicts: ConflictInfo[] = [...built.conflicts];
  if (shape.missingFields.length > 0 && errors.filter((e) => e.code === 'LEVEL_NOT_FOUND').length === 0) {
    conflicts.unshift({
      type: 'MISSING_FIELDS_LEGACY',
      title: '检测到旧版导出包',
      description: `存在 ${shape.missingFields.length} 个缺失字段（${shape.missingFields.slice(0, 5).join(', ')}${shape.missingFields.length > 5 ? '...' : ''}），系统将自动补齐，但部分细节可能丢失`,
      missingFields: shape.missingFields,
    });
  }

  const fatalErrors = errors.filter((e) =>
    ['EMPTY', 'NOT_OBJECT', 'MISSING_EXPORT_VERSION', 'UNSUPPORTED_VERSION', 'NO_LEVEL_ID', 'LEVEL_NOT_FOUND'].includes(e.code)
  );

  return {
    ok: fatalErrors.length === 0,
    replayPackage: pkg,
    normalizedRecord: built.record,
    conflicts,
    errors,
    warnings,
  };
}

export function applyResolution(
  record: GameRecord,
  resolution: 'SKIP' | 'OVERWRITE' | 'KEEP_BOTH' | 'IMPORT_AS_IS',
  conflict: ConflictInfo
): { record: GameRecord; skip: boolean } {
  if (resolution === 'SKIP') {
    return { record, skip: true };
  }
  if (resolution === 'KEEP_BOTH' && conflict.type === 'DUPLICATE_ID') {
    const newId = generateUUID();
    return {
      record: {
        ...record,
        id: newId,
        sessionSnapshot: { ...record.sessionSnapshot, id: newId },
      },
      skip: false,
    };
  }
  return { record, skip: false };
}

export function readFileAsJSON(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result ?? '')));
      } catch {
        reject(new Error('JSON 解析失败，请确认文件格式正确'));
      }
    };
    reader.readAsText(file, 'utf-8');
  });
}

export function detectAnnotationConflicts(
  recordId: string,
  importedAnnotations: CoachAnnotation[] | undefined,
  importedAnnotationVersion: number | undefined
): AnnotationConflict[] {
  const conflicts: AnnotationConflict[] = [];
  if (!importedAnnotations || importedAnnotations.length === 0) return conflicts;

  const localAnnotations = loadAnnotations(recordId);

  if (localAnnotations.length > 0) {
    conflicts.push({
      type: 'HAS_LOCAL_ANNOTATIONS',
      title: '本地已有教练批注',
      description: `该回放记录本地已有 ${localAnnotations.length} 条批注，导入包携带 ${importedAnnotations.length} 条批注，请选择处理方式`,
      localAnnotations,
      importedAnnotations,
    });

    const localSigSet = new Set(
      localAnnotations.map((a) => `${a.targetType}:${a.timestampMs ?? ''}:${a.patientId ?? ''}`)
    );
    const duplicates = importedAnnotations.filter((a) =>
      localSigSet.has(`${a.targetType}:${a.timestampMs ?? ''}:${a.patientId ?? ''}`)
    );
    if (duplicates.length > 0) {
      conflicts.push({
        type: 'DUPLICATE_ANNOTATION',
        title: '存在相同目标的重复批注',
        description: `导入包中有 ${duplicates.length} 条批注与本地批注的目标（时间点/患者）相同`,
        localAnnotations: duplicates,
        importedAnnotations,
      });
    }
  }

  const localVersion = getAnnotationStoreVersion();
  if (importedAnnotationVersion !== undefined && importedAnnotationVersion !== localVersion) {
    conflicts.push({
      type: 'ANNOTATION_VERSION_DIFF',
      title: '批注版本不一致',
      description: `本地批注版本 v${localVersion}，导入包批注版本 v${importedAnnotationVersion}，合并后可能出现格式差异`,
      annotationVersionLocal: localVersion,
      annotationVersionImported: importedAnnotationVersion,
    });
  }

  return conflicts;
}

export function detectCaseConflicts(
  recordId: string,
  importedCase: CaseInfo | undefined,
  importedCaseVersion: number | undefined
): CaseConflict[] {
  const conflicts: CaseConflict[] = [];
  if (!importedCase) return conflicts;

  const localCase = loadCase(recordId);

  if (localCase) {
    conflicts.push({
      type: 'HAS_LOCAL_CASE',
      title: '本地已有案例',
      description: `该回放记录本地已有案例，导入包也携带案例数据，请选择处理方式`,
      localCase,
      importedCase,
    });

    const localTagSet = new Set(localCase.tags);
    const importedTagSet = new Set(importedCase.tags);
    const hasTagDiff = localCase.tags.length !== importedCase.tags.length ||
      !localCase.tags.every((t) => importedTagSet.has(t)) ||
      !importedCase.tags.every((t) => localTagSet.has(t));
    if (hasTagDiff) {
      conflicts.push({
        type: 'TAG_CONFLICT',
        title: '案例标签不一致',
        description: `本地有 ${localCase.tags.length} 个标签，导入包有 ${importedCase.tags.length} 个标签`,
        localTags: localCase.tags,
        importedTags: importedCase.tags,
      });
    }

    if (localCase.archived !== importedCase.archived) {
      conflicts.push({
        type: 'ARCHIVED_STATUS_CONFLICT',
        title: '归档状态不一致',
        description: `本地${localCase.archived ? '已归档' : '未归档'}，导入包${importedCase.archived ? '已归档' : '未归档'}`,
        localArchived: localCase.archived,
        importedArchived: importedCase.archived,
      });
    }
  }

  const localVersion = getCaseStoreVersion();
  if (importedCaseVersion !== undefined && importedCaseVersion !== localVersion) {
    conflicts.push({
      type: 'CASE_VERSION_DIFF',
      title: '案例版本不一致',
      description: `本地案例版本 v${localVersion}，导入包案例版本 v${importedCaseVersion}`,
      caseVersionLocal: localVersion,
      caseVersionImported: importedCaseVersion,
    });
  }

  return conflicts;
}
