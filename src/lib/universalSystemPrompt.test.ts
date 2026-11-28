import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUniversalSystemPromptBlock,
  scrubRawSourceArtifacts,
  UNIVERSAL_SYSTEM_PROMPT_RULES,
} from './universalSystemPrompt.ts';
import { parseMarkdownDocument, preprocessMessyRemapText } from './formatParsers.ts';
import { buildEditorialSystemDirective } from './winolsMapGuide.ts';
import { buildImmutableCachedPrefix, computePrefixHash } from './harness/promptBuilder.ts';
import type { LivingGlossary } from './harness/types.ts';

test('UNIVERSAL_SYSTEM_PROMPT_RULES covers all 9 universal book rules and builds byte-deterministic blocks', () => {
  assert.equal(UNIVERSAL_SYSTEM_PROMPT_RULES.length, 9);

  const fullA = buildUniversalSystemPromptBlock({ mode: 'full' });
  const fullB = buildUniversalSystemPromptBlock({ mode: 'full' });
  assert.equal(fullA, fullB, 'Universal system prompt block must be byte-deterministic for prompt caching');
  assert.match(fullA, /شروع از صفرِ صفر/);
  assert.match(fullA, /الگوی آموزشی ۴ مرحله‌ای/);
  assert.match(fullA, /قلمبه‌سلمبه/);
  assert.match(fullA, /پاک‌سازی کامل ردپای چت/);
  assert.match(fullA, /یکپارچه‌سازی بدون افت/);

  const zeroTouch = buildUniversalSystemPromptBlock({ mode: 'compact', respectZeroTouch: true });
  assert.match(zeroTouch, /۰٪ بازنویسی/);
});

test('scrubRawSourceArtifacts strips Pandoc spans, escaped markdown, stray CJK/Cyrillic glitches, and pure chat boilerplate while preserving math & technical tokens', () => {
  const messySample = [
    '<span dir="rtl">\\</span>',
    '\\## <span dir="rtl">۱</span>. <span dir="rtl">اصلاح فرمول پایه</span>',
    '<span dir="rtl">در حرکت چرخشی، گشتاور با</span> $\\tau = I \\times \\alpha$ <span dir="rtl">نشان داده می‌شود و</span> $`3000\\text{~RPM}`$ <span dir="rtl">ثابت است.</span>',
    '<span dir="rtl">متن دارای خطای تایپی تصادفی</span> 数学 <span dir="rtl">و</span> многих <span dir="rtl">باید پاک شود، اما آدرس</span> 0x1A4F0 <span dir="rtl">و نقشه</span> \\*\\*KFZW\\*\\* <span dir="rtl">و</span> $\\lambda = 0.85$ <span dir="rtl">دقیق حفظ شوند.</span>',
    '\\* \\*\\*<span dir="rtl">سرعت</span> ($v$ / $\\omega$):\\*\\* <span dir="rtl">مقدار چرخش در واحد زمان.</span>',
    'اگر آماده‌ای بگو درس بعدی!',
  ].join('\n');

  const cleaned = scrubRawSourceArtifacts(messySample);

  assert.doesNotMatch(cleaned, /<span/i);
  assert.doesNotMatch(cleaned, /<\/span>/i);
  assert.doesNotMatch(cleaned, /数学|многих/);
  assert.doesNotMatch(cleaned, /بگو درس بعدی/);
  assert.doesNotMatch(cleaned, /^\\$/m);

  assert.match(cleaned, /^## ۱\. اصلاح فرمول پایه/m);
  assert.match(cleaned, /\$\\tau = I \\times \\alpha\$/);
  assert.match(cleaned, /\$3000\\text\{~RPM\}\$/);
  assert.match(cleaned, /0x1A4F0/);
  assert.match(cleaned, /\*\*KFZW\*\*/);
  assert.match(cleaned, /\$\\lambda = 0\.85\$/);
  assert.match(cleaned, /^\* \*\*سرعت/m);
});

test('preprocessMessyRemapText & parseMarkdownDocument cleanly parse Pandoc-style Persian ordinal lessons without leaving HTML spans', () => {
  const pandocCourse = [
    '<span dir="rtl">خوش آمدی! در این بخش مفاهیم پایه را می‌خوانیم.</span>',
    '',
    '**<span dir="rtl">فاز اول: مبانی خوانش منحنی‌های توان و گشتاور</span>**',
    '',
    '**<span dir="rtl">بخش صفر: پیش‌نیاز صفر و پل مفهومی</span>**',
    '',
    '<span dir="rtl">دور موتور با</span> $`3000\\text{~RPM}`$ <span dir="rtl">نشان داده می‌شود.</span>',
    '',
    '**<span dir="rtl">درس اول: آناتومی منحنی گشتاور</span>**',
    '',
    '<span dir="rtl">رابطه توان و گشتاور همیشه برقرار است.</span>',
  ].join('\n');

  const preprocessed = preprocessMessyRemapText(pandocCourse);
  assert.match(preprocessed, /^# فاز اول:/m);
  assert.match(preprocessed, /^## بخش صفر:/m);
  assert.match(preprocessed, /^# درس اول:/m);
  assert.doesNotMatch(preprocessed, /<span/i);

  const parsed = parseMarkdownDocument(pandocCourse, 'dyno_sample.md');
  assert.ok(parsed.chapters.length >= 2, 'Should detect both Phase 1 and Lesson 1 chapters');
  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /<span/i);
  assert.match(serialized, /3000/);
});

test('buildEditorialSystemDirective and buildImmutableCachedPrefix both inject universal system rules with stable cache hash', () => {
  const editorial = buildEditorialSystemDirective({
    aiRewriteLevel: 'light_polish',
    outputTone: 'academic_engineering',
  });
  assert.match(editorial, /قوانین عمومی ثابت پرامپت سیستمی/);
  assert.match(editorial, /شروع از صفرِ صفر/);
  assert.match(editorial, /قلمبه‌سلمبه/);

  const glossary: LivingGlossary = {
    version: 1,
    frozen: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    entries: [],
  };
  const prefix1 = buildImmutableCachedPrefix(glossary, { validationDomain: 'general_persian_technical' });
  const prefix2 = buildImmutableCachedPrefix(glossary, { validationDomain: 'general_persian_technical' });
  assert.equal(computePrefixHash(prefix1), computePrefixHash(prefix2));
  assert.match(prefix1, /UNIVERSAL BOOK SYSTEM CONSTITUTION/);
  assert.match(prefix1, /الگوی آموزشی ۴ مرحله‌ای/);
});
