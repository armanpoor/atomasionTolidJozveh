export type UniversalRuleCategory =
  | 'pedagogy'
  | 'tone_style'
  | 'hygiene'
  | 'integrity'
  | 'structure';

export interface UniversalSystemRule {
  id: string;
  order: number;
  category: UniversalRuleCategory;
  titleFa: string;
  summaryFa: string;
  directiveFa: string;
}

/**
 * Universal, domain-agnostic system prompt rules automatically enforced across
 * EVERY uploaded file and EVERY AI pipeline stage (analysis, outline polish,
 * harness authoring, surgical patching, deep review, web enrichment, and editor chat).
 */
export const UNIVERSAL_SYSTEM_PROMPT_RULES: readonly UniversalSystemRule[] = [
  {
    id: 'zero_prerequisite_scaffolding',
    order: 1,
    category: 'pedagogy',
    titleFa: 'شروع از صفرِ صفر و پیشروی پلکانی',
    summaryFa:
      'فرض بر این است که خواننده هیچ پیش‌زمینه‌ای ندارد؛ پیش‌نیازها و اصطلاحات از پایه و به‌تدریج تا سطح پیشرفته چیده می‌شوند.',
    directiveFa:
      'هیچ پیش‌دانشی برای خواننده فرض نکن؛ مفاهیم را به‌صورت پلکانی از پیش‌نیازهای پایه به مباحث تخصصی و پیشرفته سازمان‌دهی کن و هر اصطلاح جدید را در نخستین برخورد با تعریف ساده و ملموس معرفی کن.',
  },
  {
    id: 'four_step_pedagogy',
    order: 2,
    category: 'pedagogy',
    titleFa: 'الگوی آموزشی ۴ مرحله‌ای برای مفاهیم و فرمول‌ها',
    summaryFa:
      'تبیین مفاهیم کلیدی و فرمول‌ها با ترتیب: مثال روزمره ← توضیح ساده ← فرمول و مثال عددی مستند ← کاربرد عملی.',
    directiveFa:
      'در توضیح مفاهیم فنی، مکانیزم‌ها و فرمول‌های کلیدی، تا حد امکان الگوی ۴ مرحله‌ای را رعایت کن: (۱) تشبیه یا مثال روزمره ملموس، (۲) توضیح ساده و شهودی بدون پیچیدگی اضافی، (۳) بیان دقیق قاعده یا فرمول همراه با مثال عددی مستند از متن منبع، و (۴) کاربرد عملی در دنیای واقعی.',
  },
  {
    id: 'warm_plain_formal_persian',
    order: 3,
    category: 'tone_style',
    titleFa: 'نثر رسمی اما شیرین، روان و بدون کلمات قلمبه‌سلمبه',
    summaryFa:
      'فارسی کتابی، خوش‌خوان، مؤدبانه و صمیمی با نیم‌فاصله استاندارد و پرهیز کامل از واژگان سنگین و تصنعی.',
    directiveFa:
      'نثر کتاب باید رسمی، مؤدبانه، شیرین، روان و ساده‌خوان باشد؛ از واژگان سنگین، خشک، اداری یا «قلمبه‌سلمبه» پرهیز کن، جملات را شفاف و خوش‌آهنگ بنویس و استانداردهای نگارش فارسی (نیم‌فاصله صحیح، «ی/ک» فارسی و نقطه‌گذاری دقیق) را کاملاً رعایت کن.',
  },
  {
    id: 'scrub_chat_and_noise',
    order: 4,
    category: 'hygiene',
    titleFa: 'پاک‌سازی کامل ردپای چت، تگ‌های مزاحم و نویز ورودی',
    summaryFa:
      'حذف لحن محاوره‌ای چت («شاگرد من»، «بگو درس بعدی»)، تگ‌های HTML جهت‌نما و کاراکترهای بیگانه سرگردان.',
    directiveFa:
      'هرگونه ردپای گفت‌وگوی چت و لحن محاوره‌ای (مانند «سلام شاگرد من»، «بگو درس بعدی»، «حاضری بریم سراغ...؟»، «اگه سؤالی داری بپرس»)، تگ‌های مزاحم HTML/جهت‌نما (مانند <span dir="rtl"> و </span>) و کاراکترها یا واژگان بیگانه سرگردان (تایپوهای ناخواسته غیرمرتبط) را به‌کلی حذف یا به نثر مستقل و تمیز کتاب تبدیل کن.',
  },
  {
    id: 'zero_loss_deduplicated_synthesis',
    order: 5,
    category: 'integrity',
    titleFa: 'یکپارچه‌سازی بدون افت و حذف تکرارهای هم‌پوشان',
    summaryFa:
      'ادغام هوشمند مطالب هم‌پوشان چند فایل بدون تکرار ملال‌آور و با حفظ ۱۰۰٪ نکات یکتا، مثال‌ها و جزئیات.',
    directiveFa:
      'هنگام ترکیب یک یا چند فایل، مطالب تکراری و هم‌پوشان را هوشمندانه در یک جایگاه منسجم ادغام کن تا خواننده یک موضوع را دوبار نخواند، اما ۱۰۰٪ نکات یکتا، فرمول‌ها، اعداد، مثال‌ها، استثناها، جدول‌ها و جزئیات تخصصی همه فایل‌ها را بدون کوچک‌ترین حذف حفظ کن.',
  },
  {
    id: 'hard_fact_and_unit_lock',
    order: 6,
    category: 'integrity',
    titleFa: 'قفل مطلق داده‌های فنی، اعداد و واحدها (عدم توهم)',
    summaryFa:
      'ممنوعیت جعل عدد، تغییر علامت (+/-) یا تبدیل واحد سرخود؛ گزارش شفاف تناقض‌های واقعی بین منابع.',
    directiveFa:
      'هیچ عدد، فرمول، کد، شناسه فنی، آدرس یا ادعای علمی را از خودت اختراع نکن، علامت (+/-) اعداد را تغییر نده و هرگز تبدیل واحد سرخود انجام نده؛ اگر میان دو فایل تناقض واقعی وجود دارد، هر دو روایت را با ذکر منبع شفاف حفظ و گزارش کن.',
  },
  {
    id: 'bilingual_ltr_rtl_hygiene',
    order: 7,
    category: 'hygiene',
    titleFa: 'استانداردسازی دوزبانه (فارسی راست‌چین + اصطلاحات لاتین دقیق)',
    summaryFa:
      'حفظ دقیق املای لاتین اصطلاحات، فرمول‌ها و شناسه‌ها بدون ترجمه ساختگی، همراه با توضیح ساده فارسی.',
    directiveFa:
      'اصطلاحات تخصصی انگلیسی، مخفف‌ها، نام ابزارها، فرمول‌ها و شناسه‌های فنی را دقیقاً با املای اصلی لاتین حفظ کن، از معادل‌سازی‌های عجیب و ساختگی بپرهیز و در نخستین اشاره توضیح کوتاه و ساده فارسی در کنار آن‌ها بیاور.',
  },
  {
    id: 'visual_tabular_callout_structure',
    order: 8,
    category: 'structure',
    titleFa: 'ساختاردهی جدولی، بصری و باکس‌های آموزشی متمایز',
    summaryFa:
      'تبدیل داده‌های مقایسه‌ای به جدول‌های منظم و تفکیک هشدارها، نکات کلیدی، مثال‌ها و جمع‌بندی‌ها در باکس.',
    directiveFa:
      'از تولید دیواره‌های طولانی و خسته‌کننده پاراگراف بپرهیز؛ داده‌های مقایسه‌ای و پارامتری را به جدول‌های منظم با سرستون‌های شفاف تبدیل کن و هشدارهای ایمنی، اشتباهات رایج، نکات طلایی، مثال‌های عددی و جمع‌بندی‌ها را در باکس‌های آموزشی متمایز (Callout) دسته‌بندی کن.',
  },
  {
    id: 'book_cohesion_no_fake_refs',
    order: 9,
    category: 'structure',
    titleFa: 'انسجام کتاب‌محور و ممنوعیت ارجاع عددی جعلی',
    summaryFa:
      'عنوان‌گذاری دقیق، پیوند منطقی بین بخش‌ها و پرهیز از ارجاع ساختگی به جدول یا شکل ناموجود.',
    directiveFa:
      'انسجام کتاب‌محور شامل عنوان‌گذاری شفاف، پیوند منطقی بین فصل‌ها و جمع‌بندی‌های کاربردی را رعایت کن و هرگز ارجاع عددی ساختگی (مانند «جدول ۳-۲» یا «شکل زیر» بدون وجود واقعی آن) تولید نکن.',
  },
] as const;

