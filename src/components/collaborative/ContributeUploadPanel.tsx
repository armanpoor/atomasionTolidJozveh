import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  CloudUpload,
  FileAudio,
  FileCode2,
  FileText,
  HardDrive,
  Loader2,
  ShieldAlert,
  Sparkles,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import {
  classifyContributionFileCategory,
  isWinolsPackageExtension,
  validateWinolsMetadata,
} from '../../lib/collaboration/contributionScoring';
import {
  CONTRIBUTION_SHEET_HEADERS,
  type KnowledgeWishlistItem,
  type TeamContributionRecord,
} from '../../lib/collaboration/platformTypes';
import {
  appendContributionRowsToSheet,
  ensureContributionLogSpreadsheet,
  uploadAutomotiveAssetToCategorizedDriveFolder,
} from '../../lib/googleWorkspace';
import { exportBookToMarkdown, parseAnySourceFile } from '../../lib/formatParsers';
import type { ProjectHealthMonitorReport } from '../../lib/masterEncyclopedia/smartClusteringAndHealthMonitor';
import type { WorkspaceConfirmRequest } from './WorkspaceConfirmModal';

interface Props {
  apiClient: ApiClient;
  workspaceAccessToken: string | null;
  onConnectWorkspace: () => Promise<string | null>;
  workspaceConfig: {
    driveRootFolderId: string | null;
    driveRootFolderName: string;
    sheetsSpreadsheetId: string | null;
    sheetsSpreadsheetUrl: string | null;
    sheetsTabName: string;
  };
  activeBounty: KnowledgeWishlistItem | null;
  onClearBounty: () => void;
  onContributionCompleted: () => void;
  onRequestWorkspaceConfirm: (req: WorkspaceConfirmRequest) => void;
  onOpenLibraryVolume: (volumeId: string) => void;
  isOwner: boolean;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export const ContributeUploadPanel: React.FC<Props> = ({
  apiClient,
  workspaceAccessToken,
  onConnectWorkspace,
  workspaceConfig,
  activeBounty,
  onClearBounty,
  onContributionCompleted,
  onRequestWorkspaceConfirm,
  onOpenLibraryVolume,
  isOwner,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultCardRef = useRef<HTMLElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');
  const [isDragging, setIsDragging] = useState(false);

  // WinOLS 2.24 & technical metadata fields
  const [vehicleModel, setVehicleModel] = useState(activeBounty?.vehicleModel || '');
  const [ecuModel, setEcuModel] = useState(activeBounty?.ecuModel || '');
  const [mapList, setMapList] = useState('');

  // Sync preferences
  const [syncToDriveAndSheet, setSyncToDriveAndSheet] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [creatingSuggestedBountyId, setCreatingSuggestedBountyId] = useState<string | null>(null);
  const [createdSuggestedBountyIds, setCreatedSuggestedBountyIds] = useState<string[]>([]);
  const [syncingWorkspace, setSyncingWorkspace] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);

  const [dryRunPreview, setDryRunPreview] = useState<{
    gatekeeperDecision: string;
    gatekeeperReasonFa: string;
    detectedVolumeTitle: string;
    brokenTablesMergedCount: number;
    primaryCluster: {
      familyId: string;
      clusterTitleFa: string;
      subChapterTitleFa: string;
    };
    crossReferenceRoutedCount: number;
    routedLinesPreview: Array<{
      originChapterTitle: string;
      targetClusterTitleFa: string;
      targetSubChapterTitleFa: string;
      signals: string[];
    }>;
    phoneticCorrectionsCount: number;
    tokenAccounting: {
      inputHexCount: number;
      outputHexCount: number;
      inputDtcCount: number;
      outputDtcCount: number;
      zeroLossVerified: boolean;
    };
    healthReport: ProjectHealthMonitorReport;
  } | null>(null);

  const [lastResult, setLastResult] = useState<{
    contribution: TeamContributionRecord;
    sheetRow: string[];
    recommendedDriveFolder: {
      categoryFolder: string;
      subFolder: string;
      displayPath: string;
    } | null;
    bountyFulfilled: KnowledgeWishlistItem | null;
    transcriptPreview?: string | null;
    crossReferenceRoutedCount?: number;
    projectHealthReport?: ProjectHealthMonitorReport | null;
    rawFile: File | null;
  } | null>(null);

  // Sync bounty prefill when activeBounty changes
  React.useEffect(() => {
    if (activeBounty) {
      if (activeBounty.vehicleModel) setVehicleModel(activeBounty.vehicleModel);
      if (activeBounty.ecuModel) setEcuModel(activeBounty.ecuModel);
    }
  }, [activeBounty]);

  // Smoothly scroll result card into view after a contribution finishes
  React.useEffect(() => {
    if (lastResult && resultCardRef.current) {
      resultCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [lastResult]);

  const fileCategoryInfo = useMemo(() => {
    if (inputMode === 'text') {
      return classifyContributionFileCategory(pastedTitle.trim() || 'automotive-note.md', 'md');
    }
    if (!selectedFile) return null;
    return classifyContributionFileCategory(selectedFile.name);
  }, [inputMode, selectedFile, pastedTitle]);

  const isWinolsSelected = Boolean(
    fileCategoryInfo && isWinolsPackageExtension(fileCategoryInfo.extension)
  );

  const handleFilePick = (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    setInputMode('file');
    setErrorMsg(null);
    setWorkspaceNotice(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFilePick(f);
  };

  const executeDriveAndSheetSync = async (
    result: NonNullable<typeof lastResult>,
    token: string
  ) => {
    setSyncingWorkspace(true);
    setWorkspaceNotice(null);
    try {
      let driveFileId = result.contribution.driveFileId;
      let driveWebViewLink = result.contribution.driveWebViewLink;
      let driveFolderPath = result.contribution.driveFolderPath;

      // 1. Upload accepted / partial file to categorized Google Drive folder
      if (
        result.rawFile &&
        result.recommendedDriveFolder &&
        (result.contribution.status === 'added' || result.contribution.status === 'partial_merge')
      ) {
        const ab = await result.rawFile.arrayBuffer();
        const uploaded = await uploadAutomotiveAssetToCategorizedDriveFolder({
          accessToken: token,
          rootFolderId: workspaceConfig.driveRootFolderId,
          rootFolderName: workspaceConfig.driveRootFolderName,
          categoryFolder: result.recommendedDriveFolder.categoryFolder,
          subFolder: result.recommendedDriveFolder.subFolder,
          fileName: result.rawFile.name,
          mimeType: result.rawFile.type || 'application/octet-stream',
          contentBytes: new Uint8Array(ab),
          description: [
            result.contribution.vehicleModel ? `خودرو: ${result.contribution.vehicleModel}` : '',
            result.contribution.ecuModel ? `ECU: ${result.contribution.ecuModel}` : '',
            result.contribution.mapList ? `جداول: ${result.contribution.mapList}` : '',
          ]
            .filter(Boolean)
            .join(' | '),
        });
        driveFileId = uploaded.id;
        driveWebViewLink = uploaded.webViewLink;
        driveFolderPath = uploaded.folderPath;
      }

      // 2. Ensure Contribution Log Google Sheet exists & append the 13-column row
      const sheetInfo = await ensureContributionLogSpreadsheet({
        accessToken: token,
        existingSpreadsheetId: workspaceConfig.sheetsSpreadsheetId,
        parentFolderId: workspaceConfig.driveRootFolderId,
        tabName: workspaceConfig.sheetsTabName,
        headers: CONTRIBUTION_SHEET_HEADERS,
      });

      const updatedSheetRow = [...result.sheetRow];
      if (driveWebViewLink) {
        updatedSheetRow[12] = driveWebViewLink;
      }

      await appendContributionRowsToSheet({
        accessToken: token,
        spreadsheetId: sheetInfo.spreadsheetId,
        tabName: sheetInfo.tabName,
        rows: [updatedSheetRow],
      });

      // Persist newly created sheet ID if Owner created it for the first time
      if (isOwner && sheetInfo.created) {
        await apiClient
          .updateCollabOwnerSettings({
            sheetsSpreadsheetId: sheetInfo.spreadsheetId,
            sheetsSpreadsheetUrl: sheetInfo.spreadsheetUrl,
            sheetsTabName: sheetInfo.tabName,
          })
          .catch(() => undefined);
      }

      const synced = await apiClient.updateCollabContributionWorkspaceSync(
        result.contribution.id,
        {
          driveFileId,
          driveWebViewLink,
          driveFolderPath,
          sheetSynced: true,
        }
      );

      setLastResult((prev) =>
        prev ? { ...prev, contribution: synced.contribution } : prev
      );
      setWorkspaceNotice(
        'فایل در پوشه دسته‌بندی‌شده Google Drive ذخیره شد و ردیف گزارش مشارکت در Google Sheets ثبت گردید.'
      );
      onContributionCompleted();
    } catch (err) {
      setWorkspaceNotice(
        err instanceof Error
          ? err.message
          : 'خطا در همگام‌سازی با Google Drive / Sheets.'
      );
    } finally {
      setSyncingWorkspace(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setWorkspaceNotice(null);

    if (inputMode === 'file' && !selectedFile) {
      setErrorMsg('لطفاً ابتدا یک فایل تخصصی خودرو انتخاب کنید.');
      return;
    }
    if (inputMode === 'text' && pastedText.trim().length < 25) {
      setErrorMsg('لطفاً حداقل ۲۵ کاراکتر متن فنی خودرو وارد کنید.');
      return;
    }

    const fileName =
      inputMode === 'file'
        ? selectedFile!.name
        : `${(pastedTitle.trim() || 'note-automotive').replace(/\.md$/i, '')}.md`;
    const meta = classifyContributionFileCategory(fileName);

    // Client-side immediate validation for WinOLS 2.24 (.ols / .kp)
    const winolsCheck = validateWinolsMetadata({
      extension: meta.extension,
      vehicleModel,
      ecuModel,
      mapList,
    });
    if (!winolsCheck.valid) {
      setErrorMsg(winolsCheck.errorFa || 'تکمیل مدل خودرو یا ECU برای فایل WinOLS الزامی است.');
      return;
    }

    setSubmitting(true);
    try {
      let extractedText = '';
      let base64Data: string | undefined;
      let mimeType = 'text/plain';

      if (inputMode === 'text') {
        extractedText = pastedText.trim();
        mimeType = 'text/markdown';
      } else if (selectedFile) {
        mimeType = selectedFile.type || 'application/octet-stream';
        const isBinaryOrMedia =
          meta.category === 'ols' ||
          meta.category === 'kp' ||
          meta.category === 'pdf' ||
          meta.category === 'audio' ||
          meta.category === 'ecu_binary';
        const needsTextParse =
          meta.category === 'text' ||
          meta.category === 'word' ||
          meta.category === 'pdf' ||
          meta.category === 'ecu_definition';

        const sharedBuffer = isBinaryOrMedia || needsTextParse ? await selectedFile.arrayBuffer() : null;

        if (isBinaryOrMedia && sharedBuffer) {
          base64Data = arrayBufferToBase64(sharedBuffer);
        }

        if (needsTextParse && sharedBuffer) {
          try {
            const parsedBook = await parseAnySourceFile({
              name: selectedFile.name,
              buffer: sharedBuffer,
            });
            const md = exportBookToMarkdown(parsedBook).trim();
            if (md.length > 0) {
              extractedText = md;
            }
          } catch {
            if (meta.category === 'text' || meta.category === 'ecu_definition') {
              extractedText = await selectedFile.text();
            } else if (meta.category === 'word') {
              base64Data = arrayBufferToBase64(sharedBuffer);
            }
          }
        }
      }

      const response = await apiClient.submitCollabContribution({
        fileName,
        mimeType,
        extractedText: extractedText || undefined,
        base64Data,
        vehicleModel: vehicleModel.trim() || undefined,
        ecuModel: ecuModel.trim() || undefined,
        mapList: mapList.trim() || undefined,
        bountyId: activeBounty?.id || undefined,
      });

      const nextResult = {
        contribution: response.contribution,
        sheetRow: response.sheetRow,
        recommendedDriveFolder: response.recommendedDriveFolder,
        bountyFulfilled: response.bountyFulfilled,
        transcriptPreview: response.transcriptPreview,
        crossReferenceRoutedCount: response.crossReferenceRoutedCount,
        projectHealthReport: response.projectHealthReport,
        rawFile: inputMode === 'file' ? selectedFile : null,
      };
      setLastResult(nextResult);
      setDryRunPreview(null);
      onContributionCompleted();

      if (
        response.contribution.status === 'added' ||
        response.contribution.status === 'partial_merge'
      ) {
        setSelectedFile(null);
        setPastedText('');
        setPastedTitle('');
        setMapList('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }

      if (response.bountyFulfilled) {
        onClearBounty();
      }

      // If user opted in and Google Workspace is already connected, ask explicit confirmation before Drive/Sheet write
      if (syncToDriveAndSheet && workspaceAccessToken) {
        const willUploadToDrive =
          Boolean(nextResult.rawFile) &&
          (response.contribution.status === 'added' ||
            response.contribution.status === 'partial_merge');
        onRequestWorkspaceConfirm({
          title: willUploadToDrive
            ? 'تأیید ذخیره در Google Drive و ثبت در Google Sheets'
            : 'تأیید ثبت ردیف گزارش مشارکت در Google Sheets',
          description: willUploadToDrive
            ? 'آیا مایلید این فایل در پوشه دسته‌بندی‌شده Google Drive ذخیره شده و ردیف گزارش مشارکت به‌صورت خودکار در شیت گزارش ثبت شود؟'
            : 'ردیف گزارش این ارسال (بدون آپلود فایل تکراری یا ردشده در درایو) به‌صورت خودکار در شیت گزارش ۱۳ ستونی ثبت می‌شود.',
          actionLabel: willUploadToDrive ? 'تأیید و ثبت در Drive و Sheets' : 'ثبت ردیف در Google Sheets',
          details: [
            `فایل: ${response.contribution.fileName}`,
            willUploadToDrive && response.recommendedDriveFolder
              ? `مسیر پیشنهادی درایو: ${workspaceConfig.driveRootFolderName}/${response.recommendedDriveFolder.displayPath}`
              : 'ثبت گزارش ردیف در Google Sheets (بدون آپلود مجدد فایل در درایو)',
            `امتیاز مشارکت: ${response.contribution.score} امتیاز (${response.contribution.newPercent}% جدید)`,
          ],
          onConfirm: () => executeDriveAndSheetSync(nextResult, workspaceAccessToken),
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در ارسال فایل.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualWorkspaceSyncClick = async () => {
    if (!lastResult) return;
    let token = workspaceAccessToken;
    if (!token) {
      token = await onConnectWorkspace();
      if (!token) return;
    }
    const resolvedToken = token;
    onRequestWorkspaceConfirm({
      title: 'همگام‌سازی این مشارکت با Google Drive و Google Sheets',
      description:
        'فایل در پوشه تخصصی Google Drive آرشیو می‌شود و ردیف ۱۳ ستونی گزارش مشارکت در Google Sheets ثبت خواهد شد.',
      actionLabel: 'اجرای همگام‌سازی',
      details: [
        `فایل: ${lastResult.contribution.fileName}`,
        `وضعیت: ${lastResult.contribution.statusLabelFa}`,
      ],
      onConfirm: () => executeDriveAndSheetSync(lastResult, resolvedToken),
    });
  };

  const handleDryRunPreviewClick = async () => {
    setErrorMsg(null);
    let textToPreview = '';
    let previewFileName = 'note-automotive.md';

    if (inputMode === 'text') {
      if (pastedText.trim().length < 20) {
        setErrorMsg('برای پیش‌نمایش خوشه‌بندی، حداقل ۲۰ کاراکتر متن فنی خودرو وارد کنید.');
        return;
      }
      textToPreview = pastedText.trim();
      previewFileName = pastedTitle.trim() ? `${pastedTitle.trim()}.md` : 'note-automotive.md';
    } else {
      if (!selectedFile) {
        setErrorMsg('ابتدا یک فایل را برای پیش‌نمایش انتخاب کنید.');
        return;
      }
      previewFileName = selectedFile.name;
      try {
        const buf = await selectedFile.arrayBuffer();
        const parsed = await parseAnySourceFile({ name: selectedFile.name, buffer: buf });
        textToPreview = exportBookToMarkdown(parsed).trim();
      } catch {
        try {
          textToPreview = (await selectedFile.text()).trim();
        } catch {
          textToPreview = '';
        }
      }
      if (!textToPreview) {
        textToPreview = `فایل تخصصی ${selectedFile.name} (${vehicleModel || 'خودرو'} ${ecuModel || 'ECU'} ${mapList || ''})`;
      }
    }

    setPreviewing(true);
    try {
      const res = await apiClient.previewCollabIngest({
        fileName: previewFileName,
        extractedText: textToPreview,
        vehicleModel: vehicleModel.trim() || undefined,
        ecuModel: ecuModel.trim() || undefined,
        mapList: mapList.trim() || undefined,
      });
      setDryRunPreview(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در اجرای پیش‌نمایش خوشه‌بندی.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreateSuggestedBounty = async (
    recId: string,
    bounty: NonNullable<ProjectHealthMonitorReport['recommendations'][number]['suggestedBounty']>
  ) => {
    setCreatingSuggestedBountyId(recId);
    try {
      await apiClient.createCollabWishlistItem({
        title: bounty.title,
        description: bounty.description,
        domainId: bounty.domainId,
        ecuModel: bounty.ecuModel || undefined,
        bonusScore: bounty.bonusScore,
      });
      setCreatedSuggestedBountyIds((prev) => [...prev, recId]);
      onContributionCompleted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در ثبت پیشنهاد در لیست نیازها.');
    } finally {
      setCreatingSuggestedBountyId(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* 1. Explicit Automotive-Only Gatekeeper Banner */}
      <section className="rounded-2xl border border-[#DFD7C8] bg-[#FCFBF8] p-5">
        <div className="flex items-start gap-3.5">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1E3A5F] text-white">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-[#1A1816]">
              قانون آپلود تخصصی: صرفاً فایل‌های مرتبط با حوزه خودرو پذیرفته می‌شوند
            </h2>
            <p className="text-sm leading-7 text-[#4A453F]">
              در این پلتفرم مشارکتی، فقط مجاز به بارگذاری فایل‌های تخصصی خودرو شامل{' '}
              <strong className="font-semibold text-[#1A1816]">
                مکانیک و تنظیم موتور، برق و الکترونیک، شبکه‌های مالتی‌پلکس، دیاگ و عیب‌یابی (DTC)،
                گیربکس، هیبرید/برقی، ریمپ، تیونینگ و فایل‌های WinOLS 2.24 (.ols و .kp)
              </strong>{' '}
              هستید. فایل‌های غیرمرتبط و فایل‌های تکراری پیش از مصرف هوش مصنوعی به‌صورت خودکار با{' '}
              <strong className="font-semibold text-[#1E3A5F]">صفر توکن</strong> شناسایی می‌شوند.
            </p>
            <p className="text-xs text-[#6B645B]">
              پردازش هر فایل صرفاً یک‌بار و برای مقایسه و افزودن بخش‌های جدید (Delta-Merge) به ۶ جلد
              کتاب مرجع خودرو انجام می‌شود.
            </p>
          </div>
        </div>
      </section>

      {/* Active Wishlist Bounty Target Notice */}
      {activeBounty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C9B37E] bg-[#FDF8EC] px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm text-[#5C4412]">
            <Award className="h-4 w-4 shrink-0 text-[#9B6F12]" />
            <span>
              در حال مشارکت برای نیاز دیتابیس:{' '}
              <strong className="font-bold">{activeBounty.title}</strong> · پاداش ویژه:{' '}
              <span className="font-bold tabular-nums">
                <span dir="ltr">+{activeBounty.bonusScore}</span> امتیاز
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClearBounty}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-[#5C4412] hover:bg-[#F4E7C8]"
          >
            <X className="h-3.5 w-3.5" />
            لغو اتصال به نیاز
          </button>
        </div>
      )}

      {/* 2. Upload Form Card */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[#E2DDD3] bg-white p-6 shadow-[0_1px_2px_rgba(26,24,22,0.04)]"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEAE0] pb-4">
          <div>
            <h3 className="text-base font-bold text-[#1A1816]">
              ارسال فایل یا دانش تخصصی به دیتابیس مرجع خودرو
            </h3>
            <p className="mt-0.5 text-xs text-[#6B645B]">
              پشتیبانی کامل از متن، PDF، Word، فایل صوتی (تبدیل به متن فنی) و فایل‌های WinOLS 2.24 (.ols و .kp)
            </p>
          </div>

          <div className="inline-flex rounded-xl border border-[#E2DDD3] bg-[#FAF9F6] p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setInputMode('file');
                setErrorMsg(null);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 transition ${
                inputMode === 'file'
                  ? 'bg-[#1E3A5F] text-white'
                  : 'text-[#4A453F] hover:text-[#1A1816]'
              }`}
            >
              آپلود فایل
            </button>
            <button
              type="button"
              onClick={() => {
                setInputMode('text');
                setErrorMsg(null);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 transition ${
                inputMode === 'text'
                  ? 'bg-[#1E3A5F] text-white'
                  : 'text-[#4A453F] hover:text-[#1A1816]'
              }`}
            >
              ثبت متن مستقیم
            </button>
          </div>
        </div>

        {inputMode === 'file' ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition ${
              isDragging
                ? 'border-[#1E3A5F] bg-[#1E3A5F]/5'
                : selectedFile
                  ? 'border-[#2E6B4E]/50 bg-[#F4FAF6]'
                  : 'border-[#D5CEC2] bg-[#FAF9F6] hover:border-[#1E3A5F]/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.docx,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac,.ols,.kp,.damos,.a2l,.xdf,.csv,.bin,.ori,.mod,.hex,.mpc,.fls,.epr"
              onChange={(e) => {
                handleFilePick(e.target.files?.[0] || null);
                e.currentTarget.value = '';
              }}
              className="hidden"
              id="collab-file-upload"
            />

            {selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1E3A5F]/10 text-[#1E3A5F]">
                  {isWinolsSelected ? (
                    <FileCode2 className="h-6 w-6" />
                  ) : fileCategoryInfo?.category === 'audio' ? (
                    <FileAudio className="h-6 w-6" />
                  ) : (
                    <FileText className="h-6 w-6" />
                  )}
                </div>
                <p className="text-sm font-bold text-[#1A1816]" dir="ltr">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-[#5A544C] tabular-nums">
                  {fileCategoryInfo?.labelFa} · {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-[#D5CEC2] bg-white px-3 py-1.5 text-xs font-medium text-[#3E3934] hover:bg-[#F5F2EB]"
                  >
                    تغییر فایل
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#8C2D2D] hover:bg-[#FCECEC]"
                  >
                    حذف
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1E3A5F]/10 text-[#1E3A5F]">
                  <Upload className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#1A1816]">
                    فایل تخصصی خودرو را اینجا رها کنید یا انتخاب نمایید
                  </p>
                  <p className="mt-1 text-xs text-[#6B645B]">
                    فرمت‌های مجاز: PDF · Word (.docx) · Markdown/Text · صوتی (MP3, WAV, M4A) ·{' '}
                    <span className="font-semibold text-[#1E3A5F]" dir="ltr">
                      WinOLS 2.24 (.ols, .kp)
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1 rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#162C49]"
                >
                  انتخاب فایل از دستگاه
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="collab-paste-title"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                عنوان جزوه یا نکته فنی
              </label>
              <input
                id="collab-paste-title"
                type="text"
                value={pastedTitle}
                onChange={(e) => setPastedTitle(e.target.value)}
                placeholder="مثلاً: عیب‌یابی شبکه CAN و سنسور مپ پژو ۲۰۶ TU5"
                className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3.5 py-2.5 text-sm text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="collab-paste-body"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                متن تخصصی خودرو (مکانیک، برق، مالتی‌پلکس، دیاگ یا ریمپ)
              </label>
              <textarea
                id="collab-paste-body"
                rows={5}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="متن تخصصی خود را اینجا بنویسید یا جای‌گذاری کنید تا با کتاب‌های مرجع مقایسه و بخش‌های جدید اضافه شوند..."
                className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] p-3.5 text-sm leading-7 text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-[#6B645B] tabular-nums">
                <span>
                  {pastedText.trim().length < 25
                    ? `حداقل ${25 - pastedText.trim().length} کاراکتر دیگر وارد کنید`
                    : 'آماده بررسی و ادغام مرجع'}
                </span>
                <span>
                  {pastedText.trim() ? pastedText.trim().split(/\s+/).length : 0} کلمه ·{' '}
                  {pastedText.trim().length} کاراکتر
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Smart WinOLS 2.24 (.ols / .kp) & Vehicle/ECU Metadata Form */}
        <div
          className={`mt-5 rounded-xl border p-4 ${
            isWinolsSelected
              ? 'border-[#1E3A5F]/40 bg-[#F3F6FA]'
              : 'border-[#EAE4D9] bg-[#FAF9F6]'
          }`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-[#1A1816]">
              {isWinolsSelected
                ? 'فرم هوشمند مشخصات فایل WinOLS 2.24 (.ols / .kp) — الزامی'
                : 'مشخصات تکمیلی خودرو و ECU (برای دسته‌بندی دقیق‌تر و جستجوی سریع)'}
            </h4>
            {isWinolsSelected && (
              <span className="text-xs font-semibold text-[#1E3A5F]">
                تکمیل حداقل یکی از دو فیلد خودرو یا ECU الزامی است · امتیاز ویژه WinOLS
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label
                htmlFor="collab-vehicle-model"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                نوع / مدل خودرو {isWinolsSelected ? '(الزامی در صورت خالی بودن ECU)' : '(اختیاری)'}
              </label>
              <input
                id="collab-vehicle-model"
                type="text"
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                placeholder="مثلاً: Peugeot 206 TU5 / دنا پلاس توربو / هیوندای سانتافه"
                className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-sm text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="collab-ecu-model"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                نوع / مدل ECU {isWinolsSelected ? '(الزامی در صورت خالی بودن خودرو)' : '(اختیاری)'}
              </label>
              <input
                id="collab-ecu-model"
                type="text"
                value={ecuModel}
                onChange={(e) => setEcuModel(e.target.value)}
                placeholder="مثلاً: Bosch ME7.4.4 / MED17.4.4 / Siemens SIM2K-241 / Valeo J34"
                className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-sm text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="collab-map-list"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                جداول / نقشه‌های موجود در داموس یا فایل (Map List — اختیاری، امتیاز تشویقی اضافی)
              </label>
              <input
                id="collab-map-list"
                type="text"
                value={mapList}
                onChange={(e) => setMapList(e.target.value)}
                placeholder="مثلاً: KFZW, KFZW2, LAMFA, KFMIRL, LDRXN, کاتاف، دمای فن، محدودکننده سرعت"
                className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-sm text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Google Drive / Sheets Auto-Sync Checkbox & Submit Button */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[#4A453F]">
            <input
              type="checkbox"
              checked={syncToDriveAndSheet}
              onChange={(e) => setSyncToDriveAndSheet(e.target.checked)}
              className="h-4 w-4 rounded border-[#C8C0B2] text-[#1E3A5F] focus:ring-[#1E3A5F]"
            />
            <span>
              در صورت اتصال به Google Workspace، فایل در پوشه دسته‌بندی‌شده Drive ذخیره و ردیف گزارش در
              Google Sheets ثبت شود (با تأیید قبلی)
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={previewing || submitting}
              onClick={handleDryRunPreviewClick}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[#1E3A5F]/30 bg-[#F4F7FB] px-4 py-2.5 text-xs font-semibold text-[#1E3A5F] transition hover:bg-[#E7EEF7] disabled:opacity-60"
            >
              {previewing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  در حال پیش‌تحلیل...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  پیش‌نمایش خوشه‌بندی و سلامت (Dry-Run)
                </>
              )}
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#162C49] disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  در حال بررسی و ادغام مرجع...
                </>
              ) : (
                <>
                  <CloudUpload className="h-4 w-4" />
                  بررسی و ارسال به دیتابیس مرجع
                </>
              )}
            </button>
          </div>
        </div>

        {/* Dry-Run Smart Clustering & Cross-Reference Routing Preview Box */}
        {dryRunPreview && (
          <div
            aria-label="پیش‌نمایش خوشه‌بندی هوشمند"
            className="mt-5 rounded-xl border border-[#C6D4E6] bg-[#F7FAFD] p-4 text-xs text-[#1A1816]"
          >
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#1E3A5F]" />
                <span className="text-sm font-bold text-[#1E3A5F]">
                  پیش‌نمایش خوشه‌بندی هوشمند و مسیریابی تک‌خطی (صفر-توکن — پیش از ثبت نهایی)
                </span>
              </div>
              <span
                className={`rounded-md px-2.5 py-0.5 text-[11px] font-bold ${
                  dryRunPreview.gatekeeperDecision === 'rejected'
                    ? 'bg-[#FCECEC] text-[#9E2A2B]'
                    : 'bg-[#E9F5EE] text-[#1F6B43]'
                }`}
              >
                {dryRunPreview.gatekeeperDecision === 'rejected'
                  ? 'دروازه‌بان: غیرمرتبط با خودرو'
                  : `تأیید حوزه خودرو · سلامت ساختار: ${dryRunPreview.healthReport.healthScorePercent}%`}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="rounded-lg border border-[#E2EAF3] bg-white p-2.5">
                <p className="text-[11px] text-[#6B645B]">جلد و خوشه اصلی مقصد</p>
                <p className="mt-0.5 font-bold text-[#1A1816]">{dryRunPreview.detectedVolumeTitle}</p>
                <p className="mt-0.5 text-[11px] text-[#1E3A5F]">
                  {dryRunPreview.primaryCluster.subChapterTitleFa}
                </p>
              </div>
              <div className="rounded-lg border border-[#E2EAF3] bg-white p-2.5">
                <p className="text-[11px] text-[#6B645B]">مسیریابی تک‌خطی (↗ / ↙) و ترمیم جدول</p>
                <p className="mt-0.5 font-bold text-[#1A1816] tabular-nums">
                  {dryRunPreview.crossReferenceRoutedCount} خط ارجاع متقاطع ·{' '}
                  {dryRunPreview.brokenTablesMergedCount} جدول ترمیم‌شده
                </p>
                {dryRunPreview.phoneticCorrectionsCount > 0 && (
                  <p className="mt-0.5 text-[11px] text-[#1F6B43] tabular-nums">
                    {dryRunPreview.phoneticCorrectionsCount} اصطلاح آوایی به فرمت فنی استاندارد تبدیل شد
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-[#E2EAF3] bg-white p-2.5">
                <p className="text-[11px] text-[#6B645B]">حسابداری توکن‌های حیاتی (Zero-Loss)</p>
                <p className="mt-0.5 font-bold text-[#1F6B43] tabular-nums">
                  هگز: {dryRunPreview.tokenAccounting.outputHexCount}/
                  {dryRunPreview.tokenAccounting.inputHexCount} · کد خطا (DTC):{' '}
                  {dryRunPreview.tokenAccounting.outputDtcCount}/
                  {dryRunPreview.tokenAccounting.inputDtcCount}
                </p>
                <p className="mt-0.5 text-[11px] text-[#5A544C]">
                  حفظ ۱۰۰٪ اعداد و آدرس‌های هگز تأیید شد
                </p>
              </div>
            </div>

            {dryRunPreview.routedLinesPreview.length > 0 && (
              <div className="mt-3 rounded-lg border border-[#DCE6F2] bg-white p-3">
                <p className="mb-1.5 font-bold text-[#1E3A5F]">
                  گزاره‌های تک‌خطی که به خوشه مرجع تخصصی دیگر منتقل می‌شوند (↗ / ↙):
                </p>
                <ul className="space-y-1 text-[11px] text-[#3E3934]">
                  {dryRunPreview.routedLinesPreview.map((item, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-[#1E3A5F]">↗ از «{item.originChapterTitle}»</span>
                      <span>به</span>
                      <span className="font-bold text-[#1F6B43]">«{item.targetSubChapterTitleFa}»</span>
                      <span className="text-[#6B645B]">
                        (سیگنال‌های فنی: {item.signals.join('، ')})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#E6B8B8] bg-[#FDF2F2] p-3.5 text-sm text-[#8C2D2D]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </form>

      {/* 3. Simple, Transparent Contribution Result Card */}
      {lastResult && (
        <section
          ref={resultCardRef}
          aria-label="کارت نتیجه مشارکت"
          className="rounded-2xl border border-[#DFD7C8] bg-white p-6 shadow-[0_1px_2px_rgba(26,24,22,0.05)]"
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#EFEAE0] pb-4">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  lastResult.contribution.status === 'rejected'
                    ? 'bg-[#FCECEC] text-[#9E2A2B]'
                    : lastResult.contribution.status === 'duplicate'
                      ? 'bg-[#F5EFE2] text-[#8A6116]'
                      : 'bg-[#E9F5EE] text-[#1F6B43]'
                }`}
              >
                {lastResult.contribution.status === 'rejected' ? (
                  <AlertCircle className="h-5 w-5" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-[#6B645B]">نتیجه پردازش مشارکت</p>
                <h3 className="text-base font-bold text-[#1A1816]">
                  {lastResult.contribution.statusLabelFa}
                </h3>
                <p className="mt-0.5 text-xs text-[#5A544C]">
                  فایل: <span className="font-semibold">{lastResult.contribution.fileName}</span> ·
                  جلد تشخیص‌داده‌شده:{' '}
                  <span className="font-semibold text-[#1E3A5F]">
                    {lastResult.contribution.detectedVolumeTitle}
                  </span>
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#E2DDD3] bg-[#FAF9F6] px-4 py-2 text-center">
              <p className="text-[11px] font-medium text-[#6B645B]">امتیاز مشارکت (Score)</p>
              <p className="text-2xl font-extrabold text-[#1E3A5F] tabular-nums" dir="ltr">
                +{lastResult.contribution.score}
              </p>
            </div>
          </div>

          <p className="mb-5 text-sm leading-7 text-[#3E3934]">
            {lastResult.contribution.reasonFa}
          </p>

          {/* % New vs % Duplicate Visual Bar */}
          {lastResult.contribution.status !== 'rejected' && (
            <div className="mb-5 rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-4">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                <span className="text-[#1F6B43] tabular-nums">
                  محتوای جدید (New): {lastResult.contribution.newPercent}%
                </span>
                <span className="text-[#7A6A53] tabular-nums">
                  محتوای تکراری (Duplicate): {lastResult.contribution.duplicatePercent}%
                </span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#E6E0D5]">
                <div
                  className="h-full bg-[#247A4D] transition-all"
                  style={{ width: `${lastResult.contribution.newPercent}%` }}
                />
                <div
                  className="h-full bg-[#C8B89E] transition-all"
                  style={{ width: `${lastResult.contribution.duplicatePercent}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#5A544C] tabular-nums">
                <span>واحد جدید: {lastResult.contribution.newUnitsCount}</span>
                <span>ادغام تکمیلی: {lastResult.contribution.mergedUnitsCount}</span>
                <span>بخش تکراری: {lastResult.contribution.duplicateUnitsCount}</span>
                <span>توکن هوش مصنوعی مصرف‌شده: {lastResult.contribution.tokensUsed}</span>
              </div>
            </div>
          )}

          {/* Score Breakdown */}
          {lastResult.contribution.score > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-[#EAE4D9] bg-white px-4 py-3 text-xs text-[#4A453F] tabular-nums">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#1A1816]">
                <Sparkles className="h-3.5 w-3.5 text-[#1E3A5F]" />
                جزئیات امتیاز:
              </span>
              <span>
                نوآوری محتوا: <span dir="ltr">+{lastResult.contribution.scoreBreakdown.baseNoveltyScore}</span>
              </span>
              {lastResult.contribution.scoreBreakdown.winolsBonus > 0 && (
                <span className="font-semibold text-[#1E3A5F]">
                  امتیاز ویژه WinOLS (.ols/.kp):{' '}
                  <span dir="ltr">+{lastResult.contribution.scoreBreakdown.winolsBonus}</span>
                </span>
              )}
              {lastResult.contribution.scoreBreakdown.bountyBonus > 0 && (
                <span className="font-semibold text-[#9B6F12]">
                  پاداش تکمیل نیاز دیتابیس:{' '}
                  <span dir="ltr">+{lastResult.contribution.scoreBreakdown.bountyBonus}</span>
                </span>
              )}
            </div>
          )}

          {/* Transcript Preview for Audio Uploads */}
          {lastResult.transcriptPreview && (
            <div className="mb-5 rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5">
              <p className="mb-1 text-xs font-bold text-[#1A1816]">
                پیش‌نمایش متن تخصصی استخراج‌شده از فایل صوتی:
              </p>
              <p className="text-xs leading-6 text-[#4A453F]">{lastResult.transcriptPreview}...</p>
            </div>
          )}

          {/* Post-Ingest Project Health Monitor & Cross-Reference Routing Report */}
          {lastResult.projectHealthReport && (
            <div
              aria-label="گزارش پایش سلامت پروژه و خوشه‌بندی هوشمند"
              className="mb-5 rounded-xl border border-[#D8E2EE] bg-[#F8FAFC] p-4 text-xs text-[#1A1816]"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#E3EAF2] pb-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#1E3A5F]" />
                  <h4 className="text-sm font-bold text-[#1E3A5F]">
                    ماژول پایش وضعیت پروژه (Project Health Monitor) و خوشه‌بندی هوشمند
                  </h4>
                </div>
                <div className="flex items-center gap-2 tabular-nums">
                  <span className="rounded-md bg-[#E9F5EE] px-2.5 py-0.5 font-bold text-[#1F6B43]">
                    شاخص سلامت ساختار: {lastResult.projectHealthReport.healthScorePercent}%
                  </span>
                  {lastResult.projectHealthReport.crossReferenceRoutedCount > 0 && (
                    <span className="rounded-md bg-[#E8EFF8] px-2.5 py-0.5 font-bold text-[#1E3A5F]">
                      {lastResult.projectHealthReport.crossReferenceRoutedCount} انتقال تک‌خطی (↗/↙)
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="rounded-lg border border-[#E3EAF2] bg-white p-2.5">
                  <p className="text-[11px] text-[#6B645B]">خوشه تخصصی تشخیص‌داده‌شده</p>
                  <p className="mt-0.5 font-bold text-[#1A1816]">
                    {lastResult.projectHealthReport.primaryCluster.clusterTitleFa}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#1E3A5F]">
                    {lastResult.projectHealthReport.primaryCluster.subChapterTitleFa}
                  </p>
                </div>

                <div className="rounded-lg border border-[#E3EAF2] bg-white p-2.5">
                  <p className="text-[11px] text-[#6B645B]">استاندارد WinOLS 2.24 و حافظه TNM</p>
                  <p className="mt-0.5 font-bold text-[#1A1816]" dir="ltr">
                    Base Offset: {lastResult.projectHealthReport.winOls224Audit.recommendedBaseOffsetHex}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#5A544C]">
                    {lastResult.projectHealthReport.winOls224Audit.architectureLabelFa}
                  </p>
                </div>

                <div className="rounded-lg border border-[#E3EAF2] bg-white p-2.5">
                  <p className="text-[11px] text-[#6B645B]">ممیزی صفر-افت هارنس (Token Accounting)</p>
                  <p className="mt-0.5 font-bold text-[#1F6B43] tabular-nums">
                    هگز: {lastResult.projectHealthReport.tokenAccounting.outputHexCount}/
                    {lastResult.projectHealthReport.tokenAccounting.inputHexCount} · DTC:{' '}
                    {lastResult.projectHealthReport.tokenAccounting.outputDtcCount}/
                    {lastResult.projectHealthReport.tokenAccounting.inputDtcCount}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#5A544C]">
                    حفظ ۱۰۰٪ آدرس‌ها و کدهای فنی تأیید شد
                  </p>
                </div>
              </div>

              {lastResult.projectHealthReport.ecuCompletenessSnapshot.length > 0 && (
                <div className="mb-3 rounded-lg border border-[#E3EAF2] bg-white p-3">
                  <p className="mb-2 font-bold text-[#1A1816]">
                    ماتریس پوشش ۱۰ پارامتر حیاتی ریمپ در کتابخانه مرجع:
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {lastResult.projectHealthReport.ecuCompletenessSnapshot.slice(0, 4).map((ecu) => (
                      <div
                        key={ecu.familyId}
                        className="flex items-center justify-between rounded-lg border border-[#EFEAE0] bg-[#FAF9F6] px-3 py-1.5"
                      >
                        <span className="font-semibold text-[#1A1816]">{ecu.shortNameFa}</span>
                        <span className="font-bold text-[#1E3A5F] tabular-nums">
                          {ecu.coveragePercent}% ({10 - ecu.missingCount}/10 نقشه)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {lastResult.projectHealthReport.recommendations.length > 0 && (
                <div className="space-y-2">
                  <p className="font-bold text-[#1A1816]">
                    پیشنهادهای خودکار بهبود ساختار و تکمیل مرجع:
                  </p>
                  {lastResult.projectHealthReport.recommendations.map((rec) => {
                    const alreadyCreated = createdSuggestedBountyIds.includes(rec.id);
                    return (
                      <div
                        key={rec.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E3EAF2] bg-white p-2.5"
                      >
                        <div className="space-y-0.5">
                          <p className="font-bold text-[#1E3A5F]">{rec.titleFa}</p>
                          <p className="text-[11px] text-[#4A453F]">{rec.descriptionFa}</p>
                        </div>
                        {rec.suggestedBounty && (
                          <button
                            type="button"
                            disabled={alreadyCreated || creatingSuggestedBountyId === rec.id}
                            onClick={() => handleCreateSuggestedBounty(rec.id, rec.suggestedBounty!)}
                            className=" whitespace-nowrap rounded-lg border border-[#C9B37E] bg-[#FDF8EC] px-3 py-1.5 text-[11px] font-bold text-[#7A5712] hover:bg-[#F8EDD4] disabled:opacity-60"
                          >
                            {alreadyCreated
                              ? 'در لیست نیازها ثبت شد ✓'
                              : creatingSuggestedBountyId === rec.id
                                ? 'در حال ثبت...'
                                : `+ ثبت خودکار در لیست نیازها (+${rec.suggestedBounty.bonusScore} امتیاز)`}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Workspace Sync & Quick Navigation Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#5A544C]">
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-[#1E3A5F]" />
                {lastResult.contribution.driveWebViewLink ? (
                  <a
                    href={lastResult.contribution.driveWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#1E3A5F] underline"
                  >
                    باز کردن در Google Drive
                  </a>
                ) : (
                  <span>ذخیره‌شده در سامانه (آماده ارسال به Drive)</span>
                )}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5">
                <Table2 className="h-3.5 w-3.5 text-[#1E3A5F]" />
                {lastResult.contribution.sheetSynced
                  ? 'ثبت‌شده در Google Sheets'
                  : 'در صف همگام‌سازی Google Sheets'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {lastResult.contribution.detectedVolumeId &&
                lastResult.contribution.status !== 'rejected' && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenLibraryVolume(lastResult.contribution.detectedVolumeId!)
                    }
                    className="whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-white px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F5F2EB]"
                  >
                    مشاهده در کتابخانه مرجع
                  </button>
                )}

              {!lastResult.contribution.sheetSynced && (
                <button
                  type="button"
                  disabled={syncingWorkspace}
                  onClick={handleManualWorkspaceSyncClick}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162C49] disabled:opacity-60"
                >
                  {syncingWorkspace ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CloudUpload className="h-3.5 w-3.5" />
                  )}
                  {lastResult.contribution.status === 'added' ||
                  lastResult.contribution.status === 'partial_merge'
                    ? 'ذخیره در Drive و ثبت در Google Sheets'
                    : 'ثبت گزارش در Google Sheets'}
                </button>
              )}
            </div>
          </div>

          {workspaceNotice && (
            <p className="mt-3 rounded-lg bg-[#F3F6FA] px-3 py-2 text-xs text-[#1E3A5F]">
              {workspaceNotice}
            </p>
          )}
        </section>
      )}
    </div>
  );
};
