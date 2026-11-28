import React, { useEffect, useMemo, useState } from 'react';
import {
  CloudUpload,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Table2,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import { escapeSafeCsvCell } from '../../lib/collaboration/contributionScoring';
import { CONTRIBUTION_SHEET_HEADERS } from '../../lib/collaboration/platformTypes';
import {
  appendContributionRowsToSheet,
  ensureContributionLogSpreadsheet,
} from '../../lib/googleWorkspace';
import type { WorkspaceConfirmRequest } from './WorkspaceConfirmModal';

interface Props {
  apiClient: ApiClient;
  workspaceAccessToken: string | null;
  onConnectWorkspace: () => Promise<string | null>;
  driveRootFolderId: string | null;
  onRequestWorkspaceConfirm: (req: WorkspaceConfirmRequest) => void;
  refreshSignal: number;
}

type SheetsReportData = Awaited<ReturnType<ApiClient['getCollabSheetsReport']>>;

export const SheetsReportPanel: React.FC<Props> = ({
  apiClient,
  workspaceAccessToken,
  onConnectWorkspace,
  driveRootFolderId,
  onRequestWorkspaceConfirm,
  refreshSignal,
}) => {
  const [report, setReport] = useState<SheetsReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [showEmbed, setShowEmbed] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'added' | 'partial_merge' | 'duplicate' | 'rejected'>('all');

  const loadReport = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getCollabSheetsReport();
      setReport(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در دریافت جدول گزارش مشارکت‌ها.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const filteredRows = useMemo(() => {
    if (!report) return [];
    const q = tableSearch.trim().toLowerCase();
    return report.rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (q) {
        const hay = row.cells.join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [report, tableSearch, statusFilter]);

  const handleDownloadCsv = () => {
    if (!report) return;
    const headers = [...(report.headers || CONTRIBUTION_SHEET_HEADERS), 'همگام‌سازی شیت'];
    const lines = [
      headers.map((h) => escapeSafeCsvCell(h)).join(','),
      ...filteredRows.map((r) =>
        [...r.cells, r.sheetSynced ? 'ثبت‌شده' : 'آماده ارسال']
          .map((c) => escapeSafeCsvCell(c))
          .join(',')
      ),
    ];
    const csvContent = `\uFEFF${lines.join('\r\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `automotive-contributions-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setSyncNotice(`فایل CSV گزارش (${filteredRows.length} ردیف) با فرمت استاندارد اکسل دانلود شد.`);
  };

  const handleSyncAllPendingToGoogleSheets = async () => {
    if (!report) return;
    let token = workspaceAccessToken;
    if (!token) {
      token = await onConnectWorkspace();
      if (!token) return;
    }
    const resolvedToken = token;
    const pendingRows = report.rows.filter((r) => !r.sheetSynced && r.canSyncRow !== false);

    onRequestWorkspaceConfirm({
      title: 'ایجاد / همگام‌سازی شیت گزارش مشارکت‌ها در Google Sheets',
      description:
        pendingRows.length > 0
          ? `${pendingRows.length} ردیف مجاز جدید به شیت گزارش ۱۳ ستونی در Google Drive شما افزوده خواهد شد.`
          : 'شیت گزارش ۱۳ ستونی در Google Drive بررسی یا ایجاد می‌شود.',
      actionLabel: 'اجرای همگام‌سازی Google Sheets',
      details: [
        `تعداد کل ردیف‌های گزارش: ${report.rows.length}`,
        `ردیف‌های آماده و مجاز برای ارسال: ${pendingRows.length}`,
      ],
      onConfirm: async () => {
        setSyncBusy(true);
        setSyncNotice(null);
        try {
          const sheetInfo = await ensureContributionLogSpreadsheet({
            accessToken: resolvedToken,
            existingSpreadsheetId: report.spreadsheet.spreadsheetId,
            parentFolderId: driveRootFolderId,
            tabName: report.spreadsheet.tabName,
            headers: CONTRIBUTION_SHEET_HEADERS,
          });

          let markedCount = 0;
          let failedCount = 0;

          if (pendingRows.length > 0) {
            await appendContributionRowsToSheet({
              accessToken: resolvedToken,
              spreadsheetId: sheetInfo.spreadsheetId,
              tabName: sheetInfo.tabName,
              rows: pendingRows.map((r) => r.cells),
            });

            const settled = await Promise.allSettled(
              pendingRows.map((r) =>
                apiClient.updateCollabContributionWorkspaceSync(r.contributionId, {
                  sheetSynced: true,
                })
              )
            );
            for (const item of settled) {
              if (item.status === 'fulfilled') markedCount += 1;
              else failedCount += 1;
            }
          }

          if (report.isOwner && (sheetInfo.created || !report.spreadsheet.spreadsheetId)) {
            await apiClient
              .updateCollabOwnerSettings({
                sheetsSpreadsheetId: sheetInfo.spreadsheetId,
                sheetsSpreadsheetUrl: sheetInfo.spreadsheetUrl,
                sheetsTabName: sheetInfo.tabName,
              })
              .catch(() => undefined);
          }

          setSyncNotice(
            failedCount > 0
              ? `همگام‌سازی انجام شد: ${markedCount} ردیف تأیید شد و وضعیت ${failedCount} ردیف به‌دلیل محدودیت دسترسی به‌روزرسانی نشد.`
              : `همگام‌سازی کامل شد: ${pendingRows.length} ردیف با موفقیت در Google Sheets ثبت گردید.`
          );
          await loadReport();
        } catch (err) {
          setSyncNotice(
            err instanceof Error ? err.message : 'خطا در همگام‌سازی با Google Sheets.'
          );
        } finally {
          setSyncBusy(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[#E2DDD3] bg-white p-12 text-sm text-[#5A544C]">
        <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#1E3A5F]" />
        در حال بارگذاری گزارش Google Sheets...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-2xl border border-[#E6B8B8] bg-[#FDF2F2] p-6 text-sm text-[#8C2D2D]">
        {errorMsg}
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1F6B43]/10 text-[#1F6B43]">
            <Table2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#1A1816]">
              گزارش زنده مشارکت‌های تیم (ساختار ۱۳ ستونی Google Sheets)
            </h2>
            <p className="text-xs text-[#6B645B] tabular-nums">
              کل مشارکت‌ها: {report?.summary.totalRows || 0} · میانگین محتوای جدید:{' '}
              {report?.summary.avgNewPercent || 0}% · فایل‌های WinOLS:{' '}
              {report?.summary.winolsCount || 0} · در انتظار ارسال به شیت:{' '}
              {report?.summary.pendingSyncCount || 0}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!report || filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F1ECE1] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5 text-[#1F6B43]" />
            دانلود گزارش CSV (اکسل)
          </button>

          <button
            type="button"
            disabled={syncBusy}
            onClick={() => void handleSyncAllPendingToGoogleSheets()}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#162C49] disabled:opacity-60"
          >
            {syncBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudUpload className="h-3.5 w-3.5" />
            )}
            ساخت / همگام‌سازی با Google Sheets
          </button>

          {report?.spreadsheet.spreadsheetUrl && (
            <>
              <a
                href={report.spreadsheet.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-white px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F5F2EB]"
              >
                باز کردن در Google Sheets
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => setShowEmbed((v) => !v)}
                className="whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs font-medium text-[#3E3934] hover:bg-[#F1ECE1]"
              >
                {showEmbed ? 'بستن شیت زنده' : 'نمایش شیت درون اپ'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void loadReport()}
            className="rounded-xl border border-[#D8D2C5] bg-white p-2 text-[#4A453F] hover:bg-[#F5F2EB]"
            aria-label="بروزرسانی جدول"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {syncNotice && (
        <div className="rounded-xl border border-[#C9D8E8] bg-[#F3F7FB] px-4 py-3 text-xs font-medium text-[#1E3A5F]">
          {syncNotice}
        </div>
      )}

      {showEmbed && report?.spreadsheet.spreadsheetId && (
        <div className="overflow-hidden rounded-2xl border border-[#D8D2C5] bg-white">
          <iframe
            src={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(report.spreadsheet.spreadsheetId)}/preview`}
            title="گزارش مشارکت‌های تیم در Google Sheets"
            className="h-[440px] w-full"
          />
        </div>
      )}

      {/* Search & Status Filter Strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-4 py-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-[#8C8375]" />
          <input
            type="text"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="فیلتر سریع در نام فایل، مدل خودرو، ECU، جلد یا نام ارسال‌کننده..."
            aria-label="جستجو در جدول گزارش مشارکت‌ها"
            className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] py-1.5 pl-3 pr-8 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(
              e.target.value as 'all' | 'added' | 'partial_merge' | 'duplicate' | 'rejected'
            )
          }
          aria-label="فیلتر وضعیت مشارکت"
          className="rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-1.5 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
        >
          <option value="all">همه وضعیت‌ها ({report?.rows.length || 0})</option>
          <option value="added">اضافه‌شده (جدید)</option>
          <option value="partial_merge">ادغام جزئی (Delta-Merge)</option>
          <option value="duplicate">تکراری</option>
          <option value="rejected">ردشده (غیرخودرویی)</option>
        </select>
        <span className="text-[11px] text-[#6B645B] tabular-nums">
          نمایش {filteredRows.length} از {report?.rows.length || 0} ردیف
        </span>
      </div>

      {/* 13-Column RTL Data Table */}
      <div className="overflow-hidden rounded-2xl border border-[#E2DDD3] bg-white">
        <div className="flex items-center justify-between border-b border-[#EFEAE0] bg-[#FCFBF8] px-4 py-2 text-[11px] text-[#6B645B]">
          <span>جدول ۱۳ ستونی استاندارد گزارش مشارکت‌ها</span>
          <span>برای مشاهده تمام ستون‌ها (امتیاز و لینک درایو) جدول را به چپ اسکرول کنید</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-[11px]">
            <thead className="border-b border-[#EAE4D9] bg-[#FAF9F6] text-[#4A453F]">
              <tr>
                {(report?.headers || [...CONTRIBUTION_SHEET_HEADERS]).map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-2.5 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
                <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">همگام‌سازی شیت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1ECE1]">
              {filteredRows.length > 0 ? (
                filteredRows.map((row) => (
                  <tr key={row.contributionId} className="hover:bg-[#FCFBF8]">
                    {row.cells.map((cell, idx) => (
                      <td
                        key={idx}
                        className={`max-w-[170px] truncate px-2.5 py-2 ${
                          idx === 8 || idx === 9 || idx === 11
                            ? 'font-semibold tabular-nums'
                            : 'text-[#2C2824]'
                        }`}
                        title={cell}
                      >
                        {idx === 12 && row.driveWebViewLink ? (
                          <a
                            href={row.driveWebViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-[#1E3A5F] underline"
                          >
                            لینک Drive
                          </a>
                        ) : (
                          cell
                        )}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2.5 py-2 text-[11px] font-medium">
                      {row.sheetSynced ? (
                        <span className="text-[#1F6B43]">ثبت‌شده</span>
                      ) : (
                        <span className="text-[#8A6116]">آماده ارسال</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-10 text-center text-sm text-[#6B645B]"
                  >
                    هنوز هیچ مشارکتی ثبت نشده است. با اولین آپلود، ردیف ۱۳ ستونی به‌صورت خودکار در
                    اینجا و در Google Sheets ثبت می‌شود.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
