import type { ContentBlock, ParsedBook, TableBlock } from './bookTypes.ts';
import { toAsciiDigits } from './formatParsers.ts';

// ============================================================================
// 1. UAX #9 BIDI-SAFE TECHNICAL RUN SEGMENTER (for Word .docx & RTL Rendering)
// ============================================================================

export type BidiSegmentKind = 'rtl_text' | 'ltr_tech' | 'ltr_code';

export interface BidiRunSegment {
  kind: BidiSegmentKind;
  text: string;
}

/**
 * Regex matching inline automotive/ECU/engineering LTR technical tokens inside Persian text
 * that Microsoft Word corrupts (reverses -, :, /, (), hex ranges) if rendered inside an RTL run:
 *  - Hex addresses & ranges: 0x1A4F0, 0x00FF-0x0120, $1A4F
 *  - OBD-II / ISO DTC codes: P0135, U0100, C1201, B0001
 *  - ECU hardware/software identifiers: ME7.4.4, ME17.9.7, SIM2K-241, S2000-PL4, J34P, EDC17C60, EMS3125
 *  - Calibration map dimensions & names: 16x16, 16×16, KFZW, KFZW2, LAMFA, KFMIRL, LDRXN
 *  - Ratios & signed measurements with Latin units: 14.7:1, -2.5°, +3.5 deg, 0.85 λ, 1.2 bar, 45 mg/str
 *  - Multi-char Latin technical tokens & acronyms with numbers/hyphens/dots/slashes: CAN-BUS, ECU/TCU, OBD-II, AFR=12.5
 */
const LTR_CODE_PATTERN =
  /(?:0x[0-9A-Fa-f]{2,8}(?:\s*[-–→]\s*0x[0-9A-Fa-f]{2,8})?|\$[0-9A-Fa-f]{3,8}\b|\b[PCBU][0-3][0-9A-Fa-f]{3}\b)/;

const LTR_TECH_PATTERN = new RegExp(
  [
    // Hex addresses / ranges & OBD-II DTCs (captured first)
    '0x[0-9A-Fa-f]{2,8}(?:\\s*[-–→]\\s*0x[0-9A-Fa-f]{2,8})?',
    '\\$[0-9A-Fa-f]{3,8}\\b',
    '\\b[PCBU][0-3][0-9A-Fa-f]{3}\\b',
    // Ratios like 14.7:1 or 12.5:1
    '\\b\\d+(?:\\.\\d+)?\\s*:\\s*\\d+(?:\\.\\d+)?\\b',
    // Matrix / map dimensions like 16x16, 16×16, 12x16
    '\\b\\d{1,2}\\s*[xX×]\\s*\\d{1,2}\\b',
    // Signed numbers with optional unit (e.g. -2.5°, +3.5 deg, -4.0 CA, +0.25 bar)
    '[+-]\\d+(?:\\.\\d+)?(?:\\s*(?:°[CF]?|deg|CA|BTDC|ATDC|bar|psi|kPa|mbar|ms|V|mV|%|λ|AFR))?',
    // Numbers directly paired with Latin technical units (e.g. 3500 RPM, 1.2 bar, 45 mg/str, 0.85 lambda)
    '\\b\\d+(?:\\.\\d+)?\\s*(?:RPM|rpm|bar|BAR|psi|PSI|kPa|kpa|mbar|hPa|AFR|afr|lambda|λ|BTDC|ATDC|mg\\/str(?:oke)?|mg\\/stk|mg\\/hub|g\\/s|kg\\/h|ms|mV|V|kHz|MHz|Hz|Nm|hp|kW|kbps|baud|°C|°F)\\b',
    // ECU models, calibration map names, formulas, Latin technical acronyms (e.g. ME7.4.4, SIM2K-241, KFZW/KFZW2, AFR = 12.5)
    '\\b[A-Za-z][A-Za-z0-9._/-]{1,28}(?:\\s*[=<>±]\\s*[+-]?[A-Za-z0-9._:/-]+)?',
  ].join('|'),
  'g'
);

/**
 * Segments a Persian/mixed string into RTL prose runs and isolated LTR technical runs
 * following Unicode Bidirectional Algorithm (UAX #9) best practices for OOXML Word documents.
 */
