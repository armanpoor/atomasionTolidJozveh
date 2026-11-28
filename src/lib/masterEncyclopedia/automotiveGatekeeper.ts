import crypto from 'node:crypto';

export type AutomotiveGatekeeperDecision = 'approved' | 'ambiguous' | 'rejected';

export type ExtendedAutomotiveFileFormat =
  | 'md'
  | 'txt'
  | 'html'
  | 'csv'
  | 'json'
  | 'docx'
  | 'pdf'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'webp'
  | 'mp3'
  | 'wav'
  | 'm4a'
  | 'ogg'
  | 'webm'
  | 'aac'
  | 'flac'
  | 'bin'
  | 'ols'
  | 'a2l'
  | 'kp'
  | 'xdf'
  | 'dam'
  | 'damos'
  | 'ori'
  | 'mod'
  | 'hex'
  | 'mpc'
  | 'fls'
  | 'epr';

export const FORMAT_MAX_BYTES: Record<ExtendedAutomotiveFileFormat, number> = {
  md: 15 * 1024 * 1024,
  txt: 15 * 1024 * 1024,
  html: 15 * 1024 * 1024,
  csv: 15 * 1024 * 1024,
  json: 15 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  png: 10 * 1024 * 1024,
  jpg: 10 * 1024 * 1024,
  jpeg: 10 * 1024 * 1024,
  webp: 10 * 1024 * 1024,
  mp3: 30 * 1024 * 1024,
  wav: 30 * 1024 * 1024,
  m4a: 30 * 1024 * 1024,
  ogg: 30 * 1024 * 1024,
  webm: 30 * 1024 * 1024,
  aac: 30 * 1024 * 1024,
  flac: 30 * 1024 * 1024,
  bin: 16 * 1024 * 1024,
  ori: 16 * 1024 * 1024,
  mod: 16 * 1024 * 1024,
  ols: 16 * 1024 * 1024,
  kp: 16 * 1024 * 1024,
  dam: 16 * 1024 * 1024,
  damos: 16 * 1024 * 1024,
  hex: 16 * 1024 * 1024,
  mpc: 16 * 1024 * 1024,
  fls: 16 * 1024 * 1024,
  epr: 4 * 1024 * 1024,
  a2l: 25 * 1024 * 1024,
  xdf: 15 * 1024 * 1024,
};

export const ECU_BINARY_AND_CALIBRATION_FORMATS = new Set<string>([
  'bin',
  'ori',
  'mod',
  'ols',
  'kp',
  'dam',
  'damos',
  'a2l',
  'xdf',
  'hex',
  'mpc',
  'fls',
  'epr',
]);

export const AUTOMOTIVE_REJECTION_MESSAGE_FA =
  'این پلتفرم به‌صورت تخصصی صرفاً برای اسناد، آموزش‌ها و فایل‌های فنی حوزه‌های خودرو (مکانیک، برق و الکترونیک، دیاگ و عیب‌یابی، گیربکس، خودروهای هیبریدی و برقی، امنیت ECU، داینو و ریمپ) طراحی شده است. لطفاً فایل مرتبط با حوزه خودرو بارگذاری فرمایید.';

export function computeSha256Hex(input: Uint8Array | Buffer | string): string {
  const hash = crypto.createHash('sha256');
  if (typeof input === 'string') {
    hash.update(input, 'utf8');
  } else {
    hash.update(input);
  }
  return hash.digest('hex');
}

export function extractFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0 || idx === fileName.length - 1) return '';
  return fileName.slice(idx + 1).trim().toLowerCase();
}

export function isSupportedAutomotiveExtension(ext: string): ext is ExtendedAutomotiveFileFormat {
  return Object.prototype.hasOwnProperty.call(FORMAT_MAX_BYTES, ext.toLowerCase());
}

/**
 * Layer 0 deterministic magic-byte verification.
 * Detects spoofed executables (Windows PE, ELF, Mach-O) and validates format signatures.
 */
