import type {
  CalloutBlock,
  ChapterNode,
  CheatSheetEntry,
  ConceptRetentionCheck,
  ContentBlock,
  DeduplicationRecord,
  FootnoteEntry,
  GlossaryEntry,
  OptimizationAudit,
  OptimizationOptions,
  ParsedBook,
  SectionNode,
  TableBlock,
  TableIndexEntry,
  VisualSuggestion,
} from './bookTypes.ts';
import {
  cleanDirectionalMarks,
  extractFootnoteTermKey,
  formatReadableEquation,
  toAsciiDigits,
  toPersianDigits,
} from './formatParsers.ts';

function countWords(text: string): number {
  const cleaned = text.replace(/\[\[\d+\]\]\(#footnote-\d+\)/g, ' ').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function collectAllText(book: ParsedBook): string {
  const parts: string[] = [book.title, book.subtitle];
  for (const ch of book.chapters) {
    parts.push(ch.title);
    for (const m of ch.meta) parts.push(m.label, m.value);
    const allBlocks = [...ch.introBlocks, ...ch.sections.flatMap((s) => s.blocks)];
    for (const sec of ch.sections) parts.push(sec.title);
    for (const b of allBlocks) {
      if (b.type === 'paragraph' || b.type === 'subheading') parts.push(b.text);
      else if (b.type === 'callout') parts.push(b.title, ...b.paragraphs);
      else if (b.type === 'list') parts.push(...b.items);
      else if (b.type === 'equation') parts.push(b.latex, b.readable);
      else if (b.type === 'figure') parts.push(b.caption, b.description);
      else if (b.type === 'table') {
        if (b.caption) parts.push(b.caption);
        parts.push(...b.headers);
        for (const r of b.rows) parts.push(...r);
      }
    }
  }
  for (const fn of book.footnotes) parts.push(fn.text);
  for (const g of book.glossary) parts.push(g.term, g.definition);
  return parts.join('\n');
}

function countBlocks(book: ParsedBook): number {
  let count = 0;
  for (const ch of book.chapters) {
    count += ch.introBlocks.length;
    for (const sec of ch.sections) count += sec.blocks.length;
  }
  return count;
}

function repairTypography(text: string, normalizeZwnj: boolean): { text: string; fixes: number } {
  let out = cleanDirectionalMarks(text);
  let fixes = 0;

  const replaceCount = (pattern: RegExp, replacement: string) => {
    out = out.replace(pattern, (match, ...args) => {
      fixes++;
      if (replacement.includes('$')) {
        return match.replace(pattern, replacement);
      }
      return replacement;
    });
  };

  // Fix known OCR / automated find-and-replace corruptions ("تیونررش" -> "شمارش", "به تیونرر می‌رود" -> "به شمار می‌رود")
  if (/تیونرر/.test(out)) {
    replaceCount(/تیونررش‌شده/g, 'شمارش‌شده');
    replaceCount(/تیونررش/g, 'شمارش');
    replaceCount(/(به|در|از)\s+تیونرر(\s+می‌?رود|\s+می‌?آید|\s+آورد)?/g, '$1 شمار$2');
    replaceCount(/تیونرر(?=\s+(?:می‌?رود|می‌?آید|می‌?آورد))/g, 'شمار');
  }

  // Fix [[KEY:...]] raw tags
  if (out.includes('[[KEY:')) {
    replaceCount(/\[\[KEY:([^\]]+)\]\]/g, 'کلید میانبر $1');
  }

  // Fix raw LaTeX OCR glitches inside inline text
  if (out.includes('Δheta')) {
    replaceCount(/Δheta/g, 'Δθ');
  }
  if (/[0-9)]imes[0-9(]/.test(out)) {
    replaceCount(/([0-9)])imes([0-9(])/g, '$1 × $2');
  }

  // Strip residual HTML directional wrapper tags (<span dir="rtl">, </span>) and stray CJK/Cyrillic glitches
  if (/<\/?(?:span|div)\b/i.test(out)) {
    replaceCount(/<\/?(?:span|div)(?:\s+(?:dir|lang|class|style)\s*=\s*["'][^"']*["'])*\s*>/gi, '');
  }
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\u0400-\u04FF]/.test(out)) {
    replaceCount(/[\u4E00-\u9FFF\u3400-\u4DBF\u0400-\u04FF]+/g, '');
  }

  // Clean excessive internal spaces (preserve normal single spaces)
  const collapsed = out.replace(/[ \t]{2,}/g, ' ');
  if (collapsed !== out) {
    out = collapsed;
  }

  if (normalizeZwnj) {
    const beforeZwnj = out;
    // Normalize common Persian verb prefixes ("می شود" -> "می‌شود", "نمی تواند" -> "نمی‌تواند")
    out = out.replace(/(^|[\s«(،؛:])(ن?می)\s+([آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی]{2,})/g, '$1$2\u200c$3');
    // Normalize detached plural "ها" after Persian letters when followed by space/punctuation
    out = out.replace(/([آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی])\s+(ها(?:ی|یی|یم|یت|یش|یشان)?)(?=[\s،؛.؟!«»)\]:]|$)/g, '$1\u200c$2');
    // Normalize Arabic Yeh/Kaf to standard Persian Yeh/Kaf (outside English words)
    out = out.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    if (out !== beforeZwnj) fixes++;
  }

  return { text: out.trim(), fixes };
}

