import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';

async function checkIsTauri(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  // First check for the Tauri global - this is the most reliable indicator
  if ('__TAURI__' in window) {
    // Double-check by trying to access the invoke function
    try {
      const tauri = (window as any).__TAURI__;
      if (tauri && typeof tauri.invoke === 'function') {
        return true;
      }
    } catch (e) {
      // If we can't access it, we're not in Tauri
      return false;
    }
  }
  
  // Check for Tauri internals as secondary check
  if ((window as any).__TAURI_INTERNALS__ !== undefined) {
    return true;
  }
  
  // Don't try to import the plugin in browser - it will fail
  // The import might succeed but the actual API won't work
  return false;
}

let isTauri: boolean = false;

interface DbClient {
  init?: () => Promise<void>;
  getAllWorkspaces?: () => Promise<Workspace[]>;
  putWorkspace?: (workspace: Workspace) => Promise<void>;
  deleteWorkspace?: (id: string) => Promise<void>;
  getFoldersByWorkspaceId?: (workspaceId: string) => Promise<Folder[]>;
  putFolder?: (folder: Folder) => Promise<void>;
  deleteFolder?: (id: string) => Promise<void>;
  getNotesByWorkspaceId?: (workspaceId: string) => Promise<Note[]>;
  getNoteContent?: (noteId: string) => Promise<string>;
  putNote?: (note: Note) => Promise<void>;
  deleteNote?: (id: string) => Promise<void>;
  getCalendarEventsByWorkspaceId?: (workspaceId: string) => Promise<CalendarEvent[]>;
  getAllCalendarEvents?: () => Promise<CalendarEvent[]>;
  putCalendarEvent?: (event: CalendarEvent) => Promise<void>;
  deleteCalendarEvent?: (id: string) => Promise<void>;
  getKanbanByWorkspaceId?: (workspaceId: string) => Promise<Kanban | null>;
  putKanban?: (kanban: Kanban) => Promise<void>;
  getSettingByKey?: (key: string) => Promise<Setting | null>;
  putSetting?: (setting: Setting) => Promise<void>;
  get?: <T>(storeName: string, key: string) => Promise<T | undefined>;
  getAll?: <T>(storeName: string) => Promise<T[]>;
  put?: <T>(storeName: string, value: T) => Promise<void>;
  remove?: (storeName: string, key: string) => Promise<void>;
  getAllByIndex?: <T>(storeName: string, indexName: string, query: string) => Promise<T[]>;
}

let dbClient: DbClient | null = null;

export async function init(): Promise<void> {
  isTauri = await checkIsTauri();
  
  if (!dbClient) {
    if (isTauri) {
      console.log('[db] Using Tauri SQLite database');
      const module = await import('./tauri_db');
      dbClient = module;
    } else {
      console.log('[db] Using browser SQLite database (sql.js)');
      const module = await import('./browser_db');
      dbClient = module;
    }
  }

  if (dbClient?.init) {
    await dbClient.init();
  }
}

export async function getAllWorkspaces(): Promise<Workspace[]> {
  await ensureClient();
  if (isTauri && dbClient?.getAllWorkspaces) {
    return await dbClient.getAllWorkspaces();
  } else if (dbClient?.getAll) {
    return await dbClient.getAll('workspaces');
  }
  return [];
}

export async function putWorkspace(workspace: Workspace): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.putWorkspace) {
    await dbClient.putWorkspace(workspace);
  } else if (dbClient?.put) {
    await dbClient.put('workspaces', workspace);
  }
}

export async function deleteWorkspace(id: string): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.deleteWorkspace) {
    await dbClient.deleteWorkspace(id);
  } else if (dbClient?.remove) {
    await dbClient.remove('workspaces', id);
  }
}

export async function getFoldersByWorkspaceId(workspaceId: string): Promise<Folder[]> {
  await ensureClient();
  if (isTauri && dbClient?.getFoldersByWorkspaceId) {
    return await dbClient.getFoldersByWorkspaceId(workspaceId);
  } else if (dbClient?.getAllByIndex) {
    return await dbClient.getAllByIndex('folders', 'workspaceId', workspaceId);
  }
  return [];
}

