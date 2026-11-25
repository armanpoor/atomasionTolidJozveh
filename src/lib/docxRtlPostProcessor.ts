import JSZip from 'jszip';
import { DocxExportConfig, ParsedBook } from './bookTypes.ts';
import { toPersianDigits } from './formatParsers.ts';

export const HEADER_CHAPTER_STYLEREF_MARKER = '__DOCX_STYLEREF_CHAPTER_MARKER__';

function escapeXml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function computeContentWidthDxa(config: DocxExportConfig): number {
  const pageWidth = config.paperSize === 'B5' ? 9979 : 11906;
  const marginRight = 1350;
  const marginLeft = 1150;
  return pageWidth - marginRight - marginLeft;
}

interface PreRenderedTocRow {
  styleId: 'TOC1' | 'TOC2' | 'TOC3';
  title: string;
  pageLabel: string;
  indentLeftDxa: number;
  sizeHalfPt: number;
  bold: boolean;
  colorHex: string;
  spaceBefore: number;
  spaceAfter: number;
}

/**
 * Builds deterministic pre-rendered RTL TOC rows matching the exact hierarchy of Heading 1-3
 * so that even before Word refreshes fields (or in Google Docs / LibreOffice / Word Protected View),
 * the user immediately sees a complete, 100% right-to-left Persian Table of Contents with dot leaders.
 */
function buildPreRenderedTocRows(book: ParsedBook, config: DocxExportConfig): PreRenderedTocRow[] {
  const rows: PreRenderedTocRow[] = [];
  let estimatedPage = config.includeCoverPage ? 3 : 2;
  let lastVolumeIndex = -1;

  for (const chapter of book.chapters) {
    if (chapter.volumeIndex !== lastVolumeIndex) {
      lastVolumeIndex = chapter.volumeIndex;
      const volObj = book.volumes.find((v) => v.index === chapter.volumeIndex);
      const volTitle = volObj?.title || chapter.volumeTitle;
      rows.push({
        styleId: 'TOC1',
        title: volTitle,
        pageLabel: toPersianDigits(estimatedPage),
        indentLeftDxa: 0,
        sizeHalfPt: 23,
        bold: true,
        colorHex: '1E3A5F',
        spaceBefore: 140,
        spaceAfter: 45,
      });
    }

    rows.push({
      styleId: 'TOC2',
      title: chapter.title,
      pageLabel: toPersianDigits(estimatedPage),
      indentLeftDxa: 260,
      sizeHalfPt: 21,
      bold: true,
      colorHex: '1A1816',
      spaceBefore: 70,
      spaceAfter: 35,
    });

    for (const sec of chapter.sections) {
      const secLabel = sec.numberLabel ? `${sec.numberLabel}. ${sec.title}` : sec.title;
      rows.push({
        styleId: 'TOC3',
        title: secLabel,
        pageLabel: toPersianDigits(estimatedPage),
        indentLeftDxa: 560,
        sizeHalfPt: 19,
        bold: false,
        colorHex: '57534E',
        spaceBefore: 25,
        spaceAfter: 25,
      });
    }

    // Advance rough estimated page count based on chapter volume
    const blockCount =
      chapter.introBlocks.length +
      chapter.sections.reduce((acc, s) => acc + s.blocks.length, 0);
    estimatedPage += Math.max(1, Math.ceil(blockCount / 7));
  }

  if (config.includeMasterCheatSheet && book.cheatSheets.length > 0) {
    rows.push({
      styleId: 'TOC1',
      title: 'پیوست ویژه: برگه تقلب جامع و قوانین طلایی کارگاهی',
      pageLabel: toPersianDigits(estimatedPage++),
      indentLeftDxa: 0,
      sizeHalfPt: 22,
      bold: true,
      colorHex: '1E3A5F',
      spaceBefore: 120,
      spaceAfter: 40,
    });
  }
  if (config.includeListOfTables && book.tableIndex.length > 0) {
    rows.push({
      styleId: 'TOC1',
      title: 'پیوست الف: فهرست کامل جداول (شماره‌گذاری یکپارچه)',
      pageLabel: toPersianDigits(estimatedPage++),
      indentLeftDxa: 0,
      sizeHalfPt: 22,
      bold: true,
      colorHex: '1E3A5F',
      spaceBefore: 80,
      spaceAfter: 40,
    });
  }
  if (config.includeGlossary && book.glossary.length > 0) {
    rows.push({
      styleId: 'TOC1',
      title: 'پیوست ب: واژه‌نامه یکپارچه اصطلاحات تخصصی',
      pageLabel: toPersianDigits(estimatedPage++),
      indentLeftDxa: 0,
      sizeHalfPt: 22,
      bold: true,
      colorHex: '1E3A5F',
      spaceBefore: 80,
      spaceAfter: 40,
    });
  }
  if (config.includeFootnotesSection && book.footnotes.length > 0) {
    rows.push({
      styleId: 'TOC1',
      title: 'پیوست ج: پانویس‌های یکتا و توضیحات تکمیلی',
      pageLabel: toPersianDigits(estimatedPage++),
      indentLeftDxa: 0,
      sizeHalfPt: 22,
      bold: true,
      colorHex: '1E3A5F',
      spaceBefore: 80,
      spaceAfter: 40,
    });
  }

  return rows;
}

