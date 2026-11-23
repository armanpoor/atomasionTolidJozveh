export type SemanticBlockKind =
  | 'heading'
  | 'paragraph'
  | 'callout_warning'
  | 'callout_tip'
  | 'table'
  | 'formula'
  | 'step_list'
  | 'source_gap_flag'
  | 'source_conflict_flag'
  | 'figure_ref';

export interface SemanticBlock {
  id: string;
  kind: SemanticBlockKind;
  sourceChunkIds: string[];
  text?: string;
  title?: string;
  items?: string[];
  headers?: string[];
  rows?: string[][];
  latex?: string;
  readable?: string;
  gapReason?: string;
  missingInfo?: string;
  /** Used by source_conflict_flag when two source chunks disagree */
  conflictTopic?: string;
  conflictSourceA?: string;
  conflictSourceB?: string;
  /** Used by figure_ref for WinOLS / ECU image preservation */
  assetId?: string;
  caption?: string;
}

export interface SectionProvenance {
  prefixHash?: string | null;
  authorModelUsed: string;
  judgeModelUsed?: string | null;
  patchAttempts: number;
  finishReason?: string | null;
  outputTruncated?: boolean;
  lowEffortJudgeFlagged?: boolean;
  sourceChunkHashes: Record<string, string>;
  auditedAt: string;
}

export interface SemanticSectionIR {
  sectionId: string;
  chapterId: string;
  title: string;
  blocks: SemanticBlock[];
  sourceChunkIds: string[];
  generatedAt: string;
  modelUsed: string;
  tierUsed: 'economy' | 'balanced' | 'flagship' | 'manual';
  /** Package C full audit & reproducibility provenance */
  provenance?: SectionProvenance;
}

export interface HarnessSourceChunk {
  id: string;
  fileName: string;
  headingPath?: string | null;
  unitType?: string;
  text: string;
  wordCount: number;
  /** Structure-aware continuity pointers when an oversized atomic block had to span adjacent chunks */
  continuedFromChunkId?: string | null;
  continuesToChunkId?: string | null;
  /** Detected ECU / engine platform canonical tags on this chunk (e.g. bosch_me744, siemens_sim2k) */
  ecuPlatformTags?: string[];
  /** Deterministic content hash for Source Mutation Drift detection */
  contentHash?: string;
}

export interface BlueprintSection {
  sectionId: string;
  chapterId: string;
  chapterOrder: number;
  chapterTitle: string;
  sectionOrder: number;
  title: string;
  sourceChunkIds: string[];
  sourceWordCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  /** ECU / engine platforms legitimately present in this subsection's source chunks */
  ecuPlatformTags?: string[];
}

export interface BlueprintAuditReport {
  unassignedChunkIds: string[];
  duplicatedChunkIds: string[];
  oversizedSectionIds: Array<{
    sectionId: string;
    title: string;
    estimatedTokens: number;
    maxAllowedTokens: number;
    suggestedSplitCount: number;
  }>;
  brokenContinuityChunkIds: string[];
  maxSectionInputTokens: number;
  passed: boolean;
}

export interface MasterBlueprint {
  version: number;
  approved: boolean;
  approvedAt: string | null;
  frozenGlossaryVersion: number;
  budgetCapUsd: number;
  totalSections: number;
  totalChunks: number;
  totalSourceWords: number;
  estimatedTotalCostUsd: number;
  estimatedSavingsPercent: number;
  sections: BlueprintSection[];
  /** Hash of the full ordered source corpus locked at HITL approval */
  sourceCorpusHash?: string | null;
  /** Per-chunk content hashes locked at HITL approval to catch Stage 1 mutations */
  chunkContentHashes?: Record<string, string>;
  /** Pre-HITL deterministic Blueprint integrity audit */
  blueprintAudit?: BlueprintAuditReport;
}

export type GlossaryTermCategory = 'ecu' | 'winols_map' | 'dtc' | 'unit' | 'general';

export interface GlossaryTermEntry {
  id: string;
  canonicalTerm: string;
  enEquivalents: string[];
  faEquivalents: string[];
  forbiddenVariants: string[];
  category: GlossaryTermCategory;
  definitionFa?: string;
  sourceChunkIds: string[];
}

export interface LivingGlossary {
  version: number;
  frozen: boolean;
  entries: GlossaryTermEntry[];
  /**
   * Two-layer glossary (Package B): short delta entries discovered mid-chapter.
   * Injected in the dynamic suffix so the cached prefix stays byte-identical until chapter boundaries.
   */
  deltaEntries?: GlossaryTermEntry[];
  updatedAt: string;
}

