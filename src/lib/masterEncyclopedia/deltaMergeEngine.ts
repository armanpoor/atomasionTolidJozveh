import crypto from 'node:crypto';
import {
  createMasterChapter,
  createMasterConflict,
  createMasterKnowledgeUnit,
  createMasterUnitRevision,
  createMasterVolume,
  listMasterChapters,
  listMasterKnowledgeUnits,
  listMasterVolumes,
  recalculateVolumeAndChapterStats,
  updateMasterKnowledgeUnit,
  upsertMasterCanonicalEntity,
  type MasterChapterRow,
  type MasterKnowledgeUnitRow,
  type MasterVolumeRow,
} from '../../db/masterEncyclopediaRepository.ts';
import { computeSha256Hex } from './automotiveGatekeeper.ts';
import {
  areMeasurementsEquivalent,
  classifyAutomotiveContent,
  extractPhysicalMeasurements,
  getAutomotiveDomainDefinition,
  normalizeAutomotiveEntityKey,
  resolveCanonicalAutomotiveEntity,
  resolveCanonicalAutomotiveEntityFunnel,
  type AutomotiveDomainId,
} from './automotiveDomainEngine.ts';
import { mergeMultiPageBrokenTables } from './multimodalExtractors.ts';
import {
  detectIndirectPromptInjection,
  sanitizePiiWithAutomotiveAllowlist,
} from './privacyAndSecurity.ts';
import {
  evaluateAutomotivePhysicalGuards,
  type AutomotivePhysicalGuardIssue,
} from './telemetryAnalyzer.ts';
import {
  buildPostIngestProjectHealthReport,
  runSmartClusteringAndCrossReferenceRouting,
  type ProjectHealthMonitorReport,
  type SmartClusteringAndRoutingResult,
} from './smartClusteringAndHealthMonitor.ts';

export type ConflictClassificationType =
  | 'explicit_numeric'
  | 'implicit_conditional'
  | 'protocol_or_year_mismatch';

export type MasterEvidenceTier =
  | 'a2l_xdf_verified'
  | 'verified_datalog_dyno'
  | 'text_or_screenshot_reported'
  | 'pattern_candidate';

export type ContextScopeRelation =
  | 'EXACT_SCOPE_MATCH'
  | 'WILDCARD_SUBSET_OVERLAP'
  | 'CONDITIONAL_VARIANT_SCOPE'
  | 'DISJOINT_PLATFORM_SCOPE';

export type DeltaMergeDecisionState =
  | 'EXACT_CORROBORATION'
  | 'CONDITIONAL_COMPLEMENT'
  | 'TIER_PROTECTED_SKIP'
  | 'SUPERSEDED_REVISION'
  | 'HARD_CONFLICT';

export interface AutomotiveContextScope {
  canonicalEntityId?: string;
  ecuPlatform?: string;
  engineCode?: string;
  fuelSystemType?: 'PFI' | 'GDI' | 'CRDi' | 'CNG_BIFUEL';
  fuelOctaneOrType?: string;
  hardwareStage?: 'STOCK' | 'STAGE_1' | 'STAGE_2' | 'STAGE_3';
  aspiration?: 'NA' | 'TURBO';
  emissionOrProtocol?: string;
  softwareVersion?: string;
}

const EVIDENCE_TIER_RANK: Record<MasterEvidenceTier, { rank: number; weight: number }> = {
  a2l_xdf_verified: { rank: 4, weight: 1.0 },
  verified_datalog_dyno: { rank: 3, weight: 0.85 },
  text_or_screenshot_reported: { rank: 2, weight: 0.65 },
  pattern_candidate: { rank: 1, weight: 0.4 },
};

export function getEvidenceTierInfo(tier?: string | null): {
  tier: MasterEvidenceTier;
  rank: number;
  weight: number;
} {
  if (tier && tier in EVIDENCE_TIER_RANK) {
    const validTier = tier as MasterEvidenceTier;
    return { tier: validTier, ...EVIDENCE_TIER_RANK[validTier] };
  }
  return { tier: 'text_or_screenshot_reported', ...EVIDENCE_TIER_RANK.text_or_screenshot_reported };
}

/**
 * Extracts canonicalized automotive ContextScope from Persian/English technical prose.
 * Passes entity tokens through the 4-Stage Canonical Entity Resolution Funnel first
 * so aliases like "TU5", "NFU", "TU5JP4", "بوش ۷.۴.۴", and "۲۰۶ تیپ ۵" unify cleanly.
 */
