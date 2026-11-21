import React from 'react';
import {
  CheckCircle2,
  Circle,
  Loader2,
  Lock,
  Pause,
  Play,
} from 'lucide-react';
import { ProjectStatus } from '../lib/bookTypes';
import {
  BOOK_WORKFLOW_STAGES,
  BookWorkflowStageId,
  getStageMeta,
  WorkflowProgressSnapshot,
} from '../lib/bookWorkflow';
import { toPersianDigits } from '../lib/formatParsers';

interface PipelineStepperProps {
  activeStage: BookWorkflowStageId;
  progress: WorkflowProgressSnapshot;
  status: ProjectStatus;
  progressPercent?: number;
  statusMessage?: string;
  busy?: boolean;
  showDashboardOverview?: boolean;
  onToggleDashboardOverview?: () => void;
  onPauseToggle?: () => void;
  onSelectStageView?: (stage: BookWorkflowStageId) => void;
}

export const PipelineStepper: React.FC<PipelineStepperProps> = ({
  activeStage,
  progress,
  status,
  progressPercent,
  statusMessage,
  busy = false,
  showDashboardOverview = false,
  onToggleDashboardOverview,
  onPauseToggle,
  onSelectStageView,
}) => {
  const isPaused = status === 'paused';
  const isWorking =
    busy || status === 'ingesting' || status === 'deduping' || status === 'structuring';

  const activeMeta = getStageMeta(activeStage);

  return (
    <div className="border-b border-[#E2DDD3] bg-white px-4 py-2.5 sm:px-6 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <ol className="flex flex-wrap items-center gap-1.5 sm:gap-2" aria-label="مراحل تدوین کتاب">
          {BOOK_WORKFLOW_STAGES.map((item) => {
            const done = progress.completedStages[item.stage];
            const unlocked = progress.unlockedStages[item.stage];
            const active = activeStage === item.stage;
            const clickable = Boolean(onSelectStageView) && unlocked;

            return (
              <li key={item.stage}>
                <button
                  type="button"
                  disabled={!clickable}
                  aria-current={active ? 'step' : undefined}
                  title={
                    unlocked
                      ? `${item.titleFa} — ${item.singleResponsibilityFa}`
                      : `ابتدا مرحله قبل را تکمیل کنید تا «${item.shortTitleFa}» باز شود`
                  }
                  onClick={() => clickable && onSelectStageView?.(item.stage)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors border ${
                    active
                      ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white cursor-pointer shadow-xs'
                      : done
                        ? 'border-[#C7DDD0] bg-[#EEF6F0] text-[#14532D] hover:bg-[#E1F0E5] cursor-pointer'
                        : unlocked
                          ? 'border-[#D6D0C4] bg-[#FAF9F6] text-[#1E3A5F] hover:bg-[#EFECE4] cursor-pointer'
                          : 'border-transparent bg-[#F5F3EE] text-[#A8A29E] cursor-not-allowed'
                  }`}
                >
                  {active && isWorking ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : unlocked ? (
                    <Circle className="h-3 w-3 shrink-0 opacity-75" />
                  ) : (
                    <Lock className="h-3 w-3 shrink-0 opacity-60" />
                  )}
                  <span className="hidden lg:inline">{item.titleFa}</span>
                  <span className="lg:hidden">{item.shortTitleFa}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-2.5">
          {statusMessage && isWorking && (
            <span className="text-xs text-[#57534E] hidden sm:inline">
              {statusMessage}
            </span>
          )}
          {typeof progressPercent === 'number' &&
            progressPercent > 0 &&
            progressPercent < 100 &&
            isWorking && (
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

      {/* Single-Responsibility Stage Scope Line */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F0EDE6] pt-1.5 text-[11px] text-[#57534E]">
        <span>
          <strong className="text-[#1E3A5F]">وظیفه این مرحله:</strong>{' '}
          {activeMeta.singleResponsibilityFa}
        </span>
        <div className="flex items-center gap-3">
          {activeStage !== 1 && onToggleDashboardOverview && (
            <button
              type="button"
              onClick={onToggleDashboardOverview}
              aria-expanded={showDashboardOverview}
              className="font-bold text-[#1E3A5F] hover:underline cursor-pointer whitespace-nowrap"
            >
              {showDashboardOverview ? 'بستن داشبورد کلی' : 'نمایش داشبورد کلی پروژه‌ها'}
            </button>
          )}
          <span className="text-[#78716C] tabular-nums">
            مرحله {toPersianDigits(activeStage)} از ۵
          </span>
        </div>
      </div>
    </div>
  );
};
