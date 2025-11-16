import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';

type Database = {
  load: (name: string) => Promise<Database>;
  execute: (sql: string, bindValues?: any[]) => Promise<void>;
  select: <T = any>(sql: string, bindValues?: any[]) => Promise<T[]>;
};

type DatabaseConstructor = {
  load: (name: string) => Promise<Database>;
};

let db: Database | null = null;
let DatabaseClass: DatabaseConstructor | null = null;

const getDatabaseName = () => {
  try {
    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;
    return isDev ? 'sqlite:neuronotes_dev.db' : 'sqlite:neuronotes.db';
  } catch {
    return 'sqlite:neuronotes.db';
  }
};

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content_html TEXT, updated_at INTEGER NOT NULL, workspace_id TEXT NOT NULL, folder_id TEXT, "order" INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'text', spreadsheet TEXT);
  CREATE TABLE IF NOT EXISTS calendarEvents (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, time TEXT, workspace_id TEXT NOT NULL, repeat TEXT, repeat_on TEXT, repeat_end TEXT, exceptions TEXT, color TEXT);
  CREATE TABLE IF NOT EXISTS kanban (workspace_id TEXT PRIMARY KEY, columns TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

export async function init(): Promise<void> {
  if (!db) {
    try {
      if (!DatabaseClass) {
        const module = await import('@tauri-apps/plugin-sql');
        DatabaseClass = module.default;
      }
      const dbName = getDatabaseName();
      db = await DatabaseClass.load(dbName);
      
      try {
        await db.execute(SCHEMA_SQL);
        if (import.meta.env.DEV) {
          console.log(`[tauri_db] SQLite database initialized successfully (${dbName})`);
          const tables = await db.select("SELECT name FROM sqlite_master WHERE type='table'");
          console.log(`[tauri_db] Database tables:`, (tables as any[]).map((row: any) => row.name));
        }
      } catch (schemaError) {
        if (import.meta.env.DEV) {
          console.warn('[tauri_db] Schema creation warning (tables may already exist):', schemaError);
        }
        const tables = await db.select("SELECT name FROM sqlite_master WHERE type='table'");
        if ((tables as any[]).length === 0) {
          if (import.meta.env.DEV) {
            console.error('[tauri_db] WARNING: No tables found! Attempting to create schema again...');
          }
          await db.execute(SCHEMA_SQL);
        } else if (import.meta.env.DEV) {
          console.log(`[tauri_db] SQLite database initialized (${dbName})`);
        }
      }
    } catch (error) {
      console.error('[tauri_db] Failed to initialize SQLite database:', error);
      throw error;
    }
  }
}

async function ensureDb(): Promise<Database> {
  if (!db) {
    await init();
  }
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export async function getAllWorkspaces(): Promise<Workspace[]> {
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM workspaces ORDER BY "order"');
  return result as Workspace[];
}

export async function putWorkspace(workspace: Workspace): Promise<void> {
  const database = await ensureDb();
  await database.execute(
    'INSERT OR REPLACE INTO workspaces (id, name, "order") VALUES ($1, $2, $3)',
    [workspace.id, workspace.name, workspace.order ?? 0] // Default to 0 if undefined
  );
}

export async function deleteWorkspace(id: string): Promise<void> {
  const database = await ensureDb();
  await database.execute('DELETE FROM workspaces WHERE id = $1', [id]);
}

export async function getFoldersByWorkspaceId(workspaceId: string): Promise<Folder[]> {
  const database = await ensureDb();
  const result = await database.select(
    'SELECT * FROM folders WHERE workspace_id = $1 ORDER BY "order"',
    [workspaceId]
  );
  return (result as any[]).map((folder) => ({
    id: folder.id,
    name: folder.name,
    workspaceId: folder.workspace_id,
    order: folder.order
  })) as Folder[];
}

export async function putFolder(folder: Folder): Promise<void> {
  const database = await ensureDb();
  await database.execute(
    'INSERT OR REPLACE INTO folders (id, name, workspace_id, "order") VALUES ($1, $2, $3, $4)',
    [folder.id, folder.name, folder.workspaceId, folder.order ?? 0] // Default to 0 if undefined
  );
}

export async function deleteFolder(id: string): Promise<void> {
  const database = await ensureDb();
  await database.execute('DELETE FROM folders WHERE id = $1', [id]);
}

export async function getNotesByWorkspaceId(workspaceId: string): Promise<Note[]> {
  const database = await ensureDb();
  const result = await database.select(
    'SELECT id, title, content_html, updated_at, workspace_id, folder_id, "order", type, spreadsheet FROM notes WHERE workspace_id = $1 ORDER BY "order"',
    [workspaceId]
  );

  return (result as any[]).map((note) => {
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
  const database = await ensureDb();
  const result = await database.select(
    'SELECT content_html FROM notes WHERE id = $1',
    [noteId]
  );
  return (result as any[])[0]?.content_html || '';
}

export async function putNote(note: Note): Promise<void> {
  const database = await ensureDb();

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
          console.log(`[tauri_db] Preserved existing content for note ${note.id} (${existingContent.length} chars)`);
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn(`[tauri_db] Failed to fetch existing content for note ${note.id}, using empty string:`, e);
      }
    }
  }

  await database.execute(
    'INSERT OR REPLACE INTO notes (id, title, content_html, updated_at, workspace_id, folder_id, "order", type, spreadsheet) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
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
  const database = await ensureDb();
  await database.execute('DELETE FROM notes WHERE id = $1', [id]);
}

export async function getCalendarEventsByWorkspaceId(
  workspaceId: string
): Promise<CalendarEvent[]> {
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM calendarEvents WHERE workspace_id = $1', [
    workspaceId
  ]);

  return (result as any[]).map((event) => ({
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
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM calendarEvents');

  return (result as any[]).map((event) => ({
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
  const database = await ensureDb();
  
  const repeatOnJson = event.repeatOn ? JSON.stringify(event.repeatOn) : null;
  const exceptionsJson = event.exceptions ? JSON.stringify(event.exceptions) : null;
  
  await database.execute(
    'INSERT OR REPLACE INTO calendarEvents (id, date, title, time, workspace_id, repeat, repeat_on, repeat_end, exceptions, color) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
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
  const database = await ensureDb();
  await database.execute('DELETE FROM calendarEvents WHERE id = $1', [id]);
}

export async function getKanbanByWorkspaceId(workspaceId: string): Promise<Kanban | null> {
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM kanban WHERE workspace_id = $1', [
    workspaceId
  ]);

  if (result.length === 0) {
    return null;
  }

  const kanbanRow = result[0] as any;
  return {
    workspaceId: kanbanRow.workspace_id,
    columns: JSON.parse(kanbanRow.columns)
  };
}

export async function putKanban(kanban: Kanban): Promise<void> {
  const database = await ensureDb();
  await database.execute('INSERT OR REPLACE INTO kanban (workspace_id, columns) VALUES ($1, $2)', [
    kanban.workspaceId,
    JSON.stringify(kanban.columns)
  ]);
}

export async function deleteKanban(workspaceId: string): Promise<void> {
  const database = await ensureDb();
  await database.execute('DELETE FROM kanban WHERE workspace_id = $1', [workspaceId]);
}

export async function getSettingByKey(key: string): Promise<Setting | null> {
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM settings WHERE key = $1', [key]);

  if (result.length === 0) {
    return null;
  }

  const settingRow = result[0] as any;
  return {
    key: settingRow.key,
    value: JSON.parse(settingRow.value)
  };
}

export async function putSetting(setting: Setting): Promise<void> {
  const database = await ensureDb();
  await database.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
    setting.key,
    JSON.stringify(setting.value)
  ]);
}

export async function getAllSettings(): Promise<Setting[]> {
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM settings');
  return result.map((row: any) => ({
    key: row.key,
    value: JSON.parse(row.value)
  })) as Setting[];
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
