import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import {
  clearInMemoryMasterEncyclopediaStore,
  listMasterChapters,
  listMasterKnowledgeUnits,
  listMasterVolumes,
  setForceInMemoryMasterEncyclopedia,
} from '../../db/masterEncyclopediaRepository.ts';
import { ingestDocumentIntoMasterEncyclopedia } from './deltaMergeEngine.ts';
import {
  UNICODE_LRI,
  UNICODE_PDI,
  applyMarkdownBidiIsolates,
  compileEncyclopediaToDocxBuffer,
  compileEncyclopediaToMarkdown,
  generateCalibrationSpecJson,
  generateGoogleSheetsCalibrationCsv,
  generateValidatedAsap2A2l,
  generateValidatedTunerProXdf,
  validateAsap2Syntax,
  validateXdfXml,
} from './masterExporters.ts';
import { STRICT_NULL_DISPLAY_FA, normalizeRemapMapRecord } from './automotiveDomainEngine.ts';
import {
  createAuthCapabilitiesRouter,
  createAutomotiveGatekeeperRouter,
  createMasterEncyclopediaAdminRouter,
} from '../../server/masterEncyclopediaRoutes.ts';
import { issueGuestSession } from '../../server/guestSession.ts';

describe('Phase 5 — Real WinOLS/TunerPro/Sheets/DOCX/MD Exporters & API RBAC Integration', () => {
  beforeEach(() => {
    setForceInMemoryMasterEncyclopedia(true);
    clearInMemoryMasterEncyclopediaStore();
  });

  after(() => {
    setForceInMemoryMasterEncyclopedia(false);
  });

  it('wraps LTR technical tokens with Unicode BiDi Isolates (U+2066..U+2069) in Markdown and enforces <w:rtl w:val="0"/> in DOCX', async () => {
    const isolated = applyMarkdownBidiIsolates(
      'آدرس نقشه KFZW برابر 0x18000 با ابعاد 16x12 و کد خطای P0420 و AFR 12.8:1 است.'
    );
    assert.ok(isolated.includes(`${UNICODE_LRI}0x18000${UNICODE_PDI}`));
    assert.ok(isolated.includes(`${UNICODE_LRI}16x12${UNICODE_PDI}`));
    assert.ok(isolated.includes(`${UNICODE_LRI}P0420${UNICODE_PDI}`));
    assert.ok(isolated.includes(`${UNICODE_LRI}AFR 12.8:1${UNICODE_PDI}`));

    await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_exp_1',
      sourceUploadHash: 'hash_exp_1',
      sourceFileName: 'remap_kfzw.md',
      rawText:
        '## جدول جرقه KFZW\nدر ECU Bosch ME7.4.4 نقشه KFZW در آدرس 0x18000 با ابعاد 16x12 و کد P0420 و AFR 12.8:1 ثبت شده است.',
      submittedByRole: 'owner',
      submitterSessionHash: 'owner_sess',
    });

    const [volumes, chapters, units] = await Promise.all([
      listMasterVolumes(),
      listMasterChapters(),
      listMasterKnowledgeUnits(),
    ]);

    const md = compileEncyclopediaToMarkdown({ volumes, chapters, units });
    assert.ok(md.includes(`${UNICODE_LRI}0x18000${UNICODE_PDI}`));
    assert.ok(!md.includes('data:image/'));

    const docxBytes = await compileEncyclopediaToDocxBuffer({ volumes, chapters, units });
    assert.ok(docxBytes.byteLength > 2000);
    const zip = await JSZip.loadAsync(docxBytes);
    const docXml = await zip.file('word/document.xml')?.async('string');
    assert.ok(docXml && docXml.includes('<w:rtl w:val="0"/>'));
    assert.ok(docXml.includes('0x18000'));
  });

  it('generates syntax-validated ASAP2 .a2l (excluding incomplete maps), TunerPro .xdf, Strict-Null CSV, and Calibration Spec JSON', () => {
    const completeMap = normalizeRemapMapRecord({
      mapName: 'KFZW',
      hexAddress: '0x18000',
      cols: 16,
      rows: 12,
      bitWidth: 16,
      byteOrder: 'HiLo',
      signed: true,
      factor: 0.75,
      offset: -23.4,
      unit: 'deg',
      stockValue: null,
      safeChangeRange: null,
      evidenceTier: 'a2l_xdf_verified',
    });

    const incompleteMap = normalizeRemapMapRecord({
      mapName: '',
      hexAddress: '0x1C400',
      // Missing dimensions, bitWidth, factor, offset -> MUST be excluded from .a2l!
      evidenceTier: 'text_or_screenshot_reported',
    });

    // 1. ASAP2 v1.60 .a2l
    const a2l = generateValidatedAsap2A2l([completeMap, incompleteMap], 'ME744_Ref');
    assert.equal(a2l.exportedCount, 1);
    assert.equal(a2l.excludedMaps.length, 1);
    assert.equal(a2l.excludedMaps[0].mapName, 'UNKNOWN_MAP_0x1C400');
    assert.equal(a2l.validation.valid, true);
    assert.equal(a2l.validation.characteristicCount, 1);
    assert.equal(validateAsap2Syntax(a2l.a2lContent).valid, true);
    assert.ok(a2l.a2lContent.includes('ASAP2_VERSION 1 60'));
    assert.ok(a2l.a2lContent.includes('COEFFS_LINEAR 0.75 -23.4'));

    // 2. TunerPro .xdf XML
    const xdf = generateValidatedTunerProXdf([completeMap, incompleteMap], 'ME744_Ref', '0x0');
    assert.equal(xdf.exportedCount, 2);
    assert.equal(xdf.validation.valid, true);
    assert.equal(validateXdfXml(xdf.xdfXml).valid, true);
    assert.ok(xdf.xdfXml.includes('<BASEOFFSET offset="0x0"'));
    assert.ok(xdf.xdfXml.includes('equation="X*0.75-23.4"'));

    // 3. Google Sheets / Excel CSV with Strict Null Policy
    const csv = generateGoogleSheetsCalibrationCsv([completeMap, incompleteMap]);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('KFZW'));
    assert.ok(csv.includes('UNKNOWN_MAP_0x1C400'));
    assert.ok(csv.includes(STRICT_NULL_DISPLAY_FA));
    assert.ok(csv.includes('a2l_xdf_verified'));

    // 4. Calibration Spec JSON manifest
    const jsonRaw = generateCalibrationSpecJson([completeMap], { volumeCount: 1, unitCount: 3 });
    const parsed = JSON.parse(jsonRaw) as {
      rawBinaryStored: boolean;
      flashReady: boolean;
      humanReviewRequired: boolean;
      maps: unknown[];
    };
    assert.equal(parsed.rawBinaryStored, false);
    assert.equal(parsed.flashReady, false);
    assert.equal(parsed.humanReviewRequired, true);
    assert.equal(parsed.maps.length, 1);
  });

  it('enforces HTTP 403 on /api/admin/encyclopedia/* for guests, returns capabilities cleanly, and validates automotive gatekeeper API', async () => {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/auth', createAuthCapabilitiesRouter());
    app.use('/api/automotive', createAutomotiveGatekeeperRouter());
    app.use('/api/admin/encyclopedia', createMasterEncyclopediaAdminRouter());

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const guest = issueGuestSession();
      const authHeaders = {
        Authorization: `Bearer ${guest.token}`,
        'Content-Type': 'application/json',
      };

      // 1. Capabilities endpoint returns canManageEncyclopedia: false for guests without 403 noise
      const capRes = await fetch(`${baseUrl}/api/auth/capabilities`, { headers: authHeaders });
      assert.equal(capRes.status, 200);
      const capBody = (await capRes.json()) as {
        masterEncyclopediaEnabled: boolean;
        canManageEncyclopedia: boolean;
      };
      assert.equal(capBody.canManageEncyclopedia, false);

      // 2. Direct call to Admin Encyclopedia API by guest MUST return HTTP 403!
      const adminRes = await fetch(`${baseUrl}/api/admin/encyclopedia/overview`, {
        headers: authHeaders,
      });
      assert.equal(adminRes.status, 403);

      // 3. Non-automotive cooking recipe rejected with HTTP 400 + polite Persian notice
      const rejectRes = await fetch(`${baseUrl}/api/automotive/gatekeeper/check`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          fileName: 'cake_recipe.md',
          text: 'دستور پخت کیک شکلاتی: آرد، شکر، تخم مرغ و پودر کاکائو را مخلوط کرده و داخل فر قرار دهید.',
        }),
      });
      assert.equal(rejectRes.status, 400);
      const rejectJson = (await rejectRes.json()) as { error?: string };
      assert.ok(rejectJson.error?.includes('خودرو'));

      // 4. ECU binary analyzed safely in memory with rawBinaryStored=false
      const ecuBytes = new Uint8Array(4096);
      ecuBytes.set(new TextEncoder().encode('BOSCH ME7.4.4 HW 0261206943 SW 1037381234'), 64);
      const binRes = await fetch(`${baseUrl}/api/automotive/gatekeeper/check`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          fileName: 'peugeot_me744.bin',
          base64Data: Buffer.from(ecuBytes).toString('base64'),
        }),
      });
      assert.equal(binRes.status, 200);
      const binJson = (await binRes.json()) as {
        approved: boolean;
        ecuProfile: {
          rawBinaryStored: boolean;
          memoryPurgedAfterAnalysis: boolean;
          detectedEcuFamilies: string[];
        };
      };
      assert.equal(binJson.approved, true);
      assert.equal(binJson.ecuProfile.rawBinaryStored, false);
      assert.equal(binJson.ecuProfile.memoryPurgedAfterAnalysis, true);
      assert.ok(binJson.ecuProfile.detectedEcuFamilies.includes('Bosch ME7.4.4'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