export type UniversalPromptMode = 'full' | 'compact' | 'analysis' | 'outline' | 'chat' | 'judge';

export interface BuildUniversalPromptOptions {
  mode?: UniversalPromptMode;
  /** When true (strict_zero_touch), explicitly scopes style/pedagogy rules to metadata/callouts/tables only. */
  respectZeroTouch?: boolean;
}

/**
 * Builds a deterministic, byte-stable Persian system prompt block containing the universal
 * book-authoring constitution. Contains ZERO dynamic timestamps or per-section state so
 * Prompt Caching hashes stay 100% locked across runs.
 */
export function buildUniversalSystemPromptBlock(
  options?: BuildUniversalPromptOptions
): string {
  const mode: UniversalPromptMode = options?.mode || 'full';
  const zeroTouchNote = options?.respectZeroTouch
    ? 'توجه مهم (حالت ۰٪ بازنویسی): قواعد لحن، پاک‌سازی و آموزش پلکانی را فقط بر عناوین، خلاصه‌ها، باکس‌های تکمیلی و جدول‌های تولیدی اعمال کن و متن اصلی پاراگراف‌های کاربر را دست‌نخورده نگه دار.'
    : '';

  if (mode === 'full') {
    const lines = UNIVERSAL_SYSTEM_PROMPT_RULES.map(
      (r) => `${r.order}. [${r.titleFa}] ${r.directiveFa}`
    );
    return [
      '=== UNIVERSAL BOOK SYSTEM CONSTITUTION (ALWAYS ACTIVE FOR EVERY UPLOADED FILE) ===',
      'این قوانین عمومی و ثابت برای تمام فایل‌های ورودی (صرف‌نظر از موضوع) همیشه لازم‌الاجرا هستند:',
      ...lines,
      ...(zeroTouchNote ? [zeroTouchNote] : []),
    ].join('\n');
  }

  if (mode === 'analysis' || mode === 'outline') {
    const selectedIds = new Set([
      'zero_prerequisite_scaffolding',
      'warm_plain_formal_persian',
      'scrub_chat_and_noise',
      'zero_loss_deduplicated_synthesis',
      'hard_fact_and_unit_lock',
      'visual_tabular_callout_structure',
    ]);
    const lines = UNIVERSAL_SYSTEM_PROMPT_RULES.filter((r) => selectedIds.has(r.id)).map(
      (r, idx) => `${idx + 1}. [${r.titleFa}] ${r.directiveFa}`
    );
    return [
      'قوانین عمومی ثابت سیستم (همیشه فعال برای تمام فایل‌ها):',
      ...lines,
      ...(zeroTouchNote ? [zeroTouchNote] : []),
    ].join('\n');
  }

  if (mode === 'judge') {
    return [
      'معیارهای عمومی کیفیت کتاب آموزشی (Universal Quality Checks):',
      '- وجود ردپای چت محاوره‌ای («شاگرد من»، «بگو درس بعدی»، «حاضری ادامه بدیم؟»)، تگ خام HTML/جهت‌نما (<span dir="rtl">) یا کاراکترهای بیگانه سرگردان در خروجی خطای کیفی (clarity/structure) محسوب می‌شود.',
      '- نثر باید رسمی اما شیرین، ساده‌خوان و بدون کلمات قلمبه‌سلمبه باشد و اصطلاحات جدید یا پیش‌نیازها بدون پرش مفهومی توضیح داده شوند.',
    ].join('\n');
  }

  if (mode === 'chat') {
    return [
      'قوانین عمومی ثابت سیستم در پاسخ‌گویی و پیشنهاد ویرایش:',
      '- لحن رسمی اما شیرین، ساده و بدون کلمات قلمبه‌سلمبه؛ توضیح مفاهیم از پایه و بدون فرض پیش‌دانش.',
      '- پاک‌سازی کامل ردپای چت، تگ‌های HTML مزاحم و کاراکترهای بیگانه؛ حفظ ۱۰۰٪ داده‌ها، اعداد و اصطلاحات لاتین بدون جعل یا حذف.',
    ].join('\n');
  }

  // 'compact' (default for editorial directive shared across outline/deep review/chat)
  const compactLines = UNIVERSAL_SYSTEM_PROMPT_RULES.map(
    (r) => `- ${r.titleFa}: ${r.summaryFa}`
  );
  return [
    'قوانین عمومی ثابت پرامپت سیستمی (اعمال خودکار روی همه فایل‌های ورودی):',
    ...compactLines,
    ...(zeroTouchNote ? [zeroTouchNote] : []),
  ].join('\n');
}

