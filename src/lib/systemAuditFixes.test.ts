import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { isPrivateOrReservedIp } from '../server/aiProvider.ts';
import { sanitizeInventedHexInText, type TechnicalFactLedger } from './tokenOptimizer.ts';
import {
  findLeftoverImmutableTokens,
  maskTechnicalTokens,
  unmaskSemanticBlock,
} from './harness/deterministicMasking.ts';
import {
  resolveProviderCapabilityProfile,
  sanitizeOpenAiCompatiblePayload,
} from './harness/providerGuard.ts';
import { autoSplitOversizedBlueprintSections } from './harness/chunkingAndBlueprint.ts';
import { reconcileHarnessStates } from './harness/harnessStore.ts';
import type { BlueprintSection, HarnessSourceChunk, HarnessState } from './harness/types.ts';
import { parseAnySourceFile, parseDocxDocument } from './formatParsers.ts';
import {
  computeDescriptiveStats,
  parseNumericMeasurement,
} from './numericDiscrepancyAnalyzer.ts';
import { buildDiagramSvg, sanitizeSvgMarkup } from './diagramRenderer.ts';
import { enforceRtlOoxmlIntegrity } from './docxRtlPostProcessor.ts';
import { DEFAULT_DOCX_CONFIG, type ParsedBook } from './bookTypes.ts';
import {
  createProjectRecord,
  deleteProjectRecord,
  getOrCreateUser,
  getProjectBundle,
  insertSourceFileWithUnits,
  restoreProjectFromRevisionSnapshot,
  updateProjectRecord,
} from '../db/repository.ts';

