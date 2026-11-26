import type { HarnessSourceChunk, SemanticBlock, SemanticSectionIR } from './types.ts';

export interface MaskedTokensResult {
  maskedText: string;
  tokenMap: Map<string, string>; // e.g. "[[HEX_IMMUTABLE_001]]" -> "0x1A4F0"
  reverseMap: Map<string, string>; // e.g. "0x1A4F0" -> "[[HEX_IMMUTABLE_001]]"
  totalMasked: number;
}

const HEX_ADDRESS_RX = /(?:0[xX][0-9A-Fa-f]{2,8}|\$[0-9A-Fa-f]{3,8})\b/g;
const DTC_FAULT_CODE_RX = /\b[PBCU][0-3][0-9A-Fa-f]{3}\b/g;
const CALIBRATION_SCALE_RX = /\b(?:(?:Factor|ضریب|Offset|آفست)\s*[:=]\s*[-+]?\d+(?:\.\d+)?)\b/gi;
const LEFTOVER_IMMUTABLE_TOKEN_RX = /\[\[(?:HEX|DTC|SCALE)_IMMUTABLE_\d{3}\]\]/g;

/**
 * Deterministically masks hex addresses, DTC fault codes, and calibration scaling factors
 * with immutable symbolic tokens (e.g. [[HEX_IMMUTABLE_001]]) before sending to LLM.
 * Guarantees zero numeric drift or hallucination on critical ECU calibration parameters.
 */
export function maskTechnicalTokens(text: string): MaskedTokensResult {
  if (!text) {
    return {
      maskedText: '',
      tokenMap: new Map(),
      reverseMap: new Map(),
      totalMasked: 0,
    };
  }

  const tokenMap = new Map<string, string>();
  const reverseMap = new Map<string, string>();

  let hexCounter = 1;
  let dtcCounter = 1;
  let scaleCounter = 1;

  // 1. Mask Hex addresses
  let masked = text.replace(HEX_ADDRESS_RX, (match) => {
    const existing = reverseMap.get(match);
    if (existing) return existing;
    const token = `[[HEX_IMMUTABLE_${String(hexCounter++).padStart(3, '0')}]]`;
    tokenMap.set(token, match);
    reverseMap.set(match, token);
    return token;
  });

  // 2. Mask DTC codes (P0135, P0300, etc.)
  masked = masked.replace(DTC_FAULT_CODE_RX, (match) => {
    const existing = reverseMap.get(match);
    if (existing) return existing;
    const token = `[[DTC_IMMUTABLE_${String(dtcCounter++).padStart(3, '0')}]]`;
    tokenMap.set(token, match);
    reverseMap.set(match, token);
    return token;
  });

  // 3. Mask calibration factors & offsets
  masked = masked.replace(CALIBRATION_SCALE_RX, (match) => {
    const existing = reverseMap.get(match);
    if (existing) return existing;
    const token = `[[SCALE_IMMUTABLE_${String(scaleCounter++).padStart(3, '0')}]]`;
    tokenMap.set(token, match);
    reverseMap.set(match, token);
    return token;
  });

  return {
    maskedText: masked,
    tokenMap,
    reverseMap,
    totalMasked: tokenMap.size,
  };
}

/**
 * Masks an array of HarnessSourceChunks using a single unified token map
 * so identical hex/DTC/scale tokens map to the same immutable token across chunks.
 */
export function maskSourceChunks(chunks: HarnessSourceChunk[]): {
  maskedChunks: HarnessSourceChunk[];
  tokenMap: Map<string, string>;
  reverseMap: Map<string, string>;
  totalMasked: number;
} {
  const tokenMap = new Map<string, string>();
  const reverseMap = new Map<string, string>();
  let hexCounter = 1;
  let dtcCounter = 1;
  let scaleCounter = 1;

  const maskChunkString = (text: string): string => {
    if (!text) return '';
    let masked = text.replace(HEX_ADDRESS_RX, (match) => {
      const existing = reverseMap.get(match);
      if (existing) return existing;
      const token = `[[HEX_IMMUTABLE_${String(hexCounter++).padStart(3, '0')}]]`;
      tokenMap.set(token, match);
      reverseMap.set(match, token);
      return token;
    });
    masked = masked.replace(DTC_FAULT_CODE_RX, (match) => {
      const existing = reverseMap.get(match);
      if (existing) return existing;
      const token = `[[DTC_IMMUTABLE_${String(dtcCounter++).padStart(3, '0')}]]`;
      tokenMap.set(token, match);
      reverseMap.set(match, token);
      return token;
    });
    masked = masked.replace(CALIBRATION_SCALE_RX, (match) => {
      const existing = reverseMap.get(match);
      if (existing) return existing;
      const token = `[[SCALE_IMMUTABLE_${String(scaleCounter++).padStart(3, '0')}]]`;
      tokenMap.set(token, match);
      reverseMap.set(match, token);
      return token;
    });
    return masked;
  };

  const maskedChunks = chunks.map((c) => ({
    ...c,
    text: maskChunkString(c.text),
  }));

  return {
    maskedChunks,
    tokenMap,
    reverseMap,
    totalMasked: tokenMap.size,
  };
}