// ============================================================================
// DETERMINISTIC RAW SOURCE ARTIFACT SCRUBBER (0 TOKENS, 100% LOSSLESS)
// ============================================================================

/**
 * Pure standalone conversational chat filler lines (ONLY matched when the entire line
 * is pure chat navigation with zero technical facts, numbers, formulas, or headings).
 */
const STANDALONE_CHAT_BOILERPLATE_PATTERNS: readonly RegExp[] = [
  /^(?:خیلی\s+خب|بسیار\s+خب|عالیه|آفرین)[!؟.\s]*(?:حالا\s+)?(?:اگه|اگر)\s+(?:آماده[‌\s]?ای|حاضری)\s+(?:بگو|بزن)\s+(?:بریم\s+)?(?:درس|بخش|فصل|جلسه)\s+بعد(?:ی)?[!؟.\s]*$/i,
  /^(?:اگه|اگر)\s+(?:آماده[‌\s]?ای|حاضری|سؤالی\s+نداری|سوالی\s+نداری)[،,\s]*(?:بگو|بنویس)\s+[«"']?(?:درس|بخش|فصل|جلسه)\s+بعد(?:ی)?[»"']?[!؟.\s]*$/i,
  /^(?:برای\s+ادامه\s+)?(?:کافی[‌\s]?است\s+)?(?:بگو|بنویس|تایپ\s+کن)\s*[«:"']?\s*(?:درس|بخش|فصل|جلسه)\s+بعد(?:ی)?\s*[»"']?[!؟.\s]*$/i,
  /^(?:آماده[‌\s]?ای|حاضری)\s+(?:بریم\s+(?:سراغ\s+)?)?(?:درس|بخش|فصل|جلسه)\s+بعد(?:ی)?[؟?!.\s]*$/i,
  /^(?:هر\s+وقت\s+آماده\s+بودی\s+)?(?:بگو\s+)?(?:بریم\s+سراغ\s+)?(?:درس|فصل|جلسه)\s+بعد(?:ی)?[!؟.\s]*$/i,
];

/**
 * Deterministically scrubs common Pandoc / Word-to-Markdown / Chat-export artifacts
 * WITHOUT dropping a single formula, number, hex address, Greek math symbol, or technical fact:
 * 1. Strips `<span dir="rtl">`, `<span dir="ltr">`, `</span>`, `<div dir="...">`, `</div>` wrappers while preserving inner text.
 * 2. Normalizes Pandoc/GitLab inline math `$`...`$` -> `$...$` and escaped `\$` -> `$`.
 * 3. Unescapes Pandoc-escaped Markdown syntax (`\##`, `\###`, `\*\*`, `\* `, `\- `).
 * 4. Removes lone Pandoc backslash break lines (`^\s*\\\s*$`).
 * 5. Removes stray accidental CJK/Cyrillic LLM glitch tokens (e.g., `数学`, `многих`) embedded inside Persian text.
 * 6. Removes pure standalone chat-prompt filler lines (e.g., "بگو درس بعدی") only when free of technical data.
 */
const DISPLACED_ZWNJ_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/نرما\u200cفزار/g, 'نرم\u200cافزار'],
  [/سختا\u200cفزار/g, 'سخت\u200cافزار'],
  [/برنامهر\u200cیزی/g, 'برنامه\u200cریزی'],
  [/فوقالع\u200cاده/g, 'فوق\u200cالعاده'],
  [/بینظ\u200cیر/g, 'بی\u200cنظیر'],
  [/گازس\u200cوز/g, 'گازسوز'],
  [/دوگانهس\u200cوز/g, 'دوگانه\u200cسوز'],
  [/دوگانه\s*سوز/g, 'دوگانه\u200cسوز'],
  [/بههم\s+ریختن/g, 'به\u200cهم ریختن'],
  [/میش\u200cود/g, 'می\u200cشود'],
  [/نمیش\u200cود/g, 'نمی\u200cشود'],
  [/میک\u200cند/g, 'می\u200cکند'],
  [/میت\u200cوان/g, 'می\u200cتوان'],
  [/نمیت\u200cوان/g, 'نمی\u200cتوان'],
  [/(سیستم|قابلیت|پروتکل|نسل|مدل|جدول|موتور|سنسور|مپ|فایل|آپدیت|شرکت|محدودیت|ویژگی|تغییر|پارامتر|خودرو|ایسیو)ه\u200cای\b/g, '$1\u200cهای'],
  [/(سیستم|قابلیت|پروتکل|نسل|مدل|جدول|موتور|سنسور|مپ|فایل|آپدیت|شرکت|محدودیت|ویژگی|تغییر|پارامتر|خودرو|ایسیو)هیا\b/g, '$1\u200cهای'],
];

