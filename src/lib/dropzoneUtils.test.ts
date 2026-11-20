import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTotalQueueBytes,
  formatCompactFileSize,
  getFormatVisualMeta,
  isSupportedUploadFileName,
  partitionDroppedFiles,
} from './dropzoneUtils.ts';

test('isSupportedUploadFileName accepts supported text/doc formats and rejects binaries', () => {
  assert.equal(isSupportedUploadFileName('chapter1.docx'), true);
  assert.equal(isSupportedUploadFileName('NOTES.MD'), true);
  assert.equal(isSupportedUploadFileName('guide.markdown'), true);
  assert.equal(isSupportedUploadFileName('data.json'), true);
  assert.equal(isSupportedUploadFileName('metrics.csv'), true);
  assert.equal(isSupportedUploadFileName('draft.txt'), true);
  assert.equal(isSupportedUploadFileName('export.html'), true);
  assert.equal(isSupportedUploadFileName('page.HTM'), true);

  assert.equal(isSupportedUploadFileName('photo.png'), false);
  assert.equal(isSupportedUploadFileName('archive.zip'), false);
  assert.equal(isSupportedUploadFileName('installer.exe'), false);
  assert.equal(isSupportedUploadFileName('noextension'), false);
});

test('partitionDroppedFiles separates valid files, unsupported formats, and queue duplicates', () => {
  const existing = [{ name: 'day1.md', size: 2048 }];
  const incoming = [
    { name: 'day1.md', size: 2048 }, // duplicate of existing
    { name: 'day2.docx', size: 15000 }, // accepted
    { name: 'day2.docx', size: 15000 }, // duplicate inside same drop batch
    { name: 'table.csv', size: 640 }, // accepted
    { name: 'diagram.png', size: 92000 }, // unsupported
  ];

  const result = partitionDroppedFiles(incoming, existing);
  assert.deepEqual(
    result.accepted.map((f) => f.name),
    ['day2.docx', 'table.csv']
  );
  assert.deepEqual(result.rejectedNames, ['diagram.png']);
  assert.deepEqual(result.duplicateNames, ['day1.md', 'day2.docx']);
});

test('formatCompactFileSize, computeTotalQueueBytes, and getFormatVisualMeta work accurately', () => {
  assert.equal(formatCompactFileSize(512), '۵۱۲ بایت');
  assert.equal(formatCompactFileSize(12 * 1024), '۱۲ کیلوبایت');
  assert.equal(formatCompactFileSize(2.5 * 1024 * 1024), '۲.۵ مگابایت');

  assert.equal(computeTotalQueueBytes([{ sizeBytes: 1200 }, { sizeBytes: 800 }]), 2000);
  assert.equal(getFormatVisualMeta('docx').shortCode, 'DOCX');
  assert.equal(getFormatVisualMeta('csv').persianLabel, 'جدول داده');
  assert.equal(getFormatVisualMeta('json').shortCode, 'JSON');
});
