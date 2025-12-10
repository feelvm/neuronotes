import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';
import { debounce } from './utils/debounce';

// sql.js exports Database as a property of the default export
type SqlJsDatabase = ReturnType<Awaited<ReturnType<typeof import('sql.js')['default']>>['Database']>;

let db: SqlJsDatabase | null = null;
let initPromise: Promise<void> | null = null;
let debouncedSave: ((() => void) & { flush: () => Promise<void> }) | null = null;
let SQL: any = null; // Store the SQL.js module

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content_html TEXT, updated_at INTEGER NOT NULL, workspace_id TEXT NOT NULL, folder_id TEXT, "order" INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'text', spreadsheet TEXT);
  CREATE TABLE IF NOT EXISTS calendarEvents (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, time TEXT, workspace_id TEXT NOT NULL, repeat TEXT, repeat_on TEXT, repeat_end TEXT, exceptions TEXT, color TEXT);
  CREATE TABLE IF NOT EXISTS kanban (workspace_id TEXT PRIMARY KEY, columns TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

const getStorageKey = () => {
  try {
    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;
    const key = isDev ? 'neuronotes_db_dev' : 'neuronotes_db';
    return key;
  } catch (e) {
    console.warn('[browser_db] Failed to detect environment, defaulting to production key:', e);
    return 'neuronotes_db';
  }
};

export async function init(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Dynamic import to defer loading sql.js and its WASM file
      const sqlJsModule = await import('sql.js');
      SQL = await sqlJsModule.default({
        locateFile: (file: string) => {
          return `https://sql.js.org/dist/${file}`;
        }
      });

      const storageKey = getStorageKey();
      const savedDb = localStorage.getItem(storageKey);
      if (savedDb) {
        try {
          const array = JSON.parse(savedDb);
          const uint8Array = new Uint8Array(array);
          db = new SQL.Database(uint8Array);
          db.run(SCHEMA_SQL);
        } catch (e) {
          console.warn('[browser_db] Failed to load saved database, creating new one:', e);
          db = new SQL.Database();
          db.run(SCHEMA_SQL);
        }
      } else {
        db = new SQL.Database();
        db.run(SCHEMA_SQL);
      }
      
      const verifyTables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = verifyTables[0]?.values?.map((row: any) => row[0]) || [];
      if (tableNames.length === 0) {
        console.error('[browser_db] WARNING: No tables found after initialization!');
        db.run(SCHEMA_SQL);
      }

      const saveDb = () => {
        if (db) {
          try {
            const data = db.export();
            const array = Array.from(data);
            localStorage.setItem(storageKey, JSON.stringify(array));
          } catch (e) {
            if (import.meta.env.DEV) {
              console.error('[browser_db] Failed to save database:', e);
            }
          }
        }
      };

      // Debounce saves to avoid excessive localStorage writes
      // Saves immediately on beforeunload, otherwise debounced by 1 second
      debouncedSave = debounce(saveDb, 1000);

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', saveDb); // Immediate save on page unload
        // Periodic save as backup (every 10 seconds instead of 5)
        setInterval(saveDb, 10000);
      }
    } catch (error) {
      console.error('[browser_db] Failed to initialize SQLite database:', error);
      throw error;
    }
  })();

  return initPromise;
}

// Export function to flush pending database saves
export function flushDatabaseSave(): void {
  if (debouncedSave) {
    // flush() returns a Promise but we don't need to await it here
    // since this is called synchronously and we do an immediate save below
    debouncedSave.flush().catch(() => {
      // Ignore errors, we'll do immediate save below
    });
  }
  // Also do an immediate save to ensure data is persisted
  if (db) {
    try {
      const storageKey = getStorageKey();
      const data = db.export();
      const array = Array.from(data);
      localStorage.setItem(storageKey, JSON.stringify(array));
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[browser_db] Failed to flush database save:', e);
      }
    }
  }
}

