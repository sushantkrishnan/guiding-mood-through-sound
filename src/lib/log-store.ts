/**
 * Browser backup of session logs, in IndexedDB.
 *
 * The download at the end of a session is the primary copy; this is the
 * safety net. It used to be localStorage, whose ~5 MB per origin (shared
 * with the app's own saved state) filled up after three or four sessions.
 * IndexedDB allows hundreds of MB. Logs saved by the old version are moved
 * over the first time the store opens.
 */

import type { SessionLog } from './study';

const DB_NAME = 'moodist-study';
const STORE = 'logs';
const LEGACY_KEY = 'moodist-study-logs';

let opening: Promise<IDBDatabase> | null = null;

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function open() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, {
        keyPath: ['participantId', 'session'],
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).then(async db => {
    await migrate(db);

    return db;
  });

  opening.catch(() => {
    opening = null;
  });

  return opening;
}

/** Move logs saved by the localStorage version into IndexedDB, once. */
async function migrate(db: IDBDatabase) {
  let legacy: Array<SessionLog> = [];

  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
  } catch {
    return;
  }

  if (!legacy.length) return;

  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);

  // a log already in IndexedDB is newer than its localStorage copy
  const existing = new Set(
    (await request(store.getAllKeys())).map(key => JSON.stringify(key)),
  );

  legacy.forEach(log => {
    const key = JSON.stringify([log.participantId, log.session]);
    if (!existing.has(key)) store.put(log);
  });

  await done(tx);

  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // nothing to remove
  }
}

/** Every backed-up log, oldest session first. */
export async function savedLogs(): Promise<Array<SessionLog>> {
  try {
    const db = await open();
    const logs = await request(
      db.transaction(STORE).objectStore(STORE).getAll(),
    );

    return (logs as Array<SessionLog>).sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
  } catch {
    return [];
  }
}

/**
 * Back up a log, replacing any earlier copy of the same participant and
 * session. Resolves false if the browser refuses (private mode, blocked).
 */
export async function saveLog(log: SessionLog) {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(log);
    await done(tx);

    return true;
  } catch {
    return false;
  }
}

export async function clearLogs() {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  } catch {
    // nothing to clear
  }
}
