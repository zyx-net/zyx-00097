import React from 'react';
import { User, Calendar, AlertCircle, FileText, Stethoscope, Tag } from 'lucide-react';
import type { Patient, Channel } from '../../types';
import { CHANNEL_LABEL, CHANNEL_COLOR } from '../../types';
import { VitalsPanel } from './VitalsPanel';
import { classNames } from '../../utils/uuid';

interface PatientCardProps {
  patient: Patient;
  assignedChannel: Channel | null;
  showAnswer?: boolean;
  locked?: boolean;
}

export function PatientCard({ patient, assignedChannel, showAnswer, locked }: PatientCardProps) {
  const color = assignedChannel ? CHANNEL_COLOR[assignedChannel] : null;
  const answerColor = showAnswer ? CHANNEL_COLOR[patient.correctChannel] : null;

  return (
    <div className={classNames('card p-5 h-full fade-in', locked && 'opacity-70')}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-white flex items-center justify-center font-title text-lg shadow-md">
            <User size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-title text-slate-900 text-lg">{patient.name}</span>
              <span className="chip bg-slate-100 text-slate-600 border-slate-200">
                #{patient.sequenceNo}
              </span>
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
              <Calendar size={12} />
              {patient.age} · {patient.gender}
            </div>
          </div>
        </div>

        {assignedChannel && (
          <div
            className={classNames(
              'rounded-xl px-3 py-1.5 text-xs font-semibold border-2',
              color?.bg,
              color?.border,
              color?.text
            )}
          >
            已分配 · {CHANNEL_LABEL[assignedChannel]}
          </div>
        )}
      </div>

      {showAnswer && answerColor && (
        <div
          className={classNames(
            'mb-4 rounded-xl p-3 text-sm border-2',
            answerColor.bg,
            answerColor.border,
            answerColor.text
          )}
        >
          <div className="font-semibold mb-0.5 flex items-center gap-1.5">
            <AlertCircle size={14} />
            正确答案：{CHANNEL_LABEL[patient.correctChannel]}
          </div>
          <div className="text-xs opacity-85 leading-relaxed">{patient.reasoning}</div>
        </div>
      )}

      {!showAnswer && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {patient.tags.map((t) => (
            <span
              key={t}
              className="chip bg-sky-50 text-sky-700 border-sky-200 flex items-center gap-1"
            >
              <Tag size={10} />
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-4 mb-4">
        <InfoRow icon={<FileText size={14} />} label="主诉">
          {patient.chiefComplaint}
        </InfoRow>
        <InfoRow icon={<Stethoscope size={14} />} label="现病史">
          {patient.injuryMechanism !== '无'
            ? `${patient.injuryMechanism}；${patient.history || '既往体健'}`
            : patient.history || '既往体健'}
        </InfoRow>
        {patient.allergies !== '无' && (
          <InfoRow icon={<AlertCircle size={14} />} label="过敏史" warn>
            {patient.allergies}
          </InfoRow>
        )}
      </div>

      <div>
        <div className="section-title mb-2.5">
          <Activity size={16} className="text-sky-600" />
          生命体征
        </div>
        <VitalsPanel vitals={patient.vitalSigns} />
      </div>
    </div>
  );
}

import { Activity } from 'lucide-react';

function InfoRow({
  icon,
  label,
  children,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div
      className={classNames(
        'rounded-xl border px-3.5 py-2.5 text-sm',
        warn
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-slate-50 border-slate-200 text-slate-700'
      )}
    >
      <div className="flex items-center gap-2 text-xs opacity-70 mb-0.5">
        {icon}
        {label}
      </div>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
