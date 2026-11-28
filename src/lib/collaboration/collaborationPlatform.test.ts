import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {
  setForceInMemoryMasterEncyclopedia,
  resetMasterEncyclopedia,
  listMasterVolumes,
  listMasterKnowledgeUnits,
} from '../../db/masterEncyclopediaRepository.ts';
import {
  resetCollaborationStoreForTests,
  updatePlatformSettings,
  getPlatformSettings,
} from '../../db/collaborationRepository.ts';
import { isUserPersonalOutputEnabledDefault } from '../masterEncyclopedia/featureFlag.ts';
import {
  buildContributionSheetRow,
  calculateContributionScore,
  canAccessResource,
  computeContributionNovelty,
  computeTeamLeaderboard,
  validateWinolsMetadata,
} from './contributionScoring.ts';
import {
  CONTRIBUTION_SHEET_HEADERS,
  STARTER_REFERENCE_VOLUMES,
} from './platformTypes.ts';
import {
  guardPersonalProjectAiRoutes,
  requirePersonalOutputEnabled,
} from '../../middleware/personalOutputGuard.ts';
import { createCollaborationRouter } from '../../server/collaborationRoutes.ts';
import { issueGuestSession } from '../../server/guestSession.ts';
import type { AuthRequest, AuthenticatedUser } from '../../middleware/auth.ts';

function buildTestApp(mockUser: AuthenticatedUser) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => {
    (req as AuthRequest).user = mockUser;
    next();
  });

  // Personal output guarded routes (exact same middlewares used in server.ts & projectRoutes.ts)
  app.post('/api/ai/analyze', requirePersonalOutputEnabled, (_req, res) => {
    res.json({ ok: true, personalRouteReached: true });
  });
  const fakeProjectRouter = express.Router();
  fakeProjectRouter.use(guardPersonalProjectAiRoutes);
  fakeProjectRouter.post('/:id/quick-draft', (_req, res) => {
    res.json({ ok: true, reached: 'quick-draft' });
  });
  fakeProjectRouter.get('/:id', (_req, res) => {
    res.json({ ok: true, reached: 'read-only-get' });
  });
  app.use('/api/projects', fakeProjectRouter);

  // Collaborative router (replace requireAuth with injected mockUser by mounting inner stack or testing with real guest token)
  app.use('/api/collab', createCollaborationRouter());

  return app;
}

