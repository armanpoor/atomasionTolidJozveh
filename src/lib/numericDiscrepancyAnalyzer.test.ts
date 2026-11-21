import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  analyzeNumericDiscrepancies,
  computeDescriptiveStats,
  computeRmseAndPearson,
  parseNumericMeasurement,
} from './numericDiscrepancyAnalyzer.ts';
import { parseAnySourceFile, parseDocxDocument } from './formatParsers.ts';
import { extractAtomicUnitsFromBook, runDeterministicLosslessDedup } from './zeroLossPipeline.ts';
import type { ContentUnitDto, SourceFileDto } from './bookTypes.ts';

function toContentUnitDtos(
  extracted: ReturnType<typeof extractAtomicUnitsFromBook>
): ContentUnitDto[] {
  return extracted.map((u) => ({
    ...u,
    unitType: u.unitType as ContentUnitDto['unitType'],
    status: u.status as ContentUnitDto['status'],
    canonicalUnitId: null,
    outlineNodeId: null,
  }));
}

test('parseNumericMeasurement normalizes physical units (bar/kPa/psi, Lambda/AFR) and ignores hex/DTC/matrix identifiers', () => {
  const barVal = parseNumericMeasurement('1.2 bar');
  const kpaVal = parseNumericMeasurement('120 kPa');
  assert.ok(barVal && kpaVal);
  assert.equal(barVal.normalizedUnit, 'bar');
  assert.equal(kpaVal.normalizedUnit, 'bar');
  assert.equal(barVal.normalizedValue, kpaVal.normalizedValue);

  const afr = parseNumericMeasurement('14.7:1');
  const lambda = parseNumericMeasurement('1.0 λ');
  assert.ok(afr && lambda);
  assert.equal(afr.normalizedUnit, 'AFR');
  assert.equal(lambda.normalizedUnit, 'AFR');
  assert.equal(afr.normalizedValue, lambda.normalizedValue);

  // Ranges compute midpoint
  const idleRange = parseNumericMeasurement('750 تا 850', 'RPM');
  assert.ok(idleRange);
  assert.equal(idleRange.isRange, true);
  assert.equal(idleRange.numericValue, 800);

  // Non-quantitative codes must be ignored
  assert.equal(parseNumericMeasurement('0x1A4F0'), null);
  assert.equal(parseNumericMeasurement('P0135'), null);
  assert.equal(parseNumericMeasurement('16x16'), null);
});

test('computeDescriptiveStats and computeRmseAndPearson calculate exact statistical metrics', () => {
  const stats = computeDescriptiveStats([4.0, 5.2]);
  assert.equal(stats.min, 4);
  assert.equal(stats.max, 5.2);
  assert.equal(stats.mean, 4.6);
  assert.equal(stats.median, 4.6);
  assert.equal(stats.stdDev, 0.6);
  assert.equal(stats.absDelta, 1.2);
  assert.equal(stats.percentDiff, 30);

  const curveStats = computeRmseAndPearson([100, 120, 140, 160], [110, 132, 154, 176]);
  assert.equal(curveStats.pearsonR, 1);
  assert.ok(curveStats.rmse > 13 && curveStats.rmse < 14);
});