export function segmentBidiTechnicalRuns(text: string): BidiRunSegment[] {
  if (!text) return [];
  const segments: BidiRunSegment[] = [];
  LTR_TECH_PATTERN.lastIndex = 0;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = LTR_TECH_PATTERN.exec(text)) !== null) {
    const start = match.index;
    const raw = match[0];
    // Trim trailing punctuation like '.' or ',' that belongs to outer Persian sentence
    const trimmed = raw.replace(/[.,;:]+$/, '');
    if (!trimmed) continue;

    // Avoid over-segmenting single short filler Latin words unless they have digits/symbols/uppercase codes
    const isPlainSingleLowerWord = /^[a-z]{2,3}$/.test(trimmed);
    if (isPlainSingleLowerWord) continue;

    if (start > cursor) {
      segments.push({ kind: 'rtl_text', text: text.slice(cursor, start) });
    }

    const kind: BidiSegmentKind = LTR_CODE_PATTERN.test(trimmed) ? 'ltr_code' : 'ltr_tech';
    segments.push({ kind, text: trimmed });
    cursor = start + trimmed.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'rtl_text', text: text.slice(cursor) });
  }

  // Coalesce multi-word English technical phrases (e.g., "Knock Retard", "Target Engine Load", "Rev Limiter / Cut-Off")
  // so an RTL space separator between two LTR words never reverses their visual reading order.
  const coalesced: BidiRunSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.text) continue;
    const prev = coalesced[coalesced.length - 1];
    const next = segments[i + 1];
    if (
      seg.kind === 'rtl_text' &&
      /^[\s/\-–]+$/.test(seg.text) &&
      prev &&
      prev.kind === 'ltr_tech' &&
      next &&
      next.kind === 'ltr_tech'
    ) {
      prev.text += seg.text + next.text;
      i += 1;
      continue;
    }
    if (prev && prev.kind === seg.kind) {
      prev.text += seg.text;
    } else {
      coalesced.push({ ...seg });
    }
  }

  return coalesced;
}

// ============================================================================
// 2. ECU PLATFORM / HARDWARE ISOLATION EXTRACTOR (Prevents Cross-ECU False Conflicts)
// ============================================================================

const ECU_PLATFORM_PATTERNS: Array<{ canonical: string; regex: RegExp }> = [
  { canonical: 'bosch_me744', regex: /\bme\s*7\.?4\.?4\b|بوش\s*۷\.?۴\.?۴|بوش\s*7\.?4\.?4/i },
  { canonical: 'bosch_me745', regex: /\bme\s*7\.?4\.?5\b|بوش\s*۷\.?۴\.?۵|بوش\s*7\.?4\.?5/i },
  { canonical: 'bosch_me749', regex: /\bme\s*7\.?4\.?9\b|بوش\s*۷\.?۴\.?۹|بوش\s*7\.?4\.?9/i },
  { canonical: 'bosch_me17', regex: /\bme\s*17(?:\.\d+)*\b|بوش\s*۱۷|بوش\s*17/i },
  { canonical: 'bosch_med17', regex: /\bmed\s*17(?:\.\d+)*\b/i },
  { canonical: 'bosch_edc17', regex: /\bedc\s*17[a-z0-9]*\b/i },
  { canonical: 'bosch_m797', regex: /\bm\s*7\.?9\.?7\b/i },
  { canonical: 'siemens_sim2k', regex: /\bsim2k(?:[-_\s]?\d+)?\b|زیمنس\s*سیم\s*۲کا/i },
  { canonical: 'siemens_ci1', regex: /\b(?:ci[1-6]|cge|cgm|cix)\b|زیمنس\s*(?:بایفیول|تک\s*سوز)/i },
  { canonical: 'sagem_s2000', regex: /\bs2000(?:[-_\s]?[a-z0-9]+)?\b|ساژم\s*(?:۲۰۰۰|2000)/i },
  { canonical: 'valeo_j34', regex: /\bj34[a-z]?\b|والئو\s*(?:جی\s*۳۴|j34)/i },
  { canonical: 'valeo_j35', regex: /\bj35[a-z]?\b|والئو\s*(?:جی\s*۳۵|j35)/i },
  { canonical: 'valeo_pl4', regex: /\bpl4\b/i },
  { canonical: 'continental_ems', regex: /\bems\s*\d{3,4}[a-z]?\b/i },
  { canonical: 'ssat', regex: /\bssat\b|ایسیو\s*اس\s*ست|اس‌ست/i },
  { canonical: 'lznf', regex: /\blznf\b/i },
  { canonical: 'maw', regex: /\bmaw\b|ایسیو\s*ماو/i },
  { canonical: 'kesens', regex: /\bkesens\b|کسنس/i },
  { canonical: 'engine_tu5', regex: /\btu5\b|تی‌یو۵|تیو۵/i },
  { canonical: 'engine_ef7', regex: /\bef7(?:\s*tc|\s*turbo)?\b|ای‌اف۷|موتور\s*ملی/i },
  { canonical: 'engine_xu7', regex: /\bxu7p?\b|ایکس‌یو۷/i },
  { canonical: 'engine_k4m', regex: /\bk4m\b/i },
  { canonical: 'engine_m15', regex: /\bm15\b/i },
];

