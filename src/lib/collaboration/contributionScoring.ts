import type { AutomotiveDomainId } from '../masterEncyclopedia/automotiveDomainEngine.ts';
import {
  CONTRIBUTION_SHEET_HEADERS,
  STARTER_REFERENCE_VOLUMES,
  type AccessLevel,
  type ContributionFileCategory,
  type ContributionStatus,
  type LeaderboardEntry,
  type StarterReferenceVolumeSpec,
  type TeamContributionRecord,
} from './platformTypes.ts';

export const WINOLS_PACKAGE_EXTENSIONS = new Set(['ols', 'kp']);

export function isWinolsPackageExtension(ext: string): boolean {
  const clean = (ext || '').trim().toLowerCase().replace(/^\./, '');
  return WINOLS_PACKAGE_EXTENSIONS.has(clean);
}

export function classifyContributionFileCategory(
  fileName: string,
  explicitExt?: string
): { extension: string; category: ContributionFileCategory; labelFa: string } {
  const rawExt =
    explicitExt ||
    (fileName.includes('.') ? fileName.split('.').pop() || 'txt' : 'txt');
  const extension = rawExt.trim().toLowerCase().replace(/^\./, '');

  if (extension === 'ols') {
    return { extension, category: 'ols', labelFa: 'فایل WinOLS (.ols)' };
  }
  if (extension === 'kp') {
    return { extension, category: 'kp', labelFa: 'مپ‌پک WinOLS (.kp)' };
  }
  if (extension === 'pdf') {
    return { extension, category: 'pdf', labelFa: 'فایل PDF' };
  }
  if (extension === 'docx' || extension === 'doc') {
    return { extension, category: 'word', labelFa: 'فایل Word' };
  }
  if (['mp3', 'wav', 'm4a', 'ogg', 'webm', 'aac', 'flac'].includes(extension)) {
    return { extension, category: 'audio', labelFa: 'فایل صوتی' };
  }
  if (['a2l', 'xdf', 'dam', 'damos', 'csv'].includes(extension)) {
    return { extension, category: 'ecu_definition', labelFa: `فایل تعریف نقشه (.${extension})` };
  }
  if (['bin', 'ori', 'mod', 'hex', 'mpc', 'fls', 'epr'].includes(extension)) {
    return { extension, category: 'ecu_binary', labelFa: `دامپ ECU (.${extension})` };
  }
  return { extension: extension || 'txt', category: 'text', labelFa: 'فایل متنی' };
}

export interface WinolsValidationResult {
  valid: boolean;
  errorFa?: string;
  normalizedVehicleModel: string | null;
  normalizedEcuModel: string | null;
  normalizedMapList: string | null;
}

/**
 * Validates mandatory WinOLS 2.24 (.ols / .kp) metadata.
 * At least ONE of "نوع/مدل خودرو" (vehicleModel) OR "نوع/مدل ECU" (ecuModel) is strictly required.
 * "جداول / نقشه‌های موجود در داموس" (mapList) is optional.
 */
export function validateWinolsMetadata(input: {
  extension: string;
  vehicleModel?: string | null;
  ecuModel?: string | null;
  mapList?: string | null;
}): WinolsValidationResult {
  const normalizedVehicleModel = (input.vehicleModel || '').trim() || null;
  const normalizedEcuModel = (input.ecuModel || '').trim() || null;
  const normalizedMapList = (input.mapList || '').trim() || null;

  if (isWinolsPackageExtension(input.extension)) {
    if (!normalizedVehicleModel && !normalizedEcuModel) {
      return {
        valid: false,
        errorFa:
          'برای آپلود فایل‌های WinOLS 2.24 (با پسوند .ols یا .kp)، تکمیل حداقل یکی از فیلدهای «نوع/مدل خودرو» یا «نوع/مدل ECU» الزامی است.',
        normalizedVehicleModel,
        normalizedEcuModel,
        normalizedMapList,
      };
    }
  }

  return {
    valid: true,
    normalizedVehicleModel,
    normalizedEcuModel,
    normalizedMapList,
  };
}

export function resolveStarterVolumeForDomain(
  domainId: AutomotiveDomainId | string
): StarterReferenceVolumeSpec {
  const normalized = (domainId || '').trim().toLowerCase() as AutomotiveDomainId;
  for (const spec of STARTER_REFERENCE_VOLUMES) {
    if (spec.automotiveDomain === normalized || spec.mappedDomains.includes(normalized)) {
      return spec;
    }
  }
  return STARTER_REFERENCE_VOLUMES[0];
}

export interface NoveltyStatusResult {
  newPercent: number;
  duplicatePercent: number;
  status: ContributionStatus;
  statusLabelFa: string;
}

