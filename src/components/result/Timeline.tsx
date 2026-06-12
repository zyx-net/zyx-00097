import React from 'react';
import { Play, Pause, CheckCircle, MoveRight, Package, Minus, UserCheck, X, MessageSquare } from 'lucide-react';
import type { ActionLog, CoachAnnotation } from '../../types';
import { ANNOTATION_SEVERITY_COLOR, ANNOTATION_SEVERITY_LABEL } from '../../types';
import { CHANNEL_SHORT } from '../../types';
import { classNames } from '../../utils/uuid';
import { loadAnnotations } from '../../utils/storage';

interface TimelineProps {
  logs: ActionLog[];
  startTime: number;
  patientNames: Record<string, string>;
  resourceNames: Record<string, string>;
  recordId?: string;
}

const typeMeta: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  ALLOCATE: { icon: <UserCheck size={12} />, label: '分配', color: 'emerald' },
  DEALLOCATE: { icon: <X size={12} />, label: '取消', color: 'slate' },
  REALLOCATE: { icon: <MoveRight size={12} />, label: '改判', color: 'sky' },
  RESOURCE_USE: { icon: <Package size={12} />, label: '消耗资源', color: 'amber' },
  RESOURCE_RETURN: { icon: <Minus size={12} />, label: '归还资源', color: 'indigo' },
  PAUSE: { icon: <Pause size={12} />, label: '暂停', color: 'violet' },
  RESUME: { icon: <Play size={12} />, label: '继续', color: 'violet' },
  SUBMIT: { icon: <CheckCircle size={12} />, label: '提交', color: 'sky' },
  SELECT_PATIENT: { icon: <UserCheck size={12} />, label: '选择', color: 'slate' },
};

export function Timeline({ logs, startTime, patientNames, resourceNames, recordId }: TimelineProps) {
  const annotations: CoachAnnotation[] = recordId ? loadAnnotations(recordId) : [];
  const timestampAnnotations = React.useMemo(() => {
    const map = new Map<number, CoachAnnotation[]>();
    for (const ann of annotations) {
      if (ann.targetType === 'TIMESTAMP' && ann.timestampMs != null) {
        const key = Math.floor((ann.timestampMs - startTime) / 1000);
        const list = map.get(key) ?? [];
        list.push(ann);
        map.set(key, list);
      }
    }
    return map;
  }, [annotations, startTime]);

  if (logs.length === 0) return null;

  const colorClass: Record<string, string> = {
    emerald: 'bg-emerald-500',
    slate: 'bg-slate-400',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    indigo: 'bg-indigo-500',
    violet: 'bg-violet-500',
  };

  return (
    <div className="card p-5">
      <h3 className="section-title mb-4">操作时间线</h3>
      <div className="space-y-0">
        {logs.slice().reverse().map((log, idx) => {
          const meta = typeMeta[log.type] ?? {
            icon: <Play size={12} />,
            label: log.type,
            color: 'slate',
          };
          const t = Math.max(0, Math.floor((log.timestamp - startTime) / 1000));
          const m = Math.floor(t / 60);
          const s = t % 60;
          const isLast = idx === logs.length - 1;

          let content = log.note || '';
          if (!content && (log.type === 'RESOURCE_USE' || log.type === 'RESOURCE_RETURN')) {
            const parts: string[] = [];
            if (log.patientId) parts.push(`患者 ${patientNames[log.patientId] ?? log.patientId}`);
            if (log.resourceId) parts.push(`资源：${resourceNames[log.resourceId] ?? log.resourceId}`);
            content = parts.join(' · ');
          }
          if (!content && log.patientId) {
            content = `患者 ${patientNames[log.patientId] ?? log.patientId}`;
            if (log.fromChannel) content += ` · ${CHANNEL_SHORT[log.fromChannel]} →`;
            if (log.toChannel) content += ` ${CHANNEL_SHORT[log.toChannel]}`;
          }
          if (!content && log.resourceId) {
            content = `资源：${resourceNames[log.resourceId] ?? log.resourceId}`;
          }

          return (
            <div key={idx} className="flex gap-3 relative pl-1">
              <div className="flex flex-col items-center pt-1">
                <div
                  className={classNames(
                    'w-6 h-6 rounded-full flex items-center justify-center text-white shadow-sm shrink-0 z-10',
                    colorClass[meta.color]
                  )}
                >
                  {meta.icon}
                </div>
                {!isLast && (
                  <div className="w-px flex-1 bg-slate-200 my-1" />
                )}
              </div>
              <div className="flex-1 pb-3 pt-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-400">
                    {m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
                  </span>
                  <span
                    className={classNames(
                      'px-1.5 py-0.5 rounded text-[10px] font-semibold'
                    )}
                    style={{
                      backgroundColor:
                        meta.color === 'emerald'
                          ? '#ecfdf5'
                          : meta.color === 'sky'
                          ? '#f0f9ff'
                          : meta.color === 'amber'
                          ? '#fffbeb'
                          : meta.color === 'indigo'
                          ? '#eef2ff'
                          : meta.color === 'violet'
                          ? '#faf5ff'
                          : '#f1f5f9',
                      color:
                        meta.color === 'emerald'
                          ? '#047857'
                          : meta.color === 'sky'
                          ? '#0369a1'
                          : meta.color === 'amber'
                          ? '#b45309'
                          : meta.color === 'indigo'
                          ? '#4338ca'
                          : meta.color === 'violet'
                          ? '#6d28d9'
                          : '#475569',
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
                <div className="text-sm text-slate-700 mt-0.5">{content}</div>
                {timestampAnnotations.has(t) && (
                  <div className="mt-1 space-y-1">
                    {timestampAnnotations.get(t)!.map((ann) => {
                      const c = ANNOTATION_SEVERITY_COLOR[ann.severity];
                      return (
                        <div
                          key={ann.id}
                          className={classNames('flex items-start gap-1.5 px-2 py-1 rounded-lg border text-[11px]', c.bg, c.border)}
                        >
                          <MessageSquare size={10} className={classNames('shrink-0 mt-0.5', c.text)} />
                          <div className={classNames('flex-1 min-w-0', c.text)}>
                            <span className="font-semibold">{ANNOTATION_SEVERITY_LABEL[ann.severity]}</span>
                            {' '}{ann.content}
                            {ann.suggestion && <span className="opacity-70"> → {ann.suggestion}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