export function verifyFileMagicBytes(
  fileName: string,
  bytes: Uint8Array
): { ok: boolean; reasonFa?: string; detectedFormat?: ExtendedAutomotiveFileFormat } {
  const ext = extractFileExtension(fileName);
  if (!isSupportedAutomotiveExtension(ext)) {
    return {
      ok: false,
      reasonFa: `پسوند فایل (.${ext || 'نامشخص'}) در فهرست فرمت‌های مجاز پلتفرم خودرو نیست.`,
    };
  }

  if (bytes.length === 0) {
    return { ok: false, reasonFa: 'فایل انتخاب‌شده خالی است.' };
  }

  const maxAllowed = FORMAT_MAX_BYTES[ext];
  if (bytes.length > maxAllowed) {
    const mb = Math.round(maxAllowed / (1024 * 1024));
    return {
      ok: false,
      reasonFa: `حجم فایل از سقف مجاز برای فرمت .${ext} (${mb} مگابایت) بیشتر است.`,
    };
  }

  // Always block executable binaries disguised under non-ECU extensions
  const isPeExe = bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a; // MZ
  const isElf =
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46;
  const isMachO =
    bytes.length >= 4 &&
    ((bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && (bytes[3] === 0xce || bytes[3] === 0xcf)) ||
      (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe));

  if (!ECU_BINARY_AND_CALIBRATION_FORMATS.has(ext) && (isPeExe || isElf || isMachO)) {
    return {
      ok: false,
      reasonFa: 'فایل اجرایی غیرمجاز شناسایی شد و به دلایل امنیتی رد گردید.',
    };
  }

  switch (ext) {
    case 'docx': {
      // ZIP signature PK\x03\x04
      const ok = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
      return ok
        ? { ok: true, detectedFormat: 'docx' }
        : { ok: false, reasonFa: 'امضای باینری فایل Word (.docx) معتبر نیست.' };
    }
    case 'pdf': {
      const ok = bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      return ok
        ? { ok: true, detectedFormat: 'pdf' }
        : { ok: false, reasonFa: 'امضای باینری فایل PDF معتبر نیست.' };
    }
    case 'png': {
      const ok =
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a;
      return ok
        ? { ok: true, detectedFormat: 'png' }
        : { ok: false, reasonFa: 'امضای تصویر PNG معتبر نیست.' };
    }
    case 'jpg':
    case 'jpeg': {
      const ok = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      return ok
        ? { ok: true, detectedFormat: ext }
        : { ok: false, reasonFa: 'امضای تصویر JPEG معتبر نیست.' };
    }
    case 'webp': {
      const ok =
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50;
      return ok
        ? { ok: true, detectedFormat: 'webp' }
        : { ok: false, reasonFa: 'امضای تصویر WebP معتبر نیست.' };
    }
    case 'wav': {
      const ok =
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x41 &&
        bytes[10] === 0x56 &&
        bytes[11] === 0x45;
      return ok
        ? { ok: true, detectedFormat: 'wav' }
        : { ok: false, reasonFa: 'امضای فایل صوتی WAV معتبر نیست.' };
    }
    case 'mp3': {
      const isId3 = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
      const isSync = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
      return isId3 || isSync
        ? { ok: true, detectedFormat: 'mp3' }
        : { ok: false, reasonFa: 'امضای فایل صوتی MP3 معتبر نیست.' };
    }
    case 'ogg': {
      const ok = bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
      return ok
        ? { ok: true, detectedFormat: 'ogg' }
        : { ok: false, reasonFa: 'امضای فایل صوتی OGG معتبر نیست.' };
    }
    case 'm4a': {
      const ok = bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
      return ok
        ? { ok: true, detectedFormat: 'm4a' }
        : { ok: false, reasonFa: 'امضای فایل صوتی M4A معتبر نیست.' };
    }
    case 'webm': {
      const ok = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
      return ok
        ? { ok: true, detectedFormat: 'webm' }
        : { ok: false, reasonFa: 'امضای فایل صوتی/رسانه‌ای WebM معتبر نیست.' };
    }
    case 'aac': {
      const isAdts = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
      const isAdif = bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x44 && bytes[2] === 0x49 && bytes[3] === 0x46;
      const isId3 = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
      return isAdts || isAdif || isId3
        ? { ok: true, detectedFormat: 'aac' }
        : { ok: false, reasonFa: 'امضای فایل صوتی AAC معتبر نیست.' };
    }
    case 'flac': {
      const ok = bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43;
      return ok
        ? { ok: true, detectedFormat: 'flac' }
        : { ok: false, reasonFa: 'امضای فایل صوتی FLAC معتبر نیست.' };
    }
    case 'md':
    case 'txt':
    case 'html':
    case 'csv':
    case 'json':
    case 'a2l':
    case 'xdf':
    case 'hex': {
      // Ensure text formats (including Intel HEX) are not binary blobs with excessive NUL bytes
      const sampleLen = Math.min(bytes.length, 512);
      let nulCount = 0;
      for (let i = 0; i < sampleLen; i++) {
        if (bytes[i] === 0x00) nulCount += 1;
      }
      if (nulCount > (ext === 'hex' ? 0 : Math.max(2, Math.floor(sampleLen * 0.05)))) {
        return {
          ok: false,
          reasonFa: `فایل متنی .${ext} حاوی بایت‌های باینری نامعتبر است.`,
        };
      }
      return { ok: true, detectedFormat: ext };
    }
    case 'bin':
    case 'ori':
    case 'mod':
    case 'ols':
    case 'kp':
    case 'dam':
    case 'damos':
    case 'mpc':
    case 'fls':
    case 'epr': {
      return { ok: true, detectedFormat: ext };
    }
  }
}