export function computeContributionNovelty(params: {
  isRejected?: boolean;
  isExactFileDuplicate?: boolean;
  newUnitsCount: number;
  mergedUnitsCount: number;
  duplicateUnitsCount: number;
}): NoveltyStatusResult {
  if (params.isRejected) {
    return {
      newPercent: 0,
      duplicatePercent: 0,
      status: 'rejected',
      statusLabelFa: 'ردشده (غیرمرتبط با حوزه خودرو)',
    };
  }

  if (params.isExactFileDuplicate) {
    return {
      newPercent: 0,
      duplicatePercent: 100,
      status: 'duplicate',
      statusLabelFa: 'کاملاً تکراری (بدون تغییر در مرجع)',
    };
  }

  const totalUnits =
    Math.max(0, params.newUnitsCount) +
    Math.max(0, params.mergedUnitsCount) +
    Math.max(0, params.duplicateUnitsCount);

  if (totalUnits === 0) {
    return {
      newPercent: 0,
      duplicatePercent: 100,
      status: 'duplicate',
      statusLabelFa: 'کاملاً تکراری (بدون تغییر در مرجع)',
    };
  }

  // Merged units carry partial new technical details (~50% novelty weight)
  const novelWeight = Math.max(0, params.newUnitsCount) + Math.max(0, params.mergedUnitsCount) * 0.5;
  const rawNewPercent = Math.round((novelWeight / totalUnits) * 100);
  const newPercent = Math.max(0, Math.min(100, rawNewPercent));
  const duplicatePercent = 100 - newPercent;

  if (newPercent === 0) {
    return {
      newPercent: 0,
      duplicatePercent: 100,
      status: 'duplicate',
      statusLabelFa: 'کاملاً تکراری (بدون تغییر در مرجع)',
    };
  }

  if (duplicatePercent === 0 && params.mergedUnitsCount === 0) {
    return {
      newPercent: 100,
      duplicatePercent: 0,
      status: 'added',
      statusLabelFa: 'اضافه‌شده به مرجع',
    };
  }

  if (newPercent >= 80) {
    return {
      newPercent,
      duplicatePercent,
      status: 'added',
      statusLabelFa: 'اضافه‌شده به مرجع',
    };
  }

  return {
    newPercent,
    duplicatePercent,
    status: 'partial_merge',
    statusLabelFa: 'ادغام جزئی (افزودن اطلاعات جدید)',
  };
}

export interface ScoreCalculationInput {
  status: ContributionStatus;
  newPercent: number;
  newUnitsCount: number;
  mergedUnitsCount: number;
  fileCategory: ContributionFileCategory;
  vehicleModel: string | null;
  ecuModel: string | null;
  mapList: string | null;
  bountyBonusScore?: number;
}

export interface ScoreCalculationResult {
  score: number;
  baseNoveltyScore: number;
  winolsBonus: number;
  bountyBonus: number;
}

/**
 * Deterministic Contribution Score algorithm:
 * - Strictly 0 for duplicate or rejected uploads.
 * - Proportional to % New + number of novel technical units added.
 * - Special bonus for non-duplicate WinOLS 2.24 (.ols / .kp) files, scaled by metadata completeness.
 * - Full bounty bonus when fulfilling an open Knowledge Wishlist request.
 */
export function calculateContributionScore(
  input: ScoreCalculationInput
): ScoreCalculationResult {
  if (input.status === 'duplicate' || input.status === 'rejected' || input.newPercent <= 0) {
    return {
      score: 0,
      baseNoveltyScore: 0,
      winolsBonus: 0,
      bountyBonus: 0,
    };
  }

  const unitContribution = Math.min(60, input.newUnitsCount * 6 + input.mergedUnitsCount * 3);
  const noveltyFactor = Math.round(input.newPercent * 0.6); // up to 60
  const audioValueBonus = input.fileCategory === 'audio' ? 15 : 0;
  const baseNoveltyScore = Math.max(5, Math.min(120, noveltyFactor + unitContribution + audioValueBonus));

  let winolsBonus = 0;
  if (input.fileCategory === 'ols' || input.fileCategory === 'kp') {
    // Base WinOLS value bonus for non-duplicate .ols / .kp
    winolsBonus += 45;
    if (input.vehicleModel && input.ecuModel) {
      winolsBonus += 20; // Both vehicle & ECU documented
    } else if (input.vehicleModel || input.ecuModel) {
      winolsBonus += 10;
    }
    if (input.mapList && input.mapList.trim().length >= 3) {
      winolsBonus += 25; // Detailed map list / Damos inventory supplied
    }
  }

  const bountyBonus = Math.max(0, Math.round(input.bountyBonusScore || 0));
  return {
    score: baseNoveltyScore + winolsBonus + bountyBonus,
    baseNoveltyScore,
    winolsBonus,
    bountyBonus,
  };
}