async function ensureDb(): Promise<SqlJsDatabase> {
  if (!db) {
    await init();
  }
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export async function execute(sql: string, params: any[] = []): Promise<void> {
  try {
    const database = await ensureDb();
    const convertedSql = sql.replace(/\$(\d+)/g, '?');
    const stmt = database.prepare(convertedSql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
    // Trigger debounced save instead of immediate save
    if (debouncedSave) {
      debouncedSave();
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[browser_db] Execute error:', error, 'SQL:', sql, 'Params:', params);
    }
    throw error;
  }
}

async function select<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try {
    const database = await ensureDb();
    const convertedSql = sql.replace(/\$(\d+)/g, '?');
    const stmt = database.prepare(convertedSql);
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row as T);
    }
    stmt.free();
    return results;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[browser_db] Select error:', error, 'SQL:', sql, 'Params:', params);
    }
    throw error;
  }
}

export async function getAllWorkspaces(): Promise<Workspace[]> {
  const result = await select<any>('SELECT * FROM workspaces ORDER BY "order"');
  return result as Workspace[];
}

export async function putWorkspace(workspace: Workspace): Promise<void> {
  await execute(
    'INSERT OR REPLACE INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
    [workspace.id, workspace.name, workspace.order ?? 0] // Default to 0 if undefined
  );
}

export async function deleteWorkspace(id: string): Promise<void> {
  await execute('DELETE FROM workspaces WHERE id = ?', [id]);
}

export async function getFoldersByWorkspaceId(workspaceId: string): Promise<Folder[]> {
  const result = await select<any>(
    'SELECT * FROM folders WHERE workspace_id = ? ORDER BY "order"',
    [workspaceId]
  );
  return result.map((folder) => ({
    id: folder.id,
    name: folder.name,
    workspaceId: folder.workspace_id,
    order: folder.order
  })) as Folder[];
}

export async function putFolder(folder: Folder): Promise<void> {
  await execute(
    'INSERT OR REPLACE INTO folders (id, name, workspace_id, "order") VALUES (?, ?, ?, ?)',
    [folder.id, folder.name, folder.workspaceId, folder.order ?? 0] // Default to 0 if undefined
  );
}

export async function deleteFolder(id: string): Promise<void> {
  await execute('DELETE FROM folders WHERE id = ?', [id]);
}

export async function getNotesByWorkspaceId(workspaceId: string): Promise<Note[]> {
  const result = await select<any>(
    'SELECT id, title, content_html, updated_at, workspace_id, folder_id, "order", type, spreadsheet FROM notes WHERE workspace_id = ? ORDER BY "order"',
    [workspaceId]
  );

  return result.map((note) => {
    // Ensure type is valid - default to 'text' if missing or invalid
    const noteType: 'text' | 'spreadsheet' = (note.type === 'spreadsheet' ? 'spreadsheet' : 'text');
    
    // Parse spreadsheet JSON only if note is actually a spreadsheet type AND has spreadsheet data
    let spreadsheetJson: string | undefined = undefined;
    if (noteType === 'spreadsheet' && note.spreadsheet) {
      // If spreadsheet is already a string, use it; otherwise stringify it
      if (typeof note.spreadsheet === 'string') {
        spreadsheetJson = note.spreadsheet;
      } else {
        spreadsheetJson = JSON.stringify(note.spreadsheet);
      }
    }
    
    const mappedNote: any = {
      ...note,
      contentHTML: note.content_html || '', // Include content from DB
      updatedAt: note.updated_at,
      workspaceId: note.workspace_id,
      folderId: note.folder_id,
      type: noteType, // Use validated type
      spreadsheet: undefined, // Will be parsed from _spreadsheetJson when needed
      _spreadsheetJson: spreadsheetJson, // Store as JSON string for lazy parsing
      _contentLoaded: !!note.content_html // Mark as loaded if content exists
    };
    return mappedNote;
  }) as Note[];
}

export async function getNoteContent(noteId: string): Promise<string> {
  const result = await select<any>(
    'SELECT content_html FROM notes WHERE id = ?',
    [noteId]
  );
  return result[0]?.content_html || '';
}