// ============================================================================
// GUEST RATE LIMITING & SHA-256 DEDUPLICATION
// ============================================================================

const guestUploadWindowMap = new Map<string, number[]>();

export function checkGuestUploadRateLimit(
  sessionKey: string,
  maxRequests = 15,
  windowMs = 10 * 60 * 1000,
  nowMs = Date.now()
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const existing = guestUploadWindowMap.get(sessionKey) ?? [];
  const valid = existing.filter((ts) => nowMs - ts < windowMs);
  if (valid.length >= maxRequests) {
    const oldest = valid[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (nowMs - oldest)) / 1000));
    guestUploadWindowMap.set(sessionKey, valid);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  valid.push(nowMs);
  guestUploadWindowMap.set(sessionKey, valid);
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - valid.length),
    retryAfterSeconds: 0,
  };
}

export function resetGuestUploadRateLimit(sessionKey?: string): void {
  if (sessionKey) {
    guestUploadWindowMap.delete(sessionKey);
  } else {
    guestUploadWindowMap.clear();
  }
}

export class UploadHashDedupCache {
  private readonly seen = new Map<string, { firstSeenAt: number; fileName: string }>();

  has(sha256: string): boolean {
    return this.seen.has(sha256);
  }

  record(sha256: string, fileName: string): { isDuplicate: boolean; firstSeenFileName?: string } {
    const prev = this.seen.get(sha256);
    if (prev) {
      return { isDuplicate: true, firstSeenFileName: prev.fileName };
    }
    this.seen.set(sha256, { firstSeenAt: Date.now(), fileName });
    return { isDuplicate: false };
  }

  clear(): void {
    this.seen.clear();
  }
}

// ============================================================================
// LAYER 0 DETERMINISTIC AUTOMOTIVE-ONLY GATEKEEPER + LAYER 1 HOOK
// ============================================================================

