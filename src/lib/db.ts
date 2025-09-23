import { browser } from "$app/environment";

// --- Constants ---
const DB_NAME = "NeuronotesDB";
const DB_VERSION = 2;

// --- Database Schema & Types ---

/** Represents a single workspace. */
export type Workspace = {
	id: string;
	name: string;
	order?: number; // Used for drag-and-drop reordering
};

/** Represents a folder within a workspace, used to organize notes. */
export type Folder = {
	id: string;
	name: string;
	workspaceId: string;
	order: number;
};

/** Defines the style properties applicable to a spreadsheet cell. */
export type SpreadsheetCellStyle = {
	fontWeight?: "bold" | "normal";
	fontStyle?: "italic" | "normal";
	textAlign?: "left" | "center" | "right";
};

/** Represents a single cell in a spreadsheet. */
export type SpreadsheetCell = {
	value: string;
	style?: SpreadsheetCellStyle;
	rowspan?: number;
	colspan?: number;
	merged?: boolean; // True if this cell is part of a merge, but not the top-left anchor
};

/** The main data structure for a spreadsheet note. */
export type Spreadsheet = {
	data: SpreadsheetCell[][];
	rowHeights: Record<number, number>;
	colWidths: Record<number, number>;
};

/** Represents a note, which can be a standard text note or a spreadsheet. */
export type Note = {
	id: string;
	title: string;
	contentHTML: string;
	updatedAt: number;
	workspaceId: string;
	folderId: string | null;
	order: number;
	type?: "text" | "spreadsheet";
	spreadsheet?: Spreadsheet;
};

/** Represents an event in the calendar. */
export type CalendarEvent = {
	id: string;
	date: string; // YYYY-MM-DD format
	title: string;
	time?: string; // HH:MM format
	workspaceId: string;
};

/** Represents a single task card in a Kanban column. */
export type Task = { id: string; text: string };

/** Represents a column in the Kanban board. */
export type Column = {
	id: string;
	title: string;
	tasks: Task[];
	isCollapsed: boolean;
};

/** Represents the entire Kanban board for a given workspace. */
export type Kanban = {
	workspaceId: string;
	columns: Column[];
};

/** A generic key-value store for application settings. */
export type Setting = {
	key: string;
	value: any;
};

// --- Database Connection ---

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens and initializes the IndexedDB database.
 * This function is a singleton; it creates the database connection promise only once.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
function openDB(): Promise<IDBDatabase> {
	if (!browser) {
		// Prevent server-side execution
		return Promise.reject(
			new Error("IndexedDB can only be used in the browser."),
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

			/**
			 * Handles database creation and version upgrades.
			 * This is the only place where the database schema should be modified.
			 */
			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				const transaction = (event.target as IDBOpenDBRequest)
					.transaction;

				// Create 'workspaces' object store
				if (!db.objectStoreNames.contains("workspaces")) {
					db.createObjectStore("workspaces", { keyPath: "id" });
				}

				// Create 'notes' object store and its indexes
				if (!db.objectStoreNames.contains("notes")) {
					const notesStore = db.createObjectStore("notes", {
						keyPath: "id",
					});
					notesStore.createIndex("workspaceId", "workspaceId", {
						unique: false,
					});
					// Compound index for efficient querying of notes within a specific folder
					notesStore.createIndex(
						"workspaceId_folderId",
						["workspaceId", "folderId"],
						{ unique: false },
					);
				}

				// Create 'folders' object store and its index
				if (!db.objectStoreNames.contains("folders")) {
					const foldersStore = db.createObjectStore("folders", {
						keyPath: "id",
					});
					foldersStore.createIndex("workspaceId", "workspaceId", {
						unique: false,
					});
				}

				// Create 'calendarEvents' object store and its index
				if (!db.objectStoreNames.contains("calendarEvents")) {
					const eventsStore = db.createObjectStore("calendarEvents", {
						keyPath: "id",
					});
					eventsStore.createIndex("workspaceId", "workspaceId", {
						unique: false,
					});
				}

				// Create 'kanban' object store
				if (!db.objectStoreNames.contains("kanban")) {
					db.createObjectStore("kanban", { keyPath: "workspaceId" });
				}

				// Create 'settings' object store
				if (!db.objectStoreNames.contains("settings")) {
					db.createObjectStore("settings", { keyPath: "key" });
				}
			};
		});
	}
	return dbPromise;
}

// --- Generic CRUD Operations ---

/**
 * Retrieves a single item from a store by its key.
 * @template T The expected type of the item.
 * @param {string} storeName The name of the object store.
 * @param {IDBValidKey} key The key of the item to retrieve.
 * @returns {Promise<T | undefined>} A promise that resolves with the item or undefined if not found.
 */
export async function get<T>(
	storeName: string,
	key: IDBValidKey,
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

/**
 * Retrieves all items from a store.
 * @template T The expected type of the items.
 * @param {string} storeName The name of the object store.
 * @returns {Promise<T[]>} A promise that resolves with an array of all items in the store.
 */
export async function getAll<T>(storeName: string): Promise<T[]> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(storeName, "readonly");
		const store = transaction.objectStore(storeName);
		const request = store.getAll();
		request.onsuccess = () => resolve(request.result as T[]);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Adds a new item or updates an existing item in a store.
 * @template T The type of the item.
 * @param {string} storeName The name of the object store.
 * @param {T} value The item to add or update.
 * @returns {Promise<void>} A promise that resolves when the operation is complete.
 */
export async function put<T>(storeName: string, value: T): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(storeName, "readwrite");
		const store = transaction.objectStore(storeName);
		const request = store.put(value);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * Removes an item from a store by its key.
 * @param {string} storeName The name of the object store.
 * @param {IDBValidKey} key The key of the item to remove.
 * @returns {Promise<void>} A promise that resolves when the operation is complete.
 */
export async function remove(
	storeName: string,
	key: IDBValidKey,
): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(storeName, "readwrite");
		const store = transaction.objectStore(storeName);
		const request = store.delete(key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * Retrieves all items from a store that match a query on a specific index.
 * @template T The expected type of the items.
 * @param {string} storeName The name of the object store.
 * @param {string} indexName The name of the index to query.
 * @param {IDBValidKey | IDBKeyRange} query The key or key range to query for.
 * @returns {Promise<T[]>} A promise that resolves with an array of matching items.
 */
export async function getAllByIndex<T>(
	storeName: string,
	indexName: string,
	query: IDBValidKey | IDBKeyRange,
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