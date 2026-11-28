import { computeSha256Hex, extractFileExtension } from './automotiveGatekeeper.ts';
import {
  analyzeAutomotiveDatalogCsv,
  computeInverseAsamRatFunc,
  isTelemetryDatalogCsv,
  validateA2lAxisMonotonicity,
  type AutomotivePhysicalGuardReport,
  type TelemetryBriefReport,
} from './telemetryAnalyzer.ts';
import {
  auditCalibrationMapsForWinOls224,
  type CalibrationFactorSanityPreview,
  type CalibrationMapMemoryIssue,
  type TnmMemoryArchitectureProfile,
} from './smartClusteringAndHealthMonitor.ts';

export type CalibrationEvidenceTier =
  | 'a2l_xdf_verified'
  | 'verified_datalog_dyno'
  | 'text_or_screenshot_reported'
  | 'pattern_candidate';

export interface StrictCalibrationMapSpec {
  mapName: string;
  hexAddress: string;
  dimensions: string | null;
  rows: number | null;
  cols: number | null;
  bitWidth: 8 | 16 | 32 | null;
  byteOrder: 'HiLo' | 'LoHi' | null;
  signed: boolean | null;
  factor: number | null;
  offset: number | null;
  unit: string | null;
  xAxisLabel: string | null;
  yAxisLabel: string | null;
  stockValue: string | null;
  safeChangeRange: string | null;
  evidenceTier: CalibrationEvidenceTier;
  humanReviewRequired: true;
  flashReady: false;
  notesFa: string | null;
  axisDirection?: 'ascending' | 'descending' | 'constant' | 'zigzag';
  axisWarningsFa?: string[];
}

export interface WinOlsProjectMetadata {
  containerType: 'winols_ols' | 'winols_kp_zip' | 'winols_kp_proprietary' | 'damos_dam';
  zipBombBlocked: boolean;
  declaredUncompressedBytes: number;
  vehicleMakeModel: string | null;
  engineCode: string | null;
  ecuBuild: string | null;
  detectedDamosMapIds: string[];
  archiveEntryNames: string[];
}

export interface EcuTechnicalProfileJson {
  fileName: string;
  format: string;
  sha256: string;
  byteLength: number;
  sizeClass: string;
  detectedEcuFamilies: string[];
  detectedHwNumbers: string[];
  detectedSwNumbers: string[];
  readableAsciiHints: string[];
  extractedMaps: StrictCalibrationMapSpec[];
  winOlsMetadata?: WinOlsProjectMetadata | null;
  telemetryBrief?: TelemetryBriefReport | null;
  physicalGuardReport?: AutomotivePhysicalGuardReport | null;
  tnmMemoryProfile?: TnmMemoryArchitectureProfile | null;
  calibrationMemoryIssues?: CalibrationMapMemoryIssue[];
  factorSanityPreviews?: CalibrationFactorSanityPreview[];
  encryptedPayloadNoticeFa: string | null;
  rawBinaryStored: false;
  memoryPurgedAfterAnalysis: boolean;
  humanReviewWarningFa: string;
}

const ECU_FAMILY_PATTERNS: ReadonlyArray<{ family: string; regex: RegExp }> = [
  { family: 'Bosch ME7.4.4', regex: /\bME7\.?4\.?4\b/i },
  { family: 'Bosch ME7.4.5', regex: /\bME7\.?4\.?5\b/i },
  { family: 'Bosch ME7.4.9', regex: /\bME7\.?4\.?9\b/i },
  { family: 'Bosch ME17.9.7', regex: /\bME17\.?9\.?7[0-9]*\b/i },
  { family: 'Bosch ME7', regex: /\bME7(?:\.[0-9]+)*\b/i },
  { family: 'Bosch MED17', regex: /\bMED17(?:\.[0-9]+)*\b/i },
  { family: 'Bosch MEVD17', regex: /\bMEVD17(?:\.[0-9]+)*\b/i },
  { family: 'Bosch EDC17', regex: /\bEDC17[A-Z0-9._-]*\b/i },
  { family: 'Bosch EDC16', regex: /\bEDC16[A-Z0-9._-]*\b/i },
  { family: 'Bosch MG1/MD1', regex: /\bM[GD]1C[SP][0-9]+\b/i },
  { family: 'Siemens SIM2K', regex: /\bSIM2K[-_]?[0-9A-Z]+\b/i },
  { family: 'Siemens MS43', regex: /\bMS4[235]\b/i },
  { family: 'Siemens SID', regex: /\bSID[28][0-9]{2}[A-Z]?\b/i },
  { family: 'Continental EMS/SIMOS', regex: /\b(?:EMS31[0-9]{2}|SIMOS1[28]|CONTINENTAL|EASY[-_]?U)\b/i },
  { family: 'Valeo J34/J35/V40', regex: /\b(?:VALEO|J34P|J35|V40|V46)\b/i },
  { family: 'Sagem S2000/SL96', regex: /\b(?:SAGEM|S2000|SL96)\b/i },
  { family: 'MAW / SSAT / Kesens', regex: /\b(?:SSAT|KESENS|MAW|LZNF)\b/i },
  { family: 'Magneti Marelli', regex: /\b(?:MARELLI|IAW\s*[0-9A-Z]+)\b/i },
  { family: 'Delphi', regex: /\b(?:DELPHI|MT80|DCM3\.[0-9])\b/i },
  { family: 'Denso', regex: /\bDENSO\b/i },
];

