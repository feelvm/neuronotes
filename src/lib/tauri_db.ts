// src/lib/tauri_db.ts
// Tauri SQLite database client using the SQL plugin's JavaScript API

import Database from '@tauri-apps/plugin-sql';
import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';

// Database instance
let db: Database | null = null;

// --- Database Initialization ---

/**
 * Initialize the database connection and run migrations
 */
export async function init(): Promise<void> {
  if (!db) {
    try {
      // Load the SQLite database - path is relative to app data directory
      db = await Database.load('sqlite:neuronotes.db');
      console.log('[tauri_db] SQLite database initialized successfully');
    } catch (error) {
      console.error('[tauri_db] Failed to initialize SQLite database:', error);
      throw error;
    }
  }
}

// --- Helper function to ensure database is initialized ---
async function ensureDb(): Promise<Database> {
  if (!db) {
    await init();
  }
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

// --- Workspace Operations ---

export async function getAllWorkspaces(): Promise<Workspace[]> {
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM workspaces ORDER BY "order"');
  return result as Workspace[];
}

export async function putWorkspace(workspace: Workspace): Promise<void> {
  const database = await ensureDb();
  await database.execute(
    'INSERT OR REPLACE INTO workspaces (id, name, "order") VALUES ($1, $2, $3)',
    [workspace.id, workspace.name, workspace.order]
  );
}

export async function deleteWorkspace(id: string): Promise<void> {
  const database = await ensureDb();
  await database.execute('DELETE FROM workspaces WHERE id = $1', [id]);
}

// --- Folder Operations ---

export async function getFoldersByWorkspaceId(workspaceId: string): Promise<Folder[]> {
  const database = await ensureDb();
  const result = await database.select(
    'SELECT * FROM folders WHERE workspace_id = $1 ORDER BY "order"',
    [workspaceId]
  );
  // Map database fields (snake_case) to TypeScript naming (camelCase)
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
    [folder.id, folder.name, folder.workspaceId, folder.order]
  );
}

export async function deleteFolder(id: string): Promise<void> {
  const database = await ensureDb();
  await database.execute('DELETE FROM folders WHERE id = $1', [id]);
}

// --- Note Operations ---

export async function getNotesByWorkspaceId(workspaceId: string): Promise<Note[]> {
  const database = await ensureDb();
  // Only load metadata initially, not contentHTML - lazy load it when note is opened
  // This saves significant memory when many notes with large content exist
  const result = await database.select(
    'SELECT id, title, updated_at, workspace_id, folder_id, "order", type, spreadsheet FROM notes WHERE workspace_id = $1 ORDER BY "order"',
    [workspaceId]
  );

  // Don't parse spreadsheet JSON immediately - lazy load it when note is opened
  // This saves significant memory when many spreadsheets exist
  // We store the raw JSON string in a hidden property and parse it on demand
  return (result as any[]).map((note) => {
    const mappedNote: any = {
      ...note,
      // Map database fields to TypeScript naming
      contentHTML: '', // Will be loaded lazily when note is opened
      updatedAt: note.updated_at,
      workspaceId: note.workspace_id,
      folderId: note.folder_id,
      type: note.type,
      // Only set spreadsheet if note type is spreadsheet, otherwise undefined
      spreadsheet: note.type === 'spreadsheet' && note.spreadsheet ? undefined : undefined,
      // Store raw spreadsheet JSON string for lazy parsing
      _spreadsheetJson: note.type === 'spreadsheet' && note.spreadsheet ? note.spreadsheet : undefined,
      // Mark that contentHTML needs to be loaded
      _contentLoaded: false
    };
    return mappedNote;
  }) as Note[];
}

// Load full note content (including contentHTML) when needed
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

  // Convert spreadsheet to JSON string if it exists
  // Handle both string (from lazy loading) and object (parsed) formats
  let spreadsheetJson: string | null = null;
  const noteWithRaw = note as any;
  
  // Check if we have a parsed spreadsheet
  if (note.spreadsheet) {
    if (typeof note.spreadsheet === 'string') {
      spreadsheetJson = note.spreadsheet; // Already a string
    } else {
      spreadsheetJson = JSON.stringify(note.spreadsheet); // Parse object to string
    }
  } else if (noteWithRaw._spreadsheetJson) {
    // Fallback to raw JSON if spreadsheet hasn't been parsed yet
    spreadsheetJson = noteWithRaw._spreadsheetJson;
  }

  await database.execute(
    'INSERT OR REPLACE INTO notes (id, title, content_html, updated_at, workspace_id, folder_id, "order", type, spreadsheet) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      note.id,
      note.title,
      note.contentHTML,
      note.updatedAt,
      note.workspaceId,
      note.folderId,
      note.order,
      note.type,
      spreadsheetJson
    ]
  );
}

export async function deleteNote(id: string): Promise<void> {
  const database = await ensureDb();
  await database.execute('DELETE FROM notes WHERE id = $1', [id]);
}

// --- Calendar Event Operations ---

export async function getCalendarEventsByWorkspaceId(
  workspaceId: string
): Promise<CalendarEvent[]> {
  const database = await ensureDb();
  const result = await database.select('SELECT * FROM calendarEvents WHERE workspace_id = $1', [
    workspaceId
  ]);

  // Map database fields to TypeScript naming and parse JSON fields
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
  
  // Convert arrays to JSON strings for storage
  const repeatOnJson = event.repeatOn ? JSON.stringify(event.repeatOn) : null;
  const exceptionsJson = event.exceptions ? JSON.stringify(event.exceptions) : null;
  
  await database.execute(
    'INSERT OR REPLACE INTO calendarEvents (id, date, title, time, workspace_id, repeat, repeat_on, repeat_end, exceptions, color) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [
      event.id, 
      event.date, 
      event.title, 
      event.time, 
      event.workspaceId,
      event.repeat || 'none',
      repeatOnJson,
      event.repeatEnd,
      exceptionsJson,
      event.color || null
    ]
  );
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const database = await ensureDb();
  await database.execute('DELETE FROM calendarEvents WHERE id = $1', [id]);
}

// --- Kanban Operations ---

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

// --- Settings Operations ---

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

// --- Legacy API for backward compatibility ---

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