describe('System Audit Fixes — Security, Harness, Parsers, RTL, and Rollback', () => {
  it('blocks private, reserved, multicast, and documentation IPv4/IPv6 ranges in SSRF guard', () => {
    assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('10.0.0.5'), true);
    assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
    assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
    assert.equal(isPrivateOrReservedIp('192.0.2.15'), true); // TEST-NET-1
    assert.equal(isPrivateOrReservedIp('198.18.0.1'), true); // Benchmarking
    assert.equal(isPrivateOrReservedIp('203.0.113.42'), true); // TEST-NET-3
    assert.equal(isPrivateOrReservedIp('224.0.0.1'), true); // Multicast
    assert.equal(isPrivateOrReservedIp('240.0.0.1'), true); // Reserved
    assert.equal(isPrivateOrReservedIp('ff02::1'), true); // IPv6 Multicast
    assert.equal(isPrivateOrReservedIp('2001:db8::1'), true); // IPv6 Documentation
    assert.equal(isPrivateOrReservedIp('::ffff:192.0.2.1'), true); // IPv4-mapped TEST-NET
    assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
    assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
  });

  it('sanitizes invented hex addresses using hex-digit boundaries without corrupting longer valid addresses', () => {
    const ledger: TechnicalFactLedger = {
      allowedNodeIds: new Set(['n1']),
      knownHexAddresses: new Set(['0x1A2B3C']),
      knownMapCodes: new Set<string>(),
      knownEcuModels: new Set<string>(),
    };
    const text = 'جدول معتبر در 0x1A2B3C است اما آدرس جعلی 0x1A2B نباید باقی بماند.';
    const result = sanitizeInventedHexInText(text, ledger);
    assert.ok(result.cleaned.includes('0x1A2B3C'), 'Valid longer hex 0x1A2B3C must remain intact');
    assert.ok(!/(?<![0-9A-Fa-f])0x1A2B(?![0-9A-Fa-f])/.test(result.cleaned), 'Invented shorter hex 0x1A2B must be removed');
    assert.ok(result.cleaned.includes('[آدرس هگز نیازمند بررسی در فایل منبع]'));
    assert.equal(result.inventedHex.length, 1);
  });

  it('masks CAN-bus U-code DTCs, unmasks conflict fields, and detects leftover immutable tokens', () => {
    const masked = maskTechnicalTokens('خطای شبکه U0100 و خطای سنسور P0135 در آدرس 0x1C200');
    assert.ok(!masked.maskedText.includes('U0100'), 'U0100 CAN-bus DTC must be masked');
    assert.ok(!masked.maskedText.includes('P0135'), 'P0135 DTC must be masked');
    assert.equal(findLeftoverImmutableTokens(masked.maskedText).length >= 3, true);

    const block = unmaskSemanticBlock(
      {
        id: 'b1',
        kind: 'source_conflict_flag',
        sourceChunkIds: ['c1'],
        text: masked.maskedText,
        conflictSourceA: masked.maskedText,
        conflictSourceB: `گزارش دوم: ${masked.maskedText}`,
      },
      masked.tokenMap
    );
    assert.ok(block.text?.includes('U0100'));
    assert.ok(block.conflictSourceA?.includes('U0100'));
    assert.ok(block.conflictSourceB?.includes('P0135'));
    assert.deepEqual(findLeftoverImmutableTokens(block.text || ''), []);
  });

  it('converts max_tokens to max_completion_tokens for native OpenAI reasoning models', () => {
    const profile = resolveProviderCapabilityProfile({
      provider: 'custom_openai',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'o3-mini',
    });
    const sanitized = sanitizeOpenAiCompatiblePayload({
      profile,
      rawPayload: {
        model: 'o3-mini',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 2048,
        temperature: 0.4,
      },
    });
    assert.equal(sanitized.payload.max_tokens, undefined);
    assert.equal(sanitized.payload.max_completion_tokens, 2048);
    assert.equal(sanitized.payload.temperature, undefined);
  });

  it('re-indexes sectionOrder sequentially per chapter after splitting oversized sections', () => {
    const makeChunk = (id: string, words: number): HarnessSourceChunk => ({
      id,
      fileName: 'ecu.md',
      headingPath: 'Chapter 1',
      text: Array.from({ length: words }, (_, i) => `پارامتر_${i}`).join(' '),
      wordCount: words,
      ecuPlatformTags: ['ME7.4.4'],
    });
    const c1 = makeChunk('c1', 700);
    const c2 = makeChunk('c2', 700);
    const c3 = makeChunk('c3', 100);
    const chunkById = new Map<string, HarnessSourceChunk>([
      ['c1', c1],
      ['c2', c2],
      ['c3', c3],
    ]);
    const sections: BlueprintSection[] = [
      {
        sectionId: 'sec_1',
        chapterId: 'ch_1',
        chapterOrder: 1,
        chapterTitle: 'فصل اول',
        sectionOrder: 1,
        title: 'بخش بزرگ',
        sourceChunkIds: ['c1', 'c2'],
        sourceWordCount: 1400,
        estimatedInputTokens: 2800,
        estimatedOutputTokens: 1400,
        estimatedCostUsd: 0.01,
        ecuPlatformTags: ['ME7.4.4'],
      },
      {
        sectionId: 'sec_2',
        chapterId: 'ch_1',
        chapterOrder: 1,
        chapterTitle: 'فصل اول',
        sectionOrder: 2,
        title: 'بخش دوم',
        sourceChunkIds: ['c3'],
        sourceWordCount: 100,
        estimatedInputTokens: 200,
        estimatedOutputTokens: 150,
        estimatedCostUsd: 0.002,
        ecuPlatformTags: ['ME7.4.4'],
      },
    ];
    const split = autoSplitOversizedBlueprintSections({
      sections,
      chunkById,
      maxSectionInputTokens: 1200,
    });
    assert.ok(split.length >= 3, 'Oversized section should split into multiple parts');
    assert.deepEqual(
      split.map((s) => s.sectionOrder),
      split.map((_, i) => i + 1),
      'sectionOrder must remain strictly sequential 1..N within chapter'
    );
  });

  it('prefers authoritatively reset cloudState over stale local IndexedDB state during reconciliation', () => {
    const baseBlueprint = {
      version: 1,
      approved: true,
      approvedAt: '2026-01-01T00:00:00.000Z',
      frozenGlossaryVersion: 1,
      budgetCapUsd: 5,
      totalSections: 1,
      totalChunks: 1,
      totalSourceWords: 100,
      estimatedTotalCostUsd: 0.05,
      estimatedSavingsPercent: 60,
      sourceCorpusHash: 'hash_abc',
      sections: [],
    };
    const olderLocal = {
      projectId: 'p1',
      status: 'running',
      updatedAt: '2026-01-01T00:00:10.000Z',
      blueprint: baseBlueprint,
      sectionsIR: {
        sec_1: {
          sectionId: 'sec_1',
          chapterId: 'ch_1',
          title: 'سکش قدیمی',
          sourceChunkIds: ['c1'],
          generatedAt: '2026-01-01T00:00:10.000Z',
          modelUsed: 'gemini-3-flash',
          tierUsed: 'balanced',
          blocks: [{ id: 'b1', kind: 'paragraph', sourceChunkIds: ['c1'], text: 'old' }],
        },
      },
      coverageLedger: {
        byChunkId: {},
        bySectionId: {
          sec_1: {
            sectionId: 'sec_1',
            chapterId: 'ch_1',
            status: 'verified',
            attempts: 1,
            layer1Passed: true,
            layer2Passed: true,
            lastUpdatedAt: '2026-01-01T00:00:10.000Z',
          },
        },
      },
      quarantineQueue: [],
      glossary: { version: 1, frozen: true, entries: [], deltaEntries: [], updatedAt: '2026-01-01T00:00:10.000Z' },
      rollingSummary: { maxTokensBudget: 600, entries: [], compiledText: '', updatedAt: '2026-01-01T00:00:10.000Z' },
      budgetLedger: { budgetCapUsd: 5, totalSpentUsd: 0.01, entries: [] },
      logs: [],
    } as unknown as HarnessState;

    const newerCloud = {
      ...olderLocal,
      status: 'idle',
      updatedAt: '2026-01-01T00:01:00.000Z', // 50s newer after server rollback/reset
      sectionsIR: {},
      coverageLedger: { byChunkId: {}, bySectionId: {} },
    } as unknown as HarnessState;

    const merged = reconcileHarnessStates(newerCloud, olderLocal);
    assert.equal(Object.keys(merged?.sectionsIR || {}).length, 0, 'Stale local sections must not resurrect after server reset');
  });

  it('preserves DOCX Heading2 as section (##) and parses RFC-4180 CSV + HTML tables cleanly', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>فصل اول سیستم سوخت</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>بخش ۱-۱ تنظیم AFR</w:t></w:r></w:p>
          <w:p><w:r><w:t>مقدار استوکیومتری 14.7 است.</w:t></w:r></w:p>
        </w:body>
      </w:document>`
    );
    const docxBytes = await zip.generateAsync({ type: 'uint8array' });
    const parsedDocx = await parseDocxDocument(docxBytes, 'ecu.docx');
    assert.equal(parsedDocx.chapters.length, 1, 'Heading1 should create 1 chapter while non-chapter Heading2 becomes a subsection');
    assert.ok(parsedDocx.chapters[0].sections.some((s) => s.title.includes('تنظیم AFR')));

    const csvRes = await parseAnySourceFile({
      name: 'maps.csv',
      format: 'csv',
      text: '\uFEFF"Map Name","Notes","AFR"\n"Fuel ""Main""","Line 1\nLine 2","14.7"',
    });
    const csvJson = JSON.stringify(csvRes.chapters);
    assert.ok(csvJson.includes('Fuel \\"Main\\"') || csvJson.includes('Fuel "Main"'), 'Escaped CSV quotes must unescape properly');
    assert.ok(csvJson.includes('Line 1 Line 2'), 'Multiline quoted CSV cell must stay in single row');

    const htmlRes = await parseAnySourceFile({
      name: 'spec.html',
      format: 'html',
      text: '<html><body><h1>ECU Specs</h1><table><tr><th>Param</th><th>Value</th></tr><tr><td>AFR</td><td>14.7</td></tr></table></body></html>',
    });
    const hasTableBlock = htmlRes.chapters.some((c) => {
      const allBlocks = [...c.introBlocks, ...c.sections.flatMap((s) => s.blocks)];
      return allBlocks.some((b) => b.type === 'table' && b.headers.includes('Param'));
    });
    assert.equal(hasTableBlock, true, 'HTML table must convert into a structured table block');
  });

  it('parses decimal commas vs thousands commas accurately and computes order-independent percentDiff', () => {
    const decComma = parseNumericMeasurement('14,7', 'AFR');
    assert.equal(decComma?.numericValue, 14.7);
    const thousands = parseNumericMeasurement('1,250', 'RPM');
    assert.equal(thousands?.numericValue, 1250);

    const s1 = computeDescriptiveStats([4.0, 5.2]);
    const s2 = computeDescriptiveStats([5.2, 4.0]);
    assert.equal(s1.percentDiff, 30);
    assert.equal(s2.percentDiff, 30);
  });

  it('never fabricates synthetic chart numbers and strips XSS vectors from SVG markup', () => {
    const svgNoNums = buildDiagramSvg(
      'comparison_bars',
      'مقایسه مراحل',
      [
        { label: 'مرحله اول', detail: 'توضیح بدون عدد' },
        { label: 'مرحله دوم', detail: 'توضیح دوم' },
      ],
      'فایل تست'
    );
    // Falls back to process_steps instead of inventing fake bar numbers
    assert.ok(!svgNoNums.includes('>36<'), 'Must not invent synthetic bar numbers');

    const dirtySvg =
      '<svg onload="alert(1)"><script>alert(2)</script><foreignObject><div>bad</div></foreignObject><a href="javascript:evil()"><text onclick="hack()">ok</text></a></svg>';
    const cleanSvg = sanitizeSvgMarkup(dirtySvg);
    assert.ok(!cleanSvg.includes('<script'), 'script tag must be stripped');
    assert.ok(!cleanSvg.includes('foreignObject'), 'foreignObject must be stripped');
    assert.ok(!cleanSvg.includes('onload='), 'inline event handlers must be stripped');
    assert.ok(!cleanSvg.includes('javascript:'), 'javascript: URI must be stripped');
  });

  it('injects <w:bidi/> into header/footer paragraphs even when <w:pPr> was originally absent', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>متن</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    );
    zip.file(
      'word/header1.xml',
      `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>سرصفحه بدون pPr</w:t></w:r></w:p></w:hdr>`
    );
    const rawBytes = await zip.generateAsync({ type: 'uint8array' });
    const minimalBook: ParsedBook = {
      title: 'کتاب تست',
      subtitle: '',
      editionNote: '',
      volumes: [],
      chapters: [],
      glossary: [],
      footnotes: [],
      tableIndex: [],
      cheatSheets: [],
      visualSuggestions: [],
      sourceMapRows: [],
      sourceFiles: [],
    };
    const processed = await enforceRtlOoxmlIntegrity(rawBytes, minimalBook, DEFAULT_DOCX_CONFIG);
    const outZip = await JSZip.loadAsync(processed);
    const headerXml = await outZip.file('word/header1.xml')!.async('string');
    assert.ok(headerXml.includes('<w:pPr><w:bidi/></w:pPr>'), 'Header paragraph without pPr must receive <w:pPr><w:bidi/></w:pPr>');
  });

  it('restores checkpointJson while preserving aiUsage and prunes post-snapshot content units on rollback', async () => {
    const projectId = `proj-rollback-${Date.now()}`;
    const ownerUid = 'test-rollback-uid';
    await getOrCreateUser(ownerUid, 'rollback-test@example.com', 'Rollback Test');
    await createProjectRecord({
      id: projectId,
      ownerUid,
      title: 'پروژه تست بازگشت',
      workflowMode: 'book_strict',
    });

    try {
      const unit1Id = `${projectId}-u1`;
      const unit2Id = `${projectId}-u2`;

      await insertSourceFileWithUnits({
        file: {
          id: `${projectId}-sf1`,
          projectId,
          fileName: 'f1.md',
          format: 'md',
          sizeBytes: 100,
          wordCount: 5,
          fileHash: 'h1',
        },
        units: [
          {
            id: unit1Id,
            projectId,
            sourceFileId: `${projectId}-sf1`,
            unitOrder: 1,
            unitType: 'paragraph',
            rawText: 'بند یک',
            contentHash: 'nh1',
            status: 'unique',
            payloadJson: {},
          },
        ],
      });

      // Add a second unit AFTER the snapshot point
      await insertSourceFileWithUnits({
        file: {
          id: `${projectId}-sf2`,
          projectId,
          fileName: 'f2.md',
          format: 'md',
          sizeBytes: 100,
          wordCount: 5,
          fileHash: 'h2',
        },
        units: [
          {
            id: unit2Id,
            projectId,
            sourceFileId: `${projectId}-sf2`,
            unitOrder: 2,
            unitType: 'paragraph',
            rawText: 'بند جدید پس از نسخه',
            contentHash: 'nh2',
            status: 'unique',
            payloadJson: {},
          },
        ],
      });

      // Persist aiUsage recorded on current project
      await updateProjectRecord(projectId, ownerUid, {
        checkpointJson: {
          aiUsage: { totalTokens: 9999 },
          lastDeepReview: { score: 80 },
        },
      });

      await restoreProjectFromRevisionSnapshot(projectId, ownerUid, {
        schemaVersion: 1,
        title: 'عنوان نسخه ۱',
        workflowMode: 'book_strict',
        pipelineStage: 2,
        status: 'audited',
        settingsJson: {},
        checkpointJson: { lastDeepReview: { score: 95 } },
        bookSnapshotJson: null,
        outlineNodes: [],
        contentUnits: [
          {
            id: unit1Id,
            status: 'unique',
            outlineNodeId: null,
            canonicalUnitId: null,
            rawText: 'بند یک',
          },
        ],
        conflicts: [],
      });

      const bundleAfter = await getProjectBundle(projectId, ownerUid);
      assert.ok(bundleAfter);
      assert.equal(bundleAfter.contentUnits.length, 1, 'Post-snapshot content units must be pruned on rollback');
      assert.equal(bundleAfter.contentUnits[0].id, unit1Id);

      const cp = bundleAfter.project.checkpointJson as Record<string, unknown>;
      assert.deepEqual(cp.lastDeepReview, { score: 95 }, 'Snapshot checkpointJson must be restored');
      assert.deepEqual(cp.aiUsage, { totalTokens: 9999 }, 'Cumulative aiUsage ledger must be preserved');
    } finally {
      await deleteProjectRecord(projectId, ownerUid).catch(() => {});
    }
  });
});
