import type { AutomotiveDomainId } from '../masterEncyclopedia/automotiveDomainEngine.ts';

export type AccessLevel = 'open_all' | 'email_only' | 'owner_only';

export type ContributionStatus = 'added' | 'partial_merge' | 'duplicate' | 'rejected';

export type UploaderType = 'email' | 'guest';

export type ContributionFileCategory =
  | 'text'
  | 'pdf'
  | 'word'
  | 'audio'
  | 'ols'
  | 'kp'
  | 'ecu_definition'
  | 'ecu_binary';

export interface VolumeGoogleDocLink {
  volumeId: string;
  googleDocId: string;
  googleDocUrl: string;
  lastSyncedAt: string;
  syncedByEmail: string;
}

export interface AiTokenUsageLedger {
  personalOutputTokens: number;
  zeroTokenBlockedPersonalCalls: number;
  audioTranscribeTokens: number;
  referenceRefineTokens: number;
  zeroTokenDuplicateSaves: number;
  zeroTokenGatekeeperRejects: number;
  totalAiCalls: number;
  lastUpdatedAt: string;
}

export interface PlatformSettingsRecord {
  id: string;
  enableUserPersonalOutput: boolean;
  accessLibrary: AccessLevel;
  accessDrive: AccessLevel;
  accessDocs: AccessLevel;
  accessSheets: AccessLevel;
  driveRootFolderId: string | null;
  driveRootFolderName: string;
  sheetsSpreadsheetId: string | null;
  sheetsSpreadsheetUrl: string | null;
  sheetsTabName: string;
  volumeDocs: Record<string, VolumeGoogleDocLink>;
  tokenLedger: AiTokenUsageLedger;
  updatedAt: string;
}

export interface TeamContributionRecord {
  id: string;
  ingestBatchId: string | null;
  sourceUploadHash: string;
  uploaderUid: string;
  uploaderEmail: string;
  uploaderDisplayName: string;
  uploaderType: UploaderType;
  fileName: string;
  fileExtension: string;
  fileCategory: ContributionFileCategory;
  vehicleModel: string | null;
  ecuModel: string | null;
  mapList: string | null;
  detectedVolumeId: string | null;
  detectedVolumeTitle: string;
  detectedDomain: string;
  newPercent: number;
  duplicatePercent: number;
  newUnitsCount: number;
  mergedUnitsCount: number;
  duplicateUnitsCount: number;
  status: ContributionStatus;
  statusLabelFa: string;
  reasonFa: string;
  score: number;
  scoreBreakdown: {
    baseNoveltyScore: number;
    winolsBonus: number;
    bountyBonus: number;
  };
  bountyId: string | null;
  driveFileId: string | null;
  driveWebViewLink: string | null;
  driveFolderPath: string | null;
  sheetSynced: boolean;
  tokensUsed: number;
  assetId: string | null;
  createdAt: string;
}

export interface KnowledgeWishlistItem {
  id: string;
  title: string;
  description: string;
  domainId: string;
  vehicleModel: string | null;
  ecuModel: string | null;
  wantedFormat: string; // 'ols' | 'kp' | 'pdf' | 'audio' | 'any'
  bonusScore: number;
  status: 'open' | 'fulfilled';
  fulfilledByEmail: string | null;
  fulfilledContributionId: string | null;
  createdByEmail: string;
  createdAt: string;
}