export function extractAutomotiveContextScope(text: string): AutomotiveContextScope {
  const raw = text || '';
  const funnelMatch = resolveCanonicalAutomotiveEntityFunnel(raw);
  const scope: AutomotiveContextScope = {};

  if (funnelMatch?.entity) {
    scope.canonicalEntityId = funnelMatch.entity.id;
    if (funnelMatch.entity.entityType === 'ecu') {
      scope.ecuPlatform = funnelMatch.entity.id;
    } else if (funnelMatch.entity.entityType === 'engine') {
      scope.engineCode = funnelMatch.entity.id;
    }
  }

  // Extract explicit engine code and canonicalize via funnel or key normalizer
  const engineMatch = raw.match(
    /\b(TU5JP4|TU5\+|TU5|NFU|EF7\s*TC|EF7|XU7JP4|XU7|M15\s*GSI|M15|EC5|N20B20|M54B30|K4M)\b|(?:موتور\s*(تی\s*یو\s*[۵5]|ای\s*اف\s*[۷7]|ایکس\s*یو\s*[۷7]|ملی))/i
  );
  if (engineMatch) {
    const resolvedEng = resolveCanonicalAutomotiveEntityFunnel(engineMatch[0]);
    scope.engineCode = resolvedEng?.entity?.id ?? normalizeAutomotiveEntityKey(engineMatch[0]);
  }

  // Extract explicit ECU code and canonicalize
  const ecuMatch = raw.match(
    /\b(ME7\.?4\.?[459]|ME17\.?9\.?7[0-9]*|MED17(?:\.[0-9]+)*|EDC17[A-Z0-9._-]*|SIM2K(?:[-_]?[0-9A-Z]+)?|EMS313[024]|J34P?|S2000|MS43|SSAT|KESENS|MAW)\b|(?:بوش\s*[۷7]\.?[۴4]\.?[۴۵۹459]|بوش\s*ام\s*ای\s*[۱1][۷7]|زیمنس\s*سیم\s*دو\s*کا|والئو\s*جی\s*[۳3][۴4]|ساژم\s*اس\s*[۲2][۰0]{3})/i
  );
  if (ecuMatch) {
    const resolvedEcu = resolveCanonicalAutomotiveEntityFunnel(ecuMatch[0]);
    scope.ecuPlatform = resolvedEcu?.entity?.id ?? normalizeAutomotiveEntityKey(ecuMatch[0]);
  }

  // Fuel system type
  if (/\b(?:CRDi|Common\s*Rail)\b|کامن[\s\u200c]*ریل|دیزل/i.test(raw)) {
    scope.fuelSystemType = 'CRDi';
  } else if (/\b(?:GDI|TGDI|FSI|TFSI|HPFP)\b|پاشش\s*مستقیم/i.test(raw)) {
    scope.fuelSystemType = 'GDI';
  } else if (/\b(?:PFI|MPFI|MPI)\b|پاشش\s*منیفولد|پاشش\s*چند[\s\u200c]*نقطه/i.test(raw)) {
    scope.fuelSystemType = 'PFI';
  } else if (/\b(?:CNG|Bi-?Fuel)\b|دوگانه[\s\u200c]*سوز|گازسوز/i.test(raw)) {
    scope.fuelSystemType = 'CNG_BIFUEL';
  }

  // Fuel octane / fuel grade
  if (/(?:اکتان\s*(?:۹۸|98)|octane\s*98|ron\s*98|بنزین\s*سوپر)/i.test(raw)) {
    scope.fuelOctaneOrType = 'RON_98_SUPER';
  } else if (/(?:اکتان\s*(?:۹۵|95)|octane\s*95|ron\s*95)/i.test(raw)) {
    scope.fuelOctaneOrType = 'RON_95';
  } else if (/(?:اکتان\s*(?:۸۷|87|۹۱|91)|بنزین\s*معمولی)/i.test(raw)) {
    scope.fuelOctaneOrType = 'RON_REGULAR';
  } else if (/\bE85\b|اتانول/i.test(raw)) {
    scope.fuelOctaneOrType = 'E85';
  }

  // Hardware / tuning stage
  if (/\bstage\s*3\b|استیج\s*[۳3]/i.test(raw)) {
    scope.hardwareStage = 'STAGE_3';
  } else if (/\bstage\s*2\b|استیج\s*[۲2]/i.test(raw)) {
    scope.hardwareStage = 'STAGE_2';
  } else if (/\bstage\s*1\b|استیج\s*[۱1]/i.test(raw)) {
    scope.hardwareStage = 'STAGE_1';
  } else if (/(?:فابریک|استاندارد\s*کارخانه|\bstock\b)/i.test(raw)) {
    scope.hardwareStage = 'STOCK';
  }

  // Aspiration
  if (/(?:توربوشارژر|توربو|\bturbo\b|\bEF7\s*TC\b)/i.test(raw)) {
    scope.aspiration = 'TURBO';
  } else if (/(?:تنفس\s*طبیعی|\bnaturally\s*aspirated\b|\bNA\b)/i.test(raw)) {
    scope.aspiration = 'NA';
  }

  // Emission or diagnostic protocol
  const protoMatch = raw.match(
    /\b(Euro\s*[3456]|OBDonUDS|OBD-?II|OBD2|CAN-?FD|SAE\s*J1979-2)\b|یورو\s*([۳۴۵۶3456])/i
  );
  if (protoMatch) {
    scope.emissionOrProtocol = normalizeAutomotiveEntityKey(protoMatch[0]);
  }

  // Software version (Bosch 1037/1039 or SW tag)
  const swMatch = raw.match(/\b((?:1037|1039)\d{6})\b/);
  if (swMatch) {
    scope.softwareVersion = swMatch[1];
  }

  return scope;
}

/**
 * Conservative ContextScope reconciliation (Fixes Bug #1 from Deep Research Audit):
 * - First normalizes entity & engine/ECU identifiers via the Canonical Entity Funnel.
 * - If a field in `a` or `b` is `undefined`, it is treated as a WILDCARD (`WILDCARD_SUBSET_OVERLAP`),
 *   NEVER as `DISJOINT_PLATFORM_SCOPE`!
 * - Returns `DISJOINT_PLATFORM_SCOPE` ONLY when BOTH `a` and `b` explicitly specify different,
 *   non-overlapping canonical ECU platforms or engines (e.g., `ECU:BOSCH_ME7.4.4` vs `ECU:SIEMENS_SIM2K`).
 */
export function compareContextScopes(
  a: AutomotiveContextScope,
  b: AutomotiveContextScope
): ContextScopeRelation {
  // 1. Check platform / entity disjointness ONLY when both sides explicitly define the field
  const bothHaveCanonical =
    Boolean(a.canonicalEntityId) &&
    Boolean(b.canonicalEntityId) &&
    a.canonicalEntityId !== b.canonicalEntityId;
  const bothHaveEcu =
    Boolean(a.ecuPlatform) && Boolean(b.ecuPlatform) && a.ecuPlatform !== b.ecuPlatform;
  const bothHaveEngine =
    Boolean(a.engineCode) && Boolean(b.engineCode) && a.engineCode !== b.engineCode;

  if (bothHaveEcu || bothHaveEngine || (bothHaveCanonical && !a.engineCode && !b.engineCode)) {
    return 'DISJOINT_PLATFORM_SCOPE';
  }

  // 2. Check explicit conditional qualifiers (stage, fuel octane, fuel system, protocol, SW version)
  const conditionKeys: ReadonlyArray<keyof AutomotiveContextScope> = [
    'fuelSystemType',
    'fuelOctaneOrType',
    'hardwareStage',
    'aspiration',
    'emissionOrProtocol',
    'softwareVersion',
  ];

  let hasExplicitConditionDifference = false;
  let hasWildcardUndefined = false;

  for (const key of conditionKeys) {
    const valA = a[key];
    const valB = b[key];
    if (valA !== undefined && valB !== undefined) {
      if (valA !== valB) {
        hasExplicitConditionDifference = true;
      }
    } else if (valA !== undefined || valB !== undefined) {
      hasWildcardUndefined = true;
    }
  }

  const platformKeys: ReadonlyArray<keyof AutomotiveContextScope> = [
    'canonicalEntityId',
    'ecuPlatform',
    'engineCode',
  ];
  for (const key of platformKeys) {
    if ((a[key] !== undefined && b[key] === undefined) || (a[key] === undefined && b[key] !== undefined)) {
      hasWildcardUndefined = true;
    }
  }

  if (hasExplicitConditionDifference) {
    return 'CONDITIONAL_VARIANT_SCOPE';
  }
  if (hasWildcardUndefined) {
    return 'WILDCARD_SUBSET_OVERLAP';
  }
  return 'EXACT_SCOPE_MATCH';
}

