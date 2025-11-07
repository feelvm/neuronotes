// src/lib/db_migration.ts
// Migration utility to copy data from IndexedDB to SQLite when switching to Tauri

import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';

// Import IndexedDB functions
import * as indexedDb from './sqlite';
// Import SQLite functions
import * as sqliteDb from './tauri_db';

/**
 * Migrates all data from IndexedDB to SQLite
 * This should be called once when switching from browser to Tauri environment
 */
export async function migrateFromIndexedDBToSQLite(): Promise<void> {
  console.log('[migration] Starting migration from IndexedDB to SQLite...');

  try {
    // Initialize SQLite database
    await sqliteDb.init();
    
    // Check if SQLite already has data
    const existingWorkspaces = await sqliteDb.getAllWorkspaces();
    if (existingWorkspaces.length > 0) {
      console.log('[migration] SQLite already has data, skipping migration');
      return;
    }

    // Try to access IndexedDB (it might not be available in Tauri)
    // Access IndexedDB directly using the browser API
    if (typeof indexedDB === 'undefined') {
      console.log('[migration] IndexedDB not available, nothing to migrate');
      return;
    }

    // Migrate workspaces
    let workspaces: Workspace[] = [];
    try {
      workspaces = await indexedDb.getAll<Workspace>('workspaces');
    } catch (error) {
      console.log('[migration] Could not access IndexedDB workspaces:', error);
      return;
    }
    
    if (workspaces.length === 0) {
      console.log('[migration] No workspaces to migrate');
      return;
    }
    console.log(`[migration] Migrating ${workspaces.length} workspaces...`);
    for (const workspace of workspaces) {
      await sqliteDb.putWorkspace(workspace);
    }

    // Migrate folders
    const folders = await indexedDb.getAll<Folder>('folders');
    console.log(`[migration] Migrating ${folders.length} folders...`);
    for (const folder of folders) {
      await sqliteDb.putFolder(folder);
    }

    // Migrate notes
    const notes = await indexedDb.getAll<Note>('notes');
    console.log(`[migration] Migrating ${notes.length} notes...`);
    for (const note of notes) {
      await sqliteDb.putNote(note);
    }

    // Migrate calendar events
    const calendarEvents = await indexedDb.getAll<CalendarEvent>('calendarEvents');
    console.log(`[migration] Migrating ${calendarEvents.length} calendar events...`);
    for (const event of calendarEvents) {
      await sqliteDb.putCalendarEvent(event);
    }

    // Migrate kanban boards
    const kanbanBoards = await indexedDb.getAll<Kanban>('kanban');
    console.log(`[migration] Migrating ${kanbanBoards.length} kanban boards...`);
    for (const kanban of kanbanBoards) {
      await sqliteDb.putKanban(kanban);
    }

    // Migrate settings
    const settings = await indexedDb.getAll<Setting>('settings');
    console.log(`[migration] Migrating ${settings.length} settings...`);
    for (const setting of settings) {
      await sqliteDb.putSetting(setting);
    }

    console.log('[migration] Migration completed successfully!');
  } catch (error) {
    console.error('[migration] Migration failed:', error);
    throw error;
  }
}

/**
 * Verifies which database is being used and shows statistics
 */
export async function verifyDatabaseStatus(): Promise<{
  isTauri: boolean;
  databaseType: 'SQLite' | 'IndexedDB';
  stats: {
    workspaces: number;
    folders: number;
    notes: number;
    calendarEvents: number;
    kanban: number;
    settings: number;
  };
}> {
  // Check for Tauri using multiple methods
  let isTauri = false;
  if (typeof window !== 'undefined') {
    // Check for __TAURI__ object (Tauri 1.x style)
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__ !== undefined) {
      isTauri = true;
    } else {
      // Try to detect Tauri 2.x by checking if SQL plugin can be imported
      try {
        const Database = await import('@tauri-apps/plugin-sql');
        if (Database && typeof Database.default !== 'undefined') {
          isTauri = true;
        }
      } catch (e) {
        // Import failed, probably not Tauri
      }
    }
  }
  const databaseType = isTauri ? 'SQLite' : 'IndexedDB';

  let stats = {
    workspaces: 0,
    folders: 0,
    notes: 0,
    calendarEvents: 0,
    kanban: 0,
    settings: 0
  };

  try {
    if (isTauri) {
      await sqliteDb.init();
      const workspaces = await sqliteDb.getAllWorkspaces();
      stats.workspaces = workspaces.length;

      if (workspaces.length > 0) {
        const folders = await sqliteDb.getFoldersByWorkspaceId(workspaces[0].id);
        stats.folders = folders.length;

        const notes = await sqliteDb.getNotesByWorkspaceId(workspaces[0].id);
        stats.notes = notes.length;

        const events = await sqliteDb.getCalendarEventsByWorkspaceId(workspaces[0].id);
        stats.calendarEvents = events.length;

        const kanban = await sqliteDb.getKanbanByWorkspaceId(workspaces[0].id);
        stats.kanban = kanban ? 1 : 0;
      }

      // Count all settings
      // Note: This is a simplified check - you might want to add a getAllSettings function
      const activeWorkspaceSetting = await sqliteDb.getSettingByKey('activeWorkspaceId');
      stats.settings = activeWorkspaceSetting ? 1 : 0;
    } else {
      const workspaces = await indexedDb.getAll<Workspace>('workspaces');
      stats.workspaces = workspaces.length;

      if (workspaces.length > 0) {
        const folders = await indexedDb.getAllByIndex<Folder>('folders', 'workspaceId', workspaces[0].id);
        stats.folders = folders.length;

        const notes = await indexedDb.getAllByIndex<Note>('notes', 'workspaceId', workspaces[0].id);
        stats.notes = notes.length;

        const events = await indexedDb.getAllByIndex<CalendarEvent>('calendarEvents', 'workspaceId', workspaces[0].id);
        stats.calendarEvents = events.length;

        const kanban = await indexedDb.get<Kanban>('kanban', workspaces[0].id);
        stats.kanban = kanban ? 1 : 0;
      }

      const settings = await indexedDb.getAll<Setting>('settings');
      stats.settings = settings.length;
    }
  } catch (error) {
    console.error('[verify] Error getting database stats:', error);
  }

  return {
    isTauri,
    databaseType,
    stats
  };
}