export async function putFolder(folder: Folder): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.putFolder) {
    await dbClient.putFolder(folder);
  } else if (dbClient?.put) {
    await dbClient.put('folders', folder);
  }
}

export async function deleteFolder(id: string): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.deleteFolder) {
    await dbClient.deleteFolder(id);
  } else if (dbClient?.remove) {
    await dbClient.remove('folders', id);
  }
}

export async function getNotesByWorkspaceId(workspaceId: string): Promise<Note[]> {
  await ensureClient();
  if (isTauri && dbClient?.getNotesByWorkspaceId) {
    return await dbClient.getNotesByWorkspaceId(workspaceId);
  } else if (dbClient?.getAllByIndex) {
    return await dbClient.getAllByIndex('notes', 'workspaceId', workspaceId);
  }
  return [];
}

export async function getNoteContent(noteId: string): Promise<string> {
  await ensureClient();
  if (isTauri && dbClient?.getNoteContent) {
    return await dbClient.getNoteContent(noteId);
  } else if (dbClient?.get) {
    const note = await dbClient.get<Note>('notes', noteId);
    return note?.contentHTML || '';
  }
  return '';
}

export async function putNote(note: Note): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.putNote) {
    await dbClient.putNote(note);
  } else if (dbClient?.put) {
    await dbClient.put('notes', note);
  }
}

export async function deleteNote(id: string): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.deleteNote) {
    await dbClient.deleteNote(id);
  } else if (dbClient?.remove) {
    await dbClient.remove('notes', id);
  }
}

export async function getCalendarEventsByWorkspaceId(
  workspaceId: string
): Promise<CalendarEvent[]> {
  await ensureClient();
  if (isTauri && dbClient?.getCalendarEventsByWorkspaceId) {
    return await dbClient.getCalendarEventsByWorkspaceId(workspaceId);
  } else if (dbClient?.getAllByIndex) {
    return await dbClient.getAllByIndex('calendarEvents', 'workspaceId', workspaceId);
  }
  return [];
}

export async function getAllCalendarEvents(): Promise<CalendarEvent[]> {
  await ensureClient();
  if (isTauri && dbClient?.getAllCalendarEvents) {
    return await dbClient.getAllCalendarEvents();
  } else if (dbClient?.getAllCalendarEvents) {
    return await dbClient.getAllCalendarEvents();
  }
  const workspaces = await getAllWorkspaces();
  const allEvents: CalendarEvent[] = [];
  for (const ws of workspaces) {
    const events = await getCalendarEventsByWorkspaceId(ws.id);
    allEvents.push(...events);
  }
  return allEvents;
}

export async function putCalendarEvent(event: CalendarEvent): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.putCalendarEvent) {
    await dbClient.putCalendarEvent(event);
  } else if (dbClient?.put) {
    await dbClient.put('calendarEvents', event);
  }
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.deleteCalendarEvent) {
    await dbClient.deleteCalendarEvent(id);
  } else if (dbClient?.remove) {
    await dbClient.remove('calendarEvents', id);
  }
}

export async function getKanbanByWorkspaceId(workspaceId: string): Promise<Kanban | null> {
  await ensureClient();
  if (isTauri && dbClient?.getKanbanByWorkspaceId) {
    return await dbClient.getKanbanByWorkspaceId(workspaceId);
  } else if (dbClient?.get) {
    return (await dbClient.get('kanban', workspaceId)) ?? null;
  }
  return null;
}

export async function putKanban(kanban: Kanban): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.putKanban) {
    await dbClient.putKanban(kanban);
  } else if (dbClient?.put) {
    await dbClient.put('kanban', kanban);
  }
}

export async function getSettingByKey(key: string): Promise<Setting | null> {
  await ensureClient();
  if (isTauri && dbClient?.getSettingByKey) {
    return await dbClient.getSettingByKey(key);
  } else if (dbClient?.get) {
    return (await dbClient.get('settings', key)) ?? null;
  }
  return null;
}

