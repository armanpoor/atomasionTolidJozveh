import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOOK_WORKFLOW_STAGES,
  computeWorkflowProgress,
  getStageMeta,
} from './bookWorkflow.ts';
import type { ProjectBundleDto } from './bookTypes.ts';

function makeEmptyBundle(): ProjectBundleDto {
  return {
    project: {
      id: 'proj_1',
      title: 'کتاب نمونه',
      workflowMode: 'multi_merge',
      status: 'draft',
      pipelineStage: 1,
      settingsJson: {},
      checkpointJson: {},
      bookSnapshotJson: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    sourceFiles: [],
    contentUnits: [],
    outlineNodes: [],
    dedupClusters: [],
    conflicts: [],
    auditReport: null,
  };
}

test('BOOK_WORKFLOW_STAGES defines 5 distinct single-responsibility stages', () => {
  assert.equal(BOOK_WORKFLOW_STAGES.length, 5);
  assert.deepEqual(
    BOOK_WORKFLOW_STAGES.map((s) => s.key),
    ['ingest', 'dedup', 'outline', 'preview', 'export']
  );
  assert.equal(getStageMeta(3).key, 'outline');
});

test('computeWorkflowProgress locks stages cleanly until each prerequisite stage completes', () => {
  // 1. Empty project -> only Stage 1 unlocked
  const empty = computeWorkflowProgress({ bundle: makeEmptyBundle(), queuedFilesCount: 0 });
  assert.equal(empty.recommendedStage, 1);
  assert.equal(empty.unlockedStages[1], true);
  assert.equal(empty.unlockedStages[2], false);
  assert.equal(empty.unlockedStages[3], false);
  assert.equal(empty.unlockedStages[4], false);
  assert.equal(empty.unlockedStages[5], false);

  // 2. After Stage 1 Ingest ONLY -> Stage 2 unlocks, Stage 3 stays locked!
  const ingestedBundle = makeEmptyBundle();
  ingestedBundle.sourceFiles = [
    {
      id: 'f1',
      projectId: 'proj_1',
      fileName: 'ch1.md',
      format: 'md',
      fileRole: 'standard',
      sizeBytes: 1200,
      wordCount: 300,
      unitCount: 1,
      checksum: 'hash1',
      uploadedAt: new Date().toISOString(),
    },
  ];
  ingestedBundle.contentUnits = [
    {
      id: 'u1',
      projectId: 'proj_1',
      sourceFileId: 'f1',
      unitOrder: 1,
      headingPath: 'فصل ۱',
      unitType: 'paragraph',
      rawText: 'متن نمونه فنی برای تست.',
      normalizedHash: 'abc',
      status: 'active',
      canonicalUnitId: null,
      outlineNodeId: null,
      metadataJson: {},
    },
  ];
  const afterStage1 = computeWorkflowProgress({ bundle: ingestedBundle });
  assert.equal(afterStage1.hasIngestedFiles, true);
  assert.equal(afterStage1.hasDedupResults, false);
  assert.equal(afterStage1.completedStages[1], true);
  assert.equal(afterStage1.unlockedStages[2], true);
  assert.equal(afterStage1.unlockedStages[3], false);
  assert.equal(afterStage1.recommendedStage, 2);

  // 3. After Stage 2 Dedup -> Stage 3 Outline unlocks, Stages 4 & 5 stay locked
  const dedupedBundle = structuredClone(ingestedBundle);
  dedupedBundle.project.pipelineStage = 2;
  dedupedBundle.outlineNodes = [
    {
      id: 'n1',
      projectId: 'proj_1',
      parentId: null,
      level: 1,
      nodeOrder: 1,
      title: 'فصل اول',
      summary: 'خلاصه',
      isApproved: false,
      webEnrichmentJson: null,
    },
  ];
  const afterStage2 = computeWorkflowProgress({ bundle: dedupedBundle });
  assert.equal(afterStage2.hasDedupResults, true);
  assert.equal(afterStage2.hasOutline, true);
  assert.equal(afterStage2.completedStages[2], true);
  assert.equal(afterStage2.unlockedStages[3], true);
  assert.equal(afterStage2.unlockedStages[4], false);
  assert.equal(afterStage2.recommendedStage, 3);

  // 4. After Stage 3 -> Stage 4 Finalize -> Stages 4 & 5 unlock
  const finalizedBundle = structuredClone(dedupedBundle);
  finalizedBundle.project.pipelineStage = 5;
  finalizedBundle.project.status = 'completed';
  finalizedBundle.project.bookSnapshotJson = {
    title: 'کتاب نمونه',
    subtitle: '',
    author: '',
    chapters: [],
    glossary: [],
    footnotes: [],
    stats: { wordCount: 300, chapterCount: 1, tableCount: 0, calloutCount: 0, equationCount: 0 },
  } as unknown as ProjectBundleDto['project']['bookSnapshotJson'];
  const afterStage4 = computeWorkflowProgress({ bundle: finalizedBundle });
  assert.equal(afterStage4.hasFinalBook, true);
  assert.equal(afterStage4.unlockedStages[4], true);
  assert.equal(afterStage4.unlockedStages[5], true);
  assert.equal(afterStage4.completedStages[4], true);
  assert.equal(afterStage4.completedStages[5], true);
  assert.equal(afterStage4.recommendedStage, 4);
});
