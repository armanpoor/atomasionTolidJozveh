import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStage5ComparativePieChartData,
  computeStage5QualityMetrics,
} from './stage5QualityMetrics.ts';
import type {
  AuditReportDto,
  ConflictDto,
  OutlineNodeDto,
  ParsedBook,
} from './bookTypes.ts';
import type { WinolsExtractionReport } from './winolsMapGuide.ts';
import type { HarnessState } from './harness/types.ts';

function makeSampleBook(): ParsedBook {
  return {
    title: 'راهنمای جامع کالیبراسیون و ریمپ ایسیو زیمنس و بوش',
    subtitle: 'مرجع تخصصی مهندسی',
    editionNote: '',
    sourceFiles: ['a.md'],
    volumes: [],
    chapters: [
      {
        id: 'ch_1',
        chapterNumber: 1,
        title: 'فصل ۱: مبانی کالیبراسیون جرقه و آوانس',
        volumeIndex: 1,
        volumeTitle: 'جلد ۱',
        meta: [],
        sourceFileName: 'a.md',
        introBlocks: [
          {
            type: 'paragraph',
            id: 'b_intro_1',
            text: 'معرفی نقشه آوانس جرقه در WinOLS.',
          },
        ],
        sections: [
          {
            id: 'sec_1_1',
            numberLabel: '۱-۱',
            title: '۱-۱. کالیبراسیون KFZW و IGN_Base',
            originalTitle: 'کالیبراسیون KFZW و IGN_Base',
            blocks: [
              {
                type: 'paragraph',
                id: 'b_1_1',
                text: 'آدرس 0x1A4F0 مربوط به نقشه KFZW با محدوده 3000 تا 5500 دور و بار 70 تا 100 درصد است.',
              },
            ],
          },
        ],
      },
      {
        id: 'ch_2',
        chapterNumber: 2,
        title: 'فصل ۲: جداول سوخت و غنی‌سازی بار کامل',
        volumeIndex: 1,
        volumeTitle: 'جلد ۱',
        meta: [],
        sourceFileName: 'a.md',
        introBlocks: [],
        sections: [
          {
            id: 'sec_2_1',
            numberLabel: '۲-۱',
            title: '۲-۱. کالیبراسیون LAMFA در بار کامل',
            originalTitle: 'کالیبراسیون LAMFA در بار کامل',
            blocks: [
              {
                type: 'paragraph',
                id: 'b_2_1',
                text: 'جدول LAMFA در آدرس 0x1B200 با فاکتور 0.0078125 تنظیم می‌شود.',
              },
            ],
          },
        ],
      },
      {
        id: 'ch_winols_quick_guide',
        chapterNumber: 3,
        title: 'پیوست: راهنمای عملی نقشه‌های WinOLS',
        volumeIndex: 1,
        volumeTitle: 'جلد ۱',
        meta: [],
        sourceFileName: 'system',
        introBlocks: [],
        sections: [
          {
            id: 'sec_winols_1',
            numberLabel: '۳-۱',
            title: 'خلاصه آدرس‌ها و حدود ایمن',
            originalTitle: 'خلاصه آدرس‌ها و حدود ایمن',
            blocks: [
              {
                type: 'paragraph',
                id: 'b_3_1',
                text: 'جدول مرجع WinOLS.',
              },
            ],
          },
        ],
      },
    ],
    glossary: [],
    footnotes: [],
    tableIndex: [],
    cheatSheets: [],
    visualSuggestions: [],
    sourceMapRows: [],
  };
}

function makeSampleOutline(): OutlineNodeDto[] {
  return [
    {
      id: 'node_1',
      projectId: 'p1',
      parentId: null,
      nodeOrder: 0,
      level: 1,
      title: 'مبانی کالیبراسیون جرقه و آوانس',
      summary: '',
      isApproved: true,
      webEnrichmentJson: null,
    },
    {
      id: 'node_2',
      projectId: 'p1',
      parentId: null,
      nodeOrder: 1,
      level: 1,
      title: 'جداول سوخت و غنی‌سازی بار کامل',
      summary: '',
      isApproved: true,
      webEnrichmentJson: null,
    },
  ];
}

