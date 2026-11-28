import type {
  MasterChapterRow,
  MasterKnowledgeUnitRow,
  MasterVolumeRow,
} from '../../db/masterEncyclopediaRepository.ts';
import {
  STRICT_NULL_DISPLAY_FA,
  formatStrictNullableField,
  normalizeRemapMapRecord,
} from './automotiveDomainEngine.ts';
import type { StrictCalibrationMapSpec } from './ecuBinaryAnalyzer.ts';
import { stripBase64ImagesFromMarkdown } from './multimodalExtractors.ts';
import { parseMarkdownDocument } from '../formatParsers.ts';
import { generateDocxUint8Array } from '../docxGenerator.ts';
import { DEFAULT_DOCX_CONFIG } from '../bookTypes.ts';

// Unicode Left-to-Right Isolate (LRI) and Pop Directional Isolate (PDI)
export const UNICODE_LRI = '\u2066';
export const UNICODE_PDI = '\u2069';

const LTR_TECHNICAL_TOKEN_REGEX =
  /(?<![\u2066A-Za-z0-9_])((?:0x[0-9A-Fa-f]{2,}|[PBCU][0-3][0-9A-Fa-f]{3}|(?:AFR|Lambda)\s*[0-9]+(?:\.[0-9]+)?(?::1)?|\d{1,3}\s*[xX×]\s*\d{1,3}|(?:8|16|32)-bit(?:\s+(?:HiLo|LoHi))?|(?:ME7(?:\.\d+)*|MED17(?:\.\d+)*|EDC17[A-Z0-9._-]*|SIM2K[-A-Z0-9]*|MS43|CAN-FD|CAN-BUS|LIN-BUS|DoIP|OBDonUDS|ZEVonUDS|SAE\s+J1979-2|SFD2?|SGW|WinOLS|KFZW|LAMFA|LDRXN|0261\d{6}|0281\d{6}|1037\d{6})))(?![\u2069A-Za-z0-9_])/g;

/**
 * Wraps LTR technical tokens (hex addresses, map dimensions, DTC codes, AFR/Lambda, ECU IDs)
 * inside Unicode Isolates (U+2066 ... U+2069) so Persian RTL Markdown renders with zero BiDi reversal.
 */
export function applyMarkdownBidiIsolates(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let inCodeFence = false;
  const out: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }
    if (inCodeFence) {
      out.push(line);
      continue;
    }
    const isolated = line.replace(LTR_TECHNICAL_TOKEN_REGEX, (match) => {
      return `${UNICODE_LRI}${match}${UNICODE_PDI}`;
    });
    out.push(isolated);
  }

  return out.join('\n');
}

export function compileEncyclopediaToMarkdown(params: {
  volumes: MasterVolumeRow[];
  chapters: MasterChapterRow[];
  units: MasterKnowledgeUnitRow[];
  volumeId?: string;
}): string {
  const targetVolumes = (params.volumeId
    ? params.volumes.filter((v) => v.id === params.volumeId)
    : params.volumes.filter((v) => v.status === 'published')
  ).sort((a, b) => a.volumeNumber - b.volumeNumber);

  const activeVerified = params.units.filter(
    (u) => u.lifecycleStatus === 'active' && u.verificationStatus === 'verified'
  );

  const lines: string[] = [
    '# دایرةالمعارف مرجع جامع مهندسی و عیب‌یابی خودرو',
    '',
    '> **نسخه کامپایل‌شده از پایگاه‌داده مرجع:** این خروجی صرفاً شامل واحدهای دانش تأییدشده (Verified) بدون داده شخصی (PII) و بدون باینری خام است.',
    '',
  ];

  if (targetVolumes.length === 0) {
    lines.push('هنوز هیچ جلد منتشرشده‌ای در دایرةالمعارف مرجع ثبت نشده است.');
    return lines.join('\n');
  }

  // Table of Contents
  lines.push('## فهرست مجلدات و فصل‌ها', '');
  for (const vol of targetVolumes) {
    lines.push(`- **${vol.title}** (${vol.wordCount} کلمه · حدود ${vol.estimatedPages} صفحه)`);
    const volChapters = params.chapters
      .filter((c) => c.volumeId === vol.id)
      .sort((a, b) => a.pedagogicalRank - b.pedagogicalRank || a.orderIndex - b.orderIndex);
    for (const ch of volChapters) {
      lines.push(`  - ${ch.title}`);
    }
  }
  lines.push('');

  for (const vol of targetVolumes) {
    lines.push(`# ${vol.title}`, '');
    if (vol.description) {
      lines.push(`> ${vol.description}`, '');
    }

    const volChapters = params.chapters
      .filter((c) => c.volumeId === vol.id)
      .sort((a, b) => a.pedagogicalRank - b.pedagogicalRank || a.orderIndex - b.orderIndex);

    for (const ch of volChapters) {
      const chUnits = activeVerified.filter((u) => u.chapterId === ch.id);
      if (chUnits.length === 0) continue;
      lines.push(`## ${ch.title}`, '');
      for (const u of chUnits) {
        const { cleanMarkdown } = stripBase64ImagesFromMarkdown(u.cleanText);
        lines.push(cleanMarkdown.trim(), '');
      }
    }
  }

  return applyMarkdownBidiIsolates(lines.join('\n'));
}

