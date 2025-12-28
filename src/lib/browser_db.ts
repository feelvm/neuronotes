import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';
import { debounce } from './utils/debounce';

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
  CREATE TABLE IF NOT EXISTS kanban (workspace_id TEXT PRIMARY KEY, columns TEXT NOT NULL, updated_at INTEGER);
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
          let array: number[];
          try {
            array = JSON.parse(savedDb);
            if (!Array.isArray(array)) {
              throw new Error('Invalid database format');
            }
          } catch (parseError) {
            console.warn('[browser_db] Failed to parse saved database, creating new one:', parseError);
            db = new SQL.Database();
            db.run(SCHEMA_SQL);
            return;
          }
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

      debouncedSave = debounce(saveDb, 1000);

      // Migration: Add updated_at column to kanban table if it doesn't exist
      try {
        const pragmaResult = db.exec("PRAGMA table_info(kanban)");
        const columns = pragmaResult[0]?.values || [];
        const hasUpdatedAt = columns.some((col: any) => col[1] === 'updated_at');
        if (!hasUpdatedAt) {
          console.log('[browser_db] Migrating kanban table: adding updated_at column');
          db.run("ALTER TABLE kanban ADD COLUMN updated_at INTEGER");
          // Set updated_at for existing rows to current timestamp
          db.run("UPDATE kanban SET updated_at = ? WHERE updated_at IS NULL", [Date.now()]);
          saveDb(); // Save the migration immediately
        }
      } catch (migrationError) {
        console.warn('[browser_db] Failed to migrate kanban table:', migrationError);
      }

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', saveDb);
        setInterval(saveDb, 10000);
      }
    } catch (error) {
      console.error('[browser_db] Failed to initialize SQLite database:', error);
      throw error;
    }
  })();

  return initPromise;
}

export function flushDatabaseSave(): void {
  if (debouncedSave) {
    debouncedSave.flush().catch(() => {});
  }
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
    [workspace.id, workspace.name, workspace.order ?? 0]
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
    [folder.id, folder.name, folder.workspaceId, folder.order ?? 0]
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
    const noteType: 'text' | 'spreadsheet' = (note.type === 'spreadsheet' ? 'spreadsheet' : 'text');
    
    let spreadsheetJson: string | undefined = undefined;
    if (noteType === 'spreadsheet' && note.spreadsheet) {
      if (typeof note.spreadsheet === 'string') {
        spreadsheetJson = note.spreadsheet;
      } else {
        spreadsheetJson = JSON.stringify(note.spreadsheet);
      }
    }
    
    const mappedNote: any = {
      ...note,
      contentHTML: note.content_html || '',
      updatedAt: note.updated_at,
      workspaceId: note.workspace_id,
      folderId: note.folder_id,
      type: noteType,
      spreadsheet: undefined,
      _spreadsheetJson: spreadsheetJson,
      _contentLoaded: !!note.content_html
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
      note.folderId || null,
      note.order ?? 0,
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

  return result.map((event) => {
    let repeatOn: number[] | undefined = undefined;
    let exceptions: string[] = [];
    
    if (event.repeat_on) {
      try {
        const parsed = JSON.parse(event.repeat_on);
        repeatOn = Array.isArray(parsed) ? parsed : undefined;
      } catch (e) {
        console.warn('[browser_db] Failed to parse repeat_on:', e);
      }
    }
    
    if (event.exceptions) {
      try {
        const parsed = JSON.parse(event.exceptions);
        exceptions = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.warn('[browser_db] Failed to parse exceptions:', e);
      }
    }
    
    return {
      id: event.id,
      date: event.date,
      title: event.title,
      time: event.time,
      workspaceId: event.workspace_id,
      repeat: event.repeat || 'none',
      repeatOn,
      repeatEnd: event.repeat_end,
      exceptions,
      color: event.color || undefined
    };
  }) as CalendarEvent[];
}

export async function getAllCalendarEvents(): Promise<CalendarEvent[]> {
  const result = await select<any>('SELECT * FROM calendarEvents');

  return result.map((event) => {
    let repeatOn: number[] | undefined = undefined;
    let exceptions: string[] = [];
    
    if (event.repeat_on) {
      try {
        const parsed = JSON.parse(event.repeat_on);
        repeatOn = Array.isArray(parsed) ? parsed : undefined;
      } catch (e) {
        console.warn('[browser_db] Failed to parse repeat_on:', e);
      }
    }
    
    if (event.exceptions) {
      try {
        const parsed = JSON.parse(event.exceptions);
        exceptions = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.warn('[browser_db] Failed to parse exceptions:', e);
      }
    }
    
    return {
      id: event.id,
      date: event.date,
      title: event.title,
      time: event.time,
      workspaceId: event.workspace_id,
      repeat: event.repeat || 'none',
      repeatOn,
      repeatEnd: event.repeat_end,
      exceptions,
      color: event.color || undefined
    };
  }) as CalendarEvent[];
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
  let columns: any = null;
  try {
    columns = JSON.parse(kanbanRow.columns);
  } catch (e) {
    console.error('[browser_db] Failed to parse kanban columns:', e);
    throw new Error('Invalid kanban data format');
  }
  return {
    workspaceId: kanbanRow.workspace_id,
    columns,
    updatedAt: kanbanRow.updated_at || undefined
  };
}

export async function putKanban(kanban: Kanban): Promise<void> {
  const updatedAt = kanban.updatedAt ?? Date.now();
  await execute('INSERT OR REPLACE INTO kanban (workspace_id, columns, updated_at) VALUES (?, ?, ?)', [
    kanban.workspaceId,
    JSON.stringify(kanban.columns),
    updatedAt
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
  let value: any = null;
  try {
    value = JSON.parse(settingRow.value);
  } catch (e) {
    console.warn('[browser_db] Failed to parse setting value:', e);
    value = settingRow.value; // Fallback to raw value
  }
  return {
    key: settingRow.key,
    value
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
  return result.map((row) => {
    let value: any = null;
    try {
      value = JSON.parse(row.value);
    } catch (e) {
      console.warn('[browser_db] Failed to parse setting value:', e);
      value = row.value; // Fallback to raw value
    }
    return {
      key: row.key,
      value
    };
  }) as Setting[];
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

