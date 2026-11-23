import type {
  ChapterNode,
  ContentBlock,
  ContentUnitDto,
  GlossaryEntry,
  OutlineNodeDto,
  ParsedBook,
  SectionNode,
  SourceFileDto,
  TableIndexEntry,
} from '../bookTypes.ts';
import { extractEcuPlatforms, extractTechnicalEntities } from '../ecuTechnicalIntegrity.ts';
import { toPersianDigits } from '../formatParsers.ts';
import { deterministicHash } from '../zeroLossPipeline.ts';
import {
  auditMasterBlueprint,
  autoSplitOversizedBlueprintSections,
  computeSourceCorpusFingerprint,
  DEFAULT_MAX_SECTION_INPUT_TOKENS,
} from './chunkingAndBlueprint.ts';
import { estimateHarnessRunCost } from './patchAndBudget.ts';
import { buildImmutableCachedPrefix } from './promptBuilder.ts';
import type {
  BlueprintSection,
  CoverageLedger,
  GlossaryTermEntry,
  HarnessSourceChunk,
  HarnessState,
  LivingGlossary,
  MasterBlueprint,
  SemanticBlock,
  SemanticSectionIR,
} from './types.ts';

function countWords(text: string): number {
  const cleaned = (text || '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function buildSourceChunksMap(
  contentUnits: ContentUnitDto[],
  sourceFiles: SourceFileDto[]
): Map<string, HarnessSourceChunk> {
  const fileNameById = new Map(sourceFiles.map((f) => [f.id, f.fileName]));
  const map = new Map<string, HarnessSourceChunk>();
  for (const u of contentUnits) {
    const meta = (u.metadataJson || {}) as Record<string, unknown>;
    map.set(u.id, {
      id: u.id,
      fileName: fileNameById.get(u.sourceFileId) || 'منبع ورودی',
      headingPath: u.headingPath,
      unitType: u.unitType,
      text: u.rawText,
      wordCount: countWords(u.rawText),
      continuedFromChunkId:
        typeof meta.continuedFromChunkId === 'string' ? meta.continuedFromChunkId : null,
      continuesToChunkId:
        typeof meta.continuesToChunkId === 'string' ? meta.continuesToChunkId : null,
      ecuPlatformTags: Array.from(extractEcuPlatforms(u.rawText)).sort(),
      contentHash: u.normalizedHash || deterministicHash((u.rawText || '').trim()),
    });
  }
  return map;
}

/**
 * Deterministically builds initial MasterBlueprint (with Blueprint Integrity Audit,
 * auto-splitting of sections exceeding maxSectionInputTokens, ECU platform tagging,
 * and Source Mutation Drift hashes), ECU/WinOLS LivingGlossary, RollingSummary,
 * and CoverageLedger directly from Stage 3 outline & contentUnits (0 tokens).
 */
export function buildInitialHarnessState(params: {
  projectId: string;
  outlineNodes: OutlineNodeDto[];
  contentUnits: ContentUnitDto[];
  sourceFiles: SourceFileDto[];
  budgetCapUsd?: number;
  authorModelId?: string;
  utilityModelId?: string;
  enablePromptCaching?: boolean;
  existingVersion?: number;
  maxSectionInputTokens?: number;
}): HarnessState {
  const now = new Date().toISOString();
  const budgetCapUsd =
    typeof params.budgetCapUsd === 'number' && params.budgetCapUsd > 0
      ? params.budgetCapUsd
      : 2.0;
  const maxSectionInputTokens =
    params.maxSectionInputTokens ?? DEFAULT_MAX_SECTION_INPUT_TOKENS;

  const activeUnits = params.contentUnits
    .filter((u) => u.status !== 'merged_duplicate' && u.rawText.trim().length > 0)
    .sort((a, b) => a.unitOrder - b.unitOrder);

  const chunksMap = buildSourceChunksMap(activeUnits, params.sourceFiles);
  const allActiveChunks = activeUnits
    .map((u) => chunksMap.get(u.id))
    .filter((c): c is HarnessSourceChunk => Boolean(c));

  const sortedNodes = [...params.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);
  const topChapters = sortedNodes.filter((n) => n.level <= 1 || !n.parentId);
  const childSectionsByParent = new Map<string, OutlineNodeDto[]>();
  for (const node of sortedNodes) {
    if (node.parentId) {
      const list = childSectionsByParent.get(node.parentId) || [];
      list.push(node);
      childSectionsByParent.set(node.parentId, list);
    }
  }

  const unitsByNodeId = new Map<string, ContentUnitDto[]>();
  const unassignedUnits: ContentUnitDto[] = [];
  for (const unit of activeUnits) {
    if (unit.outlineNodeId) {
      const arr = unitsByNodeId.get(unit.outlineNodeId) || [];
      arr.push(unit);
      unitsByNodeId.set(unit.outlineNodeId, arr);
    } else {
      unassignedUnits.push(unit);
    }
  }

  let rawBlueprintSections: BlueprintSection[] = [];
  let chapterIdx = 0;

  if (topChapters.length === 0) {
    const chunkSize = 8;
    const fallbackChapterId = 'ch-default-1';
    for (let i = 0; i < Math.max(1, activeUnits.length); i += chunkSize) {
      const slice = activeUnits.slice(i, i + chunkSize);
      if (slice.length === 0) break;
      const secOrder = Math.floor(i / chunkSize) + 1;
      const sourceWordCount = slice.reduce((acc, u) => acc + countWords(u.rawText), 0);
      rawBlueprintSections.push({
        sectionId: `sec-auto-${secOrder}`,
        chapterId: fallbackChapterId,
        chapterOrder: 1,
        chapterTitle: 'فصل ۱: محتوای یکپارچه سند',
        sectionOrder: secOrder,
        title: `بخش ${toPersianDigits(secOrder)}`,
        sourceChunkIds: slice.map((u) => u.id),
        sourceWordCount,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedCostUsd: 0,
      });
    }
  } else {
    for (const ch of topChapters) {
      chapterIdx += 1;
      const children = (childSectionsByParent.get(ch.id) || []).sort(
        (a, b) => a.nodeOrder - b.nodeOrder
      );
      const chDirectUnits = unitsByNodeId.get(ch.id) || [];

      if (children.length > 0) {
        let secOrder = 0;
        if (chDirectUnits.length > 0) {
          secOrder += 1;
          rawBlueprintSections.push({
            sectionId: `${ch.id}__intro`,
            chapterId: ch.id,
            chapterOrder: chapterIdx,
            chapterTitle: ch.title,
            sectionOrder: secOrder,
            title: `مقدمه و کلیات ${ch.title}`,
            sourceChunkIds: chDirectUnits.map((u) => u.id),
            sourceWordCount: chDirectUnits.reduce((acc, u) => acc + countWords(u.rawText), 0),
            estimatedInputTokens: 0,
            estimatedOutputTokens: 0,
            estimatedCostUsd: 0,
          });
        }
        for (const child of children) {
          const childUnits = unitsByNodeId.get(child.id) || [];
          secOrder += 1;
          rawBlueprintSections.push({
            sectionId: child.id,
            chapterId: ch.id,
            chapterOrder: chapterIdx,
            chapterTitle: ch.title,
            sectionOrder: secOrder,
            title: child.title,
            sourceChunkIds: childUnits.map((u) => u.id),
            sourceWordCount: childUnits.reduce((acc, u) => acc + countWords(u.rawText), 0),
            estimatedInputTokens: 0,
            estimatedOutputTokens: 0,
            estimatedCostUsd: 0,
          });
        }
      } else {
        const maxChunksPerSub = 10;
        if (chDirectUnits.length <= maxChunksPerSub) {
          rawBlueprintSections.push({
            sectionId: ch.id,
            chapterId: ch.id,
            chapterOrder: chapterIdx,
            chapterTitle: ch.title,
            sectionOrder: 1,
            title: ch.title,
            sourceChunkIds: chDirectUnits.map((u) => u.id),
            sourceWordCount: chDirectUnits.reduce((acc, u) => acc + countWords(u.rawText), 0),
            estimatedInputTokens: 0,
            estimatedOutputTokens: 0,
            estimatedCostUsd: 0,
          });
        } else {
          for (let offset = 0; offset < chDirectUnits.length; offset += maxChunksPerSub) {
            const subUnits = chDirectUnits.slice(offset, offset + maxChunksPerSub);
            const subIdx = Math.floor(offset / maxChunksPerSub) + 1;
            rawBlueprintSections.push({
              sectionId: `${ch.id}__part_${subIdx}`,
              chapterId: ch.id,
              chapterOrder: chapterIdx,
              chapterTitle: ch.title,
              sectionOrder: subIdx,
              title: `${ch.title} (بخش ${toPersianDigits(subIdx)})`,
              sourceChunkIds: subUnits.map((u) => u.id),
              sourceWordCount: subUnits.reduce((acc, u) => acc + countWords(u.rawText), 0),
              estimatedInputTokens: 0,
              estimatedOutputTokens: 0,
              estimatedCostUsd: 0,
            });
          }
        }
      }
    }

    if (unassignedUnits.length > 0) {
      chapterIdx += 1;
      const unId = 'ch-unassigned-tail';
      rawBlueprintSections.push({
        sectionId: 'sec-unassigned-1',
        chapterId: unId,
        chapterOrder: chapterIdx,
        chapterTitle: 'ضمیمه: مطالب تکمیلی و تفکیک‌نشده',
        sectionOrder: 1,
        title: 'نکات تکمیلی استخراج‌شده از منابع',
        sourceChunkIds: unassignedUnits.map((u) => u.id),
        sourceWordCount: unassignedUnits.reduce((acc, u) => acc + countWords(u.rawText), 0),
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedCostUsd: 0,
      });
    }
  }

  // Enforce hard maxSectionInputTokens (6k–8k) with continuity-aware auto-splitting & ECU platform tagging
  const blueprintSections = autoSplitOversizedBlueprintSections({
    sections: rawBlueprintSections,
    chunkById: chunksMap,
    maxSectionInputTokens,
  });

  // Pre-HITL Blueprint Integrity Audit & Source Mutation Drift fingerprint
  const blueprintAudit = auditMasterBlueprint({
    sections: blueprintSections,
    allChunks: allActiveChunks,
    maxSectionInputTokens,
  });
  const corpusFingerprint = computeSourceCorpusFingerprint(allActiveChunks);

  // Build initial Automotive/ECU/WinOLS LivingGlossary deterministically from source units
  const fullText = activeUnits.map((u) => u.rawText).join('\n');
  const entities = extractTechnicalEntities(fullText);
  const glossaryEntries: GlossaryTermEntry[] = [];

  for (const ecu of entities.ecuModels.slice(0, 20)) {
    glossaryEntries.push({
      id: `gl-ecu-${ecu.toLowerCase()}`,
      canonicalTerm: ecu,
      enEquivalents: [ecu],
      faEquivalents: [`ایسیو ${ecu}`],
      forbiddenVariants: [],
      category: 'ecu',
      definitionFa: `پلتفرم سخت‌افزاری/نرم‌افزاری کنترلر موتور ${ecu}`,
      sourceChunkIds: activeUnits
        .filter((u) => u.rawText.toUpperCase().includes(ecu))
        .slice(0, 5)
        .map((u) => u.id),
    });
  }

  for (const mapCode of entities.mapIdentifiers.slice(0, 30)) {
    glossaryEntries.push({
      id: `gl-map-${mapCode.toLowerCase()}`,
      canonicalTerm: mapCode,
      enEquivalents: [mapCode],
      faEquivalents: [`نقشه ${mapCode}`],
      forbiddenVariants: [],
      category: 'winols_map',
      definitionFa: `شناسه جدول/نقشه کالیبراسیون WinOLS (${mapCode})`,
      sourceChunkIds: activeUnits
        .filter((u) => u.rawText.toUpperCase().includes(mapCode))
        .slice(0, 5)
        .map((u) => u.id),
    });
  }

  for (const dtc of entities.dtcCodes.slice(0, 25)) {
    glossaryEntries.push({
      id: `gl-dtc-${dtc.toLowerCase()}`,
      canonicalTerm: dtc,
      enEquivalents: [dtc],
      faEquivalents: [`کد خطای ${dtc}`],
      forbiddenVariants: [],
      category: 'dtc',
      definitionFa: `کد عیب استاندارد OBD-II (${dtc})`,
      sourceChunkIds: activeUnits
        .filter((u) => u.rawText.toUpperCase().includes(dtc))
        .slice(0, 5)
        .map((u) => u.id),
    });
  }

  const glossary: LivingGlossary = {
    version: (params.existingVersion || 0) + 1,
    frozen: false,
    entries: glossaryEntries,
    updatedAt: now,
  };

  // Estimate cost using actual 3-tier pricing & Prompt Caching
  const prefixText = buildImmutableCachedPrefix(glossary);
  const costEstimate = estimateHarnessRunCost({
    blueprint: { sections: blueprintSections },
    authorModelId: params.authorModelId || 'gemini-4-hydrogen',
    utilityModelId: params.utilityModelId || 'gemini-3.8-flash',
    immutablePrefixText: prefixText,
    enablePromptCaching: params.enablePromptCaching ?? true,
  });

  const estBySection = new Map(costEstimate.perSectionEstimates.map((e) => [e.sectionId, e]));
  for (const sec of blueprintSections) {
    const est = estBySection.get(sec.sectionId);
    if (est) {
      sec.estimatedInputTokens = est.estimatedInputTokens;
      sec.estimatedOutputTokens = est.estimatedOutputTokens;
      sec.estimatedCostUsd = est.estimatedCostUsd;
    }
  }

  // Initialize CoverageLedger
  const unitWordMap = new Map(activeUnits.map((u) => [u.id, countWords(u.rawText)]));
  const coverageLedger: CoverageLedger = {
    byChunkId: {},
    bySectionId: {},
  };

  for (const sec of blueprintSections) {
    coverageLedger.bySectionId[sec.sectionId] = {
      sectionId: sec.sectionId,
      chapterId: sec.chapterId,
      status: 'pending',
      attempts: 0,
      layer1Passed: false,
      layer2Passed: false,
      lastError: null,
      lastUpdatedAt: now,
    };
    for (const chunkId of sec.sourceChunkIds) {
      coverageLedger.byChunkId[chunkId] = {
        chunkId,
        sectionId: sec.sectionId,
        chapterId: sec.chapterId,
        status: 'pending',
        wordCount: unitWordMap.get(chunkId) || 0,
        updatedAt: now,
      };
    }
  }

  const totalSourceWords = blueprintSections.reduce((acc, s) => acc + s.sourceWordCount, 0);
  const totalChunks = Object.keys(coverageLedger.byChunkId).length;

  const blueprint: MasterBlueprint = {
    version: (params.existingVersion || 0) + 1,
    approved: false,
    approvedAt: null,
    frozenGlossaryVersion: glossary.version,
    budgetCapUsd,
    totalSections: blueprintSections.length,
    totalChunks,
    totalSourceWords,
    estimatedTotalCostUsd: costEstimate.estimatedCostWithCacheUsd,
    estimatedSavingsPercent: costEstimate.savingsPercent,
    sections: blueprintSections,
    sourceCorpusHash: corpusFingerprint.sourceCorpusHash,
    chunkContentHashes: corpusFingerprint.chunkContentHashes,
    blueprintAudit,
  };

  return {
    schemaVersion: 1,
    projectId: params.projectId,
    status: 'blueprint_ready',
    blueprint,
    glossary,
    rollingSummary: {
      maxTokensBudget: 600,
      entries: [],
      compiledText: '',
    },
    coverageLedger,
    sectionsIR: {},
    quarantineQueue: [],
    telemetry: {
      totalPromptTokens: 0,
      cachedInputTokens: 0,
      totalOutputTokens: 0,
      cacheHits: 0,
      totalCalls: 0,
      estimatedCostUsd: 0,
      completedSections: 0,
      quarantinedSections: 0,
      pausedByBudgetCap: false,
      budgetCapMessage: null,
      lastModelUsed: null,
      lastUpdatedAt: now,
    },
    updatedAt: now,
  };
}

/**
 * Deterministic 100%-code converter from a single SemanticBlock into a ParsedBook ContentBlock
 * compatible with BookPreview, PrintPreviewModal (A4 RTL Vazir Medium), and docxGenerator (.docx).
 */
export function semanticBlockToContentBlock(
  block: SemanticBlock,
  chunkToFileName: Map<string, string>
): ContentBlock {
  const sourceFileNames = Array.from(
    new Set(
      (block.sourceChunkIds || [])
        .map((cid) => chunkToFileName.get(cid))
        .filter((name): name is string => Boolean(name))
    )
  );
  const provenance = {
    sourceUnitIds: [...(block.sourceChunkIds || [])],
    sourceFileNames: sourceFileNames.length > 0 ? sourceFileNames : undefined,
  };

  switch (block.kind) {
    case 'heading':
      return {
        type: 'subheading',
        id: block.id,
        level: 3,
        text: (block.text || block.title || '').trim(),
        ...provenance,
      };
    case 'callout_warning':
      return {
        type: 'callout',
        id: block.id,
        variant: 'warning',
        title: (block.title || 'هشدار فنی و ایمنی کالیبراسیون').trim(),
        paragraphs: [(block.text || '').trim()].filter(Boolean),
        ...provenance,
      };
    case 'callout_tip':
      return {
        type: 'callout',
        id: block.id,
        variant: 'engineering',
        title: (block.title || 'نکته مهندسی و کارگاهی').trim(),
        paragraphs: [(block.text || '').trim()].filter(Boolean),
        ...provenance,
      };
    case 'table':
      return {
        type: 'table',
        id: block.id,
        caption: (block.title || 'جدول فنی').trim(),
        headers: Array.isArray(block.headers) ? block.headers : [],
        rows: Array.isArray(block.rows) ? block.rows : [],
        generatedBy: 'ai',
        ...provenance,
      };
    case 'formula':
      return {
        type: 'equation',
        id: block.id,
        latex: (block.latex || block.text || '').trim(),
        readable: (block.readable || block.text || block.latex || '').trim(),
        ...provenance,
      };
    case 'step_list':
      return {
        type: 'list',
        id: block.id,
        ordered: true,
        items: (block.items || []).map((it) => it.trim()).filter(Boolean),
        ...provenance,
      };
    case 'source_gap_flag':
      return {
        type: 'callout',
        id: block.id,
        variant: 'warning',
        title: `[نقص در منبع ورودی] ${block.title || 'اطلاعات تکمیلی در فایل‌های خام ثبت نشده است'}`.trim(),
        paragraphs: [
          block.gapReason ? `علت: ${block.gapReason}` : '',
          block.missingInfo ? `داده مفقود: ${block.missingInfo}` : '',
          block.text || '',
        ].filter(Boolean),
        ...provenance,
      };
    case 'source_conflict_flag':
      return {
        type: 'callout',
        id: block.id,
        variant: 'warning',
        title: `[تناقض بین منابع ورودی] ${block.conflictTopic || block.title || 'اختلاف داده‌های فنی'}`.trim(),
        paragraphs: [
          block.conflictSourceA ? `روایت منبع اول: ${block.conflictSourceA}` : '',
          block.conflictSourceB ? `روایت منبع دوم: ${block.conflictSourceB}` : '',
          block.text || '',
        ].filter(Boolean),
        ...provenance,
      };
    case 'figure_ref':
      return {
        type: 'figure',
        id: block.id,
        caption: (block.caption || block.title || 'تصویر مرجع WinOLS').trim(),
        description: (block.text || `شناسه تصویر مرجع: ${block.assetId || 'نامشخص'}`).trim(),
        ...provenance,
      };
    case 'paragraph':
    default:
      return {
        type: 'paragraph',
        id: block.id,
        text: (block.text || '').trim(),
        ...provenance,
      };
  }
}

/**
 * Deterministic 100%-code compiler turning HarnessState Semantic IR into a full ParsedBook
 * ready for RTL A4 Print Preview (Vazir Medium) and standard .docx export.
 */
export function convertHarnessStateToParsedBook(params: {
  harnessState: HarnessState;
  projectTitle: string;
  sourceFiles: SourceFileDto[];
  contentUnits: ContentUnitDto[];
  existingBook?: ParsedBook | null;
}): ParsedBook {
  const { harnessState, projectTitle, sourceFiles, contentUnits, existingBook } = params;
  const fileNameById = new Map(sourceFiles.map((f) => [f.id, f.fileName]));
  const chunkToFileName = new Map<string, string>();
  const chunkTextById = new Map<string, string>();

  for (const unit of contentUnits) {
    chunkToFileName.set(unit.id, fileNameById.get(unit.sourceFileId) || 'منبع ورودی');
    chunkTextById.set(unit.id, unit.rawText);
  }

  const chapterGroups = new Map<
    string,
    { chapterOrder: number; chapterTitle: string; sections: BlueprintSection[] }
  >();

  for (const bpSec of harnessState.blueprint.sections) {
    const existing = chapterGroups.get(bpSec.chapterId);
    if (existing) {
      existing.sections.push(bpSec);
    } else {
      chapterGroups.set(bpSec.chapterId, {
        chapterOrder: bpSec.chapterOrder,
        chapterTitle: bpSec.chapterTitle,
        sections: [bpSec],
      });
    }
  }

  const sortedChapters = Array.from(chapterGroups.entries()).sort(
    (a, b) => a[1].chapterOrder - b[1].chapterOrder
  );

  const tableIndex: TableIndexEntry[] = [];
  let globalTableCounter = 0;

  const chapters: ChapterNode[] = sortedChapters.map(([chapterId, group], idx) => {
    const chapterNumber = idx + 1;
    const chapterFileNames = new Set<string>();

    const sections: SectionNode[] = group.sections
      .sort((a, b) => a.sectionOrder - b.sectionOrder)
      .map((bpSec, secIdx) => {
        const ir: SemanticSectionIR | undefined = harnessState.sectionsIR[bpSec.sectionId];
        let blocks: ContentBlock[] = [];

        if (ir && Array.isArray(ir.blocks) && ir.blocks.length > 0) {
          blocks = ir.blocks.map((blk) => semanticBlockToContentBlock(blk, chunkToFileName));
        } else {
          blocks = bpSec.sourceChunkIds.map((cid, cIdx) => {
            const fname = chunkToFileName.get(cid);
            if (fname) chapterFileNames.add(fname);
            return {
              type: 'paragraph',
              id: `raw-${bpSec.sectionId}-${cIdx + 1}`,
              text: chunkTextById.get(cid) || '',
              sourceUnitIds: [cid],
              sourceFileNames: fname ? [fname] : undefined,
            };
          });
        }

        const secFiles = new Set<string>();
        for (const blk of blocks) {
          for (const fn of blk.sourceFileNames || []) {
            secFiles.add(fn);
            chapterFileNames.add(fn);
          }
          if (blk.type === 'table') {
            globalTableCounter += 1;
            const tableNumber = `${toPersianDigits(chapterNumber)}-${toPersianDigits(globalTableCounter)}`;
            tableIndex.push({
              tableNumber,
              caption: blk.caption || `جدول ${tableNumber}`,
              chapterNumber,
              chapterTitle: group.chapterTitle,
              sectionTitle: bpSec.title,
              generatedBy: 'ai',
            });
          }
        }

        return {
          id: bpSec.sectionId,
          numberLabel: `${toPersianDigits(chapterNumber)}.${toPersianDigits(secIdx + 1)}`,
          title: ir?.title || bpSec.title,
          originalTitle: bpSec.title,
          sourceFileName: Array.from(secFiles)[0] || sourceFiles[0]?.fileName || 'منبع ورودی',
          sourceFileNames: Array.from(secFiles),
          blocks,
        };
      });

    return {
      id: chapterId,
      chapterNumber,
      title: group.chapterTitle,
      volumeIndex: 1,
      volumeTitle: 'جلد اول — نسخه تدوین‌شده با هارنس تخصصی ECU',
      meta: [
        {
          label: 'تعداد زیربخش',
          value: toPersianDigits(sections.length),
        },
        {
          label: 'منابع پوششی',
          value: toPersianDigits(Math.max(1, chapterFileNames.size)),
        },
      ],
      introBlocks: [],
      sections,
      sourceFileName: Array.from(chapterFileNames)[0] || sourceFiles[0]?.fileName || 'منبع ورودی',
    };
  });

  const glossary: GlossaryEntry[] = harnessState.glossary.entries.map((entry) => ({
    term: entry.canonicalTerm,
    definition:
      entry.definitionFa ||
      (entry.faEquivalents.length ? entry.faEquivalents.join('، ') : entry.canonicalTerm),
    chapters: [1],
  }));

  return {
    title: existingBook?.title || projectTitle || 'جزوه تخصصی ECU و WinOLS',
    subtitle:
      existingBook?.subtitle ||
      'تدوین‌شده با موتور هارنس مرحله‌محور، ممیزی قطعی لایه ۱ و حفظ صددرصدی جزئیات فنی',
    editionNote: `نسخه هارنس ${toPersianDigits(harnessState.blueprint.version)} · بدون حذف خاموش و بدون توهم فنی`,
    sourceFiles: sourceFiles.map((f) => f.fileName),
    volumes:
      existingBook?.volumes && existingBook.volumes.length > 0
        ? existingBook.volumes
        : [
            {
              id: 'vol-1',
              index: 1,
              title: 'جلد اول',
              subtitle: 'تدوین استاندارد و یکپارچه',
            },
          ],
    chapters,
    footnotes: existingBook?.footnotes || [],
    glossary: glossary.length > 0 ? glossary : existingBook?.glossary || [],
    tableIndex,
    cheatSheets: existingBook?.cheatSheets || [],
    visualSuggestions: existingBook?.visualSuggestions || [],
    sourceMapRows:
      existingBook?.sourceMapRows ||
      sourceFiles.map((f, idx) => [
        toPersianDigits(idx + 1),
        f.fileName,
        toPersianDigits(f.wordCount || 0),
        toPersianDigits(f.unitCount || 0),
      ]),
    audit: existingBook?.audit,
    aiReport: existingBook?.aiReport,
  };
}