function makeSampleWinolsReport(withHexAndAxes = true): WinolsExtractionReport {
  return {
    mapsDetected: 2,
    generatedAt: '2026-11-24T00:00:00Z',
    summaryTable: null,
    entries: [
      {
        id: 'm1',
        mapCode: 'KFZW',
        mapNameFa: 'نقشه اصلی آوانس جرقه',
        category: 'ignition',
        categoryLabelFa: 'جرقه‌زنی و آوانس',
        ecuModels: ['ME7.4.4'],
        hexAddresses: withHexAndAxes ? ['0x1A4F0'] : [],
        dimensions: '12x16',
        isScalar: false,
        targetRpmRange: withHexAndAxes ? { min: 3000, max: 5500 } : null,
        targetLoadRange: withHexAndAxes ? { min: 70, max: 100 } : null,
        targetZoneLabelFa: '۳۰۰۰ تا ۵۵۰۰ دور',
        modificationSummaryFa: 'افزایش کنترل‌شده',
        numericValuesDetected: ['+2.0°'],
        recommendedDeltaLabel: '+2.0°',
        safetyChecklistFa: 'کنترل سنسور ناک الزامی است.',
        winolsStepsFa: ['انتخاب محدوده بار کامل', 'اعمال +2 درجه'],
        sourceFiles: ['a.md'],
        evidenceSnippets: [],
        zoneMatrix: withHexAndAxes
          ? {
              rpmAxis: [3000, 4000, 5000],
              loadAxis: [70, 90],
              unit: 'deg',
              cells: [],
              highlightedCellCount: 4,
              totalCellCount: 6,
              selectionInstructionFa: 'انتخاب سلول‌ها',
            }
          : null,
        confidence: withHexAndAxes ? 'high' : 'medium',
        damosMeta: withHexAndAxes ? { factor: 0.75, offset: -23.6, dataOrg: '8bit' } : undefined,
      },
      {
        id: 'm2',
        mapCode: 'LAMFA',
        mapNameFa: 'نقشه غنی‌سازی سوخت',
        category: 'fuel',
        categoryLabelFa: 'سوخت و AFR',
        ecuModels: ['ME7.4.4'],
        hexAddresses: withHexAndAxes ? ['0x1B200'] : [],
        dimensions: '6x15',
        isScalar: false,
        targetRpmRange: withHexAndAxes ? { min: 3500, max: 6000 } : null,
        targetLoadRange: withHexAndAxes ? { min: 75, max: 100 } : null,
        targetZoneLabelFa: '۳۵۰۰ تا ۶۰۰۰ دور',
        modificationSummaryFa: 'غنی‌سازی بار کامل',
        numericValuesDetected: ['0.85'],
        recommendedDeltaLabel: '0.85',
        safetyChecklistFa: 'پایش AFR با وایدبند.',
        winolsStepsFa: ['پیدا کردن 0x1B200', 'تنظیم لامبدا'],
        sourceFiles: ['a.md'],
        evidenceSnippets: [],
        zoneMatrix: withHexAndAxes
          ? {
              rpmAxis: [3500, 4500, 6000],
              loadAxis: [80, 100],
              unit: 'λ',
              cells: [],
              highlightedCellCount: 4,
              totalCellCount: 6,
              selectionInstructionFa: 'انتخاب سلول‌ها',
            }
          : null,
        confidence: withHexAndAxes ? 'high' : 'medium',
        damosMeta: withHexAndAxes ? { factor: 0.0078125, offset: 0, dataOrg: '8bit' } : undefined,
      },
    ],
  };
}