export interface ChapterCommentItem {
  id: string;
  volumeId: string;
  chapterId: string;
  authorUid: string;
  authorName: string;
  authorEmail: string;
  authorType: UploaderType;
  commentType: 'comment' | 'correction';
  body: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

export interface TeamUploadedAssetRecord {
  id: string;
  contributionId: string | null;
  fileName: string;
  fileExtension: string;
  fileCategory: ContributionFileCategory;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  vehicleModel: string | null;
  ecuModel: string | null;
  mapList: string | null;
  domainId: string;
  volumeId: string | null;
  uploaderEmail: string;
  uploaderDisplayName: string;
  driveFileId: string | null;
  driveWebViewLink: string | null;
  driveFolderPath: string | null;
  hasLocalPdfPreview: boolean;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  uploaderKey: string;
  displayName: string;
  email: string;
  uploaderType: UploaderType;
  totalScore: number;
  contributionsCount: number;
  acceptedCount: number;
  winolsCount: number;
  avgNewPercent: number;
  specialtyBadgeFa: string;
  topDomain: string;
}

export interface StarterReferenceVolumeSpec {
  id: string;
  volumeNumber: number;
  title: string;
  automotiveDomain: AutomotiveDomainId;
  mappedDomains: AutomotiveDomainId[];
  description: string;
  starterChapters: Array<{
    title: string;
    shortSummary: string;
    pedagogicalRank: number;
  }>;
}

/**
 * The 6 foundational automotive reference books created from scratch and grown incrementally
 * via Delta-Merge as team members contribute technical files.
 */
export const STARTER_REFERENCE_VOLUMES: StarterReferenceVolumeSpec[] = [
  {
    id: 'vol-ref-01-engine-mechanics',
    volumeNumber: 1,
    title: 'جلد ۱: مکانیک، ساختار موتور و تنظیم موتور',
    automotiveDomain: 'engine_mechanics',
    mappedDomains: ['engine_mechanics'],
    description:
      'ساختار مکانیکی موتورهای احتراق داخلی، تایمینگ، کمپرس، سیستم سوخت‌رسانی، جرقه، سیستم خنک‌کاری و اصول تنظیم موتور.',
    starterChapters: [
      {
        title: 'اصول مکانیک موتور، تایمینگ و تنظیم موتور پایه',
        shortSummary: 'ساختار سیلندر و سرسیلندر، کمپرس، فیلرگیری، تایمینگ سوپاپ و تنظیم دور آرام.',
        pedagogicalRank: 1,
      },
      {
        title: 'سیستم سوخت‌رسانی، پاشش انژکتور و کنترل احتراق',
        shortSummary: 'فشار ریل سوخت، انژکتورها، نسبت هوا به سوخت (AFR/Lambda) و کاتالیزور.',
        pedagogicalRank: 2,
      },
    ],
  },
  {
    id: 'vol-ref-02-electrical-multiplex',
    volumeNumber: 2,
    title: 'جلد ۲: برق، سنسورها و شبکه‌های مالتی‌پلکس خودرو',
    automotiveDomain: 'electrical_networks',
    mappedDomains: ['electrical_networks', 'body_hvac'],
    description:
      'مدارات برق خودرو، سنسورها و عملگرها، شبکه‌های ارتباطی CAN / LIN / FlexRay، نودهای مالتی‌پلکس (BSI، BCM، CBM) و سیستم‌های بدنه.',
    starterChapters: [
      {
        title: 'سنسورها، عملگرها و روش تست با مولتی‌متر و اسیلوسکوپ',
        shortSummary: 'سنسور اکسیژن، مپ، ناک، دریچه گاز برقی، سنسور دور موتور و شکل‌موج استاندارد.',
        pedagogicalRank: 1,
      },
      {
        title: 'معماری شبکه‌های مالتی‌پلکس (CAN / LIN) و نودهای BSI/BCM',
        shortSummary: 'مقاومت انتهایی ۶۰/۱۲۰ اهم، تحلیل ولتاژ CAN-H/CAN-L، نودهای مالتی‌پلکس و سیم‌کشی.',
        pedagogicalRank: 2,
      },
    ],
  },
  {
    id: 'vol-ref-03-diagnostics-dtc',
    volumeNumber: 3,
    title: 'جلد ۳: دیاگ، عیب‌یابی تخصصی، کدهای خطا (DTC) و داده‌های زنده',
    automotiveDomain: 'diagnostics_obd',
    mappedDomains: ['diagnostics_obd'],
    description:
      'تفسیر تخصصی کدهای خطا (DTC)، تحلیل پارامترهای زنده (Live Data)، فریز فریم (Freeze Frame)، Fuel Trim و الگوریتم عیب‌یابی سیستماتیک.',
    starterChapters: [
      {
        title: 'تحلیل پارامترهای زنده (Live Data) و اصلاح سوخت (STFT / LTFT)',
        shortSummary: 'پارامترهای مرجع در دور آرام و بار کامل، بررسی فشار مانیفولد و زمان پاشش.',
        pedagogicalRank: 1,
      },
      {
        title: 'مرجع کدهای خطا (DTC) و درخت عیب‌یابی تخصصی',
        shortSummary: 'کدهای خطای سری P0/P1/U0، شرایط ثبت خطا و مراحل دقیق رفع عیب.',
        pedagogicalRank: 2,
      },
    ],
  },
  {
    id: 'vol-ref-04-ecu-fundamentals',
    volumeNumber: 4,
    title: 'جلد ۴: مفاهیم پایه ریمپ و ساختار سخت‌افزاری/نرم‌افزاری ECU',
    automotiveDomain: 'ecu_cybersecurity',
    mappedDomains: ['ecu_cybersecurity'],
    description:
      'معماری پردازنده‌های TriCore / ST10 / MPC، حافظه‌های Flash و EEPROM، پین‌اوت و مدهای Boot / Bench / OBD، ایموبلایزر، چک‌سام و مبانی کالیبراسیون ECU.',
    starterChapters: [
      {
        title: 'معماری سخت‌افزاری ECU، حافظه‌های Flash/EEPROM و پین‌اوت',
        shortSummary: 'ساختار برد ECUهای Bosch، Siemens/Continental، Magneti Marelli، Sagem و Valeo.',
        pedagogicalRank: 1,
      },
      {
        title: 'مفاهیم پایه ریمپ، چک‌سام، ایموبلایزر و اصول ایمن خواندن/نوشتن دامپ',
        shortSummary: 'بکاپ کامل Bench/Boot، بررسی HW/SW، چک‌سام و مبانی جداول جرقه و سوخت.',
        pedagogicalRank: 2,
      },
    ],
  },
  {
    id: 'vol-ref-05-advanced-remap-winols',
    volumeNumber: 5,
    title: 'جلد ۵: مفاهیم پیشرفته ریمپ، نقشه‌خوانی WinOLS، داموس و داینو',
    automotiveDomain: 'remap_tuning',
    mappedDomains: ['remap_tuning', 'test_tools_dyno'],
    description:
      'نقشه‌خوانی پیشرفته در WinOLS 2.24، کار با فایل‌های .ols / .kp / Damos / A2L، مدیریت گشتاور، کنترل بوست توربو، کاتاف، پاپ‌اندبنگ و تحلیل نمودار داینو.',
    starterChapters: [
      {
        title: 'نقشه‌خوانی حرفه‌ای در WinOLS 2.24 و ساختار Damos / KP / OLS',
        shortSummary: 'تشخیص جداول 2D/3D، محورهای RPM/Load، ضرایب تبدیل (Factor/Offset) و مپ‌پک‌ها.',
        pedagogicalRank: 3,
      },
      {
        title: 'کالیبراسیون پیشرفته گشتاور، جرقه، بوست، محدودکننده‌ها و تست داینو',
        shortSummary: 'جداول Torque Request، KFZW، LAMFA، کنترل ناک، کاتاف و تطبیق نتایج روی داینو.',
        pedagogicalRank: 4,
      },
    ],
  },
  {
    id: 'vol-ref-06-transmission-chassis-ev',
    volumeNumber: 6,
    title: 'جلد ۶: گیربکس، تعلیق/ترمز، سیستم‌های ایمنی و خودروهای هیبریدی/برقی',
    automotiveDomain: 'hybrid_ev',
    mappedDomains: ['transmission_drivetrain', 'chassis_brakes', 'hybrid_ev'],
    description:
      'گیربکس‌های اتوماتیک AT/CVT/DCT و TCU، سیستم‌های ABS/ESP/Airbag، فرمان برقی EPS و معماری باتری ولتاژ بالا، BMS و اینورتر در خودروهای هیبریدی و برقی.',
    starterChapters: [
      {
        title: 'گیربکس‌های اتوماتیک، TCU، تعلیق، ABS/ESP و سیستم‌های ایمنی',
        shortSummary: 'ساعت گیربکس، شیربرقی‌ها، کالیبراسیون سنسور زاویه فرمان، ABS/ESP و ایربگ.',
        pedagogicalRank: 2,
      },
      {
        title: 'معماری خودروهای هیبریدی و برقی (EV / BMS / Inverter)',
        shortSummary: 'پک باتری ولتاژ بالا، ایمنی سرویس HV، سیستم مدیریت باتری BMS و اینورتر.',
        pedagogicalRank: 3,
      },
    ],
  },
];

/**
 * Exact 13 Persian columns for automatic Google Sheets contribution logging.
 */
export const CONTRIBUTION_SHEET_HEADERS = [
  'تاریخ و ساعت',
  'ایمیل / شناسه کاربر',
  'نوع کاربر',
  'نام و نوع فایل',
  'نوع خودرو',
  'نوع ECU',
  'جداول ذکرشده',
  'جلد / حوزه مرجع تشخیص‌داده‌شده',
  'درصد محتوای جدید (% New)',
  'درصد محتوای تکراری (% Duplicate)',
  'وضعیت پردازش',
  'امتیاز مشارکت (Score)',
  'لینک فایل در Google Drive',
] as const;
