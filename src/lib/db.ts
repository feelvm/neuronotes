// src/lib/db.ts
// Database abstraction layer that works in both Tauri and browser environments

import { browser } from '$app/environment';
import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';

// Check if running in Tauri environment
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

// Database client interface
interface DbClient {
  init?: () => Promise<void>;
  getAllWorkspaces?: () => Promise<Workspace[]>;
  putWorkspace?: (workspace: Workspace) => Promise<void>;
  deleteWorkspace?: (id: string) => Promise<void>;
  getFoldersByWorkspaceId?: (workspaceId: string) => Promise<Folder[]>;
  putFolder?: (folder: Folder) => Promise<void>;
  deleteFolder?: (id: string) => Promise<void>;
  getNotesByWorkspaceId?: (workspaceId: string) => Promise<Note[]>;
  putNote?: (note: Note) => Promise<void>;
  deleteNote?: (id: string) => Promise<void>;
  getCalendarEventsByWorkspaceId?: (workspaceId: string) => Promise<CalendarEvent[]>;
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

// Database client instance
let dbClient: DbClient | null = null;

// --- Database Initialization ---

export async function init(): Promise<void> {
  if (!dbClient) {
    if (isTauri) {
      const module = await import('./tauri_db');
      dbClient = module;
    } else {
      const module = await import('./sqlite');
      dbClient = module;
    }
  }

  if (dbClient?.init) {
    await dbClient.init();
  }
}

// --- Workspace Operations ---

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

// --- Folder Operations ---

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

// --- Note Operations ---

export async function getNotesByWorkspaceId(workspaceId: string): Promise<Note[]> {
  await ensureClient();
  if (isTauri && dbClient?.getNotesByWorkspaceId) {
    return await dbClient.getNotesByWorkspaceId(workspaceId);
  } else if (dbClient?.getAllByIndex) {
    return await dbClient.getAllByIndex('notes', 'workspaceId', workspaceId);
  }
  return [];
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

// --- Calendar Event Operations ---

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

// --- Kanban Operations ---

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

// --- Settings Operations ---

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

// --- Legacy API for backward compatibility ---

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

// --- Helper Functions ---

async function ensureClient(): Promise<void> {
  if (!dbClient) {
    if (isTauri) {
      const module = await import('./tauri_db');
      dbClient = module;
    } else {
      const module = await import('./sqlite');
      dbClient = module;
    }
  }
}

// Export the check for Tauri environment
export { isTauri };
