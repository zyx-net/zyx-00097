import React from 'react';
import { AlertTriangle, Shield, Sparkles, X, Package } from 'lucide-react';
import type { ErrorRecord } from '../../types';
import { classNames } from '../../utils/uuid';
import { ERROR_CODES } from '../../types';

interface ToastProps {
  error: ErrorRecord | null;
  onClose: () => void;
}

const ERROR_COLORS: Record<string, string> = {
  [ERROR_CODES.E_GAME_ENDED]: 'bg-slate-900 text-white',
  [ERROR_CODES.E_PAUSED_LOCKED]: 'bg-indigo-700 text-white',
  [ERROR_CODES.E_RESOURCE_DEPLETED]: 'bg-amber-600 text-white',
  [ERROR_CODES.E_NOT_ALL_ASSIGNED]: 'bg-sky-700 text-white',
  [ERROR_CODES.E_ALREADY_SUBMITTED]: 'bg-slate-800 text-white',
};

export function ErrorToast({ error, onClose }: ToastProps) {
  if (!error) return null;
  const style = ERROR_COLORS[error.code] ?? 'bg-red-600 text-white';
  return (
    <div className="fixed top-24 right-6 z-[60] w-[360px] slide-in-right">
      <div className={classNames(style, 'rounded-xl shadow-2xl p-4 pr-10 relative')}>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-1 rounded-md hover:bg-white/10 transition"
          aria-label="关闭提示"
        >
          <X size={16} />
        </button>
        <div className="flex gap-3 items-start">
          <div className="mt-0.5 shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] opacity-75 font-mono tracking-wide">{error.code}</span>
            </div>
            <div className="font-semibold text-sm leading-snug">{error.message}</div>
            <div className="mt-1.5 text-xs opacity-85 flex items-start gap-1.5">
              <Sparkles size={12} className="mt-0.5 shrink-0" />
              <span>{error.suggestion}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfigErrorBanner({ errors }: { errors: ErrorRecord[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="mb-6 rounded-2xl bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 p-5">
      <div className="flex gap-3 items-start">
        <Shield className="text-red-600 shrink-0 mt-0.5" size={22} />
        <div className="flex-1">
          <h3 className="font-title text-red-800 mb-1">关卡配置存在 {errors.length} 处错误</h3>
          <p className="text-sm text-red-700/90 mb-3">
            以下关卡配置不合法，已被自动屏蔽。请修复后重新加载。
          </p>
          <ul className="space-y-1.5 max-h-48 overflow-auto scrollbar-thin pr-2">
            {errors.map((e, idx) => (
              <li
                key={idx}
                className="text-xs font-mono bg-white/70 border border-red-100 rounded-lg px-3 py-2 text-red-900"
              >
                <span className="opacity-60">[{e.code}]</span> {e.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function WarningBanner({ text }: { text: string }) {
  return (
    <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex gap-2.5 items-center text-sm text-amber-800 fade-in">
      <AlertTriangle size={18} className="shrink-0" />
      <span>{text}</span>
    </div>
  );
}
