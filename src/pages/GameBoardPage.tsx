import React, { useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Package, Users, Layers } from 'lucide-react';
import { useGameEngine } from '../hooks/useGameEngine';
import { useGameStore } from '../store/gameStore';
import { useGameTimer } from '../hooks/useCountdown';
import { useScoring } from '../hooks/useScoring';
import { useConfigStore } from '../store/configStore';
import { GameTopBar } from '../components/layout/GameTopBar';
import { ErrorToast, WarningBanner } from '../components/layout/Toasts';
import { PatientCard } from '../components/game/PatientCard';
import { PatientQueue } from '../components/game/PatientQueue';
import { ResourceSlotCard } from '../components/game/ResourceSlot';
import { ChannelGrid } from '../components/game/ChannelZone';
import { GameControls } from '../components/game/GameControls';
import { ERROR_CODES } from '../types';
import { classNames } from '../utils/uuid';

export default function GameBoardPage() {
  const { levelId } = useParams<{ levelId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { levels, init, getLevel } = useConfigStore();
  const { lastError, clearLastError, pendingResumeWarning, clearState } = useGameStore();
  const {
    session,
    level,
    startNew,
    resumeSaved,
    selectPatient,
    allocate,
    deallocate,
    allocateSelected,
    useResource,
    returnResource,
    submit,
  } = useGameEngine();
  const { finalize } = useScoring();

  useGameTimer();

  const [initialized, setInitialized] = React.useState(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!levelId || initialized) return;
    const lv = getLevel(levelId);
    if (!lv) {
      navigate('/', { replace: true });
      return;
    }

    const isResume = search.get('resume') === '1';
    const res = isResume ? resumeSaved(lv) : startNew(lv);
    if (!res.ok && !isResume) {
      clearState();
      startNew(lv);
    }
    setInitialized(true);
  }, [levelId, levels, initialized, navigate, startNew, resumeSaved, getLevel, search, clearState]);

  const result = useGameStore((s) => s.currentResult);
  const record = useGameStore((s) => s.currentRecord);

  useEffect(() => {
    if (result && !record && session?.status === 'ENDED' && level) {
      const rec = finalize(result);
      if (rec && session) {
        navigate(`/result/${rec.id}`, { replace: true });
      }
    }
  }, [result, record, session, level, navigate, finalize]);

  const selectedPatient = level?.patients.find(
    (p) => p.id === session?.selectedPatientId
  );
  const locked =
    !session || session.status === 'PAUSED' || session.status === 'ENDED' || session.status === 'ABANDONED';

  const handleDrop = useCallback(
    (patientId: string, channel: 'RED' | 'YELLOW' | 'GREEN' | 'BLACK') => {
      const r = allocate(patientId, channel);
      if (r.ok && session?.selectedPatientId !== patientId) {
        selectPatient(patientId);
      }
    },
    [allocate, selectPatient, session?.selectedPatientId]
  );

  const handleChannelPatientClick = useCallback(
    (patientId: string) => {
      if (locked) return;
      const assigned = session?.assignments?.[patientId];
      if (assigned) deallocate(patientId);
      selectPatient(patientId);
    },
    [locked, session?.assignments, deallocate, selectPatient]
  );

  if (!level || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        正在加载...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <GameTopBar />

      {pendingResumeWarning && (
        <div className="max-w-[1600px] w-full mx-auto px-5 pt-4">
          <WarningBanner text={pendingResumeWarning} />
        </div>
      )}

      <div className="flex-1 px-4 md:px-5 py-4 md:py-5 max-w-[1600px] w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5 h-full">
          {/* 左侧：病例卡 + 生命体征 */}
          <div className="lg:col-span-5 order-2 lg:order-1">
            {selectedPatient ? (
              <PatientCard
                patient={selectedPatient}
                assignedChannel={session.assignments[selectedPatient.id] ?? null}
                locked={session.status === 'ENDED' || session.status === 'ABANDONED'}
              />
            ) : (
              <div className="card p-8 text-center text-slate-400">
                <Users size={40} className="mx-auto mb-2 opacity-50" />
                <div>请从右侧队列选择一名患者查看病例</div>
              </div>
            )}
          </div>

          {/* 中间：患者队列 + 资源槽 */}
          <div className="lg:col-span-3 order-1 lg:order-2 flex flex-col gap-4">
            <div className="card p-4">
              <div className="section-title">
                <Users size={16} className="text-sky-600" />
                患者队列
              </div>
              <div className="max-h-[36vh] overflow-auto scrollbar-thin pr-1">
                <PatientQueue
                  patients={level.patients}
                  assignments={session.assignments}
                  selectedId={session.selectedPatientId}
                  onSelect={(id) => selectPatient(id)}
                  disabled={session.status === 'PAUSED' || session.status === 'ENDED'}
                />
              </div>
            </div>

            <div className="card p-4 flex-1 min-h-0">
              <div className="section-title">
                <Package size={16} className="text-amber-600" />
                资源槽
              </div>
              <div className="grid gap-2 max-h-[48vh] overflow-auto scrollbar-thin pr-1">
                {level.resourceSlots.map((slot) => (
                  <ResourceSlotCard
                    key={slot.id}
                    slot={slot}
                    remaining={Math.max(
                      0,
                      slot.initialCount - (session.resourceUsage[slot.id] ?? 0)
                    )}
                    onUse={() => useResource(slot.id)}
                    onReturn={() => returnResource(slot.id)}
                    disabled={locked}
                    assignments={session.resourceAssignments}
                    patientNames={Object.fromEntries(
                      level.patients.map((p) => [p.id, `${p.sequenceNo}号·${p.name}`])
                    )}
                    selectedPatientId={session.selectedPatientId}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 右侧：四色通道 + 操作 */}
          <div className="lg:col-span-4 order-3 flex flex-col gap-4">
            <div className="card p-4">
              <div className="section-title">
                <Layers size={16} className="text-emerald-600" />
                分诊通道
                <span className="ml-auto text-xs text-slate-400 font-normal">
                  拖入或点击分配
                </span>
              </div>
              <ChannelGrid
                patients={level.patients}
                assignments={session.assignments}
                selectedId={session.selectedPatientId}
                onDrop={handleDrop}
                onClickPatient={handleChannelPatientClick}
                locked={locked}
              />
            </div>

            <GameControls
              onQuickAllocate={(c) => {
                if (!locked) allocateSelected(c);
              }}
            />
          </div>
        </div>
      </div>

      <ErrorToast
        error={lastError}
        onClose={clearLastError}
      />

      {session.status === 'PAUSED' && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm pointer-events-none" />
      )}
    </div>
  );
}
