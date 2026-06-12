import React from 'react';
import { Plus, MessageSquare, Trash2, Edit3, X, Check, AlertTriangle, Clock, User, Tag } from 'lucide-react';
import type { CoachAnnotation, AnnotationSeverity, AnnotationTargetType, Level } from '../../types';
import { ANNOTATION_SEVERITY_LABEL, ANNOTATION_SEVERITY_COLOR } from '../../types';
import { useAnnotationStore } from '../../store/annotationStore';
import { classNames, formatTime, formatDateTime } from '../../utils/uuid';

interface CoachAnnotationPanelProps {
  recordId: string;
  level: Level;
  sessionStartTime: number;
  patientNames: Record<string, string>;
  isReadonly: boolean;
}

type AddMode = null | 'TIMESTAMP' | 'PATIENT' | 'GLOBAL';

export function CoachAnnotationPanel({
  recordId,
  level,
  sessionStartTime,
  patientNames,
  isReadonly,
}: CoachAnnotationPanelProps) {
  const { loadForRecord, add, remove, update } = useAnnotationStore();
  const annotations = loadForRecord(recordId);
  const [addMode, setAddMode] = React.useState<AddMode>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const [formSeverity, setFormSeverity] = React.useState<AnnotationSeverity>('MEDIUM');
  const [formContent, setFormContent] = React.useState('');
  const [formSuggestion, setFormSuggestion] = React.useState('');
  const [formTimestampMs, setFormTimestampMs] = React.useState<number>(0);
  const [formPatientId, setFormPatientId] = React.useState<string>('');

  const [editSeverity, setEditSeverity] = React.useState<AnnotationSeverity>('MEDIUM');
  const [editContent, setEditContent] = React.useState('');
  const [editSuggestion, setEditSuggestion] = React.useState('');

  const resetForm = () => {
    setFormSeverity('MEDIUM');
    setFormContent('');
    setFormSuggestion('');
    setFormTimestampMs(0);
    setFormPatientId('');
    setAddMode(null);
  };

  const handleAdd = () => {
    if (!formContent.trim()) return;
    const data: {
      targetType: AnnotationTargetType;
      timestampMs?: number;
      patientId?: string;
      severity: AnnotationSeverity;
      content: string;
      suggestion: string;
    } = {
      targetType: addMode!,
      severity: formSeverity,
      content: formContent.trim(),
      suggestion: formSuggestion.trim(),
    };
    if (addMode === 'TIMESTAMP') {
      data.timestampMs = formTimestampMs;
    }
    if (addMode === 'PATIENT') {
      data.patientId = formPatientId;
    }
    add(recordId, data);
    resetForm();
  };

  const startEdit = (ann: CoachAnnotation) => {
    setEditingId(ann.id);
    setEditSeverity(ann.severity);
    setEditContent(ann.content);
    setEditSuggestion(ann.suggestion);
  };

  const handleUpdate = (annId: string) => {
    if (!editContent.trim()) return;
    update(recordId, annId, {
      severity: editSeverity,
      content: editContent.trim(),
      suggestion: editSuggestion.trim(),
    });
    setEditingId(null);
  };

  const formatAnnotationTarget = (ann: CoachAnnotation): string => {
    if (ann.targetType === 'TIMESTAMP' && ann.timestampMs != null) {
      return `时间点 ${formatTime(Math.floor((ann.timestampMs - sessionStartTime) / 1000))}`;
    }
    if (ann.targetType === 'PATIENT' && ann.patientId) {
      return `患者 ${patientNames[ann.patientId] ?? ann.patientId}`;
    }
    return '全局';
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-title flex items-center gap-2">
          <MessageSquare size={16} className="text-amber-600" />
          教练批注
          {annotations.length > 0 && (
            <span className="text-xs font-normal text-slate-500">({annotations.length})</span>
          )}
        </h3>
        {!isReadonly && addMode === null && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAddMode('TIMESTAMP')}
              className="btn-ghost text-xs px-2 py-1"
              title="按时间点添加"
            >
              <Clock size={12} /> 时间点
            </button>
            <button
              onClick={() => setAddMode('PATIENT')}
              className="btn-ghost text-xs px-2 py-1"
              title="按患者添加"
            >
              <User size={12} /> 患者
            </button>
            <button
              onClick={() => setAddMode('GLOBAL')}
              className="btn-ghost text-xs px-2 py-1"
              title="添加全局批注"
            >
              <Tag size={12} /> 全局
            </button>
          </div>
        )}
      </div>

      {isReadonly && (
        <p className="text-xs text-sky-600 mb-3 flex items-center gap-1">
          <AlertTriangle size={12} />
          只读模式下可添加/编辑教练批注，批注不影响原始评分和校验码
        </p>
      )}

      {!isReadonly && (
        <p className="text-xs text-slate-400 mb-3">
          批注仅保存于本地复盘记录，不会修改原始操作时间线、评分或校验码
        </p>
      )}

      {addMode && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-amber-800">
              添加{addMode === 'TIMESTAMP' ? '时间点' : addMode === 'PATIENT' ? '患者' : '全局'}批注
            </span>
            <button onClick={resetForm} className="btn-ghost p-1">
              <X size={14} />
            </button>
          </div>

          {addMode === 'TIMESTAMP' && (
            <div>
              <label className="text-xs text-slate-600 mb-1 block">时间点（秒）</label>
              <input
                type="number"
                min={0}
                value={Math.floor(formTimestampMs / 1000)}
                onChange={(e) => setFormTimestampMs((parseInt(e.target.value) || 0) * 1000)}
                className="input text-sm"
                placeholder="输入秒数"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                = {formatTime(Math.floor(formTimestampMs / 1000))}
              </span>
            </div>
          )}

          {addMode === 'PATIENT' && (
            <div>
              <label className="text-xs text-slate-600 mb-1 block">选择患者</label>
              <select
                value={formPatientId}
                onChange={(e) => setFormPatientId(e.target.value)}
                className="input text-sm"
              >
                <option value="">请选择患者</option>
                {level.patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sequenceNo}号·{p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-600 mb-1 block">严重程度</label>
            <div className="flex gap-1.5">
              {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as AnnotationSeverity[]).map((sev) => {
                const c = ANNOTATION_SEVERITY_COLOR[sev];
                return (
                  <button
                    key={sev}
                    onClick={() => setFormSeverity(sev)}
                    className={classNames(
                      'px-2.5 py-1 rounded-lg text-xs font-medium border transition',
                      formSeverity === sev
                        ? `${c.bg} ${c.border} ${c.text} ring-2 ring-offset-1 ring-current`
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    {ANNOTATION_SEVERITY_LABEL[sev]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-600 mb-1 block">批注内容 *</label>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              className="input text-sm min-h-[60px] resize-y"
              placeholder="描述观察到的问题..."
              rows={2}
            />
          </div>

          <div>
            <label className="text-xs text-slate-600 mb-1 block">处理建议</label>
            <textarea
              value={formSuggestion}
              onChange={(e) => setFormSuggestion(e.target.value)}
              className="input text-sm min-h-[40px] resize-y"
              placeholder="建议如何改进..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={resetForm} className="btn-ghost text-xs">取消</button>
            <button
              onClick={handleAdd}
              disabled={!formContent.trim() || (addMode === 'PATIENT' && !formPatientId)}
              className="btn-primary text-xs"
            >
              <Plus size={12} /> 添加批注
            </button>
          </div>
        </div>
      )}

      {annotations.length === 0 ? (
        <div className="text-center py-6 text-slate-400">
          <MessageSquare size={24} className="mx-auto mb-2 opacity-50" />
          <div className="text-sm">暂无教练批注</div>
          <div className="text-xs mt-1">在复盘时可按时间点或患者添加批注</div>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[500px] overflow-auto scrollbar-thin pr-1">
          {annotations.map((ann) => {
            const c = ANNOTATION_SEVERITY_COLOR[ann.severity];
            const isEditing = editingId === ann.id;

            return (
              <div
                key={ann.id}
                className={classNames('rounded-xl border p-3', c.bg, c.border)}
              >
                <div className="flex items-start gap-2">
                  <div className={classNames('w-2 h-2 rounded-full mt-1.5 shrink-0', c.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={classNames('text-[10px] font-bold px-1.5 py-0.5 rounded', c.bg, c.text, `border ${c.border}`)}>
                        {ANNOTATION_SEVERITY_LABEL[ann.severity]}
                      </span>
                      <span className="text-xs text-slate-600">{formatAnnotationTarget(ann)}</span>
                      <span className="text-[10px] text-slate-400 ml-auto">
                        {ann.source === 'IMPORTED' ? '导入' : '本地'} · {formatDateTime(ann.updatedAt)}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2 mt-2">
                        <div className="flex gap-1.5">
                          {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as AnnotationSeverity[]).map((sev) => {
                            const sc = ANNOTATION_SEVERITY_COLOR[sev];
                            return (
                              <button
                                key={sev}
                                onClick={() => setEditSeverity(sev)}
                                className={classNames(
                                  'px-2 py-0.5 rounded text-[10px] font-medium border transition',
                                  editSeverity === sev
                                    ? `${sc.bg} ${sc.border} ${sc.text}`
                                    : 'bg-white border-slate-200 text-slate-500'
                                )}
                              >
                                {ANNOTATION_SEVERITY_LABEL[sev]}
                              </button>
                            );
                          })}
                        </div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="input text-xs min-h-[40px] resize-y"
                          rows={2}
                        />
                        <textarea
                          value={editSuggestion}
                          onChange={(e) => setEditSuggestion(e.target.value)}
                          className="input text-xs min-h-[30px] resize-y"
                          placeholder="处理建议"
                          rows={1}
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => setEditingId(null)}
                            className="btn-ghost text-[10px] px-2 py-0.5"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleUpdate(ann.id)}
                            className="btn-primary text-[10px] px-2 py-0.5"
                          >
                            <Check size={10} /> 保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm text-slate-800 leading-relaxed">{ann.content}</div>
                        {ann.suggestion && (
                          <div className="text-xs text-slate-600 mt-1 bg-white/50 rounded-lg px-2 py-1 border border-slate-200/60">
                            💡 {ann.suggestion}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(ann)}
                        className="p-1 rounded hover:bg-white/60 text-slate-400 hover:text-slate-700 transition"
                        title="编辑"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        onClick={() => remove(recordId, ann.id)}
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