export interface RollingSummaryEntry {
  sectionId: string;
  chapterTitle: string;
  sectionTitle: string;
  summaryText: string;
  keyConcepts: string[];
  updatedAt: string;
}

export interface RollingSummaryChapterDigest {
  chapterTitle: string;
  sectionCount: number;
  keyConcepts: string[];
  lastUpdatedAt: string;
}

export interface RollingSummary {
  maxTokensBudget: number;
  entries: RollingSummaryEntry[];
  /** Package C append-only condensed digests of older chapters */
  chapterDigests?: RollingSummaryChapterDigest[];
  compiledText: string;
}

export type CoverageStatus =
  | 'pending'
  | 'drafted'
  | 'drafted_unverified'
  | 'verified'
  | 'quarantined';

export interface ChunkCoverageEntry {
  chunkId: string;
  sectionId: string;
  chapterId: string;
  status: CoverageStatus;
  wordCount: number;
  updatedAt: string;
}

export interface SectionCoverageEntry {
  sectionId: string;
  chapterId: string;
  status: CoverageStatus;
  attempts: number;
  layer1Passed: boolean;
  layer2Passed: boolean;
  lastError?: string | null;
  lastUpdatedAt: string;
}

export interface CoverageLedger {
  byChunkId: Record<string, ChunkCoverageEntry>;
  bySectionId: Record<string, SectionCoverageEntry>;
}

export type Layer1IssueKind =
  | 'html_markup_detected'
  | 'empty_blocks_output'
  | 'invalid_block_structure'
  | 'invalid_table_matrix'
  | 'missing_source_citation'
  | 'invalid_source_chunk_id'
  | 'missing_source_chunk'
  | 'low_word_ratio'
  | 'excessive_bloat'
  | 'hallucinated_technical_fact'
  | 'sign_inversion_detected'
  | 'unit_mismatch_or_conversion'
  | 'ecu_platform_mismatch'
  | 'missing_safety_warning'
  | 'missing_technical_anchor'
  | 'glossary_violation'
  | 'degenerate_repetition_detected'
  | 'excessive_gap_bailout'
  | 'broken_cross_reference'
  | 'cross_section_duplication'
  | 'source_drift_detected'
  | 'output_truncated';

export interface Layer1Issue {
  id: string;
  kind: Layer1IssueKind;
  severity: 'error' | 'warning';
  blockId?: string;
  messageFa: string;
  offendingToken?: string;
}

export interface Layer1AuditResult {
  passed: boolean;
  issues: Layer1Issue[];
  invalidBlockIds: string[];
  coverageRatio: number;
  sourceWordCount: number;
  outputWordCount: number;
  checkedAnchorsCount: number;
  /** Percentage (0..100) of technical entities from sourceChunks preserved in the generated section */
  technicalEntityRetentionPercent: number;
}

export interface Layer2Issue {
  id: string;
  blockId?: string;
  category: 'hallucination' | 'omission' | 'terminology' | 'clarity' | 'structure';
  severity: 'error' | 'warning';
  messageFa: string;
  suggestedFixFa?: string;
}

export interface JudgeCheckedClaim {
  blockId?: string;
  claimFa: string;
  supported: boolean;
  sourceChunkId?: string;
  noteFa?: string;
}

export interface Layer2AuditResult {
  passed: boolean;
  score: number;
  summaryFa: string;
  issues: Layer2Issue[];
  invalidBlockIds: string[];
  modelUsed: string;
  /** Package C Claim-by-Claim anti-rubber-stamp judge evidence */
  checkedClaims?: JudgeCheckedClaim[];
  missingTechnicalFacts?: string[];
  lowEffortJudgeAudit?: boolean;
  flagCode?: 'low_effort_judge_audit' | null;
}

export interface QuarantineItem {
  sectionId: string;
  chapterId: string;
  chapterTitle: string;
  sectionTitle: string;
  attempts: number;
  maxAttempts: number;
  draftIR: SemanticSectionIR;
  layer1Issues: Layer1Issue[];
  layer2Issues: Layer2Issue[];
  sourceChunkIds: string[];
  quarantinedAt: string;
  resolved: boolean;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}

export type CostAuditLedgerStatus =
  | 'pending_charge'
  | 'settled'
  | 'unreconciled_estimated_cost'
  | 'aborted';