export function extractEcuPlatforms(text: string): Set<string> {
  const ascii = toAsciiDigits(text).replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  const found = new Set<string>();
  for (const item of ECU_PLATFORM_PATTERNS) {
    if (item.regex.test(ascii)) {
      found.add(item.canonical);
    }
  }
  return found;
}

/**
 * Returns true if Text A and Text B explicitly reference DIFFERENT ECU/engine platforms
 * with zero overlap (e.g., Bosch ME7.4.4 vs Siemens SIM2K) — preventing cross-ECU false conflicts.
 */
export function hasDisjointEcuPlatforms(textA: string, textB: string): boolean {
  const a = extractEcuPlatforms(textA);
  const b = extractEcuPlatforms(textB);
  if (a.size === 0 || b.size === 0) return false;
  for (const platform of a) {
    if (b.has(platform)) return false;
  }
  return true;
}

// ============================================================================
// 3. ROW-BY-ROW LOSSLESS STRUCTURED TABLE FUSION (DTC / Pinout / Map Tables)
// ============================================================================

function normalizeTableCell(val: string): string {
  return toAsciiDigits(val || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface TableRowConflict {
  rowKey: string;
  columnHeader: string;
  valueA: string;
  valueB: string;
}

export interface TableMergeResult {
  compatible: boolean;
  mergedTable: TableBlock;
  addedRowCount: number;
  dedupedRowCount: number;
  rowConflicts: TableRowConflict[];
}

/**
 * Deterministically checks if two structured tables share compatible schemas
 * (same column count and >= 65% normalized header overlap) and merges them row-by-row:
 *  - Deduplicates identical rows
 *  - Appends unique rows from Table B (zero row loss)
 *  - Preserves BOTH conflicting cell values when two rows share the same primary key (col 0)
 *    and emits structured row conflict records for human review.
 */
export function mergeCompatibleTablesLossless(
  tableA: TableBlock,
  tableB: TableBlock,
  fileAName: string,
  fileBName: string
): TableMergeResult {
  const colsA = tableA.headers.length;
  const colsB = tableB.headers.length;

  if (colsA < 2 || colsA !== colsB) {
    return {
      compatible: false,
      mergedTable: tableA,
      addedRowCount: 0,
      dedupedRowCount: 0,
      rowConflicts: [],
    };
  }

  const normHeadersA = tableA.headers.map(normalizeTableCell);
  const normHeadersB = tableB.headers.map(normalizeTableCell);
  let matchingHeaders = 0;
  for (let i = 0; i < colsA; i++) {
    if (normHeadersA[i] && normHeadersA[i] === normHeadersB[i]) {
      matchingHeaders++;
    }
  }
  const headerRatio = matchingHeaders / colsA;
  if (headerRatio < 0.65) {
    return {
      compatible: false,
      mergedTable: tableA,
      addedRowCount: 0,
      dedupedRowCount: 0,
      rowConflicts: [],
    };
  }

  const mergedRows: string[][] = tableA.rows.map((r) => [...r]);
  const fullRowSignatures = new Set(
    mergedRows.map((r) => r.map(normalizeTableCell).join('||'))
  );
  const keyToRowIndex = new Map<string, number>();
  mergedRows.forEach((r, idx) => {
    const key = normalizeTableCell(r[0] || '');
    if (key && !keyToRowIndex.has(key)) {
      keyToRowIndex.set(key, idx);
    }
  });

  let addedRowCount = 0;
  let dedupedRowCount = 0;
  const rowConflicts: TableRowConflict[] = [];

  for (const rowB of tableB.rows) {
    const paddedB = rowB.slice(0, colsA);
    while (paddedB.length < colsA) paddedB.push('');
    const sigB = paddedB.map(normalizeTableCell).join('||');
    if (fullRowSignatures.has(sigB)) {
      dedupedRowCount++;
      continue;
    }

    const keyB = normalizeTableCell(paddedB[0] || '');
    const existingIdx = keyB ? keyToRowIndex.get(keyB) : undefined;

    if (existingIdx !== undefined) {
      const existingRow = mergedRows[existingIdx];
      let hasAnyCellConflict = false;

      for (let col = 1; col < colsA; col++) {
        const valA = (existingRow[col] || '').trim();
        const valB = (paddedB[col] || '').trim();
        const normA = normalizeTableCell(valA);
        const normB = normalizeTableCell(valB);

        if (!normB || normA === normB) continue;
        if (!normA) {
          existingRow[col] = valB;
        } else if (!normA.includes(normB) && !normB.includes(normA)) {
          hasAnyCellConflict = true;
          rowConflicts.push({
            rowKey: existingRow[0] || paddedB[0] || `ردیف ${existingIdx + 1}`,
            columnHeader: tableA.headers[col] || `ستون ${col + 1}`,
            valueA: valA,
            valueB: valB,
          });
          // Lossless preservation of both narratives directly inside the cell!
          existingRow[col] = `${valA} (${fileAName}) / ${valB} (${fileBName})`;
        } else if (normB.length > normA.length) {
          // Strict superset elaboration -> keep richer cell text
          existingRow[col] = valB;
        }
      }

      if (!hasAnyCellConflict) {
        dedupedRowCount++;
      }
      fullRowSignatures.add(existingRow.map(normalizeTableCell).join('||'));
    } else {
      mergedRows.push(paddedB);
      fullRowSignatures.add(sigB);
      if (keyB) keyToRowIndex.set(keyB, mergedRows.length - 1);
      addedRowCount++;
    }
  }

  return {
    compatible: true,
    mergedTable: {
      ...tableA,
      caption: tableA.caption || tableB.caption,
      rows: mergedRows,
      sourceFileNames: Array.from(
        new Set([...(tableA.sourceFileNames || [fileAName]), ...(tableB.sourceFileNames || [fileBName])])
      ),
    },
    addedRowCount,
    dedupedRowCount,
    rowConflicts,
  };
}

// ============================================================================
// 4. DETERMINISTIC ZERO-HALLUCINATION ECU TECHNICAL ENTITY INTEGRITY GATE
// ============================================================================

export interface ExtractedTechnicalEntities {
  hexAddresses: string[];
  dtcCodes: string[];
  ecuModels: string[];
  mapIdentifiers: string[];
}

export interface TechnicalIntegrityAuditReport {
  checkedAt: string;
  totalEntitiesInSources: number;
  preservedEntitiesCount: number;
  retentionPercent: number;
  missingEntities: string[];
  counts: {
    hexAddresses: number;
    dtcCodes: number;
    ecuModels: number;
    mapIdentifiers: number;
  };
  samples: {
    hexAddresses: string[];
    dtcCodes: string[];
    ecuModels: string[];
    mapIdentifiers: string[];
  };
}

const KNOWN_ECU_MAP_NAMES_RX =
  /\b(?:KFZW2?|KFZWOP2?|KFZWMS|LAMFA|KFLBTS|KFMIRL|KFMIOP|LDRXN|KFLDHBN|KFLDIMX|KFLDRL|KFPED|KFVPDKSD|NMAX(?:OG)?|VMAX|KRKTE|TVUB|TEMIN|KFFWL|KFLF|FKKVS|KFKHFM|MLHFM|ESKONF|CDKAT|CWDLSAHK|CWKONLS|SOI|EOI|IQ|DW|SMOKE|SVBL|N75|EGR|DPF|IMMO)\b/g;

const KNOWN_ECU_MODEL_CODES_RX =
  /\b(?:ME\s?7\.4\.[459]|ME\s?17(?:\.\d+){1,2}|MED\s?17(?:\.\d+){1,2}|EDC\s?17[A-Z0-9]{0,5}|M\s?7\.9\.7|SIM2K(?:-\d{2,3})?|S2000(?:-[A-Z0-9]+)?|J34P?|J35|EMS\s?\d{3,4}[A-Z]?|SSAT|LZNF|MAW|PL4)\b/gi;

export function extractTechnicalEntities(text: string): ExtractedTechnicalEntities {
  const ascii = toAsciiDigits(text || '');
  const hexSet = new Set<string>();
  const dtcSet = new Set<string>();
  const ecuSet = new Set<string>();
  const mapSet = new Set<string>();

  for (const m of ascii.matchAll(/\b0x[0-9A-Fa-f]{2,8}\b/g)) {
    hexSet.add(m[0].toUpperCase().replace(/^0X/, '0x'));
  }
  for (const m of ascii.matchAll(/\b[PCBU][0-3][0-9A-Fa-f]{3}\b/g)) {
    dtcSet.add(m[0].toUpperCase());
  }
  for (const m of ascii.matchAll(KNOWN_ECU_MODEL_CODES_RX)) {
    ecuSet.add(m[0].toUpperCase().replace(/\s+/g, ''));
  }
  for (const m of ascii.matchAll(KNOWN_ECU_MAP_NAMES_RX)) {
    mapSet.add(m[0].toUpperCase());
  }

  return {
    hexAddresses: Array.from(hexSet).sort(),
    dtcCodes: Array.from(dtcSet).sort(),
    ecuModels: Array.from(ecuSet).sort(),
    mapIdentifiers: Array.from(mapSet).sort(),
  };
}

function collectBookAllText(book: ParsedBook): string {
  const parts: string[] = [book.title, book.subtitle];
  const pushBlocks = (blocks: ContentBlock[]) => {
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph':
        case 'subheading':
          parts.push(b.text);
          break;
        case 'list':
          parts.push(b.items.join('\n'));
          break;
        case 'callout':
          parts.push(b.title, ...b.paragraphs);
          break;
        case 'table':
          parts.push(b.caption || '', b.headers.join(' '), ...b.rows.map((r) => r.join(' ')));
          break;
        case 'equation':
          parts.push(b.readable, b.latex);
          break;
        case 'figure':
          parts.push(b.caption, b.description);
          break;
        case 'image':
          parts.push(b.caption);
          break;
        case 'diagram':
          parts.push(b.title, b.caption, ...b.items.map((it) => `${it.label} ${it.detail || ''}`));
          break;
        case 'web_enrichment':
          parts.push(b.title, b.summary);
          break;
        case 'conflict_note':
          parts.push(b.topic, b.excerptA, b.excerptB, b.resolutionNote || '');
          break;
      }
    }
  };

  for (const ch of book.chapters) {
    parts.push(ch.title);
    pushBlocks(ch.introBlocks);
    for (const sec of ch.sections) {
      parts.push(sec.title);
      pushBlocks(sec.blocks);
    }
  }

  return parts.join('\n');
}

