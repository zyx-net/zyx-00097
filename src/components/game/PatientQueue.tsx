import React from 'react';
import { User, CheckCircle2 } from 'lucide-react';
import type { Patient, Channel } from '../../types';
import { CHANNEL_COLOR, CHANNEL_SHORT } from '../../types';
import { classNames } from '../../utils/uuid';

interface PatientQueueProps {
  patients: Patient[];
  assignments: Record<string, Channel | null>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  showAnswers?: boolean;
}

export function PatientQueue({
  patients,
  assignments,
  selectedId,
  onSelect,
  disabled,
  showAnswers,
}: PatientQueueProps) {
  return (
    <div className="space-y-2">
      {patients
        .sort((a, b) => a.sequenceNo - b.sequenceNo)
        .map((p) => {
          const assigned = assignments[p.id];
          const isSelected = selectedId === p.id;
          const color = assigned ? CHANNEL_COLOR[assigned] : null;
          const answerColor = showAnswers ? CHANNEL_COLOR[p.correctChannel] : null;
          return (
            <button
              key={p.id}
              onClick={() => !disabled && onSelect(p.id)}
              disabled={disabled}
              className={classNames(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all duration-200',
                isSelected
                  ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200 shadow-md'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                disabled && 'opacity-60 cursor-not-allowed',
                !disabled && !isSelected && 'active:scale-[0.99]'
              )}
            >
              <div
                className={classNames(
                  'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                  assigned && color
                    ? `${color.bg} ${color.border} border-2 ${color.text}`
                    : 'bg-slate-100 text-slate-500'
                )}
              >
                <User size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-400">
                    #{p.sequenceNo}
                  </span>
                  <span className="font-semibold text-sm text-slate-800 truncate">
                    {p.name}
                  </span>
                  {showAnswers && assigned === p.correctChannel && (
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                  )}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {p.age} · {p.tags.slice(0, 2).join(' · ')}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {assigned ? (
                  <span
                    className={classNames(
                      'text-[10px] font-bold px-2 py-0.5 rounded-md border',
                      color?.bg,
                      color?.border,
                      color?.text
                    )}
                  >
                    {CHANNEL_SHORT[assigned]}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                    未分诊
                  </span>
                )}
                {showAnswers && answerColor && (
                  <span
                    className={classNames(
                      'text-[9px] px-1.5 py-0.5 rounded border opacity-70',
                      answerColor.bg,
                      answerColor.border,
                      answerColor.text
                    )}
                  >
                    应分·{CHANNEL_SHORT[p.correctChannel]}
                  </span>
                )}
              </div>
            </button>
          );
        })}
    </div>
  );
}
