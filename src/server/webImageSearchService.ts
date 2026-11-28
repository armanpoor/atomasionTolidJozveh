import {
  type CustomWebImageFetcher,
  type ResolvedWebImagePayload,
  type TechnicalImageCategory,
  validateCandidateWebImage,
  type WebImageCandidateMetadata,
  WebImageQueryCache,
} from '../lib/smartImageOrchestrator.ts';

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // 2.5 MB cap
const USER_AGENT = 'AutomotiveReferenceBookStudio/2.0 (Technical ECU Encyclopedia Image Resolver)';

export const serverWebImageLruCache = new WebImageQueryCache(120);

interface RawCandidate extends WebImageCandidateMetadata {
  downloadUrl: string;
  displaySourceTitle: string;
  displaySourceUri: string;
}

function detectImageMimeFromMagicBytes(
  bytes: Uint8Array,
  declaredMime?: string
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.byteLength < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  const norm = String(declaredMime || '').toLowerCase();
  if (norm === 'image/png' || norm === 'image/jpeg' || norm === 'image/webp') {
    return norm;
  }
  return null;
}

function buildSearchQueriesForCategory(
  rawQuery: string,
  targetEntity?: string,
  category?: TechnicalImageCategory
): string[] {
  const cleanRaw = rawQuery.replace(/"/g, '').trim();
  const entity = (targetEntity || '').replace(/WinOLS\s*2\.24/gi, '').trim();
  const queries: string[] = [];

  if (cleanRaw) queries.push(cleanRaw);

  if (category === 'ecu_pinout') {
    if (entity) queries.push(`${entity} ECU connector pinout`);
    queries.push('automotive ECU connector pinout Bosch');
  } else if (category === 'pcb_boot') {
    if (entity) queries.push(`${entity} ECU PCB circuit board`);
    queries.push('Bosch ECU PCB circuit board automotive');
  } else if (category === 'winols_map') {
    queries.push('engine control unit ignition timing map 3D graph');
    queries.push('automotive ECU calibration map graph');
  } else if (category === 'waveform_component') {
    queries.push('crankshaft position sensor oscilloscope waveform automotive');
    queries.push('automotive engine sensor oscilloscope signal');
  }

  return Array.from(new Set(queries.filter((q) => q.length >= 3))).slice(0, 2);
}

async function queryWikimediaCommonsImages(
  query: string,
  signal: AbortSignal
): Promise<RawCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '8',
    gsrsearch: query,
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '960',
  });

  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
    method: 'GET',
    signal,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{
            url?: string;
            thumburl?: string;
            descriptionurl?: string;
            mime?: string;
            width?: number;
            height?: number;
            thumbwidth?: number;
            thumbheight?: number;
            extmetadata?: {
              ImageDescription?: { value?: string };
              ObjectName?: { value?: string };
            };
          }>;
        }
      >;
    };
  };

  const pages = data.query?.pages ? Object.values(data.query.pages) : [];
  const candidates: RawCandidate[] = [];

  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const downloadUrl = info.thumburl || info.url || '';
    if (!downloadUrl) continue;

    const rawDesc = String(info.extmetadata?.ImageDescription?.value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    const cleanTitle = String(p.title || '')
      .replace(/^File:/i, '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim();

    candidates.push({
      url: downloadUrl,
      downloadUrl,
      mimeType: info.mime || '',
      width: info.thumbwidth || info.width,
      height: info.thumbheight || info.height,
      title: cleanTitle,
      altText: info.extmetadata?.ObjectName?.value || cleanTitle,
      description: rawDesc,
      sourcePageUrl: info.descriptionurl || info.url || '',
      displaySourceTitle: cleanTitle ? `Wikimedia Commons · ${cleanTitle.slice(0, 64)}` : 'Wikimedia Commons',
      displaySourceUri: info.descriptionurl || info.url || 'https://commons.wikimedia.org',
    });
  }

  return candidates;
}

