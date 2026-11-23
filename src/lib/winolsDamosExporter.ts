import JSZip from 'jszip';
import { toAsciiDigits, toPersianDigits } from './formatParsers.ts';
import type { WinolsExtractionReport, WinolsMapActionEntry } from './winolsMapGuide.ts';

// ============================================================================
// WINOLS 2.24 COMPATIBLE DAMOS / ASAP2 (.A2L) + CSV MAP PACK + FCE6 CALCULATOR
// ============================================================================

export type WinolsDataOrg = '8bit' | '16bit';
export type WinolsByteOrder = 'LoHi' | 'HiLo';
export type WinolsCharacteristicType = 'MAP' | 'CURVE' | 'VALUE';

export interface WinolsDamosAxisConfig {
  label: string;
  addressHex: string; // e.g. '0x14FDA' or '' if virtual/fixed axis
  count: number;
  dataOrg: WinolsDataOrg;
  signed: boolean;
  factor: number;
  offset: number;
  unit: string;
  minValue: number;
  maxValue: number;
}

export interface WinolsDamosMapConfig {
  id: string;
  mapCode: string;
  nameFa: string;
  folder: string;
  description: string;
  startAddressHex: string; // e.g. '0x1A9EE' or '' if user hasn't entered hex yet
  baseAddressHex: string; // e.g. '0x18000', '0x14000', '0x68000', '0x8000'
  columns: number;
  rows: number;
  type: WinolsCharacteristicType;
  dataOrg: WinolsDataOrg;
  signed: boolean;
  byteOrder: WinolsByteOrder;
  factor: number;
  offset: number;
  precision: number;
  unit: string;
  axisX: WinolsDamosAxisConfig | null;
  axisY: WinolsDamosAxisConfig | null;
  ecuFamily: string;
  lineSwappingRequired: boolean;
  checksumExternal: boolean;
  addressVerified: boolean;
  safetyNote: string;
}

export interface SiemensBasePreset {
  id: string;
  baseHex: string;
  labelFa: string;
  ecuExamples: string;
  defaultByteOrder: WinolsByteOrder;
  lineSwapping: boolean;
}

export const SIEMENS_WORKING_AREA_PRESETS: SiemensBasePreset[] = [
  {
    id: 'base_18000',
    baseHex: '0x18000',
    labelFa: '0x18000 — زیمنس فلش‌دار (تیبا M15 / XU7 CGE-CGI)',
    ecuExamples: 'Tiba CR3/C3, XU7 CGE/CGI/PTP (AM29F400BB)',
    defaultByteOrder: 'HiLo',
    lineSwapping: true,
  },
  {
    id: 'base_14000',
    baseHex: '0x14000',
    labelFa: '0x14000 — شبکه EF7 CBAR / CBiR / CVR و پراید CA6',
    ecuExamples: 'EF7 CBAR/CBiR/CVR/CBR, Pride Bi-Fuel CA6',
    defaultByteOrder: 'HiLo',
    lineSwapping: true,
  },
  {
    id: 'base_68000',
    baseHex: '0x68000',
    labelFa: '0x68000 — زیمنس بدون فلش No-Flash (TU5 / XU7 Plus)',
    ecuExamples: 'TU5 CBM/CGX No-Flash, XU7 Plus ST10',
    defaultByteOrder: 'LoHi',
    lineSwapping: false,
  },
  {
    id: 'base_8000',
    baseHex: '0x8000',
    labelFa: '0x8000 — پراید یورو ۲ / رنو L90 (EMS3132)',
    ecuExamples: 'Pride Euro2 CI7/CGE, L90/Sandero EMS3132',
    defaultByteOrder: 'HiLo',
    lineSwapping: true,
  },
];

// ============================================================================
// HEX & SIEMENS FCE6 POINTER CALCULATOR
// ============================================================================

export function parseHexNumber(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
  }
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = toAsciiDigits(raw)
    .trim()
    .replace(/^0x/i, '')
    .replace(/h$/i, '')
    .replace(/[^0-9a-fA-F]/g, '');
  if (!cleaned || cleaned.length > 8) return null;
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeHexAddress(raw: string | null | undefined, minDigits = 4): string {
  const num = parseHexNumber(raw);
  if (num === null) return '';
  const hex = num.toString(16).toUpperCase().padStart(minDigits, '0');
  return `0x${hex}`;
}

export interface Fce6PointerResult {
  valid: boolean;
  baseHex: string;
  offsetHex: string;
  finalAddressHex: string;
  finalAddressDec: number;
  /** Four 16-bit Siemens pointer search patterns (0xxx, 1xxx, 2xxx, 3xxx) */
  searchPatterns: string[];
  winolsGotoTarget: string;
  formulaText: string;
}