export async function putNote(note: Note): Promise<void> {
  let spreadsheetJson: string | null = null;
  const noteWithRaw = note as any;
  
  if (note.spreadsheet) {
    if (typeof note.spreadsheet === 'string') {
      spreadsheetJson = note.spreadsheet;
    } else {
      spreadsheetJson = JSON.stringify(note.spreadsheet);
    }
  } else if (noteWithRaw._spreadsheetJson) {
    spreadsheetJson = noteWithRaw._spreadsheetJson;
  }

  let contentHTML = note.contentHTML;
  // Only try to preserve existing content if:
  // 1. contentHTML is empty AND
  // 2. _contentLoaded is false/undefined (meaning content wasn't explicitly loaded/set)
  // If _contentLoaded is true, use the provided contentHTML (even if empty) - this is important for imports
  if ((!contentHTML || contentHTML === '') && (noteWithRaw._contentLoaded === false || noteWithRaw._contentLoaded === undefined)) {
    try {
      const existingContent = await getNoteContent(note.id);
      if (existingContent) {
        contentHTML = existingContent;
        if (import.meta.env.DEV) {
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn(`[browser_db] Failed to fetch existing content for note ${note.id}, using empty string:`, e);
      }
    }
  }

  await execute(
    'INSERT OR REPLACE INTO notes (id, title, content_html, updated_at, workspace_id, folder_id, "order", type, spreadsheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      note.id,
      note.title,
      contentHTML || null,
      note.updatedAt,
      note.workspaceId,
      note.folderId || null, // Convert undefined to null
      note.order ?? 0, // Default to 0 if undefined
      note.type || 'text',
      spreadsheetJson || null
    ]
  );
}

export async function deleteNote(id: string): Promise<void> {
  await execute('DELETE FROM notes WHERE id = ?', [id]);
}

export async function getCalendarEventsByWorkspaceId(
  workspaceId: string
): Promise<CalendarEvent[]> {
  const result = await select<any>('SELECT * FROM calendarEvents WHERE workspace_id = ?', [
    workspaceId
  ]);

  return result.map((event) => ({
    id: event.id,
    date: event.date,
    title: event.title,
    time: event.time,
    workspaceId: event.workspace_id,
    repeat: event.repeat || 'none',
    repeatOn: event.repeat_on ? JSON.parse(event.repeat_on) : undefined,
    repeatEnd: event.repeat_end,
    exceptions: event.exceptions ? JSON.parse(event.exceptions) : [],
    color: event.color || undefined
  })) as CalendarEvent[];
}

export async function getAllCalendarEvents(): Promise<CalendarEvent[]> {
  const result = await select<any>('SELECT * FROM calendarEvents');

  return result.map((event) => ({
    id: event.id,
    date: event.date,
    title: event.title,
    time: event.time,
    workspaceId: event.workspace_id,
    repeat: event.repeat || 'none',
    repeatOn: event.repeat_on ? JSON.parse(event.repeat_on) : undefined,
    repeatEnd: event.repeat_end,
    exceptions: event.exceptions ? JSON.parse(event.exceptions) : [],
    color: event.color || undefined
  })) as CalendarEvent[];
}

export async function putCalendarEvent(event: CalendarEvent): Promise<void> {
  const repeatOnJson = event.repeatOn ? JSON.stringify(event.repeatOn) : null;
  const exceptionsJson = event.exceptions ? JSON.stringify(event.exceptions) : null;
  
  await execute(
    'INSERT OR REPLACE INTO calendarEvents (id, date, title, time, workspace_id, repeat, repeat_on, repeat_end, exceptions, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      event.id, 
      event.date, 
      event.title, 
      event.time || null, 
      event.workspaceId,
      event.repeat || 'none',
      repeatOnJson,
      event.repeatEnd || null, // Convert undefined to null
      exceptionsJson,
      event.color || null
    ]
  );
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  await execute('DELETE FROM calendarEvents WHERE id = ?', [id]);
}