export function buildCategorizedDriveFolderPath(params: {
  fileCategory: ContributionFileCategory;
  vehicleModel: string | null;
  ecuModel: string | null;
  detectedVolumeTitle: string;
}): { categoryFolder: string; subFolder: string; displayPath: string } {
  const sanitizeSeg = (val: string) =>
    val
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);

  if (params.fileCategory === 'ols' || params.fileCategory === 'kp') {
    const categoryFolder = params.fileCategory === 'ols' ? 'WinOLS-OLS' : 'WinOLS-KP';
    const subParts = [
      params.ecuModel ? sanitizeSeg(params.ecuModel) : '',
      params.vehicleModel ? sanitizeSeg(params.vehicleModel) : '',
    ].filter(Boolean);
    const subFolder = subParts.length > 0 ? subParts.join(' - ') : 'عمومی';
    return {
      categoryFolder,
      subFolder,
      displayPath: `${categoryFolder}/${subFolder}`,
    };
  }

  const categoryFolder =
    params.fileCategory === 'pdf'
      ? 'منابع-PDF'
      : params.fileCategory === 'audio'
        ? 'فایل‌های-صوتی'
        : params.fileCategory === 'word'
          ? 'اسناد-Word'
          : 'اسناد-مرجع';
  const subFolder = sanitizeSeg(params.detectedVolumeTitle) || 'مرجع-عمومی';
  return {
    categoryFolder,
    subFolder,
    displayPath: `${categoryFolder}/${subFolder}`,
  };
}

/**
 * Formats a TeamContributionRecord into the exact 13-column row for Google Sheets.
 */
export function buildContributionSheetRow(record: TeamContributionRecord): string[] {
  const formattedDate = formatIsoForSheet(record.createdAt);
  const uploaderIdentity =
    record.uploaderType === 'email'
      ? record.uploaderEmail
      : `${record.uploaderDisplayName || 'کاربر مهمان'} (${record.uploaderUid.slice(0, 12)})`;
  const uploaderTypeFa = record.uploaderType === 'email' ? 'ثبت‌شده با ایمیل' : 'مهمان';
  const fileLabel = `${record.fileName} (${record.fileCategory.toUpperCase()})`;

  const row = [
    formattedDate,
    uploaderIdentity,
    uploaderTypeFa,
    fileLabel,
    record.vehicleModel || '—',
    record.ecuModel || '—',
    record.mapList || '—',
    record.detectedVolumeTitle || record.detectedDomain || '—',
    `${record.newPercent}%`,
    `${record.duplicatePercent}%`,
    record.statusLabelFa,
    String(record.score),
    record.driveWebViewLink || 'ذخیره‌شده در سامانه (در انتظار اتصال درایو)',
  ];

  // Guarantee column parity with CONTRIBUTION_SHEET_HEADERS
  return row.slice(0, CONTRIBUTION_SHEET_HEADERS.length);
}

function formatIsoForSheet(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return iso;
  }
}

const DOMAIN_BADGE_MAP: Record<string, string> = {
  remap_tuning: 'مرجع ریمپ و WinOLS',
  test_tools_dyno: 'متخصص داینو و ابزار تست',
  ecu_cybersecurity: 'معمار سخت‌افزار و امنیت ECU',
  electrical_networks: 'متخصص برق و مالتی‌پلکس',
  body_hvac: 'متخصص سیستم‌های بدنه و تهویه',
  diagnostics_obd: 'استاد دیاگ و عیب‌یابی',
  engine_mechanics: 'مهندس موتور و تنظیم موتور',
  transmission_drivetrain: 'متخصص گیربکس و انتقال قدرت',
  chassis_brakes: 'متخصص سیستم‌های ایمنی و ترمز',
  hybrid_ev: 'پیشگام هیبرید و برقی',
};

