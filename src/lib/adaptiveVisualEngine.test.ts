import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeContentNatureForProject,
  applyAdaptiveProjectSettings,
  injectAdaptiveVisualExhibitsIntoBook,
} from './adaptiveVisualEngine.ts';
import { DEFAULT_DOCX_CONFIG, type ParsedBook } from './bookTypes.ts';
import { enrichBookAdaptiveVisualsWithPython } from '../server/pythonChartEngine.ts';

function makeMinimalBook(title: string, chapterTitle: string, text: string): ParsedBook {
  return {
    title,
    subtitle: '',
    editionNote: '',
    sourceFiles: ['sample.md'],
    volumes: [{ id: 'v1', index: 1, title: 'جلد ۱' }],
    chapters: [
      {
        id: 'ch1',
        chapterNumber: 1,
        title: chapterTitle,
        volumeIndex: 1,
        volumeTitle: 'جلد ۱',
        meta: [],
        introBlocks: [],
        sections: [
          {
            id: 'sec1',
            numberLabel: '۱-۱',
            title: chapterTitle,
            originalTitle: chapterTitle,
            blocks: [{ type: 'paragraph', id: 'p1', text }],
          },
        ],
        sourceFileName: 'sample.md',
      },
    ],
    footnotes: [],
    glossary: [],
    tableIndex: [],
    cheatSheets: [],
    visualSuggestions: [],
    sourceMapRows: [],
  };
}

test('detects Dyno & Graph Reading nature and adapts project settings away from rigid WinOLS defaults', () => {
  const dynoText =
    'در آموزش داینو و گراف‌خوانی موتور EF7 توربو، توان فابریک 145 HP و پس از ریمپ Stage 1 به 172 HP و گشتاور از 210 Nm به 255 Nm تا دور 6500 RPM می‌رسد. نسبت سوخت AFR در تمام‌گاز روی 12.4 تنظیم و نقطه تقاطع ۵۲۵۲ بررسی می‌شود.';
  const profile = analyzeContentNatureForProject({
    texts: [dynoText],
    fileNames: ['dyno_graph_reading_guide.md'],
  });

  assert.equal(profile.dominantArchetype, 'dyno_graph_reading');
  assert.equal(profile.visualStylePreset, 'dyno_telemetry');
  assert.equal(profile.pythonChartingRecommended, true);
  assert.ok(profile.recommendedVisualModules.includes('dyno_chart'));

  const adapted = applyAdaptiveProjectSettings({ ...DEFAULT_DOCX_CONFIG }, profile);
  assert.equal(adapted.nextSettings.includeWinolsActionTables, false);
  assert.equal(adapted.nextSettings.adaptiveVisualsEnabled, true);
  assert.ok(adapted.changes.length >= 2);
});

test('detects WinOLS Maps nature and activates WinOLS thermal heatmap & action tables', () => {
  const winolsText =
    'در نرم‌افزار WinOLS 2.24 برای ایسیو Bosch ME7.4.4 نقشه KFZW در آدرس 0x1C200 با فکتور 0.75 و نمایش 3D اصلاح می‌شود. همچنین نقشه LAMFA و چکسام دامپ بررسی می‌گردد.';
  const profile = analyzeContentNatureForProject({
    texts: [winolsText],
    fileNames: ['winols_me744_kfzw.md'],
  });

  assert.equal(profile.dominantArchetype, 'winols_hex_maps');
  assert.equal(profile.visualStylePreset, 'winols_precision');
  assert.ok(profile.recommendedVisualModules.includes('winols_heatmap'));

  const adapted = applyAdaptiveProjectSettings(
    { ...DEFAULT_DOCX_CONFIG, includeWinolsActionTables: false },
    profile
  );
  assert.equal(adapted.nextSettings.includeWinolsActionTables, true);
});

test('injects Dyno & WinOLS adaptive visuals and renders real Python 3 SVG plots', async () => {
  const dynoBook = makeMinimalBook(
    'آموزش داینو',
    'تحلیل گراف داینو و مقایسه Stage 1',
    'داینو شاسی موتور توربو: توان فابریک 150 HP و توان ریمپ 182 HP با گشتاور 220 Nm تا 268 Nm در دور 6500 RPM و AFR 12.5.'
  );
  const winolsBook = makeMinimalBook(
    'راهنمای WinOLS',
    'اصلاح نقشه KFZW در WinOLS',
    'در WinOLS نقشه KFZW در آدرس 0x1C200 با فکتور 0.75 در نمای 2D و 3D اصلاح می‌شود.'
  );

  const dynoSummary = injectAdaptiveVisualExhibitsIntoBook(dynoBook, DEFAULT_DOCX_CONFIG);
  assert.equal(dynoSummary.injectedCount, 1);

  const pyDyno = await enrichBookAdaptiveVisualsWithPython(dynoBook);
  assert.equal(pyDyno.renderedCount, 1);

  const dynoBlock = dynoBook.chapters[0].sections[0].blocks.find((b) => b.type === 'adaptive_visual');
  assert.ok(dynoBlock && dynoBlock.type === 'adaptive_visual');
  assert.equal(dynoBlock.visualKind, 'dyno_chart');
  assert.equal(dynoBlock.renderedByPython, true);
  assert.ok(dynoBlock.pythonRenderedSvg?.startsWith('<svg'));
  assert.ok(dynoBlock.pythonScript?.includes('matplotlib.pyplot'));

  const winolsSummary = injectAdaptiveVisualExhibitsIntoBook(winolsBook, DEFAULT_DOCX_CONFIG);
  assert.equal(winolsSummary.injectedCount, 1);

  const pyWinols = await enrichBookAdaptiveVisualsWithPython(winolsBook);
  assert.equal(pyWinols.renderedCount, 1);
  const winolsBlock = winolsBook.chapters[0].sections[0].blocks.find((b) => b.type === 'adaptive_visual');
  assert.ok(winolsBlock && winolsBlock.type === 'adaptive_visual');
  assert.equal(winolsBlock.visualKind, 'winols_heatmap');
  assert.equal(winolsBlock.renderedByPython, true);
  assert.ok(winolsBlock.pythonRenderedSvg?.includes('3D SURFACE MESH'));
});
