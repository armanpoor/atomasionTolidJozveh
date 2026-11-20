import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import {
  DEFAULT_DOCX_CONFIG,
  DEFAULT_OPTIMIZATION_OPTIONS,
} from './bookTypes.ts';
import {
  mergeParsedBooks,
  parseDocxDocument,
  parseJsonDocument,
  parseMarkdownDocument,
} from './formatParsers.ts';
import { optimizeBook } from './bookOptimizer.ts';
import { generateDocxUint8Array } from './docxGenerator.ts';

const SOURCE_MD_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/BOOK_DAY01_04_Final.docx_07da70df.md'
);

test('parses full 1.5MB ECU reference markdown book without loss', () => {
  const raw = fs.readFileSync(SOURCE_MD_PATH, 'utf8');
  const parsed = parseMarkdownDocument(raw, 'BOOK_DAY01_04_Final.docx.md');

  assert.equal(parsed.volumes.length, 2, 'Expected 2 volumes');
  assert.equal(parsed.chapters.length, 22, 'Expected 22 chapters');
  assert.equal(parsed.footnotes.length, 287, 'Expected 287 raw footnotes');
  assert.ok(parsed.glossary.length > 50, 'Expected Appendix A glossary entries');

  // Verify callout boxes and tables were extracted
  let calloutCount = 0;
  let tableCount = 0;
  let equationCount = 0;
  for (const ch of parsed.chapters) {
    const blocks = [...ch.introBlocks, ...ch.sections.flatMap((s) => s.blocks)];
    for (const b of blocks) {
      if (b.type === 'callout') calloutCount++;
      if (b.type === 'table') tableCount++;
      if (b.type === 'equation') equationCount++;
    }
  }
  assert.ok(calloutCount >= 350, `Expected >= 350 callout boxes, got ${calloutCount}`);
  assert.ok(tableCount >= 90, `Expected >= 90 data tables, got ${tableCount}`);
  assert.ok(equationCount >= 80, `Expected >= 80 equations, got ${equationCount}`);
});

test('optimizes full book with 100% concept retention, footnote deduplication, table renumbering, and artifact repair', () => {
  const raw = fs.readFileSync(SOURCE_MD_PATH, 'utf8');
  const parsed = parseMarkdownDocument(raw, 'BOOK_DAY01_04_Final.docx.md');
  const optimized = optimizeBook(parsed, DEFAULT_OPTIMIZATION_OPTIONS);

  assert.ok(optimized.audit, 'Expected audit report');
  const audit = optimized.audit!;

  // 100% Concept Retention Guarantee
  assert.equal(audit.conceptRetentionRate, 100, 'Every key engineering concept must be 100% preserved');
  assert.ok(audit.conceptChecks.length >= 15, 'Should verify at least 15 domain concepts');
  for (const chk of audit.conceptChecks) {
    assert.equal(chk.preserved, true, `Concept ${chk.token} was dropped!`);
  }

  // Footnote deduplication
  assert.ok(audit.duplicateFootnotesMerged >= 60, `Expected >= 60 duplicate footnotes merged, got ${audit.duplicateFootnotesMerged}`);
  assert.ok(optimized.footnotes.length < 230, `Expected < 230 unique footnotes, got ${optimized.footnotes.length}`);

  // Unnumbered sections fixed
  assert.ok(audit.unnumberedSectionsFixed >= 20, `Expected >= 20 unnumbered sections fixed, got ${audit.unnumberedSectionsFixed}`);

  // Tables sequentially renumbered with zero collisions
  assert.ok(audit.tablesRenumbered >= 50, `Expected >= 50 tables renumbered, got ${audit.tablesRenumbered}`);
  const tableNumbers = optimized.tableIndex.map((t) => t.tableNumber);
  assert.equal(new Set(tableNumbers).size, tableNumbers.length, 'All renumbered table numbers must be unique');

  // Visual suggestions generated
  assert.ok(optimized.visualSuggestions.length >= 20, `Expected >= 20 visual suggestions, got ${optimized.visualSuggestions.length}`);

  // "تیونررش" OCR artifact repaired
  const allText = JSON.stringify(optimized.chapters) + JSON.stringify(optimized.footnotes);
  assert.ok(!allText.includes('تیونررش'), 'Expected تیونررش OCR artifact to be repaired');
  assert.ok(!allText.includes('Δheta'), 'Expected Δheta LaTeX typo to be repaired');
});