test('computeStage5QualityMetrics returns clean low-error, high-cohesion, high-WinOLS metrics for a verified project', () => {
  const auditReport: AuditReportDto = {
    id: 'ar1',
    projectId: 'p1',
    totalSourceFiles: 1,
    totalInputUnits: 12,
    uniqueUnitsPreserved: 10,
    duplicatesMerged: 2,
    conflictsDetected: 0,
    conflictsResolved: 0,
    coveragePercent: 100,
    detailsJson: {},
    generatedAt: '2026-11-24T00:00:00Z',
  };

  const metrics = computeStage5QualityMetrics({
    book: makeSampleBook(),
    outlineNodes: makeSampleOutline(),
    auditReport,
    conflicts: [],
    winolsGuideReport: makeSampleWinolsReport(true),
    validationDomain: 'ecu_winols',
  });

  assert.equal(metrics.textErrorRatePercent, 0);
  assert.equal(metrics.cleanTextPercent, 100);
  assert.equal(metrics.headingCohesionPercent, 100);
  assert.equal(metrics.headingGapPercent, 0);
  assert.equal(metrics.winolsCompliancePercent, 100);
  assert.equal(metrics.winolsGapPercent, 0);
  assert.equal(metrics.winolsMode, 'evaluated');
  assert.equal(metrics.mapsDetected, 2);
  assert.equal(metrics.mapsWithHexCount, 2);
});

test('computeStage5QualityMetrics elevates text error rate and lowers compliance when conflicts, quarantine issues, and missing WinOLS metadata exist', () => {
  const book = makeSampleBook();
  book.chapters[0].sections.push({
    id: 'sec_empty',
    numberLabel: '',
    title: 'بدون عنوان',
    originalTitle: 'بدون عنوان',
    blocks: [],
  });
  const outline = makeSampleOutline();
  outline.push({
    id: 'node_3_missing',
    projectId: 'p1',
    parentId: null,
    nodeOrder: 2,
    level: 1,
    title: 'فصل حذف‌شده تست انسجام',
    summary: '',
    isApproved: true,
    webEnrichmentJson: null,
  });

  const conflicts: ConflictDto[] = [
    {
      id: 'c1',
      projectId: 'p1',
      topic: 'مقدار آوانس مجاز KFZW',
      unitAId: 'u1',
      unitBId: 'u2',
      excerptA: '+2 درجه',
      fileAName: 'a.md',
      excerptB: '+6 درجه',
      fileBName: 'b.md',
      status: 'open',
      resolutionNote: null,
      webGroundingJson: null,
      createdAt: '2026-11-24T00:00:00Z',
      updatedAt: '2026-11-24T00:00:00Z',
    },
    {
      id: 'c2',
      projectId: 'p1',
      topic: 'فشار ریل',
      unitAId: 'u3',
      unitBId: 'u4',
      excerptA: '4 bar',
      fileAName: 'a.md',
      excerptB: '6 bar',
      fileBName: 'b.md',
      status: 'open',
      resolutionNote: null,
      webGroundingJson: null,
      createdAt: '2026-11-24T00:00:00Z',
      updatedAt: '2026-11-24T00:00:00Z',
    },
  ];

  const auditReport: AuditReportDto = {
    id: 'ar2',
    projectId: 'p1',
    totalSourceFiles: 2,
    totalInputUnits: 12,
    uniqueUnitsPreserved: 10,
    duplicatesMerged: 1,
    conflictsDetected: 2,
    conflictsResolved: 0,
    coveragePercent: 90,
    detailsJson: {},
    generatedAt: '2026-11-24T00:00:00Z',
  };

  const fakeHarnessState = {
    coverageLedger: {
      byChunkId: {},
      bySectionId: {
        sec_1_1: {
          sectionId: 'sec_1_1',
          chapterId: 'ch_1',
          status: 'quarantined',
          attempts: 3,
          layer1Passed: false,
          layer2Passed: false,
          lastUpdatedAt: '2026-11-24T00:00:00Z',
        },
        sec_2_1: {
          sectionId: 'sec_2_1',
          chapterId: 'ch_2',
          status: 'verified',
          attempts: 1,
          layer1Passed: true,
          layer2Passed: true,
          lastUpdatedAt: '2026-11-24T00:00:00Z',
        },
      },
    },
    quarantineQueue: [
      {
        sectionId: 'sec_1_1',
        chapterId: 'ch_1',
        chapterTitle: 'فصل ۱',
        sectionTitle: '۱-۱',
        attempts: 3,
        maxAttempts: 3,
        draftIR: {
          sectionId: 'sec_1_1',
          chapterId: 'ch_1',
          title: '۱-۱',
          blocks: [],
          sourceChunkIds: ['c1'],
          generatedAt: '2026-11-24T00:00:00Z',
          modelUsed: 'gemini-3-pro',
          tierUsed: 'flagship',
        },
        layer1Issues: [
          {
            id: 'i1',
            kind: 'sign_inversion_detected',
            severity: 'error',
            messageFa: 'قرینه‌شدن علامت آوانس',
          },
        ],
        layer2Issues: [],
        sourceChunkIds: ['c1'],
        quarantinedAt: '2026-11-24T00:00:00Z',
        resolved: false,
      },
    ],
  } as unknown as HarnessState;

  const metrics = computeStage5QualityMetrics({
    book,
    outlineNodes: outline,
    auditReport,
    conflicts,
    winolsGuideReport: makeSampleWinolsReport(false),
    harnessState: fakeHarnessState,
    validationDomain: 'ecu_winols',
  });

  assert.ok(metrics.textErrorRatePercent >= 40, `Expected high error rate, got ${metrics.textErrorRatePercent}`);
  assert.equal(metrics.textErrorRatePercent + metrics.cleanTextPercent, 100);
  assert.ok(metrics.headingCohesionPercent < 90, `Expected lowered cohesion due to missing outline chapter and empty section, got ${metrics.headingCohesionPercent}`);
  assert.equal(metrics.headingCohesionPercent + metrics.headingGapPercent, 100);
  assert.ok(metrics.winolsCompliancePercent < 60, `Expected low WinOLS compliance, got ${metrics.winolsCompliancePercent}`);
  assert.equal(metrics.ecuIssueCount, 1);
  assert.equal(metrics.unresolvedQuarantineCount, 1);
});

