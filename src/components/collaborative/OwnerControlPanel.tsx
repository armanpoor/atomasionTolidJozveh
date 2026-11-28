import React, { useEffect, useState } from 'react';
import {
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import {
  CONTRIBUTION_SHEET_HEADERS,
  type AccessLevel,
  type PlatformSettingsRecord,
} from '../../lib/collaboration/platformTypes';
import {
  ensureContributionLogSpreadsheet,
  findOrCreateDriveFolder,
} from '../../lib/googleWorkspace';
import type { WorkspaceConfirmRequest } from './WorkspaceConfirmModal';

interface Props {
  apiClient: ApiClient;
  workspaceAccessToken: string | null;
  onConnectWorkspace: () => Promise<string | null>;
  onSettingsUpdated: () => void;
  onOpenAdvancedAdminModal: () => void;
  onRequestWorkspaceConfirm: (req: WorkspaceConfirmRequest) => void;
}

const ACCESS_OPTIONS: Array<{ value: AccessLevel; label: string }> = [
  { value: 'open_all', label: 'باز برای همه (کاربران ایمیل و مهمان)' },
  { value: 'email_only', label: 'فقط کاربران احراز هویت شده با ایمیل' },
  { value: 'owner_only', label: 'فقط مالک پلتفرم' },
];

export const OwnerControlPanel: React.FC<Props> = ({
  apiClient,
  workspaceAccessToken,
  onConnectWorkspace,
  onSettingsUpdated,
  onOpenAdvancedAdminModal,
  onRequestWorkspaceConfirm,
}) => {
  const [settings, setSettings] = useState<PlatformSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getCollabOwnerSettings();
      setSettings(res.settings);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در بارگذاری تنظیمات مالک.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiClient.updateCollabOwnerSettings({
        enableUserPersonalOutput: settings.enableUserPersonalOutput,
        accessLibrary: settings.accessLibrary,
        accessDrive: settings.accessDrive,
        accessDocs: settings.accessDocs,
        accessSheets: settings.accessSheets,
        driveRootFolderId: settings.driveRootFolderId,
        driveRootFolderName: settings.driveRootFolderName,
        sheetsSpreadsheetId: settings.sheetsSpreadsheetId,
        sheetsSpreadsheetUrl: settings.sheetsSpreadsheetUrl,
        sheetsTabName: settings.sheetsTabName,
      });
      setSettings(res.settings);
      setStatusMsg('تنظیمات مالک با موفقیت ذخیره و در سراسر سامانه اعمال شد.');
      onSettingsUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات.');
    } finally {
      setSaving(false);
    }
  };

  const handleProvisionWorkspaceFoldersAndSheet = async () => {
    if (!settings) return;
    let token = workspaceAccessToken;
    if (!token) {
      token = await onConnectWorkspace();
      if (!token) return;
    }
    const resolvedToken = token;

    onRequestWorkspaceConfirm({
      title: 'ایجاد خودکار پوشه اصلی Drive و شیت ۱۳ ستونی Google Sheets',
      description:
        'پوشه اصلی دیتابیس مرجع خودرو در Google Drive و فایل Google Sheets گزارش مشارکت‌ها به‌صورت خودکار ساخته شده و شناسه آن‌ها در تنظیمات مالک ذخیره می‌شود.',
      actionLabel: 'ساخت و اتصال خودکار',
      details: [
        `نام پوشه درایو: ${settings.driveRootFolderName}`,
        `نام برگه شیت: ${settings.sheetsTabName}`,
      ],
      onConfirm: async () => {
        setSaving(true);
        setStatusMsg(null);
        setErrorMsg(null);
        try {
          const folder = await findOrCreateDriveFolder({
            accessToken: resolvedToken,
            folderName: settings.driveRootFolderName || 'دیتابیس مرجع تخصصی خودرو',
          });
          const sheet = await ensureContributionLogSpreadsheet({
            accessToken: resolvedToken,
            existingSpreadsheetId: settings.sheetsSpreadsheetId,
            parentFolderId: folder.id,
            tabName: settings.sheetsTabName,
            headers: CONTRIBUTION_SHEET_HEADERS,
          });
          const updated = await apiClient.updateCollabOwnerSettings({
            driveRootFolderId: folder.id,
            driveRootFolderName: folder.name,
            sheetsSpreadsheetId: sheet.spreadsheetId,
            sheetsSpreadsheetUrl: sheet.spreadsheetUrl,
            sheetsTabName: sheet.tabName,
          });
          setSettings(updated.settings);
          setStatusMsg('پوشه Google Drive و فایل Google Sheets ساخته و به پلتفرم متصل شدند.');
          onSettingsUpdated();
        } catch (err) {
          setErrorMsg(
            err instanceof Error ? err.message : 'خطا در ساخت پوشه Drive و شیت.'
          );
        } finally {
          setSaving(false);
        }
      },
    });
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[#E2DDD3] bg-white p-12 text-sm text-[#5A544C]">
        <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#1E3A5F]" />
        در حال بارگذاری پنل کنترل مالک...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E3A5F] text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#1A1816]">پنل کنترل ساده مالک پلتفرم</h2>
            <p className="text-xs text-[#6B645B]">
              کنترل کلید خروجی شخصی، سطوح دسترسی تیم، تنظیمات Google Drive / Sheets و گزارش مصرف توکن
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenAdvancedAdminModal}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F1ECE1]"
        >
          <Database className="h-3.5 w-3.5 text-[#1E3A5F]" />
          مدیریت پیشرفته دانشنامه (تعارض‌ها / خروجی WinOLS و DOCX)
        </button>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-[#CFE3D6] bg-[#F4FAF6] px-4 py-3 text-xs font-semibold text-[#1F6B43]">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-[#E6B8B8] bg-[#FDF2F2] px-4 py-3 text-xs text-[#8C2D2D]">
          {errorMsg}
        </div>
      )}

      {/* 1. Master Feature Flag: ENABLE_USER_PERSONAL_OUTPUT */}
      <section className="rounded-2xl border border-[#E2DDD3] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl space-y-1">
            <h3 className="text-sm font-bold text-[#1A1816]">
              کلید فعال‌سازی «خروجی کتاب شخصی کاربر» (ENABLE_USER_PERSONAL_OUTPUT)
            </h3>
            <p className="text-xs leading-6 text-[#5A544C]">
              تا زمانی که این کلید خاموش است، تمام قابلیت‌های استودیوی ۵ مرحله‌ای در کدبیس حفظ می‌شوند
              اما مسیرهای پردازش و خروجی شخصی مسدود هستند و{' '}
              <strong className="text-[#1E3A5F]">صفر توکن هوش مصنوعی</strong> برای هدف شخصی کاربر
              مصرف می‌شود. پس از تکمیل دیتابیس می‌توانید با همین کلید آن را دوباره فعال کنید.
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-3">
            <span className="text-xs font-bold text-[#1A1816]">
              {settings.enableUserPersonalOutput ? 'فعال (استودیو شخصی باز است)' : 'خاموش (صفر مصرف شخصی)'}
            </span>
            <input
              type="checkbox"
              checked={settings.enableUserPersonalOutput}
              onChange={(e) =>
                setSettings({ ...settings, enableUserPersonalOutput: e.target.checked })
              }
              className="h-5 w-5 rounded border-[#C8C0B2] text-[#1E3A5F] focus:ring-[#1E3A5F]"
            />
          </label>
        </div>
      </section>

      {/* 2. AI Token Usage Report (Zero-Token-Waste Proof) */}
      <section className="rounded-2xl border border-[#E2DDD3] bg-white p-6">
        <h3 className="mb-4 text-sm font-bold text-[#1A1816]">
          گزارش شفاف مصرف توکن هوش مصنوعی و صرفه‌جویی اسکریپت‌محور
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5">
            <p className="text-[11px] text-[#6B645B]">توکن خروجی شخصی</p>
            <p className="mt-1 text-xl font-extrabold text-[#1F6B43] tabular-nums">
              {settings.tokenLedger.personalOutputTokens}
            </p>
          </div>
          <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5">
            <p className="text-[11px] text-[#6B645B]">درخواست شخصی مسدودشده</p>
            <p className="mt-1 text-xl font-extrabold text-[#1E3A5F] tabular-nums">
              {settings.tokenLedger.zeroTokenBlockedPersonalCalls}
            </p>
          </div>
          <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5">
            <p className="text-[11px] text-[#6B645B]">تکراری صفر-توکن (SHA-256)</p>
            <p className="mt-1 text-xl font-extrabold text-[#1E3A5F] tabular-nums">
              {settings.tokenLedger.zeroTokenDuplicateSaves}
            </p>
          </div>
          <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5">
            <p className="text-[11px] text-[#6B645B]">رد غیرخودرویی صفر-توکن</p>
            <p className="mt-1 text-xl font-extrabold text-[#1E3A5F] tabular-nums">
              {settings.tokenLedger.zeroTokenGatekeeperRejects}
            </p>
          </div>
          <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5">
            <p className="text-[11px] text-[#6B645B]">توکن تبدیل صوت (STT)</p>
            <p className="mt-1 text-xl font-extrabold text-[#1A1816] tabular-nums">
              {settings.tokenLedger.audioTranscribeTokens}
            </p>
          </div>
          <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5">
            <p className="text-[11px] text-[#6B645B]">کل تماس‌های AI</p>
            <p className="mt-1 text-xl font-extrabold text-[#1A1816] tabular-nums">
              {settings.tokenLedger.totalAiCalls}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Team Access Control Matrix */}
      <section className="rounded-2xl border border-[#E2DDD3] bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#1E3A5F]" />
          <h3 className="text-sm font-bold text-[#1A1816]">
            تنظیمات سطح دسترسی بخش‌های فضای کاری تیمی
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              { key: 'accessLibrary', label: 'کتابخانه مرجع و نمایشگر PDF' },
              { key: 'accessDrive', label: 'مرورگر Google Drive و فایل‌های .ols / .kp' },
              { key: 'accessDocs', label: 'مطالعه و ویرایش در Google Docs' },
              { key: 'accessSheets', label: 'مشاهده گزارش ۱۳ ستونی Google Sheets' },
            ] as const
          ).map((item) => (
            <div key={item.key}>
              <label
                htmlFor={`owner-${item.key}`}
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                {item.label}
              </label>
              <select
                id={`owner-${item.key}`}
                value={settings[item.key]}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    [item.key]: e.target.value as AccessLevel,
                  })
                }
                className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
              >
                {ACCESS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Google Drive & Google Sheets Config */}
      <section className="rounded-2xl border border-[#E2DDD3] bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-[#1E3A5F]" />
            <h3 className="text-sm font-bold text-[#1A1816]">
              پیکربندی پوشه اصلی Google Drive و شیت گزارش Google Sheets
            </h3>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleProvisionWorkspaceFoldersAndSheet()}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[#1E3A5F]/30 bg-[#F3F6FA] px-3.5 py-2 text-xs font-semibold text-[#1E3A5F] hover:bg-[#E7EEF7]"
          >
            <Table2 className="h-3.5 w-3.5" />
            ساخت خودکار پوشه درایو و شیت گزارش
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="owner-drive-root-name"
              className="mb-1 block text-xs font-semibold text-[#3E3934]"
            >
              نام پوشه اصلی Google Drive
            </label>
            <input
              id="owner-drive-root-name"
              type="text"
              value={settings.driveRootFolderName}
              onChange={(e) =>
                setSettings({ ...settings, driveRootFolderName: e.target.value })
              }
              className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
            />
          </div>
          <div>
            <label
              htmlFor="owner-drive-root-id"
              className="mb-1 block text-xs font-semibold text-[#3E3934]"
            >
              شناسه پوشه اصلی Google Drive (Folder ID)
            </label>
            <input
              id="owner-drive-root-id"
              type="text"
              value={settings.driveRootFolderId || ''}
              onChange={(e) =>
                setSettings({ ...settings, driveRootFolderId: e.target.value || null })
              }
              placeholder="به‌صورت خودکار یا دستی وارد شود"
              dir="ltr"
              className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
            />
          </div>
          <div>
            <label
              htmlFor="owner-sheets-id"
              className="mb-1 block text-xs font-semibold text-[#3E3934]"
            >
              شناسه Google Sheets گزارش مشارکت‌ها (Spreadsheet ID)
            </label>
            <input
              id="owner-sheets-id"
              type="text"
              value={settings.sheetsSpreadsheetId || ''}
              onChange={(e) =>
                setSettings({ ...settings, sheetsSpreadsheetId: e.target.value || null })
              }
              placeholder="به‌صورت خودکار یا دستی وارد شود"
              dir="ltr"
              className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
            />
          </div>
          <div>
            <label
              htmlFor="owner-sheets-tab"
              className="mb-1 block text-xs font-semibold text-[#3E3934]"
            >
              نام برگه (Tab Name) در Google Sheets
            </label>
            <input
              id="owner-sheets-tab"
              type="text"
              value={settings.sheetsTabName}
              onChange={(e) =>
                setSettings({ ...settings, sheetsTabName: e.target.value })
              }
              className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#162C49] disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          ذخیره تنظیمات مالک
        </button>
      </div>
    </form>
  );
};
