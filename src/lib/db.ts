import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';
import * as browserDb from './browser_db';

let initPromise: Promise<void> | null = null;

async function ensureClient(): Promise<void> {
  if (!initPromise) {
    initPromise = browserDb.init();
  }
  await initPromise;
}

export async function init(): Promise<void> {
  await ensureClient();
}

export async function getAllWorkspaces(): Promise<Workspace[]> {
  await ensureClient();
  return await browserDb.getAllWorkspaces();
}

export async function putWorkspace(workspace: Workspace): Promise<void> {
  await ensureClient();
  await browserDb.putWorkspace(workspace);
}

export async function deleteWorkspace(id: string): Promise<void> {
  await ensureClient();
  await browserDb.deleteWorkspace(id);
}

export async function getFoldersByWorkspaceId(workspaceId: string): Promise<Folder[]> {
  await ensureClient();
  return await browserDb.getFoldersByWorkspaceId(workspaceId);
}

export async function putFolder(folder: Folder): Promise<void> {
  await ensureClient();
  await browserDb.putFolder(folder);
}

export async function deleteFolder(id: string): Promise<void> {
  await ensureClient();
  await browserDb.deleteFolder(id);
}

export async function getNotesByWorkspaceId(workspaceId: string): Promise<Note[]> {
  await ensureClient();
  return await browserDb.getNotesByWorkspaceId(workspaceId);
}

export async function getNoteContent(noteId: string): Promise<string> {
  await ensureClient();
  return await browserDb.getNoteContent(noteId);
}

export async function putNote(note: Note): Promise<void> {
  await ensureClient();
  await browserDb.putNote(note);
}

export async function deleteNote(id: string): Promise<void> {
  await ensureClient();
  await browserDb.deleteNote(id);
}

export async function getCalendarEventsByWorkspaceId(
  workspaceId: string
): Promise<CalendarEvent[]> {
  await ensureClient();
  return await browserDb.getCalendarEventsByWorkspaceId(workspaceId);
}

export async function getAllCalendarEvents(): Promise<CalendarEvent[]> {
  await ensureClient();
  return await browserDb.getAllCalendarEvents();
}

export async function putCalendarEvent(event: CalendarEvent): Promise<void> {
  await ensureClient();
  await browserDb.putCalendarEvent(event);
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  await ensureClient();
  await browserDb.deleteCalendarEvent(id);
}

export async function getKanbanByWorkspaceId(workspaceId: string): Promise<Kanban | null> {
  await ensureClient();
  return await browserDb.getKanbanByWorkspaceId(workspaceId);
}

export async function putKanban(kanban: Kanban): Promise<void> {
  await ensureClient();
  await browserDb.putKanban(kanban);
}

export async function deleteKanban(workspaceId: string): Promise<void> {
  await ensureClient();
  await browserDb.deleteKanban(workspaceId);
}

export async function getSettingByKey(key: string): Promise<Setting | null> {
  await ensureClient();
  return await browserDb.getSettingByKey(key);
}

export async function putSetting(setting: Setting): Promise<void> {
  await ensureClient();
  await browserDb.putSetting(setting);
}

export async function getAllSettings(): Promise<Setting[]> {
  await ensureClient();
  return await browserDb.getAllSettings();
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
      return await browserDb.get<T>(storeName, key);
  }
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  await ensureClient();
  switch (storeName) {
    case 'workspaces':
      const workspaces = await getAllWorkspaces();
      return workspaces as T[];
    case 'settings':
      const settings = await getAllSettings();
      return settings as T[];
    default:
      return await browserDb.getAll<T>(storeName);
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
      await browserDb.put(storeName, value);
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
      await browserDb.remove(storeName, key);
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

  return await browserDb.getAllByIndex<T>(storeName, indexName, query);
}

/**
 * Clear all local data (useful when switching users)
 */
export async function clearAllLocalData(): Promise<void> {
  await ensureClient();
  
  // Get all workspaces first
  const workspaces = await getAllWorkspaces();
  
  // Delete all data for each workspace
  for (const workspace of workspaces) {
    // Delete folders
    const folders = await getFoldersByWorkspaceId(workspace.id);
    for (const folder of folders) {
      await deleteFolder(folder.id);
    }
    
    // Delete notes
    const notes = await getNotesByWorkspaceId(workspace.id);
    for (const note of notes) {
      await deleteNote(note.id);
    }
    
    // Delete calendar events
    const events = await getCalendarEventsByWorkspaceId(workspace.id);
    for (const event of events) {
      await deleteCalendarEvent(event.id);
    }
    
    // Delete kanban
    await deleteKanban(workspace.id);
    
    // Delete workspace
    await deleteWorkspace(workspace.id);
  }
  
  // Also delete all notes directly (in case some weren't associated with workspaces)
  await browserDb.execute('DELETE FROM notes');
  await browserDb.execute('DELETE FROM folders');
  await browserDb.execute('DELETE FROM calendarEvents');
  await browserDb.execute('DELETE FROM kanban');
  await browserDb.execute('DELETE FROM workspaces');
  
  // Clear user-specific settings (keep system settings)
  const settings = await browserDb.getAll<Setting>('settings');
  for (const setting of settings) {
    // Keep system settings, delete user-specific ones
    if (setting.key.startsWith('selectedNoteId:') || setting.key === 'activeWorkspaceId' || setting.key === 'useCommonCalendar') {
      await browserDb.remove('settings', setting.key);
    }
  }
}

export async function verifyDatabaseStatus() {
  await ensureClient();
  const workspaces = await getAllWorkspaces();
  const stats = {
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
  
  const settings = await browserDb.getAll('settings');
  stats.stats.settings = settings.length;
  
  return stats;
}

// Export function to flush pending database saves (browser only)
export async function flushDatabaseSave(): Promise<void> {
  await ensureClient();
  browserDb.flushDatabaseSave();
}

if (typeof window !== 'undefined') {
  (window as any).verifyDatabase = verifyDatabaseStatus;
}
