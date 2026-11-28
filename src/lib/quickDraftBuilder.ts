import type {
  ContentUnitDto,
  OutlineNodeDto,
  SourceFileDto,
} from './bookTypes.ts';
import { toPersianDigits } from './formatParsers.ts';
import { countWordsAccurate } from './workspaceInsights.ts';
import { normalizePersianForComparison } from './zeroLossPipeline.ts';

export type QuickDraftStrategy = 'heading_tree' | 'by_source_file';

export interface QuickDraftBlockCounts {
  paragraphs: number;
  tables: number;
  callouts: number;
  lists: number;
  equations: number;
  other: number;
}

export interface QuickDraftHeadingNode {
  id: string;
  title: string;
  depth: number;
  unitCount: number;
  directUnitCount: number;
  wordCount: number;
  sourceFileNames: string[];
  blockCounts: QuickDraftBlockCounts;
  firstSnippet: string;
  children: QuickDraftHeadingNode[];
}

export interface QuickDraftChapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  sourceFileIds: string[];
  sourceFileNames: string[];
  unitCount: number;
  directUnitCount: number;
  subsectionCount: number;
  wordCount: number;
  sharePercent: number;
  blockCounts: QuickDraftBlockCounts;
  leadExcerpt: string;
  tree: QuickDraftHeadingNode[];
  unitIds: string[];
}

export interface QuickDraftSummary {
  totalSourceFiles: number;
  totalChapters: number;
  totalSubsections: number;
  totalActiveUnits: number;
  totalMergedUnits: number;
  totalWords: number;
  coveragePercent: number;
  estimatedReadingMinutes: number;
  hasHierarchicalHeadings: boolean;
}

export interface QuickDraftResult {
  strategy: QuickDraftStrategy;
  projectTitle: string;
  generatedAt: string;
  summary: QuickDraftSummary;
  chapters: QuickDraftChapter[];
  outlineNodes: OutlineNodeDto[];
  unitAssignments: Array<{ unitId: string; outlineNodeId: string }>;
  outlineMarkdown: string;
}

function emptyBlockCounts(): QuickDraftBlockCounts {
  return {
    paragraphs: 0,
    tables: 0,
    callouts: 0,
    lists: 0,
    equations: 0,
    other: 0,
  };
}

function addBlockCount(counts: QuickDraftBlockCounts, unitType: string | null | undefined): void {
  const normalized = (unitType || 'paragraph').toLowerCase();
  if (normalized === 'paragraph' || normalized === 'subheading') {
    counts.paragraphs += 1;
  } else if (normalized === 'table') {
    counts.tables += 1;
  } else if (normalized === 'callout') {
    counts.callouts += 1;
  } else if (normalized === 'list') {
    counts.lists += 1;
  } else if (normalized === 'equation') {
    counts.equations += 1;
  } else {
    counts.other += 1;
  }
}

