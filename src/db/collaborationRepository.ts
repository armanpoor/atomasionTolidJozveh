import crypto from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, isSqlConfigured } from './index.ts';
import {
  chapterComments,
  knowledgeWishlist,
  platformSettings,
  teamContributions,
  teamUploadedAssets,
} from './schema.ts';
import {
  createMasterChapter,
  createMasterVolume,
  isMasterEncyclopediaForceInMemory,
  listMasterChapters,
  listMasterVolumes,
} from './masterEncyclopediaRepository.ts';
import { isUserPersonalOutputEnabledDefault } from '../lib/masterEncyclopedia/featureFlag.ts';
import {
  STARTER_REFERENCE_VOLUMES,
  type AccessLevel,
  type AiTokenUsageLedger,
  type ChapterCommentItem,
  type ContributionFileCategory,
  type ContributionStatus,
  type KnowledgeWishlistItem,
  type PlatformSettingsRecord,
  type TeamContributionRecord,
  type TeamUploadedAssetRecord,
  type UploaderType,
  type VolumeGoogleDocLink,
} from '../lib/collaboration/platformTypes.ts';

interface InMemoryCollabStore {
  settings: PlatformSettingsRecord | null;
  contributions: Map<string, TeamContributionRecord>;
  wishlist: Map<string, KnowledgeWishlistItem>;
  comments: Map<string, ChapterCommentItem>;
  assets: Map<string, TeamUploadedAssetRecord & { pdfBase64?: string | null }>;
  starterSeeded: boolean;
  starterVolumesEnsured: boolean;
  starterWishlistEnsured: boolean;
  ledgerQueue: Promise<unknown>;
}

const g = globalThis as unknown as {
  _inMemoryCollabStore?: InMemoryCollabStore;
};

function getStore(): InMemoryCollabStore {
  if (!g._inMemoryCollabStore) {
    g._inMemoryCollabStore = {
      settings: null,
      contributions: new Map(),
      wishlist: new Map(),
      comments: new Map(),
      assets: new Map(),
      starterSeeded: false,
      starterVolumesEnsured: false,
      starterWishlistEnsured: false,
      ledgerQueue: Promise.resolve(),
    };
  }
  return g._inMemoryCollabStore;
}

function useSql(): boolean {
  return isSqlConfigured() && !isMasterEncyclopediaForceInMemory();
}

