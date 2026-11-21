import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { DEFAULT_DOCX_CONFIG, ParsedBook } from './bookTypes.ts';
import { generateDocxUint8Array } from './docxGenerator.ts';

function buildFixtureBook(): ParsedBook {
  return {
    title: 'مرجع مهندسی کالیبراسیون و ریمپ ایسیو',
    subtitle: 'راهنمای جامع جداول WinOLS و عیب‌یابی موتور',
    editionNote: 'ویرایش اول آزمایشی',
    sourceFiles: ['جزوه-مبانی.docx', 'جداول-وینولز.docx'],
    volumes: [
      { id: 'vol_1', index: 1, title: 'مجلد اول: مبانی کالیبراسیون و ساختار نقشه' },
    ],
    chapters: [
      {
        id: 'ch_1',
        chapterNumber: 1,
        title: 'فصل ۱: شناخت جداول سوخت و جرقه در WinOLS',
        volumeIndex: 1,
        volumeTitle: 'مجلد اول: مبانی کالیبراسیون و ساختار نقشه',
        sourceFileName: 'جزوه-مبانی.docx',
        meta: [
          { label: 'کد ایسیو', value: 'Bosch ME7.4.4' },
          { label: 'سطح فنی', value: 'پیشرفته کارگاهی' },
        ],
        introBlocks: [
          {
            type: 'paragraph',
            id: 'p_intro',
            text: 'در ایسیو ME7.4.4 جدول `LAMFA` و جدول `KFZW` برای تنظیم سوخت و آوانس جرقه در دور موتور ۴۰۰۰ استفاده می‌شوند.',
          },
          {
            type: 'callout',
            id: 'c_warn',
            variant: 'warning',
            title: 'هشدار ناک در آوانس بالا',
            paragraphs: ['افزایش بیش از ۲.۵ درجه در بار بالای ۸۰ درصد بدون بنزین سوپر خطرناک است.'],
          },
        ],
        sections: [
          {
            id: 'sec_1_1',
            numberLabel: '۱-۱',
            title: 'تنظیم نقشه LAMFA در بار کامل',
            originalTitle: 'تنظیم نقشه LAMFA در بار کامل',
            blocks: [
              {
                type: 'paragraph',
                id: 'p_1',
                text: 'برای دستیابی به نسبت هوا به سوخت 12.8:1 در دورهای بالا باید ضریب لامبدا روی 0.87 تنظیم شود.',
              },
              {
                type: 'list',
                id: 'l_1',
                ordered: true,
                items: [
                  'محدوده دور 3500 تا 6000 RPM را انتخاب کنید.',
                  'از حالت نمایش درصدی در WinOLS برای اعمال تغییرات تدریجی استفاده کنید.',
                ],
              },
              {
                type: 'table',
                id: 't_1',
                caption: 'جدول ۱-۱: راهنمای اصلاح جداول اصلی WinOLS',
                headers: ['نام نقشه', 'آدرس Hex', 'محدوده تغییر مجاز'],
                rows: [
                  ['LAMFA', '0x18A40', 'کاهش ۳٪ تا ۵٪ در بار بالا'],
                  ['KFZW', '0x19C20', 'افزایش +1.5° تا +2.5°'],
                ],
              },
            ],
          },
        ],
      },
    ],
    tableIndex: [
      {
        tableNumber: '۱-۱',
        caption: 'جدول ۱-۱: راهنمای اصلاح جداول اصلی WinOLS',
        chapterNumber: 1,
        chapterTitle: 'فصل ۱: شناخت جداول سوخت و جرقه در WinOLS',
        sectionTitle: 'تنظیم نقشه LAMFA در بار کامل',
      },
    ],
    glossary: [
      {
        term: 'LAMFA',
        definition: 'جدول درخواست نسبت هوا به سوخت بر اساس درخواست راننده در ایسیوهای بوش',
        chapters: [1],
      },
    ],
    footnotes: [
      {
        id: 1,
        canonicalId: 1,
        termKey: 'octane95',
        text: 'مقادیر جدول بر اساس بنزین با اکتان ۹۵ تست شده است.',
        chapters: [1],
      },
    ],
    cheatSheets: [
      {
        id: 'cs_1',
        chapterNumber: 1,
        chapterTitle: 'فصل ۱: شناخت جداول سوخت و جرقه در WinOLS',
        title: 'قانون طلایی کنترل ناک',
        highlights: ['همیشه پس از تغییر KFZW لاگ سنسور ناک را در دنده ۳ بررسی کنید.'],
      },
    ],
    visualSuggestions: [],
    sourceMapRows: [],
    audit: {
      rawWordCount: 180,
      optimizedWordCount: 180,
      rawBlockCount: 5,
      optimizedBlockCount: 5,
      rawFootnoteCount: 1,
      optimizedFootnoteCount: 1,
      duplicateFootnotesMerged: 0,
      duplicateBlocksConsolidated: 0,
      tablesRenumbered: 0,
      unnumberedSectionsFixed: 0,
      artifactsRepaired: 0,
      generatedTablesInserted: 0,
      generatedDiagramsInserted: 0,
      glossaryEntriesCount: 1,
      visualSuggestionsCount: 0,
      conceptRetentionRate: 100,
      conceptChecks: [],
      records: [],
    },
  };
}

