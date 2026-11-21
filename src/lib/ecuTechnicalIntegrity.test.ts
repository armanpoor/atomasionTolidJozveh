import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEcuPlatforms,
  extractTechnicalEntities,
  hasDisjointEcuPlatforms,
  mergeCompatibleTablesLossless,
  runTechnicalEntityIntegrityAudit,
  segmentBidiTechnicalRuns,
} from './ecuTechnicalIntegrity.ts';
import { ParsedBook, TableBlock } from './bookTypes.ts';

test('segmentBidiTechnicalRuns isolates hex addresses, DTC codes, ECU models, ratios, and signed advances as LTR inside RTL Persian text', () => {
  const input =
    'در ایسیو ME7.4.4 نقشه KFZW با ابعاد 16x16 در آدرس 0x1A4F0 قرار دارد؛ نسبت 14.7:1 و آوانس -2.5° و کد خطای P0135 بررسی شود.';
  const segs = segmentBidiTechnicalRuns(input);

  assert.ok(segs.some((s) => s.kind === 'ltr_tech' && s.text === 'ME7.4.4'));
  assert.ok(segs.some((s) => s.kind === 'ltr_tech' && s.text === 'KFZW'));
  assert.ok(segs.some((s) => s.kind === 'ltr_tech' && s.text === '16x16'));
  assert.ok(segs.some((s) => s.kind === 'ltr_code' && s.text === '0x1A4F0'));
  assert.ok(segs.some((s) => s.kind === 'ltr_tech' && s.text === '14.7:1'));
  assert.ok(segs.some((s) => s.kind === 'ltr_tech' && s.text === '-2.5°'));
  assert.ok(segs.some((s) => s.kind === 'ltr_code' && s.text === 'P0135'));
  // Concatenated text must reconstruct original input byte-for-byte (zero character loss!)
  assert.equal(segs.map((s) => s.text).join(''), input);
});

test('extractEcuPlatforms and hasDisjointEcuPlatforms isolate distinct ECUs to prevent false contradictions', () => {
  const textA = 'در ایسیو بوش ME7.4.4 حداکثر فشار ریل سوخت ۳.۵ بار است.';
  const textB = 'در ایسیو زیمنس SIM2K-241 حداکثر فشار ریل سوخت ۴.۲ بار است.';
  const textC = 'در ایسیو ME7.4.4 حداکثر فشار ریل سوخت ۵ بار توصیه شده است.';

  assert.ok(extractEcuPlatforms(textA).has('bosch_me744'));
  assert.ok(extractEcuPlatforms(textB).has('siemens_sim2k'));
  assert.equal(hasDisjointEcuPlatforms(textA, textB), true);
  assert.equal(hasDisjointEcuPlatforms(textA, textC), false);
});

test('mergeCompatibleTablesLossless deduplicates identical rows, appends unique rows, and preserves cell-level conflicts transparently', () => {
  const tableA: TableBlock = {
    type: 'table',
    id: 't1',
    caption: 'جدول آدرس نقشه‌های ME7.4.4',
    headers: ['نام نقشه', 'آدرس هگز', 'ابعاد'],
    rows: [
      ['KFZW', '0x1A4F0', '12x16'],
      ['LAMFA', '0x1C200', '6x15'],
    ],
  };

  const tableB: TableBlock = {
    type: 'table',
    id: 't2',
    caption: 'جدول نقشه‌های ریمپ',
    headers: ['نام نقشه', 'آدرس هگز', 'ابعاد'],
    rows: [
      ['KFZW', '0x1A4F0', '12x16'], // exact duplicate
      ['LAMFA', '0x1C350', '6x15'], // cell conflict on same key!
      ['NMAX', '0x1F100', '1x1'], // genuinely new row!
    ],
  };

  const res = mergeCompatibleTablesLossless(tableA, tableB, 'جزوه_۱.docx', 'جزوه_۲.docx');
  assert.equal(res.compatible, true);
  assert.equal(res.dedupedRowCount, 1);
  assert.equal(res.addedRowCount, 1);
  assert.equal(res.mergedTable.rows.length, 3);
  assert.equal(res.rowConflicts.length, 1);
  assert.equal(res.rowConflicts[0].rowKey, 'LAMFA');
  assert.match(res.mergedTable.rows[1][1], /0x1C200.*0x1C350/);
  assert.equal(res.mergedTable.rows[2][0], 'NMAX');
});