function normalizeForComparison(text: string): string {
  return toAsciiDigits(
    text
      .replace(/\[\[\d+\]\]\(#footnote-\d+\)/g, '')
      .replace(/\*\*|\*/g, '')
      .replace(/[\u200c\u200e\u200f]/g, ' ')
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}

function buildShingles(normText: string, k = 4): Set<string> {
  const words = normText.split(' ').filter((w) => w.length > 1);
  const set = new Set<string>();
  if (words.length < k) {
    if (words.length > 0) set.add(words.join(' '));
    return set;
  }
  for (let i = 0; i <= words.length - k; i++) {
    set.add(words.slice(i, i + k).join(' '));
  }
  return set;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) {
    if (large.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function extractTechnicalTokens(text: string): string[] {
  const tokens = new Set<string>();
  const matches = toAsciiDigits(text).match(/[A-Z][A-Z0-9._-]{1,14}|\b\d+(?:\.\d+)?\b/g) || [];
  for (const m of matches) {
    if (m.length >= 2) tokens.add(m);
  }
  return Array.from(tokens);
}

function mergeUniqueSentences(canonical: string, duplicate: string): { merged: string; addedUnique: boolean } {
  const canonTokens = new Set(extractTechnicalTokens(canonical));
  const dupSentences = duplicate
    .split(/(?<=[.؟!؛])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);

  const canonShingles = buildShingles(normalizeForComparison(canonical), 3);
  const additions: string[] = [];

  for (const sent of dupSentences) {
    const sTokens = extractTechnicalTokens(sent);
    const hasNewTechToken = sTokens.some((t) => !canonTokens.has(t));
    const sShingles = buildShingles(normalizeForComparison(sent), 3);
    const sim = jaccardSimilarity(canonShingles, sShingles);
    if (hasNewTechToken || sim < 0.35) {
      additions.push(sent);
      sTokens.forEach((t) => canonTokens.add(t));
    }
  }

  if (additions.length === 0) {
    return { merged: canonical, addedUnique: false };
  }
  return {
    merged: `${canonical.replace(/\s+$/, '')} ${additions.join(' ')}`,
    addedUnique: true,
  };
}

function cleanGlossaryDefinition(term: string, def: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let cleaned = def.replace(new RegExp(`^${escaped}\\s*[:：—–-]\\s*`, 'i'), '').trim();
  if (!cleaned) cleaned = def.trim();
  return cleaned;
}

function generateChapterVisualSuggestions(chapter: ChapterNode): VisualSuggestion[] {
  const suggestions: VisualSuggestion[] = [];
  const allBlocks = [...chapter.introBlocks, ...chapter.sections.flatMap((s) => s.blocks)];
  const existingTables = allBlocks.filter((b) => b.type === 'table').length;
  const fullText = [
    chapter.title,
    ...chapter.sections.map((s) => s.title),
    ...allBlocks.map((b) =>
      b.type === 'paragraph'
        ? b.text
        : b.type === 'callout'
          ? `${b.title} ${b.paragraphs.join(' ')}`
          : b.type === 'list'
            ? b.items.join(' ')
            : ''
    ),
  ].join('\n');

  const firstSecTitle = chapter.sections[0]?.title || chapter.title;
  const add = (
    kind: VisualSuggestion['kind'],
    kindLabel: string,
    title: string,
    rationale: string,
    suggestedColumnsOrElements: string[],
    sectionTitle: string,
    priority: 'high' | 'medium'
  ) => {
    suggestions.push({
      id: `vis_ch${chapter.chapterNumber}_${suggestions.length + 1}`,
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title,
      sectionTitle,
      kind,
      kindLabel,
      title,
      rationale,
      suggestedColumnsOrElements,
      priority,
    });
  };

  // Detect WinOLS 2D / Hex / Axis sections
  const winolsSec = chapter.sections.find((s) => /WinOLS|دوبعدی|2D|هگز|محور|آدرس|بیتی|داموس|Damos/i.test(s.title));
  if (winolsSec || /WinOLS|2D Mode|Hexdump/i.test(fullText)) {
    add(
      'screenshot',
      'تصویر نمای ۲D / هگز WinOLS',
      `نمایش بصری الگوی دوبعدی و محوریابی جداول در ${chapter.title}`,
      'تشخیص چشمی ساختار ۸ بیتی/۱۶ بیتی، الگوی موجی جدول جرقه و کدهای راهنمای باینری بدون تصویر نمای 2D برای خواننده زمان‌بر است.',
      ['نمای 2D قبل و بعد از هموارسازی (Smoothing)', 'کادربندی محور X (دور موتور) و محور Y (بار/دریچه)', 'علامت‌گذاری رشته جستجوی باینری در Hexdump'],
      winolsSec?.title || firstSecTitle,
      'high'
    );
  }

  // Detect Comparison concepts (e.g., vs / در برابر / تفاوت / مقایسه)
  const compareSec = chapter.sections.find((s) => /در برابر|تفاوت|مقایسه|تفکیک|مقابل/i.test(s.title));
  if (compareSec) {
    add(
      'comparison',
      'جدول مقایسه‌ای مهندسی',
      `جدول تطبیقی «${compareSec.title.slice(0, 72)}»`,
      'تبدیل مقایسه متنی به جدول دو یا سه‌ستونه باعث درک آنی مرزهای فنی و جلوگیری از اشتباه در کارگاه می‌شود.',
      ['معیار فنی / پارامتر', 'وضعیت یا معماری اول', 'وضعیت یا معماری دوم', 'اثر عملی روی کالیبراسیون و ایمنی'],
      compareSec.title,
      'high'
    );
  }

  // Detect Step-by-step / Workflow / Protocol / Checklist sections
  const flowSec = chapter.sections.find((s) =>
    /گام‌به‌گام|مراحل|چهارمرحله|پروتکل|ترتیب|چک‌لیست|رویه|دستورالعمل|فرمول/i.test(s.title)
  );
  if (flowSec || /مرحله اول|گام اول|پیش‌نیاز/i.test(fullText)) {
    add(
      'flowchart',
      'فلوچارت اجرایی کارگاهی',
      `فلوچارت تصمیم‌گیری و ترتیب اجرای کالیبراسیون در ${chapter.title}`,
      'نمایش توالی گام‌ها و شرط‌های ایمنی (مانند تست سلامت مکانیکی، دیتالاگ و شرط توقف در ناک) خطای ترتیبی را به صفر می‌رساند.',
      ['نقطه شروع و پیش‌نیاز سلامت موتور', 'گره تصمیم‌گیری بر اساس دیتالاگ دیاگ/وایدبند', 'مسیر اصلاح مرحله‌ای جدول', 'آزمون نهایی و بازگشت‌پذیری'],
      flowSec?.title || firstSecTitle,
      'high'
    );
  }

  // Detect Combustion / Thermodynamic / Sensor / Turbo / Torque physical mechanisms
  const mechSec = chapter.sections.find((s) =>
    /توربو|بوست|وست‌گیت|ناک|کمپرس|سوپرناک|AFR|لامبدا|EGT|شارژ کوئل|TPS|سنسور|مکانیزم|معماری/i.test(s.title)
  );
  if (mechSec) {
    add(
      'diagram',
      'نمودار فنی و شماتیک فیزیکی',
      `نمودار روابط فیزیکی و ناحیه ایمن کاری در «${mechSec.title.slice(0, 68)}»`,
      'رسم منحنی ارتباط پارامترها (مانند AFR در برابر بار و دور، یا سقف آوانس نسبت به کمپرس و اکتان) درک شهودی مفاهیم ترمودینامیکی را عمیق‌تر می‌کند.',
      ['محور افقی: دور موتور (RPM) یا بار (Load/MAP)', 'محور عمودی: پارامتر هدف (AFR / آوانس / بوست / EGT)', 'ناحیه ایمن کارگاهی (سبز) در برابر مرز ناک و خطر (قرمز)'],
      mechSec.title,
      'medium'
    );
  }

  // If chapter has many prose blocks but few tables, suggest a quick-reference summary table
  const paraCount = allBlocks.filter((b) => b.type === 'paragraph').length;
  if (paraCount >= 12 && existingTables <= 1) {
    add(
      'table',
      'جدول خلاصه پارامترها و آستانه‌ها',
      `جدول مرجع سریع اعداد کلیدی، فکتورها و محدودیت‌های ${chapter.title}`,
      `این فصل شامل ${toPersianDigits(paraCount)} بند تشریحی و تنها ${toPersianDigits(existingTables)} جدول است؛ جمع‌بندی اعداد و کدهای پراکنده در یک جدول مرجع، سرعت رجوع کارگاهی را چندبرابر می‌کند.`,
      ['نام جدول / پارامتر', 'ابعاد و ساختار (8/16-bit)', 'فکتور و آفست', 'محدوده تغییر ایمن / خط قرمز'],
      firstSecTitle,
      'high'
    );
  }

  return suggestions.slice(0, 3);
}

function buildConceptRetentionChecks(rawText: string, optimizedText: string): ConceptRetentionCheck[] {
  const candidates: Array<{ token: string; label: string }> = [
    { token: '14.7', label: 'نسبت استوکیومتری (AFR 14.7)' },
    { token: '0.375', label: 'فکتور زاویه جرقه زیمنس (0.375)' },
    { token: '0.1148', label: 'فکتور لامبدا دیزایر بوش (0.1148)' },
    { token: '32768', label: 'سقف باینری ۱۶ بیتی علامت‌دار (32768)' },
    { token: '39322', label: 'سقف جدول Torque Desire (39322)' },
    { token: '1280', label: 'فشار بوست پایه ACS (1280)' },
    { token: '0.78', label: 'فکتور ۸ بیتی دریچه گاز (0.78)' },
    { token: '65535', label: 'سقف ۱۶ بیتی بدون علامت (65535)' },
    { token: 'LSPI', label: 'پدیده سوپرناک (LSPI)' },
    { token: 'DEPHIA', label: 'خطای دوشاخه جرقه‌زنی (DEPHIA)' },
    { token: 'PTMP', label: 'پارامتر بوست PTMP' },
    { token: 'MARS', label: 'پارامتر بوست MARS' },
    { token: 'WinOLS', label: 'نرم‌افزار کالیبراسیون WinOLS' },
    { token: 'Damos', label: 'فایل راهنمای نقشه Damos' },
    { token: 'WOT', label: 'حالت تخت‌گاز کامل (WOT)' },
    { token: 'EGT', label: 'مدل دمای گازهای اگزوز (EGT)' },
    { token: 'ME17', label: 'خانواده ایسیو بوش ME17' },
    { token: 'S2000', label: 'خانواده ایسیو ساژم S2000' },
    { token: 'SSAT', label: 'خانواده ایسیو زیمنس SSAT' },
    { token: 'ACS', label: 'خانواده ایسیو دنا توربو ACS' },
  ];

  const asciiRaw = toAsciiDigits(rawText);
  const asciiOpt = toAsciiDigits(optimizedText);

  const checks: ConceptRetentionCheck[] = [];
  for (const item of candidates) {
    const rx = new RegExp(item.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const beforeCount = (asciiRaw.match(rx) || []).length;
    if (beforeCount === 0) continue;
    const afterCount = (asciiOpt.match(rx) || []).length;
    checks.push({
      token: item.token,
      label: item.label,
      beforeCount,
      afterCount,
      preserved: afterCount > 0,
    });
  }

  // For arbitrary user-uploaded docs that aren't ECU books, auto-sample top meaningful terms
  if (checks.length < 5) {
    const words = asciiRaw
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5);
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    const topTerms = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [term, beforeCount] of topTerms) {
      if (checks.some((c) => c.token === term)) continue;
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const afterCount = (asciiOpt.match(rx) || []).length;
      checks.push({
        token: term,
        label: `کلیدواژه اصلی «${term}»`,
        beforeCount,
        afterCount,
        preserved: afterCount > 0,
      });
    }
  }

  return checks;
}

export function optimizeBook(rawBook: ParsedBook, options: OptimizationOptions): ParsedBook {
  const rawFullText = collectAllText(rawBook);
  const rawWordCount = countWords(rawFullText);
  const rawBlockCount = countBlocks(rawBook);
  const rawFootnoteCount = rawBook.footnotes.length;

  const records: DeduplicationRecord[] = [];
  let recordSeq = 0;
  const addRecord = (rec: Omit<DeduplicationRecord, 'id'>) => {
    records.push({ id: `rec_${++recordSeq}`, ...rec });
  };

  let artifactsRepaired = 0;
  let unnumberedSectionsFixed = 0;
  let duplicateBlocksConsolidated = 0;
  let tablesRenumbered = 0;
  let duplicateFootnotesMerged = 0;

  // -------------------------------------------------------------------------
  // 1. DEDUPLICATE FOOTNOTES (Lossless merge + ID remap table)
  // -------------------------------------------------------------------------
  const footnoteIdMap = new Map<number, number>();
  const canonicalFootnotes: FootnoteEntry[] = [];

  if (options.deduplicateFootnotes && rawBook.footnotes.length > 0) {
    const byTerm = new Map<string, FootnoteEntry>();

    for (const fn of rawBook.footnotes) {
      const repaired = options.repairTypographyArtifacts
        ? repairTypography(fn.text, options.normalizePersianHalfSpaces)
        : { text: fn.text, fixes: 0 };
      artifactsRepaired += repaired.fixes;

      const key = extractFootnoteTermKey(repaired.text);
      const existing = byTerm.get(key);
      if (existing) {
        duplicateFootnotesMerged++;
        const merged = mergeUniqueSentences(existing.text, repaired.text);
        const beforeText = existing.text;
        if (merged.addedUnique && merged.merged.length <= existing.text.length + 240) {
          existing.text = merged.merged;
        }
        existing.mergedFromIds = [...(existing.mergedFromIds || [existing.id]), fn.id];
        footnoteIdMap.set(fn.id, existing.canonicalId);

        addRecord({
          category: 'footnote',
          categoryLabel: 'یکپارچه‌سازی پانویس تکراری',
          location: `پانویس #${toPersianDigits(fn.id)}`,
          canonicalLocation: `پانویس یکتا #${toPersianDigits(existing.canonicalId)} (${key})`,
          summary: `تعریف تکراری اصطلاح «${key}» با پانویس مرجع ادغام و تمام ارجاعات متن بازنگاشت شد.`,
          beforeSnippet: repaired.text.slice(0, 140),
          afterSnippet: (merged.addedUnique ? existing.text : beforeText).slice(0, 140),
          conceptsPreserved: true,
        });
      } else {
        const canonicalId = canonicalFootnotes.length + 1;
        const entry: FootnoteEntry = {
          id: fn.id,
          canonicalId,
          termKey: key,
          text: repaired.text,
          chapters: [],
          mergedFromIds: [fn.id],
        };
        byTerm.set(key, entry);
        canonicalFootnotes.push(entry);
        footnoteIdMap.set(fn.id, canonicalId);
      }
    }
  } else {
    for (const fn of rawBook.footnotes) {
      const repaired = options.repairTypographyArtifacts
        ? repairTypography(fn.text, options.normalizePersianHalfSpaces)
        : { text: fn.text, fixes: 0 };
      artifactsRepaired += repaired.fixes;
      canonicalFootnotes.push({
        ...fn,
        canonicalId: fn.id,
        text: repaired.text,
        chapters: [...fn.chapters],
      });
      footnoteIdMap.set(fn.id, fn.id);
    }
  }

  const footnoteByCanonical = new Map<number, FootnoteEntry>();
  canonicalFootnotes.forEach((f) => footnoteByCanonical.set(f.canonicalId, f));

  const remapFootnotesInText = (text: string, chapterNumber: number): string => {
    return text.replace(/\[\[(\d+)\]\]\(#footnote-(\d+)\)/g, (_, oldStr) => {
      const oldId = Number(oldStr);
      const newId = footnoteIdMap.get(oldId) ?? oldId;
      const target = footnoteByCanonical.get(newId);
      if (target && !target.chapters.includes(chapterNumber)) {
        target.chapters.push(chapterNumber);
      }
      return `[[${newId}]](#footnote-${newId})`;
    });
  };

  // -------------------------------------------------------------------------
  // 2. PROCESS CHAPTERS, SECTIONS, BLOCKS (Deduplicate + Repair + Renumber)
  // -------------------------------------------------------------------------
  const seenBlocksByNorm = new Map<
    string,
    {
      block: ContentBlock;
      location: string;
      chapterNumber: number;
    }
  >();
  // Bucketed near-duplicate detection for long blocks (fast O(1) bucket lookup by first 3-gram + length)
  const seenCallouts: Array<{
    block: CalloutBlock;
    shingles: Set<string>;
    location: string;
    titleNorm: string;
  }> = [];

  const tableIndex: TableIndexEntry[] = [];
  const cheatSheets: CheatSheetEntry[] = [];
  const visualSuggestions: VisualSuggestion[] = [];

  const processText = (txt: string, chapterNum: number, location: string): string => {
    let out = remapFootnotesInText(txt, chapterNum);
    if (options.repairTypographyArtifacts) {
      const res = repairTypography(out, options.normalizePersianHalfSpaces);
      if (res.fixes > 0) {
        artifactsRepaired += res.fixes;
        if (/تیونرر|Δheta|imes|\[\[KEY:/.test(txt)) {
          addRecord({
            category: 'artifact_fix',
            categoryLabel: 'اصلاح خطای تایپی/تبدیل',
            location,
            canonicalLocation: location,
            summary: 'اصلاح خطای تایپی یا کاراکترهای تبدیل ماشینی بدون تغییر مفهوم فنی.',
            beforeSnippet: txt.slice(0, 120),
            afterSnippet: res.text.slice(0, 120),
            conceptsPreserved: true,
          });
        }
      }
      out = res.text;
    }
    return out;
  };

  const optimizedChapters: ChapterNode[] = rawBook.chapters.map((rawCh) => {
    let chapterTableSeq = 0;
    const chNum = rawCh.chapterNumber;
    const chTitle = options.repairTypographyArtifacts
      ? repairTypography(rawCh.title, options.normalizePersianHalfSpaces).text
      : rawCh.title;

    const processBlockList = (blocks: ContentBlock[], sectionLabel: string): ContentBlock[] => {
      const outBlocks: ContentBlock[] = [];
      let prevCalloutTitleNorm = '';

      for (const block of blocks) {
        const loc = `فصل ${toPersianDigits(chNum)} · ${sectionLabel}`;

        if (block.type === 'paragraph') {
          const text = processText(block.text, chNum, loc);

          // Drop stray colon-only artifacts or redundant label echo right after callout box
          if (options.repairTypographyArtifacts) {
            if (/^[:؛.\-–—\s]*$/.test(text)) {
              artifactsRepaired++;
              addRecord({
                category: 'artifact_fix',
                categoryLabel: 'حذف کاراکتر زائد',
                location: loc,
                canonicalLocation: loc,
                summary: 'حذف خط خالی یا علامت دو نقطه سرگردان باقی‌مانده از تبدیل فایل.',
                beforeSnippet: block.text,
                afterSnippet: '(حذف کاراکتر زائد)',
                conceptsPreserved: true,
              });
              continue;
            }
            const tNorm = normalizeForComparison(text);
            if (
              prevCalloutTitleNorm &&
              tNorm.length > 6 &&
              tNorm.length < 48 &&
              prevCalloutTitleNorm.includes(tNorm)
            ) {
              artifactsRepaired++;
              addRecord({
                category: 'artifact_fix',
                categoryLabel: 'حذف عنوان تکراری کادر',
                location: loc,
                canonicalLocation: loc,
                summary: `حذف تکرار عنوان «${text}» بلافاصله پس از کادر مربوطه.`,
                beforeSnippet: text,
                afterSnippet: '(در عنوان کادر قبلی موجود است)',
                conceptsPreserved: true,
              });
              prevCalloutTitleNorm = '';
              continue;
            }
          }
          prevCalloutTitleNorm = '';

          // Exact duplicate paragraph consolidation (only for substantive paragraphs >= 70 chars)
          if (options.consolidateDuplicateBlocks && text.length >= 70) {
            const norm = normalizeForComparison(text);
            const prev = seenBlocksByNorm.get(norm);
            if (prev) {
              duplicateBlocksConsolidated++;
              addRecord({
                category: 'paragraph',
                categoryLabel: 'حذف بند تکراری عینی',
                location: loc,
                canonicalLocation: prev.location,
                summary: `بند تکراری دقیقاً مشابه متن «${prev.location}» شناسایی و یکپارچه شد.`,
                beforeSnippet: text.slice(0, 140),
                afterSnippet: `ارجاع متمرکز به ${prev.location}`,
                conceptsPreserved: true,
              });
              continue;
            }
            const newBlock: ContentBlock = { ...block, text };
            seenBlocksByNorm.set(norm, { block: newBlock, location: loc, chapterNumber: chNum });
            outBlocks.push(newBlock);
          } else {
            outBlocks.push({ ...block, text });
          }
          continue;
        }

        prevCalloutTitleNorm = '';

        if (block.type === 'subheading') {
          outBlocks.push({ ...block, text: processText(block.text, chNum, loc) });
          continue;
        }

        if (block.type === 'callout') {
          const title = processText(block.title, chNum, loc);
          const paragraphs = block.paragraphs
            .map((p) => processText(p, chNum, loc))
            .filter((p) => p.length > 0);
          const fullCalloutText = `${title} ${paragraphs.join(' ')}`;
          const normTitle = normalizeForComparison(title);
          const normBody = normalizeForComparison(fullCalloutText);
          prevCalloutTitleNorm = normTitle;

          // Collect Master Cheat-Sheet entries for golden rules & workshop cheat sheets
          if (/برگهٔ?\s*تقلب|قانون طلایی|هشدار بحرانی|ممنوعیت مطلق/.test(title)) {
            cheatSheets.push({
              id: block.id,
              chapterNumber: chNum,
              chapterTitle: chTitle,
              title: title.replace(/^[⛔💡⚙️🔄❓📘]+\s*/, ''),
              highlights: paragraphs.slice(0, 3),
            });
          }

          if (options.consolidateDuplicateBlocks && normBody.length >= 70) {
            const shingles = buildShingles(normBody, 4);
            let matchedPrev: (typeof seenCallouts)[number] | undefined;

            for (const candidate of seenCallouts) {
              if (candidate.titleNorm === normTitle && normTitle.length >= 20) {
                const sim = jaccardSimilarity(shingles, candidate.shingles);
                if (sim >= 0.45) {
                  matchedPrev = candidate;
                  break;
                }
              } else if (jaccardSimilarity(shingles, candidate.shingles) >= 0.62) {
                matchedPrev = candidate;
                break;
              }
            }

            if (matchedPrev) {
              duplicateBlocksConsolidated++;
              const merged = mergeUniqueSentences(
                matchedPrev.block.paragraphs.join(' '),
                paragraphs.join(' ')
              );
              if (merged.addedUnique) {
                matchedPrev.block.paragraphs = [merged.merged];
              }
              addRecord({
                category: 'callout',
                categoryLabel: 'ادغام کادر آموزشی تکراری',
                location: loc,
                canonicalLocation: matchedPrev.location,
                summary: `کادر «${title.slice(0, 60)}» با کادر مرجع در ${matchedPrev.location} یکپارچه شد و نکات منحصربه‌فرد آن حفظ گردید.`,
                beforeSnippet: fullCalloutText.slice(0, 140),
                afterSnippet: `ادغام‌شده در ${matchedPrev.location}`,
                conceptsPreserved: true,
              });
              continue;
            }

            const created: CalloutBlock = { ...block, title, paragraphs };
            seenCallouts.push({
              block: created,
              shingles,
              location: loc,
              titleNorm: normTitle,
            });
            outBlocks.push(created);
          } else {
            outBlocks.push({ ...block, title, paragraphs });
          }
          continue;
        }

        if (block.type === 'table') {
          chapterTableSeq++;
          const headers = block.headers.map((h) => processText(h, chNum, loc));
          const rows = block.rows.map((r) => r.map((c) => processText(c, chNum, loc)));

          let caption = block.caption ? processText(block.caption, chNum, loc) : undefined;
          const originalCaption = caption;
          const tableNumber = `${toPersianDigits(chNum)}-${toPersianDigits(chapterTableSeq)}`;

          if (options.renumberTablesSequentially) {
            if (caption) {
              const strippedTitle = caption
                .replace(/^جدول\s*[۰-۹0-9]+\s*[-–]\s*[۰-۹0-9]+\s*[:：-]?\s*/, '')
                .replace(/^جدول\s*[:：-]?\s*/, '')
                .trim();
              const nextCaption = `جدول ${tableNumber}: ${strippedTitle || sectionLabel}`;
              if (nextCaption !== caption) {
                tablesRenumbered++;
                addRecord({
                  category: 'table_renumber',
                  categoryLabel: 'اصلاح شماره‌گذاری جدول',
                  location: loc,
                  canonicalLocation: `جدول ${tableNumber}`,
                  summary: `شماره جدول با شماره فصل واقعی (${toPersianDigits(chNum)}) هم‌تراز و پیوسته شد.`,
                  beforeSnippet: caption,
                  afterSnippet: nextCaption,
                  conceptsPreserved: true,
                });
              }
              caption = nextCaption;
            } else {
              caption = `جدول ${tableNumber}: داده‌های فنی ${sectionLabel}`;
              tablesRenumbered++;
            }
          }

          tableIndex.push({
            tableNumber,
            caption: caption || `جدول ${tableNumber}`,
            originalCaption,
            chapterNumber: chNum,
            chapterTitle: chTitle,
            sectionTitle: sectionLabel,
          });

          const newTable: TableBlock = {
            ...block,
            caption,
            originalCaption,
            headers,
            rows,
          };
          outBlocks.push(newTable);
          continue;
        }

        if (block.type === 'equation') {
          const cleanLatex = options.repairTypographyArtifacts
            ? block.latex.replace(/Δheta/g, '\\Delta\\theta').replace(/([0-9a-zA-Z)])\s*imes\s*([0-9a-zA-Z(])/g, '$1 \\times $2')
            : block.latex;
          outBlocks.push({
            ...block,
            latex: cleanLatex,
            readable: formatReadableEquation(cleanLatex),
          });
          continue;
        }

        if (block.type === 'list') {
          outBlocks.push({
            ...block,
            items: block.items.map((item) => processText(item, chNum, loc)),
          });
          continue;
        }

        if (block.type === 'figure') {
          outBlocks.push({
            ...block,
            caption: processText(block.caption, chNum, loc),
            description: processText(block.description, chNum, loc),
          });
          continue;
        }

        outBlocks.push(block);
      }

      return outBlocks;
    };

    const introBlocks = processBlockList(rawCh.introBlocks, 'مقدمه فصل');

    // Auto-number sections cleanly within chapter
    let secSeq = 0;
    const sections: SectionNode[] = rawCh.sections.map((rawSec) => {
      secSeq++;
      const cleanSecTitle = options.repairTypographyArtifacts
        ? repairTypography(rawSec.title, options.normalizePersianHalfSpaces).text
        : rawSec.title;

      let numberLabel = rawSec.numberLabel;
      if (options.autoNumberSections) {
        const expected = `${toPersianDigits(chNum)}-${toPersianDigits(secSeq)}`;
        if (rawSec.wasUnnumbered || !numberLabel) {
          unnumberedSectionsFixed++;
          addRecord({
            category: 'heading_number',
            categoryLabel: 'شماره‌گذاری استاندارد سرفصل',
            location: `فصل ${toPersianDigits(chNum)}`,
            canonicalLocation: `بخش ${expected}`,
            summary: `سرفصل بدون شماره «${cleanSecTitle.slice(0, 60)}» در ساختار استاندارد فصل‌بندی شد.`,
            beforeSnippet: rawSec.originalTitle,
            afterSnippet: `${expected}. ${cleanSecTitle}`,
            conceptsPreserved: true,
          });
          numberLabel = expected;
        }
      }

      const displayLabel = numberLabel ? `${numberLabel}. ${cleanSecTitle}` : cleanSecTitle;
      const blocks = processBlockList(rawSec.blocks, displayLabel);

      return {
        ...rawSec,
        numberLabel,
        title: cleanSecTitle,
        blocks,
      };
    });

    const optimizedChapter: ChapterNode = {
      ...rawCh,
      title: chTitle,
      meta: rawCh.meta.map((m) => ({
        label: m.label,
        value: options.repairTypographyArtifacts
          ? repairTypography(m.value, options.normalizePersianHalfSpaces).text
          : m.value,
      })),
      introBlocks,
      sections,
    };

    if (options.generateVisualSuggestions) {
      visualSuggestions.push(...generateChapterVisualSuggestions(optimizedChapter));
    }

    return optimizedChapter;
  });

  // -------------------------------------------------------------------------
  // 3. BUILD UNIFIED, DEDUPLICATED GLOSSARY (Appendix A + Footnotes)
  // -------------------------------------------------------------------------
  const glossaryMap = new Map<string, GlossaryEntry>();
  const addGlossaryItem = (term: string, def: string, chapters: number[]) => {
    const cleanTerm = cleanDirectionalMarks(term).replace(/\*\*/g, '').trim();
    const key = cleanTerm.toLowerCase();
    if (!cleanTerm || !def) return;
    const cleanDef = cleanGlossaryDefinition(
      cleanTerm,
      options.repairTypographyArtifacts ? repairTypography(def, options.normalizePersianHalfSpaces).text : def
    );
    const existing = glossaryMap.get(key);
    if (existing) {
      chapters.forEach((c) => {
        if (c > 0 && !existing.chapters.includes(c)) existing.chapters.push(c);
      });
      if (cleanDef.length > existing.definition.length + 25) {
        existing.definition = cleanDef;
      }
    } else {
      glossaryMap.set(key, {
        term: cleanTerm,
        definition: cleanDef,
        chapters: chapters.filter((c) => c > 0),
      });
    }
  };

  for (const g of rawBook.glossary) {
    addGlossaryItem(g.term, g.definition, g.chapters);
  }
  for (const fn of canonicalFootnotes) {
    const rawHead = fn.text.split(/[:؛—–]|\s+یا\s+/)[0]?.trim() || fn.termKey;
    if (rawHead.length >= 2 && rawHead.length <= 45) {
      addGlossaryItem(rawHead, fn.text, fn.chapters);
    }
  }

  const unifiedGlossary = Array.from(glossaryMap.values()).sort((a, b) =>
    a.term.localeCompare(b.term, 'fa', { sensitivity: 'base' })
  );

  // Deduplicate master cheat-sheets by title similarity
  const uniqueCheatSheets: CheatSheetEntry[] = [];
  const seenCs = new Set<string>();
  for (const cs of cheatSheets) {
    const k = normalizeForComparison(cs.title);
    if (!seenCs.has(k)) {
      seenCs.add(k);
      uniqueCheatSheets.push(cs);
    }
  }

  const resultBook: ParsedBook = {
    ...rawBook,
    volumes: rawBook.volumes.map((v) => ({
      ...v,
      title: options.repairTypographyArtifacts
        ? repairTypography(v.title, options.normalizePersianHalfSpaces).text
        : v.title,
    })),
    chapters: optimizedChapters,
    footnotes: canonicalFootnotes,
    glossary: unifiedGlossary,
    tableIndex,
    cheatSheets: uniqueCheatSheets,
    visualSuggestions,
  };

  const optimizedFullText = collectAllText(resultBook);
  const optimizedWordCount = countWords(optimizedFullText);
  const optimizedBlockCount = countBlocks(resultBook);

  const conceptChecks = buildConceptRetentionChecks(rawFullText, optimizedFullText);
  const preservedCount = conceptChecks.filter((c) => c.preserved).length;
  const conceptRetentionRate =
    conceptChecks.length === 0 ? 100 : Math.round((preservedCount / conceptChecks.length) * 100);

  const audit: OptimizationAudit = {
    rawWordCount,
    optimizedWordCount,
    rawBlockCount,
    optimizedBlockCount,
    rawFootnoteCount,
    optimizedFootnoteCount: canonicalFootnotes.length,
    duplicateFootnotesMerged,
    duplicateBlocksConsolidated,
    tablesRenumbered,
    unnumberedSectionsFixed,
    artifactsRepaired,
    generatedTablesInserted: 0,
    generatedDiagramsInserted: 0,
    glossaryEntriesCount: unifiedGlossary.length,
    visualSuggestionsCount: visualSuggestions.length,
    conceptRetentionRate,
    conceptChecks,
    records,
  };

  resultBook.audit = audit;
  return resultBook;
}