export async function putSetting(setting: Setting): Promise<void> {
  await ensureClient();
  if (isTauri && dbClient?.putSetting) {
    await dbClient.putSetting(setting);
  } else if (dbClient?.put) {
    await dbClient.put('settings', setting);
  }
}

export async function getAllSettings(): Promise<Setting[]> {
  await ensureClient();
  if (isTauri) {
    const tauriDb = await import('./tauri_db');
    return await tauriDb.getAllSettings();
  } else {
    const browserDb = await import('./browser_db');
    return await browserDb.getAllSettings();
  }
}

export async function get<T>(storeName: string, key: string): Promise<T | undefined> {
  await ensureClient();
  switch (storeName) {
    case 'settings':
      const setting = await getSettingByKey(key);
      return setting as T | undefined;
    case 'kanban':
      const kanban = await getKanbanByWorkspaceId(key);
      return kanban as T | undefined;
    default:
      if (dbClient?.get) {
        return await dbClient.get(storeName, key);
      }
      return undefined;
  }
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  await ensureClient();
  switch (storeName) {
    case 'workspaces':
      const workspaces = await getAllWorkspaces();
      return workspaces as T[];
    case 'settings':
      if (dbClient?.getAll) {
        return await dbClient.getAll(storeName);
      }
      return [];
    default:
      if (dbClient?.getAll) {
        return await dbClient.getAll(storeName);
      }
      return [];
  }
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  await ensureClient();
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
      if (dbClient?.put) {
        await dbClient.put(storeName, value);
      }
  }
}

export async function remove(storeName: string, key: string): Promise<void> {
  await ensureClient();
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
      if (dbClient?.remove) {
        await dbClient.remove(storeName, key);
      }
  }
}

export async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  query: string
): Promise<T[]> {
  await ensureClient();
  switch (storeName) {
    case 'folders':
      if (indexName === 'workspaceId') {
        const folders = await getFoldersByWorkspaceId(query);
        return folders as T[];
      }
      break;
    case 'notes':
      if (indexName === 'workspaceId') {
        const notes = await getNotesByWorkspaceId(query);
        return notes as T[];
      }
      break;
    case 'calendarEvents':
      if (indexName === 'workspaceId') {
        const events = await getCalendarEventsByWorkspaceId(query);
        return events as T[];
      }
      break;
  }

  if (dbClient?.getAllByIndex) {
    return await dbClient.getAllByIndex(storeName, indexName, query);
  }
  return [];
}

async function ensureClient(): Promise<void> {
  isTauri = await checkIsTauri();
  
  if (!dbClient) {
    if (isTauri) {
      const module = await import('./tauri_db');
      dbClient = module;
    } else {
      const module = await import('./browser_db');
      dbClient = module;
    }
  }
}

export { isTauri };

/**
 * Clear all local data (useful when switching users)
 */
