import React from 'react';
import {
  Activity, Wind, Pill, Syringe, Tablets, Bandage, Shield, Scan,
  Thermometer, Zap, ArrowRightLeft, Droplet, Bone, LayoutGrid, CloudFog,
  MessageCircle, Package, User,
} from 'lucide-react';
import type { ResourceSlot, ResourceAssignment } from '../../types';
import { classNames } from '../../utils/uuid';

interface ResourceSlotCardProps {
  slot: ResourceSlot;
  remaining: number;
  onUse: () => void;
  onReturn: () => void;
  disabled?: boolean;
  assignments?: ResourceAssignment[];
  patientNames?: Record<string, string>;
  selectedPatientId?: string | null;
}

const iconMap: Record<string, React.ComponentType<any>> = {
  Activity, Wind, Pill, Syringe, Tablets, Bandage, Shield, Scan,
  Thermometer, Zap, ArrowRightLeft, Droplet, Bone, LayoutGrid, CloudFog,
  MessageCircle, Package,
};

export function ResourceSlotCard({
  slot, remaining, onUse, onReturn, disabled,
  assignments = [], patientNames = {}, selectedPatientId,
}: ResourceSlotCardProps) {
  const Icon = iconMap[slot.icon] ?? Package;
  const depleted = remaining <= 0;
  const low = remaining > 0 && remaining <= Math.ceil(slot.initialCount * 0.3);

  const activeAssignments = assignments.filter((a) => a.resourceId === slot.id && !a.returnedAt);
  const selectedHasActive = selectedPatientId
    ? activeAssignments.some((a) => a.patientId === selectedPatientId)
    : false;

  return (
    <div
      className={classNames(
        'card-tight p-3 flex flex-col gap-2 transition-all duration-200 group',
        depleted && 'opacity-60 bg-slate-50',
        selectedHasActive && 'ring-2 ring-sky-400 bg-sky-50',
        !disabled && !depleted && 'hover:shadow-md hover:-translate-y-0.5'
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={classNames(
            'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
            depleted
              ? 'bg-slate-200 text-slate-500'
              : low
              ? 'bg-amber-100 text-amber-700'
              : 'bg-sky-100 text-sky-700'
          )}
        >
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm text-slate-800 truncate">{slot.name}</div>
            <div
              className={classNames(
                'font-mono font-bold text-sm px-2 py-0.5 rounded-md',
                depleted
                  ? 'bg-slate-200 text-slate-500'
                  : low
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              )}
            >
              {remaining}/{slot.initialCount}
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">
            {slot.description}
            {slot.consumable && (
              <span className="ml-1 text-rose-500">（消耗型）</span>
            )}
          </div>
          {activeAssignments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {activeAssignments.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  className={classNames(
                    'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
                    a.patientId === selectedPatientId
                      ? 'bg-sky-100 text-sky-700 border border-sky-300 font-medium'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  )}
                >
                  <User size={10} />
                  {patientNames[a.patientId] ?? a.patientId}
                </span>
              ))}
              {activeAssignments.length > 3 && (
                <span className="text-[10px] text-slate-400 px-1">+{activeAssignments.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onUse}
          disabled={disabled || depleted}
          className={classNames(
            'flex-1 rounded-lg py-1.5 text-xs font-medium transition',
            !disabled && !depleted
              ? 'bg-sky-600 text-white hover:bg-sky-700 active:scale-[0.98]'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          )}
          title={selectedPatientId ? `为当前选中患者消耗 1 份${slot.name}` : `消耗 1 份${slot.name}（请先选中患者）`}
        >
          {selectedPatientId ? `为选中患者消耗 1` : `消耗 1`}
        </button>
        <button
          onClick={onReturn}
          disabled={disabled || remaining >= slot.initialCount}
          className={classNames(
            'rounded-lg py-1.5 px-3 text-xs font-medium transition',
            !disabled && remaining < slot.initialCount
              ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-[0.98]'
              : 'bg-slate-100 text-slate-300 cursor-not-allowed'
          )}
          title={selectedPatientId ? `从当前选中患者归还${slot.name}` : `归还${slot.name}（请先选中患者）`}
        >
          归还
        </button>
      </div>
    </div>
  );
}