test('generates valid RTL Vazir Medium .docx with Heading1-4, Auto TOC, updateFields, and round-trips through parseDocxDocument', async () => {
  const raw = fs.readFileSync(SOURCE_MD_PATH, 'utf8');
  const parsed = parseMarkdownDocument(raw, 'BOOK_DAY01_04_Final.docx.md');
  const optimized = optimizeBook(parsed, DEFAULT_OPTIMIZATION_OPTIONS);

  const bytes = await generateDocxUint8Array(optimized, DEFAULT_DOCX_CONFIG);
  assert.ok(bytes.byteLength > 100_000, `Expected substantial .docx binary, got ${bytes.byteLength} bytes`);

  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file('word/document.xml')?.async('string');
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const settingsXml = await zip.file('word/settings.xml')?.async('string');

  assert.ok(docXml, 'word/document.xml must exist');
  assert.ok(stylesXml, 'word/styles.xml must exist');
  assert.ok(settingsXml, 'word/settings.xml must exist');

  // Check Vazir Medium font across ASCII & Complex Script (cs)
  assert.ok(stylesXml!.includes('Vazir Medium'), 'styles.xml must specify Vazir Medium');
  assert.ok(docXml!.includes('w:cs="Vazir Medium"'), 'document.xml must apply Vazir Medium to complex script (w:cs)');

  // Check RTL / BiDi
  assert.ok(docXml!.includes('<w:bidi/>') || docXml!.includes('<w:bidi '), 'document.xml must enable RTL bidi');
  assert.ok(docXml!.includes('<w:rtl/>') || docXml!.includes('<w:rtl '), 'document.xml must enable RTL runs');
  assert.ok(docXml!.includes('<w:bidiVisual/>'), 'Tables must be visually right-to-left');

  // Check Standard Word Headings & Automatic TOC + updateFields
  assert.ok(docXml!.includes('w:val="Heading1"'), 'Must contain Heading1');
  assert.ok(docXml!.includes('w:val="Heading2"'), 'Must contain Heading2');
  assert.ok(docXml!.includes('w:val="Heading3"'), 'Must contain Heading3');
  assert.ok(docXml!.includes('TOC'), 'Must contain automatic TOC field');
  assert.ok(settingsXml!.includes('updateFields'), 'settings.xml must enable updateFields for automatic TOC');

  // Round-trip test: feed a generated .docx (subset of 2 chapters) back into parseDocxDocument!
  const miniBook = {
    ...optimized,
    chapters: optimized.chapters.slice(0, 2),
    footnotes: optimized.footnotes.slice(0, 5),
    glossary: [],
    cheatSheets: [],
    tableIndex: [],
  };
  const miniBytes = await generateDocxUint8Array(miniBook, {
    ...DEFAULT_DOCX_CONFIG,
    includeCoverPage: false,
    includeAutoToc: false,
    includeGlossary: false,
    includeListOfTables: false,
    includeMasterCheatSheet: false,
    includeFootnotesSection: false,
    includeVisualSuggestions: false,
  });
  const roundTripped = await parseDocxDocument(miniBytes, 'roundtrip.docx');
  assert.ok(roundTripped.chapters.length >= 2, `Expected >= 2 chapters after docx round-trip, got ${roundTripped.chapters.length}`);
  assert.ok(
    roundTripped.chapters.some((c) => c.title.includes('فصل ۱')),
    'Round-tripped docx must retain Chapter 1 heading'
  );
});