test('runTechnicalEntityIntegrityAudit guarantees 100% detection of hex, DTC, ECU model, and map retention or missing items', () => {
  const sources = [
    'در ایسیو ME7.4.4 نقشه KFZW در 0x1A4F0 قرار دارد و خطای P0135 بررسی شود.',
    'در نقشه LAMFA خطای P0420 مربوط به کاتالیست است.',
  ];
  const entities = extractTechnicalEntities(sources.join('\n'));
  assert.deepEqual(entities.hexAddresses, ['0x1A4F0']);
  assert.deepEqual(entities.dtcCodes, ['P0135', 'P0420']);
  assert.deepEqual(entities.ecuModels, ['ME7.4.4']);
  assert.deepEqual(entities.mapIdentifiers, ['KFZW', 'LAMFA']);

  const completeBook: ParsedBook = {
    title: 'کتاب ریمپ',
    subtitle: '',
    editionNote: '',
    sourceFiles: ['a.docx'],
    volumes: [{ id: 'v1', index: 1, title: 'مجلد ۱' }],
    chapters: [
      {
        id: 'c1',
        chapterNumber: 1,
        title: 'فصل ۱',
        sourceFileName: 'a.docx',
        volumeIndex: 1,
        volumeTitle: 'مجلد ۱',
        meta: [],
        introBlocks: [],
        sections: [
          {
            id: 's1',
            numberLabel: '۱-۱',
            title: 'بخش ۱',
            originalTitle: 'بخش ۱',
            blocks: [
              {
                type: 'paragraph',
                id: 'p1',
                text: 'ایسیو ME7.4.4 نقشه KFZW در 0x1A4F0 و LAMFA با کدهای P0135 و P0420',
              },
            ],
          },
        ],
      },
    ],
    footnotes: [],
    glossary: [],
    tableIndex: [],
    cheatSheets: [],
    visualSuggestions: [],
    sourceMapRows: [],
  };

  const passAudit = runTechnicalEntityIntegrityAudit(sources, completeBook);
  assert.equal(passAudit.retentionPercent, 100);
  assert.equal(passAudit.missingEntities.length, 0);
  assert.equal(passAudit.totalEntitiesInSources, 6);

  // Drop P0420 from output -> audit MUST catch it deterministically!
  completeBook.chapters[0].sections[0].blocks[0] = {
    type: 'paragraph',
    id: 'p1',
    text: 'ایسیو ME7.4.4 نقشه KFZW در 0x1A4F0 و LAMFA با کد P0135',
  };
  const failAudit = runTechnicalEntityIntegrityAudit(sources, completeBook);
  assert.deepEqual(failAudit.missingEntities, ['P0420']);
  assert.ok(failAudit.retentionPercent < 100);
});

