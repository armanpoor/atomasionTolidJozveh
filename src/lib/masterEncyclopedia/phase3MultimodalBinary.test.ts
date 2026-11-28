import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignPostAsrAutomotiveTerms,
  mergeMultiPageBrokenTables,
  normalizeImageExtractionForEncyclopedia,
  stripBase64ImagesFromMarkdown,
  stripImageExifBytes,
} from './multimodalExtractors.ts';
import {
  analyzeEcuFileInMemory,
  classifyEcuFlashSize,
  formatEcuProfileAsMarkdown,
  parseAsap2A2lContent,
  parseCalibrationCsvContent,
  parseTunerProXdfContent,
} from './ecuBinaryAnalyzer.ts';

describe('Phase 3 — Multimodal Extractors & Safe ECU Binary Analysis', () => {
  it('merges multi-page broken DTC and ECU pinout tables across page breaks and repeated headers', () => {
    const brokenMd = [
      '## جدول کدهای خطا DTC',
      '| کد خطا | شرح خطا | سیستم |',
      '| --- | --- | --- |',
      '| P0420 | افت راندمان کاتالیست | اگزوز |',
      '| P0300 | میس‌فایر تصادفی | احتراق |',
      '',
      'صفحه 2 از 10',
      '---',
      '| کد خطا | شرح خطا | سیستم |',
      '| --- | --- | --- |',
      '| P0171 | مخلوط سوخت رقیق | سوخت‌رسانی |',
      '| U0100 | قطع ارتباط با ECU | شبکه CAN |',
      '',
      'توضیحات پایانی پس از جدول.',
    ].join('\n');

    const { mergedMarkdown, mergedTablesCount } = mergeMultiPageBrokenTables(brokenMd);
    assert.equal(mergedTablesCount, 1);
    assert.ok(mergedMarkdown.includes('| P0420 |'));
    assert.ok(mergedMarkdown.includes('| P0171 |'));
    assert.ok(mergedMarkdown.includes('| U0100 |'));
    // Header must appear only once after merging
    const headerOccurrences = mergedMarkdown.split('| کد خطا | شرح خطا | سیستم |').length - 1;
    assert.equal(headerOccurrences, 1);
  });

  it('aligns Persian/English Post-ASR automotive terms accurately without harming surrounding prose', () => {
    const rawAsr =
      'در نرم‌افزار وینولز برای خواندن فایل دیموس ایسیو بوش ام ای هفت چهار چهار ابتدا جدول کی اف زد دبلیو و لامفا را بررسی کرده و روی شبکه کن باس و او بی دی دو کد دی تی سی را چک می‌کنیم.';
    const { alignedText, replacementsApplied } = alignPostAsrAutomotiveTerms(rawAsr);
    assert.ok(replacementsApplied >= 6);
    assert.ok(alignedText.includes('WinOLS'));
    assert.ok(alignedText.includes('DAMOS'));
    assert.ok(alignedText.includes('ECU'));
    assert.ok(alignedText.includes('Bosch ME7.4.4'));
    assert.ok(alignedText.includes('KFZW'));
    assert.ok(alignedText.includes('LAMFA'));
    assert.ok(alignedText.includes('CAN-BUS'));
    assert.ok(alignedText.includes('OBD-II'));
    assert.ok(alignedText.includes('DTC'));
  });

  it('strips EXIF segments from JPEG and eXIf chunks from PNG, and guarantees zero Base64 images in encyclopedia Markdown', () => {
    // Minimal synthetic JPEG: SOI + APP1(EXIF) + SOS(pixel payload) + EOI
    const jpegWithExif = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 EXIF
      0xff, 0xda, 0x00, 0x04, 0x11, 0x22, // SOS + data
      0xff, 0xd9, // EOI
    ]);
    const jpgClean = stripImageExifBytes(jpegWithExif, 'jpg');
    assert.equal(jpgClean.strippedMetadataSegments, 1);
    assert.ok(jpgClean.cleanedBytes.length < jpegWithExif.length);
    assert.equal(jpgClean.cleanedBytes[0], 0xff);
    assert.equal(jpgClean.cleanedBytes[1], 0xd8);

    // PNG with eXIf chunk
    const pngWithExif = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x02, // len=2
      0x65, 0x58, 0x49, 0x66, // "eXIf"
      0x49, 0x49, // data
      0x00, 0x00, 0x00, 0x00, // crc
      0x00, 0x00, 0x00, 0x00, // len=0
      0x49, 0x45, 0x4e, 0x44, // "IEND"
      0x00, 0x00, 0x00, 0x00, // crc
    ]);
    const pngClean = stripImageExifBytes(pngWithExif, 'png');
    assert.equal(pngClean.strippedMetadataSegments, 1);

    // Zero Base64 guarantee in encyclopedia Markdown
    const normalized = normalizeImageExtractionForEncyclopedia({
      domainTag: 'electrical_networks',
      summaryFa:
        'تصویر پیناوت ECU ![pin](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA) استخراج شد.',
      extractedNumbers: [
        { label: 'ولتاژ تغذیه اصلی', value: '12.6', unit: 'V' },
        { label: 'ولتاژ پایه ناخوانا', value: null, unit: null },
      ],
      hexAddresses: ['0x18000'],
      pinoutRows: [{ pin: 'A3', signal: 'CAN-H', voltageOrNote: '2.5V–3.5V' }],
      dynoOrChartNotesFa: null,
      unreadableRegionsWarning: true,
      optionalImageRefId: 'img_ref_01',
    });

    assert.ok(!normalized.markdown.includes('data:image/'));
    assert.ok(normalized.markdown.includes('نامشخص / ناخوانا در تصویر'));
    assert.equal(normalized.metadata.imagePublicationApproved, false);
    assert.equal(normalized.metadata.evidenceTier, 'text_or_screenshot_reported');

    const base64Strip = stripBase64ImagesFromMarkdown('متن data:image/jpeg;base64,/9j/4AAQSkZJRg== پایان');
    assert.equal(base64Strip.removedBase64Count, 1);
    assert.ok(!base64Strip.cleanMarkdown.includes('data:image/'));
  });

  it('parses real .a2l, .xdf, and .csv files with Strict Null Policy and No Invented Map Names', () => {
    const sampleA2l = `
      /begin COMPU_METHOD CM_IGN "Ignition deg" RAT_FUNC "%6.2" "deg"
        COEFFS_LINEAR 0.75 -23.4
      /end COMPU_METHOD
      /begin CHARACTERISTIC KFZW "Ignition Angle Base" MAP 0x18000 DP_SWORD_16 0 CM_IGN -20 60
        BYTE_ORDER MSB_FIRST
        /begin AXIS_DESCR STD_AXIS NO_INPUT_QUANTITY CM_IGN 16 0 7000
        /end AXIS_DESCR
        /begin AXIS_DESCR STD_AXIS NO_INPUT_QUANTITY CM_IGN 12 0 100
        /end AXIS_DESCR
      /end CHARACTERISTIC
    `;
    const a2lMaps = parseAsap2A2lContent(sampleA2l);
    assert.equal(a2lMaps.length, 1);
    assert.equal(a2lMaps[0].mapName, 'KFZW');
    assert.equal(a2lMaps[0].hexAddress, '0x18000');
    assert.equal(a2lMaps[0].dimensions, '16x12');
    assert.equal(a2lMaps[0].bitWidth, 16);
    assert.equal(a2lMaps[0].byteOrder, 'HiLo');
    assert.equal(a2lMaps[0].factor, 0.75);
    assert.equal(a2lMaps[0].offset, -23.4);
    assert.equal(a2lMaps[0].stockValue, null);
    assert.equal(a2lMaps[0].safeChangeRange, null);
    assert.equal(a2lMaps[0].evidenceTier, 'a2l_xdf_verified');
    assert.equal(a2lMaps[0].flashReady, false);

    const sampleXdf = `
      <XDFFORMAT version="1.60">
        <XDFHEADER>
          <BASEOFFSET offset="0x10000" subtract="0" />
        </XDFHEADER>
        <XDFTABLE uniqueid="0x1">
          <title></title>
          <EMBEDDEDDATA mmedaddress="0x8000" mmedelementsizebits="16" mmedtypeflags="0x02" mmedrowcount="16" mmedcolcount="16" />
          <MATH equation="X*0.0078125+0" />
          <units>lambda</units>
        </XDFTABLE>
      </XDFFORMAT>
    `;
    const xdfMaps = parseTunerProXdfContent(sampleXdf);
    assert.equal(xdfMaps.length, 1);
    // Unnamed map MUST NOT be invented; gets UNKNOWN_MAP_<HEX>
    assert.equal(xdfMaps[0].hexAddress, '0x18000');
    assert.equal(xdfMaps[0].mapName, 'UNKNOWN_MAP_0x18000');
    assert.equal(xdfMaps[0].byteOrder, 'LoHi');
    assert.equal(xdfMaps[0].factor, 0.0078125);

    const sampleCsv = [
      'name,address,dimensions,bit_width,byte_order,factor,offset,unit',
      ',0x1C400,12x12,16,HiLo,0.5,0,Nm',
    ].join('\n');
    const csvMaps = parseCalibrationCsvContent(sampleCsv);
    assert.equal(csvMaps.length, 1);
    assert.equal(csvMaps[0].mapName, 'UNKNOWN_MAP_0x1C400');
    assert.equal(csvMaps[0].stockValue, null);
    assert.equal(csvMaps[0].safeChangeRange, null);
  });

  it('analyzes raw ECU binary in-memory (SHA-256, size class, ECU family, HW/SW), produces zero hallucinated maps, and immediately zeroes raw buffer', () => {
    assert.equal(classifyEcuFlashSize(512 * 1024), '512KB');
    assert.equal(classifyEcuFlashSize(2 * 1024 * 1024), '2MB');

    // Construct 512KB synthetic ECU binary containing Bosch ME7.4.4 ASCII metadata
    const binBuffer = new Uint8Array(512 * 1024);
    const asciiMeta = new TextEncoder().encode(
      'BOSCH ME7.4.4 HW 0261206943 SW 1037381234 PEUGEOT TU5JP4'
    );
    binBuffer.set(asciiMeta, 0x100);

    const profile = analyzeEcuFileInMemory({
      fileName: 'peugeot206_me744.bin',
      rawBytes: binBuffer,
      zeroBufferAfterAnalysis: true,
    });

    assert.equal(profile.sizeClass, '512KB');
    assert.equal(profile.rawBinaryStored, false);
    assert.equal(profile.memoryPurgedAfterAnalysis, true);
    assert.ok(profile.detectedEcuFamilies.includes('Bosch ME7.4.4'));
    assert.ok(profile.detectedHwNumbers.includes('0261206943'));
    assert.ok(profile.detectedSwNumbers.includes('1037381234'));
    assert.equal(profile.extractedMaps.length, 0); // Zero hallucination on raw .bin!

    // CRITICAL SECURITY CHECK: raw buffer MUST be completely zeroed after analysis!
    let nonZeroBytes = 0;
    for (let i = 0; i < binBuffer.length; i++) {
      if (binBuffer[i] !== 0) nonZeroBytes += 1;
    }
    assert.equal(nonZeroBytes, 0);

    const md = formatEcuProfileAsMarkdown(profile);
    assert.ok(md.includes('Bosch ME7.4.4'));
    assert.ok(md.includes('0261206943'));
    assert.ok(md.includes('هشدار ایمنی'));
  });
});