function buildRtlTocSdtXml(book: ParsedBook, config: DocxExportConfig): string {
  const font = escapeXml(config.fontFamily);
  const contentWidth = computeContentWidthDxa(config);
  const rows = buildPreRenderedTocRows(book, config);

  const fontTags = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>`;
  const langTags = `<w:lang w:val="fa-IR" w:bidi="fa-IR"/>`;

  const renderRowXml = (row: PreRenderedTocRow, isFirst: boolean, isLast: boolean): string => {
    const boldXml = row.bold ? '<w:b/><w:bCs/>' : '';
    const indXml = row.indentLeftDxa > 0 ? `<w:ind w:left="${row.indentLeftDxa}"/>` : '';
    const beginFieldXml = isFirst
      ? `<w:r><w:rPr>${fontTags}<w:rtl/>${langTags}</w:rPr><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:rPr>${fontTags}<w:rtl/>${langTags}</w:rPr><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:rPr>${fontTags}<w:rtl/>${langTags}</w:rPr><w:fldChar w:fldCharType="separate"/></w:r>`
      : '';
    const endFieldXml = isLast
      ? `<w:r><w:rPr>${fontTags}<w:rtl/>${langTags}</w:rPr><w:fldChar w:fldCharType="end"/></w:r>`
      : '';

    return [
      '<w:p>',
      `<w:pPr><w:pStyle w:val="${row.styleId}"/><w:bidi/><w:jc w:val="start"/>${indXml}<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${contentWidth}"/></w:tabs><w:spacing w:before="${row.spaceBefore}" w:after="${row.spaceAfter}" w:line="300" w:lineRule="auto"/></w:pPr>`,
      beginFieldXml,
      `<w:r><w:rPr>${fontTags}${boldXml}<w:color w:val="${row.colorHex}"/><w:sz w:val="${row.sizeHalfPt}"/><w:szCs w:val="${row.sizeHalfPt}"/><w:rtl/>${langTags}</w:rPr><w:t xml:space="preserve">${escapeXml(row.title)}</w:t></w:r>`,
      `<w:r><w:rPr>${fontTags}<w:color w:val="8C857B"/><w:sz w:val="${row.sizeHalfPt}"/><w:szCs w:val="${row.sizeHalfPt}"/><w:rtl/>${langTags}</w:rPr><w:tab/></w:r>`,
      `<w:r><w:rPr>${fontTags}${boldXml}<w:color w:val="1E3A5F"/><w:sz w:val="${row.sizeHalfPt}"/><w:szCs w:val="${row.sizeHalfPt}"/><w:rtl/>${langTags}</w:rPr><w:t>${escapeXml(row.pageLabel)}</w:t></w:r>`,
      endFieldXml,
      '</w:p>',
    ].join('');
  };

  const bodyParagraphsXml =
    rows.length > 0
      ? rows
          .map((row, idx) => renderRowXml(row, idx === 0, idx === rows.length - 1))
          .join('')
      : `<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:bidi/><w:jc w:val="start"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${contentWidth}"/></w:tabs></w:pPr><w:r><w:rPr>${fontTags}<w:rtl/>${langTags}</w:rPr><w:fldChar w:fldCharType="begin" w:dirty="true"/><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>برای بروزرسانی فهرست مطالب، راست‌کلیک کرده و Update Field را بزنید.</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

  return [
    '<w:sdt>',
    '<w:sdtPr>',
    '<w:alias w:val="فهرست مطالب"/>',
    '<w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>',
    '</w:sdtPr>',
    '<w:sdtContent>',
    bodyParagraphsXml,
    '</w:sdtContent>',
    '</w:sdt>',
  ].join('');
}

function injectBidiIntoSectPr(xml: string): string {
  return xml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, (sectBlock) => {
    if (/<w:bidi(?:\s|\/|>)/.test(sectBlock)) return sectBlock;
    return sectBlock.replace('</w:sectPr>', '<w:bidi/></w:sectPr>');
  });
}

function ensureBidiVisualOnTables(xml: string): string {
  return xml.replace(/<w:tblPr\b[^>]*>[\s\S]*?<\/w:tblPr>/g, (tblPr) => {
    if (/<w:bidiVisual(?:\s|\/|>)/.test(tblPr)) return tblPr;
    return tblPr.replace('</w:tblPr>', '<w:bidiVisual/></w:tblPr>');
  });
}

/**
 * Guarantees that LTR technical runs (e.g. English ECU identifiers, formulas, and hex ranges)
 * inside RTL paragraphs explicitly carry <w:rtl w:val="0"/> and <w:cs w:val="0"/> in Word XML,
 * preventing Microsoft Word from reversing hyphens, slashes, or numbers in RTL mode.
 */
function ensureLtrTechnicalRunsInDocumentXml(xml: string): string {
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (runXml) => {
    const isLtrRun =
      runXml.includes('w:val="en-US"') ||
      runXml.includes('\u202A') ||
      runXml.includes('\u2066');
    if (!isLtrRun) return runXml;

    return runXml.replace(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/, (rPrFull, rPrInner) => {
      let patchedInner = rPrInner;
      if (/<w:rtl(?:\s|\/|>)/.test(patchedInner)) {
        patchedInner = patchedInner.replace(
          /<w:rtl\b[^>]*\/>|<w:rtl\b[^>]*>[\s\S]*?<\/w:rtl>/g,
          '<w:rtl w:val="0"/>'
        );
      } else {
        patchedInner = `<w:rtl w:val="0"/>${patchedInner}`;
      }
      if (/<w:cs(?:\s|\/|>)/.test(patchedInner)) {
        patchedInner = patchedInner.replace(
          /<w:cs\b[^>]*\/>|<w:cs\b[^>]*>[\s\S]*?<\/w:cs>/g,
          '<w:cs w:val="0"/>'
        );
      }
      return `<w:rPr>${patchedInner}</w:rPr>`;
    });
  });
}

function ensureHeaderFooterBidi(xml: string, fontFamily: string, fallbackTitle: string): string {
  const font = escapeXml(fontFamily);
  let out = ensureBidiVisualOnTables(xml);

  // Replace the running chapter StyleRef marker with a true Word STYLEREF "Heading 2" field
  if (out.includes(HEADER_CHAPTER_STYLEREF_MARKER)) {
    const fieldXml = [
      `</w:t></w:r>`,
      `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:b/><w:bCs/><w:color w:val="1E3A5F"/><w:sz w:val="17"/><w:szCs w:val="17"/><w:rtl/><w:lang w:val="fa-IR" w:bidi="fa-IR"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>`,
      `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:rtl/></w:rPr><w:instrText xml:space="preserve"> STYLEREF "Heading 2" \\* MERGEFORMAT </w:instrText></w:r>`,
      `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:b/><w:bCs/><w:color w:val="1E3A5F"/><w:sz w:val="17"/><w:szCs w:val="17"/><w:rtl/><w:lang w:val="fa-IR" w:bidi="fa-IR"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>`,
      `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:b/><w:bCs/><w:color w:val="1E3A5F"/><w:sz w:val="17"/><w:szCs w:val="17"/><w:rtl/><w:lang w:val="fa-IR" w:bidi="fa-IR"/></w:rPr><w:t>${escapeXml(fallbackTitle)}</w:t></w:r>`,
      `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:rtl/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`,
      `<w:r><w:t>`,
    ].join('');
    out = out.replace(HEADER_CHAPTER_STYLEREF_MARKER, fieldXml);
    // Clean up any empty <w:r><w:t></w:t></w:r> produced around marker
    out = out.replace(/<w:r><w:t><\/w:t><\/w:r>/g, '');
  }

  // Ensure every <w:pPr> inside header/footer contains <w:bidi/>
  out = out.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (full, inner) => {
    if (/<w:bidi(?:\s|\/|>)/.test(inner)) return full;
    return `<w:pPr><w:bidi/>${inner}</w:pPr>`;
  });

  return out;
}

function patchStylesXmlForRtl(stylesXml: string, config: DocxExportConfig): string {
  const font = escapeXml(config.fontFamily);
  let out = stylesXml;

  // 1. Guarantee <w:pPrDefault> carries <w:bidi/>, <w:jc w:val="start"/>, and <w:widowControl/>
  out = out.replace(/<w:pPrDefault\s*\/>/g, () => {
    return `<w:pPrDefault><w:pPr><w:bidi/><w:jc w:val="start"/><w:widowControl/></w:pPr></w:pPrDefault>`;
  });
  out = out.replace(/<w:pPrDefault>([\s\S]*?)<\/w:pPrDefault>/g, (full, inner) => {
    if (!inner.includes('<w:pPr>')) {
      return `<w:pPrDefault><w:pPr><w:bidi/><w:jc w:val="start"/><w:widowControl/></w:pPr>${inner}</w:pPrDefault>`;
    }
    const patchedInner = inner.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (pFull: string, pInner: string) => {
      let next = pInner;
      if (!/<w:bidi(?:\s|\/|>)/.test(next)) next = `<w:bidi/>${next}`;
      if (!/<w:widowControl(?:\s|\/|>)/.test(next)) next = `${next}<w:widowControl/>`;
      return `<w:pPr>${next}</w:pPr>`;
    });
    return `<w:pPrDefault>${patchedInner}</w:pPrDefault>`;
  });

  // 2. Guarantee <w:rPrDefault> carries <w:rtl/> and Persian <w:lang w:val="en-US" w:bidi="fa-IR"/>
  out = out.replace(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/g, (full, inner) => {
    if (!inner.includes('<w:rPr>')) {
      return `<w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:rtl/><w:lang w:val="en-US" w:bidi="fa-IR"/></w:rPr>${inner}</w:rPrDefault>`;
    }
    const patchedInner = inner.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, (rFull: string, rInner: string) => {
      let next = rInner;
      if (!/<w:rtl(?:\s|\/|>)/.test(next)) next = `${next}<w:rtl/>`;
      if (!/<w:lang\b/.test(next)) {
        next = `${next}<w:lang w:val="en-US" w:bidi="fa-IR"/>`;
      } else {
        next = next.replace(/<w:lang\b[^>]*\/>/, '<w:lang w:val="en-US" w:bidi="fa-IR"/>');
      }
      return `<w:rPr>${next}</w:rPr>`;
    });
    return `<w:rPrDefault>${patchedInner}</w:rPrDefault>`;
  });

  // 3. Guarantee Normal style explicitly has <w:bidi/> so Word built-in TOC/List/Caption styles inherit RTL
  out = out.replace(
    /(<w:style\b[^>]*w:styleId="Normal"[^>]*>)([\s\S]*?)(<\/w:style>)/,
    (_m, openTag, body, closeTag) => {
      if (/<w:pPr>/.test(body)) {
        const updatedBody = body.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (pFull: string, pInner: string) => {
          if (/<w:bidi(?:\s|\/|>)/.test(pInner)) return pFull;
          return `<w:pPr><w:bidi/>${pInner}</w:pPr>`;
        });
        return `${openTag}${updatedBody}${closeTag}`;
      }
      return `${openTag}${body}<w:pPr><w:bidi/><w:jc w:val="start"/></w:pPr>${closeTag}`;
    }
  );

  return out;
}

function patchSettingsXmlForPersianRtl(settingsXml: string): string {
  let out = settingsXml;

  // Ensure <w:updateFields w:val="true"/> (Microsoft Word auto-updates TOC & StyleRef on open)
  if (/<w:updateFields\b[^>]*\/>/.test(out)) {
    out = out.replace(/<w:updateFields\b[^>]*\/>/, '<w:updateFields w:val="true"/>');
  } else if (!out.includes('<w:updateFields')) {
    out = out.replace('</w:settings>', '<w:updateFields w:val="true"/></w:settings>');
  }

  // Ensure <w:themeFontLang w:val="en-US" w:bidi="fa-IR"/> so Word activates Persian Complex-Script shaping & RTL TOC layout
  if (/<w:themeFontLang\b[^>]*\/>/.test(out)) {
    out = out.replace(
      /<w:themeFontLang\b[^>]*\/>/,
      '<w:themeFontLang w:val="en-US" w:bidi="fa-IR"/>'
    );
  } else {
    out = out.replace(
      '</w:settings>',
      '<w:themeFontLang w:val="en-US" w:bidi="fa-IR"/></w:settings>'
    );
  }

  return out;
}

/**
 * Deterministic OOXML Post-Processor that guarantees 100% Persian RTL compliance across
 * the entire packed `.docx` archive:
 * - Section-level `<w:sectPr><w:bidi/></w:sectPr>`
 * - 100% RTL Table of Contents (`<w:sdtContent>` pre-rendered RTL rows + dot-leader tab stops + `TOC \o "1-3" \h \z \u`)
 * - Global RTL & `fa-IR` defaults in `styles.xml` and `settings.xml`
 * - `<w:bidiVisual/>` on every table and `<w:bidi/>` + dynamic `STYLEREF` in headers/footers
 */
export async function enforceRtlOoxmlIntegrity(
  rawDocxBytes: Uint8Array,
  book: ParsedBook,
  config: DocxExportConfig
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(rawDocxBytes);

  // 1. Patch word/document.xml
  const docFile = zip.file('word/document.xml');
  if (docFile) {
    let docXml = await docFile.async('string');

    // Upgrade bare TableOfContents <w:sdt> into full RTL pre-populated + auto-updating TOC
    if (config.includeAutoToc) {
      const rtlTocXml = buildRtlTocSdtXml(book, config);
      docXml = docXml.replace(
        /<w:sdt>[\s\S]*?<w:docPartGallery w:val="Table of Contents"\/>[\s\S]*?<\/w:sdt>/,
        () => rtlTocXml
      );
    }

    docXml = injectBidiIntoSectPr(docXml);
    docXml = ensureBidiVisualOnTables(docXml);
    docXml = ensureLtrTechnicalRunsInDocumentXml(docXml);
    zip.file('word/document.xml', docXml);
  }

  // 2. Patch word/styles.xml
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const stylesXml = await stylesFile.async('string');
    zip.file('word/styles.xml', patchStylesXmlForRtl(stylesXml, config));
  }

  // 3. Patch word/settings.xml
  const settingsFile = zip.file('word/settings.xml');
  if (settingsFile) {
    const settingsXml = await settingsFile.async('string');
    zip.file('word/settings.xml', patchSettingsXmlForPersianRtl(settingsXml));
  }

  // 4. Patch all word/header*.xml and word/footer*.xml
  const fallbackChapterTitle = book.chapters[0]?.title || book.title;
  const headerFooterFiles = Object.keys(zip.files).filter((name) =>
    /^word\/(?:header|footer)\d*\.xml$/i.test(name)
  );
  for (const name of headerFooterFiles) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = await f.async('string');
    zip.file(name, ensureHeaderFooterBidi(xml, config.fontFamily, fallbackChapterTitle));
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