test('analyzeNumericDiscrepancies detects statistical differences in both Data Tables and Chart curves across file versions while respecting unit equivalence', async () => {
  const mdV1 = [
    '# فصل ۱: کالیبراسیون ME7.4.4',
    [
      'جدول ۱-۱: پارامترهای کالیبراسیون',
      '| پارامتر | مقدار | واحد |',
      '| --- | --- | --- |',
      '| فشار بوست هدف | 1.2 | bar |',
      '| فشار ریل سوخت | 4.0 | bar |',
      '| آوانس پایه KFZW | 18.5 | deg |',
      '| آدرس KFZW | 0x1A4F0 | HEX |',
    ].join('\n'),
    'نمودار منحنی گشتاور موتور TU5: 2000 RPM = 122 Nm | 3000 RPM = 138 Nm | 4000 RPM = 147 Nm | 5000 RPM = 142 Nm',
  ].join('\n\n');

  const mdV2 = [
    '# فصل ۱: کالیبراسیون ME7.4.4',
    [
      'جدول ۱-۱: پارامترهای کالیبراسیون',
      '| پارامتر | مقدار | واحد |',
      '| --- | --- | --- |',
      '| فشار بوست هدف | 120 | kPa |', // Equivalent to 1.2 bar -> MUST NOT flag!
      '| فشار ریل سوخت | 5.2 | bar |', // +30% -> critical!
      '| آوانس پایه KFZW | 22.0 | deg |', // +3.5 deg -> critical!
      '| آدرس KFZW | 0x1A4F0 | HEX |',
    ].join('\n'),
    'نمودار منحنی گشتاور موتور TU5: 2000 RPM = 131 Nm | 3000 RPM = 152 Nm | 4000 RPM = 168 Nm | 5000 RPM = 161 Nm',
  ].join('\n\n');

  const b1 = await parseAnySourceFile({ name: 'نسخه_۱.md', format: 'md', text: mdV1 });
  const b2 = await parseAnySourceFile({ name: 'نسخه_۲.md', format: 'md', text: mdV2 });

  const u1 = toContentUnitDtos(
    extractAtomicUnitsFromBook({
      projectId: 'p1',
      sourceFileId: 'f1',
      fileName: 'نسخه_۱.md',
      fileRole: 'standard',
      book: b1,
      startingOrder: 0,
    })
  );
  const u2 = toContentUnitDtos(
    extractAtomicUnitsFromBook({
      projectId: 'p1',
      sourceFileId: 'f2',
      fileName: 'نسخه_۲.md',
      fileRole: 'standard',
      book: b2,
      startingOrder: u1.length,
    })
  );

  const sourceFiles: SourceFileDto[] = [
    {
      id: 'f1',
      projectId: 'p1',
      fileName: 'نسخه_۱.md',
      format: 'md',
      fileRole: 'standard',
      wordCount: 40,
      sizeBytes: 300,
      checksum: 'c1',
      unitCount: u1.length,
      uploadedAt: new Date().toISOString(),
    },
    {
      id: 'f2',
      projectId: 'p1',
      fileName: 'نسخه_۲.md',
      format: 'md',
      fileRole: 'standard',
      wordCount: 40,
      sizeBytes: 300,
      checksum: 'c2',
      unitCount: u2.length,
      uploadedAt: new Date().toISOString(),
    },
  ];

  // Also run dedup first to verify originalBlock preservation prevents corrupted statistical diff!
  runDeterministicLosslessDedup({
    projectId: 'p1',
    workflowMode: 'multi_merge',
    sourceFiles,
    units: [...u1, ...u2],
  });

  const report = analyzeNumericDiscrepancies({
    sourceFiles,
    units: [...u1, ...u2],
  });

  assert.equal(report.analyzedTablesCount, 2);
  assert.equal(report.analyzedChartsCount, 2);
  assert.equal(report.datasetComparisons.length, 2);

  // Table discrepancies: 2 (فشار ریل + آوانس پایه). 1.2 bar == 120 kPa must NOT be flagged!
  const tableDiscs = report.discrepancies.filter((d) => d.sourceKind === 'table');
  assert.equal(tableDiscs.length, 2);
  assert.ok(!tableDiscs.some((d) => d.parameterLabel.includes('بوست')));
  assert.ok(tableDiscs.every((d) => d.severity === 'critical'));
  const railDisc = tableDiscs.find((d) => d.parameterLabel.includes('ریل'));
  assert.ok(railDisc && railDisc.severityReason.includes('فشار'), 'bar unit must classify as pressure, not AFR');

  // Chart discrepancies: 4 RPM points compared with valid Pearson r, RMSE, and Torque (Nm) classification
  const chartDiscs = report.discrepancies.filter((d) => d.sourceKind === 'chart');
  assert.equal(chartDiscs.length, 4);
  assert.ok(
    chartDiscs.some((d) => d.severity === 'warning' && d.severityReason.includes('گشتاور')),
    'Nm torque series must classify under Torque/Power thresholds, not RPM rev-limiter'
  );
  const chartDataset = report.datasetComparisons.find((ds) => ds.sourceKind === 'chart');
  assert.ok(chartDataset);
  assert.equal(chartDataset.matchedPointsCount, 4);
  assert.ok(chartDataset.rmse > 10);
  assert.ok(chartDataset.pearsonR !== null && chartDataset.pearsonR > 0.95);
});