const STRONG_AUTOMOTIVE_TERMS: ReadonlyArray<{ pattern: RegExp; weight: number; domain: string }> = [
  // Remap / ECU / Tuning / Dyno
  { pattern: /\b(winols|damos|a2l|xdf|asap2|checksum|checksums|ecu|ecm|tcu|tcm|pcm|bcm|bsi|remapping|remap|chiptuning|stage\s*[123]|pops?\s*&?\s*bangs?|dpf|egr|adblue|scr|immo|immobilizer|kfzw|kfzwop|lamfa|ldrxn|kfmirl|kfmiop|me7\.4\.4|med17|edc17|sim2k|ms43|valeo\s*j34|sagem\s*s2000|marelli|continental|bosch\s*me|siemens\s*vdo)\b/i, weight: 4, domain: 'remap_tuning' },
  { pattern: /(ریمپ|وینولز|داموس|ایسیو|ای‌سی‌یو|تیونینگ|داینو|چک‌سام|کالیبراسیون|جدول\s+جرقه|جدول\s+سوخت|نقشه\s+جرقه|آوانس\s+جرقه|کات‌آف|لانچ\s+کنترل|ایموبلایزر|توربو\s*شارژ|بوست\s+فشار)/i, weight: 4, domain: 'remap_tuning' },

  // Diagnostics / OBD / UDS / DTC / TSB
  { pattern: /\b(obd-?ii|obd2|obdonuds|zevonuds|j1979-?2|uds|iso\s*14229|iso\s*15765|dtc|pid|pids|freeze\s*frame|mode\s*(?:0?[1-9]|10)|bidirectional|tsb|mil|check\s*engine|[pbcu][0-3][0-9a-f]{3}|p0[0-9a-f]{3}|u0[0-9a-f]{3})\b/i, weight: 4, domain: 'diagnostics_obd' },
  { pattern: /(دیاگ|عیب‌یابی|کد\s*خطا|چراغ\s*چک|داده‌های\s*زنده|فریز\s*فریم|تست\s*عملگر|بولتن\s*فنی|اسکنر\s*خودرو|سنسور\s*اکسیژن|میل‌سوپاپ|میل‌لنگ)/i, weight: 4, domain: 'diagnostics_obd' },

  // Electrical / Sensors / Multiplex Networks
  { pattern: /\b(can-?bus|can-?fd|lin-?bus|flexray|doip|automotive\s*ethernet|most\s*bus|pinout|wiring\s*diagram|oscilloscope|hall\s*effect|ckp|cmp|maf|map\s*sensor|tps|knock\s*sensor|o2\s*sensor|wideband|lambda|afr|dwell|alternator|starter\s*motor)\b/i, weight: 3, domain: 'electrical_networks' },
  { pattern: /(شبکه\s*مالتی‌پلکس|کن\s*باس|برق\s*خودرو|سیم‌کشی\s*خودرو|نقشه\s*سیم‌کشی|پیناوت|اسیلوسکوپ|سنسور\s*دور\s*موتور|سنسور\s*مپ|سنسور\s*ماف|دریچه\s*گاز\s*برقی|کویل\s*دوبل|انژکتور|دینام|استارت|باتری\s*خودرو|فیوز|رله\s*دوبل)/i, weight: 3, domain: 'electrical_networks' },

  // Cybersecurity & ECU Locks
  { pattern: /\b(sgw|security\s*gateway|sfd|sfd2|seed-?key|bench\s*mode|boot\s*mode|tricore|jtag|bdm|gpt|obd\s*lock)\b/i, weight: 4, domain: 'ecu_cybersecurity' },
  { pattern: /(قفل\s*ایسیو|بنچ\s*مود|بوت\s*مود|دروازه\s*امنیتی|امنیت\s*سایبری\s*خودرو|پروگرامر\s*ایسیو)/i, weight: 4, domain: 'ecu_cybersecurity' },

  // Engine Mechanics, PFI/GDI & Combustion
  { pattern: /\b(pfi|gdi|t-?gdi|mpi|crdi|common\s*rail|turbocharger|supercharger|intercooler|wastegate|camshaft|crankshaft|piston|cylinder\s*head|compression\s*ratio|valvetrain|vvt|vvt-?i|vanos|vtec|ignition\s*timing|stoichiometric|torque|horsepower|rpm|dyno|dynamometer)\b/i, weight: 3, domain: 'engine_mechanics' },
  { pattern: /(موتور\s*خودرو|مکانیک\s*خودرو|احتراق|پاشش\s*مستقیم|سوخت‌رسانی|سرسیلندر|میل‌لنگ|پیستون|شاتون|سوپاپ|تایمینگ|نسبت\s*تراکم|توربوشارژ|اینترکولر|فشار\s*ریل\s*سوخت|گشتاور|اسب\s*بخار|دور\s*موتور|ناک|کوبش\s*موتور|اکتان)/i, weight: 3, domain: 'engine_mechanics' },

  // Transmission / Drivetrain
  { pattern: /\b(automatic\s*transmission|manual\s*transmission|dct|dsg|cvt|torque\s*converter|valve\s*body|mechatronic|clutch|differential|awd|4wd|al4|at6|zf\s*8hp)\b/i, weight: 3, domain: 'transmission_drivetrain' },
  { pattern: /(گیربکس|جعبه‌دنده|تورک\s*کانورتر|ساعت\s*گیربکس|مکاترونیک|کلاچ|دیفرانسیل|پلوس|دوبل\s*کلاچ)/i, weight: 3, domain: 'transmission_drivetrain' },

  // Suspension, Steering, Brakes
  { pattern: /\b(abs|esp|esc|ebd|eps|brake\s*caliper|master\s*cylinder|macpherson|suspension|steering\s*rack|wheel\s*alignment|tpms)\b/i, weight: 3, domain: 'chassis_brakes' },
  { pattern: /(سیستم\s*تعلیق|جلوبندی|فرمان\s*برقی|ترمز|لنت\s*ترمز|پمپ\s*ترمز|کمک‌فنر|زاویه\s*کمبر|کاستر|تنظیم\s*فرمان)/i, weight: 3, domain: 'chassis_brakes' },

  // HVAC & Body
  { pattern: /\b(hvac|a\/c\s*compressor|refrigerant|r134a|r1234yf|airbag|srs|adas|radar\s*calibration|sunroof|central\s*locking)\b/i, weight: 3, domain: 'body_hvac' },
  { pattern: /(کولر\s*خودرو|کمپرسور\s*کولر|تهویه\s*مطبوع\s*خودرو|ایربگ|کیسه\s*هوا|بدنه\s*خودرو|قفل\s*مرکزی|شیشه‌بالابر)/i, weight: 3, domain: 'body_hvac' },

  // Hybrid & Electric Vehicles (EV)
  { pattern: /\b(hev|phev|bev|ev\s*battery|bms|high\s*voltage|inverter|dc-?dc\s*converter|regenerative\s*braking|traction\s*motor|obc|on-?board\s*charger|ccs2|chademo|soh|soc)\b/i, weight: 4, domain: 'hybrid_ev' },
  { pattern: /(خودرو(?:ی|های)?\s*برقی|خودرو(?:ی|های)?\s*هیبریدی|باتری\s*ولتاژ\s*بالا|اینورتر|سیستم\s*مدیریت\s*باتری|موتور\s*کششی|ترمز\s*احیاکننده|شارژر\s*خودرو)/i, weight: 4, domain: 'hybrid_ev' },

  // General Automotive Anchors
  { pattern: /\b(automotive|vehicle|automobile|car\s*engine|peugeot|renault|hyundai|kia|toyota|bmw|mercedes|volkswagen|audi|ford|chevrolet|ikco|saipa|tu5|ef7|xu7|m15|k4m)\b/i, weight: 2, domain: 'general_automotive' },
  { pattern: /(خودرو|اتومبیل|ماشین|پژو\s*۲۰۶|پژو\s*۴۰۵|پارس|سمند|دنا|تارا|شاهین|پراید|تیبا|کوییک|ساینا|ال۹۰|تندر\s*۹۰|هیوندای|کیا|تویوتا|بی‌ام‌و|بنز)/i, weight: 2, domain: 'general_automotive' },
];