export interface CostAuditLedgerEntry {
  id: string;
  sectionId: string;
  role: 'harness_author' | 'harness_judge' | 'harness_patch_1' | 'harness_patch_2' | 'harness_utility';
  requestedModel: string;
  actualModel: string;
  status: CostAuditLedgerStatus;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  promptTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  cacheTelemetryReported: boolean;
  modelMismatch: boolean;
  createdAt: string;
  settledAt?: string | null;
  noteFa?: string;
}

export interface ModelMismatchWarningRecord {
  at: string;
  role: string;
  requestedModel: string;
  actualModel: string;
  isDowngrade: boolean;
  messageFa: string;
}

export interface PrefixCachePolicySnapshot {
  prefixHash: string;
  prefixEstimatedTokens: number;
  minThresholdTokens: number;
  belowCacheThreshold: boolean;
  shouldEnableCacheWrite: boolean;
  ttlMs: number;
  ttlExpired: boolean;
  thresholdWarningFa?: string | null;
}

export interface HarnessTelemetry {
  totalPromptTokens: number;
  cachedInputTokens: number;
  totalOutputTokens: number;
  /** Separated reasoning / thinking token count reported by provider APIs */
  totalReasoningTokens?: number;
  cacheHits: number;
  /** Calls where the provider explicitly reported factual cache usage fields */
  cacheTelemetryReportedCalls?: number;
  /** Calls where the provider omitted cache usage fields (shown honestly as unreported) */
  cacheTelemetryUnreportedCalls?: number;
  totalCalls: number;
  estimatedCostUsd: number;
  /** Estimated vampire cost from timed-out calls whose upstream billing status is unknown */
  unreconciledCostUsd?: number;
  /** Locked deterministic hash of the immutable cached prefix */
  prefixHash?: string | null;
  /** Timestamp of the last successful call using the locked prefix (for TTL management) */
  lastPrefixUsedAt?: string | null;
  /** Transparent HITL warning if prefix is below provider cache threshold */
  prefixCacheWarningFa?: string | null;
  /** Dynamic calibration multiplier for conservative Persian token estimation */
  tokenCalibrationFactor?: number;
  /** Warnings logged when an upstream proxy (e.g. 9Router) returned a different model than requested */
  modelMismatchWarnings?: ModelMismatchWarningRecord[];
  /** Per-call financial audit ledger recording pending_charge -> settled / unreconciled_estimated_cost */
  costAuditLedger?: CostAuditLedgerEntry[];
  completedSections: number;
  quarantinedSections: number;
  pausedByBudgetCap: boolean;
  budgetCapMessage?: string | null;
  lastModelUsed?: string | null;
  lastUpdatedAt: string;
}

export interface ActiveStepLock {
  stepRunId: string;
  sectionId: string;
  acquiredAt: string;
  heartbeatAt: string;
  lockExpiresAt: string;
}

export interface HarnessState {
  schemaVersion: 1;
  projectId: string;
  status: 'idle' | 'blueprint_ready' | 'running' | 'paused' | 'budget_paused' | 'completed';
  blueprint: MasterBlueprint;
  glossary: LivingGlossary;
  rollingSummary: RollingSummary;
  coverageLedger: CoverageLedger;
  sectionsIR: Record<string, SemanticSectionIR>;
  quarantineQueue: QuarantineItem[];
  telemetry: HarnessTelemetry;
  /** Package C distributed concurrency lease lock preventing duplicate step runs */
  activeStepLock?: ActiveStepLock | null;
  updatedAt: string;
}

export interface BudgetCheckResult {
  allowed: boolean;
  projectedTotalUsd: number;
  remainingUsd: number;
  effectiveSpentUsd?: number;
  unreconciledCostUsd?: number;
  subcallRole?: string;
  reasonFa?: string;
}

export interface HarnessCostEstimate {
  authorModelId: string;
  utilityModelId: string;
  totalInputTokens: number;
  totalCachedPrefixTokens: number;
  totalOutputTokens: number;
  estimatedCostWithoutCacheUsd: number;
  estimatedCostWithCacheUsd: number;
  savingsPercent: number;
  prefixHash?: string;
  prefixEstimatedTokens?: number;
  minCacheThresholdTokens?: number;
  belowCacheThreshold?: boolean;
  cacheThresholdWarningFa?: string | null;
  perSectionEstimates: Array<{
    sectionId: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCostUsd: number;
  }>;
}