test('parseDocxDocument resolves custom basedOn headings, numbering.xml lists, gridSpan/vMerge tables, txbxContent callouts, and multiple images per paragraph', async () => {
  const JSZip = (await import('jszip')).default;
  const { parseDocxDocument } = await import('./formatParsers.ts');

  const zip = new JSZip();
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
      <w:style w:type="paragraph" w:styleId="MyPersianChapter">
        <w:name w:val="تیتر فصل سفارشی"/>
        <w:basedOn w:val="Heading1"/>
      </w:style>
    </w:styles>`
  );
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>
    </w:numbering>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img1.png"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img2.png"/>
    </Relationships>`
  );
  // Minimal 1x1 PNG bytes for both images
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  zip.file('word/media/img1.png', tinyPng);
  zip.file('word/media/img2.png', tinyPng);

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <w:body>
        <w:p>
          <w:pPr><w:pStyle w:val="MyPersianChapter"/></w:pPr>
          <w:r><w:t>فصل ۱: کالیبراسیون ME7.4.4</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:rPr><w:b/></w:rPr><w:t>هشدار مهم:</w:t></w:r>
          <w:r><w:t> آدرس 0x1A4F0 را پیش از تغییر بکاپ بگیرید.</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>
          <w:r><w:t>خواندن دامپ با پروگرامر</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>
          <w:r><w:t>اصلاح نقشه KFZW</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r>
          <w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r>
        </w:p>
        <w:p>
          <w:txbxContent>
            <w:p><w:r><w:t>کادر نکته: در دور آرام آوانس نباید بیش از حد افزایش یابد.</w:t></w:r></w:p>
          </w:txbxContent>
        </w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>پین</w:t></w:r></w:p></w:tc>
            <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>مشخصات الکتریکی</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>پین ۱</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>ولتاژ</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>12V</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>جریان</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>2A</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      </w:body>
    </w:document>`
  );

  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  const parsed = await parseDocxDocument(buf, 'ecu_test.docx');

  assert.equal(parsed.chapters.length, 1);
  assert.match(parsed.chapters[0].title, /ME7\.4\.4/);

  const blocks = [
    ...parsed.chapters[0].introBlocks,
    ...parsed.chapters[0].sections.flatMap((s) => s.blocks),
  ];

  // Bold inline preserved
  const boldPara = blocks.find((b) => b.type === 'paragraph' && b.text.includes('**هشدار مهم:**'));
  assert.ok(boldPara, 'Expected inline <w:b/> to be preserved as bold markdown');

  // Numbered list from word/numbering.xml preserved as ordered list
  const orderedList = blocks.find((b) => b.type === 'list' && b.ordered === true);
  assert.ok(orderedList && orderedList.type === 'list' && orderedList.items.length === 2);

  // BOTH images in the single paragraph extracted (zero silent drop!)
  const imageBlocks = blocks.filter((b) => b.type === 'image');
  assert.equal(imageBlocks.length, 2, 'Expected both embedded images from same paragraph to be extracted');

  // Floating TextBox extracted as callout
  const txbxCallout = blocks.find(
    (b) => b.type === 'callout' && b.paragraphs.some((p) => p.includes('دور آرام'))
  );
  assert.ok(txbxCallout, 'Expected <w:txbxContent> to be extracted cleanly as callout');

  // Table gridSpan (3 columns) and vMerge propagation ("پین ۱" carried to row 2)
  const tbl = blocks.find((b) => b.type === 'table');
  assert.ok(tbl && tbl.type === 'table');
  assert.equal(tbl.headers.length, 3);
  assert.equal(tbl.rows.length, 2);
  assert.equal(tbl.rows[0][0], 'پین ۱');
  assert.equal(tbl.rows[1][0], 'پین ۱');
});

test('runDeterministicLosslessDedup fuses compatible tables row-by-row with payloadJson persistence and isolates cross-ECU & stock-vs-Stage1 values', async () => {
  const { runDeterministicLosslessDedup, extractAtomicUnitsFromBook } = await import(
    './zeroLossPipeline.ts'
  );
  const { parseAnySourceFile } = await import('./formatParsers.ts');

  const md1 = [
    '# فصل ۱: کالیبراسیون',
    'در ایسیو ME7.4.4 حداکثر فشار بوست در حالت فابریک برابر 0.8 bar است.',
    'حداکثر فشار ریل در حالت استوک برابر 3.5 bar اندازه‌گیری می‌شود.',
    [
      '| پارامتر | مقدار | واحد |',
      '| --- | --- | --- |',
      '| نسبت استوکیومتری | 14.7:1 | AFR |',
      '| آدرس KFZW | 0x1A4F0 | HEX |',
    ].join('\n'),
  ].join('\n\n');

  const md2 = [
    '# فصل ۱: کالیبراسیون',
    'در ایسیو SIM2K-241 حداکثر فشار بوست در حالت فابریک برابر 1.2 bar است.',
    'حداکثر فشار ریل در حالت استیج ۱ برابر 4.2 bar اندازه‌گیری می‌شود.',
    [
      '| پارامتر | مقدار | واحد |',
      '| --- | --- | --- |',
      '| نسبت استوکیومتری | 14.7:1 | AFR |',
      '| آدرس KFMIRL | 0x1A520 | HEX |',
    ].join('\n'),
  ].join('\n\n');

  const book1 = await parseAnySourceFile({ name: 'f1.md', format: 'md', text: md1 });
  const book2 = await parseAnySourceFile({ name: 'f2.md', format: 'md', text: md2 });

  const units1 = extractAtomicUnitsFromBook({
    projectId: 'p_test',
    sourceFileId: 'sf1',
    fileName: 'f1.md',
    fileRole: 'standard',
    book: book1,
    startingOrder: 0,
  });
  const units2 = extractAtomicUnitsFromBook({
    projectId: 'p_test',
    sourceFileId: 'sf2',
    fileName: 'f2.md',
    fileRole: 'standard',
    book: book2,
    startingOrder: units1.length,
  });

  const result = runDeterministicLosslessDedup({
    projectId: 'p_test',
    workflowMode: 'multi_merge',
    sourceFiles: [
      {
        id: 'sf1',
        projectId: 'p_test',
        fileName: 'f1.md',
        format: 'md',
        fileRole: 'standard',
        wordCount: 50,
        sizeBytes: 200,
        checksum: 'h1',
        unitCount: units1.length,
        uploadedAt: new Date().toISOString(),
      },
      {
        id: 'sf2',
        projectId: 'p_test',
        fileName: 'f2.md',
        format: 'md',
        fileRole: 'standard',
        wordCount: 50,
        sizeBytes: 200,
        checksum: 'h2',
        unitCount: units2.length,
        uploadedAt: new Date().toISOString(),
      },
    ],
    units: [...units1, ...units2].map((u) => ({
      ...u,
      unitType: u.unitType as import('./bookTypes.ts').ContentUnitDto['unitType'],
      status: u.status as import('./bookTypes.ts').ContentUnitDto['status'],
      canonicalUnitId: null,
      outlineNodeId: null,
    })),
  });

  // Zero false conflicts for ME7.4.4 vs SIM2K-241 and stock vs Stage 1!
  assert.equal(result.conflicts.length, 0);

  // Table from f2 merged row-by-row into canonical table from f1 with payloadJson persisted
  const canonicalTableUpdate = result.unitUpdates.find(
    (u) => u.payloadJson && (u.payloadJson.block as TableBlock | undefined)?.type === 'table'
  );
  assert.ok(canonicalTableUpdate, 'Expected merged table unitUpdate to carry updated payloadJson');
  const mergedBlock = canonicalTableUpdate.payloadJson!.block as TableBlock;
  assert.equal(mergedBlock.rows.length, 3, 'Expected 2 original rows + 1 new unique row (1 duplicate removed)');
});