const NON_AUTOMOTIVE_SIGNALS: ReadonlyArray<RegExp> = [
  /(دستور\s*پخت|مواد\s*لازم|قورمه‌سبزی|پیاز\s*داغ|فر\s*را\s*روی\s*دمای|طرز\s*تهیه\s*کیک|آشپزی|شیرینی‌پزی)/i,
  /(غزل|قصیده|مثنوی|دیوان\s*حافظ|شعر\s*عاشقانه|رمان\s*عاشقانه|داستان\s*کوتاه)/i,
  /(مالیات\s*بر\s*درآمد|ترازنامه\s*حسابداری|سود\s*و\s*زیان\s*شرکت|بورس\s*اوراق\s*بهادار|ارز\s*دیجیتال|بیت‌کوین)/i,
  /(قرارداد\s*اجاره‌نامه\s*مسکونی|ملک\s*مسکونی|پزشکی\s*داخلی|نسخه\s*پزشک|داروخانه|آنتی‌بیوتیک)/i,
  /\b(recipe|tablespoons?|preheat\s+oven|ingredients\s*:|stock\s+market|cryptocurrency|bitcoin|real\s+estate\s+lease|medical\s+prescription|poem|sonnet)\b/i,
];

const COMPILED_STRONG_AUTOMOTIVE_TERMS = STRONG_AUTOMOTIVE_TERMS.map((rule) => ({
  ...rule,
  globalRegex: new RegExp(rule.pattern.source, 'gi'),
}));