/**
 * Compiles verified Master Encyclopedia volumes/chapters into a real RTL Persian `.docx`
 * whose LTR technical runs carry explicit `<w:rtl w:val="0"/>` via `enforceRtlOoxmlIntegrity`.
 */
export async function compileEncyclopediaToDocxBuffer(params: {
  volumes: MasterVolumeRow[];
  chapters: MasterChapterRow[];
  units: MasterKnowledgeUnitRow[];
  volumeId?: string;
}): Promise<Uint8Array> {
  const markdown = compileEncyclopediaToMarkdown(params);
  const title =
    params.volumeId && params.volumes.find((v) => v.id === params.volumeId)?.title
      ? params.volumes.find((v) => v.id === params.volumeId)!.title
      : 'دایرةالمعارف مرجع جامع مهندسی خودرو';

  const parsed = parseMarkdownDocument(markdown, title);
  parsed.title = title;
  parsed.subtitle = 'نسخه مرجع چندجلدی · راست‌چین استاندارد با ایزولاسیون BiDi داده‌های فنی';

  return generateDocxUint8Array(parsed, {
    ...DEFAULT_DOCX_CONFIG,
    includeCoverPage: true,
    includeAutoToc: true,
    includeHeadersAndFooters: true,
  });
}

// ============================================================================
// EXTRACT CALIBRATION MAPS FROM KNOWLEDGE UNITS
// ============================================================================

export function extractCalibrationMapsFromUnits(
  units: MasterKnowledgeUnitRow[]
): StrictCalibrationMapSpec[] {
  const byKey = new Map<string, StrictCalibrationMapSpec>();

  for (const unit of units) {
    if (unit.lifecycleStatus !== 'active' || unit.verificationStatus !== 'verified') continue;
    const meta = unit.technicalMetadataJson as
      | { extractedMaps?: Partial<StrictCalibrationMapSpec>[] }
      | null
      | undefined;

    if (Array.isArray(meta?.extractedMaps)) {
      for (const rawMap of meta.extractedMaps) {
        if (!rawMap?.hexAddress) continue;
        const normalized = normalizeRemapMapRecord({
          ...rawMap,
          hexAddress: rawMap.hexAddress,
          evidenceTier: rawMap.evidenceTier ?? (unit.evidenceTier as StrictCalibrationMapSpec['evidenceTier']),
        });
        byKey.set(`${normalized.hexAddress}:${normalized.mapName}`, normalized);
      }
    }

    // Also detect explicit hex address mentions with dimensions in unit text (as text_or_screenshot_reported)
    const hexDimRegex = /\b(0x[0-9A-Fa-f]{4,})\b[^\n]{0,80}?(\d{1,2})\s*[xX×]\s*(\d{1,2})/g;
    let m: RegExpExecArray | null;
    while ((m = hexDimRegex.exec(unit.cleanText)) !== null) {
      const hex = `0x${m[1].replace(/^0x/i, '').toUpperCase()}`;
      const cols = Number(m[2]);
      const rows = Number(m[3]);
      const keyPrefix = `${hex}:`;
      const alreadyExists = Array.from(byKey.keys()).some((k) => k.startsWith(keyPrefix));
      if (alreadyExists) continue;

      const nearby = unit.cleanText.slice(Math.max(0, m.index - 40), m.index + 120);
      const nameMatch = nearby.match(/\b(KFZWOP|KFZW|LAMFA|LDRXN|KFMIRL|KFMIOP|KFLBTS|KFMRES)\b/i);
      const bitsMatch = nearby.match(/\b(8|16|32)[-\s]*bit\b/i);
      const orderMatch = nearby.match(/\b(HiLo|LoHi)\b/i);

      const normalized = normalizeRemapMapRecord({
        hexAddress: hex,
        mapName: nameMatch?.[1]?.toUpperCase() ?? '',
        cols,
        rows,
        dimensions: `${cols}x${rows}`,
        bitWidth: bitsMatch ? (Number(bitsMatch[1]) as 8 | 16 | 32) : null,
        byteOrder: orderMatch
          ? orderMatch[1].toLowerCase() === 'hilo'
            ? 'HiLo'
            : 'LoHi'
          : null,
        stockValue: null,
        safeChangeRange: null,
        evidenceTier: 'text_or_screenshot_reported',
      });
      byKey.set(`${normalized.hexAddress}:${normalized.mapName}`, normalized);
    }
  }

  return Array.from(byKey.values());
}

