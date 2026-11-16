import { CachedLibraryPack, ProjectData, ProjectSummary } from '../types/editor';

const DB_NAME = 'verseframe_studio_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_ASSETS = 'project_assets';
const STORE_LIBRARY = 'library_cache';
const STORE_RECOVERY = 'recovery';

export interface StoredProjectAssets {
  projectId: string;
  audioBlob: Blob | null;
  bgMediaBlob: Blob | null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        db.createObjectStore(STORE_LIBRARY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_RECOVERY)) {
        db.createObjectStore(STORE_RECOVERY, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      })
  );
}

export async function saveProjectToDb(
  project: ProjectData,
  audioBlob: Blob | null,
  bgMediaBlob: Blob | null
): Promise<void> {
  const updated: ProjectData = { ...project, updatedAt: Date.now() };
  await runTx(STORE_PROJECTS, 'readwrite', (store) => store.put(updated));
  await runTx(STORE_ASSETS, 'readwrite', (store) =>
    store.put({
      projectId: updated.id,
      audioBlob,
      bgMediaBlob,
    } satisfies StoredProjectAssets)
  );
}

export async function listProjectsFromDb(): Promise<ProjectSummary[]> {
  const all = await runTx<ProjectData[]>(STORE_PROJECTS, 'readonly', (store) =>
    store.getAll()
  );
  return all
    .map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
      aspectRatio: p.aspectRatio,
      duration: p.duration,
      lineCount: p.lyrics.length,
      audioFileName: p.audioFileName,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProjectFromDb(projectId: string): Promise<{
  project: ProjectData;
  audioBlob: Blob | null;
  bgMediaBlob: Blob | null;
} | null> {
  const project = await runTx<ProjectData | undefined>(
    STORE_PROJECTS,
    'readonly',
    (store) => store.get(projectId)
  );
  if (!project) return null;
  const assets = await runTx<StoredProjectAssets | undefined>(
    STORE_ASSETS,
    'readonly',
    (store) => store.get(projectId)
  );
  return {
    project,
    audioBlob: assets?.audioBlob ?? null,
    bgMediaBlob: assets?.bgMediaBlob ?? null,
  };
}

export async function duplicateProjectInDb(
  projectId: string
): Promise<ProjectData | null> {
  const existing = await loadProjectFromDb(projectId);
  if (!existing) return null;
  const now = Date.now();
  const copy: ProjectData = {
    ...existing.project,
    id: `proj_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: `${existing.project.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await saveProjectToDb(copy, existing.audioBlob, existing.bgMediaBlob);
  return copy;
}

export async function deleteProjectFromDb(projectId: string): Promise<void> {
  await runTx(STORE_PROJECTS, 'readwrite', (store) => store.delete(projectId));
  await runTx(STORE_ASSETS, 'readwrite', (store) => store.delete(projectId));
}

export async function saveRecoveryState(
  project: ProjectData,
  audioBlob: Blob | null,
  bgMediaBlob: Blob | null
): Promise<void> {
  await runTx(STORE_RECOVERY, 'readwrite', (store) =>
    store.put({
      key: 'active_session',
      savedAt: Date.now(),
      project,
      audioBlob,
      bgMediaBlob,
    })
  );
}

export async function loadRecoveryState(): Promise<{
  savedAt: number;
  project: ProjectData;
  audioBlob: Blob | null;
  bgMediaBlob: Blob | null;
} | null> {
  const res = await runTx<
    | {
        key: string;
        savedAt: number;
        project: ProjectData;
        audioBlob: Blob | null;
        bgMediaBlob: Blob | null;
      }
    | undefined
  >(STORE_RECOVERY, 'readonly', (store) => store.get('active_session'));
  return res ?? null;
}

export async function saveCachedLibraryPack(pack: CachedLibraryPack): Promise<void> {
  await runTx(STORE_LIBRARY, 'readwrite', (store) => store.put(pack));
}

export async function listCachedLibraryPacks(): Promise<CachedLibraryPack[]> {
  return runTx<CachedLibraryPack[]>(STORE_LIBRARY, 'readonly', (store) =>
    store.getAll()
  );
}