export async function clearAllLocalData(): Promise<void> {
  await ensureClient();
  
  console.log('[db] Starting to clear all local data...');
  
  // Get all workspaces first
  const workspaces = await getAllWorkspaces();
  console.log(`[db] Found ${workspaces.length} workspaces to clear`);
  
  // Delete all data for each workspace
  for (const workspace of workspaces) {
    console.log(`[db] Clearing workspace: ${workspace.id}`);
    
    // Delete folders
    const folders = await getFoldersByWorkspaceId(workspace.id);
    console.log(`[db] Deleting ${folders.length} folders`);
    for (const folder of folders) {
      await deleteFolder(folder.id);
    }
    
    // Delete notes
    const notes = await getNotesByWorkspaceId(workspace.id);
    console.log(`[db] Deleting ${notes.length} notes`);
    for (const note of notes) {
      await deleteNote(note.id);
    }
    
    // Delete calendar events
    const events = await getCalendarEventsByWorkspaceId(workspace.id);
    console.log(`[db] Deleting ${events.length} calendar events`);
    for (const event of events) {
      await deleteCalendarEvent(event.id);
    }
    
    // Delete kanban
    try {
      if (isTauri) {
        const tauriDb = await import('./tauri_db');
        if ((tauriDb as any).deleteKanban) {
          await (tauriDb as any).deleteKanban(workspace.id);
        }
      } else {
        const browserDb = await import('./browser_db');
        if ((browserDb as any).deleteKanban) {
          await (browserDb as any).deleteKanban(workspace.id);
        }
      }
    } catch (e) {
      console.warn('Failed to delete kanban:', e);
    }
    
    // Delete workspace
    await deleteWorkspace(workspace.id);
  }
  
  // Also delete all notes directly (in case some weren't associated with workspaces)
  try {
    if (isTauri) {
      const tauriDb = await import('./tauri_db');
      const database = await (tauriDb as any).ensureDb();
      await database.execute('DELETE FROM notes');
      await database.execute('DELETE FROM folders');
      await database.execute('DELETE FROM calendarEvents');
      await database.execute('DELETE FROM kanban');
      await database.execute('DELETE FROM workspaces');
    } else {
      const browserDb = await import('./browser_db');
      await (browserDb as any).execute('DELETE FROM notes');
      await (browserDb as any).execute('DELETE FROM folders');
      await (browserDb as any).execute('DELETE FROM calendarEvents');
      await (browserDb as any).execute('DELETE FROM kanban');
      await (browserDb as any).execute('DELETE FROM workspaces');
    }
  } catch (e) {
    console.warn('[db] Failed to perform direct table cleanup:', e);
  }
  
  // Clear user-specific settings (keep system settings)
  if (dbClient?.getAll) {
    const settings = await dbClient.getAll('settings');
    for (const setting of settings) {
      // Keep system settings, delete user-specific ones
      if (setting.key.startsWith('selectedNoteId:') || setting.key === 'activeWorkspaceId' || setting.key === 'useCommonCalendar') {
        if (dbClient?.remove) {
          await dbClient.remove('settings', setting.key);
        }
      }
    }
  }
  
  console.log('[db] Cleared all local data');
}

export async function verifyDatabaseStatus() {
  await ensureClient();
  const workspaces = await getAllWorkspaces();
  const stats = {
    isTauri,
    databaseType: 'SQLite' as const,
    stats: {
      workspaces: workspaces.length,
      folders: 0,
      notes: 0,
      calendarEvents: 0,
      kanban: 0,
      settings: 0
    }
  };
  
  if (workspaces.length > 0) {
    stats.stats.folders = (await getFoldersByWorkspaceId(workspaces[0].id)).length;
    stats.stats.notes = (await getNotesByWorkspaceId(workspaces[0].id)).length;
    stats.stats.calendarEvents = (await getCalendarEventsByWorkspaceId(workspaces[0].id)).length;
    const kanban = await getKanbanByWorkspaceId(workspaces[0].id);
    stats.stats.kanban = kanban ? 1 : 0;
  }
  
  if (dbClient?.getAll) {
    const settings = await dbClient.getAll('settings');
    stats.stats.settings = settings.length;
  }
  
  console.log('[db] Database Status:', stats);
  console.log('[db] Current isTauri value:', isTauri);
  if (typeof window !== 'undefined') {
    console.log('[db] window.__TAURI__ exists:', '__TAURI__' in window);
    console.log('[db] window location:', window.location.href);
  }
  return stats;
}

export async function debugTauriDetection() {
  console.log('=== Tauri Detection Debug ===');
  console.log('window exists:', typeof window !== 'undefined');
  if (typeof window !== 'undefined') {
    console.log('window.__TAURI__:', '__TAURI__' in window);
    console.log('window.__TAURI_INTERNALS__:', (window as any).__TAURI_INTERNALS__ !== undefined);
    console.log('window.location:', window.location.href);
    try {
      const Database = await import('@tauri-apps/plugin-sql');
      console.log('SQL plugin import successful:', !!Database);
    } catch (e) {
      console.log('SQL plugin import failed:', e);
    }
  }
  const detected = await checkIsTauri();
  console.log('Final detection result:', detected);
  return detected;
}

if (typeof window !== 'undefined') {
  (window as any).verifyDatabase = verifyDatabaseStatus;
  (window as any).debugTauri = debugTauriDetection;
}