/**
 * Deterministic Post-Merge Technical Entity Integrity Gate:
 * Verifies with 0% AI involvement that EVERY hex address, DTC fault code, ECU model,
 * and calibration map name present in the raw source files survived into the final merged book.
 */
export function runTechnicalEntityIntegrityAudit(
  sourceTexts: string[],
  finalBook: ParsedBook
): TechnicalIntegrityAuditReport {
  const sourceEntities = extractTechnicalEntities(sourceTexts.join('\n'));
  const outputEntities = extractTechnicalEntities(collectBookAllText(finalBook));

  const outAll = new Set([
    ...outputEntities.hexAddresses,
    ...outputEntities.dtcCodes,
    ...outputEntities.ecuModels,
    ...outputEntities.mapIdentifiers,
  ]);

  const srcAll = [
    ...sourceEntities.hexAddresses,
    ...sourceEntities.dtcCodes,
    ...sourceEntities.ecuModels,
    ...sourceEntities.mapIdentifiers,
  ];

  const missingEntities = srcAll.filter((e) => !outAll.has(e));
  const totalEntitiesInSources = srcAll.length;
  const preservedEntitiesCount = totalEntitiesInSources - missingEntities.length;
  const retentionPercent =
    totalEntitiesInSources === 0
      ? 100
      : Math.round((preservedEntitiesCount / totalEntitiesInSources) * 100);

  return {
    checkedAt: new Date().toISOString(),
    totalEntitiesInSources,
    preservedEntitiesCount,
    retentionPercent,
    missingEntities,
    counts: {
      hexAddresses: sourceEntities.hexAddresses.length,
      dtcCodes: sourceEntities.dtcCodes.length,
      ecuModels: sourceEntities.ecuModels.length,
      mapIdentifiers: sourceEntities.mapIdentifiers.length,
    },
    samples: {
      hexAddresses: sourceEntities.hexAddresses.slice(0, 6),
      dtcCodes: sourceEntities.dtcCodes.slice(0, 6),
      ecuModels: sourceEntities.ecuModels.slice(0, 6),
      mapIdentifiers: sourceEntities.mapIdentifiers.slice(0, 6),
    },
  };
}