/**
 * 5-State Delta-Merge Decision Matrix combining 4-Tier Evidence Hierarchy,
 * ContextScope relationship, and physical unit equivalence.
 */
export function resolveDeltaMergeDecisionMatrix(params: {
  existingTier?: string | null;
  incomingTier?: string | null;
  scopeRelation: ContextScopeRelation;
  hasMeasurementConflict: boolean;
  equivalentPhysicalCorroboration: boolean;
  similarityScore: number;
  exactHashMatch: boolean;
}): {
  decision: DeltaMergeDecisionState;
  reasonFa: string;
} {
  const existingEv = getEvidenceTierInfo(params.existingTier);
  const incomingEv = getEvidenceTierInfo(params.incomingTier);

  if (
    params.exactHashMatch ||
    (!params.hasMeasurementConflict &&
      (params.similarityScore >= 0.8 ||
        (params.equivalentPhysicalCorroboration && params.similarityScore >= 0.35)))
  ) {
    return {
      decision: 'EXACT_CORROBORATION',
      reasonFa: 'تأیید متقابل یا هم‌ارزی فیزیکی واحدها (بدون تعارض عددی)',
    };
  }

  if (params.hasMeasurementConflict) {
    // Protect Tier 1 (.a2l/.xdf) or Tier 2 (verified datalog/dyno) against Tier 4 (pattern_candidate) overwrite
    if (existingEv.rank >= 3 && incomingEv.rank === 1) {
      return {
        decision: 'TIER_PROTECTED_SKIP',
        reasonFa: `حفاظت سلسله‌مراتب شواهد: واحد موجود دارای سطح سند بالاتر (${existingEv.tier}) نسبت به ورودی حدسی (${incomingEv.tier}) است.`,
      };
    }
    if (incomingEv.rank > existingEv.rank && existingEv.rank === 1) {
      return {
        decision: 'SUPERSEDED_REVISION',
        reasonFa: `ارتقای سطح شواهد از ${existingEv.tier} به ${incomingEv.tier} با ثبت در جدول تعارض‌ها`,
      };
    }
    if (params.scopeRelation === 'CONDITIONAL_VARIANT_SCOPE') {
      return {
        decision: 'CONDITIONAL_COMPLEMENT',
        reasonFa: 'تفاوت قید شرطی صریح (اکتان/استیج/پروتکل/پاشش) روی پلتفرم مشترک',
      };
    }
    return {
      decision: 'HARD_CONFLICT',
      reasonFa: 'تعارض عددی مستقیم روی دامنه فنی و Scope هم‌پوشان',
    };
  }

  return {
    decision: 'CONDITIONAL_COMPLEMENT',
    reasonFa: 'تکمیل بدون افت (Lossless Union) اطلاعات فنی هم‌پوشان',
  };
}

export interface CandidateMatchResult {
  unit: MasterKnowledgeUnitRow;
  similarityScore: number;
  exactHashMatch: boolean;
  sharedTechnicalCodes: string[];
  scopeRelation?: ContextScopeRelation;
}

export interface DeltaMergeIngestInput {
  ingestBatchId: string;
  sourceUploadHash: string;
  sourceFileName: string;
  rawText: string;
  submittedByRole: 'owner' | 'user' | 'guest';
  submitterSessionHash: string;
  evidenceTier?: MasterEvidenceTier;
  actorEmail?: string | null;
  contributorDisplayName?: string | null;
  preferredVolumeId?: string | null;
  preferredVolumeResolver?: (domain: AutomotiveDomainId) => string | null;
}

export interface DeltaMergeIngestResult {
  newUnitsCount: number;
  duplicateUnitsCount: number;
  mergedUnitsCount: number;
  conflictsCount: number;
  stagingUnitsCount: number;
  physicalQuarantinedCount?: number;
  promptInjectionQuarantined: boolean;
  createdVolumes: string[];
  createdChapters: string[];
  modelsUsed: string[];
  summaryFa: string;
  crossReferenceRoutedCount?: number;
  phoneticCorrectionsCount?: number;
  clusteringResult?: SmartClusteringAndRoutingResult;
  projectHealthReport?: ProjectHealthMonitorReport;
}