test('parses JSON document and merges Markdown + JSON + deduplicates repeated content seamlessly', () => {
  const sampleJson = JSON.stringify({
    title: 'ضمیمه آموزشی سنسور اکسیژن',
    subtitle: 'جزوه تکمیلی کارگاه',
    chapters: [
      {
        title: 'اصول تست سنسور اکسیژن و وایدبند',
        sections: [
          {
            title: 'پارامترهای کلیدی',
            content:
              'نسبت سوخت به هوا در حالت استوکیومتری برابر 14.7 است و در بار کامل برای خنک‌کاری سیلندر باید به حدود 12.5 کاهش یابد.',
            parameters: [
              { پارامتر: 'AFR شهری', مقدار: '14.7', وضعیت: 'حلقه بسته' },
              { پارامتر: 'AFR تخت‌گاز', مقدار: '12.5', وضعیت: 'حلقه باز' },
            ],
          },
        ],
      },
    ],
  });

  const mdDup = `# فصل ۱: یادداشت‌های تکمیلی
## ۱-۱. تکرار قانون نسبت سوخت
نسبت سوخت به هوا در حالت استوکیومتری برابر 14.7 است و در بار کامل برای خنک‌کاری سیلندر باید به حدود 12.5 کاهش یابد.

نکته تکمیلی جدید: در موتورهای توربو فشار بوست 1280 باید با وایدبند کنترل شود.
`;

  const bookA = parseJsonDocument(sampleJson, 'o2_sensor.json');
  const bookB = parseMarkdownDocument(mdDup, 'notes.md');
  const merged = mergeParsedBooks([bookA, bookB]);
  const optimized = optimizeBook(merged, DEFAULT_OPTIMIZATION_OPTIONS);

  assert.equal(optimized.chapters.length, 2, 'Merged book should have 2 chapters');
  assert.equal(optimized.audit!.duplicateBlocksConsolidated, 1, 'Exact duplicate paragraph across JSON and MD should be consolidated');
  assert.equal(optimized.audit!.conceptRetentionRate, 100, 'Zero concepts lost during cross-file merge');
  assert.ok(
    JSON.stringify(optimized.chapters).includes('1280'),
    'Unique new technical note from second file must be retained'
  );
  assert.ok(optimized.tableIndex.length >= 1, 'JSON array of objects should be converted to a numbered table');
});

