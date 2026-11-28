import React, { useEffect } from 'react';
import { ShieldCheck, X } from 'lucide-react';

export interface WorkspaceConfirmRequest {
  title: string;
  description: string;
  actionLabel: string;
  details?: string[];
  onConfirm: () => Promise<void> | void;
}

interface Props {
  request: WorkspaceConfirmRequest | null;
  busy?: boolean;
  onCancel: () => void;
  onProceed: () => void;
}

export const WorkspaceConfirmModal: React.FC<Props> = ({
  request,
  busy = false,
  onCancel,
  onProceed,
}) => {
  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, busy, onCancel]);

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1816]/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-confirm-title"
      dir="rtl"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-[#E2DDD3] bg-[#FFFFFF] p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1E3A5F]/10 text-[#1E3A5F]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3
              id="workspace-confirm-title"
              className="text-base font-bold text-[#1A1816]"
            >
              {request.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-1.5 text-[#5A544C] hover:bg-[#F3EFE6] disabled:opacity-50"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-sm leading-7 text-[#3E3934]">{request.description}</p>

        {request.details && request.details.length > 0 && (
          <ul className="mb-5 space-y-1.5 rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3 text-xs text-[#4A453F]">
            {request.details.map((d, i) => (
              <li key={i} className="leading-6">
                • {d}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-white px-4 py-2 text-sm font-medium text-[#3E3934] hover:bg-[#F6F3EC] disabled:opacity-50"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={onProceed}
            disabled={busy}
            className="whitespace-nowrap rounded-xl bg-[#1E3A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162C49] disabled:opacity-60"
          >
            {busy ? 'در حال اجرا...' : request.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