export function repairDisplacedPersianZwnj(input: string): string {
  let text = input;
  for (const [rx, replacement] of DISPLACED_ZWNJ_REPLACEMENTS) {
    text = text.replace(rx, replacement);
  }
  return text;
}

export function scrubRawSourceArtifacts(rawContent: string): string {
  if (!rawContent) return '';

  let out = rawContent
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 1. Strip HTML directional wrapper tags (<span dir="rtl">, </span>, <div dir="ltr">, </div>) preserving all inner text
    .replace(/<\/?(?:span|div)(?:\s+(?:dir|lang|class|style)\s*=\s*["'][^"']*["'])*\s*>/gi, '')
    // 2. Remove stray accidental CJK (Han ideographs) and Cyrillic LLM glitch tokens (preserves Greek math symbols α,β,γ,Δ,θ,λ,τ,ω,π,η!)
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u0400-\u04FF]+/g, '')
    // 3. Unescape Pandoc-exported Markdown headings, bold, list items, numbered lists, brackets, horizontal rules, and math delimiters
    .replace(/^\s*\\(#{1,6}\s+)/gm, '$1')
    .replace(/^\s*\\([*-]\s+)/gm, '$1')
    .replace(/^(\s*\d+)\\\.\s+/gm, '$1. ')
    .replace(/^\s*\\---\s*$/gm, '---')
    .replace(/\\\*\\\*/g, '**')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\$`([^`\n]+)`\$/g, (_, expr: string) => `$${expr}$`)
    .replace(/\\\$/g, '$');

  // 3B. Repair displaced Persian ZWNJ OCR/PDF glitches
  out = repairDisplacedPersianZwnj(out);

  // 4. Clean lone backslash lines, unescape Pandoc pipe table rows, and strip pure standalone chat navigation filler lines
  const lines = out.split('\n');
  const cleanedLines: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine;
    const trimmed = line.trim();

    // Lone Pandoc line-break backslash ("\")
    if (trimmed === '\\') {
      continue;
    }

    // Unescape Pandoc-escaped Markdown table rows (e.g. "\| پارامتر \| ... \|" or "\| :--- \| :--- \|")
    if (trimmed.startsWith('\\|') && (trimmed.match(/\\\|/g) || []).length >= 2) {
      line = line.replace(/\\\|/g, '|');
    }

    // Remove pure standalone chat navigation filler lines (only if no digits, no Latin technical tokens, no markdown heading/table)
    if (
      trimmed.length > 0 &&
      trimmed.length <= 120 &&
      !/[0-9۰-۹A-Za-z#|`$=]/.test(trimmed) &&
      STANDALONE_CHAT_BOILERPLATE_PATTERNS.some((rx) => rx.test(trimmed))
    ) {
      continue;
    }

    // Collapse double spaces left after stripping inline spans/glitches (preserve leading indentation for lists)
    const leadingIndent = line.match(/^[ \t]*/)?.[0] || '';
    const body = line.slice(leadingIndent.length).replace(/[ \t]{2,}/g, ' ');
    cleanedLines.push(`${leadingIndent}${body}`);
  }

  return cleanedLines
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n');
}

