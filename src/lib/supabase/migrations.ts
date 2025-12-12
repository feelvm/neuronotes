import * as db from '../db';
import { supabase, isSupabaseConfigured } from './client';
import * as sync from './sync';
import type { Workspace, Folder, Note, CalendarEvent, Kanban } from '../db_types';

/**
 * Migrates all local data to Supabase on first login
 */
export async function migrateLocalDataToSupabase(): Promise<{
  success: boolean;
  error?: string;
  migrated: {
    workspaces: number;
    folders: number;
    notes: number;
    events: number;
    kanban: number;
  };
}> {
  if (!isSupabaseConfigured() || !supabase) {
    return {
      success: false,
      error: 'Supabase is not configured',
      migrated: { workspaces: 0, folders: 0, notes: 0, events: 0, kanban: 0 },
    };
  }
  
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    return {
      success: false,
      error: 'Not authenticated',
      migrated: { workspaces: 0, folders: 0, notes: 0, events: 0, kanban: 0 },
    };
  }

  try {
    const { data: existingWorkspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (existingWorkspaces && existingWorkspaces.length > 0) {
      const syncResult = await sync.fullSync();
      return {
        success: syncResult.success,
        error: syncResult.error,
        migrated: { workspaces: 0, folders: 0, notes: 0, events: 0, kanban: 0 },
      };
    }

    const workspaces = await db.getAllWorkspaces();
    const folders: Folder[] = [];
    const notes: Note[] = [];
    const events: CalendarEvent[] = [];
    const kanbanBoards: Kanban[] = [];

    for (const workspace of workspaces) {
      const wsFolders = await db.getFoldersByWorkspaceId(workspace.id);
      folders.push(...wsFolders);

      const wsNotes = await db.getNotesByWorkspaceId(workspace.id);
      notes.push(...wsNotes);

      const wsEvents = await db.getCalendarEventsByWorkspaceId(workspace.id);
      events.push(...wsEvents);

      const wsKanban = await db.getKanbanByWorkspaceId(workspace.id);
      if (wsKanban) {
        kanbanBoards.push(wsKanban);
      }
    }

    const pushResult = await sync.pushToSupabase();

    if (!pushResult.success) {
      return {
        success: false,
        error: pushResult.error,
        migrated: { workspaces: 0, folders: 0, notes: 0, events: 0, kanban: 0 },
      };
    }

    return {
      success: true,
      migrated: {
        workspaces: workspaces.length,
        folders: folders.length,
        notes: notes.length,
        events: events.length,
        kanban: kanbanBoards.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      migrated: { workspaces: 0, folders: 0, notes: 0, events: 0, kanban: 0 },
    };
  }
}

/**
 * Checks if migration is needed
 */
export async function needsMigration(): Promise<boolean> {
  if (!isSupabaseConfigured() || !supabase) return false;
  
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return false;

  const localWorkspaces = await db.getAllWorkspaces();
  if (localWorkspaces.length === 0) return false;

  const { data: supabaseWorkspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('user_id', userId)
    .limit(1);

  return !supabaseWorkspaces || supabaseWorkspaces.length === 0;
}