/**
 * Restores original hex addresses, DTC codes, and DAMOS factors from the tokenMap.
 */
export function unmaskTechnicalTokens(
  text: string,
  tokenMap: Map<string, string>
): string {
  if (!text || tokenMap.size === 0) return text || '';
  let restored = text;
  for (const [token, originalVal] of tokenMap.entries()) {
    // Replace all occurrences of the immutable token with original value
    restored = restored.split(token).join(originalVal);
  }
  return restored;
}

/**
 * Recursively unmasks all text fields inside a SemanticBlock.
 */
export function unmaskSemanticBlock(
  block: SemanticBlock,
  tokenMap: Map<string, string>
): SemanticBlock {
  if (tokenMap.size === 0) return block;

  const copy = { ...block };
  if (copy.title) copy.title = unmaskTechnicalTokens(copy.title, tokenMap);
  if (copy.text) copy.text = unmaskTechnicalTokens(copy.text, tokenMap);
  if (copy.caption) copy.caption = unmaskTechnicalTokens(copy.caption, tokenMap);
  if (copy.readable) copy.readable = unmaskTechnicalTokens(copy.readable, tokenMap);
  if (copy.latex) copy.latex = unmaskTechnicalTokens(copy.latex, tokenMap);
  if (copy.gapReason) copy.gapReason = unmaskTechnicalTokens(copy.gapReason, tokenMap);
  if (copy.missingInfo) copy.missingInfo = unmaskTechnicalTokens(copy.missingInfo, tokenMap);
  if (copy.conflictTopic) copy.conflictTopic = unmaskTechnicalTokens(copy.conflictTopic, tokenMap);
  if (copy.conflictSourceA) copy.conflictSourceA = unmaskTechnicalTokens(copy.conflictSourceA, tokenMap);
  if (copy.conflictSourceB) copy.conflictSourceB = unmaskTechnicalTokens(copy.conflictSourceB, tokenMap);

  if (Array.isArray(copy.items)) {
    copy.items = copy.items.map((item) => unmaskTechnicalTokens(item, tokenMap));
  }
  if (Array.isArray(copy.headers)) {
    copy.headers = copy.headers.map((h) => unmaskTechnicalTokens(h, tokenMap));
  }
  if (Array.isArray(copy.rows)) {
    copy.rows = copy.rows.map((row) =>
      Array.isArray(row)
        ? row.map((cell) => unmaskTechnicalTokens(cell, tokenMap))
        : row
    );
  }

  return copy;
}

/**
 * Re-hydrates verified authentic hex & calibration parameters across an entire SemanticSectionIR.
 */
export function unmaskSemanticSectionIR(
  ir: SemanticSectionIR,
  tokenMap: Map<string, string>
): SemanticSectionIR {
  if (tokenMap.size === 0) return ir;

  return {
    ...ir,
    title: unmaskTechnicalTokens(ir.title, tokenMap),
    blocks: ir.blocks.map((block) => unmaskSemanticBlock(block, tokenMap)),
  };
}

/**
 * Verifies that all immutable tokens injected into the prompt were preserved by the model.
 * Returns missing tokens if any model hallucination or deletion occurred.
 */
export function auditPreservedImmutableTokens(
  generatedText: string,
  tokenMap: Map<string, string>
): { passed: boolean; missingTokens: string[] } {
  if (tokenMap.size === 0) return { passed: true, missingTokens: [] };

  const missingTokens: string[] = [];
  for (const token of tokenMap.keys()) {
    if (!generatedText.includes(token)) {
      missingTokens.push(token);
    }
  }

  return {
    passed: missingTokens.length === 0,
    missingTokens,
  };
}

/**
 * Detects any un-restored or hallucinated [[HEX|DTC|SCALE_IMMUTABLE_NNN]] placeholders
 * remaining in unmasked text or serialized SemanticSectionIR.
 */
export function findLeftoverImmutableTokens(text: string): string[] {
  if (!text) return [];
  const matches = text.match(LEFTOVER_IMMUTABLE_TOKEN_RX) || [];
  return Array.from(new Set(matches));
}
