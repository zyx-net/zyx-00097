import React from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import type { ScoreResult } from '../../types';
import { CHANNEL_LABEL } from '../../types';
import { classNames } from '../../utils/uuid';

interface ErrorTableProps {
  result: ScoreResult;
  patientMap: Record<string, { name: string; tags: string[] }>;
  reasoningMap: Record<string, string>;
}

export function ErrorTable({ result, patientMap, reasoningMap }: ErrorTableProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  return (
    <div className="card p-5">
      <h3 className="section-title mb-4">分诊明细</h3>
      <div className="space-y-2">
        {result.details.map((d, idx) => {
          const correct = d.assignedChannel === d.correctChannel;
          const expanded = expandedId === d.patientId;
          const patient = patientMap[d.patientId];
          return (
            <div
              key={d.patientId}
              className={classNames(
                'rounded-xl border transition',
                correct
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : 'border-red-200 bg-red-50/40'
              )}
              style={{ animationDelay: `${0.2 + idx * 0.08}s` }}
            >
              <button
                onClick={() => setExpandedId(expanded ? null : d.patientId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                {correct ? (
                  <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
                ) : (
                  <XCircle size={20} className="text-red-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 text-sm">
                      {d.patientName}
                    </span>
                    {patient?.tags?.slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] bg-white/60 border border-slate-200 rounded-full px-1.5 py-0.5 text-slate-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3 flex-wrap">
                    <span>
                      <span className="text-slate-400">正确：</span>
                      <span className="font-semibold text-emerald-700">
                        {CHANNEL_LABEL[d.correctChannel]}
                      </span>
                    </span>
                    <span>
                      <span className="text-slate-400">您的答案：</span>
                      <span
                        className={classNames(
                          'font-semibold',
                          correct ? 'text-emerald-700' : 'text-red-700'
                        )}
                      >
                        {d.assignedChannel
                          ? CHANNEL_LABEL[d.assignedChannel]
                          : '未分配'}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div
                      className={classNames(
                        'font-mono font-bold text-sm',
                        correct ? 'text-emerald-700' : 'text-red-700'
                      )}
                    >
                      {d.score >= 0 ? '+' : ''}
                      {d.score}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      基础 {d.baseScore}
                    </div>
                  </div>
                  {expanded ? (
                    <ChevronUp size={16} className="text-slate-400" />
                  ) : (
                    <ChevronDown size={16} className="text-slate-400" />
                  )}
                </div>
              </button>

              {expanded && (
                <div className="px-4 pb-4 pt-0 border-t border-black/5 mt-0">
                  {reasoningMap[d.patientId] && (
                    <div className="mt-3 flex gap-2.5 bg-white/70 rounded-lg p-3 border border-slate-100">
                      <AlertCircle
                        size={16}
                        className="text-sky-600 shrink-0 mt-0.5"
                      />
                      <div className="text-xs text-slate-700 leading-relaxed">
                        <div className="font-semibold mb-0.5 text-sky-800">
                          正确答案依据
                        </div>
                        {reasoningMap[d.patientId]}
                      </div>
                    </div>
                  )}
                  {d.penalties.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-red-700 mb-1.5">
                        扣分明细
                      </div>
                      <div className="space-y-1">
                        {d.penalties.map((p, i) => (
                          <div
                            key={i}
                            className="text-xs bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5 text-red-700 flex justify-between"
                          >
                            <span>{p.reason}</span>
                            <span className="font-mono font-bold">-{p.amount}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {d.bonuses.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-emerald-700 mb-1.5">
                        奖励明细
                      </div>
                      <div className="space-y-1">
                        {d.bonuses.map((b, i) => (
                          <div
                            key={i}
                            className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5 text-emerald-700 flex justify-between"
                          >
                            <span>{b.reason}</span>
                            <span className="font-mono font-bold">+{b.amount}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