// ============================================================================
// REAL WINOLS 2.24 & 5 COMPATIBLE ASAP2 v1.60 (.a2l) EXPORTER + VALIDATOR
// ============================================================================

function sanitizeAsap2Ident(name: string, fallbackHex: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 64);
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    return `UNKNOWN_MAP_${fallbackHex.replace(/^0x/i, '')}`;
  }
  return cleaned;
}

export function isMapCompleteForAsap2(map: StrictCalibrationMapSpec): {
  complete: boolean;
  missingFields: string[];
} {
  const missing: string[] = [];
  if (!/^0x[0-9A-Fa-f]+$/.test(map.hexAddress)) missing.push('hexAddress');
  if (!map.rows || !map.cols || map.rows <= 0 || map.cols <= 0) missing.push('dimensions');
  if (!map.bitWidth) missing.push('bitWidth');
  if (map.factor === null || !Number.isFinite(map.factor)) missing.push('factor');
  if (map.offset === null || !Number.isFinite(map.offset)) missing.push('offset');
  return { complete: missing.length === 0, missingFields: missing };
}

export function validateAsap2Syntax(a2lContent: string): {
  valid: boolean;
  errors: string[];
  characteristicCount: number;
} {
  const errors: string[] = [];
  if (!/ASAP2_VERSION\s+1\s+(?:51|60|61|71)/.test(a2lContent)) {
    errors.push('Missing valid ASAP2_VERSION header (expected 1 51 or 1 60).');
  }

  const stack: string[] = [];
  const tokenRegex = /\/(begin|end)\s+([A-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  let characteristicCount = 0;

  while ((m = tokenRegex.exec(a2lContent)) !== null) {
    const kind = m[1];
    const blockName = m[2];
    if (kind === 'begin') {
      stack.push(blockName);
      if (blockName === 'CHARACTERISTIC') characteristicCount += 1;
    } else {
      const top = stack.pop();
      if (top !== blockName) {
        errors.push(`Mismatched /end ${blockName} (expected /end ${top ?? 'NONE'}).`);
      }
    }
  }

  if (stack.length > 0) {
    errors.push(`Unclosed ASAP2 blocks: ${stack.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    characteristicCount,
  };
}

/**
 * Generates a real, syntax-validated ASAP2 v1.60 (.a2l) compatible with WinOLS 2.24 & 5.
 * Strictly exports ONLY maps with complete address, dimensions, bit-width, factor, and offset.
 * Incomplete maps are listed in `excludedMaps` rather than guessed or fabricated!
 */
export function generateValidatedAsap2A2l(
  maps: StrictCalibrationMapSpec[],
  projectTitle = 'Automotive_Master_Calibration'
): {
  a2lContent: string;
  exportedCount: number;
  excludedMaps: Array<{ mapName: string; hexAddress: string; missingFields: string[] }>;
  validation: ReturnType<typeof validateAsap2Syntax>;
} {
  const safeProj = sanitizeAsap2Ident(projectTitle, 'PROJ');
  const exported: StrictCalibrationMapSpec[] = [];
  const excludedMaps: Array<{ mapName: string; hexAddress: string; missingFields: string[] }> = [];

  for (const map of maps) {
    const check = isMapCompleteForAsap2(map);
    if (check.complete) {
      exported.push(map);
    } else {
      excludedMaps.push({
        mapName: map.mapName,
        hexAddress: map.hexAddress,
        missingFields: check.missingFields,
      });
    }
  }

  const lines: string[] = [
    'ASAP2_VERSION 1 60',
    `/begin PROJECT ${safeProj} "Exported from Master Automotive Encyclopedia — Human Review Required (NOT flash-ready)"`,
    '  /begin HEADER "Verified Complete Maps Only — Strict Null Policy Enforced"',
    '    VERSION "1.60"',
    '  /end HEADER',
    '  /begin MODULE ECU_CALIBRATION "WinOLS 2.24 / WinOLS 5 Compatible ASAP2"',
    '    /begin MOD_COMMON "Standard Calibration Layout"',
    '      BYTE_ORDER MSB_FIRST',
    '      ALIGNMENT_BYTE 1',
    '      ALIGNMENT_WORD 2',
    '      ALIGNMENT_LONG 4',
    '    /end MOD_COMMON',
    '    /begin RECORD_LAYOUT RL_UBYTE_8 FNC_VALUES 1 UBYTE ROW_DIR DIRECT /end RECORD_LAYOUT',
    '    /begin RECORD_LAYOUT RL_SBYTE_8 FNC_VALUES 1 SBYTE ROW_DIR DIRECT /end RECORD_LAYOUT',
    '    /begin RECORD_LAYOUT RL_UWORD_16 FNC_VALUES 1 UWORD ROW_DIR DIRECT /end RECORD_LAYOUT',
    '    /begin RECORD_LAYOUT RL_SWORD_16 FNC_VALUES 1 SWORD ROW_DIR DIRECT /end RECORD_LAYOUT',
    '    /begin RECORD_LAYOUT RL_ULONG_32 FNC_VALUES 1 ULONG ROW_DIR DIRECT /end RECORD_LAYOUT',
    '    /begin RECORD_LAYOUT RL_SLONG_32 FNC_VALUES 1 SLONG ROW_DIR DIRECT /end RECORD_LAYOUT',
  ];

  const usedIdents = new Set<string>();
  exported.forEach((map, idx) => {
    const baseIdent = sanitizeAsap2Ident(map.mapName, map.hexAddress);
    let ident = baseIdent;
    let dupCounter = 2;
    while (usedIdents.has(ident)) {
      ident = `${baseIdent}_${dupCounter}`;
      dupCounter += 1;
    }
    usedIdents.add(ident);

    const compuId = `CM_${ident}_${idx + 1}`;
    const unitStr = (map.unit ?? '-').replace(/"/g, "'");
    const layoutName =
      map.bitWidth === 32
        ? map.signed
          ? 'RL_SLONG_32'
          : 'RL_ULONG_32'
        : map.bitWidth === 16
        ? map.signed
          ? 'RL_SWORD_16'
          : 'RL_UWORD_16'
        : map.signed
        ? 'RL_SBYTE_8'
        : 'RL_UBYTE_8';
    const charType =
      map.rows === 1 && map.cols === 1
        ? 'VALUE'
        : map.rows === 1 || map.cols === 1
        ? 'CURVE'
        : 'MAP';
    const byteOrderDirective = map.byteOrder === 'LoHi' ? 'MSB_LAST' : 'MSB_FIRST';

    lines.push(
      `    /begin COMPU_METHOD ${compuId} "Linear scaling for ${ident}"`,
      `      LINEAR "%8.4" "${unitStr}"`,
      `      COEFFS_LINEAR ${map.factor} ${map.offset}`,
      '    /end COMPU_METHOD',
      `    /begin CHARACTERISTIC ${ident} "Tier: ${map.evidenceTier} | Human review required"`,
      `      ${charType} ${map.hexAddress} ${layoutName} 0 ${compuId} -100000 100000`,
      `      BYTE_ORDER ${byteOrderDirective}`
    );

    if (charType === 'CURVE') {
      const count = Math.max(map.cols ?? 1, map.rows ?? 1);
      lines.push(
        `      /begin AXIS_DESCR STD_AXIS NO_INPUT_QUANTITY NO_COMPU_METHOD ${count} 0 ${count}`,
        '      /end AXIS_DESCR'
      );
    } else if (charType === 'MAP') {
      lines.push(
        `      /begin AXIS_DESCR STD_AXIS NO_INPUT_QUANTITY NO_COMPU_METHOD ${map.cols} 0 ${map.cols}`,
        '      /end AXIS_DESCR',
        `      /begin AXIS_DESCR STD_AXIS NO_INPUT_QUANTITY NO_COMPU_METHOD ${map.rows} 0 ${map.rows}`,
        '      /end AXIS_DESCR'
      );
    }

    lines.push('    /end CHARACTERISTIC');
  });

  lines.push('  /end MODULE', '/end PROJECT');

  const a2lContent = lines.join('\n') + '\n';
  const validation = validateAsap2Syntax(a2lContent);

  return {
    a2lContent,
    exportedCount: exported.length,
    excludedMaps,
    validation,
  };
}

// ============================================================================
// REAL TUNERPRO (.xdf) XML EXPORTER + VALIDATOR
// ============================================================================

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function validateXdfXml(xml: string): { valid: boolean; errors: string[]; tableCount: number } {
  const errors: string[] = [];
  if (!xml.includes('<XDFFORMAT') || !xml.includes('</XDFFORMAT>')) {
    errors.push('Missing root <XDFFORMAT> element.');
  }
  if (!xml.includes('<XDFHEADER>') || !xml.includes('</XDFHEADER>')) {
    errors.push('Missing <XDFHEADER> element.');
  }
  if (!xml.includes('<BASEOFFSET')) {
    errors.push('Missing <BASEOFFSET> definition.');
  }
  const openTables = (xml.match(/<XDFTABLE\b/g) ?? []).length;
  const closeTables = (xml.match(/<\/XDFTABLE>/g) ?? []).length;
  const openConsts = (xml.match(/<XDFCONSTANT\b/g) ?? []).length;
  const closeConsts = (xml.match(/<\/XDFCONSTANT>/g) ?? []).length;
  if (openTables !== closeTables) errors.push('Unbalanced <XDFTABLE> tags.');
  if (openConsts !== closeConsts) errors.push('Unbalanced <XDFCONSTANT> tags.');

  return {
    valid: errors.length === 0,
    errors,
    tableCount: openTables + openConsts,
  };
}

export function generateValidatedTunerProXdf(
  maps: StrictCalibrationMapSpec[],
  projectTitle = 'Automotive Master Calibration',
  baseOffsetHex = '0x0'
): {
  xdfXml: string;
  exportedCount: number;
  validation: ReturnType<typeof validateXdfXml>;
} {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<XDFFORMAT version="1.60">',
    '  <XDFHEADER>',
    '    <flags>0x1</flags>',
    `    <deftitle>${escapeXml(projectTitle)}</deftitle>`,
    '    <description>Generated by Master Automotive Encyclopedia — Human calibration review required. NOT flash-ready.</description>',
    `    <BASEOFFSET offset="${escapeXml(baseOffsetHex)}" subtract="0" />`,
    '    <DEFAULTS datasizeinbits="16" sigdigits="2" outputtype="1" signed="0" lsbfirst="0" float="0" />',
    '  </XDFHEADER>',
  ];

  let exportedCount = 0;

  maps.forEach((map, idx) => {
    if (!/^0x[0-9A-Fa-f]+$/.test(map.hexAddress)) return;
    exportedCount += 1;

    const uid = `0x${(idx + 1).toString(16).toUpperCase()}`;
    const bits = map.bitWidth ?? 16;
    const typeFlags = (map.signed ? 0x01 : 0x00) | (map.byteOrder === 'LoHi' ? 0x02 : 0x00);
    const typeFlagsHex = `0x${typeFlags.toString(16).padStart(2, '0')}`;
    const factor = map.factor ?? 1;
    const offset = map.offset ?? 0;
    const offsetPart = offset === 0 ? '' : offset > 0 ? `+${offset}` : `${offset}`;
    const equation = `X*${factor}${offsetPart}`;
    const desc = `Evidence Tier: ${map.evidenceTier} | Stock: ${formatStrictNullableField(map.stockValue)} | Safe Range: ${formatStrictNullableField(map.safeChangeRange)} | Human review required`;

    const isConstant = map.rows === 1 && map.cols === 1;
    if (isConstant) {
      lines.push(
        `  <XDFCONSTANT uniqueid="${uid}">`,
        `    <title>${escapeXml(map.mapName)}</title>`,
        `    <description>${escapeXml(desc)}</description>`,
        `    <EMBEDDEDDATA mmedaddress="${map.hexAddress}" mmedelementsizebits="${bits}" mmedtypeflags="${typeFlagsHex}" />`,
        `    <units>${escapeXml(map.unit ?? '-')}</units>`,
        `    <MATH equation="${escapeXml(equation)}"><VAR id="X" /></MATH>`,
        '  </XDFCONSTANT>'
      );
    } else {
      const rows = map.rows ?? 1;
      const cols = map.cols ?? 1;
      lines.push(
        `  <XDFTABLE uniqueid="${uid}" flags="0x0">`,
        `    <title>${escapeXml(map.mapName)}</title>`,
        `    <description>${escapeXml(desc)}</description>`,
        `    <XDFAXIS id="z">`,
        `      <EMBEDDEDDATA mmedaddress="${map.hexAddress}" mmedelementsizebits="${bits}" mmedtypeflags="${typeFlagsHex}" mmedrowcount="${rows}" mmedcolcount="${cols}" />`,
        `      <units>${escapeXml(map.unit ?? '-')}</units>`,
        `      <MATH equation="${escapeXml(equation)}"><VAR id="X" /></MATH>`,
        '    </XDFAXIS>',
        '  </XDFTABLE>'
      );
    }
  });

  lines.push('</XDFFORMAT>');
  const xdfXml = lines.join('\n') + '\n';
  const validation = validateXdfXml(xdfXml);

  return { xdfXml, exportedCount, validation };
}

// ============================================================================
// GOOGLE SHEETS / EXCEL CSV & JSON CALIBRATION SPEC MANIFEST
// ============================================================================

function escapeCsvCell(value: string): string {
  const str = String(value ?? '');
  const trimmedStart = str.replace(/^[\s\uFEFF]+/, '');
  const isPureSignedNumber = /^[+-]?\d+(?:\.\d+)?%?$/.test(trimmedStart);
  const safe = !isPureSignedNumber && /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function generateGoogleSheetsCalibrationCsv(maps: StrictCalibrationMapSpec[]): string {
  const headers = [
    'نام نقشه (Map Name)',
    'آدرس هگز (Hex Address)',
    'ابعاد (Dimensions)',
    'محور X / Y',
    'بیت و ترتیب بایت (Bit / Byte Order)',
    'ضریب (Factor)',
    'آفست (Offset)',
    'واحد (Unit)',
    'مقدار فابریک (Stock Value)',
    'محدوده تغییر ایمن (Safe Change Range)',
    'سطح سند (evidence_tier)',
    'هشدار بازبینی انسانی (Human Review)',
    'یادداشت فنی',
  ];

  const rows: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const map of maps) {
    const axes =
      map.xAxisLabel || map.yAxisLabel
        ? `${map.xAxisLabel ?? STRICT_NULL_DISPLAY_FA} × ${map.yAxisLabel ?? STRICT_NULL_DISPLAY_FA}`
        : STRICT_NULL_DISPLAY_FA;
    const bitOrder =
      map.bitWidth && map.byteOrder
        ? `${map.bitWidth}-bit ${map.byteOrder}${map.signed === true ? ' Signed' : map.signed === false ? ' Unsigned' : ''}`
        : map.bitWidth
        ? `${map.bitWidth}-bit`
        : STRICT_NULL_DISPLAY_FA;

    const cells = [
      map.mapName,
      map.hexAddress,
      map.dimensions ?? STRICT_NULL_DISPLAY_FA,
      axes,
      bitOrder,
      map.factor !== null ? String(map.factor) : STRICT_NULL_DISPLAY_FA,
      map.offset !== null ? String(map.offset) : STRICT_NULL_DISPLAY_FA,
      map.unit ?? STRICT_NULL_DISPLAY_FA,
      formatStrictNullableField(map.stockValue),
      formatStrictNullableField(map.safeChangeRange),
      map.evidenceTier,
      'نیازمند بازبینی متخصص — آماده فلش مستقیم نیست',
      map.notesFa ?? STRICT_NULL_DISPLAY_FA,
    ];
    rows.push(cells.map(escapeCsvCell).join(','));
  }

  // UTF-8 BOM for clean Persian rendering in Excel & Google Sheets
  return `\uFEFF${rows.join('\n')}\n`;
}

export function generateCalibrationSpecJson(
  maps: StrictCalibrationMapSpec[],
  meta: { projectTitle?: string; volumeCount?: number; unitCount?: number } = {}
): string {
  const manifest = {
    schemaVersion: '1.0.0',
    projectTitle: meta.projectTitle ?? 'Master Automotive Reference Encyclopedia',
    generatedAt: new Date().toISOString(),
    rawBinaryStored: false,
    flashReady: false,
    humanReviewRequired: true,
    safetyWarningFa:
      'این فایل صرفاً مشخصات فنی کالیبراسیون بدون باینری خام است و هیچ‌یک از نقشه‌ها بدون بررسی متخصص روی فایل خودرو آماده فلش مستقیم نیستند.',
    stats: {
      volumeCount: meta.volumeCount ?? 0,
      unitCount: meta.unitCount ?? 0,
      calibrationMapsCount: maps.length,
    },
    maps,
  };
  return JSON.stringify(manifest, null, 2);
}
