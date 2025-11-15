import { supabase, isSupabaseConfigured } from './client';
import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from '../db_types';
import * as db from '../db';

// Re-export supabase for migrations
export { supabase };

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  error: string | null;
}

let syncStatus: SyncStatus = {
  isSyncing: false,
  lastSyncAt: null,
  error: null,
};

const syncStatusListeners = new Set<(status: SyncStatus) => void>();

export function subscribeToSyncStatus(callback: (status: SyncStatus) => void) {
  syncStatusListeners.add(callback);
  callback(syncStatus);
  return () => {
    syncStatusListeners.delete(callback);
  };
}

function updateSyncStatus(updates: Partial<SyncStatus>) {
  syncStatus = { ...syncStatus, ...updates };
  syncStatusListeners.forEach(callback => callback(syncStatus));
}

/**
 * Convert local timestamp (number) to ISO string for Supabase
 */
function toISOString(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Convert ISO string from Supabase to local timestamp (number)
 */
function toTimestamp(isoString: string): number {
  return new Date(isoString).getTime();
}

/**
 * Push all local data to Supabase
 */
export async function pushToSupabase(): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured() || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }
  
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    return { success: false, error: 'Not authenticated' };
  }

  updateSyncStatus({ isSyncing: true, error: null });

  try {
    // Push workspaces and handle deletions
    const workspaces = await db.getAllWorkspaces();
    const localWorkspaceIds = new Set(workspaces.map(w => w.id));
    
    // Get all workspaces from Supabase
    const { data: supabaseWorkspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId);
    
    // Delete workspaces from Supabase that don't exist locally
    if (supabaseWorkspaces) {
      for (const supabaseWorkspace of supabaseWorkspaces) {
        if (!localWorkspaceIds.has(supabaseWorkspace.id)) {
          // Delete workspace and all its related data
          await supabase.from('workspaces').delete().eq('id', supabaseWorkspace.id).eq('user_id', userId);
          // Note: Related data (notes, folders, events, kanban) should be deleted via CASCADE or separately
        }
      }
    }
    
    // Upsert existing workspaces
    for (const workspace of workspaces) {
      await supabase
        .from('workspaces')
        .upsert({
          id: workspace.id,
          user_id: userId,
          name: workspace.name,
          order: workspace.order,
          updated_at: toISOString(Date.now()),
        });
    }

    // Push folders and handle deletions
    for (const workspace of workspaces) {
      const folders = await db.getFoldersByWorkspaceId(workspace.id);
      const localFolderIds = new Set(folders.map(f => f.id));
      
      // Get all folders from Supabase for this workspace
      const { data: supabaseFolders } = await supabase
        .from('folders')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);
      
      // Delete folders from Supabase that don't exist locally
      if (supabaseFolders) {
        for (const supabaseFolder of supabaseFolders) {
          if (!localFolderIds.has(supabaseFolder.id)) {
            await supabase.from('folders').delete().eq('id', supabaseFolder.id).eq('user_id', userId);
          }
        }
      }
      
      // Upsert existing folders
      for (const folder of folders) {
        await supabase
          .from('folders')
          .upsert({
            id: folder.id,
            user_id: userId,
            workspace_id: folder.workspaceId,
            name: folder.name,
            order: folder.order,
            updated_at: toISOString(Date.now()),
          });
      }
    }

    // Push notes and handle deletions
    for (const workspace of workspaces) {
      const notes = await db.getNotesByWorkspaceId(workspace.id);
      const localNoteIds = new Set(notes.map(n => n.id));
      
      // Get all notes from Supabase for this workspace
      const { data: supabaseNotes } = await supabase
        .from('notes')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);
      
      // Delete notes from Supabase that don't exist locally
      if (supabaseNotes) {
        for (const supabaseNote of supabaseNotes) {
          if (!localNoteIds.has(supabaseNote.id)) {
            // Delete note and its content from Supabase
            await supabase.from('notes').delete().eq('id', supabaseNote.id).eq('user_id', userId);
            await supabase.from('note_content').delete().eq('note_id', supabaseNote.id).eq('user_id', userId);
          }
        }
      }
      
      // Upsert existing notes
      for (const note of notes) {
        // Ensure we have the latest content - get it from DB if note doesn't have it
        let contentHTML = note.contentHTML;
        if (!contentHTML || contentHTML === '') {
          try {
            contentHTML = await db.getNoteContent(note.id);
          } catch (e) {
            console.warn(`Failed to get content for note ${note.id}:`, e);
          }
        }
        
        // Handle spreadsheet data - check both spreadsheet and _spreadsheetJson
        const noteWithRaw = note as any;
        let spreadsheetData: any = null;
        if (note.type === 'spreadsheet') {
          if (note.spreadsheet) {
            // If it's an object, stringify it; if it's already a string, parse then stringify to ensure it's valid JSON
            if (typeof note.spreadsheet === 'string') {
              try {
                // Parse to validate, then stringify to ensure proper format
                spreadsheetData = JSON.parse(note.spreadsheet);
              } catch (e) {
                // If parsing fails, use as-is (might be malformed)
                spreadsheetData = note.spreadsheet;
              }
            } else {
              spreadsheetData = note.spreadsheet;
            }
          } else if (noteWithRaw._spreadsheetJson) {
            // If spreadsheet is not set but _spreadsheetJson is, parse it
            try {
              spreadsheetData = typeof noteWithRaw._spreadsheetJson === 'string' 
                ? JSON.parse(noteWithRaw._spreadsheetJson)
                : noteWithRaw._spreadsheetJson;
            } catch (e) {
              console.warn(`Failed to parse spreadsheet JSON for note ${note.id}:`, e);
            }
          }
        }
        
        // Insert/update note metadata
        await supabase
          .from('notes')
          .upsert({
            id: note.id,
            user_id: userId,
            workspace_id: note.workspaceId,
            folder_id: note.folderId,
            title: note.title,
            content_html: contentHTML || null,
            spreadsheet: spreadsheetData,
            type: note.type,
            order: note.order,
            updated_at: toISOString(note.updatedAt),
          });

        // Update note content separately if it exists
        if (contentHTML) {
          await supabase
            .from('note_content')
            .upsert({
              note_id: note.id,
              user_id: userId,
              content_html: contentHTML,
              updated_at: toISOString(note.updatedAt),
            });
        }
      }
    }

    // Push calendar events and handle deletions
    for (const workspace of workspaces) {
      const events = await db.getCalendarEventsByWorkspaceId(workspace.id);
      const localEventIds = new Set(events.map(e => e.id));
      
      // Get all events from Supabase for this workspace
      const { data: supabaseEvents } = await supabase
        .from('calendar_events')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);
      
      // Delete events from Supabase that don't exist locally
      if (supabaseEvents) {
        for (const supabaseEvent of supabaseEvents) {
          if (!localEventIds.has(supabaseEvent.id)) {
            await supabase.from('calendar_events').delete().eq('id', supabaseEvent.id).eq('user_id', userId);
          }
        }
      }
      
      // Upsert existing events
      for (const event of events) {
        await supabase
          .from('calendar_events')
          .upsert({
            id: event.id,
            user_id: userId,
            workspace_id: event.workspaceId,
            date: event.date,
            title: event.title,
            time: event.time || null,
            repeat: event.repeat || null,
            repeat_on: event.repeatOn || null,
            repeat_end: event.repeatEnd || null,
            exceptions: event.exceptions || null,
            color: event.color || null,
            updated_at: toISOString(Date.now()),
          });
      }
    }

    // Push kanban
    for (const workspace of workspaces) {
      const kanbanData = await db.getKanbanByWorkspaceId(workspace.id);
      if (kanbanData) {
        await supabase
          .from('kanban')
          .upsert({
            workspace_id: workspace.id,
            user_id: userId,
            columns: JSON.parse(JSON.stringify(kanbanData.columns)),
            updated_at: toISOString(Date.now()),
          });
      }
    }

    // Push settings (user-specific)
    // Note: This is a simplified approach. You may want to filter which settings to sync.
    const allSettings = await db.getAllSettings();
    for (const setting of allSettings) {
      // Only sync non-workspace-specific settings or handle them differently
      if (!setting.key.includes(':')) {
        await supabase
          .from('settings')
          .upsert({
            user_id: userId,
            key: setting.key,
            value: setting.value,
            updated_at: toISOString(Date.now()),
          });
      }
    }

    updateSyncStatus({ isSyncing: false, lastSyncAt: new Date(), error: null });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    updateSyncStatus({ isSyncing: false, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Pull all data from Supabase to local
 */
export async function pullFromSupabase(): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured() || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }
  
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    return { success: false, error: 'Not authenticated' };
  }

  updateSyncStatus({ isSyncing: true, error: null });

  try {
    // Pull workspaces
    const { data: workspaces, error: workspacesError } = await supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', userId)
      .order('order');

    if (workspacesError) throw workspacesError;

    if (workspaces) {
      for (const ws of workspaces) {
        await db.putWorkspace({
          id: ws.id,
          name: ws.name,
          order: ws.order,
        });
      }
    }

    // Pull folders
    const { data: folders, error: foldersError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', userId)
      .order('order');

    if (foldersError) throw foldersError;

    if (folders) {
      for (const folder of folders) {
        await db.putFolder({
          id: folder.id,
          name: folder.name,
          workspaceId: folder.workspace_id,
          order: folder.order,
        });
      }
    }

    // Pull notes
    const { data: notes, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('order');

    if (notesError) throw notesError;

    if (notes) {
      for (const note of notes) {
        // Get content from note_content table
        const { data: contentData } = await supabase
          .from('note_content')
          .select('content_html')
          .eq('note_id', note.id)
          .eq('user_id', userId)
          .single();

        const contentHTML = contentData?.content_html || note.content_html || '';

        // Handle spreadsheet data - Supabase returns it as JSON object, need to stringify for local DB
        let spreadsheetData: any = undefined;
        if (note.type === 'spreadsheet' && note.spreadsheet) {
          // If it's already an object, stringify it; if it's a string, use it as-is
          if (typeof note.spreadsheet === 'string') {
            spreadsheetData = note.spreadsheet;
          } else {
            spreadsheetData = JSON.stringify(note.spreadsheet);
          }
        }

        // Ensure type is set correctly - default to 'text' if missing or invalid
        let noteType: 'text' | 'spreadsheet' = 'text';
        if (note.type === 'spreadsheet' && spreadsheetData) {
          noteType = 'spreadsheet';
        } else if (note.type === 'text' || !note.type) {
          noteType = 'text';
        } else {
          // If type is something else or spreadsheet but no data, default to text
          noteType = 'text';
        }

        await db.putNote({
          id: note.id,
          title: note.title,
          contentHTML: contentHTML,
          updatedAt: toTimestamp(note.updated_at),
          workspaceId: note.workspace_id,
          folderId: note.folder_id,
          order: note.order,
          type: noteType,
          spreadsheet: noteType === 'spreadsheet' ? spreadsheetData : undefined, // Only set if type is spreadsheet
        });
      }
    }

    // Pull calendar events
    const { data: events, error: eventsError } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', userId);

    if (eventsError) throw eventsError;

    if (events) {
      for (const event of events) {
        await db.putCalendarEvent({
          id: event.id,
          date: event.date,
          title: event.title,
          time: event.time || undefined,
          workspaceId: event.workspace_id,
          repeat: event.repeat as any,
          repeatOn: event.repeat_on || undefined,
          repeatEnd: event.repeat_end || undefined,
          exceptions: event.exceptions || undefined,
          color: event.color || undefined,
        });
      }
    }

    // Pull kanban
    const { data: kanbanData, error: kanbanError } = await supabase
      .from('kanban')
      .select('*')
      .eq('user_id', userId);

    if (kanbanError) throw kanbanError;

    if (kanbanData) {
      for (const kanban of kanbanData) {
        await db.putKanban({
          workspaceId: kanban.workspace_id,
          columns: kanban.columns as any,
        });
      }
    }

    // Pull settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId);

    if (settingsError) throw settingsError;

    if (settings) {
      for (const setting of settings) {
        await db.putSetting({
          key: setting.key,
          value: setting.value,
        });
      }
    }

    updateSyncStatus({ isSyncing: false, lastSyncAt: new Date(), error: null });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    updateSyncStatus({ isSyncing: false, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Full sync: pull then push (to handle conflicts)
 */
export async function fullSync(): Promise<{ success: boolean; error?: string }> {
  // Pull first to get latest from server
  const pullResult = await pullFromSupabase();
  if (!pullResult.success) {
    return pullResult;
  }

  // Then push local changes
  const pushResult = await pushToSupabase();
  return pushResult;
}

/**
 * Get current sync status
 */
export function getSyncStatus(): SyncStatus {
  return { ...syncStatus };
}