test('generateDocxUint8Array enforces 100% RTL OOXML, RTL TOC with dot leaders, tables, and STYLEREF header', async () => {
  const book = buildFixtureBook();
  const bytes = await generateDocxUint8Array(book, {
    ...DEFAULT_DOCX_CONFIG,
    paperSize: 'A4',
    includeCoverPage: true,
    includeAutoToc: true,
    includeHeadersAndFooters: true,
    bodyAlignment: 'both',
  });

  assert.ok(bytes.byteLength > 3000, 'Generated .docx archive should be non-empty');

  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file('word/document.xml')!.async('string');
  const stylesXml = await zip.file('word/styles.xml')!.async('string');
  const settingsXml = await zip.file('word/settings.xml')!.async('string');
  const headerXml = await zip.file('word/header1.xml')!.async('string');

  // 1. Section-level <w:bidi/> inside <w:sectPr>
  const sectMatch = docXml.match(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/);
  assert.ok(sectMatch, 'document.xml must contain <w:sectPr>');
  assert.match(sectMatch[0], /<w:bidi\s*\/>/, '<w:sectPr> must contain <w:bidi/>');

  // 2. 100% RTL Table of Contents inside <w:sdt> with pre-rendered Persian rows + dot leaders + TOC field
  const sdtMatch = docXml.match(/<w:sdt>[\s\S]*?<w:docPartGallery w:val="Table of Contents"\/>[\s\S]*?<\/w:sdt>/);
  assert.ok(sdtMatch, 'document.xml must contain Table of Contents SDT');
  assert.match(sdtMatch[0], /TOC \\o "1-3" \\h \\z \\u/, 'TOC SDT must contain Word auto-TOC instruction');
  assert.match(sdtMatch[0], /<w:pStyle w:val="TOC1"\/>/, 'TOC must include TOC1 volume row');
  assert.match(sdtMatch[0], /<w:pStyle w:val="TOC2"\/>/, 'TOC must include TOC2 chapter row');
  assert.match(sdtMatch[0], /<w:pStyle w:val="TOC3"\/>/, 'TOC must include TOC3 section row');
  assert.match(sdtMatch[0], /<w:bidi\/>/, 'TOC paragraphs must enforce <w:bidi/>');
  assert.match(sdtMatch[0], /w:leader="dot" w:pos="9406"/, 'A4 TOC must set dot leader tab stop at 9406 dxa');
  assert.ok(sdtMatch[0].includes('فصل ۱: شناخت جداول سوخت و جرقه در WinOLS'), 'Pre-rendered TOC must contain chapter title');
  assert.ok(sdtMatch[0].includes('۱-۱. تنظیم نقشه LAMFA در بار کامل'), 'Pre-rendered TOC must contain section title');

  // 3. Styles XML defines TOC1, TOC2, TOC3, TOCHeading, and RTL defaults
  assert.match(stylesXml, /w:styleId="TOCHeading"/, 'styles.xml must define TOCHeading');
  assert.match(stylesXml, /w:styleId="TOC1"/, 'styles.xml must define TOC1');
  assert.match(stylesXml, /w:styleId="TOC2"/, 'styles.xml must define TOC2');
  assert.match(stylesXml, /w:styleId="TOC3"/, 'styles.xml must define TOC3');
  assert.match(stylesXml, /<w:pPrDefault>[\s\S]*?<w:bidi\/>[\s\S]*?<\/w:pPrDefault>/, 'pPrDefault must enforce <w:bidi/>');
  assert.match(stylesXml, /w:bidi="fa-IR"/, 'styles.xml must declare fa-IR bidirectional language');

  // 4. Settings XML enforces updateFields and fa-IR themeFontLang
  assert.match(settingsXml, /<w:updateFields w:val="true"\/>/, 'settings.xml must enable updateFields');
  assert.match(settingsXml, /<w:themeFontLang w:val="en-US" w:bidi="fa-IR"\/>/, 'settings.xml must declare Persian bidi themeFontLang');

  // 5. All tables enforce <w:bidiVisual/>, plus tblHeader & cantSplit
  const tblPrMatches = docXml.match(/<w:tblPr\b[^>]*>[\s\S]*?<\/w:tblPr>/g) || [];
  assert.ok(tblPrMatches.length >= 3, 'Expected cover card, callout, metadata, and data tables');
  for (const tblPr of tblPrMatches) {
    assert.match(tblPr, /<w:bidiVisual\s*\/>/, 'Every table must have <w:bidiVisual/>');
  }
  assert.match(docXml, /<w:tblHeader\s*\/>/, 'Data table must repeat header row across pages');
  assert.match(docXml, /<w:cantSplit\s*\/>/, 'Table/callout rows must avoid mid-row page splits');

  // 6. Dynamic STYLEREF "Heading 2" running header with RTL
  assert.match(headerXml, /STYLEREF "Heading 2"/, 'Running header must contain dynamic STYLEREF "Heading 2" field');
  assert.match(headerXml, /<w:bidiVisual\s*\/>/, 'Running header table must be RTL');
});
