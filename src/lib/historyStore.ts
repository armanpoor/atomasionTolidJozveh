import { HistoryRunRecord } from './bookTypes';

const DB_NAME = 'persian_docx_studio_history_v1';
const STORE_NAME = 'runs';
const DB_VERSION = 1;

// In-memory fallback for Node.js tests or restricted storage environments
const memoryStore = new Map<string, HistoryRunRecord>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Strips transient Uint8Array bytes from bookSnapshot before IndexedDB persistence
 * (svgMarkup is tiny and re-rasterizable; the full .docx Blob is stored separately on the record).
 */
function sanitizeRecordForStorage(record: HistoryRunRecord): HistoryRunRecord {
  const sanitizedChapters = record.bookSnapshot.chapters.map((ch) => ({
    ...ch,
    introBlocks: ch.introBlocks.map((b) =>
      b.type === 'diagram' ? { ...b, pngBytes: undefined } : b
    ),
    sections: ch.sections.map((s) => ({
      ...s,
      blocks: s.blocks.map((b) =>
        b.type === 'diagram' ? { ...b, pngBytes: undefined } : b
      ),
    })),
  }));

  return {
    ...record,
    bookSnapshot: {
      ...record.bookSnapshot,
      chapters: sanitizedChapters,
    },
  };
}

export async function saveHistoryRun(record: HistoryRunRecord): Promise<void> {
  const clean = sanitizeRecordForStorage(record);
  if (!hasIndexedDb()) {
    memoryStore.set(clean.id, clean);
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(clean);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listHistoryRuns(): Promise<HistoryRunRecord[]> {
  if (!hasIndexedDb()) {
    return Array.from(memoryStore.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
  const db = await openDb();
  const rows = await new Promise<HistoryRunRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as HistoryRunRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteHistoryRun(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryStore.delete(id);
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearHistoryRuns(): Promise<void> {
  if (!hasIndexedDb()) {
    memoryStore.clear();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