test('supports TXT/CSV/HTML parsing, multi-file thematic clustering, AI diagram/table embedding, and History store', async () => {
  const { parseAnySourceFile } = await import('./formatParsers.ts');
  const { applyAiAnalysisToBook, clusterBookThematicallyLocal } = await import('./aiOrganizer.ts');
  const { saveHistoryRun, listHistoryRuns, deleteHistoryRun } = await import('./historyStore.ts');

  const txtBook = await parseAnySourceFile({
    name: 'day1_sensors.txt',
    text: 'فصل ۱ سنسور اکسیژن\nسنسور اکسیژن نسبت سوخت 14.7 را در حلقه بسته کنترل می‌کند.\nفصل ۲ سنسور مپ\nفشار منیفولد در دور آرام حدود 350 میلی‌بار است.',
  });
  const csvBook = await parseAnySourceFile({
    name: 'thresholds.csv',
    text: 'پارامتر,مقدار ایمن,توضیح\nAFR تخت‌گاز,12.5,خنک‌کاری سیلندر\nفشار بوست,1280,حداکثر ایمن پایه',
  });
  const htmlBook = await parseAnySourceFile({
    name: 'day2_sensors.html',
    text: '<h1>سنسور اکسیژن و تست وایدبند</h1><p>برای تست دقیق تحت بار کامل باید از دستگاه وایدبند استفاده شود.</p>',
  });

  const merged = mergeParsedBooks([txtBook, csvBook, htmlBook]);
  const { book: clustered } = clusterBookThematicallyLocal(merged);
  const optimized = optimizeBook(clustered, DEFAULT_OPTIMIZATION_OPTIONS);

  // Apply AI structured response with real table & diagram insertion (lossless!)
  const enriched = applyAiAnalysisToBook(
    optimized,
    {
      unifiedTitle: 'مرجع یکپارچه سنسورها و آستانه‌ها',
      executiveSummary: 'سه فایل با موفقیت در فصل‌های موضوعی یکپارچه شدند.',
      generatedTables: [
        {
          targetChapterTitle: 'سنسور اکسیژن',
          caption: 'جدول مقایسه حلقه بسته و باز',
          rationale: 'مقایسه سریع کارگاهی',
          headers: ['حالت', 'نسبت سوخت', 'ابزار سنجش'],
          rows: [
            ['حلقه بسته', '14.7', 'سنسور نروبند فابریک'],
            ['تخت‌گاز', '12.5', 'وایدبند مستقل'],
          ],
        },
      ],
      generatedDiagrams: [
        {
          targetChapterTitle: 'سنسور اکسیژن',
          kind: 'flowchart',
          title: 'مراحل تست سنسور اکسیژن و مپ',
          caption: 'شکل ۱-۱: فلوچارت تست سنسورها',
          rationale: 'نمایش گام‌به‌گام تست کارگاهی',
          items: [
            { label: 'بررسی سوئیچ باز', detail: 'تطبیق فشار MAP با فشار جو' },
            { label: 'بررسی دور آرام', detail: 'فشار منیفولد 350 میلی‌بار' },
            { label: 'تست تخت‌گاز با وایدبند', detail: 'تنظیم AFR روی 12.5' },
          ],
        },
      ],
    },
    {
      engineMode: 'ai',
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'HIGH',
      embedGeneratedTablesAndDiagrams: true,
    }
  );

  assert.equal(enriched.title, 'مرجع یکپارچه سنسورها و آستانه‌ها');
  assert.ok(enriched.aiReport!.insertedTables.length >= 1, 'Expected AI-generated table embedded');
  assert.ok(enriched.aiReport!.insertedDiagrams.length >= 1, 'Expected AI-generated diagram embedded');
  const firstSvg = enriched.aiReport!.insertedDiagrams[0].svgMarkup;
  assert.ok(firstSvg.includes('<svg'), 'Diagram must produce valid SVG markup');
  assert.ok(firstSvg.includes('text-anchor="middle"'), 'Diagram SVG should center text cleanly');
  assert.ok(!firstSvg.includes('text-anchor="end"'), 'Diagram SVG must avoid RTL text-anchor="end" clipping');

  // Verify Markdown starting directly with # فصل ۱ extracts H1 title, never body prose
  const mdDirect = parseMarkdownDocument(
    '# فصل ۱: تست عنوان اصلی\n\nپاراگراف کوتاه بدنه متن که نباید عنوان شود.',
    'direct.md'
  );
  assert.equal(mdDirect.title, 'تست عنوان اصلی', 'Markdown title should come from H1 heading, not body prose');

  // Verify History Store round-trip
  await saveHistoryRun({
    id: 'test_run_1',
    createdAt: new Date().toISOString(),
    title: enriched.title,
    sourceFiles: [
      { name: 'day1_sensors.txt', format: 'txt', sizeBytes: 120 },
      { name: 'thresholds.csv', format: 'csv', sizeBytes: 90 },
    ],
    engineMode: 'ai',
    model: 'gemini-4-hydrogen',
    modelDisplayName: 'Gemini 4 Hydrogen (هیدروژن)',
    thinkingLevel: 'HIGH',
    stats: {
      chapterCount: enriched.chapters.length,
      sectionCount: 3,
      tableCount: enriched.tableIndex.length,
      diagramCount: enriched.aiReport!.insertedDiagrams.length,
      duplicatesConsolidated: 0,
      conceptRetentionRate: 100,
      wordCount: 50,
    },
    aiReport: enriched.aiReport,
    audit: enriched.audit,
    config: DEFAULT_DOCX_CONFIG,
    bookSnapshot: enriched,
  });

  const runs = await listHistoryRuns();
  assert.ok(runs.some((r) => r.id === 'test_run_1'), 'Saved run must be retrievable from history');
  await deleteHistoryRun('test_run_1');
});

