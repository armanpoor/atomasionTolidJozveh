import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DOCX_CONFIG } from './bookTypes.ts';
import {
  analyzeUploadedFilesForPythonCharts,
  buildNumericTelemetryPayloadFromText,
  extractNumericTelemetryPairs,
} from './numericChartAnalyzer.ts';
import {
  analyzeTableBlockAsWinols,
  convertRawWinolsTablesToMarkdown,
  detectWinolsTablesInRawText,
  extractWinolsTableSegmentsFromParagraph,
} from './winolsTableDetector.ts';
import { parseMarkdownDocument } from './formatParsers.ts';
import { injectAdaptiveVisualExhibitsIntoBook } from './adaptiveVisualEngine.ts';
import { enrichBookAdaptiveVisualsWithPython } from '../server/pythonChartEngine.ts';

test('analyzeUploadedFilesForPythonCharts detects دما, فشار, گشتاور, and WinOLS and activates Python visualizer', () => {
  const report = analyzeUploadedFilesForPythonCharts([
    {
      fileName: 'boost_temp_log.txt',
      text: `گزارش تست جاده‌ای موتور توربو:
در دور 2000 RPM فشار بوست 0.85 bar و دمای اگزوز EGT برابر 580 درجه است.
در دور 3500 RPM فشار بوست 1.35 bar و دمای اگزوز 740 درجه و گشتاور 260 Nm ثبت شد.
در دور 5000 RPM فشار بوست 1.42 bar و دمای اگزوز 860 درجه و گشتاور 245 Nm ثبت شد.
تنظیم جدول KFZW در WinOLS در آدرس 0x1C200 انجام گردید.`,
    },
  ]);

  assert.equal(report.shouldActivatePythonVisualizer, true);
  const tokens = report.keywordHits.map((h) => h.keywordToken);
  assert.ok(tokens.includes('دما'), `Expected 'دما' in ${tokens.join(', ')}`);
  assert.ok(tokens.includes('فشار'), `Expected 'فشار' in ${tokens.join(', ')}`);
  assert.ok(tokens.includes('گشتاور'), `Expected 'گشتاور' in ${tokens.join(', ')}`);
  assert.ok(tokens.includes('WinOLS'), `Expected 'WinOLS' in ${tokens.join(', ')}`);
  assert.ok(report.recommendedVisualKinds.includes('numeric_telemetry_chart'));
  assert.ok(report.totalExtractedDataPoints >= 3);
});

test('analyzeUploadedFilesForPythonCharts stays inactive on plain prose with no numeric/chart keywords', () => {
  const report = analyzeUploadedFilesForPythonCharts([
    {
      fileName: 'intro.txt',
      text: 'این فصل مقدمه‌ای درباره تاریخچه صنعت خودرو و روش‌های نگهداری عمومی بدنه و نظافت کابین است.',
    },
  ]);
  assert.equal(report.shouldActivatePythonVisualizer, false);
  assert.equal(report.keywordHits.length, 0);
});

test('extractNumericTelemetryPairs and buildNumericTelemetryPayloadFromText extract grounded pressure/temp series', () => {
  const text = `تست بوست و دما:
در دور 2000 RPM فشار 0.75 bar و دمای 560°C
در دور 3000 RPM فشار 1.20 bar و دمای 680°C
در دور 4500 RPM فشار 1.45 bar و دمای 810°C
در دور 6000 RPM فشار 1.38 bar و دمای 885°C`;

  const presPts = extractNumericTelemetryPairs(text, 'pressure');
  assert.equal(presPts.length, 4);
  assert.equal(presPts[0].xNumeric, 2000);
  assert.equal(presPts[0].primaryValue, 0.75);
  assert.equal(presPts[2].primaryValue, 1.45);

  const built = buildNumericTelemetryPayloadFromText('پایش بوست و دما', text);
  assert.ok(built);
  assert.equal(built.grounded, true);
  assert.equal(built.payload.kind, 'numeric_telemetry_chart');
  assert.equal(built.payload.peakPrimary, 1.45);
  assert.equal(built.payload.points.length, 4);
});