/**
 * Exact Siemens WinOLS 2.24 FCE6 / FC66 Pointer Hex Calculator:
 * Given Working Area Base (e.g., 14000, 18000, 68000, 8000) and relative offset (e.g., FDA, 78, 9AB),
 * computes Final Hex Address = Base + Offset and generates the 4-prefix FCE6 pointer search patterns.
 */
export function computeFce6PointerAddress(
  baseInput: string,
  offsetInput: string
): Fce6PointerResult {
  const baseNum = parseHexNumber(baseInput);
  const offsetNum = parseHexNumber(offsetInput);

  if (baseNum === null || offsetNum === null) {
    return {
      valid: false,
      baseHex: normalizeHexAddress(baseInput) || '',
      offsetHex: normalizeHexAddress(offsetInput) || '',
      finalAddressHex: '',
      finalAddressDec: 0,
      searchPatterns: [],
      winolsGotoTarget: '',
      formulaText: 'لطفاً آدرس پایه (مثل 14000 یا 18000) و افست هگز (مثل FDA یا 78) را معتبر وارد کنید.',
    };
  }

  const finalNum = baseNum + offsetNum;
  const baseHex = normalizeHexAddress(baseNum.toString(16), 4);
  const offsetHex = offsetNum.toString(16).toUpperCase();
  const finalAddressHex = normalizeHexAddress(finalNum.toString(16), 5);
  const lower12 = (finalNum & 0xfff).toString(16).toUpperCase().padStart(3, '0');
  const searchPatterns = ['0', '1', '2', '3'].map((prefix) => `${prefix}${lower12}`);

  return {
    valid: true,
    baseHex,
    offsetHex: `0x${offsetHex}`,
    finalAddressHex,
    finalAddressDec: finalNum,
    searchPatterns,
    winolsGotoTarget: finalAddressHex.replace(/^0x/i, ''),
    formulaText: `${baseHex.replace(/^0x/, '')}h + ${offsetHex}h = ${finalAddressHex}`,
  };
}

/**
 * Given a map's absolute Hex address (e.g. 0x1A9EE), derives the 4-prefix FCE6 search patterns
 * (`09EE`, `19EE`, `29EE`, `39EE`) used to locate its axis pointers inside a Siemens dump.
 */
export function buildFce6SearchPatterns(mapAddressInput: string): {
  valid: boolean;
  normalizedHex: string;
  lower12Hex: string;
  patterns: string[];
} {
  const num = parseHexNumber(mapAddressInput);
  if (num === null) {
    return { valid: false, normalizedHex: '', lower12Hex: '', patterns: [] };
  }
  const lower12Hex = (num & 0xfff).toString(16).toUpperCase().padStart(3, '0');
  return {
    valid: true,
    normalizedHex: normalizeHexAddress(num.toString(16), 5),
    lower12Hex,
    patterns: ['0', '1', '2', '3'].map((p) => `${p}${lower12Hex}`),
  };
}

// ============================================================================
// DIMENSIONS & REPORT -> EDITABLE DAMOS CONFIG BUILDER
// ============================================================================

export function parseDimensionsString(
  dimStr: string,
  isScalar: boolean
): { columns: number; rows: number; type: WinolsCharacteristicType } {
  if (isScalar) {
    return { columns: 1, rows: 1, type: 'VALUE' };
  }
  const ascii = toAsciiDigits(dimStr || '');
  const m = ascii.match(/(\d{1,2})\s*[x×*]\s*(\d{1,2})/i);
  if (!m) {
    return { columns: 12, rows: 16, type: 'MAP' };
  }
  const a = Math.max(1, Math.min(64, Number(m[1])));
  const b = Math.max(1, Math.min(64, Number(m[2])));
  if (a === 1 && b === 1) return { columns: 1, rows: 1, type: 'VALUE' };
  if (a === 1 || b === 1) return { columns: Math.max(a, b), rows: 1, type: 'CURVE' };
  return { columns: a, rows: b, type: 'MAP' };
}

export function detectDefaultBaseAddressFromReport(report: WinolsExtractionReport): string {
  const allText = report.entries
    .flatMap((e) => [...e.ecuModels, ...e.hexAddresses, ...e.evidenceSnippets])
    .join(' ');
  const upper = allText.toUpperCase();
  if (/0X68000|\b68000\b|\b6A9EE\b|NO[-\s]?FLASH|CBM|CGX|XUP|XU7\s*PLUS/i.test(upper)) {
    return '0x68000';
  }
  if (/0X14000|\b14000\b|\b14FDA\b|\b14078\b|\bCBAR\b|\bCBIR\b|\bCVR\b|\bEF7\b|\bCA6\b/i.test(upper)) {
    return '0x14000';
  }
  if (/0X8000|\bEMS3132\b|\bSIRIUS\s*32\b|\bL90\b/i.test(upper)) {
    return '0x8000';
  }
  return '0x18000';
}