export interface AutomotiveGatekeeperResult {
  decision: AutomotiveGatekeeperDecision;
  layer: 'layer0_deterministic' | 'layer1_ai';
  score: number;
  matchedDomains: string[];
  matchedTerms: string[];
  reasonFa: string;
}

/**
 * Layer 0 deterministic Automotive-Only Gatekeeper (0 LLM tokens).
 * Approves ECU binaries immediately; scores Persian & English automotive domain taxonomy;
 * rejects clearly non-automotive documents politely; flags short/borderline inputs as 'ambiguous'.
 */
export function evaluateAutomotiveGatekeeperLayer0(input: {
  fileName: string;
  extractedText?: string;
  format?: string;
}): AutomotiveGatekeeperResult {
  const ext = (input.format || extractFileExtension(input.fileName)).toLowerCase();

  if (ECU_BINARY_AND_CALIBRATION_FORMATS.has(ext)) {
    return {
      decision: 'approved',
      layer: 'layer0_deterministic',
      score: 10,
      matchedDomains: ['remap_tuning'],
      matchedTerms: [`.${ext}`],
      reasonFa: 'فایل تخصصی کالیبراسیون یا باینری ECU شناسایی و تأیید شد.',
    };
  }

  const combined = `${input.fileName}\n${input.extractedText ?? ''}`;
  const matchedDomains = new Set<string>();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const rule of COMPILED_STRONG_AUTOMOTIVE_TERMS) {
    rule.globalRegex.lastIndex = 0;
    const matches = combined.match(rule.globalRegex);
    if (matches && matches.length > 0) {
      // Cap per-rule contribution so a single repeated word doesn't skew wildly
      const cappedCount = Math.min(matches.length, 3);
      score += rule.weight * cappedCount;
      matchedDomains.add(rule.domain);
      matchedTerms.push(matches[0]);
    }
  }

  let nonAutoHits = 0;
  for (const pat of NON_AUTOMOTIVE_SIGNALS) {
    if (pat.test(combined)) {
      nonAutoHits += 1;
    }
  }

  // Clear approval
  if (score >= 4 && (nonAutoHits === 0 || score >= nonAutoHits * 6)) {
    return {
      decision: 'approved',
      layer: 'layer0_deterministic',
      score,
      matchedDomains: Array.from(matchedDomains),
      matchedTerms: matchedTerms.slice(0, 12),
      reasonFa: 'محتوای تخصصی مرتبط با حوزه خودرو در لایه قطعی تأیید شد.',
    };
  }

  // Clear non-automotive rejection
  if (score === 0 && (nonAutoHits > 0 || (input.extractedText ?? '').trim().length >= 80)) {
    return {
      decision: 'rejected',
      layer: 'layer0_deterministic',
      score: 0,
      matchedDomains: [],
      matchedTerms: [],
      reasonFa: AUTOMOTIVE_REJECTION_MESSAGE_FA,
    };
  }

  // Borderline / short text -> needs Layer 1 fast AI disambiguation (or manual/default fallback)
  return {
    decision: 'ambiguous',
    layer: 'layer0_deterministic',
    score,
    matchedDomains: Array.from(matchedDomains),
    matchedTerms: matchedTerms.slice(0, 8),
    reasonFa: 'ارتباط محتوای فایل با حوزه خودرو در لایه اولیه مبهم است و نیازمند بررسی سریع لایه ۱ است.',
  };
}

