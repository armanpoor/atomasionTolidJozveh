import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  photoUrl: text('photo_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  ownerUid: text('owner_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  workflowMode: text('workflow_mode').notNull().default('multi_merge'),
  pipelineStage: integer('pipeline_stage').notNull().default(1),
  status: text('status').notNull().default('draft'),
  settingsJson: jsonb('settings_json').$type<Record<string, unknown>>(),
  checkpointJson: jsonb('checkpoint_json').$type<Record<string, unknown>>(),
  bookSnapshotJson: jsonb('book_snapshot_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sourceFiles = pgTable('source_files', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  format: text('format').notNull(),
  role: text('role').notNull().default('standard'),
  wordCount: integer('word_count').notNull().default(0),
  sizeBytes: integer('size_bytes').notNull().default(0),
  fileHash: text('file_hash').notNull(),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
});

export const contentUnits = pgTable('content_units', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  sourceFileId: text('source_file_id')
    .notNull()
    .references(() => sourceFiles.id, { onDelete: 'cascade' }),
  unitType: text('unit_type').notNull(),
  unitOrder: integer('unit_order').notNull(),
  rawText: text('raw_text').notNull(),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  contentHash: text('content_hash').notNull(),
  status: text('status').notNull().default('unique'),
  canonicalUnitId: text('canonical_unit_id'),
  outlineNodeId: text('outline_node_id'),
});

export const dedupClusters = pgTable('dedup_clusters', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  canonicalUnitId: text('canonical_unit_id').notNull(),
  mergedUnitId: text('merged_unit_id').notNull(),
  matchType: text('match_type').notNull(),
  similarityScore: real('similarity_score').notNull().default(1),
  mergeRationale: text('merge_rationale'),
  preservedDetailsJson: jsonb('preserved_details_json').$type<Record<string, unknown>>(),
});

export const conflicts = pgTable('conflicts', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  unitAId: text('unit_a_id').notNull(),
  unitBId: text('unit_b_id').notNull(),
  fileAName: text('file_a_name').notNull(),
  fileBName: text('file_b_name').notNull(),
  excerptA: text('excerpt_a').notNull(),
  excerptB: text('excerpt_b').notNull(),
  status: text('status').notNull().default('open'),
  resolutionNote: text('resolution_note'),
  webGroundingJson: jsonb('web_grounding_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const outlineNodes = pgTable('outline_nodes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  level: integer('level').notNull().default(1),
  nodeOrder: integer('node_order').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  isApproved: boolean('is_approved').notNull().default(false),
  webEnrichmentJson: jsonb('web_enrichment_json').$type<Record<string, unknown>>(),
});

export const auditReports = pgTable('audit_reports', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  totalSourceFiles: integer('total_source_files').notNull().default(0),
  totalInputUnits: integer('total_input_units').notNull().default(0),
  uniqueUnitsCount: integer('unique_units_count').notNull().default(0),
  mergedDuplicatesCount: integer('merged_duplicates_count').notNull().default(0),
  conflictsCount: integer('conflicts_count').notNull().default(0),
  coveragePercent: real('coverage_percent').notNull().default(100),
  sourceTraceJson: jsonb('source_trace_json').$type<Record<string, unknown>>(),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerUid],
    references: [users.uid],
  }),
  sourceFiles: many(sourceFiles),
  contentUnits: many(contentUnits),
  dedupClusters: many(dedupClusters),
  conflicts: many(conflicts),
  outlineNodes: many(outlineNodes),
  auditReports: many(auditReports),
}));

export const sourceFilesRelations = relations(sourceFiles, ({ one, many }) => ({
  project: one(projects, {
    fields: [sourceFiles.projectId],
    references: [projects.id],
  }),
  contentUnits: many(contentUnits),
}));

export const contentUnitsRelations = relations(contentUnits, ({ one }) => ({
  project: one(projects, {
    fields: [contentUnits.projectId],
    references: [projects.id],
  }),
  sourceFile: one(sourceFiles, {
    fields: [contentUnits.sourceFileId],
    references: [sourceFiles.id],
  }),
}));

export const dedupClustersRelations = relations(dedupClusters, ({ one }) => ({
  project: one(projects, {
    fields: [dedupClusters.projectId],
    references: [projects.id],
  }),
}));

export const conflictsRelations = relations(conflicts, ({ one }) => ({
  project: one(projects, {
    fields: [conflicts.projectId],
    references: [projects.id],
  }),
}));

export const outlineNodesRelations = relations(outlineNodes, ({ one }) => ({
  project: one(projects, {
    fields: [outlineNodes.projectId],
    references: [projects.id],
  }),
}));

export const auditReportsRelations = relations(auditReports, ({ one }) => ({
  project: one(projects, {
    fields: [auditReports.projectId],
    references: [projects.id],
  }),
}));
