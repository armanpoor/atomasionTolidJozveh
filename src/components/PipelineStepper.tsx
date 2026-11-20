import React from 'react';
import {
  CheckCircle2,
  Circle,
  Loader2,
  Pause,
  Play,
} from 'lucide-react';
import { ProjectStatus } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';

export interface PipelineStageDef {
  stage: number;
  label: string;
  shortLabel: string;
}

const STAGES: PipelineStageDef[] = [
  { stage: 1, label: '۱. دریافت و استخراج اتمی', shortLabel: '۱. دریافت' },
  { stage: 2, label: '۲. ادغام بدون افت و تناقض', shortLabel: '۲. ادغام' },
  { stage: 3, label: '۳. ویرایش فصل‌بندی', shortLabel: '۳. فصل‌بندی' },
  { stage: 4, label: '۴. صفحه‌آرایی و بصری‌سازی', shortLabel: '۴. بصری‌سازی' },
  { stage: 5, label: '۵. ممیزی ۱۰۰٪ و خروجی', shortLabel: '۵. خروجی' },
];

interface PipelineStepperProps {
  currentStage: number;
  status: ProjectStatus;
  progressPercent?: number;
  statusMessage?: string;
  busy?: boolean;
  onPauseToggle?: () => void;
  onSelectStageView?: (stage: number) => void;
}

export const PipelineStepper: React.FC<PipelineStepperProps> = ({
  currentStage,
  status,
  progressPercent,
  statusMessage,
  busy = false,
  onPauseToggle,
  onSelectStageView,
}) => {
  const isPaused = status === 'paused';
  const isWorking =
    busy || status === 'ingesting' || status === 'deduping' || status === 'structuring';

  return (
    <div className="border-b border-[#E2DDD3] bg-white px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ol className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
          {STAGES.map((item) => {
            const done = currentStage > item.stage || (item.stage === 5 && status === 'completed');
            const active = currentStage === item.stage && !done;
            const clickable = Boolean(onSelectStageView) && (done || active || item.stage <= currentStage);

            return (
              <li key={item.stage}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onSelectStageView?.(item.stage)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    done
                      ? 'bg-[#EEF6F0] text-[#14532D] hover:bg-[#E1F0E5] cursor-pointer'
                      : active
                        ? 'bg-[#1E3A5F] text-white cursor-pointer'
                        : 'bg-[#F5F3EE] text-[#78716C] cursor-default'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : active && isWorking ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Circle className="h-3 w-3 shrink-0 opacity-70" />
                  )}
                  <span className="hidden md:inline">{item.label}</span>
                  <span className="md:hidden">{item.shortLabel}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-2.5">
          {statusMessage && (
            <span className="text-xs text-[#57534E] hidden sm:inline">
              {statusMessage}
            </span>
          )}
          {typeof progressPercent === 'number' && progressPercent > 0 && progressPercent < 100 && (
            <span className="text-xs font-bold tabular-nums text-[#1E3A5F]">
              {toPersianDigits(progressPercent)}٪
            </span>
          )}
          {onPauseToggle && (isWorking || isPaused) && (
            <button
              type="button"
              onClick={onPauseToggle}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-1 text-xs font-semibold text-[#1A1816] hover:bg-[#EFECE4] cursor-pointer"
            >
              {isPaused ? (
                <>
                  <Play className="h-3.5 w-3.5 text-[#14532D]" />
                  <span>ادامه پردازش</span>
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5 text-[#9A3412]" />
                  <span>توقف موقت</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