export type Layer1AutomotiveClassifierFn = (sampleText: string, fileName: string) => Promise<{
  isAutomotive: boolean;
  domain?: string;
  reasonFa?: string;
}>;

/**
 * Full 2-Stage Automotive Gatekeeper:
 * Runs Layer 0 deterministic check first (0 LLM cost).
 * Invokes Layer 1 fast/economy AI ONLY when Layer 0 returns 'ambiguous'.
 */
export async function evaluateAutomotiveGatekeeper(
  input: { fileName: string; extractedText?: string; format?: string },
  layer1Classifier?: Layer1AutomotiveClassifierFn
): Promise<AutomotiveGatekeeperResult> {
  const layer0 = evaluateAutomotiveGatekeeperLayer0(input);
  if (layer0.decision !== 'ambiguous') {
    return layer0;
  }

  if (!layer1Classifier) {
    // Without Layer 1 AI available, approve only if at least some automotive signal was present
    if (layer0.score > 0) {
      return {
        ...layer0,
        decision: 'approved',
        reasonFa: 'نشانه‌های تخصصی خودرو در فایل شناسایی شد.',
      };
    }
    return {
      ...layer0,
      decision: 'rejected',
      reasonFa: AUTOMOTIVE_REJECTION_MESSAGE_FA,
    };
  }

  try {
    const sample = (input.extractedText ?? '').slice(0, 2000);
    const aiRes = await layer1Classifier(sample, input.fileName);
    if (aiRes.isAutomotive) {
      return {
        decision: 'approved',
        layer: 'layer1_ai',
        score: Math.max(layer0.score, 4),
        matchedDomains: aiRes.domain
          ? Array.from(new Set([...layer0.matchedDomains, aiRes.domain]))
          : layer0.matchedDomains.length > 0
          ? layer0.matchedDomains
          : ['general_automotive'],
        matchedTerms: layer0.matchedTerms,
        reasonFa: aiRes.reasonFa || 'ارتباط فایل با حوزه فنی خودرو توسط طبقه‌بند لایه ۱ تأیید شد.',
      };
    }
    return {
      decision: 'rejected',
      layer: 'layer1_ai',
      score: layer0.score,
      matchedDomains: [],
      matchedTerms: [],
      reasonFa: aiRes.reasonFa || AUTOMOTIVE_REJECTION_MESSAGE_FA,
    };
  } catch {
    // Graceful degradation on Layer 1 AI error
    if (layer0.score > 0) {
      return { ...layer0, decision: 'approved' };
    }
    return {
      ...layer0,
      decision: 'rejected',
      reasonFa: AUTOMOTIVE_REJECTION_MESSAGE_FA,
    };
  }
}
