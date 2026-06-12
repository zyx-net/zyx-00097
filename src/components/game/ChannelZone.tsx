import React from 'react';
import {
  AlertTriangle, Clock, Footprints, Skull, X, User,
} from 'lucide-react';
import type { Channel, Patient } from '../../types';
import { CHANNEL_LABEL, CHANNEL_COLOR, CHANNEL_SHORT, CHANNEL_ORDER } from '../../types';
import { classNames } from '../../utils/uuid';

const channelIcon: Record<Channel, React.ReactNode> = {
  RED: <AlertTriangle size={18} />,
  YELLOW: <Clock size={18} />,
  GREEN: <Footprints size={18} />,
  BLACK: <Skull size={18} />,
};

const channelHint: Record<Channel, string> = {
  RED: '需立即急救干预',
  YELLOW: '需尽快处理，可短时间等待',
  GREEN: '轻症可延迟处理',
  BLACK: '当前资源下无望救治',
};

interface ChannelZoneProps {
  channel: Channel;
  patients: Patient[];
  assignedIds: string[];
  selectedId: string | null;
  onDrop: (patientId: string, channel: Channel) => void;
  onClick?: (patientId: string) => void;
  showAnswers?: boolean;
  locked?: boolean;
}

export function ChannelZone({
  channel,
  patients,
  assignedIds,
  selectedId,
  onDrop,
  onClick,
  showAnswers,
  locked,
}: ChannelZoneProps) {
  const [isDragOver, setIsDragOver] = React.useState(false);
  const color = CHANNEL_COLOR[channel];
  const assignedPatients = patients.filter((p) => assignedIds.includes(p.id));

  const onDragOver = (e: React.DragEvent) => {
    if (locked) return;
    e.preventDefault();
    setIsDragOver(true);
  };
  const onDragLeave = () => setIsDragOver(false);

  const onDropHandler = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (locked) return;
    const id = e.dataTransfer.getData('application/x-triage-patient');
    if (id) onDrop(id, channel);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropHandler}
      onClick={() => {
        if (!locked && selectedId) onDrop(selectedId, channel);
      }}
      className={classNames(
        'rounded-2xl border-2 border-dashed p-3 transition-all duration-200 cursor-pointer flex flex-col min-h-[160px]',
        color.bg,
        color.border,
        isDragOver && !locked && 'channel-zone-hover',
        locked && 'opacity-80 cursor-default'
      )}
    >
      <div
        className={classNames(
          'flex items-center justify-between mb-2 pb-2 border-b',
          `border-${channel === 'BLACK' ? 'slate' : channel === 'GREEN' ? 'emerald' : channel === 'YELLOW' ? 'amber' : 'red'}-200`
        )}
      >
        <div className="flex items-center gap-2">
          <div
            className={classNames(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              `bg-white/60`,
              color.text
            )}
          >
            {channelIcon[channel]}
          </div>
          <div>
            <div className={classNames('font-title text-sm', color.text)}>
              {CHANNEL_LABEL[channel]}
            </div>
            <div className="text-[10px] opacity-70">{CHANNEL_SHORT[channel]}</div>
          </div>
        </div>
        <div
          className={classNames(
            'font-mono font-bold text-lg px-2 py-0.5 rounded-md bg-white/50',
            color.text
          )}
        >
          {assignedPatients.length}
        </div>
      </div>

      <div className="text-[10px] opacity-60 mb-2 px-1 leading-tight">
        {channelHint[channel]}
      </div>

      <div className="flex-1 space-y-1.5">
        {assignedPatients.length === 0 && (
          <div className="flex items-center justify-center h-12 text-xs opacity-50">
            拖入或点击分配患者
          </div>
        )}
        {assignedPatients.map((p) => {
          const isSelected = selectedId === p.id;
          const correct = showAnswers ? p.correctChannel === channel : undefined;
          return (
            <div
              key={p.id}
              onClick={(e) => {
                e.stopPropagation();
                if (!locked && onClick) onClick(p.id);
              }}
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-triage-patient', p.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              className={classNames(
                'flex items-center gap-2 px-2.5 py-2 rounded-lg border bg-white/70 transition',
                isSelected && !locked && 'ring-2 ring-sky-400 bg-white',
                showAnswers
                  ? correct
                    ? 'border-emerald-300'
                    : 'border-red-300 bg-red-50/70'
                  : 'border-slate-200',
                !locked && 'hover:bg-white cursor-grab active:cursor-grabbing'
              )}
            >
              <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <User size={12} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-800 truncate">
                  #{p.sequenceNo} {p.name}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {p.tags[0]}
                </div>
              </div>
              {!locked && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onClick) onClick(p.id);
                  }}
                  className="text-slate-400 hover:text-red-500 transition p-0.5"
                  title="取消分配"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChannelGridProps {
  patients: Patient[];
  assignments: Record<string, Channel | null>;
  selectedId: string | null;
  onDrop: (patientId: string, channel: Channel) => void;
  onClickPatient?: (patientId: string) => void;
  showAnswers?: boolean;
  locked?: boolean;
}

export function ChannelGrid({
  patients,
  assignments,
  selectedId,
  onDrop,
  onClickPatient,
  showAnswers,
  locked,
}: ChannelGridProps) {
  const getAssigned = (c: Channel) =>
    Object.entries(assignments)
      .filter(([_, ch]) => ch === c)
      .map(([id]) => id);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {CHANNEL_ORDER.map((c) => (
        <ChannelZone
          key={c}
          channel={c}
          patients={patients}
          assignedIds={getAssigned(c)}
          selectedId={selectedId}
          onDrop={onDrop}
          onClick={onClickPatient}
          showAnswers={showAnswers}
          locked={locked}
        />
      ))}
    </div>
  );
}
