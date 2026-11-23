export type SourceFileFormat = 'md' | 'docx' | 'pdf' | 'json' | 'txt' | 'csv' | 'html';

export type WorkflowMode =
  | 'single_polish'
  | 'multi_merge'
  | 'master_update'
  | 'raw_synthesis';

export type GoogleSearchMode =
  | 'off'
  | 'conflicts_only'
  | 'conflicts_and_enrichment'
  | 'full_document_enrichment';

export type FileRole = 'standard' | 'master' | 'supplement';

export type AiModelId = 'gemini-4-hydrogen' | 'gemini-3.8-flash';
export type AiThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
export type ProcessingEngineMode = 'ai' | 'local';

export interface UploadedSourceFile {
  id: string;
  name: string;
  format: SourceFileFormat;
  sizeBytes: number;
  addedAt: number;
  role?: FileRole;
  chapterCount?: number;
  wordCount?: number;
}

export type CalloutVariant =
  | 'concept'
  | 'warning'
  | 'qa'
  | 'engineering'
  | 'revision'
  | 'project'
  | 'general';

export interface BlockProvenance {
  sourceFileNames?: string[];
  sourceUnitIds?: string[];
}

export interface TableBlock extends BlockProvenance {
  type: 'table';
  id: string;
  caption?: string;
  originalCaption?: string;
  headers: string[];
  rows: string[][];
  generatedBy?: 'ai' | 'local';
  rationale?: string;
}

export interface CalloutBlock extends BlockProvenance {
  type: 'callout';
  id: string;
  variant: CalloutVariant;
  title: string;
  paragraphs: string[];
}

export interface EquationBlock extends BlockProvenance {
  type: 'equation';
  id: string;
  latex: string;
  readable: string;
}

export interface ListBlock extends BlockProvenance {
  type: 'list';
  id: string;
  ordered: boolean;
  items: string[];
}

export interface FigureBlock extends BlockProvenance {
  type: 'figure';
  id: string;
  caption: string;
  description: string;
}

export interface EmbeddedImageBlock extends BlockProvenance {
  type: 'image';
  id: string;
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
  caption: string;
  widthPx?: number;
  heightPx?: number;
}

export interface WebGroundingSource {
  title: string;
  uri: string;
}

export interface WebEnrichmentBlock extends BlockProvenance {
  type: 'web_enrichment';
  id: string;
  title: string;
  summary: string;
  sources: WebGroundingSource[];
  checkedAt: string;
}

export interface ConflictNoteBlock extends BlockProvenance {
  type: 'conflict_note';
  id: string;
  conflictId: string;
  topic: string;
  fileAName: string;
  excerptA: string;
  fileBName: string;
  excerptB: string;
  status: string;
  resolutionNote?: string;
  webSummary?: string;
  webSources?: WebGroundingSource[];
}

export type DiagramKind = 'flowchart' | 'process_steps' | 'comparison_bars' | 'architecture';

export interface DiagramItem {
  label: string;
  detail?: string;
  value?: number;
  group?: string;
}

export interface DiagramBlock extends BlockProvenance {
  type: 'diagram';
  id: string;
  kind: DiagramKind;
  title: string;
  caption: string;
  rationale?: string;
  items: DiagramItem[];
  svgMarkup: string;
  pngDataUrl?: string;
  pngBytes?: Uint8Array;
  widthPx: number;
  heightPx: number;
  generatedBy: 'ai' | 'local';
}

export interface ParagraphBlock extends BlockProvenance {
  type: 'paragraph';
  id: string;
  text: string;
}

export interface SubheadingBlock extends BlockProvenance {
  type: 'subheading';
  id: string;
  level: 3 | 4;
  text: string;
}

export type ContentBlock =
  | ParagraphBlock
  | SubheadingBlock
  | CalloutBlock
  | TableBlock
  | EquationBlock
  | ListBlock
  | FigureBlock
  | EmbeddedImageBlock
  | WebEnrichmentBlock
  | ConflictNoteBlock
  | DiagramBlock;

export interface SectionNode {
  id: string;
  numberLabel: string;
  title: string;
  originalTitle: string;
  wasUnnumbered?: boolean;
  sourceFileName?: string;
  sourceFileNames?: string[];
  blocks: ContentBlock[];
}

export interface ChapterMetaItem {
  label: string;
  value: string;
}

export interface ChapterNode {
  id: string;
  chapterNumber: number;
  title: string;
  volumeIndex: number;
  volumeTitle: string;
  meta: ChapterMetaItem[];
  introBlocks: ContentBlock[];
  sections: SectionNode[];
  sourceFileName: string;
}

export interface VolumeNode {
  id: string;
  index: number;
  title: string;
  subtitle?: string;
}