export function buildDefaultDamosConfigsFromReport(
  report: WinolsExtractionReport
): WinolsDamosMapConfig[] {
  const detectedBase = detectDefaultBaseAddressFromReport(report);
  const isNoFlash = detectedBase === '0x68000';

  return report.entries.map((entry: WinolsMapActionEntry) => {
    const meta = entry.damosMeta;
    const { columns, rows, type } = parseDimensionsString(entry.dimensions, entry.isScalar);
    const primaryHex = normalizeHexAddress(entry.hexAddresses[0] || '', 5);
    const effectiveBase = normalizeHexAddress(meta?.baseAddressHex || detectedBase, 4) || detectedBase;
    const factor = typeof meta?.factor === 'number' && Number.isFinite(meta.factor) && meta.factor !== 0
      ? meta.factor
      : 1;
    const offset = typeof meta?.offset === 'number' && Number.isFinite(meta.offset) ? meta.offset : 0;
    const dataOrg: WinolsDataOrg = meta?.dataOrg || (entry.isScalar ? '16bit' : '8bit');
    const signed = Boolean(meta?.signed);
    const byteOrder: WinolsByteOrder = meta?.byteOrder || (isNoFlash ? 'LoHi' : 'HiLo');
    const unit = meta?.unit || entry.zoneMatrix?.unit || '%';
    const precision = factor < 0.001 ? 5 : factor < 0.1 ? 3 : factor < 1 ? 2 : 1;

    const axisX: WinolsDamosAxisConfig | null =
      type === 'VALUE'
        ? null
        : {
            label: meta?.axisXLabel || 'RPM',
            addressHex: normalizeHexAddress(meta?.axisXHex || '', 5),
            count: columns,
            dataOrg: '16bit',
            signed: false,
            factor: 1,
            offset: 0,
            unit: meta?.axisXUnit || 'RPM',
            minValue: entry.targetRpmRange?.min ?? 600,
            maxValue: entry.targetRpmRange?.max ?? 6500,
          };

    const axisY: WinolsDamosAxisConfig | null =
      type !== 'MAP'
        ? null
        : {
            label: meta?.axisYLabel || 'Load / MAP',
            addressHex: normalizeHexAddress(meta?.axisYHex || '', 5),
            count: rows,
            dataOrg: '16bit',
            signed: false,
            factor: 1,
            offset: 0,
            unit: meta?.axisYUnit || '%',
            minValue: entry.targetLoadRange?.min ?? 10,
            maxValue: entry.targetLoadRange?.max ?? 100,
          };

    return {
      id: entry.id,
      mapCode: entry.mapCode,
      nameFa: entry.mapNameFa,
      folder: entry.categoryLabelFa || 'Calibration',
      description: `${entry.mapNameFa} | Target: ${entry.recommendedDeltaLabel}`,
      startAddressHex: primaryHex,
      baseAddressHex: effectiveBase,
      columns,
      rows,
      type,
      dataOrg,
      signed,
      byteOrder,
      factor,
      offset,
      precision,
      unit,
      axisX,
      axisY,
      ecuFamily: entry.ecuModels.join(', ') || 'Siemens / Bosch ECU',
      lineSwappingRequired: meta?.lineSwappingRequired ?? !isNoFlash,
      checksumExternal: !/EMS3132|L90|BOSCH|ME7|MED17/i.test(entry.ecuModels.join(' ')),
      addressVerified: Boolean(primaryHex),
      safetyNote: entry.safetyChecklistFa,
    };
  });
}

// ============================================================================
// ASAM ASAP2 v1.51 (.A2L) GENERATOR FOR WINOLS 2.24
// ============================================================================

/**
 * Sanitizes any identifier into strict ASAM ASAP2 ASCII token ([A-Za-z_][A-Za-z0-9_]*).
 * WinOLS 2.24's A2L parser rejects spaces, non-ASCII characters, and leading digits in identifiers.
 */
