import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRevisionSnapshotPayload,
  filterProjectRevisions,
  isValidRevisionSnapshot,
  ProjectRevisionDto,
} from './changeLogUtils';

const SAMPLE_REVISIONS: ProjectRevisionDto[] = [
  {
    id: 'rev_3',
    projectId: 'proj_1',
    versionNumber: 3,
    actorType: 'ai',
    actorName: 'Gemini 4 Hydrogen',
    actionType: 'deep_ai_review',
    title: 'بازبینی عمیق هوش مصنوعی',
    summary: 'بهبود ۳ عنوان فصل و افزودن ۲ باکس نکته',
    details: { chaptersCount: 4, pipelineStage: 4, hasBookSnapshot: true },
    hasSnapshot: true,
    createdAt: '2026-11-21T10:15:00.000Z',
  },
  {
    id: 'rev_2',
    projectId: 'proj_1',
    versionNumber: 2,
    actorType: 'user',
    actorName: 'کاربر مهمان',
    actionType: 'outline_updated',
    title: 'ویرایش ساختار فصل‌ها',
    summary: 'تغییر عنوان فصل اول و جابه‌جایی فصل دوم',
    details: { chaptersCount: 4, pipelineStage: 3, hasBookSnapshot: false },
    hasSnapshot: true,
    createdAt: '2026-11-21T10:05:00.000Z',
  },
  {
    id: 'rev_1',
    projectId: 'proj_1',
    versionNumber: 1,
    actorType: 'system',
    actorName: 'موتور ادغام بدون افت',
    actionType: 'dedup_completed',
    title: 'ادغام بدون افت و کشف تناقض',
    summary: 'ادغام ۳ بند تکراری و شناسایی ۱ تناقض واقعی',
    details: { chaptersCount: 4, pipelineStage: 2, hasBookSnapshot: false },
    hasSnapshot: true,
    createdAt: '2026-11-21T10:00:00.000Z',
  },
];

test('filters project revisions by actor type and search query', () => {
  assert.equal(filterProjectRevisions(SAMPLE_REVISIONS, { actorFilter: 'all' }).length, 3);
  assert.equal(filterProjectRevisions(SAMPLE_REVISIONS, { actorFilter: 'user' }).length, 1);
  assert.equal(filterProjectRevisions(SAMPLE_REVISIONS, { actorFilter: 'user' })[0].id, 'rev_2');
  assert.equal(filterProjectRevisions(SAMPLE_REVISIONS, { actorFilter: 'ai' }).length, 2);

  const byText = filterProjectRevisions(SAMPLE_REVISIONS, { query: 'بازبینی عمیق' });
  assert.equal(byText.length, 1);
  assert.equal(byText[0].versionNumber, 3);

  const byVersion = filterProjectRevisions(SAMPLE_REVISIONS, { query: 'نسخه 2' });
  assert.equal(byVersion.length, 1);
  assert.equal(byVersion[0].id, 'rev_2');
});

test('builds and validates project revision snapshots safely', () => {
  const snapshot = buildRevisionSnapshotPayload({
    project: {
      title: 'کتاب راهنمای کالیبراسیون',
      workflowMode: 'multi_merge',
      pipelineStage: 4,
      status: 'completed',
      settingsJson: { fontFamily: 'Vazir Medium' },
      bookSnapshotJson: { title: 'کتاب راهنمای کالیبراسیون' },
    },
    outlineNodes: [
      {
        id: 'node_1',
        parentId: null,
        level: 1,
        nodeOrder: 1,
        title: 'فصل اول',
        summary: 'مقدمه',
        isApproved: true,
        webEnrichmentJson: null,
      },
    ],
    contentUnits: [
      {
        id: 'u_1',
        status: 'unique',
        canonicalUnitId: null,
        outlineNodeId: 'node_1',
        rawText: 'متن نمونه',
      },
    ],
    conflicts: [
      {
        id: 'c_1',
        status: 'open',
        resolutionNote: null,
        webGroundingJson: null,
      },
    ],
  });

  assert.equal(isValidRevisionSnapshot(snapshot), true);
  assert.equal(snapshot.outlineNodes.length, 1);
  assert.equal(snapshot.contentUnits.length, 1);
  assert.equal(isValidRevisionSnapshot(null), false);
  assert.equal(isValidRevisionSnapshot({ schemaVersion: 2 }), false);
});