async function runHttpRequest(
  app: express.Express,
  method: string,
  path: string,
  options?: { body?: unknown; headers?: Record<string, string> }
): Promise<{ status: number; json: Record<string, unknown> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Collaborative Automotive Knowledge Platform — Core Logic & API Integration', () => {
  beforeEach(async () => {
    setForceInMemoryMasterEncyclopedia(true);
    await resetMasterEncyclopedia();
    await resetCollaborationStoreForTests();
  });

  it('defaults ENABLE_USER_PERSONAL_OUTPUT strictly to false and blocks personal AI routes with HTTP 403', async () => {
    assert.equal(isUserPersonalOutputEnabledDefault({}), false);
    assert.equal(isUserPersonalOutputEnabledDefault({ ENABLE_USER_PERSONAL_OUTPUT: 'false' }), false);
    assert.equal(isUserPersonalOutputEnabledDefault({ ENABLE_USER_PERSONAL_OUTPUT: 'true' }), true);

    const guestUser: AuthenticatedUser = {
      uid: 'guest-test-1',
      email: 'guest-test-1@guest.local',
      name: 'مهمان تست',
      isGuest: true,
    };
    const app = buildTestApp(guestUser);

    const analyzeRes = await runHttpRequest(app, 'POST', '/api/ai/analyze', { body: {} });
    assert.equal(analyzeRes.status, 403);
    assert.equal(analyzeRes.json.code, 'PERSONAL_OUTPUT_DISABLED');

    const draftRes = await runHttpRequest(app, 'POST', '/api/projects/p1/quick-draft', { body: {} });
    assert.equal(draftRes.status, 403);

    // Read-only GET route remains preserved and accessible
    const readRes = await runHttpRequest(app, 'GET', '/api/projects/p1');
    assert.equal(readRes.status, 200);

    // Verify blocked call was tracked with 0 personal output tokens
    const settings = await getPlatformSettings();
    assert.equal(settings.tokenLedger.personalOutputTokens, 0);
    assert.equal(settings.tokenLedger.zeroTokenBlockedPersonalCalls, 2);

    // Owner toggles personal output ON -> personal routes immediately unlock
    await updatePlatformSettings({ enableUserPersonalOutput: true });
    const unlockedRes = await runHttpRequest(app, 'POST', '/api/ai/analyze', { body: {} });
    assert.equal(unlockedRes.status, 200);
    assert.equal(unlockedRes.json.personalRouteReached, true);
  });

  it('enforces mandatory WinOLS 2.24 (.ols/.kp) vehicle OR ECU validation and awards bonus score', () => {
    // Missing both -> invalid
    const invalid = validateWinolsMetadata({ extension: 'ols', vehicleModel: '  ', ecuModel: '' });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errorFa?.includes('الزامی'));

    // Only ECU -> valid
    const validEcu = validateWinolsMetadata({ extension: 'kp', ecuModel: 'Bosch ME7.4.4' });
    assert.equal(validEcu.valid, true);

    // Non-WinOLS file without vehicle/ECU -> valid
    const validPdf = validateWinolsMetadata({ extension: 'pdf' });
    assert.equal(validPdf.valid, true);

    // Score calculation: duplicate/rejected = strictly 0
    assert.equal(
      calculateContributionScore({
        status: 'duplicate',
        newPercent: 0,
        newUnitsCount: 0,
        mergedUnitsCount: 0,
        fileCategory: 'ols',
        vehicleModel: '206',
        ecuModel: 'ME7.4.4',
        mapList: 'KFZW, LAMFA',
      }).score,
      0
    );

    // Non-duplicate .kp with complete metadata + mapList + bounty gets rich bonus
    const winolsScore = calculateContributionScore({
      status: 'added',
      newPercent: 100,
      newUnitsCount: 3,
      mergedUnitsCount: 0,
      fileCategory: 'kp',
      vehicleModel: 'Peugeot 206 TU5',
      ecuModel: 'Bosch ME7.4.4',
      mapList: 'KFZW, LAMFA, KFMIRL, کاتاف',
      bountyBonusScore: 80,
    });
    assert.ok(winolsScore.winolsBonus >= 90);
    assert.equal(winolsScore.bountyBonus, 80);
    assert.equal(
      winolsScore.score,
      winolsScore.baseNoveltyScore + winolsScore.winolsBonus + winolsScore.bountyBonus
    );
  });

  it('produces exact 13-column Persian Google Sheets rows, accurate novelty %, leaderboard & RBAC', () => {
    assert.equal(CONTRIBUTION_SHEET_HEADERS.length, 13);
    assert.equal(STARTER_REFERENCE_VOLUMES.length, 6);

    const partial = computeContributionNovelty({
      newUnitsCount: 2,
      mergedUnitsCount: 2,
      duplicateUnitsCount: 2,
    });
    assert.equal(partial.newPercent + partial.duplicatePercent, 100);
    assert.equal(partial.status, 'partial_merge');

    const row = buildContributionSheetRow({
      id: 'c1',
      ingestBatchId: 'b1',
      sourceUploadHash: 'abc',
      uploaderUid: 'u1',
      uploaderEmail: 'tech@example.com',
      uploaderDisplayName: 'علی فنی',
      uploaderType: 'email',
      fileName: '206_ME744.kp',
      fileExtension: 'kp',
      fileCategory: 'kp',
      vehicleModel: 'Peugeot 206',
      ecuModel: 'Bosch ME7.4.4',
      mapList: 'KFZW, LAMFA',
      detectedVolumeId: 'vol-ref-05-advanced-remap-winols',
      detectedVolumeTitle: 'جلد ۵: مفاهیم پیشرفته ریمپ',
      detectedDomain: 'remap_tuning',
      newPercent: 100,
      duplicatePercent: 0,
      newUnitsCount: 2,
      mergedUnitsCount: 0,
      duplicateUnitsCount: 0,
      status: 'added',
      statusLabelFa: 'اضافه‌شده به مرجع',
      reasonFa: 'اضافه شد',
      score: 185,
      scoreBreakdown: { baseNoveltyScore: 95, winolsBonus: 90, bountyBonus: 0 },
      bountyId: null,
      driveFileId: 'drv1',
      driveWebViewLink: 'https://drive.google.com/file/d/drv1/view',
      driveFolderPath: 'WinOLS-KP/Bosch ME7.4.4',
      sheetSynced: true,
      tokensUsed: 0,
      assetId: 'a1',
      createdAt: '2026-11-27T10:00:00.000Z',
    });
    assert.equal(row.length, 13);
    assert.equal(row[1], 'tech@example.com');
    assert.equal(row[2], 'ثبت‌شده با ایمیل');
    assert.equal(row[8], '100%');
    assert.equal(row[9], '0%');
    assert.equal(row[11], '185');
    assert.equal(row[12], 'https://drive.google.com/file/d/drv1/view');

    const lb = computeTeamLeaderboard([
      {
        id: 'c1',
        ingestBatchId: 'b1',
        sourceUploadHash: 'h1',
        uploaderUid: 'u1',
        uploaderEmail: 'a@test.com',
        uploaderDisplayName: 'مهندس الف',
        uploaderType: 'email',
        fileName: 'a.kp',
        fileExtension: 'kp',
        fileCategory: 'kp',
        vehicleModel: '206',
        ecuModel: 'ME7.4.4',
        mapList: 'KFZW',
        detectedVolumeId: 'vol-ref-05-advanced-remap-winols',
        detectedVolumeTitle: 'جلد ۵',
        detectedDomain: 'remap_tuning',
        newPercent: 100,
        duplicatePercent: 0,
        newUnitsCount: 2,
        mergedUnitsCount: 0,
        duplicateUnitsCount: 0,
        status: 'added',
        statusLabelFa: 'اضافه‌شده به مرجع',
        reasonFa: 'ok',
        score: 160,
        scoreBreakdown: { baseNoveltyScore: 70, winolsBonus: 90, bountyBonus: 0 },
        bountyId: null,
        driveFileId: null,
        driveWebViewLink: null,
        driveFolderPath: null,
        sheetSynced: false,
        tokensUsed: 0,
        assetId: null,
        createdAt: '2026-11-27T10:00:00.000Z',
      },
    ]);
    assert.equal(lb.length, 1);
    assert.equal(lb[0].rank, 1);
    assert.equal(lb[0].totalScore, 160);
    assert.ok(lb[0].specialtyBadgeFa.includes('ریمپ'));

    // Resource RBAC checks
    assert.equal(canAccessResource('open_all', { isGuest: true }, false), true);
    assert.equal(canAccessResource('email_only', { isGuest: true }, false), false);
    assert.equal(
      canAccessResource('email_only', { isGuest: false, email: 'user@site.com' }, false),
      true
    );
    assert.equal(
      canAccessResource('owner_only', { isGuest: false, email: 'user@site.com' }, false),
      false
    );
    assert.equal(canAccessResource('owner_only', { isGuest: false, email: 'owner@site.com' }, true), true);
  });

  it('executes full /api/collab workflow: 6 starter books, Gatekeeper 0-token reject, SHA-256 0-token dedup, WinOLS .ols validation, Search & RBAC', async () => {
    const guestSession = issueGuestSession();
    const authHeader = { Authorization: `Bearer ${guestSession.token}` };

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/collab', createCollaborationRouter());

    // 1. Bootstrap creates the 6 starter reference books from scratch
    const bootRes = await runHttpRequest(app, 'GET', '/api/collab/bootstrap', { headers: authHeader });
    assert.equal(bootRes.status, 200);
    assert.equal(bootRes.json.enableUserPersonalOutput, false);
    const volumes = await listMasterVolumes();
    assert.equal(volumes.length, 6);

    // 2. Non-automotive upload -> rejected with 0 tokens and score 0
    const nonAutoRes = await runHttpRequest(app, 'POST', '/api/collab/contribute', {
      headers: authHeader,
      body: {
        fileName: 'cooking_recipe.txt',
        extractedText:
          'دستور پخت قورمه سبزی مجلسی با سبزی معطر، لوبیا قرمز، لیمو عمانی و پیاز داغ برای شام خانوادگی در قابلمه مسی.',
      },
    });
    assert.equal(nonAutoRes.status, 200);
    const nonAutoContrib = nonAutoRes.json.contribution as Record<string, unknown>;
    assert.equal(nonAutoContrib.status, 'rejected');
    assert.equal(nonAutoContrib.score, 0);
    assert.equal(nonAutoContrib.tokensUsed, 0);

    // 3. Valid automotive technical text -> Delta-Merged into starter books with >0 score and 0 LLM tokens
    const autoText = [
      '# عیب‌یابی شبکه مالتی‌پلکس CAN در پژو ۲۰۶ و دنا پلاس',
      '',
      'مقاومت انتهایی شبکه CAN-High و CAN-Low در حالت خاموش بودن سوئیچ باید دقیقاً ۶۰ اهم باشد. ولتاژ پایه خط CAN-H برابر ۲.۶ ولت و خط CAN-L برابر ۲.۴ ولت است و کد خطای U0001 نشانه قطع ارتباط باس CAN است.',
    ].join('\n');

    const firstUpload = await runHttpRequest(app, 'POST', '/api/collab/contribute', {
      headers: authHeader,
      body: {
        fileName: 'can_multiplex_guide.md',
        extractedText: autoText,
        vehicleModel: 'دنا پلاس',
        ecuModel: 'BCM Multiplex',
      },
    });
    assert.equal(firstUpload.status, 201);
    const firstContrib = firstUpload.json.contribution as Record<string, unknown>;
    assert.equal(firstContrib.status, 'added');
    assert.equal(firstContrib.newPercent, 100);
    assert.equal(firstContrib.duplicatePercent, 0);
    assert.ok(Number(firstContrib.score) > 0);
    assert.equal(firstContrib.tokensUsed, 0);
    assert.equal((firstUpload.json.sheetRow as string[]).length, 13);

    // 4. Re-upload exact same file -> Script-First SHA-256 duplicate (0 tokens, 0% new, 100% duplicate, score 0)
    const dupUpload = await runHttpRequest(app, 'POST', '/api/collab/contribute', {
      headers: authHeader,
      body: {
        fileName: 'can_multiplex_guide_copy.md',
        extractedText: autoText,
      },
    });
    assert.equal(dupUpload.status, 200);
    const dupContrib = dupUpload.json.contribution as Record<string, unknown>;
    assert.equal(dupContrib.status, 'duplicate');
    assert.equal(dupContrib.newPercent, 0);
    assert.equal(dupContrib.duplicatePercent, 100);
    assert.equal(dupContrib.score, 0);
    assert.equal(dupContrib.tokensUsed, 0);

    // 5. WinOLS .ols without vehicle OR ECU -> HTTP 400 blocked
    const invalidOls = await runHttpRequest(app, 'POST', '/api/collab/contribute', {
      headers: authHeader,
      body: {
        fileName: 'project_206.ols',
        base64Data: Buffer.from('WinOLS224-ME744-KFZW-LAMFA-TEST-PAYLOAD').toString('base64'),
      },
    });
    assert.equal(invalidOls.status, 400);
    assert.equal(invalidOls.json.code, 'WINOLS_METADATA_REQUIRED');

    // 6. WinOLS .kp WITH ECU + Vehicle + MapList -> HTTP 201 with WinOLS bonus
    const validKp = await runHttpRequest(app, 'POST', '/api/collab/contribute', {
      headers: authHeader,
      body: {
        fileName: 'peugeot_206_me744.kp',
        base64Data: Buffer.from('WinOLS224-KP-ME7.4.4-0261206943-KFZW-LAMFA').toString('base64'),
        vehicleModel: 'Peugeot 206 TU5',
        ecuModel: 'Bosch ME7.4.4',
        mapList: 'KFZW, KFZW2, LAMFA, KFMIRL, کاتاف',
      },
    });
    assert.equal(validKp.status, 201);
    const kpContrib = validKp.json.contribution as Record<string, unknown>;
    assert.equal(kpContrib.status, 'added');
    assert.ok(Number(kpContrib.score) >= 120);

    // 7. Unified Search finds both reference text (U0001) and WinOLS .kp asset (ME7.4.4)
    const searchRes = await runHttpRequest(app, 'GET', '/api/collab/search?q=ME7.4.4', {
      headers: authHeader,
    });
    assert.equal(searchRes.status, 200);
    assert.ok((searchRes.json.assetMatches as unknown[]).length >= 1);

    const searchDtc = await runHttpRequest(app, 'GET', '/api/collab/search?q=U0001', {
      headers: authHeader,
    });
    assert.equal(searchDtc.status, 200);
    assert.ok((searchDtc.json.bookMatches as unknown[]).length >= 1);

    // 8. Owner settings endpoint strictly blocks non-owner / guest with 403
    const ownerBlocked = await runHttpRequest(app, 'GET', '/api/collab/owner/settings', {
      headers: authHeader,
    });
    assert.equal(ownerBlocked.status, 403);

    // 9. When Owner restricts Library to email_only, guest receives HTTP 403 on /library
    await updatePlatformSettings({ accessLibrary: 'email_only' });
    const restrictedLib = await runHttpRequest(app, 'GET', '/api/collab/library', {
      headers: authHeader,
    });
    assert.equal(restrictedLib.status, 403);

    // Ensure knowledge units were genuinely written to the starter reference volumes
    const units = await listMasterKnowledgeUnits();
    assert.ok(units.length >= 2);
  });
});