export function sanitizeAsap2Identifier(raw: string, fallback = 'MAP_ITEM'): string {
  const ascii = toAsciiDigits(raw || '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!ascii) return fallback;
  const prefixed = /^[0-9]/.test(ascii) ? `M_${ascii}` : ascii;
  return prefixed.slice(0, 64);
}

/**
 * Escapes quotes/newlines for ASAP2 quoted strings (ASCII-safe for WinOLS 2.24 legacy parser,
 * while keeping readable Latin technical descriptions).
 */
function sanitizeAsap2String(raw: string, maxLen = 180): string {
  const cleaned = (raw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLen);
}

/**
 * Computes exact ASAM ASAP2 `RAT_FUNC` COEFFS `a b c d e f` such that:
 *   INT = (a*PHYS^2 + b*PHYS + c) / (d*PHYS^2 + e*PHYS + f)
 * For linear ECU scaling `PHYS = RAW * Factor + Offset`:
 *   RAW = (1 / Factor) * PHYS + (-Offset / Factor)
 * Therefore: a=0, b=(1/Factor), c=(-Offset/Factor), d=0, e=0, f=1.
 */
export function computeAsap2RatFuncCoeffs(
  factor: number,
  offset: number
): [number, number, number, number, number, number] {
  const safeFactor = Number.isFinite(factor) && factor !== 0 ? factor : 1;
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const b = Number((1 / safeFactor).toPrecision(10));
  const c = safeOffset === 0 ? 0 : Number((-safeOffset / safeFactor).toPrecision(10));
  return [0, b, c, 0, 0, 1];
}

function getRecordLayoutName(dataOrg: WinolsDataOrg, signed: boolean): string {
  if (dataOrg === '8bit') return signed ? 'RL_SBYTE' : 'RL_UBYTE';
  return signed ? 'RL_SWORD' : 'RL_UWORD';
}

function getAxisRecordLayoutName(dataOrg: WinolsDataOrg, signed: boolean): string {
  if (dataOrg === '8bit') return signed ? 'RL_AXIS_SBYTE' : 'RL_AXIS_UBYTE';
  return signed ? 'RL_AXIS_SWORD' : 'RL_AXIS_UWORD';
}

function getRawBounds(dataOrg: WinolsDataOrg, signed: boolean): { min: number; max: number } {
  if (dataOrg === '8bit') {
    return signed ? { min: -128, max: 127 } : { min: 0, max: 255 };
  }
  return signed ? { min: -32768, max: 32767 } : { min: 0, max: 65535 };
}

export interface WinolsA2lValidationReport {
  totalMaps: number;
  readyWithAddressCount: number;
  placeholderAddressCount: number;
  axisPointsCount: number;
  detectedBaseHex: string;
  byteOrder: WinolsByteOrder;
  warningsFa: string[];
}

export interface WinolsA2lBuildOutput {
  a2lContent: string;
  fileName: string;
  validation: WinolsA2lValidationReport;
}

export function generateWinols224A2l(options: {
  projectName: string;
  ecuFamily?: string;
  byteOrder?: WinolsByteOrder;
  baseAddressHex?: string;
  maps: WinolsDamosMapConfig[];
}): WinolsA2lBuildOutput {
  const projectIdent = sanitizeAsap2Identifier(options.projectName || 'Remap_Project', 'Remap_Project');
  const ecuFamily = sanitizeAsap2String(options.ecuFamily || 'Siemens_Bosch_ECU', 80);
  const baseAddressHex = normalizeHexAddress(options.baseAddressHex || '0x18000', 4) || '0x18000';
  const byteOrder: WinolsByteOrder = options.byteOrder || 'HiLo';
  const asap2ByteOrder = byteOrder === 'LoHi' ? 'MSB_LAST' : 'MSB_FIRST';

  const compuMethods = new Map<
    string,
    {
      name: string;
      factor: number;
      offset: number;
      unit: string;
      precision: number;
      coeffs: [number, number, number, number, number, number];
    }
  >();

  const registerCompuMethod = (
    factor: number,
    offset: number,
    unit: string,
    precision: number
  ): string => {
    const safeFactor = Number.isFinite(factor) && factor !== 0 ? factor : 1;
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    const safeUnit = sanitizeAsap2String(unit || '-', 24) || '-';
    const key = `${safeFactor}|${safeOffset}|${safeUnit}|${precision}`;
    const existing = compuMethods.get(key);
    if (existing) return existing.name;
    const idx = compuMethods.size + 1;
    const name = `CM_${idx}_${sanitizeAsap2Identifier(safeUnit, 'RAW').slice(0, 14)}`;
    compuMethods.set(key, {
      name,
      factor: safeFactor,
      offset: safeOffset,
      unit: safeUnit,
      precision: Math.max(0, Math.min(6, Math.round(precision))),
      coeffs: computeAsap2RatFuncCoeffs(safeFactor, safeOffset),
    });
    return name;
  };

  const usedCharNames = new Set<string>();
  const uniqueCharName = (base: string): string => {
    const clean = sanitizeAsap2Identifier(base, 'MAP');
    if (!usedCharNames.has(clean)) {
      usedCharNames.add(clean);
      return clean;
    }
    let suffix = 2;
    while (usedCharNames.has(`${clean}_${suffix}`)) suffix += 1;
    const finalName = `${clean}_${suffix}`;
    usedCharNames.add(finalName);
    return finalName;
  };

  const characteristicBlocks: string[] = [];
  const axisPtsBlocks: string[] = [];
  const groupsMap = new Map<string, string[]>();
  const warningsFa: string[] = [];

  let readyWithAddressCount = 0;
  let placeholderAddressCount = 0;
  let fallbackAddrCursor = parseHexNumber(baseAddressHex) ?? 0x18000;

  for (const m of options.maps) {
    const charName = uniqueCharName(m.mapCode);
    const parsedAddr = parseHexNumber(m.startAddressHex);
    const hasExplicitAddr = parsedAddr !== null;
    if (hasExplicitAddr) {
      readyWithAddressCount += 1;
    } else {
      placeholderAddressCount += 1;
    }

    const effectiveAddrNum = hasExplicitAddr ? parsedAddr! : fallbackAddrCursor;
    if (!hasExplicitAddr) {
      const stride = Math.max(
        0x20,
        m.columns * m.rows * (m.dataOrg === '16bit' ? 2 : 1)
      );
      fallbackAddrCursor += Math.ceil(stride / 0x10) * 0x10;
    }
    const addrHex = normalizeHexAddress(effectiveAddrNum.toString(16), 5);

    const rlName = getRecordLayoutName(m.dataOrg, m.signed);
    const cmName = registerCompuMethod(m.factor, m.offset, m.unit, m.precision);
    const rawBounds = getRawBounds(m.dataOrg, m.signed);
    const physA = rawBounds.min * m.factor + m.offset;
    const physB = rawBounds.max * m.factor + m.offset;
    const lowerLimit = Number(Math.min(physA, physB).toFixed(4));
    const upperLimit = Number(Math.max(physA, physB).toFixed(4));

    const folderKey = sanitizeAsap2Identifier(m.folder || 'Calibration', 'Calibration');
    if (!groupsMap.has(folderKey)) groupsMap.set(folderKey, []);
    groupsMap.get(folderKey)!.push(charName);

    const addrTag = hasExplicitAddr ? '' : ' [NEEDS_EXACT_HEX_ADDR]';
    const desc = sanitizeAsap2String(
      `${m.mapCode} (${m.columns}x${m.rows}, ${m.dataOrg}${m.signed ? ' Signed' : ''}, F=${m.factor}, O=${m.offset})${addrTag}`,
      180
    );

    const axisDescrLines: string[] = [];

    const emitAxis = (axis: WinolsDamosAxisConfig, axisSuffix: 'X' | 'Y') => {
      const axisCmName = registerCompuMethod(axis.factor, axis.offset, axis.unit, 2);
      const axisAddrNum = parseHexNumber(axis.addressHex);
      if (axisAddrNum !== null) {
        const axisPtsName = uniqueCharName(`${charName}_AXIS_${axisSuffix}`);
        const axisAddrHex = normalizeHexAddress(axisAddrNum.toString(16), 5);
        const axisRl = getAxisRecordLayoutName(axis.dataOrg, axis.signed);
        axisPtsBlocks.push(
          [
            `    /begin AXIS_PTS ${axisPtsName}`,
            `      "${sanitizeAsap2String(`${m.mapCode} ${axisSuffix}-Axis (${axis.label})`)}"`,
            `      ${axisAddrHex}`,
            `      NO_INPUT_QUANTITY`,
            `      ${axisRl}`,
            `      0`,
            `      ${axisCmName}`,
            `      ${Math.max(1, axis.count)}`,
            `      ${axis.minValue}`,
            `      ${axis.maxValue}`,
            `    /end AXIS_PTS`,
          ].join('\n')
        );
        axisDescrLines.push(
          [
            `      /begin AXIS_DESCR`,
            `        COM_AXIS`,
            `        NO_INPUT_QUANTITY`,
            `        ${axisCmName}`,
            `        ${Math.max(1, axis.count)}`,
            `        ${axis.minValue}`,
            `        ${axis.maxValue}`,
            `        AXIS_PTS_REF ${axisPtsName}`,
            `      /end AXIS_DESCR`,
          ].join('\n')
        );
      } else {
        const step =
          axis.count > 1
            ? Math.max(1, Math.round((axis.maxValue - axis.minValue) / (axis.count - 1)))
            : 1;
        axisDescrLines.push(
          [
            `      /begin AXIS_DESCR`,
            `        FIX_AXIS`,
            `        NO_INPUT_QUANTITY`,
            `        ${axisCmName}`,
            `        ${Math.max(1, axis.count)}`,
            `        ${axis.minValue}`,
            `        ${axis.maxValue}`,
            `        FIX_AXIS_PAR_DIST ${Math.round(axis.minValue)} ${step} ${Math.max(1, axis.count)}`,
            `      /end AXIS_DESCR`,
          ].join('\n')
        );
      }
    };

    if (m.type === 'MAP') {
      if (m.axisX) emitAxis(m.axisX, 'X');
      if (m.axisY) emitAxis(m.axisY, 'Y');
    } else if (m.type === 'CURVE' && m.axisX) {
      emitAxis(m.axisX, 'X');
    }

    const lines = [
      `    /begin CHARACTERISTIC ${charName}`,
      `      "${desc}"`,
      `      ${m.type}`,
      `      ${addrHex}`,
      `      ${rlName}`,
      `      0`,
      `      ${cmName}`,
      `      ${lowerLimit}`,
      `      ${upperLimit}`,
      `      FORMAT "%.${m.precision}"`,
      ...axisDescrLines,
      `    /end CHARACTERISTIC`,
    ];

    characteristicBlocks.push(lines.join('\n'));
  }

  if (placeholderAddressCount > 0) {
    warningsFa.push(
      `${toPersianDigits(placeholderAddressCount)} نقشه فاقد آدرس هگز دقیق در متن جزوه بودند و با آدرس موقت از مبنای ${baseAddressHex} ثبت شدند؛ پیش از ایمپورت نهایی روی دامپ واقعی، آدرس دقیق آن‌ها را با ماشین‌حساب FCE6 یا جدول ویرایشگر وارد کنید.`
    );
  }
  if (options.maps.some((m) => m.checksumExternal)) {
    warningsFa.push(
      'برای ایسیوهای زیمنس ایرانی (تیبا، XU7، TU5، EF7، پراید)، نرم‌افزار WinOLS 2.24 چک‌سام را خودکار اصلاح نمی‌کند؛ حتماً پس از ویرایش فایل .bin چک‌سام را در پروگرمر TNM یا ECM اصلاح نمایید.'
    );
  }

  const compuMethodBlocks = Array.from(compuMethods.values()).map((cm) =>
    [
      `    /begin COMPU_METHOD ${cm.name}`,
      `      "Linear scaling: PHYS = RAW * ${cm.factor} + (${cm.offset})"`,
      `      RAT_FUNC`,
      `      "%.${cm.precision}"`,
      `      "${cm.unit}"`,
      `      COEFFS ${cm.coeffs.join(' ')}`,
      `    /end COMPU_METHOD`,
    ].join('\n')
  );

  const groupBlocks = Array.from(groupsMap.entries()).map(([groupName, items]) =>
    [
      `    /begin GROUP ${groupName}`,
      `      "${groupName} Calibration Maps"`,
      `      ROOT`,
      `      /begin REF_CHARACTERISTIC`,
      `        ${items.join(' ')}`,
      `      /end REF_CHARACTERISTIC`,
      `    /end GROUP`,
    ].join('\n')
  );

  const nowIso = new Date().toISOString();

  const a2lContent = [
    `/* ============================================================================`,
    ` * ASAM MCD-2MC (ASAP2 v1.51) DAMOS / A2L Map Pack for WinOLS 2.24`,
    ` * Project       : ${sanitizeAsap2String(options.projectName)}`,
    ` * ECU Family    : ${ecuFamily}`,
    ` * Working Base  : ${baseAddressHex}`,
    ` * Byte Order    : ${asap2ByteOrder} (${byteOrder === 'LoHi' ? 'Intel / Little-Endian LoHi' : 'Motorola / Big-Endian HiLo 25504'})`,
    ` * Maps Exported : ${options.maps.length} (${readyWithAddressCount} verified hex, ${placeholderAddressCount} placeholder)`,
    ` * Generated At  : ${nowIso}`,
    ` * WinOLS 2.24   : Project -> Ex- & Import -> Import DAMOS / A2L -> then Export .kp`,
    ` * ============================================================================ */`,
    ``,
    `ASAP2_VERSION 1 51`,
    `/begin PROJECT ${projectIdent} "${sanitizeAsap2String(options.projectName)}"`,
    `  /begin HEADER "Generated WinOLS 2.24 DAMOS A2L Map Pack"`,
    `    VERSION "1.0"`,
    `    PROJECT_NO ${projectIdent}`,
    `  /end HEADER`,
    ``,
    `  /begin MODULE ${sanitizeAsap2Identifier(ecuFamily, 'ECU_MODULE')} "${ecuFamily}"`,
    `    /begin MOD_COMMON "WinOLS 2.24 Common Memory Organization"`,
    `      BYTE_ORDER ${asap2ByteOrder}`,
    `      ALIGNMENT_BYTE 1`,
    `      ALIGNMENT_WORD 2`,
    `      ALIGNMENT_LONG 4`,
    `    /end MOD_COMMON`,
    ``,
    `    /* Standard 8-bit & 16-bit Record Layouts */`,
    `    /begin RECORD_LAYOUT RL_UBYTE`,
    `      FNC_VALUES 1 UBYTE ROW_DIR DIRECT`,
    `    /end RECORD_LAYOUT`,
    `    /begin RECORD_LAYOUT RL_SBYTE`,
    `      FNC_VALUES 1 SBYTE ROW_DIR DIRECT`,
    `    /end RECORD_LAYOUT`,
    `    /begin RECORD_LAYOUT RL_UWORD`,
    `      FNC_VALUES 1 UWORD ROW_DIR DIRECT`,
    `    /end RECORD_LAYOUT`,
    `    /begin RECORD_LAYOUT RL_SWORD`,
    `      FNC_VALUES 1 SWORD ROW_DIR DIRECT`,
    `    /end RECORD_LAYOUT`,
    `    /begin RECORD_LAYOUT RL_AXIS_UBYTE`,
    `      AXIS_PTS_X 1 UBYTE INDEX_INCR DIRECT`,
    `    /end RECORD_LAYOUT`,
    `    /begin RECORD_LAYOUT RL_AXIS_SBYTE`,
    `      AXIS_PTS_X 1 SBYTE INDEX_INCR DIRECT`,
    `    /end RECORD_LAYOUT`,
    `    /begin RECORD_LAYOUT RL_AXIS_UWORD`,
    `      AXIS_PTS_X 1 UWORD INDEX_INCR DIRECT`,
    `    /end RECORD_LAYOUT`,
    `    /begin RECORD_LAYOUT RL_AXIS_SWORD`,
    `      AXIS_PTS_X 1 SWORD INDEX_INCR DIRECT`,
    `    /end RECORD_LAYOUT`,
    ``,
    `    /* Conversion Formulas (RAT_FUNC) */`,
    ...compuMethodBlocks,
    ``,
    `    /* Axis Breakpoint Tables */`,
    ...axisPtsBlocks,
    ``,
    `    /* Calibration Characteristics (Maps, Curves, Scalars) */`,
    ...characteristicBlocks,
    ``,
    `    /* WinOLS Map List Folders */`,
    ...groupBlocks,
    `  /end MODULE`,
    `/end PROJECT`,
    ``,
  ].join('\n');

  const safeFileBase = sanitizeAsap2Identifier(options.projectName || 'WinOLS_DAMOS', 'WinOLS_DAMOS');

  return {
    a2lContent,
    fileName: `${safeFileBase}_WinOLS224.a2l`,
    validation: {
      totalMaps: options.maps.length,
      readyWithAddressCount,
      placeholderAddressCount,
      axisPointsCount: axisPtsBlocks.length,
      detectedBaseHex: baseAddressHex,
      byteOrder,
      warningsFa,
    },
  };
}

// ============================================================================
// WINOLS 2.24 CSV MAP LIST & COMPLETE WORKSHOP ZIP BUNDLE
// ============================================================================

export function generateWinols224CsvMapPack(maps: WinolsDamosMapConfig[]): string {
  const esc = (v: string | number | boolean) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'IdName',
    'PersianName',
    'Folder',
    'StartAddressHex',
    'WorkingBaseHex',
    'Type',
    'Columns',
    'Rows',
    'DataOrg',
    'Signed',
    'ByteOrder',
    'Factor',
    'Offset',
    'Precision',
    'Unit',
    'AxisX_Addr',
    'AxisX_Count',
    'AxisY_Addr',
    'AxisY_Count',
    'ECU_Family',
    'AddressVerified',
    'SafetyNote',
  ];

  const rows = maps.map((m) =>
    [
      sanitizeAsap2Identifier(m.mapCode),
      m.nameFa,
      m.folder,
      m.startAddressHex || 'TBD',
      m.baseAddressHex,
      m.type,
      m.columns,
      m.rows,
      m.dataOrg,
      m.signed ? 'Yes' : 'No',
      m.byteOrder,
      m.factor,
      m.offset,
      m.precision,
      m.unit,
      m.axisX?.addressHex || '',
      m.axisX?.count || 0,
      m.axisY?.addressHex || '',
      m.axisY?.count || 0,
      m.ecuFamily,
      m.addressVerified ? 'Yes' : 'Placeholder',
      m.safetyNote,
    ]
      .map(esc)
      .join(';')
  );

  return `\uFEFF${headers.map(esc).join(';')}\n${rows.join('\n')}`;
}