export function cleanSourceFileLabel(fileName: string | null | undefined, fallbackIndex = 1): string {
  const raw = (fileName || '').trim();
  if (!raw) return `فایل منبع ${toPersianDigits(fallbackIndex)}`;
  const stripped = raw
    .replace(/\.(docx|pdf|md|markdown|txt|json|csv|html|htm)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || raw;
}

export function parseHeadingTreeSegments(headingPath: string | null | undefined): string[] {
  if (!headingPath) return [];
  const rawParts = headingPath
    .split(/\s*(?:>|»|›)\s*/)
    .map((part) => part.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 2);

  const deduped: string[] = [];
  for (const part of rawParts) {
    const prev = deduped[deduped.length - 1];
    if (prev && normalizePersianForComparison(prev) === normalizePersianForComparison(part)) {
      continue;
    }
    deduped.push(part);
  }
  return deduped;
}

function buildConciseSnippet(rawText: string | null | undefined, maxLen = 135): string {
  if (!rawText) return '';
  const cleaned = rawText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trim()}…`;
}

interface MutableHeadingNode {
  id: string;
  title: string;
  normKey: string;
  depth: number;
  directUnitCount: number;
  unitCount: number;
  wordCount: number;
  sourceFileNames: Set<string>;
  blockCounts: QuickDraftBlockCounts;
  firstSnippet: string;
  children: MutableHeadingNode[];
  childByNorm: Map<string, MutableHeadingNode>;
}

interface MutableChapterBucket {
  id: string;
  title: string;
  normKey: string;
  sourceFileIds: Set<string>;
  sourceFileNames: Set<string>;
  unitIds: string[];
  directUnitCount: number;
  wordCount: number;
  blockCounts: QuickDraftBlockCounts;
  leadExcerpt: string;
  rootChildren: MutableHeadingNode[];
  rootChildByNorm: Map<string, MutableHeadingNode>;
  nextNodeSeq: number;
}

function finalizeHeadingTree(nodes: MutableHeadingNode[]): {
  tree: QuickDraftHeadingNode[];
  totalDescendants: number;
} {
  let totalDescendants = 0;
  const finalized: QuickDraftHeadingNode[] = nodes.map((node) => {
    const childRes = finalizeHeadingTree(node.children);
    totalDescendants += 1 + childRes.totalDescendants;
    const childUnits = childRes.tree.reduce((sum, c) => sum + c.unitCount, 0);
    const childWords = childRes.tree.reduce((sum, c) => sum + c.wordCount, 0);

    return {
      id: node.id,
      title: node.title,
      depth: node.depth,
      directUnitCount: node.directUnitCount,
      unitCount: node.directUnitCount + childUnits,
      wordCount: node.wordCount + childWords,
      sourceFileNames: Array.from(node.sourceFileNames),
      blockCounts: { ...node.blockCounts },
      firstSnippet: node.firstSnippet,
      children: childRes.tree,
    };
  });

  return { tree: finalized, totalDescendants };
}

function formatChapterSummaryFa(params: {
  unitCount: number;
  wordCount: number;
  subsectionCount: number;
  sourceFileNames: string[];
}): string {
  const parts: string[] = [
    `${toPersianDigits(params.unitCount)} واحد محتوایی`,
    `${toPersianDigits(params.wordCount.toLocaleString('en-US'))} کلمه`,
  ];
  if (params.subsectionCount > 0) {
    parts.push(`${toPersianDigits(params.subsectionCount)} زیربخش درختی`);
  }
  if (params.sourceFileNames.length === 1) {
    parts.push(`منبع: ${params.sourceFileNames[0]}`);
  } else if (params.sourceFileNames.length > 1) {
    parts.push(`از ${toPersianDigits(params.sourceFileNames.length)} فایل منبع`);
  }
  return parts.join(' · ');
}

function renderHeadingTreeMarkdown(
  nodes: QuickDraftHeadingNode[],
  lines: string[],
  indentLevel = 0
): void {
  const indent = '  '.repeat(indentLevel);
  for (const node of nodes) {
    lines.push(
      `${indent}- **${node.title}** (${toPersianDigits(node.unitCount)} واحد · ${toPersianDigits(node.wordCount)} کلمه)`
    );
    if (node.children.length > 0) {
      renderHeadingTreeMarkdown(node.children, lines, indentLevel + 1);
    }
  }
}

/**
 * Deterministically builds an instant, zero-wait initial chapter draft structure
 * in Stage 3 directly from extracted source files and hierarchical heading paths.
 *
 * Guarantees 100% lossless accounting of all active ContentUnits without invoking
 * slow AI Deep Review, Harness execution, or Google web enrichment.
 */
export function buildQuickDraftStructure(params: {
  projectId: string;
  projectTitle: string;
  sourceFiles: SourceFileDto[];
  contentUnits: ContentUnitDto[];
  strategy?: QuickDraftStrategy;
}): QuickDraftResult {
  const {
    projectId,
    projectTitle,
    sourceFiles,
    contentUnits,
    strategy = 'heading_tree',
  } = params;

  const fileOrderMap = new Map<string, number>();
  const fileById = new Map<string, SourceFileDto>();
  sourceFiles.forEach((f, idx) => {
    fileOrderMap.set(f.id, idx);
    fileById.set(f.id, f);
  });

  const activeUnits = contentUnits
    .filter((u) => u.status !== 'merged')
    .sort((a, b) => {
      const fa = fileOrderMap.get(a.sourceFileId) ?? Number.MAX_SAFE_INTEGER;
      const fb = fileOrderMap.get(b.sourceFileId) ?? Number.MAX_SAFE_INTEGER;
      if (fa !== fb) return fa - fb;
      return a.unitOrder - b.unitOrder;
    });

  const totalMergedUnits = contentUnits.length - activeUnits.length;

  const buckets: MutableChapterBucket[] = [];
  const bucketByNorm = new Map<string, MutableChapterBucket>();
  let hasHierarchicalHeadings = false;

  const getOrCreateBucket = (key: string, displayTitle: string): MutableChapterBucket => {
    const existing = bucketByNorm.get(key);
    if (existing) {
      if (
        displayTitle.length > existing.title.length &&
        displayTitle.length <= 80 &&
        existing.title.length < 18
      ) {
        existing.title = displayTitle;
      }
      return existing;
    }

    const bucketId = `qdraft_${projectId}_${buckets.length + 1}`;
    const created: MutableChapterBucket = {
      id: bucketId,
      title: displayTitle,
      normKey: key,
      sourceFileIds: new Set<string>(),
      sourceFileNames: new Set<string>(),
      unitIds: [],
      directUnitCount: 0,
      wordCount: 0,
      blockCounts: emptyBlockCounts(),
      leadExcerpt: '',
      rootChildren: [],
      rootChildByNorm: new Map<string, MutableHeadingNode>(),
      nextNodeSeq: 1,
    };
    buckets.push(created);
    bucketByNorm.set(key, created);
    return created;
  };

  for (const unit of activeUnits) {
    const sourceFile = fileById.get(unit.sourceFileId);
    const fileIndex = (fileOrderMap.get(unit.sourceFileId) ?? 0) + 1;
    const rawFileName = sourceFile?.fileName || `فایل ${toPersianDigits(fileIndex)}`;
    const cleanFileTitle = cleanSourceFileLabel(sourceFile?.fileName, fileIndex);
    const segments = parseHeadingTreeSegments(unit.headingPath);

    if (segments.length >= 2) {
      hasHierarchicalHeadings = true;
    }

    let chapterTitle: string;
    let chapterKey: string;
    let subSegments: string[];

    if (strategy === 'by_source_file') {
      chapterTitle = cleanFileTitle;
      chapterKey = `file::${unit.sourceFileId}`;
      subSegments = segments;
      if (segments.length >= 1) {
        hasHierarchicalHeadings = true;
      }
    } else {
      chapterTitle = segments[0] || cleanFileTitle;
      const normTitle = normalizePersianForComparison(chapterTitle);
      chapterKey = normTitle || `file::${unit.sourceFileId}`;
      subSegments = segments.slice(1);
    }

    const bucket = getOrCreateBucket(chapterKey, chapterTitle);
    const words = countWordsAccurate(unit.rawText);
    const snippet = buildConciseSnippet(unit.rawText);

    bucket.sourceFileIds.add(unit.sourceFileId);
    bucket.sourceFileNames.add(rawFileName);
    bucket.unitIds.push(unit.id);
    bucket.wordCount += words;
    addBlockCount(bucket.blockCounts, unit.unitType);
    if (!bucket.leadExcerpt && snippet) {
      bucket.leadExcerpt = snippet;
    }

    if (subSegments.length === 0) {
      bucket.directUnitCount += 1;
      continue;
    }

    let currentChildren = bucket.rootChildren;
    let currentMap = bucket.rootChildByNorm;
    let leafNode: MutableHeadingNode | null = null;

    for (let depthIdx = 0; depthIdx < subSegments.length; depthIdx++) {
      const segTitle = subSegments[depthIdx];
      const segNorm = normalizePersianForComparison(segTitle) || segTitle.toLowerCase();
      let node = currentMap.get(segNorm);
      if (!node) {
        node = {
          id: `${bucket.id}_h_${bucket.nextNodeSeq++}`,
          title: segTitle,
          normKey: segNorm,
          depth: depthIdx + 2,
          directUnitCount: 0,
          unitCount: 0,
          wordCount: 0,
          sourceFileNames: new Set<string>(),
          blockCounts: emptyBlockCounts(),
          firstSnippet: '',
          children: [],
          childByNorm: new Map<string, MutableHeadingNode>(),
        };
        currentChildren.push(node);
        currentMap.set(segNorm, node);
      }
      node.sourceFileNames.add(rawFileName);
      leafNode = node;
      currentChildren = node.children;
      currentMap = node.childByNorm;
    }

    if (leafNode) {
      leafNode.directUnitCount += 1;
      leafNode.wordCount += words;
      addBlockCount(leafNode.blockCounts, unit.unitType);
      if (!leafNode.firstSnippet && snippet) {
        leafNode.firstSnippet = snippet;
      }
    }
  }

  // Fallback chapter if files exist without extracted units yet
  if (buckets.length === 0 && sourceFiles.length > 0) {
    sourceFiles.forEach((f, idx) => {
      const title = cleanSourceFileLabel(f.fileName, idx + 1);
      const bucket = getOrCreateBucket(`file::${f.id}`, title);
      bucket.sourceFileIds.add(f.id);
      bucket.sourceFileNames.add(f.fileName);
    });
  }

  if (buckets.length === 0) {
    getOrCreateBucket('default_ch_1', 'فصل اول — ساختار اولیه سند');
  }

  const totalWords = buckets.reduce((sum, b) => sum + b.wordCount, 0);
  let totalSubsections = 0;

  const chapters: QuickDraftChapter[] = buckets.map((bucket, idx) => {
    const { tree, totalDescendants } = finalizeHeadingTree(bucket.rootChildren);
    totalSubsections += totalDescendants;
    const sourceFileNames = Array.from(bucket.sourceFileNames);
    const sharePercent =
      totalWords > 0 ? Math.round((bucket.wordCount / totalWords) * 1000) / 10 : 0;

    return {
      id: bucket.id,
      order: idx + 1,
      title: bucket.title,
      summary: formatChapterSummaryFa({
        unitCount: bucket.unitIds.length,
        wordCount: bucket.wordCount,
        subsectionCount: totalDescendants,
        sourceFileNames,
      }),
      sourceFileIds: Array.from(bucket.sourceFileIds),
      sourceFileNames,
      unitCount: bucket.unitIds.length,
      directUnitCount: bucket.directUnitCount,
      subsectionCount: totalDescendants,
      wordCount: bucket.wordCount,
      sharePercent,
      blockCounts: { ...bucket.blockCounts },
      leadExcerpt: bucket.leadExcerpt,
      tree,
      unitIds: [...bucket.unitIds],
    };
  });

  const outlineNodes: OutlineNodeDto[] = chapters.map((ch) => ({
    id: ch.id,
    projectId,
    parentId: null,
    level: 1,
    nodeOrder: ch.order,
    title: ch.title,
    summary: ch.summary,
    isApproved: false,
    webEnrichmentJson: null,
  }));

  const unitToChapterId = new Map<string, string>();
  const unitAssignments: Array<{ unitId: string; outlineNodeId: string }> = [];

  for (const ch of chapters) {
    for (const unitId of ch.unitIds) {
      unitToChapterId.set(unitId, ch.id);
      unitAssignments.push({ unitId, outlineNodeId: ch.id });
    }
  }

  // Keep merged units aligned with their canonical unit's new chapter node when possible
  for (const u of contentUnits) {
    if (u.status === 'merged' && u.canonicalUnitId) {
      const canonicalChapterId = unitToChapterId.get(u.canonicalUnitId);
      if (canonicalChapterId) {
        unitAssignments.push({ unitId: u.id, outlineNodeId: canonicalChapterId });
      }
    }
  }

  const mdLines: string[] = [];
  mdLines.push(`# پیش‌نویس سریع ساختار: ${projectTitle || 'سند یکپارچه'}`);
  mdLines.push('');
  mdLines.push(
    `> تولیدشده به‌صورت آنی بر اساس ${toPersianDigits(sourceFiles.length)} فایل استخراج‌شده، ${toPersianDigits(chapters.length)} فصل اولیه و ${toPersianDigits(totalSubsections)} زیربخش درختی (${toPersianDigits(totalWords)} کلمه — پوشش ۱۰۰٪).`
  );
  mdLines.push('');

  for (const ch of chapters) {
    mdLines.push(`## فصل ${toPersianDigits(ch.order)}: ${ch.title}`);
    mdLines.push(`_${ch.summary}_`);
    if (ch.tree.length > 0) {
      renderHeadingTreeMarkdown(ch.tree, mdLines, 0);
    } else if (ch.leadExcerpt) {
      mdLines.push(`- پیش‌نمایش آغازین: ${ch.leadExcerpt}`);
    }
    mdLines.push('');
  }

  return {
    strategy,
    projectTitle: projectTitle || 'سند یکپارچه',
    generatedAt: new Date().toISOString(),
    summary: {
      totalSourceFiles: sourceFiles.length,
      totalChapters: chapters.length,
      totalSubsections,
      totalActiveUnits: activeUnits.length,
      totalMergedUnits,
      totalWords,
      coveragePercent: activeUnits.length > 0 ? 100 : 0,
      estimatedReadingMinutes: totalWords > 0 ? Math.max(1, Math.round(totalWords / 200)) : 0,
      hasHierarchicalHeadings,
    },
    chapters,
    outlineNodes,
    unitAssignments,
    outlineMarkdown: mdLines.join('\n').trim(),
  };
}