// ============================================================================
// ADAPTIVE AUTOMOTIVE DOMAIN & HIGH-PRECISION REMAP MODE DIRECTIVES
// ============================================================================

export function buildHighPrecisionRemapDirective(): string {
  return [
    '=== HIGH-PRECISION REMAP & ECU CALIBRATION MODE (AUTO-ACTIVATED) ===',
    '۱. حفظ بی‌کم‌وکاست داده‌های فنی: هیچ آدرس هگز (0x...)، ساختار ۸/۱۶/۳۲ بیتی (HiLo/LoHi)، Signed/Unsigned، ضریب (Factor)، آفست (Offset)، ابعاد جدول (RPM×Load)، کد خطای DTC، اعداد AFR/Lambda/Ignition/Boost/Dwell یا هشدار ایمنی نباید حذف، گرد یا تخمین زده شود.',
    '۲. قانون Strict Null Policy: برای ستون‌هایی که مقدار آن‌ها در فایل منبع نیامده (مانند مقدار فابریک یا بازه ایمن تغییرات)، هرگز عدد حدسی ننویس و دقیقاً عبارت «نامشخص / نیازمند بررسی روی فایل خودرو» ثبت کن.',
    '۳. ممنوعیت نام‌گذاری حدسی نقشه‌ها: اگر نام نقشه در منبع مشخص نیست، نام اختراعی نگذار و دقیقاً از الگوی UNKNOWN_MAP_<HEX> (مثلاً UNKNOWN_MAP_0x18000) استفاده کن.',
    '۴. درج سطح سند (evidence_tier) و هشدار ایمنی: هر نقشه باید سطح اعتبار (a2l_xdf_verified / text_or_screenshot_reported / pattern_candidate) و هشدار الزامی بازبینی انسانی داشته باشد؛ هرگز هیچ خروجی را «آماده فلش مستقیم روی ECU» اعلام نکن.',
  ].join('\n');
}

export function buildAdaptiveAutomotivePromptDirective(params: {
  domainTitleFa: string;
  highPrecisionRemapMode: boolean;
}): string {
  const base = [
    `=== ADAPTIVE AUTOMOTIVE DOMAIN DIRECTIVE (${params.domainTitleFa}) ===`,
    'لحن آموزشی رسمی اما روان و ساده‌خوان با چیدمان پلکانی از پیش‌نیازها تا سطح پیشرفته، حفظ ۱۰۰٪ اعداد، استانداردها (OBD2 / DTC / PID / CAN-FD / DoIP / OBDonUDS / SGW / SFD2 / EV-BMS) و ساختار جدولی و کادربندی استاندارد.',
  ].join('\n');

  if (!params.highPrecisionRemapMode) {
    return base;
  }
  return `${base}\n\n${buildHighPrecisionRemapDirective()}`;
}