function defaultTokenLedger(): AiTokenUsageLedger {
  return {
    personalOutputTokens: 0,
    zeroTokenBlockedPersonalCalls: 0,
    audioTranscribeTokens: 0,
    referenceRefineTokens: 0,
    zeroTokenDuplicateSaves: 0,
    zeroTokenGatekeeperRejects: 0,
    totalAiCalls: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function buildDefaultPlatformSettings(): PlatformSettingsRecord {
  return {
    id: 'default',
    enableUserPersonalOutput: isUserPersonalOutputEnabledDefault(),
    accessLibrary: 'open_all',
    accessDrive: 'open_all',
    accessDocs: 'open_all',
    accessSheets: 'open_all',
    driveRootFolderId: null,
    driveRootFolderName: 'دیتابیس مرجع تخصصی خودرو',
    sheetsSpreadsheetId: null,
    sheetsSpreadsheetUrl: null,
    sheetsTabName: 'گزارش مشارکت‌ها',
    volumeDocs: {},
    tokenLedger: defaultTokenLedger(),
    updatedAt: new Date().toISOString(),
  };
}

function toIso(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function mapSettingsRow(row: typeof platformSettings.$inferSelect): PlatformSettingsRecord {
  const rawLedger = (row.tokenLedgerJson || {}) as Partial<AiTokenUsageLedger>;
  const rawDocs = (row.volumeDocsJson || {}) as Record<string, VolumeGoogleDocLink>;
  return {
    id: row.id,
    enableUserPersonalOutput: Boolean(row.enableUserPersonalOutput),
    accessLibrary: (row.accessLibrary as AccessLevel) || 'open_all',
    accessDrive: (row.accessDrive as AccessLevel) || 'open_all',
    accessDocs: (row.accessDocs as AccessLevel) || 'open_all',
    accessSheets: (row.accessSheets as AccessLevel) || 'open_all',
    driveRootFolderId: row.driveRootFolderId ?? null,
    driveRootFolderName: row.driveRootFolderName || 'دیتابیس مرجع تخصصی خودرو',
    sheetsSpreadsheetId: row.sheetsSpreadsheetId ?? null,
    sheetsSpreadsheetUrl: row.sheetsSpreadsheetUrl ?? null,
    sheetsTabName: row.sheetsTabName || 'گزارش مشارکت‌ها',
    volumeDocs: rawDocs && typeof rawDocs === 'object' ? rawDocs : {},
    tokenLedger: {
      ...defaultTokenLedger(),
      ...rawLedger,
    },
    updatedAt: toIso(row.updatedAt),
  };
}

function mapContributionRow(row: typeof teamContributions.$inferSelect): TeamContributionRecord {
  const breakdown = (row.scoreBreakdownJson || {}) as {
    baseNoveltyScore?: number;
    winolsBonus?: number;
    bountyBonus?: number;
  };
  return {
    id: row.id,
    ingestBatchId: row.ingestBatchId ?? null,
    sourceUploadHash: row.sourceUploadHash,
    uploaderUid: row.uploaderUid,
    uploaderEmail: row.uploaderEmail,
    uploaderDisplayName: row.uploaderDisplayName,
    uploaderType: (row.uploaderType as UploaderType) || 'guest',
    fileName: row.fileName,
    fileExtension: row.fileExtension,
    fileCategory: (row.fileCategory as ContributionFileCategory) || 'text',
    vehicleModel: row.vehicleModel ?? null,
    ecuModel: row.ecuModel ?? null,
    mapList: row.mapList ?? null,
    detectedVolumeId: row.detectedVolumeId ?? null,
    detectedVolumeTitle: row.detectedVolumeTitle,
    detectedDomain: row.detectedDomain,
    newPercent: row.newPercent,
    duplicatePercent: row.duplicatePercent,
    newUnitsCount: row.newUnitsCount,
    mergedUnitsCount: row.mergedUnitsCount,
    duplicateUnitsCount: row.duplicateUnitsCount,
    status: (row.status as ContributionStatus) || 'added',
    statusLabelFa: row.statusLabelFa,
    reasonFa: row.reasonFa,
    score: row.score,
    scoreBreakdown: {
      baseNoveltyScore: Number(breakdown.baseNoveltyScore || 0),
      winolsBonus: Number(breakdown.winolsBonus || 0),
      bountyBonus: Number(breakdown.bountyBonus || 0),
    },
    bountyId: row.bountyId ?? null,
    driveFileId: row.driveFileId ?? null,
    driveWebViewLink: row.driveWebViewLink ?? null,
    driveFolderPath: row.driveFolderPath ?? null,
    sheetSynced: Boolean(row.sheetSynced),
    tokensUsed: row.tokensUsed,
    assetId: row.assetId ?? null,
    createdAt: toIso(row.createdAt),
  };
}

function mapWishlistRow(row: typeof knowledgeWishlist.$inferSelect): KnowledgeWishlistItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    domainId: row.domainId,
    vehicleModel: row.vehicleModel ?? null,
    ecuModel: row.ecuModel ?? null,
    wantedFormat: row.wantedFormat || 'any',
    bonusScore: row.bonusScore,
    status: row.status === 'fulfilled' ? 'fulfilled' : 'open',
    fulfilledByEmail: row.fulfilledByEmail ?? null,
    fulfilledContributionId: row.fulfilledContributionId ?? null,
    createdByEmail: row.createdByEmail,
    createdAt: toIso(row.createdAt),
  };
}

function mapCommentRow(row: typeof chapterComments.$inferSelect): ChapterCommentItem {
  return {
    id: row.id,
    volumeId: row.volumeId,
    chapterId: row.chapterId,
    authorUid: row.authorUid,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    authorType: (row.authorType as UploaderType) || 'guest',
    commentType: row.commentType === 'correction' ? 'correction' : 'comment',
    body: row.body,
    status: row.status === 'resolved' ? 'resolved' : 'open',
    createdAt: toIso(row.createdAt),
  };
}

function mapAssetRow(
  row: typeof teamUploadedAssets.$inferSelect
): TeamUploadedAssetRecord & { pdfBase64?: string | null } {
  return {
    id: row.id,
    contributionId: row.contributionId ?? null,
    fileName: row.fileName,
    fileExtension: row.fileExtension,
    fileCategory: (row.fileCategory as ContributionFileCategory) || 'text',
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    vehicleModel: row.vehicleModel ?? null,
    ecuModel: row.ecuModel ?? null,
    mapList: row.mapList ?? null,
    domainId: row.domainId,
    volumeId: row.volumeId ?? null,
    uploaderEmail: row.uploaderEmail,
    uploaderDisplayName: row.uploaderDisplayName,
    driveFileId: row.driveFileId ?? null,
    driveWebViewLink: row.driveWebViewLink ?? null,
    driveFolderPath: row.driveFolderPath ?? null,
    hasLocalPdfPreview: Boolean(row.pdfBase64),
    pdfBase64: row.pdfBase64 ?? null,
    createdAt: toIso(row.createdAt),
  };
}

export async function resetCollaborationStoreForTests(): Promise<void> {
  const store = getStore();
  store.settings = null;
  store.contributions.clear();
  store.wishlist.clear();
  store.comments.clear();
  store.assets.clear();
  store.starterSeeded = false;
  store.starterVolumesEnsured = false;
  store.starterWishlistEnsured = false;
  store.ledgerQueue = Promise.resolve();
}

// ============================================================================
// PLATFORM SETTINGS & TOKEN LEDGER
// ============================================================================

export async function getPlatformSettings(): Promise<PlatformSettingsRecord> {
  const store = getStore();
  if (!useSql()) {
    if (!store.settings) {
      store.settings = buildDefaultPlatformSettings();
    }
    return store.settings;
  }

  try {
    const rows = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.id, 'default'))
      .limit(1);
    if (rows.length > 0) {
      const mapped = mapSettingsRow(rows[0]);
      store.settings = mapped;
      return mapped;
    }

    const defaults = buildDefaultPlatformSettings();
    const [inserted] = await db
      .insert(platformSettings)
      .values({
        id: defaults.id,
        enableUserPersonalOutput: defaults.enableUserPersonalOutput,
        accessLibrary: defaults.accessLibrary,
        accessDrive: defaults.accessDrive,
        accessDocs: defaults.accessDocs,
        accessSheets: defaults.accessSheets,
        driveRootFolderId: defaults.driveRootFolderId,
        driveRootFolderName: defaults.driveRootFolderName,
        sheetsSpreadsheetId: defaults.sheetsSpreadsheetId,
        sheetsSpreadsheetUrl: defaults.sheetsSpreadsheetUrl,
        sheetsTabName: defaults.sheetsTabName,
        volumeDocsJson: defaults.volumeDocs as unknown as Record<string, unknown>,
        tokenLedgerJson: defaults.tokenLedger as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning();

    const result = inserted ? mapSettingsRow(inserted) : defaults;
    store.settings = result;
    return result;
  } catch (err) {
    console.warn('[CollaborationRepo] Falling back to in-memory settings:', err);
    if (!store.settings) {
      store.settings = buildDefaultPlatformSettings();
    }
    return store.settings;
  }
}

export async function updatePlatformSettings(
  patch: Partial<{
    enableUserPersonalOutput: boolean;
    accessLibrary: AccessLevel;
    accessDrive: AccessLevel;
    accessDocs: AccessLevel;
    accessSheets: AccessLevel;
    driveRootFolderId: string | null;
    driveRootFolderName: string;
    sheetsSpreadsheetId: string | null;
    sheetsSpreadsheetUrl: string | null;
    sheetsTabName: string;
    volumeDocs: Record<string, VolumeGoogleDocLink>;
    tokenLedger: AiTokenUsageLedger;
  }>
): Promise<PlatformSettingsRecord> {
  const current = await getPlatformSettings();
  const next: PlatformSettingsRecord = {
    ...current,
    ...patch,
    volumeDocs: patch.volumeDocs ?? current.volumeDocs,
    tokenLedger: patch.tokenLedger ?? current.tokenLedger,
    updatedAt: new Date().toISOString(),
  };

  const store = getStore();
  store.settings = next;

  if (!useSql()) {
    return next;
  }

  try {
    await db
      .insert(platformSettings)
      .values({
        id: 'default',
        enableUserPersonalOutput: next.enableUserPersonalOutput,
        accessLibrary: next.accessLibrary,
        accessDrive: next.accessDrive,
        accessDocs: next.accessDocs,
        accessSheets: next.accessSheets,
        driveRootFolderId: next.driveRootFolderId,
        driveRootFolderName: next.driveRootFolderName,
        sheetsSpreadsheetId: next.sheetsSpreadsheetId,
        sheetsSpreadsheetUrl: next.sheetsSpreadsheetUrl,
        sheetsTabName: next.sheetsTabName,
        volumeDocsJson: next.volumeDocs as unknown as Record<string, unknown>,
        tokenLedgerJson: next.tokenLedger as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: {
          enableUserPersonalOutput: next.enableUserPersonalOutput,
          accessLibrary: next.accessLibrary,
          accessDrive: next.accessDrive,
          accessDocs: next.accessDocs,
          accessSheets: next.accessSheets,
          driveRootFolderId: next.driveRootFolderId,
          driveRootFolderName: next.driveRootFolderName,
          sheetsSpreadsheetId: next.sheetsSpreadsheetId,
          sheetsSpreadsheetUrl: next.sheetsSpreadsheetUrl,
          sheetsTabName: next.sheetsTabName,
          volumeDocsJson: next.volumeDocs as unknown as Record<string, unknown>,
          tokenLedgerJson: next.tokenLedger as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn('[CollaborationRepo] updatePlatformSettings SQL write fallback:', err);
  }

  return next;
}

export async function recordTokenLedgerDelta(delta: {
  personalOutputTokens?: number;
  zeroTokenBlockedPersonalCalls?: number;
  audioTranscribeTokens?: number;
  referenceRefineTokens?: number;
  zeroTokenDuplicateSaves?: number;
  zeroTokenGatekeeperRejects?: number;
  totalAiCalls?: number;
}): Promise<AiTokenUsageLedger> {
  const store = getStore();
  const run = async (): Promise<AiTokenUsageLedger> => {
    const nowIso = new Date().toISOString();
    const dPersonal = delta.personalOutputTokens || 0;
    const dBlocked = delta.zeroTokenBlockedPersonalCalls || 0;
    const dAudio = delta.audioTranscribeTokens || 0;
    const dRefine = delta.referenceRefineTokens || 0;
    const dDupSaves = delta.zeroTokenDuplicateSaves || 0;
    const dGateRejects = delta.zeroTokenGatekeeperRejects || 0;
    const dTotalCalls = delta.totalAiCalls || 0;

    // Ensure settings row exists first
    const current = await getPlatformSettings();

    if (useSql()) {
      try {
        const [updatedRow] = await db
          .update(platformSettings)
          .set({
            tokenLedgerJson: sql`jsonb_build_object(
              'personalOutputTokens', COALESCE((${platformSettings.tokenLedgerJson}->>'personalOutputTokens')::bigint, 0) + CAST(${dPersonal} AS bigint),
              'zeroTokenBlockedPersonalCalls', COALESCE((${platformSettings.tokenLedgerJson}->>'zeroTokenBlockedPersonalCalls')::bigint, 0) + CAST(${dBlocked} AS bigint),
              'audioTranscribeTokens', COALESCE((${platformSettings.tokenLedgerJson}->>'audioTranscribeTokens')::bigint, 0) + CAST(${dAudio} AS bigint),
              'referenceRefineTokens', COALESCE((${platformSettings.tokenLedgerJson}->>'referenceRefineTokens')::bigint, 0) + CAST(${dRefine} AS bigint),
              'zeroTokenDuplicateSaves', COALESCE((${platformSettings.tokenLedgerJson}->>'zeroTokenDuplicateSaves')::bigint, 0) + CAST(${dDupSaves} AS bigint),
              'zeroTokenGatekeeperRejects', COALESCE((${platformSettings.tokenLedgerJson}->>'zeroTokenGatekeeperRejects')::bigint, 0) + CAST(${dGateRejects} AS bigint),
              'totalAiCalls', COALESCE((${platformSettings.tokenLedgerJson}->>'totalAiCalls')::bigint, 0) + CAST(${dTotalCalls} AS bigint),
              'lastUpdatedAt', CAST(${nowIso} AS text)
            )`,
            updatedAt: new Date(),
          })
          .where(eq(platformSettings.id, 'default'))
          .returning();
        if (updatedRow) {
          const mapped = mapSettingsRow(updatedRow);
          store.settings = mapped;
          return mapped.tokenLedger;
        }
      } catch (err) {
        console.warn('[CollaborationRepo] Atomic SQL token ledger update fallback:', err);
      }
    }

    const nextLedger: AiTokenUsageLedger = {
      personalOutputTokens: current.tokenLedger.personalOutputTokens + dPersonal,
      zeroTokenBlockedPersonalCalls: current.tokenLedger.zeroTokenBlockedPersonalCalls + dBlocked,
      audioTranscribeTokens: current.tokenLedger.audioTranscribeTokens + dAudio,
      referenceRefineTokens: current.tokenLedger.referenceRefineTokens + dRefine,
      zeroTokenDuplicateSaves: current.tokenLedger.zeroTokenDuplicateSaves + dDupSaves,
      zeroTokenGatekeeperRejects: current.tokenLedger.zeroTokenGatekeeperRejects + dGateRejects,
      totalAiCalls: current.tokenLedger.totalAiCalls + dTotalCalls,
      lastUpdatedAt: nowIso,
    };

    await updatePlatformSettings({ tokenLedger: nextLedger });
    return nextLedger;
  };

  const task = store.ledgerQueue.then(run, run);
  store.ledgerQueue = task.catch(() => undefined);
  return task;
}

// ============================================================================
// STARTER 6 REFERENCE VOLUMES & INITIAL WISHLIST BOOTSTRAP (IDEMPOTENT)
// ============================================================================

export async function ensureStarterReferenceVolumes(): Promise<void> {
  const store = getStore();
  if (store.starterVolumesEnsured) {
    const existingCheck = await listMasterVolumes();
    if (existingCheck.length >= STARTER_REFERENCE_VOLUMES.length) {
      return;
    }
  }

  const existingVolumes = await listMasterVolumes();
  const byId = new Map(existingVolumes.map((v) => [v.id, v]));
  const byDomain = new Map(existingVolumes.map((v) => [v.automotiveDomain, v]));

  for (const spec of STARTER_REFERENCE_VOLUMES) {
    let targetVol = byId.get(spec.id) || byDomain.get(spec.automotiveDomain);

    if (!targetVol) {
      targetVol = await createMasterVolume({
        id: spec.id,
        volumeNumber: spec.volumeNumber,
        title: spec.title,
        automotiveDomain: spec.automotiveDomain,
        status: 'published',
        description: spec.description,
      });
    }

    const existingChapters = await listMasterChapters(targetVol.id);
    if (existingChapters.length === 0) {
      for (let i = 0; i < spec.starterChapters.length; i++) {
        const ch = spec.starterChapters[i];
        await createMasterChapter({
          id: `${targetVol.id}-ch-${i + 1}`,
          volumeId: targetVol.id,
          level: 1,
          orderIndex: i + 1,
          pedagogicalRank: ch.pedagogicalRank,
          title: ch.title,
          shortSummary: ch.shortSummary,
        });
      }
    }
  }

  store.starterVolumesEnsured = true;
}

const DEFAULT_WISHLIST_SEED: Array<
  Omit<KnowledgeWishlistItem, 'id' | 'status' | 'fulfilledByEmail' | 'fulfilledContributionId' | 'createdAt'>
> = [
  {
    title: 'فایل .ols یا .kp برای ECU Bosch ME7.4.4 (پژو ۲۰۶ تیپ ۵ / TU5)',
    description:
      'نیاز به مپ‌پک WinOLS 2.24 شامل جداول جرقه (KFZW)، سوخت (LAMFA) و کاتاف به همراه آدرس‌های دقیق برای تکمیل جلد ۵.',
    domainId: 'remap_tuning',
    vehicleModel: 'Peugeot 206 TU5',
    ecuModel: 'Bosch ME7.4.4',
    wantedFormat: 'kp',
    bonusScore: 80,
    createdByEmail: 'hossein.roosta.90@gmail.com',
  },
  {
    title: 'نقشه کامل شبکه مالتی‌پلکس CAN / BSI دنا پلاس و رانا پلاس',
    description:
      'جزوه یا PDF پین‌اوت نودهای مالتی‌پلکس (BCM/CBM/FN)، مقاومت انتهایی و عیب‌یابی قطع ارتباط شبکه CAN.',
    domainId: 'electrical_networks',
    vehicleModel: 'دنا پلاس / رانا پلاس',
    ecuModel: 'BCM / CBM Multiplex',
    wantedFormat: 'pdf',
    bonusScore: 60,
    createdByEmail: 'hossein.roosta.90@gmail.com',
  },
  {
    title: 'داموس یا پروژه .ols برای Siemens/Continental SIM2K-241 / SIM2K-34',
    description:
      'فایل WinOLS 2.24 شامل جداول گشتاور، دریچه گاز برقی و محدودکننده سرعت برای خودروهای هیوندای/کیا یا سمند EF7.',
    domainId: 'remap_tuning',
    vehicleModel: 'Hyundai / Kia / EF7',
    ecuModel: 'Siemens SIM2K',
    wantedFormat: 'ols',
    bonusScore: 90,
    createdByEmail: 'hossein.roosta.90@gmail.com',
  },
];

export async function ensureStarterWishlist(): Promise<void> {
  const store = getStore();
  if (store.starterWishlistEnsured) return;

  const current = await listWishlistItems();
  if (current.length > 0) {
    store.starterWishlistEnsured = true;
    return;
  }

  for (const item of DEFAULT_WISHLIST_SEED) {
    await createWishlistItem(item);
  }
  store.starterWishlistEnsured = true;
}

// ============================================================================
// TEAM CONTRIBUTIONS CRUD & SHA-256 DEDUPLICATION
// ============================================================================

export async function findAcceptedContributionBySourceHash(
  sourceUploadHash: string
): Promise<TeamContributionRecord | null> {
  const store = getStore();
  if (!useSql()) {
    for (const c of store.contributions.values()) {
      if (
        c.sourceUploadHash === sourceUploadHash &&
        (c.status === 'added' || c.status === 'partial_merge')
      ) {
        return c;
      }
    }
    return null;
  }

  try {
    const rows = await db
      .select()
      .from(teamContributions)
      .where(
        and(
          eq(teamContributions.sourceUploadHash, sourceUploadHash),
          inArray(teamContributions.status, ['added', 'partial_merge'])
        )
      )
      .orderBy(desc(teamContributions.createdAt))
      .limit(1);
    return rows[0] ? mapContributionRow(rows[0]) : null;
  } catch {
    for (const c of store.contributions.values()) {
      if (
        c.sourceUploadHash === sourceUploadHash &&
        (c.status === 'added' || c.status === 'partial_merge')
      ) {
        return c;
      }
    }
    return null;
  }
}

export async function createTeamContribution(
  input: Omit<TeamContributionRecord, 'id' | 'createdAt'> & { id?: string }
): Promise<TeamContributionRecord> {
  const id = input.id || `contrib-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const record: TeamContributionRecord = {
    ...input,
    id,
    createdAt,
  };

  const store = getStore();
  store.contributions.set(id, record);

  if (!useSql()) {
    return record;
  }

  try {
    await db.insert(teamContributions).values({
      id: record.id,
      ingestBatchId: record.ingestBatchId,
      sourceUploadHash: record.sourceUploadHash,
      uploaderUid: record.uploaderUid,
      uploaderEmail: record.uploaderEmail,
      uploaderDisplayName: record.uploaderDisplayName,
      uploaderType: record.uploaderType,
      fileName: record.fileName,
      fileExtension: record.fileExtension,
      fileCategory: record.fileCategory,
      vehicleModel: record.vehicleModel,
      ecuModel: record.ecuModel,
      mapList: record.mapList,
      detectedVolumeId: record.detectedVolumeId,
      detectedVolumeTitle: record.detectedVolumeTitle,
      detectedDomain: record.detectedDomain,
      newPercent: record.newPercent,
      duplicatePercent: record.duplicatePercent,
      newUnitsCount: record.newUnitsCount,
      mergedUnitsCount: record.mergedUnitsCount,
      duplicateUnitsCount: record.duplicateUnitsCount,
      status: record.status,
      statusLabelFa: record.statusLabelFa,
      reasonFa: record.reasonFa,
      score: record.score,
      scoreBreakdownJson: record.scoreBreakdown as unknown as Record<string, unknown>,
      bountyId: record.bountyId,
      driveFileId: record.driveFileId,
      driveWebViewLink: record.driveWebViewLink,
      driveFolderPath: record.driveFolderPath,
      sheetSynced: record.sheetSynced,
      tokensUsed: record.tokensUsed,
      assetId: record.assetId,
    });
  } catch (err) {
    console.warn('[CollaborationRepo] createTeamContribution SQL fallback:', err);
  }

  return record;
}

export async function listTeamContributions(limit = 200): Promise<TeamContributionRecord[]> {
  const store = getStore();
  if (!useSql()) {
    return Array.from(store.contributions.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  try {
    const rows = await db
      .select()
      .from(teamContributions)
      .orderBy(desc(teamContributions.createdAt))
      .limit(limit);
    return rows.map(mapContributionRow);
  } catch {
    return Array.from(store.contributions.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

export async function getTeamContributionById(
  id: string
): Promise<TeamContributionRecord | null> {
  const store = getStore();
  if (!useSql()) {
    return store.contributions.get(id) ?? null;
  }

  try {
    const rows = await db
      .select()
      .from(teamContributions)
      .where(eq(teamContributions.id, id))
      .limit(1);
    return rows[0] ? mapContributionRow(rows[0]) : null;
  } catch {
    return store.contributions.get(id) ?? null;
  }
}

export async function updateTeamContributionWorkspaceSync(
  id: string,
  patch: Partial<{
    driveFileId: string | null;
    driveWebViewLink: string | null;
    driveFolderPath: string | null;
    sheetSynced: boolean;
  }>
): Promise<TeamContributionRecord | null> {
  const existing = await getTeamContributionById(id);
  if (!existing) return null;

  const updated: TeamContributionRecord = {
    ...existing,
    driveFileId: patch.driveFileId !== undefined ? patch.driveFileId : existing.driveFileId,
    driveWebViewLink:
      patch.driveWebViewLink !== undefined ? patch.driveWebViewLink : existing.driveWebViewLink,
    driveFolderPath:
      patch.driveFolderPath !== undefined ? patch.driveFolderPath : existing.driveFolderPath,
    sheetSynced: patch.sheetSynced !== undefined ? patch.sheetSynced : existing.sheetSynced,
  };

  const store = getStore();
  store.contributions.set(id, updated);

  if (existing.assetId && (patch.driveFileId || patch.driveWebViewLink)) {
    await updateTeamAssetDriveInfo(existing.assetId, {
      driveFileId: updated.driveFileId,
      driveWebViewLink: updated.driveWebViewLink,
      driveFolderPath: updated.driveFolderPath,
    });
  }

  if (!useSql()) {
    return updated;
  }

  try {
    await db
      .update(teamContributions)
      .set({
        driveFileId: updated.driveFileId,
        driveWebViewLink: updated.driveWebViewLink,
        driveFolderPath: updated.driveFolderPath,
        sheetSynced: updated.sheetSynced,
      })
      .where(eq(teamContributions.id, id));
  } catch (err) {
    console.warn('[CollaborationRepo] updateTeamContributionWorkspaceSync SQL fallback:', err);
  }

  return updated;
}

// ============================================================================
// TEAM UPLOADED ASSETS (DRIVE INDEX + INTERNAL PDF VIEWER)
// ============================================================================

export async function createTeamUploadedAsset(
  input: Omit<TeamUploadedAssetRecord, 'id' | 'createdAt' | 'hasLocalPdfPreview'> & {
    id?: string;
    pdfBase64?: string | null;
  }
): Promise<TeamUploadedAssetRecord> {
  const id = input.id || `asset-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const hasLocalPdfPreview = Boolean(input.pdfBase64 && input.pdfBase64.length > 0);
  const fullRecord: TeamUploadedAssetRecord & { pdfBase64?: string | null } = {
    id,
    contributionId: input.contributionId,
    fileName: input.fileName,
    fileExtension: input.fileExtension,
    fileCategory: input.fileCategory,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    vehicleModel: input.vehicleModel,
    ecuModel: input.ecuModel,
    mapList: input.mapList,
    domainId: input.domainId,
    volumeId: input.volumeId,
    uploaderEmail: input.uploaderEmail,
    uploaderDisplayName: input.uploaderDisplayName,
    driveFileId: input.driveFileId,
    driveWebViewLink: input.driveWebViewLink,
    driveFolderPath: input.driveFolderPath,
    hasLocalPdfPreview,
    pdfBase64: input.pdfBase64 ?? null,
    createdAt,
  };

  const store = getStore();
  store.assets.set(id, fullRecord);

  if (useSql()) {
    try {
      await db.insert(teamUploadedAssets).values({
        id: fullRecord.id,
        contributionId: fullRecord.contributionId,
        fileName: fullRecord.fileName,
        fileExtension: fullRecord.fileExtension,
        fileCategory: fullRecord.fileCategory,
        mimeType: fullRecord.mimeType,
        sizeBytes: fullRecord.sizeBytes,
        sha256: fullRecord.sha256,
        vehicleModel: fullRecord.vehicleModel,
        ecuModel: fullRecord.ecuModel,
        mapList: fullRecord.mapList,
        domainId: fullRecord.domainId,
        volumeId: fullRecord.volumeId,
        uploaderEmail: fullRecord.uploaderEmail,
        uploaderDisplayName: fullRecord.uploaderDisplayName,
        driveFileId: fullRecord.driveFileId,
        driveWebViewLink: fullRecord.driveWebViewLink,
        driveFolderPath: fullRecord.driveFolderPath,
        pdfBase64: fullRecord.pdfBase64 ?? null,
      });
    } catch (err) {
      console.warn('[CollaborationRepo] createTeamUploadedAsset SQL fallback:', err);
    }
  }

  const { pdfBase64: _omit, ...publicRecord } = fullRecord;
  return publicRecord;
}

export async function listTeamUploadedAssets(limit = 300): Promise<TeamUploadedAssetRecord[]> {
  const store = getStore();
  if (!useSql()) {
    return Array.from(store.assets.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(({ pdfBase64: _omit, ...rest }) => rest);
  }

  try {
    const rows = await db
      .select()
      .from(teamUploadedAssets)
      .orderBy(desc(teamUploadedAssets.createdAt))
      .limit(limit);
    return rows.map((r) => {
      const { pdfBase64: _omit, ...rest } = mapAssetRow(r);
      return rest;
    });
  } catch {
    return Array.from(store.assets.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(({ pdfBase64: _omit, ...rest }) => rest);
  }
}

export async function getTeamUploadedAssetWithPdf(
  id: string
): Promise<(TeamUploadedAssetRecord & { pdfBase64?: string | null }) | null> {
  const store = getStore();
  if (!useSql()) {
    return store.assets.get(id) ?? null;
  }

  try {
    const rows = await db
      .select()
      .from(teamUploadedAssets)
      .where(eq(teamUploadedAssets.id, id))
      .limit(1);
    return rows[0] ? mapAssetRow(rows[0]) : null;
  } catch {
    return store.assets.get(id) ?? null;
  }
}

export async function updateTeamAssetDriveInfo(
  id: string,
  patch: {
    driveFileId: string | null;
    driveWebViewLink: string | null;
    driveFolderPath: string | null;
  }
): Promise<void> {
  const store = getStore();
  const inMem = store.assets.get(id);
  if (inMem) {
    store.assets.set(id, {
      ...inMem,
      driveFileId: patch.driveFileId,
      driveWebViewLink: patch.driveWebViewLink,
      driveFolderPath: patch.driveFolderPath,
    });
  }

  if (!useSql()) return;
  try {
    await db
      .update(teamUploadedAssets)
      .set({
        driveFileId: patch.driveFileId,
        driveWebViewLink: patch.driveWebViewLink,
        driveFolderPath: patch.driveFolderPath,
      })
      .where(eq(teamUploadedAssets.id, id));
  } catch (err) {
    console.warn('[CollaborationRepo] updateTeamAssetDriveInfo SQL fallback:', err);
  }
}

// ============================================================================
// KNOWLEDGE WISHLIST / BOUNTIES
// ============================================================================

export async function listWishlistItems(): Promise<KnowledgeWishlistItem[]> {
  const store = getStore();
  if (!useSql()) {
    return Array.from(store.wishlist.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  try {
    const rows = await db
      .select()
      .from(knowledgeWishlist)
      .orderBy(desc(knowledgeWishlist.createdAt));
    return rows.map(mapWishlistRow);
  } catch {
    return Array.from(store.wishlist.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
}

export async function getWishlistItemById(id: string): Promise<KnowledgeWishlistItem | null> {
  const store = getStore();
  if (!useSql()) {
    return store.wishlist.get(id) ?? null;
  }

  try {
    const rows = await db
      .select()
      .from(knowledgeWishlist)
      .where(eq(knowledgeWishlist.id, id))
      .limit(1);
    return rows[0] ? mapWishlistRow(rows[0]) : null;
  } catch {
    return store.wishlist.get(id) ?? null;
  }
}

export async function createWishlistItem(
  input: Omit<
    KnowledgeWishlistItem,
    'id' | 'status' | 'fulfilledByEmail' | 'fulfilledContributionId' | 'createdAt'
  >
): Promise<KnowledgeWishlistItem> {
  const id = `wish-${crypto.randomUUID()}`;
  const record: KnowledgeWishlistItem = {
    ...input,
    id,
    status: 'open',
    fulfilledByEmail: null,
    fulfilledContributionId: null,
    createdAt: new Date().toISOString(),
  };

  const store = getStore();
  store.wishlist.set(id, record);

  if (useSql()) {
    try {
      await db.insert(knowledgeWishlist).values({
        id: record.id,
        title: record.title,
        description: record.description,
        domainId: record.domainId,
        vehicleModel: record.vehicleModel,
        ecuModel: record.ecuModel,
        wantedFormat: record.wantedFormat,
        bonusScore: record.bonusScore,
        status: record.status,
        fulfilledByEmail: null,
        fulfilledContributionId: null,
        createdByEmail: record.createdByEmail,
      });
    } catch (err) {
      console.warn('[CollaborationRepo] createWishlistItem SQL fallback:', err);
    }
  }

  return record;
}

export async function markWishlistFulfilled(
  id: string,
  fulfilledByEmail: string,
  fulfilledContributionId: string
): Promise<KnowledgeWishlistItem | null> {
  const store = getStore();
  if (!useSql()) {
    const existing = store.wishlist.get(id);
    if (!existing || existing.status !== 'open') return null;
    const updated: KnowledgeWishlistItem = {
      ...existing,
      status: 'fulfilled',
      fulfilledByEmail,
      fulfilledContributionId,
    };
    store.wishlist.set(id, updated);
    return updated;
  }

  try {
    const [claimed] = await db
      .update(knowledgeWishlist)
      .set({
        status: 'fulfilled',
        fulfilledByEmail,
        fulfilledContributionId,
      })
      .where(and(eq(knowledgeWishlist.id, id), eq(knowledgeWishlist.status, 'open')))
      .returning();
    if (!claimed) return null;
    const mapped = mapWishlistRow(claimed);
    store.wishlist.set(id, mapped);
    return mapped;
  } catch (err) {
    console.warn('[CollaborationRepo] markWishlistFulfilled SQL fallback:', err);
    const existing = store.wishlist.get(id);
    if (!existing || existing.status !== 'open') return null;
    const updated: KnowledgeWishlistItem = {
      ...existing,
      status: 'fulfilled',
      fulfilledByEmail,
      fulfilledContributionId,
    };
    store.wishlist.set(id, updated);
    return updated;
  }
}

export async function deleteWishlistItem(id: string): Promise<boolean> {
  const store = getStore();
  store.wishlist.delete(id);

  if (useSql()) {
    try {
      await db.delete(knowledgeWishlist).where(eq(knowledgeWishlist.id, id));
    } catch (err) {
      console.warn('[CollaborationRepo] deleteWishlistItem SQL fallback:', err);
    }
  }

  return true;
}

// ============================================================================
// CHAPTER COMMENTS & CORRECTION SUGGESTIONS
// ============================================================================

export async function listChapterComments(chapterId: string): Promise<ChapterCommentItem[]> {
  const store = getStore();
  if (!useSql()) {
    return Array.from(store.comments.values())
      .filter((c) => c.chapterId === chapterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  try {
    const rows = await db
      .select()
      .from(chapterComments)
      .where(eq(chapterComments.chapterId, chapterId))
      .orderBy(desc(chapterComments.createdAt));
    return rows.map(mapCommentRow);
  } catch {
    return Array.from(store.comments.values())
      .filter((c) => c.chapterId === chapterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export async function createChapterComment(
  input: Omit<ChapterCommentItem, 'id' | 'status' | 'createdAt'>
): Promise<ChapterCommentItem> {
  const id = `comment-${crypto.randomUUID()}`;
  const record: ChapterCommentItem = {
    ...input,
    id,
    status: 'open',
    createdAt: new Date().toISOString(),
  };

  const store = getStore();
  store.comments.set(id, record);

  if (useSql()) {
    try {
      await db.insert(chapterComments).values({
        id: record.id,
        volumeId: record.volumeId,
        chapterId: record.chapterId,
        authorUid: record.authorUid,
        authorName: record.authorName,
        authorEmail: record.authorEmail,
        authorType: record.authorType,
        commentType: record.commentType,
        body: record.body,
        status: record.status,
      });
    } catch (err) {
      console.warn('[CollaborationRepo] createChapterComment SQL fallback:', err);
    }
  }

  return record;
}

export async function resolveChapterComment(id: string): Promise<ChapterCommentItem | null> {
  const store = getStore();
  const inMem = store.comments.get(id);
  if (inMem) {
    store.comments.set(id, { ...inMem, status: 'resolved' });
  }

  if (useSql()) {
    try {
      const [row] = await db
        .update(chapterComments)
        .set({ status: 'resolved' })
        .where(eq(chapterComments.id, id))
        .returning();
      return row ? mapCommentRow(row) : inMem ? { ...inMem, status: 'resolved' } : null;
    } catch {
      return inMem ? { ...inMem, status: 'resolved' } : null;
    }
  }

  return inMem ? { ...inMem, status: 'resolved' } : null;
}