export function buildWinols224PersianReadme(params: {
  projectName: string;
  a2lFileName: string;
  csvFileName: string;
  validation: WinolsA2lValidationReport;
}): string {
  return [
    `========================================================================`,
    `راهنمای گام‌به‌گام ایمپورت داموس در WinOLS 2.24 و ساخت فایل .kp`,
    `پروژه: ${params.projectName}`,
    `========================================================================`,
    ``,
    `نکته فنی مهم درباره فرمت .kp و .a2l:`,
    `- فرمت .kp متعلق به شرکت EVC بوده و به‌صورت باینری رمزنگاری‌شده ذخیره می‌شود.`,
    `- نرم‌افزار WinOLS 2.24 به‌صورت بومی و استاندارد فایل‌های ASAM ASAP2 (.a2l) را`,
    `  به‌عنوان DAMOS کامل می‌خواند و پس از ایمپورت می‌توانید با دو کلیک خروجی .kp بگیرید.`,
    ``,
    `مراحل ایمپورت در WinOLS 2.24:`,
    `۱. ابتدا فایل دامپ اورجینال (.bin) خودرو را در WinOLS 2.24 باز کنید.`,
    `   - برای بردهای زیمنس فلش‌دار (تیبا، XU7، EF7، پراید): گزینه Line Swapping / Decode را تایید کنید.`,
    `   - برای بردهای زیمنس بدون فلش No-Flash (TU5 / XU7 Plus در مبنای 0x68000): Line Swapping نیاز نیست.`,
    `۲. از منوی بالا مسیر زیر را اجرا کنید:`,
    `   Project  ->  Ex- & Import  ->  Import DAMOS / A2L`,
    `۳. فایل "${params.a2lFileName}" را انتخاب کرده و در پنجره Offset در صورت نیاز افست پایه (${params.validation.detectedBaseHex}) را بررسی و تایید کنید.`,
    `۴. پس از بارگذاری نقشه‌ها در پنجره My Maps، برای ذخیره به فرمت Map Pack (.kp):`,
    `   Project  ->  Ex- & Import  ->  Export Map Pack (.kp)`,
    ``,
    `خلاصه ممیزی فایل تولیدشده:`,
    `- تعداد کل نقشه‌ها: ${toPersianDigits(params.validation.totalMaps)}`,
    `- نقشه‌های دارای آدرس هگز تاییدشده: ${toPersianDigits(params.validation.readyWithAddressCount)}`,
    `- نقشه‌های دارای آدرس موقت (نیازمند تطبیق با دامپ): ${toPersianDigits(params.validation.placeholderAddressCount)}`,
    `- تعداد محورهای (AXIS_PTS) ثبت‌شده: ${toPersianDigits(params.validation.axisPointsCount)}`,
    `- ترتیب بایت (Byte Order): ${params.validation.byteOrder}`,
    ``,
    ...(params.validation.warningsFa.length > 0
      ? ['هشدارهای ایمنی و کالیبراسیون:', ...params.validation.warningsFa.map((w, i) => `${toPersianDigits(i + 1)}. ${w}`), '']
      : []),
    `فایل CSV همراه (${params.csvFileName}) نیز برای باز کردن مستقیم در اکسل و چک‌لیست کارگاهی آماده شده است.`,
  ].join('\n');
}

