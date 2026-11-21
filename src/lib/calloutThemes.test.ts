import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALLOUT_THEMES,
  getCalloutTheme,
  SPECIAL_FRAME_THEMES,
} from './calloutThemes.ts';
import type { CalloutVariant } from './bookTypes.ts';

const HEX6 = /^[0-9A-F]{6}$/;

test('All 7 editorial callout variants have distinct color themes and valid 6-char Word hex codes', () => {
  const variants: CalloutVariant[] = [
    'warning',
    'engineering',
    'concept',
    'qa',
    'revision',
    'project',
    'general',
  ];

  const headerFills = new Set<string>();
  const accentColors = new Set<string>();

  for (const variant of variants) {
    const theme = getCalloutTheme(variant);
    assert.equal(theme.variant, variant);
    assert.ok(theme.labelFa.length > 0);
    assert.match(theme.docxBorderHex, HEX6);
    assert.match(theme.docxHeaderBgHex, HEX6);
    assert.match(theme.docxBodyBgHex, HEX6);
    assert.match(theme.docxAccentHex, HEX6);
    assert.match(theme.docxDividerHex, HEX6);
    headerFills.add(theme.docxHeaderBgHex);
    accentColors.add(theme.docxAccentHex);
  }

  // Every callout type must have its own visually distinct palette
  assert.equal(headerFills.size, variants.length);
  assert.equal(accentColors.size, variants.length);
  assert.equal(Object.keys(CALLOUT_THEMES).length, variants.length);
});

test('All special editorial frames (web enrichment, conflict, equation, figure, metadata, suggestions) have valid themes', () => {
  const keys = Object.keys(SPECIAL_FRAME_THEMES) as Array<keyof typeof SPECIAL_FRAME_THEMES>;
  assert.ok(keys.includes('web_enrichment'));
  assert.ok(keys.includes('conflict_note'));
  assert.ok(keys.includes('equation'));
  assert.ok(keys.includes('figure'));
  assert.ok(keys.includes('chapter_meta'));
  assert.ok(keys.includes('suggestions'));

  for (const key of keys) {
    const theme = SPECIAL_FRAME_THEMES[key];
    assert.ok(theme.labelFa.length > 0);
    assert.match(theme.docxBorderHex, HEX6);
    assert.match(theme.docxHeaderBgHex, HEX6);
    assert.match(theme.docxBodyBgHex, HEX6);
    assert.match(theme.docxAccentHex, HEX6);
  }
});
