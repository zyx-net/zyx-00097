import React from 'react';
import { Send, Undo2, HelpCircle, ChevronRight } from 'lucide-react';
import { useGameEngine } from '../../hooks/useGameEngine';
import { classNames } from '../../utils/uuid';

interface GameControlsProps {
  onQuickAllocate?: (channel: 'RED' | 'YELLOW' | 'GREEN' | 'BLACK') => void;
  onHelp?: () => void;
}

export function GameControls({ onQuickAllocate, onHelp }: GameControlsProps) {
  const { submit, clearSelectedAssignment, isAllAllocated, session, level } = useGameEngine();
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const allDone = isAllAllocated();
  const ended = session?.status === 'ENDED' || session?.status === 'ABANDONED';
  const paused = session?.status === 'PAUSED';
  const disabled = ended || paused;

  const handleSubmit = async () => {
    if (disabled) return;
    setSubmitting(true);
    const result = submit();
    setSubmitting(false);
    if (!result.ok) {
      setShowConfirm(false);
      return;
    }
    setShowConfirm(false);
  };

  return (
    <>
      <div className="card-tight p-4 space-y-4">
        <div>
          <div className="section-title mb-2">快捷分配</div>
          <div className="grid grid-cols-2 gap-2">
            <QuickBtn
              channel="RED"
              onClick={() => onQuickAllocate?.('RED')}
              disabled={disabled || !session?.selectedPatientId}
            />
            <QuickBtn
              channel="YELLOW"
              onClick={() => onQuickAllocate?.('YELLOW')}
              disabled={disabled || !session?.selectedPatientId}
            />
            <QuickBtn
              channel="GREEN"
              onClick={() => onQuickAllocate?.('GREEN')}
              disabled={disabled || !session?.selectedPatientId}
            />
            <QuickBtn
              channel="BLACK"
              onClick={() => onQuickAllocate?.('BLACK')}
              disabled={disabled || !session?.selectedPatientId}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={clearSelectedAssignment}
            disabled={disabled || !session?.selectedPatientId || !session?.assignments?.[session.selectedPatientId]}
            className="btn-ghost flex-1"
          >
            <Undo2 size={14} />
            取消分配
          </button>
          <button onClick={onHelp} className="btn-ghost" title="查看评分规则">
            <HelpCircle size={14} />
          </button>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <button
            onClick={() => !disabled && setShowConfirm(true)}
            disabled={disabled}
            className={classNames(
              'w-full btn-primary !py-3 text-base font-bold gap-2',
              allDone ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700' : ''
            )}
          >
            {ended ? (
              '本局已结束'
            ) : paused ? (
              '已暂停，请先继续'
            ) : allDone ? (
              <>
                提交答案
                <ChevronRight size={18} />
              </>
            ) : (
              <>
                <Send size={16} />
                提交答案（未完成）
              </>
            )}
          </button>
          {!allDone && !ended && !paused && (
            <div className="mt-1.5 text-xs text-amber-600 flex items-center gap-1 px-1">
              <HelpCircle size={12} />
              请确保所有患者都已分诊后再提交
            </div>
          )}
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card p-6 max-w-md w-full fade-in">
            <h3 className="font-title text-lg mb-2">确认提交？</h3>
            {allDone ? (
              <p className="text-sm text-slate-600 mb-5">
                所有 {level?.patients.length || 0} 名患者均已完成分诊。提交后将立即评分，且无法修改答案。
              </p>
            ) : (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3 mb-5 border border-amber-200">
                ⚠️ 仍有患者未完成分诊，提交将被系统拦截。请先为所有患者分配通道。
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setShowConfirm(false)}>
                取消
              </button>
              <button
                className={classNames(
                  'btn-primary',
                  !allDone && 'opacity-50 cursor-not-allowed'
                )}
                onClick={handleSubmit}
                disabled={submitting || !allDone}
              >
                {submitting ? '提交中...' : '确认提交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function QuickBtn({
  channel,
  onClick,
  disabled,
}: {
  channel: 'RED' | 'YELLOW' | 'GREEN' | 'BLACK';
  onClick: () => void;
  disabled?: boolean;
}) {
  const styles: Record<string, string> = {
    RED: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
    YELLOW: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100',
    GREEN: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100',
    BLACK: 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200',
  };
  const labels: Record<string, string> = {
    RED: '红色通道',
    YELLOW: '黄色通道',
    GREEN: '绿色通道',
    BLACK: '黑色通道',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'rounded-xl border py-2 text-sm font-semibold transition',
        styles[channel],
        disabled && 'opacity-50 cursor-not-allowed hover:bg-inherit',
        !disabled && 'active:scale-[0.97]'
      )}
    >
      {labels[channel]}
    </button>
  );
}
