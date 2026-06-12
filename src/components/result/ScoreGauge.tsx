import React from 'react';
import { Target, Trophy, Award } from 'lucide-react';
import type { ScoreResult } from '../../types';
import { classNames, round2 } from '../../utils/uuid';

interface ScoreGaugeProps {
  result: ScoreResult;
  maxScore: number;
}

export function ScoreGauge({ result, maxScore }: ScoreGaugeProps) {
  const pct = round2((result.total / maxScore) * 100);
  const circumference = 2 * Math.PI * 88;
  const offset = circumference * (1 - pct / 100);
  const color = pct >= 85 ? '#16a34a' : pct >= 65 ? '#f59e0b' : '#dc2626';

  const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;

  return (
    <div className="card p-6 flex flex-col items-center">
      <div className="relative w-52 h-52 mb-4">
        <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
          <circle cx="100" cy="100" r="88" fill="none" stroke="#e2e8f0" strokeWidth="12" />
          <circle
            cx="100"
            cy="100"
            r="88"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.22,.9,.28,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-xs text-slate-500 mb-0.5">总分</div>
          <div
            className="font-mono font-bold text-4xl tracking-tight"
            style={{ color }}
          >
            {result.total}
          </div>
          <div className="text-xs text-slate-500">/ {maxScore}</div>
        </div>
      </div>

      <div className="flex gap-1.5 mb-3">
        {[0, 1, 2].map((i) => (
          <Trophy
            key={i}
            size={24}
            className={classNames(
              'transition-all duration-700',
              i < stars ? 'text-amber-400 scale-110' : 'text-slate-200'
            )}
            style={{ transitionDelay: `${0.6 + i * 0.15}s` }}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 w-full mt-2">
        <MiniStat
          icon={<Target size={14} />}
          label="准确率"
          value={`${result.accuracy}%`}
          accent="sky"
        />
        <MiniStat
          icon={<Award size={14} />}
          label="资源分"
          value={`${result.resourceScore}`}
          accent="emerald"
        />
        <MiniStat
          icon={<Target size={14} />}
          label="时间分"
          value={`${result.timeScore}`}
          accent="violet"
        />
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  const colors: Record<string, string> = {
    sky: 'text-sky-700 bg-sky-50 border-sky-100',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    violet: 'text-violet-700 bg-violet-50 border-violet-100',
  };
  return (
    <div
      className={classNames(
        'rounded-xl border px-2.5 py-2 text-center',
        colors[accent]
      )}
    >
      <div className="flex items-center justify-center gap-1 text-[11px] opacity-80 mb-0.5">
        {icon}
        {label}
      </div>
      <div className="font-mono font-bold text-base">{value}</div>
    </div>
  );
}
