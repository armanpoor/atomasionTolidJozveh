import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import type { TeamUploadedAssetRecord } from '../../lib/collaboration/platformTypes';
import {
  listDriveFolderContents,
  type LiveDriveBrowserEntry,
} from '../../lib/googleWorkspace';

interface Props {
  apiClient: ApiClient;
  workspaceAccessToken: string | null;
  onConnectWorkspace: () => Promise<string | null>;
  refreshSignal: number;
}

export const DriveBrowserPanel: React.FC<Props> = ({
  apiClient,
  workspaceAccessToken,
  onConnectWorkspace,
  refreshSignal,
}) => {
  const [assets, setAssets] = useState<TeamUploadedAssetRecord[]>([]);
  const [driveRootFolderId, setDriveRootFolderId] = useState<string | null>(null);
  const [driveRootFolderName, setDriveRootFolderName] = useState('دیتابیس مرجع تخصصی خودرو');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [ecuFilter, setEcuFilter] = useState('');
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>('all');

  // Inline PDF Preview inside Drive Browser
  const [previewPdfAsset, setPreviewPdfAsset] = useState<TeamUploadedAssetRecord | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const pdfRequestSeqRef = useRef(0);

  // Live Google Drive explorer state
  const [liveEntries, setLiveEntries] = useState<LiveDriveBrowserEntry[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveFolderId, setLiveFolderId] = useState<string | null>(null);
  const [liveFolderStack, setLiveFolderStack] = useState<Array<{ id: string | null; name: string }>>([
    { id: null, name: 'پوشه اصلی Drive' },
  ]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'indexed' | 'live_drive'>('indexed');

  const loadIndex = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getCollabDriveIndex({
        q: query.trim() || undefined,
        format: formatFilter,
        domain: domainFilter,
        vehicle: vehicleFilter.trim() || undefined,
        ecu: ecuFilter.trim() || undefined,
      });
      setAssets(res.assets);
      setDriveRootFolderId(res.driveRootFolderId);
      setDriveRootFolderName(res.driveRootFolderName);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در دریافت فهرست فایل‌ها.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedFolderPath('all');
    void loadIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal, formatFilter, domainFilter]);

  useEffect(() => {
    if (viewMode === 'live_drive' && workspaceAccessToken) {
      void loadLiveDrive(liveFolderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatFilter]);

  useEffect(() => {
    return () => {
      if (previewPdfUrl && previewPdfUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewPdfUrl);
      }
    };
  }, [previewPdfUrl]);

  useEffect(() => {
    if (!previewPdfAsset) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pdfRequestSeqRef.current += 1;
        setPreviewPdfAsset(null);
        setPreviewPdfUrl(null);
        setLoadingPdf(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewPdfAsset]);

  const folderGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) {
      const folder = a.driveFolderPath || `${driveRootFolderName}/عمومی`;
      counts.set(folder, (counts.get(folder) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [assets, driveRootFolderName]);

  const visibleAssets = useMemo(() => {
    if (selectedFolderPath === 'all') return assets;
    return assets.filter(
      (a) => (a.driveFolderPath || `${driveRootFolderName}/عمومی`) === selectedFolderPath
    );
  }, [assets, selectedFolderPath, driveRootFolderName]);

  const handleOpenInlinePdf = async (asset: TeamUploadedAssetRecord) => {
    const reqSeq = ++pdfRequestSeqRef.current;
    setPreviewPdfAsset(asset);
    setLoadingPdf(true);
    setPreviewPdfUrl(null);
    try {
      if (asset.hasLocalPdfPreview) {
        const blobUrl = await apiClient.fetchCollabPdfBlobUrl(asset.id);
        if (pdfRequestSeqRef.current !== reqSeq) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        setPreviewPdfUrl(blobUrl);
      } else if (asset.driveFileId) {
        if (pdfRequestSeqRef.current !== reqSeq) return;
        setPreviewPdfUrl(
          `https://drive.google.com/file/d/${encodeURIComponent(asset.driveFileId)}/preview`
        );
      } else {
        setPreviewPdfUrl(null);
      }
    } catch {
      if (pdfRequestSeqRef.current !== reqSeq) return;
      setPreviewPdfUrl(null);
    } finally {
      if (pdfRequestSeqRef.current === reqSeq) {
        setLoadingPdf(false);
      }
    }
  };

  const loadLiveDrive = async (targetFolderId: string | null, tokenOverride?: string | null) => {
    const token = tokenOverride || workspaceAccessToken;
    if (!token) return;
    setLiveLoading(true);
    setLiveError(null);
    try {
      const entries = await listDriveFolderContents({
        accessToken: token,
        folderId: targetFolderId || driveRootFolderId || undefined,
        searchQuery: query.trim(),
        extensionFilter: formatFilter,
      });
      setLiveEntries(entries);
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'خطا در خواندن پوشه‌های Google Drive.');
    } finally {
      setLiveLoading(false);
    }
  };

  const handleSwitchToLiveDrive = async () => {
    setViewMode('live_drive');
    let token = workspaceAccessToken;
    if (!token) {
      token = await onConnectWorkspace();
      if (!token) return;
    }
    await loadLiveDrive(liveFolderId, token);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E3A5F]/10 text-[#1E3A5F]">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#1A1816]">
              مرورگر داخلی فایل‌ها و پوشه‌های Google Drive
            </h2>
            <p className="text-xs text-[#6B645B]">
              دسته‌بندی‌شده بر اساس مدل خودرو، نوع ECU، فایل‌های WinOLS 2.24 (.ols و .kp)، PDF و اسناد
            </p>
          </div>
        </div>

        <div className="inline-flex rounded-xl border border-[#E2DDD3] bg-[#FAF9F6] p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setViewMode('indexed')}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${
              viewMode === 'indexed'
                ? 'bg-[#1E3A5F] text-white'
                : 'text-[#4A453F] hover:text-[#1A1816]'
            }`}
          >
            کاتالوگ هوشمند تیم ({assets.length})
          </button>
          <button
            type="button"
            onClick={() => void handleSwitchToLiveDrive()}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${
              viewMode === 'live_drive'
                ? 'bg-[#1E3A5F] text-white'
                : 'text-[#4A453F] hover:text-[#1A1816]'
            }`}
          >
            مرور زنده Google Drive
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (viewMode === 'indexed') void loadIndex();
          else void loadLiveDrive(liveFolderId);
        }}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-[#E2DDD3] bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-[#8C8375]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی نام فایل یا جدول..."
            className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] py-2 pl-3 pr-9 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
          />
        </div>

        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value)}
          aria-label="فیلتر نوع فایل"
          className="rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
        >
          <option value="all">همه فرمت‌ها</option>
          <option value="ols">پروژه WinOLS (.ols)</option>
          <option value="kp">مپ‌پک WinOLS (.kp)</option>
          <option value="pdf">فایل PDF</option>
          <option value="word">فایل Word</option>
          <option value="audio">فایل صوتی</option>
          <option value="text">فایل متنی</option>
        </select>

        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          aria-label="فیلتر حوزه فنی"
          className="rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
        >
          <option value="all">همه حوزه‌های فنی</option>
          <option value="engine_mechanics">مکانیک و تنظیم موتور (جلد ۱)</option>
          <option value="electrical_networks">برق و مالتی‌پلکس (جلد ۲)</option>
          <option value="diagnostics_obd">دیاگ و DTC (جلد ۳)</option>
          <option value="ecu_cybersecurity">مفاهیم پایه و ساختار ECU (جلد ۴)</option>
          <option value="remap_tuning">ریمپ پیشرفته و WinOLS (جلد ۵)</option>
          <option value="hybrid_ev">گیربکس و هیبرید/برقی (جلد ۶)</option>
        </select>

        <input
          type="text"
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
          placeholder="فیلتر مدل خودرو (مثلاً 206)..."
          className="rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
        />

        <input
          type="text"
          value={ecuFilter}
          onChange={(e) => setEcuFilter(e.target.value)}
          placeholder="فیلتر ECU (مثلاً ME7.4.4)..."
          className="rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
        />

        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#162C49]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          اعمال فیلتر
        </button>
      </form>

      {errorMsg && (
        <div className="rounded-xl border border-[#E6B8B8] bg-[#FDF2F2] p-4 text-xs text-[#8C2D2D]">
          {errorMsg}
        </div>
      )}

      {/* Indexed Team Assets Catalog */}
      {viewMode === 'indexed' ? (
        <div className="space-y-4">
          {/* Structured Folder Browser Bar */}
          {folderGroups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#E2DDD3] bg-[#FCFBF8] px-4 py-3 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-[#4A453F]">
                <Folder className="h-3.5 w-3.5 text-[#9B6F12]" />
                پوشه‌های ساختاریافته:
              </span>
              <button
                type="button"
                onClick={() => setSelectedFolderPath('all')}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  selectedFolderPath === 'all'
                    ? 'bg-[#1E3A5F] text-white'
                    : 'border border-[#E2DDD3] bg-white text-[#3E3934] hover:border-[#1E3A5F]'
                }`}
              >
                همه پوشه‌ها ({assets.length})
              </button>
              {folderGroups.map(([folder, count]) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setSelectedFolderPath(folder)}
                  className={`rounded-lg px-2.5 py-1 font-medium transition ${
                    selectedFolderPath === folder
                      ? 'bg-[#1E3A5F] text-white'
                      : 'border border-[#E2DDD3] bg-white text-[#3E3934] hover:border-[#1E3A5F]'
                  }`}
                >
                  {folder} ({count})
                </button>
              ))}
            </div>
          )}

          {/* Inline PDF Preview inside Drive Browser */}
          {previewPdfAsset && (
            <div className="overflow-hidden rounded-2xl border border-[#D8D2C5] bg-white">
              <div className="flex items-center justify-between border-b border-[#EFEAE0] bg-[#FAF9F6] px-4 py-2.5 text-xs font-semibold text-[#1A1816]">
                <span>پیش‌نمایش داخلی PDF: {previewPdfAsset.fileName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewPdfAsset(null);
                    setPreviewPdfUrl(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[#8C2D2D] hover:bg-[#FCECEC]"
                >
                  <X className="h-3.5 w-3.5" />
                  بستن
                </button>
              </div>
              {loadingPdf ? (
                <div className="flex h-64 items-center justify-center text-xs text-[#6B645B]">
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  در حال بارگذاری PDF...
                </div>
              ) : previewPdfUrl ? (
                <iframe
                  src={previewPdfUrl}
                  title={previewPdfAsset.fileName}
                  className="h-[520px] w-full bg-white"
                />
              ) : (
                <p className="p-6 text-center text-xs text-[#6B645B]">
                  نسخه پیش‌نمایش داخلی برای این PDF در دسترس نیست.
                </p>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-[#E2DDD3] bg-white">
            {loading ? (
              <div className="flex items-center justify-center p-10 text-xs text-[#6B645B]">
                <Loader2 className="ml-2 h-4 w-4 animate-spin text-[#1E3A5F]" />
                در حال بارگذاری کاتالوگ فایل‌ها...
              </div>
            ) : visibleAssets.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#6B645B]">
                هنوز فایلی مطابق این فیلترها در کاتالوگ ثبت نشده است. با آپلود فایل‌های .ols، .kp، PDF
                یا جزوات خودرو، به‌صورت خودکار در اینجا دسته‌بندی می‌شوند.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-[#EAE4D9] bg-[#FAF9F6] text-[#5A544C]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">نام فایل و نوع</th>
                      <th className="px-4 py-3 font-semibold">خودرو</th>
                      <th className="px-4 py-3 font-semibold">ECU</th>
                      <th className="px-4 py-3 font-semibold">جداول / Map List</th>
                      <th className="px-4 py-3 font-semibold">مسیر پوشه درایو</th>
                      <th className="px-4 py-3 font-semibold">دسترسی و پیش‌نمایش</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1ECE1]">
                    {visibleAssets.map((asset) => (
                      <tr key={asset.id} className="hover:bg-[#FCFBF8]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {asset.fileCategory === 'ols' || asset.fileCategory === 'kp' ? (
                              <FileCode2 className="h-4 w-4 shrink-0 text-[#1E3A5F]" />
                            ) : (
                              <FileText className="h-4 w-4 shrink-0 text-[#6B645B]" />
                            )}
                            <div>
                              <p className="font-bold text-[#1A1816]" dir="ltr">
                                {asset.fileName}
                              </p>
                              <p className="text-[11px] text-[#6B645B] tabular-nums">
                                .{asset.fileExtension} · {(asset.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                                {asset.uploaderDisplayName}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#2C2824]">{asset.vehicleModel || '—'}</td>
                        <td className="px-4 py-3 font-medium text-[#1E3A5F]">
                          {asset.ecuModel || '—'}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-[#4A453F]">
                          {asset.mapList || '—'}
                        </td>
                        <td className="px-4 py-3 text-[#5A544C]">
                          {asset.driveFolderPath || `${driveRootFolderName}/عمومی`}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {asset.fileCategory === 'pdf' &&
                              (asset.hasLocalPdfPreview || asset.driveFileId) && (
                                <button
                                  type="button"
                                  onClick={() => void handleOpenInlinePdf(asset)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#1E3A5F] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#162C49]"
                                >
                                  <Eye className="h-3 w-3" />
                                  مشاهده PDF
                                </button>
                              )}
                            {asset.driveWebViewLink ? (
                              <a
                                href={asset.driveWebViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-[#1E3A5F] underline"
                              >
                                مشاهده در Drive
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              asset.fileCategory !== 'pdf' && (
                                <span className="text-[#7A7267]">در سامانه ذخیره شده</span>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Live Google Drive Folder Browser */
        <div className="rounded-2xl border border-[#E2DDD3] bg-white p-5">
          {!workspaceAccessToken ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-[#4A453F]">
                برای مرور زنده پوشه‌ها و فایل‌های Google Drive، ابتدا حساب Google Workspace را متصل کنید.
              </p>
              <button
                type="button"
                onClick={() => void handleSwitchToLiveDrive()}
                className="rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#162C49]"
              >
                اتصال به Google Drive
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEAE0] pb-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#5A544C]">
                  {liveFolderStack.map((item, idx) => (
                    <React.Fragment key={`${item.id || 'root'}-${idx}`}>
                      {idx > 0 && <span>/</span>}
                      <button
                        type="button"
                        onClick={() => {
                          const nextStack = liveFolderStack.slice(0, idx + 1);
                          setLiveFolderStack(nextStack);
                          setLiveFolderId(item.id);
                          void loadLiveDrive(item.id);
                        }}
                        className="font-semibold text-[#1E3A5F] hover:underline"
                      >
                        {item.name}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void loadLiveDrive(liveFolderId)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#4A453F] hover:text-[#1A1816]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  تازه‌سازی
                </button>
              </div>

              {liveError && (
                <p className="rounded-xl bg-[#FDF2F2] p-3 text-xs text-[#8C2D2D]">{liveError}</p>
              )}

              {liveLoading ? (
                <div className="flex items-center justify-center py-8 text-xs text-[#6B645B]">
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  در حال خواندن پوشه Google Drive...
                </div>
              ) : liveEntries.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#6B645B]">
                  فایل یا پوشه‌ای در این مسیر یافت نشد.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {liveEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] px-3.5 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {entry.isFolder ? (
                          <Folder className="h-4 w-4 shrink-0 text-[#9B6F12]" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-[#1E3A5F]" />
                        )}
                        {entry.isFolder ? (
                          <button
                            type="button"
                            onClick={() => {
                              setLiveFolderId(entry.id);
                              setLiveFolderStack((prev) => [
                                ...prev,
                                { id: entry.id, name: entry.name },
                              ]);
                              void loadLiveDrive(entry.id);
                            }}
                            className="truncate text-right text-xs font-bold text-[#1A1816] hover:text-[#1E3A5F]"
                          >
                            {entry.name}
                          </button>
                        ) : (
                          <span className="truncate text-xs font-medium text-[#1A1816]">
                            {entry.name}
                          </span>
                        )}
                      </div>
                      <a
                        href={entry.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[11px] font-semibold text-[#1E3A5F] hover:underline"
                        aria-label={`باز کردن ${entry.name}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