const KNOWN_DAMOS_MAP_IDS: ReadonlyArray<string> = [
  'KFZW',
  'KFZW2',
  'KFZWOP',
  'KFZWOP2',
  'LAMFA',
  'KFLBTS',
  'LDRXN',
  'LDRXNZK',
  'KFMIRL',
  'KFMIOP',
  'KFPED',
  'KFPEDR',
  'NMAX',
  'NMAXOG',
  'CWMDAPP',
  'KFLDRL',
  'KFLDIMX',
  'KRKTE',
  'TVUB',
  'FKKVS',
  'KFKHFM',
  'MLHFM',
  'CDKAT',
  'CWDLSAHK',
];

export function classifyEcuFlashSize(byteLength: number): string {
  const knownSizes: Array<{ label: string; bytes: number }> = [
    { label: '64KB', bytes: 64 * 1024 },
    { label: '128KB', bytes: 128 * 1024 },
    { label: '256KB', bytes: 256 * 1024 },
    { label: '512KB', bytes: 512 * 1024 },
    { label: '832KB', bytes: 832 * 1024 },
    { label: '1MB', bytes: 1024 * 1024 },
    { label: '1.5MB', bytes: 1536 * 1024 },
    { label: '2MB', bytes: 2 * 1024 * 1024 },
    { label: '4MB', bytes: 4 * 1024 * 1024 },
    { label: '8MB', bytes: 8 * 1024 * 1024 },
  ];
  for (const s of knownSizes) {
    if (byteLength === s.bytes) return s.label;
  }
  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(2)}MB`;
  }
  if (byteLength >= 1024) {
    return `${Math.round(byteLength / 1024)}KB`;
  }
  return `${byteLength}B`;
}

/**
 * Extracts printable ASCII and UTF-16LE strings (length >= 5) from an ECU binary in-memory.
 */
export function scanPrintableAsciiStrings(bytes: Uint8Array, minLen = 5, maxStrings = 400): string[] {
  const results: string[] = [];
  let current = '';

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b <= 0x7e) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= minLen) {
        const trimmed = current.trim();
        if (trimmed.length >= minLen) {
          results.push(trimmed);
          if (results.length >= maxStrings) break;
        }
      }
      current = '';
    }
  }
  if (current.length >= minLen && results.length < maxStrings) {
    const trimmed = current.trim();
    if (trimmed.length >= minLen) results.push(trimmed);
  }

  // Also scan UTF-16LE ASCII sequences (common in WinOLS .ols project headers)
  if (results.length < maxStrings && bytes.length >= 16) {
    let utf16Curr = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const lo = bytes[i];
      const hi = bytes[i + 1];
      if (hi === 0x00 && lo >= 0x20 && lo <= 0x7e) {
        utf16Curr += String.fromCharCode(lo);
      } else {
        if (utf16Curr.length >= minLen) {
          const trimmed = utf16Curr.trim();
          if (trimmed.length >= minLen && !results.includes(trimmed)) {
            results.push(trimmed);
            if (results.length >= maxStrings) break;
          }
        }
        utf16Curr = '';
      }
    }
  }

  // Also scan 16-bit byte-swapped (Swap16) sequences for TNM/KESS 29F400 line-swapped dumps
  // when normal ASCII scan found very few recognizable ECU/SW markers
  const hasKnownEcuMarker = results.some((r) =>
    /(?:0261|0281|1037|1039|5WY|S2000|SIM2K|ME7|VALEO|BOSCH|SIEMENS)/i.test(r)
  );
  if (!hasKnownEcuMarker && bytes.length >= 10 && results.length < maxStrings) {
    let swapCurr = '';
    const scanLimit = Math.min(bytes.length - 1, 256 * 1024);
    for (let i = 0; i < scanLimit; i += 2) {
      const b0 = bytes[i + 1];
      const b1 = bytes[i];
      for (const b of [b0, b1]) {
        if (b >= 0x20 && b <= 0x7e) {
          swapCurr += String.fromCharCode(b);
        } else {
          if (swapCurr.length >= minLen) {
            const trimmed = swapCurr.trim();
            if (
              trimmed.length >= minLen &&
              /(?:0261|0281|1037|1039|5WY|S2000|SIM2K|ME7|VALEO|BOSCH|SIEMENS)/i.test(trimmed) &&
              !results.includes(trimmed)
            ) {
              results.push(trimmed);
            }
          }
          swapCurr = '';
        }
      }
    }
    if (
      swapCurr.length >= minLen &&
      /(?:0261|0281|1037|1039|5WY|S2000|SIM2K|ME7|VALEO|BOSCH|SIEMENS)/i.test(swapCurr)
    ) {
      const trimmed = swapCurr.trim();
      if (!results.includes(trimmed)) results.push(trimmed);
    }
  }

  return results;
}

/**
 * Pure-TypeScript safe WinOLS (.ols / .kp / .dam) header & ZIP container analyzer.
 * Enforces a strict 16 MB Zip-Bomb guard on PK-packed `.kp` mappacks and extracts
 * vehicle/engine/ECU metadata and DAMOS map identifiers without inventing map offsets.
 */
export function parseWinOlsKpProjectMetadata(
  rawBytes: Uint8Array,
  format: 'ols' | 'kp' | 'dam',
  asciiStrings: string[]
): WinOlsProjectMetadata {
  const MAX_SAFE_UNCOMPRESSED_BYTES = 16 * 1024 * 1024; // 16 MB Zip-Bomb Guard
  const isPkZip =
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x50 &&
    rawBytes[1] === 0x4b &&
    (rawBytes[2] === 0x03 || rawBytes[2] === 0x05);

  const archiveEntryNames: string[] = [];
  let declaredUncompressedBytes = 0;
  let zipBombBlocked = false;

  if (isPkZip) {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    let offset = 0;
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let usedDataDescriptor = false;

    while (offset + 30 <= rawBytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break; // Local file header signature
      const flags = view.getUint16(offset + 6, true);
      const compSize = view.getUint32(offset + 18, true);
      const uncompSize = view.getUint32(offset + 22, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);

      // ZIP64 marker (0xFFFFFFFF) signals >4GB entry -> block immediately as Zip-Bomb
      if (uncompSize === 0xffffffff || compSize === 0xffffffff) {
        zipBombBlocked = true;
        declaredUncompressedBytes = Number.MAX_SAFE_INTEGER;
        break;
      }

      const hasDataDescriptor = (flags & 0x0008) !== 0;
      if (hasDataDescriptor) {
        usedDataDescriptor = true;
      }

      declaredUncompressedBytes += uncompSize;
      if (
        declaredUncompressedBytes > MAX_SAFE_UNCOMPRESSED_BYTES ||
        uncompSize > MAX_SAFE_UNCOMPRESSED_BYTES
      ) {
        zipBombBlocked = true;
        break;
      }

      if (offset + 30 + nameLen <= rawBytes.length && nameLen > 0 && nameLen <= 256) {
        const entryName = decoder.decode(rawBytes.subarray(offset + 30, offset + 30 + nameLen));
        archiveEntryNames.push(entryName);
      }

      const nextOffset = offset + 30 + nameLen + extraLen + compSize;
      if (hasDataDescriptor || !Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > rawBytes.length) {
        break;
      }
      offset = nextOffset;
    }

    // Fallback Central Directory (0x02014b50) scan catches sizes hidden behind bit-3 Data Descriptors
    if (!zipBombBlocked && (usedDataDescriptor || declaredUncompressedBytes === 0)) {
      let cdTotalUncomp = 0;
      for (let i = 0; i + 46 <= rawBytes.length; i++) {
        if (
          rawBytes[i] === 0x50 &&
          rawBytes[i + 1] === 0x4b &&
          rawBytes[i + 2] === 0x01 &&
          rawBytes[i + 3] === 0x02
        ) {
          const cdCompSize = view.getUint32(i + 20, true);
          const cdUncompSize = view.getUint32(i + 24, true);
          const cdNameLen = view.getUint16(i + 28, true);
          const cdExtraLen = view.getUint16(i + 30, true);
          const cdCommentLen = view.getUint16(i + 32, true);
          if (cdUncompSize === 0xffffffff || cdCompSize === 0xffffffff) {
            zipBombBlocked = true;
            declaredUncompressedBytes = Number.MAX_SAFE_INTEGER;
            break;
          }
          cdTotalUncomp += cdUncompSize;
          if (cdTotalUncomp > MAX_SAFE_UNCOMPRESSED_BYTES || cdUncompSize > MAX_SAFE_UNCOMPRESSED_BYTES) {
            zipBombBlocked = true;
            declaredUncompressedBytes = Math.max(declaredUncompressedBytes, cdTotalUncomp);
            break;
          }
          if (i + 46 + cdNameLen <= rawBytes.length && cdNameLen > 0 && cdNameLen <= 256) {
            const entryName = decoder.decode(rawBytes.subarray(i + 46, i + 46 + cdNameLen));
            if (!archiveEntryNames.includes(entryName)) {
              archiveEntryNames.push(entryName);
            }
          }
          const jump = 46 + cdNameLen + cdExtraLen + cdCommentLen;
          if (jump > 0) i += jump - 1;
        }
      }
      if (!zipBombBlocked && cdTotalUncomp > declaredUncompressedBytes) {
        declaredUncompressedBytes = cdTotalUncomp;
      }
    }
  }

  const joined = asciiStrings.join('\n');
  const vehicleMatch = joined.match(
    /\b(Peugeot\s*20[67]|Peugeot\s*405|Peugeot\s*Pars|Samand|Dena\s*Plus|Tara|Rana|Quick|Saina|Shahin|Pride|Tiba|Kia\s*[A-Za-z0-9]+|Hyundai\s*[A-Za-z0-9]+|BMW\s*E[0-9]{2}|Renault\s*L90|Megan[e]?)\b/i
  );
  const engineMatch = joined.match(
    /\b(TU5JP4|TU5\+|TU5|NFU|EF7\s*TC|EF7|XU7JP4|XU7|M15\s*GSI|M15|EC5|N20B20|M54B30|K4M)\b/i
  );
  const ecuBuildMatch = joined.match(
    /\b(ME7\.4\.[459]|ME17\.9\.7[0-9]*|MED17\.[0-9.]+|EDC17[A-Z0-9._-]*|SIM2K[-_]?[0-9A-Z]+|EMS313[024]|VALEO\s*J34[A-Z0-9]*|SAGEM\s*S2000)\b/i
  );

  const detectedDamosMapIds: string[] = [];
  for (const mapId of KNOWN_DAMOS_MAP_IDS) {
    const rx = new RegExp(`\\b${mapId}\\b`, 'i');
    if (rx.test(joined)) {
      detectedDamosMapIds.push(mapId);
    }
  }

  return {
    containerType:
      format === 'ols'
        ? 'winols_ols'
        : format === 'dam'
        ? 'damos_dam'
        : isPkZip
        ? 'winols_kp_zip'
        : 'winols_kp_proprietary',
    zipBombBlocked,
    declaredUncompressedBytes,
    vehicleMakeModel: vehicleMatch?.[1] ?? null,
    engineCode: engineMatch?.[1]?.toUpperCase() ?? null,
    ecuBuild: ecuBuildMatch?.[1]?.toUpperCase() ?? null,
    detectedDamosMapIds,
    archiveEntryNames: archiveEntryNames.slice(0, 16),
  };
}

function normalizeHexAddress(raw: string): string {
  const cleaned = raw.trim().replace(/^0x/i, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(cleaned)) return raw.trim();
  return `0x${cleaned}`;
}

function buildUnnamedMapFallback(hexAddress: string): string {
  const cleanHex = normalizeHexAddress(hexAddress);
  return `UNKNOWN_MAP_${cleanHex}`;
}

/**
 * Real deterministic ASAP2 (.a2l) parser extracting COMPU_METHOD, CHARACTERISTIC, and AXIS_PTS.
 * Uses true ASAM MCD-2 MC inverse RAT_FUNC (Phys = (f * Raw - c) / b) for 6-term COEFFS
 * and non-strict monotonicity validation for AXIS_PTS.
 */
export function parseAsap2A2lContent(a2lText: string): StrictCalibrationMapSpec[] {
  const compuMethods = new Map<
    string,
    { factor: number | null; offset: number | null; unit: string | null; ratFuncErrorFa: string | null }
  >();

  // Parse COMPU_METHOD blocks for linear COEFFS_LINEAR or 6-term COEFFS
  const compuRegex = /\/begin\s+COMPU_METHOD\s+(\S+)[\s\S]*?\/end\s+COMPU_METHOD/gi;
  let m: RegExpExecArray | null;
  while ((m = compuRegex.exec(a2lText)) !== null) {
    const block = m[0];
    const name = m[1];
    const unitMatch = block.match(/"([^"]*)"\s*(?:\r?\n|\s)+(?:COEFFS|COMPU_TAB_REF|\/end)/i);
    const sciNum = '([+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)';
    const linearMatch = block.match(new RegExp(`COEFFS_LINEAR\\s+${sciNum}\\s+${sciNum}`, 'i'));
    const coeffsMatch = block.match(
      new RegExp(`COEFFS\\s+${sciNum}\\s+${sciNum}\\s+${sciNum}\\s+${sciNum}\\s+${sciNum}\\s+${sciNum}`, 'i')
    );
    let factor: number | null = null;
    let offset: number | null = null;
    let ratFuncErrorFa: string | null = null;

    if (linearMatch) {
      factor = Number(linearMatch[1]);
      offset = Number(linearMatch[2]);
    } else if (coeffsMatch) {
      // ASAM MCD-2 MC standard: f(Phys) = (a*Phys^2 + b*Phys + c) / (d*Phys^2 + e*Phys + f) = Raw
      // Inverse linear (a=0, d=0, e=0): Phys = (f/b) * Raw - (c/b), requires b !== 0 && f !== 0
      const inv = computeInverseAsamRatFunc({
        a: Number(coeffsMatch[1]),
        b: Number(coeffsMatch[2]),
        c: Number(coeffsMatch[3]),
        d: Number(coeffsMatch[4]),
        e: Number(coeffsMatch[5]),
        f: Number(coeffsMatch[6]),
      });
      if (inv.valid) {
        factor = inv.rawToPhysicalFactor;
        offset = inv.rawToPhysicalOffset;
      } else {
        ratFuncErrorFa = inv.errorFa ?? null;
      }
    }
    compuMethods.set(name, {
      factor: factor !== null && Number.isFinite(factor) ? factor : null,
      offset: offset !== null && Number.isFinite(offset) ? offset : null,
      unit: unitMatch?.[1]?.trim() || null,
      ratFuncErrorFa,
    });
  }

  const maps: StrictCalibrationMapSpec[] = [];
  const charRegex = /\/begin\s+CHARACTERISTIC\s+(\S+)\s+"([^"]*)"\s+(VALUE|CURVE|MAP|CUBOID|VAL_BLK)\s+(0x[0-9a-fA-F]+)\s+(\S+)\s+([+-]?\d+(?:\.\d+)?)\s+(\S+)/gi;

  while ((m = charRegex.exec(a2lText)) !== null) {
    const fullStart = m.index;
    const endIdx = a2lText.indexOf('/end CHARACTERISTIC', fullStart);
    const block = endIdx > fullStart ? a2lText.slice(fullStart, endIdx + 19) : m[0];

    const rawName = m[1].trim();
    const description = m[2].trim();
    const charType = m[3].toUpperCase();
    const hexAddress = normalizeHexAddress(m[4]);
    const layout = m[5].toUpperCase();
    const compuName = m[7].trim();
    const compu = compuMethods.get(compuName);

    // Extract AXIS_DESCR counts if present
    const axisCounts = Array.from(
      block.matchAll(/\/begin\s+AXIS_DESCR[\s\S]*?(?:STD_AXIS|FIX_AXIS|COM_AXIS)\s+\S+\s+\S+\s+(\d+)/gi)
    ).map((am) => Number(am[1]));

    // Check optional inline FIX_AXIS_PAR_LIST breakpoints for monotonicity
    let axisDirection: StrictCalibrationMapSpec['axisDirection'];
    const axisWarningsFa: string[] = [];
    const fixAxisListMatch = block.match(/FIX_AXIS_PAR_LIST\s+([\d.\s+-]+)/i);
    if (fixAxisListMatch) {
      const pts = fixAxisListMatch[1]
        .trim()
        .split(/\s+/)
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));
      const axisCheck = validateA2lAxisMonotonicity(pts);
      axisDirection = axisCheck.direction;
      if (axisCheck.issue?.messageFa) {
        axisWarningsFa.push(axisCheck.issue.messageFa);
      }
    }
    if (compu?.ratFuncErrorFa) {
      axisWarningsFa.push(compu.ratFuncErrorFa);
    }

    let rows: number | null = null;
    let cols: number | null = null;
    if (charType === 'VALUE') {
      rows = 1;
      cols = 1;
    } else if (axisCounts.length >= 2) {
      cols = axisCounts[0];
      rows = axisCounts[1];
    } else if (axisCounts.length === 1) {
      rows = 1;
      cols = axisCounts[0];
    }

    const bitWidth: 8 | 16 | 32 | null = /32|ULONG|SLONG|FLOAT32/.test(layout)
      ? 32
      : /16|UWORD|SWORD/.test(layout)
      ? 16
      : /8|UBYTE|SBYTE/.test(layout)
      ? 8
      : null;
    const signed: boolean | null = /SBYTE|SWORD|SLONG|SIGNED/.test(layout)
      ? true
      : /UBYTE|UWORD|ULONG|UNSIGNED/.test(layout)
      ? false
      : null;
    const byteOrder: 'HiLo' | 'LoHi' | null = /MSB_FIRST|MOTOROLA|HILO/i.test(block)
      ? 'HiLo'
      : /MSB_LAST|INTEL|LOHI/i.test(block)
      ? 'LoHi'
      : null;

    maps.push({
      mapName: rawName || buildUnnamedMapFallback(hexAddress),
      hexAddress,
      dimensions: rows && cols ? `${cols}x${rows}` : null,
      rows,
      cols,
      bitWidth,
      byteOrder,
      signed,
      factor: compu?.factor ?? null,
      offset: compu?.offset ?? null,
      unit: compu?.unit ?? null,
      xAxisLabel: null,
      yAxisLabel: null,
      stockValue: null, // Strict Null Policy
      safeChangeRange: null, // Strict Null Policy
      evidenceTier: 'a2l_xdf_verified',
      humanReviewRequired: true,
      flashReady: false,
      notesFa: description || null,
      ...(axisDirection ? { axisDirection } : {}),
      ...(axisWarningsFa.length > 0 ? { axisWarningsFa } : {}),
    });
  }

  return maps;
}

/**
 * Real deterministic TunerPro (.xdf) XML parser extracting BASEOFFSET, XDFTABLE, XDFCONSTANT,
 * embedded address/bit-width/byte-order, and MATH factor/offset equations.
 */
export function parseTunerProXdfContent(xdfXml: string): StrictCalibrationMapSpec[] {
  const maps: StrictCalibrationMapSpec[] = [];

  // Parse BASEOFFSET (supports both positive addition and subtract="1")
  const baseOffsetTagMatch = xdfXml.match(/<BASEOFFSET\b([^>]*)\/?>/i);
  const baseOffsetAttrs = baseOffsetTagMatch?.[1] ?? '';
  const baseOffsetValMatch = baseOffsetAttrs.match(/offset="([^"]+)"/i);
  const baseOffsetSubtractMatch = baseOffsetAttrs.match(/subtract="([^"]+)"/i);
  const rawBaseOffset = baseOffsetValMatch ? Number.parseInt(baseOffsetValMatch[1], 0) || 0 : 0;
  const shouldSubtractBase = baseOffsetSubtractMatch
    ? /^(?:1|true)$/i.test(baseOffsetSubtractMatch[1].trim())
    : false;
  const baseOffsetDelta = shouldSubtractBase ? -rawBaseOffset : rawBaseOffset;

  const blockRegex = /<(XDFTABLE|XDFCONSTANT)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;

  while ((m = blockRegex.exec(xdfXml)) !== null) {
    const tag = m[1].toUpperCase();
    const inner = m[2];

    const titleMatch = inner.match(/<title>([^<]*)<\/title>/i);
    const descMatch = inner.match(/<description>([^<]*)<\/description>/i);
    const embedMatch = inner.match(/<EMBEDDEDDATA\b([^>]*)\/?>/i);
    if (!embedMatch) continue;

    const attrs = embedMatch[1];
    const addrMatch = attrs.match(/mmedaddress="([^"]+)"/i);
    if (!addrMatch) continue;

    const rawAddrNum = Number.parseInt(addrMatch[1], 0);
    const resolvedHex = Number.isFinite(rawAddrNum)
      ? `0x${Math.max(0, rawAddrNum + baseOffsetDelta).toString(16).toUpperCase()}`
      : normalizeHexAddress(addrMatch[1]);

    const bitsMatch = attrs.match(/mmedelementsizebits="(\d+)"/i);
    const parsedBits = bitsMatch ? Number(bitsMatch[1]) : null;
    const bitWidth: 8 | 16 | 32 | null =
      parsedBits === 8 || parsedBits === 16 || parsedBits === 32 ? parsedBits : null;

    const flagsMatch = attrs.match(/mmedtypeflags="([^"]+)"/i);
    const flagsNum = flagsMatch ? Number.parseInt(flagsMatch[1], 0) : null;
    // In XDF: bit 0 (0x01) = signed, bit 1 (0x02) = LSB first (LoHi)
    const signed = flagsNum !== null && Number.isFinite(flagsNum) ? Boolean(flagsNum & 0x01) : null;
    const byteOrder: 'HiLo' | 'LoHi' | null =
      flagsNum !== null && Number.isFinite(flagsNum)
        ? flagsNum & 0x02
          ? 'LoHi'
          : 'HiLo'
        : null;

    const rowsMatch = attrs.match(/mmedrowcount="(\d+)"/i);
    const colsMatch = attrs.match(/mmedcolcount="(\d+)"/i);
    const rows = tag === 'XDFCONSTANT' ? 1 : rowsMatch ? Number(rowsMatch[1]) : null;
    const cols = tag === 'XDFCONSTANT' ? 1 : colsMatch ? Number(colsMatch[1]) : null;

    const mathMatch = inner.match(/<MATH\b[^>]*equation="([^"]+)"/i);
    let factor: number | null = null;
    let offset: number | null = null;
    if (mathMatch) {
      const eq = mathMatch[1].replace(/\s+/g, '').replace(/^\((.*)\)$/, '$1');
      const numRx = '[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
      const xMul = eq.match(new RegExp(`^X\\*(${numRx})([+-]\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)?$`, 'i'));
      const mulX = eq.match(new RegExp(`^(${numRx})\\*X([+-]\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)?$`, 'i'));
      const xDiv = eq.match(new RegExp(`^X\\/(${numRx})([+-]\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)?$`, 'i'));
      const xAdd = eq.match(new RegExp(`^X([+-]\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)$`, 'i'));
      if (xMul) {
        factor = Number(xMul[1]);
        offset = xMul[2] ? Number(xMul[2]) : 0;
      } else if (mulX) {
        factor = Number(mulX[1]);
        offset = mulX[2] ? Number(mulX[2]) : 0;
      } else if (xDiv) {
        const div = Number(xDiv[1]);
        if (Number.isFinite(div) && div !== 0) {
          factor = Number((1 / div).toFixed(8));
          offset = xDiv[2] ? Number(xDiv[2]) : 0;
        }
      } else if (xAdd) {
        factor = 1;
        offset = Number(xAdd[1]);
      } else if (/^X$/i.test(eq)) {
        factor = 1;
        offset = 0;
      }
    }

    const unitsMatch = inner.match(/<units>([^<]*)<\/units>/i);
    const rawTitle = titleMatch?.[1]?.trim() || '';

    maps.push({
      mapName: rawTitle || buildUnnamedMapFallback(resolvedHex),
      hexAddress: resolvedHex,
      dimensions: rows && cols ? `${cols}x${rows}` : null,
      rows,
      cols,
      bitWidth,
      byteOrder,
      signed,
      factor,
      offset,
      unit: unitsMatch?.[1]?.trim() || null,
      xAxisLabel: null,
      yAxisLabel: null,
      stockValue: null,
      safeChangeRange: null,
      evidenceTier: 'a2l_xdf_verified',
      humanReviewRequired: true,
      flashReady: false,
      notesFa: descMatch?.[1]?.trim() || null,
    });
  }

  return maps;
}

/**
 * Deterministic CSV calibration map parser (respects Strict Null Policy & No Invented Map Names).
 */
export function parseCalibrationCsvContent(csvText: string): StrictCalibrationMapSpec[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const findCol = (candidates: string[]) =>
    headers.findIndex((h) => candidates.some((c) => h.includes(c)));

  const nameIdx = findCol(['name', 'map', 'نام']);
  const addrIdx = findCol(['address', 'addr', 'hex', 'آدرس']);
  const dimIdx = findCol(['dim', 'size', 'ابعاد']);
  const bitsIdx = findCol(['bit', 'width', 'بیت']);
  const orderIdx = findCol(['order', 'endian', 'ترتیب']);
  const factorIdx = findCol(['factor', 'ضریب']);
  const offsetIdx = findCol(['offset', 'آفست']);
  const unitIdx = findCol(['unit', 'واحد']);
  const stockIdx = findCol(['stock', 'فابریک']);
  const safeIdx = findCol(['safe', 'محدوده']);

  if (addrIdx < 0) return [];

  const maps: StrictCalibrationMapSpec[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const rawAddr = cells[addrIdx] || '';
    if (!rawAddr || !/^(?:0x)?[0-9a-f]+$/i.test(rawAddr)) continue;

    const hexAddress = normalizeHexAddress(rawAddr);
    const rawName = nameIdx >= 0 ? cells[nameIdx] || '' : '';
    const rawDim = dimIdx >= 0 ? cells[dimIdx] || '' : '';
    const dimMatch = rawDim.match(/(\d+)\s*[xX×]\s*(\d+)/);
    const cols = dimMatch ? Number(dimMatch[1]) : null;
    const rows = dimMatch ? Number(dimMatch[2]) : null;

    const rawBits = bitsIdx >= 0 ? Number(cells[bitsIdx]) : null;
    const bitWidth: 8 | 16 | 32 | null =
      rawBits === 8 || rawBits === 16 || rawBits === 32 ? rawBits : null;

    const rawOrder = orderIdx >= 0 ? (cells[orderIdx] || '').toLowerCase().trim() : '';
    const byteOrder: 'HiLo' | 'LoHi' | null =
      rawOrder.includes('lohi') ||
      rawOrder.includes('intel') ||
      rawOrder.includes('lsb') ||
      rawOrder.includes('little')
        ? 'LoHi'
        : rawOrder.includes('hilo') ||
            rawOrder.includes('motorola') ||
            rawOrder.includes('msb') ||
            rawOrder.includes('big')
          ? 'HiLo'
          : null;

    const parseNum = (idx: number): number | null => {
      if (idx < 0 || !cells[idx]) return null;
      const n = Number(cells[idx]);
      return Number.isFinite(n) ? n : null;
    };
    const parseStr = (idx: number): string | null => {
      if (idx < 0) return null;
      const v = (cells[idx] || '').trim();
      if (!v || /^(?:null|n\/a|unknown|نامشخص|-)$/i.test(v)) return null;
      return v;
    };

    maps.push({
      mapName: rawName || buildUnnamedMapFallback(hexAddress),
      hexAddress,
      dimensions: rows && cols ? `${cols}x${rows}` : null,
      rows,
      cols,
      bitWidth,
      byteOrder,
      signed: null,
      factor: parseNum(factorIdx),
      offset: parseNum(offsetIdx),
      unit: parseStr(unitIdx),
      xAxisLabel: null,
      yAxisLabel: null,
      stockValue: parseStr(stockIdx),
      safeChangeRange: parseStr(safeIdx),
      evidenceTier: 'a2l_xdf_verified',
      humanReviewRequired: true,
      flashReady: false,
      notesFa: null,
    });
  }
  return maps;
}

/**
 * Firmware Guard + Deterministic In-Memory ECU Binary / Calibration Analyzer.
 * CRITICAL SECURITY INVARIANT:
 * - Never writes raw binary to Markdown, DB, or logs (`rawBinaryStored: false`).
 * - Immediately zeroes the input byte buffer (`rawBytes.fill(0)`) in `finally` after extraction.
 * - Never hallucinates maps on encrypted `.ols`/`.kp` or raw `.bin` files.
 */
export function analyzeEcuFileInMemory(params: {
  fileName: string;
  rawBytes: Uint8Array;
  zeroBufferAfterAnalysis?: boolean;
}): EcuTechnicalProfileJson {
  const { fileName, rawBytes, zeroBufferAfterAnalysis = true } = params;
  const format = extractFileExtension(fileName) || 'bin';
  let memoryPurgedAfterAnalysis = false;

  try {
    const sha256 = computeSha256Hex(rawBytes);
    const byteLength = rawBytes.length;
    const sizeClass = classifyEcuFlashSize(byteLength);

    let extractedMaps: StrictCalibrationMapSpec[] = [];
    let winOlsMetadata: WinOlsProjectMetadata | null = null;
    let telemetryBrief: TelemetryBriefReport | null = null;
    let physicalGuardReport: AutomotivePhysicalGuardReport | null = null;
    let encryptedPayloadNoticeFa: string | null = null;
    const asciiStrings = scanPrintableAsciiStrings(rawBytes, 5, 350);
    const joinedAscii = asciiStrings.join('\n');

    if (format === 'a2l') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
      extractedMaps = parseAsap2A2lContent(text);
    } else if (format === 'xdf') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
      extractedMaps = parseTunerProXdfContent(text);
    } else if (format === 'csv') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
      if (isTelemetryDatalogCsv(text)) {
        telemetryBrief = analyzeAutomotiveDatalogCsv(text);
        physicalGuardReport = telemetryBrief.physicalGuardReport;
      } else {
        extractedMaps = parseCalibrationCsvContent(text);
      }
    } else if (format === 'ols' || format === 'kp' || format === 'dam') {
      winOlsMetadata = parseWinOlsKpProjectMetadata(rawBytes, format, asciiStrings);
      encryptedPayloadNoticeFa = winOlsMetadata.zipBombBlocked
        ? 'هشدار امنیتی Zip-Bomb: حجم فشرده‌نشده فایل .kp بیش از سقف مجاز ۱۶ مگابایت است و استخراج باینری متوقف شد.'
        : 'ساختار اختصاصی/رمزگذاری‌شده WinOLS (.ols/.kp/.dam) شناسایی شد. صرفاً رشته‌های هدر خوانا، متادیتای پروژه و شناسه‌های HW/SW استخراج شدند و هیچ نقشه حدسی تولید نگردید.';
    } else {
      encryptedPayloadNoticeFa =
        'فایل باینری خام ECU صرفاً از نظر امضای فنی، کلاس حجم فلش، خانواده ECU و شناسه‌های HW/SW در حافظه موقت تحلیل شد و فایل خام بلافاصله پاک‌سازی گردید.';
    }

    const detectedEcuFamilies = new Set<string>();
    for (const rule of ECU_FAMILY_PATTERNS) {
      if (rule.regex.test(joinedAscii) || rule.regex.test(fileName)) {
        detectedEcuFamilies.add(rule.family);
      }
    }

    const hwSet = new Set<string>();
    const swSet = new Set<string>();

    // Bosch 10-digit HW (0261/0281) & SW (1037/1039) + Siemens 5WY / Continental A2C / PSA 96
    for (const m of joinedAscii.matchAll(/\b((?:0261|0281|0265|0280)\d{6}|5WY[0-9A-Z]{4,8}|A2C\d{7,9}|96\d{8})\b/g)) {
      hwSet.add(m[1]);
    }
    for (const m of joinedAscii.matchAll(/\b((?:1037|1039)\d{6}|SW[:\s_-]*[0-9A-Z._-]{5,18})\b/gi)) {
      swSet.add(m[1].replace(/^SW[:\s_-]*/i, ''));
    }

    // Filter readable hints (avoid noisy garbage)
    const readableAsciiHints = asciiStrings
      .filter((s) => /[A-Za-z]{3,}/.test(s) && s.length <= 80)
      .slice(0, 20);

    const detectedEcuList = Array.from(detectedEcuFamilies);
    const winOlsAudit = auditCalibrationMapsForWinOls224(
      extractedMaps,
      byteLength,
      detectedEcuList
    );

    return {
      fileName,
      format,
      sha256,
      byteLength,
      sizeClass,
      detectedEcuFamilies: detectedEcuList,
      detectedHwNumbers: Array.from(hwSet).slice(0, 12),
      detectedSwNumbers: Array.from(swSet).slice(0, 12),
      readableAsciiHints,
      extractedMaps,
      winOlsMetadata,
      telemetryBrief,
      physicalGuardReport,
      tnmMemoryProfile: winOlsAudit.tnmProfile,
      calibrationMemoryIssues: winOlsAudit.issues,
      factorSanityPreviews: winOlsAudit.factorPreviews,
      encryptedPayloadNoticeFa,
      rawBinaryStored: false,
      memoryPurgedAfterAnalysis: zeroBufferAfterAnalysis,
      humanReviewWarningFa:
        'هشدار مهندسی: هیچ خروجی استخراج‌شده آماده فلش مستقیم روی ECU خودرو نیست و پیش از هرگونه تغییر باید توسط متخصص کالیبراسیون روی فایل خودرو بررسی و تأیید شود.',
    };
  } finally {
    if (zeroBufferAfterAnalysis) {
      rawBytes.fill(0);
      memoryPurgedAfterAnalysis = true;
    }
    void memoryPurgedAfterAnalysis;
  }
}

/**
 * Formats an EcuTechnicalProfileJson into clean Persian technical Markdown (zero raw binary).
 */
export function formatEcuProfileAsMarkdown(profile: EcuTechnicalProfileJson): string {
  const lines: string[] = [
    `## پروفایل فنی فایل کالیبراسیون / ECU (${profile.fileName})`,
    '',
    `- **کلاس حجم فلش:** ${profile.sizeClass} (${profile.byteLength} بایت)`,
    `- **خانواده ECU شناسایی‌شده:** ${profile.detectedEcuFamilies.length > 0 ? profile.detectedEcuFamilies.join('، ') : 'نامشخص / نیازمند بررسی روی فایل خودرو'}`,
    `- **شماره سخت‌افزار (HW):** ${profile.detectedHwNumbers.length > 0 ? profile.detectedHwNumbers.join('، ') : 'نامشخص'}`,
    `- **شماره نرم‌افزار (SW):** ${profile.detectedSwNumbers.length > 0 ? profile.detectedSwNumbers.join('، ') : 'نامشخص'}`,
    `- **اثر انگشت SHA-256:** \`${profile.sha256.slice(0, 16)}...\``,
  ];

  if (profile.winOlsMetadata) {
    const wm = profile.winOlsMetadata;
    lines.push(
      '',
      '### متادیتای استخراج‌شده پروژه WinOLS (.ols / .kp)',
      `- **نوع کانتینر:** \`${wm.containerType}\`${wm.zipBombBlocked ? ' (مسدودشده توسط گارد Zip-Bomb)' : ''}`,
      `- **خودرو / مدل شناسایی‌شده:** ${wm.vehicleMakeModel ?? 'نامشخص'}`,
      `- **کد موتور:** ${wm.engineCode ?? 'نامشخص'}`,
      `- **شناسه کالیبراسیون استخراجی (DAMOS IDs):** ${wm.detectedDamosMapIds.length > 0 ? wm.detectedDamosMapIds.join('، ') : 'نامشخص'}`
    );
  }

  if (profile.telemetryBrief) {
    lines.push('', profile.telemetryBrief.markdownBrief);
  }

  if (profile.encryptedPayloadNoticeFa) {
    lines.push('', `> **یادداشت تحلیل باینری:** ${profile.encryptedPayloadNoticeFa}`);
  }

  if (profile.extractedMaps.length > 0) {
    lines.push(
      '',
      '### کاتالوگ نقشه‌های کالیبراسیون استخراج‌شده',
      '',
      '| نام نقشه | آدرس هگز | ابعاد | بیت/ترتیب | ضریب (Factor) | آفست (Offset) | مقدار فابریک | بازه ایمن | سطح سند (Evidence Tier) |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    );
    const UNKNOWN = 'نامشخص / نیازمند بررسی روی فایل خودرو';
    for (const map of profile.extractedMaps) {
      const bitOrder =
        map.bitWidth && map.byteOrder
          ? `${map.bitWidth}-bit ${map.byteOrder}`
          : map.bitWidth
          ? `${map.bitWidth}-bit`
          : 'نامشخص';
      lines.push(
        `| ${map.mapName} | ${map.hexAddress} | ${map.dimensions ?? 'نامشخص'} | ${bitOrder} | ${map.factor ?? 'نامشخص'} | ${map.offset ?? 'نامشخص'} | ${map.stockValue ?? UNKNOWN} | ${map.safeChangeRange ?? UNKNOWN} | ${map.evidenceTier} |`
      );
    }

    if (profile.factorSanityPreviews && profile.factorSanityPreviews.length > 0) {
      lines.push('', '### پیش‌نمایش صحت فرمول تبدیل WinOLS 2.24 (Factor × Raw + Offset)');
      for (const prev of profile.factorSanityPreviews.slice(0, 8)) {
        const sampleText = prev.samples
          .map((s) => `\`${s.rawHex}\` (${s.rawDec}) ⬅ **${s.physicalDisplay}**`)
          .join(' · ');
        lines.push(`- **${prev.mapName}** (${prev.hexAddress}) [${prev.formulaDisplay}]: ${sampleText}`);
      }
    }

    if (profile.calibrationMemoryIssues && profile.calibrationMemoryIssues.length > 0) {
      lines.push('', '### هشدارهای ممیزی حافظه، تراز آدرس و انطباق WinOLS 2.24');
      for (const issue of profile.calibrationMemoryIssues) {
        lines.push(`- ⚠️ **${issue.mapName}** (${issue.hexAddress}): ${issue.detailFa}`);
      }
    }
  }

  if (profile.tnmMemoryProfile && profile.byteLength > 0) {
    lines.push(
      '',
      `> **معماری حافظه TNM / WinOLS 2.24:** ${profile.tnmMemoryProfile.architectureLabelFa} · بازه آدرس مجاز: \`${profile.tnmMemoryProfile.addressFloorHex}\` تا \`${profile.tnmMemoryProfile.addressCeilingHex}\` · آفست پایه پیشنهادی: \`${profile.tnmMemoryProfile.recommendedWinOlsBaseOffsetHex}\``
    );
  }

  lines.push('', `> **هشدار ایمنی:** ${profile.humanReviewWarningFa}`);
  return lines.join('\n');
}