export async function getKanbanByWorkspaceId(workspaceId: string): Promise<Kanban | null> {
  const result = await select<any>('SELECT * FROM kanban WHERE workspace_id = ?', [
    workspaceId
  ]);

  if (result.length === 0) {
    return null;
  }

  const kanbanRow = result[0];
  return {
    workspaceId: kanbanRow.workspace_id,
    columns: JSON.parse(kanbanRow.columns)
  };
}

export async function putKanban(kanban: Kanban): Promise<void> {
  await execute('INSERT OR REPLACE INTO kanban (workspace_id, columns) VALUES (?, ?)', [
    kanban.workspaceId,
    JSON.stringify(kanban.columns)
  ]);
}

export async function deleteKanban(workspaceId: string): Promise<void> {
  await execute('DELETE FROM kanban WHERE workspace_id = ?', [workspaceId]);
}

export async function getSettingByKey(key: string): Promise<Setting | null> {
  const result = await select<any>('SELECT * FROM settings WHERE key = ?', [key]);

  if (result.length === 0) {
    return null;
  }

  const settingRow = result[0];
  return {
    key: settingRow.key,
    value: JSON.parse(settingRow.value)
  };
}

export async function putSetting(setting: Setting): Promise<void> {
  await execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
    setting.key,
    JSON.stringify(setting.value)
  ]);
}

export async function getAllSettings(): Promise<Setting[]> {
  const result = await select<any>('SELECT * FROM settings');
  return result.map((row) => ({
    key: row.key,
    value: JSON.parse(row.value)
  })) as Setting[];
}

export async function deleteSetting(key: string): Promise<void> {
  await execute('DELETE FROM settings WHERE key = ?', [key]);
}

export async function get<T>(storeName: string, key: string): Promise<T | undefined> {
  switch (storeName) {
    case 'settings':
      const setting = await getSettingByKey(key);
      return setting as T | undefined;
    case 'kanban':
      const kanban = await getKanbanByWorkspaceId(key);
      return kanban as T | undefined;
    default:
      console.warn(`get() not implemented for store: ${storeName}`);
      return undefined;
  }
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  switch (storeName) {
    case 'workspaces':
      return (await getAllWorkspaces()) as T[];
    case 'settings':
      return (await getAllSettings()) as T[];
    default:
      console.warn(`getAll() not implemented for store: ${storeName}`);
      return [];
  }
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  switch (storeName) {
    case 'workspaces':
      await putWorkspace(value as Workspace);
      break;
    case 'folders':
      await putFolder(value as Folder);
      break;
    case 'notes':
      await putNote(value as Note);
      break;
    case 'calendarEvents':
      await putCalendarEvent(value as CalendarEvent);
      break;
    case 'kanban':
      await putKanban(value as Kanban);
      break;
    case 'settings':
      await putSetting(value as Setting);
      break;
    default:
      console.warn(`put() not implemented for store: ${storeName}`);
  }
}

export async function remove(storeName: string, key: string): Promise<void> {
  switch (storeName) {
    case 'workspaces':
      await deleteWorkspace(key);
      break;
    case 'folders':
      await deleteFolder(key);
      break;
    case 'notes':
      await deleteNote(key);
      break;
    case 'calendarEvents':
      await deleteCalendarEvent(key);
      break;
    case 'settings':
      await deleteSetting(key);
      break;
    default:
      console.warn(`remove() not implemented for store: ${storeName}`);
  }
}

export async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  query: string
): Promise<T[]> {
  switch (storeName) {
    case 'folders':
      if (indexName === 'workspaceId') {
        return (await getFoldersByWorkspaceId(query)) as T[];
      }
      break;
    case 'notes':
      if (indexName === 'workspaceId') {
        return (await getNotesByWorkspaceId(query)) as T[];
      }
      break;
    case 'calendarEvents':
      if (indexName === 'workspaceId') {
        return (await getCalendarEventsByWorkspaceId(query)) as T[];
      }
      break;
  }

  console.warn(`getAllByIndex() not implemented for store: ${storeName}, index: ${indexName}`);
  return [];
}