function normalizeUnitHash(text: string): string {
  const canonical = text
    .toLowerCase()
    .replace(/[\u200c\u200f\u200e\u2066-\u2069]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return computeSha256Hex(canonical);
}

function tokenizeWords(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

function computeJaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function extractCriticalTechnicalTokens(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\b0x[0-9a-f]{3,}\b/gi, // Hex addresses
    /\b[PBCU][0-3][0-9A-F]{3}(?:-[0-9A-F]{2})?\b/gi, // 5-char OBD-II & UDS 3-Byte DTC codes (Pxxxx-xx)
    /\b(?:0261|0281|1037|1039)\d{6}\b/g, // Bosch HW/SW numbers
    /\b(?:ME7(?:\.\d+)*|ME17(?:\.\d+)*|MED17(?:\.\d+)*|EDC17[A-Z0-9]*|SIM2K[-A-Z0-9]*|MS43|KFZW2?|LAMFA|LDRXN)\b/gi,
  ];
  for (const pat of patterns) {
    const matches = text.match(pat);
    if (matches) {
      for (const m of matches) found.add(m.toUpperCase());
    }
  }
  return Array.from(found);
}

/**
 * Fast 2-Stage Localization (never passes the whole encyclopedia to LLM):
 * Stage A: Filter by domainTag or canonicalEntityId, excluding explicitly DISJOINT_PLATFORM_SCOPE units.
 * Stage B: Rank by normalizedHash, shared technical codes, and lexical Jaccard similarity -> top 5.
 */
export function localizeCandidateUnits(
  incomingText: string,
  domainTag: string,
  canonicalEntityId: string | null,
  existingUnits: MasterKnowledgeUnitRow[],
  topK = 5
): CandidateMatchResult[] {
  const incomingHash = normalizeUnitHash(incomingText);
  const incomingTokens = tokenizeWords(incomingText);
  const incomingCodes = new Set(extractCriticalTechnicalTokens(incomingText));
  const incomingScope = extractAutomotiveContextScope(incomingText);

  // Stage A: narrow scope to relevant domain or canonical entity
  const stageA = existingUnits.filter(
    (u) =>
      u.lifecycleStatus === 'active' &&
      (u.domainTag === domainTag ||
        (canonicalEntityId !== null && u.canonicalEntityId === canonicalEntityId))
  );

  // Stage B: score candidates deterministically
  const scored: CandidateMatchResult[] = [];
  for (const unit of stageA) {
    const exactHashMatch = unit.normalizedHash === incomingHash;
    const unitScope = extractAutomotiveContextScope(unit.cleanText);
    const scopeRelation = compareContextScopes(unitScope, incomingScope);

    // If two units explicitly belong to disjoint ECU/Engine platforms, never falsely match them as conflicts
    if (!exactHashMatch && scopeRelation === 'DISJOINT_PLATFORM_SCOPE') {
      continue;
    }

    const unitCodes = extractCriticalTechnicalTokens(unit.cleanText);
    const sharedTechnicalCodes = unitCodes.filter((c) => incomingCodes.has(c));
    const jaccard = computeJaccardSimilarity(incomingTokens, tokenizeWords(unit.cleanText));
    const codeBoost = Math.min(0.35, sharedTechnicalCodes.length * 0.15);
    const score = exactHashMatch ? 1 : Math.min(0.99, jaccard + codeBoost);

    if (exactHashMatch || score >= 0.25 || sharedTechnicalCodes.length > 0) {
      scored.push({
        unit,
        similarityScore: Number(score.toFixed(4)),
        exactHashMatch,
        sharedTechnicalCodes,
        scopeRelation,
      });
    }
  }

  return scored
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, topK);
}

/**
 * Classifies whether two texts about the same automotive topic have a genuine conflict
 * after normalizing physical units (Bar↔PSI, Nm↔lb-ft, Lambda↔AFR, HP↔kW).
 */
export function detectMeasurementConflict(
  existingText: string,
  incomingText: string
): {
  hasConflict: boolean;
  equivalentPhysicalCorroboration: boolean;
  conflictType?: ConflictClassificationType;
  conditionContext?: string;
  scopeRelation?: ContextScopeRelation;
} {
  const scopeA = extractAutomotiveContextScope(existingText);
  const scopeB = extractAutomotiveContextScope(incomingText);
  const scopeRelation = compareContextScopes(scopeA, scopeB);

  // If both texts explicitly specify mutually exclusive ECU/engine platforms, it is not a conflict
  if (scopeRelation === 'DISJOINT_PLATFORM_SCOPE') {
    return {
      hasConflict: false,
      equivalentPhysicalCorroboration: false,
      scopeRelation,
    };
  }

  const existingMeas = extractPhysicalMeasurements(existingText);
  const incomingMeas = extractPhysicalMeasurements(incomingText);

  if (existingMeas.length === 0 || incomingMeas.length === 0) {
    return { hasConflict: false, equivalentPhysicalCorroboration: false, scopeRelation };
  }

  let foundEquivalent = false;
  let foundDivergent = false;

  for (const em of existingMeas) {
    const sameQty = incomingMeas.filter((im) => im.quantity === em.quantity);
    if (sameQty.length === 0) continue;
    const anyEq = sameQty.some((im) => areMeasurementsEquivalent(em, im));
    if (anyEq) {
      foundEquivalent = true;
    } else {
      foundDivergent = true;
    }
  }

  if (!foundDivergent) {
    return {
      hasConflict: false,
      equivalentPhysicalCorroboration: foundEquivalent,
      scopeRelation,
    };
  }

  const combined = `${existingText}\n${incomingText}`;

  // Detect protocol / year / emission standard mismatch
  if (
    /(?:euro\s*[456]|یورو\s*[۴۵۶456]|obd2|obdonuds|can-?fd|199\d|20[012]\d|مدل\s*۱۳\d{2}|مدل\s*۱۴\d{2})/i.test(
      combined
    )
  ) {
    return {
      hasConflict: true,
      equivalentPhysicalCorroboration: false,
      conflictType: 'protocol_or_year_mismatch',
      conditionContext: 'تفاوت پروتکل، استاندارد آلایندگی یا سال ساخت خودرو',
      scopeRelation,
    };
  }

  // Detect implicit conditional differences (PFI vs GDI, octane 95 vs 98, turbo vs NA, altitude/temp)
  if (
    scopeRelation === 'CONDITIONAL_VARIANT_SCOPE' ||
    /(?:اکتان|octane|pfi|gdi|crdi|توربو|تنفس\s*طبیعی|بنزین\s*سوپر|بنزین\s*معمولی|بنزین|گاز|cng|stage\s*[123]|استیج\s*[۱۲۳123]|بار\s*جزئی|بار\s*کامل|cold|hot)/i.test(
      combined
    )
  ) {
    return {
      hasConflict: true,
      equivalentPhysicalCorroboration: false,
      conflictType: 'implicit_conditional',
      conditionContext: 'تفاوت شرایط فنی (نوع سوخت/اکتان، ساختار پاشش PFI/GDI یا سطح تیونینگ)',
      scopeRelation,
    };
  }

  return {
    hasConflict: true,
    equivalentPhysicalCorroboration: false,
    conflictType: 'explicit_numeric',
    conditionContext: 'اختلاف عددی صریح بین دو منبع فنی برای یک پارامتر مشترک',
    scopeRelation,
  };
}

