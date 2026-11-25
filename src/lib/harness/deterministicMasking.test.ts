import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPreservedImmutableTokens,
  maskSourceChunks,
  maskTechnicalTokens,
  unmaskSemanticBlock,
  unmaskSemanticSectionIR,
  unmaskTechnicalTokens,
} from './deterministicMasking.ts';
import type { SemanticSectionIR } from './types.ts';

test('maskTechnicalTokens replaces hex addresses, DTC codes, and DAMOS factors with immutable tokens', () => {
  const input = `در ایسیو زیمنس، آدرس 0x1A4F0 مربوط به نقشه KFZW و آدرس $2B100 مربوط به کات‌اف است.
کد خطای P0135 هیتر سنسور اکسیژن است.
تنظیمات ضریب به صورت Factor: 0.75 و Offset: -48 در وینولز ثبت می‌شود.`;

  const result = maskTechnicalTokens(input);

  assert.equal(result.totalMasked, 5);
  assert.ok(result.maskedText.includes('[[HEX_IMMUTABLE_001]]'));
  assert.ok(result.maskedText.includes('[[HEX_IMMUTABLE_002]]'));
  assert.ok(result.maskedText.includes('[[DTC_IMMUTABLE_001]]'));
  assert.ok(result.maskedText.includes('[[SCALE_IMMUTABLE_001]]'));
  assert.ok(result.maskedText.includes('[[SCALE_IMMUTABLE_002]]'));

  // Ensure original values are mapped
  assert.equal(result.tokenMap.get('[[HEX_IMMUTABLE_001]]'), '0x1A4F0');
  assert.equal(result.tokenMap.get('[[HEX_IMMUTABLE_002]]'), '$2B100');
  assert.equal(result.tokenMap.get('[[DTC_IMMUTABLE_001]]'), 'P0135');
  assert.equal(result.tokenMap.get('[[SCALE_IMMUTABLE_001]]'), 'Factor: 0.75');
  assert.equal(result.tokenMap.get('[[SCALE_IMMUTABLE_002]]'), 'Offset: -48');

  // Unmasking reproduces exact original text
  const restored = unmaskTechnicalTokens(result.maskedText, result.tokenMap);
  assert.equal(restored, input);
});

test('auditPreservedImmutableTokens verifies preservation of masked tokens', () => {
  const result = maskTechnicalTokens('مپ جرقه 0x1A4F0 و خطای P0135');
  assert.equal(result.totalMasked, 2);

  const goodGen = 'در آدرس [[HEX_IMMUTABLE_001]] بررسی شد و خطای [[DTC_IMMUTABLE_001]] رفع گردید.';
  const auditGood = auditPreservedImmutableTokens(goodGen, result.tokenMap);
  assert.equal(auditGood.passed, true);
  assert.equal(auditGood.missingTokens.length, 0);

  const badGen = 'در آدرس 0x1A400 بررسی شد و خطای P0130 رفع گردید.'; // hallucinated & tokens lost
  const auditBad = auditPreservedImmutableTokens(badGen, result.tokenMap);
  assert.equal(auditBad.passed, false);
  assert.equal(auditBad.missingTokens.length, 2);
});

test('unmaskSemanticSectionIR restores original calibration values across all blocks', () => {
  const rawInput = 'آدرس 0x1A4F0 با کد P0135';
  const masked = maskTechnicalTokens(rawInput);

  const sampleIR: SemanticSectionIR = {
    sectionId: 'sec_1',
    chapterId: 'ch_1',
    title: 'فصل [[HEX_IMMUTABLE_001]]',
    blocks: [
      {
        id: 'b_1',
        kind: 'paragraph',
        sourceChunkIds: ['c1'],
        text: 'کالیبراسیون در [[HEX_IMMUTABLE_001]] با خطای [[DTC_IMMUTABLE_001]].',
      },
      {
        id: 'b_2',
        kind: 'table',
        sourceChunkIds: ['c1'],
        headers: ['پارامتر', 'مقدار'],
        rows: [
          ['آدرس نقشه', '[[HEX_IMMUTABLE_001]]'],
          ['کد خطا', '[[DTC_IMMUTABLE_001]]'],
        ],
      },
    ],
    sourceChunkIds: ['c1'],
    generatedAt: new Date().toISOString(),
    modelUsed: 'test-model',
    tierUsed: 'balanced',
  };

  const unmaskedIR = unmaskSemanticSectionIR(sampleIR, masked.tokenMap);

  assert.equal(unmaskedIR.title, 'فصل 0x1A4F0');
  assert.equal(
    unmaskedIR.blocks[0].text,
    'کالیبراسیون در 0x1A4F0 با خطای P0135.'
  );
  assert.deepEqual(unmaskedIR.blocks[1].rows, [
    ['آدرس نقشه', '0x1A4F0'],
    ['کد خطا', 'P0135'],
  ]);
});

test('maskSourceChunks assigns unified tokens across multiple source chunks', () => {
  const chunks = [
    {
      id: 'chk-1',
      fileName: 'f1.docx',
      text: 'ایسیو بوش ME7.4.4 با نقشه 0x1A4F0 و خطای P0135',
      wordCount: 8,
    },
    {
      id: 'chk-2',
      fileName: 'f2.docx',
      text: 'همان نقشه 0x1A4F0 با ضریب Factor: 0.75 و خطای P0300',
      wordCount: 9,
    },
  ];

  const res = maskSourceChunks(chunks);
  assert.equal(res.maskedChunks.length, 2);
  // Same hex address in both chunks must map to identical token
  assert.ok(res.maskedChunks[0].text.includes('[[HEX_IMMUTABLE_001]]'));
  assert.ok(res.maskedChunks[1].text.includes('[[HEX_IMMUTABLE_001]]'));
  assert.equal(res.tokenMap.get('[[HEX_IMMUTABLE_001]]'), '0x1A4F0');
  // Different DTCs map to distinct tokens
  assert.ok(res.maskedChunks[0].text.includes('[[DTC_IMMUTABLE_001]]'));
  assert.ok(res.maskedChunks[1].text.includes('[[DTC_IMMUTABLE_002]]'));
  assert.equal(res.tokenMap.get('[[DTC_IMMUTABLE_001]]'), 'P0135');
  assert.equal(res.tokenMap.get('[[DTC_IMMUTABLE_002]]'), 'P0300');
});
