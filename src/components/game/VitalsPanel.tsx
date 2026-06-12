import React from 'react';
import { Heart, Activity, Droplets, Brain, Wind, Thermometer, AlertTriangle } from 'lucide-react';
import type { VitalSigns } from '../../types';
import { classNames } from '../../utils/uuid';

interface VitalItemProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  abnormal?: boolean;
  hint?: string;
}

function VitalItem({ icon, label, value, unit, abnormal, hint }: VitalItemProps) {
  return (
    <div
      className={classNames(
        'relative rounded-xl border p-3 transition',
        abnormal
          ? 'bg-red-50 border-red-300/60 text-red-800'
          : 'bg-slate-50 border-slate-200 text-slate-700'
      )}
      title={hint}
    >
      {abnormal && (
        <AlertTriangle
          size={14}
          className="absolute top-2 right-2 text-red-500"
        />
      )}
      <div className="flex items-center gap-2 mb-1 opacity-70 text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-mono font-bold text-lg flex items-baseline gap-1">
        <span>{value}</span>
        {unit && <span className="text-xs opacity-60 font-normal">{unit}</span>}
      </div>
    </div>
  );
}

interface VitalsPanelProps {
  vitals: VitalSigns;
}

export function VitalsPanel({ vitals }: VitalsPanelProps) {
  const sys = parseInt(vitals.bp.split('/')[0] ?? '0', 10);
  const dia = parseInt(vitals.bp.split('/')[1] ?? '0', 10);

  const abnormal = {
    hr: vitals.hr < 50 || vitals.hr > 100,
    bp: sys < 90 || sys > 160 || dia < 50 || dia > 100,
    spo2: vitals.spo2 < 94,
    gcs: vitals.gcs < 15,
    respRate: vitals.respRate < 12 || vitals.respRate > 20,
    temperature: vitals.temperature < 36 || vitals.temperature > 37.8,
  };

  return (
    <div className="grid grid-cols-3 gap-2.5">
      <VitalItem
        icon={<Heart size={12} />}
        label="心率 HR"
        value={vitals.hr}
        unit="bpm"
        abnormal={abnormal.hr}
        hint="正常范围: 60-100 bpm"
      />
      <VitalItem
        icon={<Activity size={12} />}
        label="血压 BP"
        value={vitals.bp}
        unit="mmHg"
        abnormal={abnormal.bp}
        hint="正常范围: 90-140 / 60-90 mmHg"
      />
      <VitalItem
        icon={<Droplets size={12} />}
        label="血氧 SpO₂"
        value={vitals.spo2}
        unit="%"
        abnormal={abnormal.spo2}
        hint="正常范围: ≥95%"
      />
      <VitalItem
        icon={<Brain size={12} />}
        label="GCS 评分"
        value={vitals.gcs}
        abnormal={abnormal.gcs}
        hint="正常: 15分；≤12分提示意识障碍"
      />
      <VitalItem
        icon={<Wind size={12} />}
        label="呼吸频率"
        value={vitals.respRate}
        unit="次/分"
        abnormal={abnormal.respRate}
        hint="正常范围: 12-20 次/分"
      />
      <VitalItem
        icon={<Thermometer size={12} />}
        label="体温"
        value={vitals.temperature.toFixed(1)}
        unit="℃"
        abnormal={abnormal.temperature}
        hint="正常范围: 36.0-37.4 ℃"
      />
    </div>
  );
}