export async function generateWinols224DamosBundleZip(options: {
  projectName: string;
  ecuFamily?: string;
  byteOrder?: WinolsByteOrder;
  baseAddressHex?: string;
  maps: WinolsDamosMapConfig[];
}): Promise<{
  zipBytes: Uint8Array;
  fileName: string;
  a2lOutput: WinolsA2lBuildOutput;
}> {
  const a2lOutput = generateWinols224A2l(options);
  const safeBase = sanitizeAsap2Identifier(options.projectName || 'WinOLS_DAMOS', 'WinOLS_DAMOS');
  const csvFileName = `${safeBase}_WinOLS224_MapPack.csv`;
  const csvContent = generateWinols224CsvMapPack(options.maps);
  const readmeContent = buildWinols224PersianReadme({
    projectName: options.projectName,
    a2lFileName: a2lOutput.fileName,
    csvFileName,
    validation: a2lOutput.validation,
  });

  const zip = new JSZip();
  zip.file(a2lOutput.fileName, a2lOutput.a2lContent);
  zip.file(csvFileName, csvContent);
  zip.file('README-WinOLS-2.24.txt', `\uFEFF${readmeContent}`);
  zip.file(
    'damos-manifest.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        targetTool: 'WinOLS 2.24 (ASAM ASAP2 v1.51)',
        projectName: options.projectName,
        ecuFamily: options.ecuFamily || 'Siemens / Bosch ECU',
        baseAddressHex: a2lOutput.validation.detectedBaseHex,
        byteOrder: a2lOutput.validation.byteOrder,
        generatedAt: new Date().toISOString(),
        validation: a2lOutput.validation,
        maps: options.maps,
      },
      null,
      2
    )
  );

  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    zipBytes,
    fileName: `${safeBase}_WinOLS224_DAMOS_Bundle.zip`,
    a2lOutput,
  };
}