export interface FootnoteEntry {
  id: number;
  canonicalId: number;
  termKey: string;
  text: string;
  chapters: number[];
  mergedFromIds?: number[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  chapters: number[];
}

export interface TableIndexEntry {
  tableNumber: string;
  caption: string;
  originalCaption?: string;
  chapterNumber: number;
  chapterTitle: string;
  sectionTitle: string;
  generatedBy?: 'ai' | 'local';
}

export interface CheatSheetEntry {
  id: string;
  chapterNumber: number;
  chapterTitle: string;
  title: string;
  highlights: string[];
}

export interface VisualSuggestion {
  id: string;
  chapterNumber: number;
  chapterTitle: string;
  sectionTitle: string;
  kind: 'table' | 'flowchart' | 'diagram' | 'screenshot' | 'comparison';
  kindLabel: string;
  title: string;
  rationale: string;
  suggestedColumnsOrElements: string[];
  priority: 'high' | 'medium';
  embeddedInDocx?: boolean;
}

export interface DeduplicationRecord {
  id: string;
  category:
    | 'footnote'
    | 'paragraph'
    | 'callout'
    | 'table_renumber'
    | 'heading_number'
    | 'artifact_fix'
    | 'glossary'
    | 'thematic_merge';
  categoryLabel: string;
  location: string;
  canonicalLocation: string;
  summary: string;
  beforeSnippet: string;
  afterSnippet: string;
  conceptsPreserved: boolean;
}

export interface ConceptRetentionCheck {
  token: string;
  label: string;
  beforeCount: number;
  afterCount: number;
  preserved: boolean;
}

export interface OptimizationAudit {
  rawWordCount: number;
  optimizedWordCount: number;
  rawBlockCount: number;
  optimizedBlockCount: number;
  rawFootnoteCount: number;
  optimizedFootnoteCount: number;
  duplicateFootnotesMerged: number;
  duplicateBlocksConsolidated: number;
  tablesRenumbered: number;
  unnumberedSectionsFixed: number;
  artifactsRepaired: number;
  generatedTablesInserted: number;
  generatedDiagramsInserted: number;
  glossaryEntriesCount: number;
  visualSuggestionsCount: number;
  conceptRetentionRate: number;
  conceptChecks: ConceptRetentionCheck[];
  records: DeduplicationRecord[];
}

export interface AiThematicChapterPlan {
  chapterTitle: string;
  topicSummary: string;
  sectionIds: string[];
}

export interface AiSemanticDuplicate {
  topic: string;
  canonicalSectionId: string;
  redundantSectionIds: string[];
  mergeRationale: string;
  preservedConcepts: string[];
}

export interface AiGeneratedTableSpec {
  targetChapterTitle: string;
  caption: string;
  rationale: string;
  headers: string[];
  rows: string[][];
}

export interface AiGeneratedDiagramSpec {
  targetChapterTitle: string;
  kind: DiagramKind;
  title: string;
  caption: string;
  rationale: string;
  items: DiagramItem[];
}

export interface AiAnalysisPayload {
  unifiedTitle?: string;
  unifiedSubtitle?: string;
  executiveSummary?: string;
  thematicChapters?: AiThematicChapterPlan[];
  semanticDuplicates?: AiSemanticDuplicate[];
  generatedTables?: AiGeneratedTableSpec[];
  generatedDiagrams?: AiGeneratedDiagramSpec[];
}

export interface AiAnalysisReport {
  engineMode: ProcessingEngineMode;
  model: AiModelId;
  modelDisplayName: string;
  thinkingLevel: AiThinkingLevel;
  analyzedAt: string;
  executiveSummary: string;
  thematicChapters: AiThematicChapterPlan[];
  semanticDuplicates: AiSemanticDuplicate[];
  insertedTables: Array<{
    chapterNumber: number;
    chapterTitle: string;
    caption: string;
    rationale: string;
    rowCount: number;
    generatedBy: 'ai' | 'local';
  }>;
  insertedDiagrams: Array<{
    chapterNumber: number;
    chapterTitle: string;
    title: string;
    caption: string;
    kind: DiagramKind;
    rationale: string;
    svgMarkup: string;
    generatedBy: 'ai' | 'local';
  }>;
  apiNote?: string;
}

export interface ParsedBook {
  title: string;
  subtitle: string;
  editionNote: string;
  sourceFiles: string[];
  volumes: VolumeNode[];
  chapters: ChapterNode[];
  footnotes: FootnoteEntry[];
  glossary: GlossaryEntry[];
  tableIndex: TableIndexEntry[];
  cheatSheets: CheatSheetEntry[];
  visualSuggestions: VisualSuggestion[];
  sourceMapRows: string[][];
  audit?: OptimizationAudit;
  aiReport?: AiAnalysisReport;
}

export interface OptimizationOptions {
  deduplicateFootnotes: boolean;
  consolidateDuplicateBlocks: boolean;
  renumberTablesSequentially: boolean;
  autoNumberSections: boolean;
  repairTypographyArtifacts: boolean;
  normalizePersianHalfSpaces: boolean;
  generateVisualSuggestions: boolean;
  embedGeneratedTablesAndDiagrams: boolean;
  clusterThematicallyAcrossFiles: boolean;
}

export type AiRewriteLevel =
  | 'strict_zero_touch'
  | 'light_polish'
  | 'cohesive_synthesis';

export type OutputTonePreset =
  | 'workshop_practical'
  | 'academic_engineering'
  | 'beginner_step_by_step'
  | 'concise_cheatsheet';

export interface DocxExportConfig {
  fontFamily: 'Vazir Medium' | 'Vazirmatn Medium' | 'Vazir' | 'B Nazanin';
  paperSize: 'A4' | 'B5';
  baseFontSizePt: 10.5 | 11 | 12;
  bodyAlignment?: 'both' | 'right';
  aiModel: AiModelId;
  aiThinkingLevel: AiThinkingLevel;
  useAiBackend: boolean;
  googleSearchMode: GoogleSearchMode;
  aiRewriteLevel: AiRewriteLevel;
  outputTone: OutputTonePreset;
  customStylePrompt: string;
  includeWinolsActionTables: boolean;
  includeCoverPage: boolean;
  includeAutoToc: boolean;
  includeVolumeDividers: boolean;
  includeChapterMetaCards: boolean;
  includeVisualSuggestions: boolean;
  includeMasterCheatSheet: boolean;
  includeGlossary: boolean;
  includeListOfTables: boolean;
  includeFootnotesSection: boolean;
  includeHeadersAndFooters: boolean;
  optimization: OptimizationOptions;
}

export interface HistoryRunRecord {
  id: string;
  createdAt: string;
  title: string;
  sourceFiles: Array<{ name: string; format: SourceFileFormat; sizeBytes: number }>;
  engineMode: ProcessingEngineMode;
  model: AiModelId;
  modelDisplayName: string;
  thinkingLevel: AiThinkingLevel;
  stats: {
    chapterCount: number;
    sectionCount: number;
    tableCount: number;
    diagramCount: number;
    duplicatesConsolidated: number;
    conceptRetentionRate: number;
    wordCount: number;
  };
  aiReport?: AiAnalysisReport;
  audit?: OptimizationAudit;
  config: DocxExportConfig;
  bookSnapshot: ParsedBook;
  docxFileName?: string;
  docxSizeBytes?: number;
  docxBlob?: Blob;
}

export const DEFAULT_OPTIMIZATION_OPTIONS: OptimizationOptions = {
  deduplicateFootnotes: true,
  consolidateDuplicateBlocks: true,
  renumberTablesSequentially: true,
  autoNumberSections: true,
  repairTypographyArtifacts: true,
  normalizePersianHalfSpaces: true,
  generateVisualSuggestions: true,
  embedGeneratedTablesAndDiagrams: true,
  clusterThematicallyAcrossFiles: true,
};

export const DEFAULT_DOCX_CONFIG: DocxExportConfig = {
  fontFamily: 'Vazir Medium',
  paperSize: 'A4',
  baseFontSizePt: 11,
  bodyAlignment: 'both',
  aiModel: 'gemini-4-hydrogen',
  aiThinkingLevel: 'HIGH',
  useAiBackend: true,
  googleSearchMode: 'conflicts_only',
  aiRewriteLevel: 'light_polish',
  outputTone: 'workshop_practical',
  customStylePrompt: '',
  includeWinolsActionTables: true,
  includeCoverPage: true,
  includeAutoToc: true,
  includeVolumeDividers: true,
  includeChapterMetaCards: true,
  includeVisualSuggestions: true,
  includeMasterCheatSheet: true,
  includeGlossary: true,
  includeListOfTables: true,
  includeFootnotesSection: true,
  includeHeadersAndFooters: true,
  optimization: DEFAULT_OPTIMIZATION_OPTIONS,
};

// ============================================================================
// CLOUD SQL STUDIO PROJECT & 5-STAGE ZERO-LOSS PIPELINE DTOS
// ============================================================================

export type ProjectStatus =
  | 'draft'
  | 'ingesting'
  | 'deduping'
  | 'awaiting_outline'
  | 'structuring'
  | 'completed'
  | 'paused'
  | 'error';

export interface ProjectSummaryDto {
  id: string;
  title: string;
  workflowMode: WorkflowMode;
  pipelineStage: number;
  status: ProjectStatus;
  settingsJson: Record<string, unknown>;
  checkpointJson: Record<string, unknown>;
  sourceFileCount?: number;
  totalWordCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceFileDto {
  id: string;
  projectId: string;
  fileName: string;
  format: SourceFileFormat;
  fileRole: FileRole;
  sizeBytes: number;
  wordCount: number;
  unitCount: number;
  checksum: string;
  uploadedAt: string;
}

export interface ContentUnitDto {
  id: string;
  projectId: string;
  sourceFileId: string;
  unitOrder: number;
  unitType: string;
  headingPath: string | null;
  rawText: string;
  normalizedHash: string;
  status: string;
  canonicalUnitId: string | null;
  outlineNodeId: string | null;
  metadataJson: Record<string, unknown> | null;
}

export interface DedupClusterDto {
  id: string;
  projectId: string;
  canonicalUnitId: string;
  mergedUnitIds: string[];
  matchType: string;
  similarityScore: number;
  losslessSummary: string | null;
  preservedDetailsJson: Record<string, unknown> | null;
}

export interface ConflictDto {
  id: string;
  projectId: string;
  topic: string;
  unitAId: string | null;
  unitBId: string | null;
  fileAName: string;
  fileBName: string;
  excerptA: string;
  excerptB: string;
  status: 'open' | 'keep_both' | 'choose_a' | 'choose_b' | 'resolved_web';
  resolutionNote: string | null;
  webGroundingJson: {
    summary: string;
    sources: WebGroundingSource[];
    checkedAt: string;
    query?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutlineNodeDto {
  id: string;
  projectId: string;
  parentId: string | null;
  level: number;
  nodeOrder: number;
  title: string;
  summary: string | null;
  isApproved: boolean;
  webEnrichmentJson: {
    title: string;
    summary: string;
    sources: WebGroundingSource[];
    checkedAt: string;
  } | null;
}

export interface AuditReportDto {
  id: string;
  projectId: string;
  totalSourceFiles: number;
  totalInputUnits: number;
  uniqueUnitsPreserved: number;
  duplicatesMerged: number;
  conflictsDetected: number;
  conflictsResolved: number;
  coveragePercent: number;
  detailsJson: Record<string, unknown> | null;
  generatedAt: string;
}

export interface ProjectBundleDto {
  project: ProjectSummaryDto & {
    bookSnapshotJson: ParsedBook | null;
  };
  sourceFiles: SourceFileDto[];
  contentUnits: ContentUnitDto[];
  dedupClusters: DedupClusterDto[];
  conflicts: ConflictDto[];
  outlineNodes: OutlineNodeDto[];
  auditReport: AuditReportDto | null;
}

export type ChatProposalAction =
  | 'split_chapter'
  | 'rename_chapter'
  | 'move_chapter'
  | 'add_comparison_table'
  | 'add_callout_box'
  | 'insert_dictated_paragraph'
  | 'merge_chapters';

export interface ChatProposal {
  id: string;
  action: ChatProposalAction;
  title: string;
  summary: string;
  args: Record<string, unknown>;
  applied?: boolean;
}

export interface ProjectAiUsageLedger {
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  requestCount: number;
  groundingCallCount: number;
  deepReviewCount: number;
  chatCallCount: number;
  lastModelUsed?: string;
  lastUpdatedAt?: string;
  /** Cumulative estimated USD cost computed using actual per-model rates (Anthropic/OpenAI/Gemini/DeepSeek) */
  estimatedCostUsdAccumulated?: number;
  /** Cumulative prompt tokens saved via compact wire compression & prompt caching */
  savedTokensByOptimization?: number;
  /** Number of repeat deterministic LLM calls satisfied from server cache at 0 tokens */
  cachedCallsCount?: number;
}

export interface AssistantChatResponse {
  reply: string;
  proposals: ChatProposal[];
  groundingSources?: WebGroundingSource[];
  modelUsed: string;
  tierUsed?: string;
  aiUsage?: ProjectAiUsageLedger;
}

export interface DeepReviewFinding {
  severity: 'high' | 'medium' | 'low';
  category: string;
  chapterTitle: string;
  issue: string;
  fixApplied: string;
}

export interface DeepReviewReportDto {
  reviewedAt: string;
  modelUsed: string;
  thinkingLevel: AiThinkingLevel;
  overallScore: number;
  overallAssessment: string;
  appliedCounts: {
    titlesRefined: number;
    calloutsAdded: number;
    tablesAdded: number;
    paragraphsAdded: number;
  };
  findings: DeepReviewFinding[];
  tierUsed?: string;
  tokenSavingsPercent?: number;
  antiDriftIntegrityScore?: number;
  antiDriftWarnings?: string[];
}

export interface DeepReviewResponse {
  review: DeepReviewReportDto;
  bundle: ProjectBundleDto;
}