async function queryOpenverseImages(
  query: string,
  signal: AbortSignal
): Promise<RawCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: '8',
    mature: 'false',
  });

  const res = await fetch(`https://api.openverse.org/v1/images/?${params.toString()}`, {
    method: 'GET',
    signal,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      url?: string;
      thumbnail?: string;
      foreign_landing_url?: string;
      title?: string;
      width?: number;
      height?: number;
      filetype?: string;
      tags?: Array<{ name?: string }>;
    }>;
  };

  const results = Array.isArray(data.results) ? data.results : [];
  const candidates: RawCandidate[] = [];

  for (const item of results) {
    const downloadUrl = item.url || item.thumbnail || '';
    if (!downloadUrl) continue;
    const ext = String(item.filetype || '').toLowerCase();
    const mimeType =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : downloadUrl.toLowerCase().endsWith('.png')
              ? 'image/png'
              : 'image/jpeg';

    const tagText = (item.tags || []).map((t) => t.name || '').join(' ');
    candidates.push({
      url: downloadUrl,
      downloadUrl,
      mimeType,
      width: item.width,
      height: item.height,
      title: item.title || '',
      altText: item.title || '',
      description: tagText,
      sourcePageUrl: item.foreign_landing_url || downloadUrl,
      displaySourceTitle: item.title ? `Openverse · ${item.title.slice(0, 64)}` : 'Openverse Technical Image',
      displaySourceUri: item.foreign_landing_url || downloadUrl,
    });
  }

  return candidates;
}

async function downloadAndValidateBinaryImage(
  candidate: RawCandidate,
  signal: AbortSignal
): Promise<ResolvedWebImagePayload | null> {
  const res = await fetch(candidate.downloadUrl, {
    method: 'GET',
    signal,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'image/png,image/jpeg,image/webp,*/*;q=0.8',
    },
  });
  if (!res.ok) return null;

  const contentLengthHeader = Number(res.headers.get('content-length') || 0);
  if (contentLengthHeader > MAX_IMAGE_BYTES) return null;

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    return null;
  }

  const bytes = new Uint8Array(arrayBuffer);
  const contentTypeHeader = (res.headers.get('content-type') || candidate.mimeType || '').split(';')[0].trim();
  const detectedMime = detectImageMimeFromMagicBytes(bytes, contentTypeHeader);
  if (!detectedMime) return null;

  const base64 = Buffer.from(bytes).toString('base64');
  return {
    imageUrl: `data:${detectedMime};base64,${base64}`,
    mimeType: detectedMime,
    widthPx: candidate.width,
    heightPx: candidate.height,
    sourceTitle: candidate.displaySourceTitle,
    sourceUri: candidate.displaySourceUri,
  };
}

/**
 * Real Server-Side Technical Web Image Search & Binary Downloader:
 * - Queries Wikimedia Commons (primary) and Openverse (secondary) within the bounded AbortSignal timeout.
 * - Filters every candidate via `validateCandidateWebImage` (MIME, >= 320x200, watermark blocklist, keyword relevance).
 * - Downloads the top validated binary image, checks magic bytes & <= 2.5 MB, and returns a base64 `data:` URI.
 * - Returns `null` cleanly if no candidate passes strict quality/relevance checks or network is offline/timed out,
 *   allowing the orchestrator to trigger the mandatory 3-line `fallback_placeholder` card.
 */
export const serverWebTechnicalImageFetcher: CustomWebImageFetcher = async ({
  searchQuery,
  targetEntity,
  imageCategory,
  signal,
}) => {
  const queries = buildSearchQueriesForCategory(searchQuery, targetEntity, imageCategory);
  const targetKeywords = [
    searchQuery,
    targetEntity || '',
    imageCategory === 'ecu_pinout'
      ? 'ecu pinout connector wiring'
      : imageCategory === 'pcb_boot'
        ? 'ecu pcb circuit board flash'
        : imageCategory === 'winols_map'
          ? 'winols ignition map graph ecu'
          : 'oscilloscope waveform sensor crankshaft',
  ].filter(Boolean);

  for (const q of queries) {
    if (signal.aborted) return null;

    let rawCandidates: RawCandidate[] = [];
    try {
      rawCandidates = await queryWikimediaCommonsImages(q, signal);
    } catch {
      rawCandidates = [];
    }

    if (rawCandidates.length === 0 && !signal.aborted) {
      try {
        rawCandidates = await queryOpenverseImages(q, signal);
      } catch {
        rawCandidates = [];
      }
    }

    const scored = rawCandidates
      .map((cand) => ({
        cand,
        validation: validateCandidateWebImage(cand, targetKeywords),
      }))
      .filter((entry) => entry.validation.valid)
      .sort((a, b) => b.validation.score - a.validation.score);

    for (const best of scored.slice(0, 2)) {
      if (signal.aborted) return null;
      try {
        const downloaded = await downloadAndValidateBinaryImage(best.cand, signal);
        if (downloaded) {
          return downloaded;
        }
      } catch {
        // Try next validated candidate
      }
    }
  }

  return null;
};