test('detectWinolsTablesInRawText detects raw tab/space 2D matrix, hex dump, and Damos directory', () => {
  const rawTxt = `نقشه آوانس جرقه KFZW (0x1C200) - Factor: 0.75
Load\\RPM\t1500\t2500\t3500\t4500\t5500
30%\t16.5\t21.0\t26.5\t30.0\t32.5
60%\t13.0\t17.5\t22.0\t25.5\t28.0
100%\t9.5\t13.5\t17.0\t20.5\t23.0

هگزدامپ مپ LAMFA:
0x1D4A0: 80 80 7D 7A 75 72
0x1D4A6: 80 7E 7A 76 70 6D

| نام مپ | آدرس هگز | ابعاد | فکتور | واحد |
| --- | --- | --- | --- | --- |
| KFZW | 0x1C200 | 12×16 | 0.75 | ° BTDC |
| LAMFA | 0x1D4A0 | 6×15 | 0.007813 | λ |`;

  const detected = detectWinolsTablesInRawText(rawTxt);
  assert.equal(detected.length, 3);
  assert.equal(detected[0].kind, 'matrix_2d');
  assert.equal(detected[0].mapCode, 'KFZW');
  assert.equal(detected[0].hexAddress, '0x1C200');
  assert.equal(detected[0].maxValue, 32.5);
  assert.equal(detected[0].minValue, 9.5);

  assert.equal(detected[1].kind, 'hex_dump');
  assert.equal(detected[1].hexAddress, '0x1D4A0');

  assert.equal(detected[2].kind, 'damos_directory');

  const conv = convertRawWinolsTablesToMarkdown(rawTxt);
  assert.equal(conv.convertedCount, 2);
  assert.ok(conv.markdown.includes('| Load\\RPM | 1500 | 2500 |'));

  const paraSegments = extractWinolsTableSegmentsFromParagraph(rawTxt);
  assert.ok(paraSegments && paraSegments.some((s) => s.type === 'winols_table'));
});

test('End-to-end Stage 4 pipeline converts raw WinOLS text table and renders real Python 3 numeric telemetry SVG', async () => {
  const sampleText = `# فصل ۱: کالیبراسیون بوست، دما و جدول KFZW در WinOLS

در این بخش تاثیر فشار بوست و دمای اگزوز را بررسی می‌کنیم:
در دور 2000 RPM فشار بوست 0.8 bar و دمای اگزوز 540°C
در دور 3500 RPM فشار بوست 1.35 bar و دمای اگزوز 730°C
در دور 5000 RPM فشار بوست 1.48 bar و دمای اگزوز 865°C

جدول آوانس KFZW در آدرس 0x1C200:
Load\\RPM  1500  2500  3500  4500  5500
30%       16.5  21.0  26.5  30.0  32.5
60%       13.0  17.5  22.0  25.5  28.0
100%       9.5  13.5  17.0  20.5  23.0`;

  const book = parseMarkdownDocument(sampleText, 'boost_winols_test.txt');
  const allBlocks = [
    ...book.chapters[0].introBlocks,
    ...book.chapters[0].sections.flatMap((s) => s.blocks),
  ];

  const tableBlock = allBlocks.find((b) => b.type === 'table');
  assert.ok(tableBlock && tableBlock.type === 'table', 'Raw WinOLS matrix should parse into a structured TableBlock');
  const winolsClassified = analyzeTableBlockAsWinols(tableBlock);
  assert.ok(winolsClassified, 'TableBlock should be auto-detected as a graphical WinOLS table');
  assert.equal(winolsClassified.kind, 'matrix_2d');
  assert.equal(winolsClassified.maxValue, 32.5);

  const summary = injectAdaptiveVisualExhibitsIntoBook(book, DEFAULT_DOCX_CONFIG);
  assert.ok(summary.injectedCount >= 1);
  assert.ok(
    summary.byVisualKind.numeric_telemetry_chart >= 1,
    `Expected numeric_telemetry_chart to be injected, got ${JSON.stringify(summary.byVisualKind)}`
  );

  const pyRes = await enrichBookAdaptiveVisualsWithPython(book);
  assert.ok(pyRes.renderedCount >= 1, 'Expected Python 3 engine to render at least 1 SVG');

  const updatedBlocks = [
    ...book.chapters[0].introBlocks,
    ...book.chapters[0].sections.flatMap((s) => s.blocks),
  ];
  const numericExhibit = updatedBlocks.find(
    (b) => b.type === 'adaptive_visual' && b.visualKind === 'numeric_telemetry_chart'
  );
  assert.ok(numericExhibit && numericExhibit.type === 'adaptive_visual');
  assert.equal(numericExhibit.renderedByPython, true);
  assert.ok(numericExhibit.pythonRenderedSvg?.startsWith('<svg'));
  assert.ok(numericExhibit.pythonRenderedSvg?.includes('Auto-Activated Plotter'));
});
