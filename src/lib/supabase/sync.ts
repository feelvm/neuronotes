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
      console.log(`[sync] Pushing ${notes.length} notes for workspace ${workspace.id}`);
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
      
      // Get all remote note timestamps in one query for conflict resolution
      const noteIds = notes.map(n => n.id);
      const { data: remoteNotes } = await supabase
        .from('notes')
        .select('id, updated_at')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .in('id', noteIds);
      
      const remoteNotesMap = new Map(
        (remoteNotes || []).map(n => [n.id, n.updated_at ? toTimestamp(n.updated_at) : 0])
      );
      
      // Upsert existing notes with conflict resolution
      for (const note of notes) {
        // Check if remote version exists and is newer
        const remoteUpdatedAt = remoteNotesMap.get(note.id);
        
        // For any note type, always push if local was updated recently (within last 5 seconds)
        // This ensures that local edits get synced even if remote appears newer
        const isRecentEdit = (Date.now() - note.updatedAt) < 5000;
        
        if (remoteUpdatedAt !== undefined && remoteUpdatedAt > note.updatedAt && !isRecentEdit) {
          console.log(`[sync] Skipping push for note ${note.id} - remote version is newer (local: ${note.updatedAt}, remote: ${remoteUpdatedAt})`);
          continue;
        }
        
        if (isRecentEdit && remoteUpdatedAt !== undefined && remoteUpdatedAt > note.updatedAt) {
          console.log(`[sync] Force pushing note ${note.id} (${note.type}) - local edit was recent (local: ${note.updatedAt}, remote: ${remoteUpdatedAt})`);
        }
        
        console.log(`[sync] Pushing note ${note.id}: ${note.title}`);
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
            // If it's an object, use it directly; if it's already a string, parse it first
            if (typeof note.spreadsheet === 'string') {
              try {
                // Parse to validate, then use the parsed object
                spreadsheetData = JSON.parse(note.spreadsheet);
              } catch (e) {
                // If parsing fails, use as-is (might be malformed)
                console.warn(`Failed to parse spreadsheet string for note ${note.id}:`, e);
                spreadsheetData = note.spreadsheet;
              }
            } else {
              // It's already an object, use it directly
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
          
          // Log if we couldn't find spreadsheet data for a spreadsheet note
          if (!spreadsheetData) {
            console.warn(`[sync] Warning: Spreadsheet note ${note.id} has no spreadsheet data (spreadsheet=${!!note.spreadsheet}, _spreadsheetJson=${!!noteWithRaw._spreadsheetJson})`);
          }
        }
        
        // Insert/update note metadata
        const { error: noteError } = await supabase
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
        
        if (noteError) {
          console.error(`[sync] Failed to upsert note ${note.id}:`, noteError);
          throw noteError;
        }

        // Update note content separately if it exists
        if (contentHTML) {
          const { error: contentError } = await supabase
            .from('note_content')
            .upsert({
              note_id: note.id,
              user_id: userId,
              content_html: contentHTML,
              updated_at: toISOString(note.updatedAt),
            });
          
          if (contentError) {
            console.error(`[sync] Failed to upsert note_content for note ${note.id}:`, contentError);
            // Don't throw - content might be in notes table instead
          }
        }
        console.log(`[sync] Successfully pushed note ${note.id}`);
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

    // Push kanban and handle deletions
    for (const workspace of workspaces) {
      const kanbanData = await db.getKanbanByWorkspaceId(workspace.id);
      console.log(`[sync:push] Workspace ${workspace.id}: local kanban=${!!kanbanData}, columns=${kanbanData?.columns?.length || 0}`);
      
      // Get kanban from Supabase for this workspace
      const { data: supabaseKanban } = await supabase
        .from('kanban')
        .select('workspace_id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .maybeSingle();
      
      if (kanbanData) {
        // Check if remote version exists and is newer
        const { data: remoteKanban } = await supabase
          .from('kanban')
          .select('updated_at')
          .eq('workspace_id', workspace.id)
          .eq('user_id', userId)
          .maybeSingle();
        
        // For kanban, we don't have a local updatedAt timestamp, so we'll always push
        // but we could skip if remote was updated very recently (within last second)
        // For now, we'll push to ensure sync works, but in the future we could add updatedAt to Kanban type
        const columnsToSave = JSON.parse(JSON.stringify(kanbanData.columns));
        console.log(`[sync:push] Upserting kanban for workspace ${workspace.id} with ${columnsToSave.length} columns`);
        const { error: upsertError } = await supabase
          .from('kanban')
          .upsert({
            workspace_id: workspace.id,
            user_id: userId,
            columns: columnsToSave,
            updated_at: toISOString(Date.now()),
          });
        if (upsertError) {
          console.error(`[sync:push] Failed to upsert kanban for workspace ${workspace.id}:`, upsertError);
        } else {
          console.log(`[sync:push] Upserted kanban for workspace ${workspace.id}`);
        }
      } else if (supabaseKanban) {
        // Local kanban doesn't exist but Supabase has one - delete from Supabase
        console.log(`[sync:push] Deleting Supabase kanban for workspace ${workspace.id} (no local kanban)`);
        const { error: deleteError } = await supabase
          .from('kanban')
          .delete()
          .eq('workspace_id', workspace.id)
          .eq('user_id', userId);
        if (deleteError) {
          console.error(`[sync:push] Failed to delete Supabase kanban for workspace ${workspace.id}:`, deleteError);
        } else {
          console.log(`[sync:push] Deleted Supabase kanban for workspace ${workspace.id}`);
        }
      } else {
        console.log(`[sync:push] No kanban to sync for workspace ${workspace.id}`);
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

    // Get local workspaces to find deletions
    const localWorkspaces = await db.getAllWorkspaces();
    const localWorkspaceIds = new Set(localWorkspaces.map(w => w.id));
    const remoteWorkspaceIds = new Set((workspaces || []).map(w => w.id));

    // Delete local workspaces that don't exist in Supabase
    for (const localWs of localWorkspaces) {
      if (!remoteWorkspaceIds.has(localWs.id)) {
        await db.deleteWorkspace(localWs.id);
      }
    }

    // Upsert workspaces from Supabase
    if (workspaces) {
      for (const ws of workspaces) {
        await db.putWorkspace({
          id: ws.id,
          name: ws.name,
          order: ws.order,
        });
      }
    }

    // Pull folders - need to check per workspace
    // Use the workspaces we just pulled/updated, not local ones
    const workspacesToCheck = workspaces || [];
    
    for (const workspace of workspacesToCheck) {
      const { data: folders, error: foldersError } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .order('order');

      if (foldersError) throw foldersError;

      // Get local folders for this workspace
      const localFolders = await db.getFoldersByWorkspaceId(workspace.id);
      const remoteFolderIds = new Set((folders || []).map(f => f.id));

      // Upsert folders from Supabase
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

      // Delete local folders not in remote
      for (const localFolder of localFolders) {
        if (!remoteFolderIds.has(localFolder.id)) {
          await db.deleteFolder(localFolder.id);
        }
      }
    }

    // Pull notes - need to check per workspace
    for (const workspace of workspacesToCheck) {
      const { data: notes, error: notesError } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .order('order');

      if (notesError) throw notesError;

      // Get local notes for this workspace
      const localNotes = await db.getNotesByWorkspaceId(workspace.id);
      const remoteNoteIds = new Set((notes || []).map(n => n.id));

      // Upsert notes from Supabase with conflict resolution
      if (notes) {
        // Create a map of local notes by ID for quick lookup
        const localNotesMap = new Map(localNotes.map(n => [n.id, n]));
        
        for (const note of notes) {
          const localNote = localNotesMap.get(note.id);
          const remoteUpdatedAt = note.updated_at ? toTimestamp(note.updated_at) : 0;
          
          // Conflict resolution: only update if remote is newer or note doesn't exist locally
          if (localNote && localNote.updatedAt > remoteUpdatedAt) {
            console.log(`[sync] Skipping note ${note.id} - local version is newer (local: ${localNote.updatedAt}, remote: ${remoteUpdatedAt})`);
            continue; // Skip this note, local version is newer
          }
          
          // Get content from note_content table if it exists
          // Use .maybeSingle() instead of .single() to handle cases where note_content doesn't exist
          let contentHTML = note.content_html || '';
          
          try {
            const { data: contentData, error: contentError } = await supabase
              .from('note_content')
              .select('content_html')
              .eq('note_id', note.id)
              .eq('user_id', userId)
              .maybeSingle();

            // PGRST116 is "no rows returned" which is fine - use note.content_html
            // Other errors (like 406) might indicate table doesn't exist or RLS issue
            if (contentError) {
              if (contentError.code === 'PGRST116') {
                // No row found - this is expected if content is in notes table
                contentHTML = note.content_html || '';
              } else {
                // Other error (like 406) - log but continue with note.content_html
                console.warn(`[sync] Error fetching note_content for note ${note.id}:`, contentError.message, contentError.code);
                contentHTML = note.content_html || '';
              }
            } else if (contentData?.content_html) {
              // Successfully got content from note_content table
              contentHTML = contentData.content_html;
            }
          } catch (err) {
            // Catch any unexpected errors and fall back to note.content_html
            console.warn(`[sync] Exception fetching note_content for note ${note.id}:`, err);
            contentHTML = note.content_html || '';
          }

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
            updatedAt: remoteUpdatedAt || Date.now(),
            workspaceId: note.workspace_id,
            folderId: note.folder_id ?? null,
            order: note.order,
            type: noteType,
            spreadsheet: noteType === 'spreadsheet' ? spreadsheetData : undefined, // Only set if type is spreadsheet
          });
        }
      }

      // Delete local notes not in remote
      for (const localNote of localNotes) {
        if (!remoteNoteIds.has(localNote.id)) {
          await db.deleteNote(localNote.id);
        }
      }
    }

    // Pull calendar events - need to check per workspace
    for (const workspace of workspacesToCheck) {
      const { data: events, error: eventsError } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);

      if (eventsError) throw eventsError;

      // Get local events for this workspace
      const localEvents = await db.getCalendarEventsByWorkspaceId(workspace.id);
      const remoteEventIds = new Set((events || []).map(e => e.id));

      // Upsert events from Supabase
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

      // Delete local events not in remote
      for (const localEvent of localEvents) {
        if (!remoteEventIds.has(localEvent.id)) {
          await db.deleteCalendarEvent(localEvent.id);
        }
      }
    }

    // Pull kanban - need to check per workspace
    for (const workspace of workspacesToCheck) {
      const { data: kanbanData, error: kanbanError } = await supabase
        .from('kanban')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .maybeSingle();

      if (kanbanError) {
        console.error(`[sync:pull] Error fetching kanban for workspace ${workspace.id}:`, kanbanError);
        throw kanbanError;
      }

      // Get local kanban for this workspace
      const localKanban = await db.getKanbanByWorkspaceId(workspace.id);
      console.log(`[sync:pull] Workspace ${workspace.id}: remote=${!!kanbanData}, local=${!!localKanban}`);

      // If remote kanban exists, upsert it
      // Note: For kanban, we don't have local timestamps, so we always accept remote
      // In the future, we could add updatedAt to Kanban type for better conflict resolution
      if (kanbanData) {
        const columns = kanbanData.columns as any;
        const columnCount = Array.isArray(columns) ? columns.length : 0;
        console.log(`[sync:pull] Remote kanban has ${columnCount} columns`);
        await db.putKanban({
          workspaceId: kanbanData.workspace_id,
          columns: columns,
        });
        console.log(`[sync:pull] Put local kanban for workspace ${kanbanData.workspace_id}`);
      } else if (localKanban) {
        // If local kanban exists but remote doesn't, delete local
        console.log(`[sync:pull] No remote kanban, deleting local kanban for workspace ${workspace.id}`);
        await db.deleteKanban(workspace.id);
        console.log(`[sync:pull] Deleted local kanban for workspace ${workspace.id}`);
      } else {
        console.log(`[sync:pull] No kanban data for workspace ${workspace.id} (remote or local)`);
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
 * Full sync: pull then push (to handle conflicts and ensure deletions are synced)
 */
export async function fullSync(): Promise<{ success: boolean; error?: string }> {
  // Pull first to get latest from server (this will also handle deletions)
  const pullResult = await pullFromSupabase();
  if (!pullResult.success) {
    return pullResult;
  }

  // Then push local changes (including any new deletions)
  const pushResult = await pushToSupabase();
  return pushResult;
}

/**
 * Get current sync status
 */
export function getSyncStatus(): SyncStatus {
  return { ...syncStatus };
}