test('parseDocxDocument extracts native OOXML embedded Word charts (word/charts/chart1.xml) and feeds them into cross-version discrepancy analysis', async () => {
  const buildDocxWithChart = async (torqueValues: number[]) => {
    const zip = new JSZip();
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>
      </Relationships>`
    );
    zip.file(
      'word/charts/chart1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:title><c:tx><c:rich><a:p><a:r><a:t>منحنی گشتاور داینو EF7</a:t></a:r></a:p></c:rich></c:tx></c:title>
          <c:plotArea>
            <c:lineChart>
              <c:ser>
                <c:tx><c:v>Nm</c:v></c:tx>
                <c:cat><c:strRef><c:strCache>
                  <c:pt idx="0"><c:v>2500 RPM</c:v></c:pt>
                  <c:pt idx="1"><c:v>4000 RPM</c:v></c:pt>
                  <c:pt idx="2"><c:v>5500 RPM</c:v></c:pt>
                </c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache>
                  <c:pt idx="0"><c:v>${torqueValues[0]}</c:v></c:pt>
                  <c:pt idx="1"><c:v>${torqueValues[1]}</c:v></c:pt>
                  <c:pt idx="2"><c:v>${torqueValues[2]}</c:v></c:pt>
                </c:numCache></c:numRef></c:val>
              </c:ser>
            </c:lineChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`
    );
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>فصل ۱: تست داینو</w:t></w:r></w:p>
          <w:p><w:r><w:drawing><c:chart r:id="rIdChart1"/></w:drawing></w:r></w:p>
        </w:body>
      </w:document>`
    );
    return zip.generateAsync({ type: 'arraybuffer' });
  };

  const docxA = await parseDocxDocument(await buildDocxWithChart([140, 155, 138]), 'dyno_v1.docx');
  const docxB = await parseDocxDocument(await buildDocxWithChart([152, 178, 160]), 'dyno_v2.docx');

  const uA = toContentUnitDtos(
    extractAtomicUnitsFromBook({
      projectId: 'p2',
      sourceFileId: 'da',
      fileName: 'dyno_v1.docx',
      fileRole: 'standard',
      book: docxA,
      startingOrder: 0,
    })
  );
  const uB = toContentUnitDtos(
    extractAtomicUnitsFromBook({
      projectId: 'p2',
      sourceFileId: 'db',
      fileName: 'dyno_v2.docx',
      fileRole: 'standard',
      book: docxB,
      startingOrder: uA.length,
    })
  );

  const report = analyzeNumericDiscrepancies({
    sourceFiles: [
      {
        id: 'da',
        projectId: 'p2',
        fileName: 'dyno_v1.docx',
        format: 'docx',
        fileRole: 'standard',
        wordCount: 10,
        sizeBytes: 500,
        checksum: 'ha',
        unitCount: uA.length,
        uploadedAt: new Date().toISOString(),
      },
      {
        id: 'db',
        projectId: 'p2',
        fileName: 'dyno_v2.docx',
        format: 'docx',
        fileRole: 'standard',
        wordCount: 10,
        sizeBytes: 500,
        checksum: 'hb',
        unitCount: uB.length,
        uploadedAt: new Date().toISOString(),
      },
    ],
    units: [...uA, ...uB],
  });

  assert.equal(report.analyzedChartsCount, 2);
  assert.equal(report.inconsistentCount, 3);
  assert.equal(report.datasetComparisons.length, 1);
  assert.equal(report.datasetComparisons[0].title, 'منحنی گشتاور داینو EF7');
});
