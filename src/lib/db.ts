import { browser } from "$app/environment";

const DB_NAME = "NeuronotesDB";
const DB_VERSION = 2;

// Data structures
export type Workspace = { id: string; name: string };
export type Folder = {
  id: string;
  name: string;
  workspaceId: string;
  order: number;
}; // <-- NEW
export type Note = {
  id: string;
  title: string;
  contentHTML: string;
  updatedAt: number;
  workspaceId: string;
  folderId: string | null;
  order: number;
};
export type CalendarEvent = {
  id: string;
  date: string;
  title: string;
  time?: string;
  workspaceId: string;
};
export type Task = { id: string; text: string };
export type Column = {
  id: string;
  title: string;
  tasks: Task[];
  isCollapsed: boolean;
};
export type Kanban = {
  workspaceId: string;
  columns: Column[];
};
export type Setting = {
  key: string;
  value: any;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!browser) {
    return Promise.reject(
      new Error("IndexedDB can only be used in the browser.")
    );
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("IndexedDB error:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;
        // Use the transaction provided by the event
        const transaction = (event.target as IDBOpenDBRequest).transaction;

        // Workspaces store
        if (!db.objectStoreNames.contains("workspaces")) {
          db.createObjectStore("workspaces", { keyPath: "id" });
        }

        // Notes store with an index on workspaceId
        if (!db.objectStoreNames.contains("notes")) {
          const notesStore = db.createObjectStore("notes", { keyPath: "id" });
          notesStore.createIndex("workspaceId", "workspaceId", {
            unique: false
          });

          notesStore.createIndex(
            "workspaceId_folderId",
            ["workspaceId", "folderId"],
            { unique: false }
          );
        } else if (oldVersion < 2) {
          // Upgrade notes store for existing users
          if (transaction) {
            const notesStore = transaction.objectStore("notes");
            if (!notesStore.indexNames.contains("workspaceId_folderId")) {
              notesStore.createIndex(
                "workspaceId_folderId",
                ["workspaceId", "folderId"],
                { unique: false }
              );
            }
          }
        }

        // Calendar events store with an index on workspaceId
        if (!db.objectStoreNames.contains("calendarEvents")) {
          const eventsStore = db.createObjectStore("calendarEvents", {
            keyPath: "id"
          });
          eventsStore.createIndex("workspaceId", "workspaceId", {
            unique: false
          });
        }

        // Kanban store
        if (!db.objectStoreNames.contains("kanban")) {
          db.createObjectStore("kanban", { keyPath: "workspaceId" });
        }

        // Settings store for simple key-value pairs
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }

        // Folders store
        if (!db.objectStoreNames.contains("folders")) {
          const foldersStore = db.createObjectStore("folders", {
            keyPath: "id"
          });
          foldersStore.createIndex("workspaceId", "workspaceId", {
            unique: false
          });
        }
      };
    });
  }
  return dbPromise;
}

// CRUD helpers
async function get<T>(
  storeName: string,
  key: IDBValidKey
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function remove(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  query: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(query);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export { get, getAll, put, remove, getAllByIndex };
