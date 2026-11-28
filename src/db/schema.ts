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

export const projectRevisions = pgTable('project_revisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  actorType: text('actor_type').notNull(),
  actorName: text('actor_name').notNull(),
  actionType: text('action_type').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  detailsJson: jsonb('details_json').$type<Record<string, unknown>>(),
  snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
  revisions: many(projectRevisions),
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

export const projectRevisionsRelations = relations(projectRevisions, ({ one }) => ({
  project: one(projects, {
    fields: [projectRevisions.projectId],
    references: [projects.id],
  }),
}));

// ============================================================================
// MASTER AUTOMOTIVE ENCYCLOPEDIA SUBSYSTEM TABLES (PG 15/16+ & In-Memory Parity)
// ============================================================================

export const masterVolumes = pgTable('master_volumes', {
  id: text('id').primaryKey(),
  volumeNumber: integer('volume_number').notNull(),
  title: text('title').notNull(),
  automotiveDomain: text('automotive_domain').notNull(),
  wordCount: integer('word_count').notNull().default(0),
  estimatedPages: integer('estimated_pages').notNull().default(0),
  status: text('status').notNull().default('published'), // 'draft_proposal' | 'published'
  splitThresholdPages: integer('split_threshold_pages').notNull().default(500),
  splitThresholdWords: integer('split_threshold_words').notNull().default(150000),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const masterChapters = pgTable('master_chapters', {
  id: text('id').primaryKey(),
  volumeId: text('volume_id')
    .notNull()
    .references(() => masterVolumes.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  level: integer('level').notNull().default(1),
  orderIndex: integer('order_index').notNull().default(0),
  pedagogicalRank: integer('pedagogical_rank').notNull().default(1), // 1=foundation -> 5=advanced
  title: text('title').notNull(),
  shortSummary: text('short_summary'),
  wordCount: integer('word_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const masterCanonicalEntities = pgTable('master_canonical_entities', {
  id: text('id').primaryKey(), // e.g. 'ECU:BOSCH_ME7.4.4'
  entityType: text('entity_type').notNull(), // 'ecu' | 'vehicle' | 'engine' | 'protocol' | 'component'
  canonicalName: text('canonical_name').notNull(),
  aliasesJson: jsonb('aliases_json').$type<string[]>().notNull(),
  domainTag: text('domain_tag').notNull(),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const masterKnowledgeUnits = pgTable('master_knowledge_units', {
  id: text('id').primaryKey(),
  volumeId: text('volume_id')
    .notNull()
    .references(() => masterVolumes.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id')
    .notNull()
    .references(() => masterChapters.id, { onDelete: 'cascade' }),
  blockType: text('block_type').notNull().default('paragraph'),
  cleanText: text('clean_text').notNull(),
  normalizedHash: text('normalized_hash').notNull(),
  domainTag: text('domain_tag').notNull(),
  canonicalEntityId: text('canonical_entity_id'),
  verificationStatus: text('verification_status').notNull().default('verified'), // 'staging' | 'verified' | 'rejected'
  lifecycleStatus: text('lifecycle_status').notNull().default('active'), // 'active' | 'deprecated'
  supersedesUnitId: text('supersedes_unit_id'),
  corroborationCount: integer('corroboration_count').notNull().default(1),
  distinctSourceHashesJson: jsonb('distinct_source_hashes_json').$type<string[]>().notNull(),
  evidenceTier: text('evidence_tier').notNull().default('text_or_screenshot_reported'), // 'a2l_xdf_verified' | 'text_or_screenshot_reported' | 'pattern_candidate'
  ingestBatchId: text('ingest_batch_id').notNull(),
  sourceUploadHash: text('source_upload_hash').notNull(),
  technicalMetadataJson: jsonb('technical_metadata_json').$type<Record<string, unknown>>(),
  wordCount: integer('word_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const masterUnitRevisions = pgTable('master_unit_revisions', {
  id: text('id').primaryKey(),
  ingestBatchId: text('ingest_batch_id').notNull(),
  unitId: text('unit_id').notNull(),
  action: text('action').notNull(), // 'created' | 'updated' | 'merged' | 'deprecated' | 'deleted'
  previousStateJson: jsonb('previous_state_json').$type<Record<string, unknown>>(),
  newStateJson: jsonb('new_state_json').$type<Record<string, unknown>>(),
  actorEmail: text('actor_email'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const masterConflicts = pgTable('master_conflicts', {
  id: text('id').primaryKey(),
  existingUnitId: text('existing_unit_id').notNull(),
  incomingUnitId: text('incoming_unit_id'),
  conflictType: text('conflict_type').notNull(), // 'explicit_numeric' | 'implicit_conditional' | 'protocol_or_year_mismatch'
  topic: text('topic').notNull(),
  existingExcerpt: text('existing_excerpt').notNull(),
  incomingExcerpt: text('incoming_excerpt').notNull(),
  conditionContext: text('condition_context'),
  status: text('status').notNull().default('open'), // 'open' | 'approved_existing' | 'approved_incoming' | 'merged_conditional' | 'rejected'
  resolutionNote: text('resolution_note'),
  ingestBatchId: text('ingest_batch_id').notNull(),
  sourceUploadHash: text('source_upload_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const masterIngestJobs = pgTable('master_ingest_jobs', {
  id: text('id').primaryKey(),
  ingestBatchId: text('ingest_batch_id').notNull(),
  sourceUploadHash: text('source_upload_hash').notNull(),
  sourceFileName: text('source_file_name').notNull(),
  sourceFormat: text('source_format').notNull(),
  submittedByRole: text('submitted_by_role').notNull().default('user'), // 'owner' | 'user' | 'guest'
  submitterSessionHash: text('submitter_session_hash').notNull(),
  status: text('status').notNull().default('queued'), // 'queued' | 'processing' | 'completed' | 'failed' | 'dlq'
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
});

export const masterIngestLogs = pgTable('master_ingest_logs', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  ingestBatchId: text('ingest_batch_id').notNull(),
  sourceUploadHash: text('source_upload_hash').notNull(),
  sourceFileName: text('source_file_name').notNull(),
  newUnitsCount: integer('new_units_count').notNull().default(0),
  duplicateUnitsCount: integer('duplicate_units_count').notNull().default(0),
  mergedUnitsCount: integer('merged_units_count').notNull().default(0),
  conflictsCount: integer('conflicts_count').notNull().default(0),
  stagingUnitsCount: integer('staging_units_count').notNull().default(0),
  createdVolumesJson: jsonb('created_volumes_json').$type<string[]>(),
  createdChaptersJson: jsonb('created_chapters_json').$type<string[]>(),
  modelsUsedJson: jsonb('models_used_json').$type<string[]>(),
  durationMs: integer('duration_ms').notNull().default(0),
  status: text('status').notNull().default('completed'),
  summaryFa: text('summary_fa'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const masterVolumesRelations = relations(masterVolumes, ({ many }) => ({
  chapters: many(masterChapters),
  knowledgeUnits: many(masterKnowledgeUnits),
}));

export const masterChaptersRelations = relations(masterChapters, ({ one, many }) => ({
  volume: one(masterVolumes, {
    fields: [masterChapters.volumeId],
    references: [masterVolumes.id],
  }),
  knowledgeUnits: many(masterKnowledgeUnits),
}));

export const masterKnowledgeUnitsRelations = relations(masterKnowledgeUnits, ({ one }) => ({
  volume: one(masterVolumes, {
    fields: [masterKnowledgeUnits.volumeId],
    references: [masterVolumes.id],
  }),
  chapter: one(masterChapters, {
    fields: [masterKnowledgeUnits.chapterId],
    references: [masterChapters.id],
  }),
}));

// ============================================================================
// COLLABORATIVE AUTOMOTIVE KNOWLEDGE PLATFORM TABLES (PG & In-Memory Parity)
// ============================================================================

export const platformSettings = pgTable('platform_settings', {
  id: text('id').primaryKey(), // 'default'
  enableUserPersonalOutput: boolean('enable_user_personal_output').notNull().default(false),
  accessLibrary: text('access_library').notNull().default('open_all'), // 'open_all' | 'email_only' | 'owner_only'
  accessDrive: text('access_drive').notNull().default('open_all'),
  accessDocs: text('access_docs').notNull().default('open_all'),
  accessSheets: text('access_sheets').notNull().default('open_all'),
  driveRootFolderId: text('drive_root_folder_id'),
  driveRootFolderName: text('drive_root_folder_name').notNull().default('دیتابیس مرجع تخصصی خودرو'),
  sheetsSpreadsheetId: text('sheets_spreadsheet_id'),
  sheetsSpreadsheetUrl: text('sheets_spreadsheet_url'),
  sheetsTabName: text('sheets_tab_name').notNull().default('گزارش مشارکت‌ها'),
  volumeDocsJson: jsonb('volume_docs_json').$type<Record<string, unknown>>(),
  tokenLedgerJson: jsonb('token_ledger_json').$type<Record<string, unknown>>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const teamContributions = pgTable('team_contributions', {
  id: text('id').primaryKey(),
  ingestBatchId: text('ingest_batch_id'),
  sourceUploadHash: text('source_upload_hash').notNull(),
  uploaderUid: text('uploader_uid').notNull(),
  uploaderEmail: text('uploader_email').notNull(),
  uploaderDisplayName: text('uploader_display_name').notNull(),
  uploaderType: text('uploader_type').notNull().default('guest'), // 'email' | 'guest'
  fileName: text('file_name').notNull(),
  fileExtension: text('file_extension').notNull(),
  fileCategory: text('file_category').notNull(),
  vehicleModel: text('vehicle_model'),
  ecuModel: text('ecu_model'),
  mapList: text('map_list'),
  detectedVolumeId: text('detected_volume_id'),
  detectedVolumeTitle: text('detected_volume_title').notNull(),
  detectedDomain: text('detected_domain').notNull(),
  newPercent: integer('new_percent').notNull().default(0),
  duplicatePercent: integer('duplicate_percent').notNull().default(0),
  newUnitsCount: integer('new_units_count').notNull().default(0),
  mergedUnitsCount: integer('merged_units_count').notNull().default(0),
  duplicateUnitsCount: integer('duplicate_units_count').notNull().default(0),
  status: text('status').notNull(), // 'added' | 'partial_merge' | 'duplicate' | 'rejected'
  statusLabelFa: text('status_label_fa').notNull(),
  reasonFa: text('reason_fa').notNull(),
  score: integer('score').notNull().default(0),
  scoreBreakdownJson: jsonb('score_breakdown_json').$type<Record<string, unknown>>(),
  bountyId: text('bounty_id'),
  driveFileId: text('drive_file_id'),
  driveWebViewLink: text('drive_web_view_link'),
  driveFolderPath: text('drive_folder_path'),
  sheetSynced: boolean('sheet_synced').notNull().default(false),
  tokensUsed: integer('tokens_used').notNull().default(0),
  assetId: text('asset_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const knowledgeWishlist = pgTable('knowledge_wishlist', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  domainId: text('domain_id').notNull(),
  vehicleModel: text('vehicle_model'),
  ecuModel: text('ecu_model'),
  wantedFormat: text('wanted_format').notNull().default('any'),
  bonusScore: integer('bonus_score').notNull().default(60),
  status: text('status').notNull().default('open'), // 'open' | 'fulfilled'
  fulfilledByEmail: text('fulfilled_by_email'),
  fulfilledContributionId: text('fulfilled_contribution_id'),
  createdByEmail: text('created_by_email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chapterComments = pgTable('chapter_comments', {
  id: text('id').primaryKey(),
  volumeId: text('volume_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  authorUid: text('author_uid').notNull(),
  authorName: text('author_name').notNull(),
  authorEmail: text('author_email').notNull(),
  authorType: text('author_type').notNull().default('guest'),
  commentType: text('comment_type').notNull().default('comment'), // 'comment' | 'correction'
  body: text('body').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'resolved'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const teamUploadedAssets = pgTable('team_uploaded_assets', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id'),
  fileName: text('file_name').notNull(),
  fileExtension: text('file_extension').notNull(),
  fileCategory: text('file_category').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  sha256: text('sha256').notNull(),
  vehicleModel: text('vehicle_model'),
  ecuModel: text('ecu_model'),
  mapList: text('map_list'),
  domainId: text('domain_id').notNull(),
  volumeId: text('volume_id'),
  uploaderEmail: text('uploader_email').notNull(),
  uploaderDisplayName: text('uploader_display_name').notNull(),
  driveFileId: text('drive_file_id'),
  driveWebViewLink: text('drive_web_view_link'),
  driveFolderPath: text('drive_folder_path'),
  pdfBase64: text('pdf_base64'), // bounded inline PDF preview storage for internal PDF viewer
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


