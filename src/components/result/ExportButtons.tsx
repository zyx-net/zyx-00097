import React from 'react';
import { Download, RotateCcw, Home, FileJson, FileText, RefreshCw, MessageSquare } from 'lucide-react';
import type { Level, GameRecord } from '../../types';
import { downloadReplayJSON, downloadReplayTXT, downloadScoreResultAsCSV } from '../../utils/export';
import { calculateScore } from '../../utils/scoring';
import { computeReplayHash, getAnnotationCount } from '../../utils/storage';
import { useNavigate } from 'react-router-dom';
import { ImportButton } from './ImportButton';

interface ExportButtonsProps {
  level: Level;
  record: GameRecord;
  onReplay?: () => void;
  getLevel?: (id: string) => Level | null;
  getRecord?: (id: string) => GameRecord | null;
  onImported?: (r: GameRecord) => void;
  onAnyChange?: () => void;
  readonly?: boolean;
}

export function ExportButtons({ level, record, onReplay, getLevel, getRecord, onImported, onAnyChange, readonly }: ExportButtonsProps) {
  const navigate = useNavigate();
  const [recalcResult, setRecalcResult] = React.useState<string | null>(null);
  const annotationCount = getAnnotationCount(record.id);

  const handleRecalc = () => {
    const r = calculateScore(level, record.sessionSnapshot);
    const hash = computeReplayHash(r);
    const originalHash = computeReplayHash(record.scoreSnapshot);
    const match = hash === originalHash && r.total === record.scoreSnapshot.total;
    setRecalcResult(
      match
        ? `✓ 复算成功：总分 ${r.total}，校验码 ${hash}，与原结果一致`
        : `✗ 复算不一致：新 ${r.total} / 原 ${record.scoreSnapshot.total}`
    );
    setTimeout(() => setRecalcResult(null), 8000);
  };

  return (
    <div className="card p-5">
      <h3 className="section-title mb-4">操作与复盘</h3>
      {annotationCount > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
          <MessageSquare size={12} />
          <span>含 <b>{annotationCount}</b> 条教练批注，导出 JSON 时将一并打包（旧版导入会自动兼容）</span>
        </div>
      )}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => downloadReplayJSON(level, record)}
            className="btn-ghost text-sm"
          >
            <FileJson size={14} /> 导出 JSON
          </button>
          <button
            onClick={() => downloadReplayTXT(level, record)}
            className="btn-ghost text-sm"
          >
            <FileText size={14} /> 导出文本
          </button>
          <button
            onClick={() => downloadScoreResultAsCSV(level, record.scoreSnapshot)}
            className="btn-ghost text-sm"
          >
            <Download size={14} /> 成绩 CSV
          </button>
          <button onClick={handleRecalc} className="btn-ghost text-sm">
            <RefreshCw size={14} /> 重新复算
          </button>
        </div>

        {getLevel && getRecord && (
          <div className="pt-2 border-t border-slate-100">
            <ImportButton
              getLevel={getLevel}
              getRecord={getRecord}
              onImported={onImported}
              onAnyChange={onAnyChange}
              variant="accent"
              size="sm"
            />
          </div>
        )}

        {recalcResult && (
          <div
            className={
              'mt-2 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 ' +
              (recalcResult.startsWith('✓')
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-700 border border-red-200')
            }
          >
            {recalcResult}
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-2">
          <button onClick={() => navigate('/')} className="btn-ghost">
            <Home size={14} /> 首页
          </button>
          {readonly ? (
            <button onClick={() => navigate('/history')} className="btn-accent">
              历史
            </button>
          ) : (
            <button
              onClick={onReplay}
              className="btn-accent"
            >
              <RotateCcw size={14} /> 重玩
            </button>
          )}
          <button
            onClick={() => navigate('/history')}
            className="btn-ghost"
          >
            历史
          </button>
        </div>
      </div>
    </div>
  );
}
