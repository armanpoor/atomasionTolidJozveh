import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearOutlineDraft,
  computeOutlineFingerprint,
  hasMeaningfulDraftDiff,
  loadOutlineDraft,
  parseOutlineDraft,
  saveOutlineDraft,
  StorageLike,
} from './outlineAutoSave.ts';
import type { OutlineNodeDto } from './bookTypes.ts';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function makeNodes(projectId = 'proj_alpha'): OutlineNodeDto[] {
  return [
    {
      id: 'node_1',
      projectId,
      parentId: null,
      level: 1,
      nodeOrder: 1,
      title: 'فصل ۱: مبانی',
      summary: 'خلاصه ۱',
      isApproved: false,
      webEnrichmentJson: null,
    },
    {
      id: 'node_2',
      projectId,
      parentId: null,
      level: 1,
      nodeOrder: 2,
      title: 'فصل ۲: کاربردها',
      summary: 'خلاصه ۲',
      isApproved: false,
      webEnrichmentJson: null,
    },
  ];
}

test('saveOutlineDraft + loadOutlineDraft round-trip safely and detect meaningful diffs', () => {
  const storage = createMemoryStorage();
  const serverNodes = makeNodes('proj_alpha');
  const editedNodes = [
    { ...serverNodes[1], nodeOrder: 1, title: 'فصل ۱: کاربردهای عملی (ویرایش‌شده)' },
    { ...serverNodes[0], nodeOrder: 2 },
  ];

  const saved = saveOutlineDraft(
    {
      projectId: 'proj_alpha',
      serverNodes,
      draftNodes: editedNodes,
      reassignments: [{ fromNodeId: 'node_3', toNodeId: 'node_1' }],
      savedAt: '2026-11-21T15:00:00.000Z',
    },
    storage
  );
  assert.equal(saved.ok, true);

  const loaded = loadOutlineDraft('proj_alpha', storage);
  assert.ok(loaded);
  assert.equal(loaded.projectId, 'proj_alpha');
  assert.equal(loaded.nodes.length, 2);
  assert.equal(loaded.nodes[0].title, 'فصل ۱: کاربردهای عملی (ویرایش‌شده)');
  assert.equal(loaded.reassignments.length, 1);
  assert.equal(hasMeaningfulDraftDiff(loaded, serverNodes), true);

  // Cross-project isolation: loading another project never returns proj_alpha's draft
  assert.equal(loadOutlineDraft('proj_beta', storage), null);

  // Clearing draft removes it completely
  clearOutlineDraft('proj_alpha', storage);
  assert.equal(loadOutlineDraft('proj_alpha', storage), null);
});

test('hasMeaningfulDraftDiff returns false when draft matches server nodes with no reassignments', () => {
  const storage = createMemoryStorage();
  const serverNodes = makeNodes('proj_same');
  saveOutlineDraft(
    {
      projectId: 'proj_same',
      serverNodes,
      draftNodes: [...serverNodes],
      reassignments: [],
    },
    storage
  );
  const loaded = loadOutlineDraft('proj_same', storage);
  assert.ok(loaded);
  assert.equal(computeOutlineFingerprint(loaded.nodes), computeOutlineFingerprint(serverNodes));
  assert.equal(hasMeaningfulDraftDiff(loaded, serverNodes), false);
});

test('parseOutlineDraft strictly rejects corrupt JSON, wrong projectId, wrong version, and invalid nodes', () => {
  assert.equal(parseOutlineDraft('{not-valid-json', 'proj_1'), null);
  assert.equal(parseOutlineDraft(JSON.stringify({ version: 99, projectId: 'proj_1', nodes: [] }), 'proj_1'), null);
  assert.equal(
    parseOutlineDraft(
      JSON.stringify({
        version: 1,
        projectId: 'other_project',
        savedAt: '2026-11-21T10:00:00.000Z',
        nodes: makeNodes('other_project'),
      }),
      'proj_1'
    ),
    null
  );
  assert.equal(
    parseOutlineDraft(
      JSON.stringify({
        version: 1,
        projectId: 'proj_1',
        savedAt: '2026-11-21T10:00:00.000Z',
        nodes: [{ id: '', title: 'bad', nodeOrder: 1 }],
      }),
      'proj_1'
    ),
    null
  );
});