export function computeTeamLeaderboard(
  contributions: TeamContributionRecord[]
): LeaderboardEntry[] {
  const buckets = new Map<
    string,
    {
      uploaderKey: string;
      displayName: string;
      email: string;
      uploaderType: 'email' | 'guest';
      totalScore: number;
      contributionsCount: number;
      acceptedCount: number;
      winolsCount: number;
      noveltySum: number;
      domainScores: Record<string, number>;
    }
  >();

  for (const c of contributions) {
    const key = c.uploaderType === 'email' ? c.uploaderEmail.toLowerCase() : c.uploaderUid;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        uploaderKey: key,
        displayName: c.uploaderDisplayName || c.uploaderEmail || 'کاربر تیم',
        email: c.uploaderEmail,
        uploaderType: c.uploaderType,
        totalScore: 0,
        contributionsCount: 0,
        acceptedCount: 0,
        winolsCount: 0,
        noveltySum: 0,
        domainScores: {},
      };
      buckets.set(key, bucket);
    }

    bucket.contributionsCount += 1;
    bucket.totalScore += c.score;
    bucket.noveltySum += c.newPercent;
    if (c.status === 'added' || c.status === 'partial_merge') {
      bucket.acceptedCount += 1;
      if (c.fileCategory === 'ols' || c.fileCategory === 'kp') {
        bucket.winolsCount += 1;
      }
      const dom = c.detectedDomain || 'engine_mechanics';
      bucket.domainScores[dom] = (bucket.domainScores[dom] || 0) + Math.max(1, c.score);
    }
  }

  const entries: LeaderboardEntry[] = Array.from(buckets.values())
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.acceptedCount !== a.acceptedCount) return b.acceptedCount - a.acceptedCount;
      const aAvg = a.contributionsCount > 0 ? a.noveltySum / a.contributionsCount : 0;
      const bAvg = b.contributionsCount > 0 ? b.noveltySum / b.contributionsCount : 0;
      return bAvg - aAvg;
    })
    .map((b, idx) => {
      const topDomain =
        Object.entries(b.domainScores).sort((x, y) => y[1] - x[1])[0]?.[0] ||
        'engine_mechanics';
      const specialtyBadgeFa =
        b.winolsCount >= 2
          ? 'پیشتاز WinOLS و داموس'
          : DOMAIN_BADGE_MAP[topDomain] || 'مشارکت‌کننده فعال دانش خودرو';
      return {
        rank: idx + 1,
        uploaderKey: b.uploaderKey,
        displayName: b.displayName,
        email: b.email,
        uploaderType: b.uploaderType,
        totalScore: b.totalScore,
        contributionsCount: b.contributionsCount,
        acceptedCount: b.acceptedCount,
        winolsCount: b.winolsCount,
        avgNewPercent:
          b.contributionsCount > 0 ? Math.round(b.noveltySum / b.contributionsCount) : 0,
        specialtyBadgeFa,
        topDomain,
      };
    });

  return entries;
}

export function canAccessResource(
  level: AccessLevel,
  user: { isGuest?: boolean; email?: string | null } | null | undefined,
  isOwner: boolean
): boolean {
  if (isOwner) return true;
  if (level === 'owner_only') return false;
  if (level === 'email_only') {
    return Boolean(user && !user.isGuest && user.email && user.email.includes('@'));
  }
  return Boolean(user); // open_all allows both email-authenticated and guest sessions
}

export function sanitizeExternalWorkspaceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const allowedHosts = [
      'drive.google.com',
      'docs.google.com',
      'sheets.google.com',
    ];
    if (!allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates Google Drive / Docs / Sheets resource identifiers against strict URL-safe charset
 * to prevent path traversal, query injection, or malformed URL interpolation.
 */
export function isValidGoogleResourceId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(trimmed);
}

/**
 * Masks contributor email addresses when returned to guest (unauthenticated) viewers
 * to prevent harvesting of team member personal emails.
 */
export function maskEmailForViewer(
  email: string | null | undefined,
  isGuestViewer: boolean
): string {
  const raw = (email || '').trim();
  if (!raw) return '';
  if (!isGuestViewer) return raw;
  const atIdx = raw.indexOf('@');
  if (atIdx <= 0) return 'کاربر مهمان';
  const local = raw.slice(0, atIdx);
  const domain = raw.slice(atIdx + 1);
  const maskedLocal =
    local.length <= 2 ? `${local[0] ?? '*'}***` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  const domainParts = domain.split('.');
  const tld = domainParts.length > 1 ? domainParts[domainParts.length - 1] : '';
  const domainHead = domainParts[0] || '';
  const maskedDomain = domainHead ? `${domainHead[0]}***${tld ? `.${tld}` : ''}` : '***';
  return `${maskedLocal}@${maskedDomain}`;
}

/**
 * Escapes a single CSV cell while neutralizing spreadsheet formula injection
 * (=, +, -, @, tab, CR) without corrupting legitimate negative/signed numeric values.
 */
export function escapeSafeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  const trimmedStart = str.replace(/^[\s\uFEFF]+/, '');
  const isPureSignedNumber = /^[+-]?\d+(?:\.\d+)?%?$/.test(trimmedStart);
  const neutralized =
    !isPureSignedNumber && /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/**
 * Generates an Excel/Google Sheets compatible UTF-8 BOM CSV of team contributions.
 */
export function buildContributionsCsv(records: TeamContributionRecord[]): string {
  const headerLine = CONTRIBUTION_SHEET_HEADERS.map((h) => escapeSafeCsvCell(h)).join(',');
  const dataLines = records.map((rec) =>
    buildContributionSheetRow(rec)
      .map((cell) => escapeSafeCsvCell(cell))
      .join(',')
  );
  return `\uFEFF${[headerLine, ...dataLines].join('\n')}\n`;
}