/**
 * Lossless union merge of two overlapping Persian/English technical units.
 * Guarantees 100% retention of all numbers, hex addresses, and DTC codes from both sources.
 */
export function buildLosslessUnionText(existingText: string, incomingText: string): {
  mergedText: string;
  allNumbersPreserved: boolean;
} {
  const existingSentences = existingText
    .split(/(?<=[.!؟\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const incomingSentences = incomingText
    .split(/(?<=[.!؟\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const merged = [...existingSentences];
  const existingNormSet = new Set(existingSentences.map((s) => normalizeUnitHash(s)));

  for (const sent of incomingSentences) {
    const h = normalizeUnitHash(sent);
    if (!existingNormSet.has(h)) {
      // Also avoid near-exact sentence duplicates
      const sentTokens = tokenizeWords(sent);
      const alreadyCovered = existingSentences.some(
        (es) => computeJaccardSimilarity(sentTokens, tokenizeWords(es)) >= 0.85
      );
      if (!alreadyCovered) {
        merged.push(sent);
        existingNormSet.add(h);
      }
    }
  }

  const mergedText = merged.join('\n');

  // Verify 100% numeric & hex token retention
  const requiredTokens = new Set([
    ...extractCriticalTechnicalTokens(existingText),
    ...extractCriticalTechnicalTokens(incomingText),
  ]);
  const upperMerged = mergedText.toUpperCase();
  let allNumbersPreserved = true;
  for (const tok of requiredTokens) {
    if (!upperMerged.includes(tok)) {
      allNumbersPreserved = false;
      break;
    }
  }

  return { mergedText, allNumbersPreserved };
}

interface ParsedIncomingSection {
  chapterTitle: string;
  bodyText: string;
  blockType: 'paragraph' | 'table' | 'callout';
}

/**
 * Splits incoming clean Markdown into structured semantic knowledge units preserving headings and tables.
 */
export function splitMarkdownIntoKnowledgeSections(markdown: string): ParsedIncomingSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ParsedIncomingSection[] = [];
  let currentHeading = 'مفاهیم و داده‌های فنی خودرو';
  let buffer: string[] = [];

  const flushBuffer = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text.length < 18) return;
    const isTable = text.split('\n').filter((l) => l.trim().startsWith('|')).length >= 2;
    const isCallout = text.trim().startsWith('>');
    sections.push({
      chapterTitle: currentHeading,
      bodyText: text,
      blockType: isTable ? 'table' : isCallout ? 'callout' : 'paragraph',
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      flushBuffer();
      currentHeading = headingMatch[1].trim().slice(0, 140);
      continue;
    }
    if (line.trim() === '' && buffer.length > 0) {
      // Keep tables intact across single lines; split long paragraphs cleanly
      const prevLine = buffer[buffer.length - 1] ?? '';
      if (!prevLine.trim().startsWith('|')) {
        flushBuffer();
        continue;
      }
    }
    buffer.push(line);
  }
  flushBuffer();

  return sections;
}

async function resolveOrCreateVolumeForDomain(
  domainId: AutomotiveDomainId,
  incomingWords: number,
  createdVolumes: string[],
  preferredVolumeId?: string | null,
  cachedVolumes?: MasterVolumeRow[]
): Promise<MasterVolumeRow> {
  const def = getAutomotiveDomainDefinition(domainId);
  const existingVolumes = cachedVolumes ?? (await listMasterVolumes());

  if (preferredVolumeId) {
    const preferred = existingVolumes.find((v) => v.id === preferredVolumeId);
    if (preferred) {
      return preferred;
    }
  }

  const matchingVolumes = existingVolumes
    .filter((v) => v.automotiveDomain === domainId)
    .sort((a, b) => a.volumeNumber - b.volumeNumber);

  const latestMatching = matchingVolumes[matchingVolumes.length - 1];
  if (latestMatching) {
    const projectedWords = latestMatching.wordCount + incomingWords;
    const projectedPages = Math.ceil(projectedWords / 300);
    // Check Volume Split Threshold -> propose a new draft_proposal volume when exceeded
    if (
      projectedWords > latestMatching.splitThresholdWords ||
      projectedPages > latestMatching.splitThresholdPages
    ) {
      const nextNum =
        existingVolumes.reduce((max, v) => Math.max(max, v.volumeNumber), 0) + 1;
      const proposal = await createMasterVolume({
        volumeNumber: nextNum,
        title: `${def.titleFa} — بخش تکمیلی (پیشنهاد جلد جدید)`,
        automotiveDomain: domainId,
        status: 'draft_proposal',
        splitThresholdPages: latestMatching.splitThresholdPages,
        splitThresholdWords: latestMatching.splitThresholdWords,
        description: `پیشنهاد خودکار تقسیم جلد به دلیل عبور از آستانه ${latestMatching.splitThresholdPages} صفحه / ${latestMatching.splitThresholdWords} کلمه.`,
      });
      createdVolumes.push(proposal.id);
      if (cachedVolumes) cachedVolumes.push(proposal);
      return proposal;
    }
    return latestMatching;
  }

  const usedNumbers = new Set(existingVolumes.map((v) => v.volumeNumber));
  let volNumber = def.defaultVolumeNumber;
  while (usedNumbers.has(volNumber)) {
    volNumber += 1;
  }
  const created = await createMasterVolume({
    volumeNumber: volNumber,
    title: def.titleFa,
    automotiveDomain: domainId,
    status: 'published',
  });
  createdVolumes.push(created.id);
  if (cachedVolumes) cachedVolumes.push(created);
  return created;
}

async function resolveOrCreateChapter(
  volumeId: string,
  chapterTitle: string,
  pedagogicalRank: number,
  createdChapters: string[],
  chaptersCache?: Map<string, MasterChapterRow[]>
): Promise<MasterChapterRow> {
  let chapters = chaptersCache?.get(volumeId);
  if (!chapters) {
    chapters = await listMasterChapters(volumeId);
    if (chaptersCache) chaptersCache.set(volumeId, chapters);
  }
  const normTitle = chapterTitle.trim().toLowerCase();
  const found = chapters.find((c) => c.title.trim().toLowerCase() === normTitle);
  if (found) return found;

  const created = await createMasterChapter({
    volumeId,
    title: chapterTitle,
    pedagogicalRank,
    orderIndex: chapters.length + 1,
    level: 1,
  });
  createdChapters.push(created.id);
  chapters.push(created);
  return created;
}

/**
 * Full Incremental Delta-Merge Pipeline into the Master Automotive Encyclopedia.
 * Implements:
 * - Layer 0 Prompt Injection quarantine & PII sanitization (preserving Bosch/VIN WMI+VDS)
 * - Multi-page broken table merge
 * - 4-Stage Canonical Entity Resolution Funnel + ContextScope Wildcard-Safe Reconciliation
 * - Generation-2 Zero-Token Physical & Mechanical Engineering Guards (non-destructive staging quarantine)
 * - 4-Tier Evidence Hierarchy & 5-State Decision Matrix
 * - Physical unit equivalence check (1.0 bar == 14.5 psi -> corroboration, NOT conflict)
 * - Anti-Sybil distinct-source corroboration counting & automatic staging promotion at >= 2
 * - Lossless Union merge with 100% numeric/hex audit
 * - Structured Conflict routing (`explicit_numeric` | `implicit_conditional` | `protocol_or_year_mismatch`)
 * - Atomic `master_unit_revisions` logging for 1-click Rollback Batch
 */
export async function ingestDocumentIntoMasterEncyclopedia(
  input: DeltaMergeIngestInput
): Promise<DeltaMergeIngestResult> {
  // 1. Layer 0 Indirect Prompt Injection defense
  const injectionScan = detectIndirectPromptInjection(input.rawText);

  // 2. Layer 0 PII Sanitization with Automotive Technical Allowlist + VIN last-6 masking
  const piiRes = sanitizePiiWithAutomotiveAllowlist(injectionScan.sanitizedText);

  // 3. Layer 0 Multi-page broken table merger
  const { mergedMarkdown } = mergeMultiPageBrokenTables(piiRes.sanitizedText);

  // 4. Layer 0 Smart ECU/Engine Clustering, Phonetic Normalization & Bidirectional Cross-Reference Routing (↗ / ↙)
  const clusteringResult = runSmartClusteringAndCrossReferenceRouting(
    mergedMarkdown,
    input.sourceFileName
  );

  const sections = splitMarkdownIntoKnowledgeSections(clusteringResult.rewrittenMarkdown);
  const createdVolumes: string[] = [];
  const createdChapters: string[] = [];

  let newUnitsCount = 0;
  let duplicateUnitsCount = 0;
  let mergedUnitsCount = 0;
  let conflictsCount = 0;
  let stagingUnitsCount = 0;
  let physicalQuarantinedCount = 0;

  // Distinct anti-Sybil corroboration token combines upload hash & session hash
  const independentSourceMarker = `${input.submitterSessionHash}:${input.sourceUploadHash}`;

  // Preload active units, volumes, and chapter/entity caches once per batch to avoid O(N^2) DB scans
  const [cachedUnits, cachedVolumes] = await Promise.all([
    listMasterKnowledgeUnits({ lifecycleStatus: 'active' }),
    listMasterVolumes(),
  ]);
  const chaptersCache = new Map<string, MasterChapterRow[]>();
  const upsertedEntityIds = new Set<string>();
  const syncUnitInCache = (updatedUnit: MasterKnowledgeUnitRow) => {
    const idx = cachedUnits.findIndex((u) => u.id === updatedUnit.id);
    if (idx >= 0) {
      cachedUnits[idx] = updatedUnit;
    } else {
      cachedUnits.push(updatedUnit);
    }
  };

  for (const sec of sections) {
    const classification = classifyAutomotiveContent(sec.bodyText, input.sourceFileName);
    const combinedSectionText = `${sec.chapterTitle}\n${sec.bodyText}`;
    const entitySeed = resolveCanonicalAutomotiveEntity(combinedSectionText);
    const contextScope = extractAutomotiveContextScope(combinedSectionText);
    const physicalGuardReport = evaluateAutomotivePhysicalGuards(combinedSectionText);

    if (entitySeed && !upsertedEntityIds.has(entitySeed.id)) {
      await upsertMasterCanonicalEntity({
        id: entitySeed.id,
        entityType: entitySeed.entityType,
        canonicalName: entitySeed.canonicalName,
        aliasesJson: [...entitySeed.aliases],
        domainTag: entitySeed.domainTag,
      });
      upsertedEntityIds.add(entitySeed.id);
    }

    const candidates = localizeCandidateUnits(
      sec.bodyText,
      classification.primaryDomain,
      entitySeed?.id ?? null,
      cachedUnits,
      5
    );

    const topMatch = candidates[0] ?? null;

    if (topMatch) {
      const conflictEval = detectMeasurementConflict(topMatch.unit.cleanText, sec.bodyText);
      const decisionRes = resolveDeltaMergeDecisionMatrix({
        existingTier: topMatch.unit.evidenceTier,
        incomingTier: input.evidenceTier ?? 'text_or_screenshot_reported',
        scopeRelation: conflictEval.scopeRelation ?? topMatch.scopeRelation ?? 'WILDCARD_SUBSET_OVERLAP',
        hasMeasurementConflict: conflictEval.hasConflict,
        equivalentPhysicalCorroboration: conflictEval.equivalentPhysicalCorroboration,
        similarityScore: topMatch.similarityScore,
        exactHashMatch: topMatch.exactHashMatch,
      });

      // Case 1: Real Technical Conflict (HARD_CONFLICT, CONDITIONAL_COMPLEMENT with divergent numbers, TIER_PROTECTED_SKIP, or SUPERSEDED_REVISION)
      if (conflictEval.hasConflict && topMatch.similarityScore >= 0.25) {
        await createMasterConflict({
          existingUnitId: topMatch.unit.id,
          conflictType: conflictEval.conflictType ?? 'explicit_numeric',
          topic: sec.chapterTitle,
          existingExcerpt: topMatch.unit.cleanText,
          incomingExcerpt: sec.bodyText,
          conditionContext: conflictEval.conditionContext
            ? `${conflictEval.conditionContext} [${decisionRes.decision}]`
            : decisionRes.reasonFa,
          status: 'open',
          ingestBatchId: input.ingestBatchId,
          sourceUploadHash: input.sourceUploadHash,
        });
        conflictsCount += 1;
        continue;
      }

      // Case 2: Exact / Semantic Duplicate OR Physically Equivalent Corroboration (e.g. 1.0 bar == 14.5 psi)
      if (
        decisionRes.decision === 'EXACT_CORROBORATION' ||
        topMatch.exactHashMatch ||
        topMatch.similarityScore >= 0.8 ||
        (conflictEval.equivalentPhysicalCorroboration && topMatch.similarityScore >= 0.35)
      ) {
        duplicateUnitsCount += 1;

        // Anti-Sybil: increment corroborationCount ONLY from a genuinely different session AND upload hash
        const prevHashes = topMatch.unit.distinctSourceHashesJson ?? [];
        const sameSessionAlreadyCounted = prevHashes.some(
          (entry) =>
            entry === independentSourceMarker ||
            entry.startsWith(`${input.submitterSessionHash}:`) ||
            entry === input.sourceUploadHash
        );

        if (!sameSessionAlreadyCounted) {
          const nextHashes = [...prevHashes, independentSourceMarker];
          const nextCorroboration = topMatch.unit.corroborationCount + 1;
          const existingMeta = (topMatch.unit.technicalMetadataJson ?? {}) as Record<string, unknown>;
          const hasPhysicalAnomaly =
            Array.isArray(existingMeta.physicalGuardWarnings) &&
            existingMeta.physicalGuardWarnings.length > 0;
          const shouldPromoteFromStaging =
            topMatch.unit.verificationStatus === 'staging' &&
            nextCorroboration >= 2 &&
            !hasPhysicalAnomaly;

          const prevSnapshot = structuredClone(topMatch.unit) as unknown as Record<string, unknown>;
          const updated = await updateMasterKnowledgeUnit(topMatch.unit.id, {
            corroborationCount: nextCorroboration,
            distinctSourceHashesJson: nextHashes,
            verificationStatus: shouldPromoteFromStaging
              ? 'verified'
              : topMatch.unit.verificationStatus,
          });
          if (updated) {
            syncUnitInCache(updated);
            await createMasterUnitRevision({
              ingestBatchId: input.ingestBatchId,
              unitId: updated.id,
              action: 'updated',
              previousStateJson: prevSnapshot,
              newStateJson: updated as unknown as Record<string, unknown>,
              actorEmail: input.actorEmail ?? null,
            });
          }
        }
        continue;
      }

      // Case 3: Partial Overlap -> Lossless Union + 100% numeric/hex retention audit
      if (topMatch.similarityScore >= 0.4) {
        const union = buildLosslessUnionText(topMatch.unit.cleanText, sec.bodyText);
        const prevSnapshot = structuredClone(topMatch.unit) as unknown as Record<string, unknown>;
        const prevHashes = topMatch.unit.distinctSourceHashesJson ?? [];
        const nextHashes = prevHashes.includes(independentSourceMarker)
          ? prevHashes
          : [...prevHashes, independentSourceMarker];

        const updated = await updateMasterKnowledgeUnit(topMatch.unit.id, {
          cleanText: union.mergedText,
          normalizedHash: normalizeUnitHash(union.mergedText),
          distinctSourceHashesJson: nextHashes,
          corroborationCount: Math.max(topMatch.unit.corroborationCount, nextHashes.length),
        });
        if (updated) {
          syncUnitInCache(updated);
          await createMasterUnitRevision({
            ingestBatchId: input.ingestBatchId,
            unitId: updated.id,
            action: 'merged',
            previousStateJson: prevSnapshot,
            newStateJson: updated as unknown as Record<string, unknown>,
            actorEmail: input.actorEmail ?? null,
          });
          mergedUnitsCount += 1;
        }
        continue;
      }
    }

    // Case 4: Brand New Automotive Knowledge Unit -> Route to Volume & Pedagogical Chapter
    const incomingWordCount = sec.bodyText.split(/\s+/).filter(Boolean).length;
    const resolvedPreferredVolumeId = input.preferredVolumeResolver
      ? input.preferredVolumeResolver(classification.primaryDomain)
      : input.preferredVolumeId ?? null;
    const volume = await resolveOrCreateVolumeForDomain(
      classification.primaryDomain,
      incomingWordCount,
      createdVolumes,
      resolvedPreferredVolumeId,
      cachedVolumes
    );
    const chapter = await resolveOrCreateChapter(
      volume.id,
      sec.chapterTitle,
      classification.pedagogicalRank,
      createdChapters,
      chaptersCache
    );

    // Commercial Non-Destructive Quarantine Policy:
    // - Guest-submitted sensitive High-Precision Remap data
    // - Prompt injection flags
    // - Generation-2 Physical & Mechanical Guard anomalies (PFI/GDI/CRDi pressure, AFR/Lambda, Dyno coupling)
    // All route safely to 'staging' for expert human review without deleting user data!
    const startsInStaging =
      (input.submittedByRole === 'guest' && classification.highPrecisionRemapMode) ||
      injectionScan.quarantined ||
      physicalGuardReport.quarantineRecommended;

    const verificationStatus = startsInStaging ? 'staging' : 'verified';
    if (startsInStaging) stagingUnitsCount += 1;
    if (physicalGuardReport.quarantineRecommended) physicalQuarantinedCount += 1;

    const evidenceInfo = getEvidenceTierInfo(input.evidenceTier);

    const createdUnit = await createMasterKnowledgeUnit({
      id: `ku_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      volumeId: volume.id,
      chapterId: chapter.id,
      blockType: sec.blockType,
      cleanText: sec.bodyText,
      normalizedHash: normalizeUnitHash(sec.bodyText),
      domainTag: classification.primaryDomain,
      canonicalEntityId: entitySeed?.id ?? null,
      verificationStatus,
      lifecycleStatus: 'active',
      corroborationCount: 1,
      distinctSourceHashesJson: [independentSourceMarker],
      evidenceTier: evidenceInfo.tier,
      ingestBatchId: input.ingestBatchId,
      sourceUploadHash: input.sourceUploadHash,
      technicalMetadataJson: {
        highPrecisionRemapMode: classification.highPrecisionRemapMode,
        remapSignals: classification.remapSignalsMatched,
        secondaryDomains: classification.secondaryDomains,
        sourceFileName: input.sourceFileName,
        contributorEmail: input.actorEmail ?? null,
        contributorDisplayName: input.contributorDisplayName ?? null,
        evidenceTierRank: evidenceInfo.rank,
        evidenceTierWeight: evidenceInfo.weight,
        contextScope,
        physicalGuardPassed: physicalGuardReport.passed,
        physicalGuardWarnings: physicalGuardReport.issues as AutomotivePhysicalGuardIssue[],
      },
    });

    syncUnitInCache(createdUnit);
    volume.wordCount += incomingWordCount;

    await createMasterUnitRevision({
      ingestBatchId: input.ingestBatchId,
      unitId: createdUnit.id,
      action: 'created',
      previousStateJson: null,
      newStateJson: createdUnit as unknown as Record<string, unknown>,
      actorEmail: input.actorEmail ?? null,
    });
    newUnitsCount += 1;
  }

  await recalculateVolumeAndChapterStats();

  const allChaptersForHealth = await listMasterChapters();
  const projectHealthReport = buildPostIngestProjectHealthReport({
    clusteringResult,
    activeUnits: cachedUnits,
    chapters: allChaptersForHealth,
  });

  const physNotice =
    physicalQuarantinedCount > 0
      ? ` (${physicalQuarantinedCount} واحد دارای هشدار گارد فیزیکی/داینو در صف بازبینی متخصص قرار گرفت)`
      : '';
  const xrefNotice =
    clusteringResult.routedLines.length > 0
      ? ` · ${clusteringResult.routedLines.length} انتقال تک‌خطی (↗/↙)`
      : '';
  const summaryFa = `پردازش ${input.sourceFileName}: ${newUnitsCount} واحد جدید، ${mergedUnitsCount} ادغام بدون افت، ${duplicateUnitsCount} هم‌پوشان/تأیید، ${conflictsCount} تعارض، ${stagingUnitsCount} در صف بازبینی${xrefNotice}${physNotice}.`;

  return {
    newUnitsCount,
    duplicateUnitsCount,
    mergedUnitsCount,
    conflictsCount,
    stagingUnitsCount,
    physicalQuarantinedCount,
    promptInjectionQuarantined: injectionScan.quarantined,
    createdVolumes,
    createdChapters,
    modelsUsed: ['layer0-deterministic'],
    summaryFa,
    crossReferenceRoutedCount: clusteringResult.routedLines.length,
    phoneticCorrectionsCount: clusteringResult.phoneticCorrectionsCount,
    clusteringResult,
    projectHealthReport,
  };
}

// ============================================================================
// KNOWLEDGE LINTER (Orphan Chapters, Cross-Volume Conflicts, Deprecated Units)
// ============================================================================

export interface MasterKnowledgeLinterReport {
  orphanChapters: Array<{ chapterId: string; volumeId: string; title: string }>;
  crossVolumeConflicts: Array<{
    entityOrToken: string;
    volumeIds: string[];
    unitIds: string[];
    detailFa: string;
  }>;
  deprecatedUnits: Array<{ unitId: string; volumeId: string; chapterId: string }>;
  totalActiveVerifiedUnits: number;
  healthy: boolean;
}

export async function runMasterKnowledgeLinter(): Promise<MasterKnowledgeLinterReport> {
  const [chapters, units] = await Promise.all([
    listMasterChapters(),
    listMasterKnowledgeUnits(),
  ]);

  const activeVerified = units.filter(
    (u) => u.lifecycleStatus === 'active' && u.verificationStatus === 'verified'
  );
  const deprecatedUnits = units
    .filter((u) => u.lifecycleStatus === 'deprecated')
    .map((u) => ({ unitId: u.id, volumeId: u.volumeId, chapterId: u.chapterId }));

  // 1. Orphan chapters (0 active verified units)
  const unitsPerChapter = new Map<string, number>();
  for (const u of activeVerified) {
    unitsPerChapter.set(u.chapterId, (unitsPerChapter.get(u.chapterId) ?? 0) + 1);
  }
  const orphanChapters = chapters
    .filter((c) => (unitsPerChapter.get(c.id) ?? 0) === 0)
    .map((c) => ({ chapterId: c.id, volumeId: c.volumeId, title: c.title }));

  // 2. Cross-volume conflicts (same canonical entity appearing in >= 2 volumes with divergent numbers)
  const byEntity = new Map<string, MasterKnowledgeUnitRow[]>();
  for (const u of activeVerified) {
    if (!u.canonicalEntityId) continue;
    const list = byEntity.get(u.canonicalEntityId) ?? [];
    list.push(u);
    byEntity.set(u.canonicalEntityId, list);
  }

  const crossVolumeConflicts: MasterKnowledgeLinterReport['crossVolumeConflicts'] = [];
  for (const [entityId, entityUnits] of byEntity.entries()) {
    const distinctVols = new Set(entityUnits.map((u) => u.volumeId));
    if (distinctVols.size < 2) continue;
    for (let i = 0; i < entityUnits.length; i++) {
      for (let j = i + 1; j < entityUnits.length; j++) {
        if (entityUnits[i].volumeId === entityUnits[j].volumeId) continue;
        const evalRes = detectMeasurementConflict(
          entityUnits[i].cleanText,
          entityUnits[j].cleanText
        );
        if (evalRes.hasConflict) {
          crossVolumeConflicts.push({
            entityOrToken: entityId,
            volumeIds: [entityUnits[i].volumeId, entityUnits[j].volumeId],
            unitIds: [entityUnits[i].id, entityUnits[j].id],
            detailFa: `تعارض بین‌جلدی برای موجودیت ${entityId}: ${evalRes.conditionContext ?? 'اختلاف عددی'}`,
          });
        }
      }
    }
  }

  return {
    orphanChapters,
    crossVolumeConflicts,
    deprecatedUnits,
    totalActiveVerifiedUnits: activeVerified.length,
    healthy: orphanChapters.length === 0 && crossVolumeConflicts.length === 0,
  };
}