test('computeStage5QualityMetrics marks WinOLS compliance as general_domain_not_applicable when general_persian_technical domain has zero maps', () => {
  const metrics = computeStage5QualityMetrics({
    book: makeSampleBook(),
    outlineNodes: makeSampleOutline(),
    winolsGuideReport: {
      mapsDetected: 0,
      entries: [],
      summaryTable: null,
      generatedAt: '',
    },
    validationDomain: 'general_persian_technical',
  });

  assert.equal(metrics.winolsMode, 'general_domain_not_applicable');
  assert.equal(metrics.winolsDomainActive, false);
  assert.equal(metrics.winolsCompliancePercent, 100);
  assert.equal(metrics.mapsDetected, 0);
});

test('buildStage5ComparativePieChartData formats 3 core metrics for Recharts Pie Chart', () => {
  const metrics = computeStage5QualityMetrics({
    book: makeSampleBook(),
    outlineNodes: makeSampleOutline(),
    winolsGuideReport: makeSampleWinolsReport(true),
    validationDomain: 'ecu_winols',
  });

  const chartData = buildStage5ComparativePieChartData(metrics);
  assert.equal(chartData.length, 3);

  const [textErrors, headingCohesion, winolsCompliance] = chartData;
  assert.equal(textErrors.id, 'text_errors');
  assert.equal(textErrors.name, 'نرخ خطاهای متنی');
  assert.equal(typeof textErrors.value, 'number');
  assert.ok(textErrors.color.startsWith('#'));

  assert.equal(headingCohesion.id, 'heading_cohesion');
  assert.equal(headingCohesion.name, 'امتیاز انسجام سرفصل‌ها');
  assert.equal(typeof headingCohesion.value, 'number');
  assert.ok(headingCohesion.color.startsWith('#'));

  assert.equal(winolsCompliance.id, 'winols_compliance');
  assert.equal(winolsCompliance.name, 'تطبیق با استانداردهای WinOLS');
  assert.equal(typeof winolsCompliance.value, 'number');
  assert.ok(winolsCompliance.color.startsWith('#'));
});
