import { supabase, isSupabaseConfigured } from './client';
import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from '../db_types';
import * as db from '../db';

function deepClone<T>(obj: T): T {
	if (typeof structuredClone !== 'undefined') {
		return structuredClone(obj);
	}
	return JSON.parse(JSON.stringify(obj));
}

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

function toISOString(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function toTimestamp(isoString: string): number {
  return new Date(isoString).getTime();
}

// Flag to track if pushToSupabase is being called from fullSync (safe) or directly (unsafe)
let isPushingFromFullSync = false;

/**
 * Pushes all local data to Supabase
 * WARNING: This should only be called from fullSync() to ensure pull happens first.
 * Direct calls can overwrite newer data in the database.
 */
export async function pushToSupabase(): Promise<{ success: boolean; error?: string }> {
  // Safety check: warn if called directly (not from fullSync)
  if (!isPushingFromFullSync) {
    console.warn('[sync] WARNING: pushToSupabase() called directly without pull first. This can overwrite newer data. Use fullSync() instead.');
  }
  
  if (!isSupabaseConfigured() || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }
  
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    return { success: false, error: 'Not authenticated' };
  }

  updateSyncStatus({ isSyncing: true, error: null });

  try {
    const workspaces = await db.getAllWorkspaces();
    const localWorkspaceIds = new Set(workspaces.map(w => w.id));
    
    const { data: supabaseWorkspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId);
    
    if (supabaseWorkspaces) {
      for (const supabaseWorkspace of supabaseWorkspaces) {
        if (!localWorkspaceIds.has(supabaseWorkspace.id)) {
          await supabase.from('workspaces').delete().eq('id', supabaseWorkspace.id).eq('user_id', userId);
        }
      }
    }
    
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

    for (const workspace of workspaces) {
      const folders = await db.getFoldersByWorkspaceId(workspace.id);
      const localFolderIds = new Set(folders.map(f => f.id));
      
      const { data: supabaseFolders } = await supabase
        .from('folders')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);
      
      if (supabaseFolders) {
        for (const supabaseFolder of supabaseFolders) {
          if (!localFolderIds.has(supabaseFolder.id)) {
            await supabase.from('folders').delete().eq('id', supabaseFolder.id).eq('user_id', userId);
          }
        }
      }
      
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

    for (const workspace of workspaces) {
      const notes = await db.getNotesByWorkspaceId(workspace.id);
      const localNoteIds = new Set(notes.map(n => n.id));
      
      const { data: supabaseNotes } = await supabase
        .from('notes')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);
      
      if (supabaseNotes) {
        for (const supabaseNote of supabaseNotes) {
          if (!localNoteIds.has(supabaseNote.id)) {
            await supabase.from('notes').delete().eq('id', supabaseNote.id).eq('user_id', userId);
            await supabase.from('note_content').delete().eq('note_id', supabaseNote.id).eq('user_id', userId);
          }
        }
      }
      
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
      
      for (const note of notes) {
        const remoteUpdatedAt = remoteNotesMap.get(note.id);
        
        // If remote version exists and is newer, skip pushing to avoid overwriting newer data
        // This prevents data loss when another device has made more recent changes
        if (remoteUpdatedAt !== undefined && remoteUpdatedAt > note.updatedAt) {
          continue;
        }
        
        let contentHTML = note.contentHTML;
        if (!contentHTML || contentHTML === '') {
          try {
            contentHTML = await db.getNoteContent(note.id);
          } catch (e) {
            console.warn(`Failed to get content for note ${note.id}:`, e);
          }
        }
        
        const noteWithRaw = note as any;
        let spreadsheetData: any = null;
        if (note.type === 'spreadsheet') {
          if (note.spreadsheet) {
            if (typeof note.spreadsheet === 'string') {
              try {
                spreadsheetData = JSON.parse(note.spreadsheet);
              } catch (e) {
                console.warn(`Failed to parse spreadsheet string for note ${note.id}:`, e);
                spreadsheetData = note.spreadsheet;
              }
            } else {
              spreadsheetData = note.spreadsheet;
            }
          } else if (noteWithRaw._spreadsheetJson) {
            try {
              spreadsheetData = typeof noteWithRaw._spreadsheetJson === 'string' 
                ? JSON.parse(noteWithRaw._spreadsheetJson)
                : noteWithRaw._spreadsheetJson;
            } catch (e) {
              console.warn(`Failed to parse spreadsheet JSON for note ${note.id}:`, e);
            }
          }
          
          if (!spreadsheetData) {
            console.warn(`[sync] Warning: Spreadsheet note ${note.id} has no spreadsheet data (spreadsheet=${!!note.spreadsheet}, _spreadsheetJson=${!!noteWithRaw._spreadsheetJson})`);
          }
        }
        
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
          }
        }
      }
    }

    for (const workspace of workspaces) {
      const events = await db.getCalendarEventsByWorkspaceId(workspace.id);
      const localEventIds = new Set(events.map(e => e.id));
      
      const { data: supabaseEvents } = await supabase
        .from('calendar_events')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);
      
      if (supabaseEvents) {
        for (const supabaseEvent of supabaseEvents) {
          if (!localEventIds.has(supabaseEvent.id)) {
            await supabase.from('calendar_events').delete().eq('id', supabaseEvent.id).eq('user_id', userId);
          }
        }
      }
      
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

    for (const workspace of workspaces) {
      const kanbanData = await db.getKanbanByWorkspaceId(workspace.id);
      
      const { data: supabaseKanban } = await supabase
        .from('kanban')
        .select('workspace_id')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .maybeSingle();
      
      if (kanbanData) {
        const columnsToSave = deepClone(kanbanData.columns);
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
          throw upsertError;
        }
      } else if (supabaseKanban) {
        const { error: deleteError } = await supabase
          .from('kanban')
          .delete()
          .eq('workspace_id', workspace.id)
          .eq('user_id', userId);
        if (deleteError) {
          console.error(`[sync:push] Failed to delete Supabase kanban for workspace ${workspace.id}:`, deleteError);
        }
      }
    }

    const allSettings = await db.getAllSettings();
    for (const setting of allSettings) {
      // Exclude local-only settings from sync:
      // - Settings with ':' are per-workspace (e.g., selectedNoteId:workspaceId)
      // - activeWorkspaceId is per-device preference, shouldn't sync across devices
      if (!setting.key.includes(':') && setting.key !== 'activeWorkspaceId') {
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
 * Pulls all data from Supabase to local
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
    const { data: workspaces, error: workspacesError } = await supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', userId)
      .order('order');

    if (workspacesError) throw workspacesError;

    const localWorkspaces = await db.getAllWorkspaces();
    const localWorkspaceIds = new Set(localWorkspaces.map(w => w.id));
    const remoteWorkspaceIds = new Set((workspaces || []).map(w => w.id));

    for (const localWs of localWorkspaces) {
      if (!remoteWorkspaceIds.has(localWs.id)) {
        await db.deleteWorkspace(localWs.id);
      }
    }

    if (workspaces) {
      for (const ws of workspaces) {
        await db.putWorkspace({
          id: ws.id,
          name: ws.name,
          order: ws.order,
        });
      }
    }

    const workspacesToCheck = workspaces || [];
    
    for (const workspace of workspacesToCheck) {
      const { data: folders, error: foldersError } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .order('order');

      if (foldersError) throw foldersError;

      const localFolders = await db.getFoldersByWorkspaceId(workspace.id);
      const remoteFolderIds = new Set((folders || []).map(f => f.id));

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

      for (const localFolder of localFolders) {
        if (!remoteFolderIds.has(localFolder.id)) {
          await db.deleteFolder(localFolder.id);
        }
      }
    }

    for (const workspace of workspacesToCheck) {
      const { data: notes, error: notesError } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id)
        .order('order');

      if (notesError) throw notesError;

      const localNotes = await db.getNotesByWorkspaceId(workspace.id);
      const remoteNoteIds = new Set((notes || []).map(n => n.id));

      if (notes) {
        const localNotesMap = new Map(localNotes.map(n => [n.id, n]));
        
        for (const note of notes) {
          const localNote = localNotesMap.get(note.id);
          const remoteUpdatedAt = note.updated_at ? toTimestamp(note.updated_at) : 0;
          
          if (localNote && localNote.updatedAt > remoteUpdatedAt) {
            continue;
          }
          
          let contentHTML = note.content_html || '';
          
          try {
            const { data: contentData, error: contentError } = await supabase
              .from('note_content')
              .select('content_html')
              .eq('note_id', note.id)
              .eq('user_id', userId)
              .maybeSingle();

            if (contentError) {
              if (contentError.code === 'PGRST116') {
                contentHTML = note.content_html || '';
              } else {
                console.warn(`[sync] Error fetching note_content for note ${note.id}:`, contentError.message, contentError.code);
                contentHTML = note.content_html || '';
              }
            } else if (contentData?.content_html) {
              contentHTML = contentData.content_html;
            }
          } catch (err) {
            console.warn(`[sync] Exception fetching note_content for note ${note.id}:`, err);
            contentHTML = note.content_html || '';
          }

          let spreadsheetData: any = undefined;
          if (note.type === 'spreadsheet' && note.spreadsheet) {
            if (typeof note.spreadsheet === 'string') {
              spreadsheetData = note.spreadsheet;
            } else {
              spreadsheetData = JSON.stringify(note.spreadsheet);
            }
          }

          let noteType: 'text' | 'spreadsheet' = 'text';
          if (note.type === 'spreadsheet' && spreadsheetData) {
            noteType = 'spreadsheet';
          } else if (note.type === 'text' || !note.type) {
            noteType = 'text';
          } else {
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
            spreadsheet: noteType === 'spreadsheet' ? spreadsheetData : undefined,
          });
        }
      }

      for (const localNote of localNotes) {
        if (!remoteNoteIds.has(localNote.id)) {
          await db.deleteNote(localNote.id);
        }
      }
    }

    for (const workspace of workspacesToCheck) {
      const { data: events, error: eventsError } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_id', workspace.id);

      if (eventsError) throw eventsError;

      const localEvents = await db.getCalendarEventsByWorkspaceId(workspace.id);
      const remoteEventIds = new Set((events || []).map(e => e.id));

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

      for (const localEvent of localEvents) {
        if (!remoteEventIds.has(localEvent.id)) {
          await db.deleteCalendarEvent(localEvent.id);
        }
      }
    }

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

      const localKanban = await db.getKanbanByWorkspaceId(workspace.id);

      if (kanbanData) {
        // Always pull remote kanban data
        // Note: In fullSync, we pull then push, so local changes will be preserved in the push step
        const columns = kanbanData.columns as any;
        await db.putKanban({
          workspaceId: kanbanData.workspace_id,
          columns: columns,
        });
      } else if (localKanban) {
        // Remote kanban was deleted, delete local too
        await db.deleteKanban(workspace.id);
      }
    }

    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId);

    if (settingsError) throw settingsError;

    if (settings) {
      for (const setting of settings) {
        // Exclude activeWorkspaceId from sync - it's a per-device preference
        // Each device should maintain its own active workspace
        if (setting.key !== 'activeWorkspaceId') {
          await db.putSetting({
            key: setting.key,
            value: setting.value,
          });
        }
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
 * Full sync: pull then push to handle conflicts and ensure deletions are synced
 * This is the SAFE way to sync - always pulls first to get latest data, then pushes local changes.
 */
export async function fullSync(): Promise<{ success: boolean; error?: string }> {
  const pullResult = await pullFromSupabase();
  if (!pullResult.success) {
    return pullResult;
  }

  // Set flag to indicate push is being called from fullSync (safe)
  isPushingFromFullSync = true;
  try {
    const pushResult = await pushToSupabase();
    return pushResult;
  } finally {
    isPushingFromFullSync = false;
  }
}

/**
 * Gets current sync status
 */
export function getSyncStatus(): SyncStatus {
  return { ...syncStatus };
}

/**
 * Realtime subscription channels
 */
let realtimeChannels: any[] = [];

/**
 * Sets up realtime subscriptions for all tables
 * Returns a cleanup function to unsubscribe
 */
export async function setupRealtimeSubscriptions(
  onDataChange: () => Promise<void>
): Promise<{ success: boolean; error?: string; unsubscribe: () => void }> {
  if (!isSupabaseConfigured() || !supabase) {
    return { success: false, error: 'Supabase is not configured', unsubscribe: () => {} };
  }

  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    return { success: false, error: 'Not authenticated', unsubscribe: () => {} };
  }

  // Clean up any existing subscriptions
  cleanupRealtimeSubscriptions();

  try {
    // Helper to handle individual row changes
    const handleChange = async (payload: any, tableName: string) => {
      console.log(`[realtime] Received ${payload.eventType} event for ${tableName}:`, payload);
      
      // Only process changes for the current user
      if (payload.new?.user_id !== userId && payload.old?.user_id !== userId) {
        return;
      }

      try {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const row = payload.new;
          
          switch (tableName) {
            case 'workspaces':
              await db.putWorkspace({
                id: row.id,
                name: row.name,
                order: row.order,
              });
              break;
            
            case 'folders':
              await db.putFolder({
                id: row.id,
                name: row.name,
                workspaceId: row.workspace_id,
                order: row.order,
              });
              break;
            
            case 'notes':
              // For notes, we need to fetch content_html from note_content if available
              let contentHTML = row.content_html || '';
              
              try {
                const { data: contentData } = await supabase
                  .from('note_content')
                  .select('content_html')
                  .eq('note_id', row.id)
                  .eq('user_id', userId)
                  .maybeSingle();
                
                if (contentData?.content_html) {
                  contentHTML = contentData.content_html;
                }
              } catch (err) {
                console.warn(`[realtime] Error fetching note_content for note ${row.id}:`, err);
              }

              let spreadsheetData: any = undefined;
              if (row.type === 'spreadsheet' && row.spreadsheet) {
                if (typeof row.spreadsheet === 'string') {
                  spreadsheetData = row.spreadsheet;
                } else {
                  spreadsheetData = JSON.stringify(row.spreadsheet);
                }
              }

              const noteType: 'text' | 'spreadsheet' = row.type === 'spreadsheet' && spreadsheetData ? 'spreadsheet' : 'text';
              const remoteUpdatedAt = row.updated_at ? toTimestamp(row.updated_at) : Date.now();

              // Check if local version is newer - if so, skip to avoid overwriting
              const localNotes = await db.getNotesByWorkspaceId(row.workspace_id);
              const localNote = localNotes.find(n => n.id === row.id);
              if (localNote && localNote.updatedAt > remoteUpdatedAt) {
                return; // Local is newer, skip
              }

              await db.putNote({
                id: row.id,
                title: row.title,
                contentHTML: contentHTML,
                updatedAt: remoteUpdatedAt,
                workspaceId: row.workspace_id,
                folderId: row.folder_id ?? null,
                order: row.order,
                type: noteType,
                spreadsheet: noteType === 'spreadsheet' ? spreadsheetData : undefined,
              });
              break;
            
            case 'note_content':
              // Update the note's content when note_content changes
              const { data: noteData } = await supabase
                .from('notes')
                .select('*')
                .eq('id', row.note_id)
                .eq('user_id', userId)
                .maybeSingle();
              
              if (noteData) {
                const remoteUpdatedAt = noteData.updated_at ? toTimestamp(noteData.updated_at) : Date.now();
                const localNotes = await db.getNotesByWorkspaceId(noteData.workspace_id);
                const localNote = localNotes.find(n => n.id === row.note_id);
                
                if (!localNote || localNote.updatedAt <= remoteUpdatedAt) {
                  let spreadsheetData: any = undefined;
                  if (noteData.type === 'spreadsheet' && noteData.spreadsheet) {
                    if (typeof noteData.spreadsheet === 'string') {
                      spreadsheetData = noteData.spreadsheet;
                    } else {
                      spreadsheetData = JSON.stringify(noteData.spreadsheet);
                    }
                  }

                  const noteType: 'text' | 'spreadsheet' = noteData.type === 'spreadsheet' && spreadsheetData ? 'spreadsheet' : 'text';
                  
                  await db.putNote({
                    id: noteData.id,
                    title: noteData.title,
                    contentHTML: row.content_html || '',
                    updatedAt: remoteUpdatedAt,
                    workspaceId: noteData.workspace_id,
                    folderId: noteData.folder_id ?? null,
                    order: noteData.order,
                    type: noteType,
                    spreadsheet: noteType === 'spreadsheet' ? spreadsheetData : undefined,
                  });
                }
              }
              break;
            
            case 'calendar_events':
              await db.putCalendarEvent({
                id: row.id,
                date: row.date,
                title: row.title,
                time: row.time || undefined,
                workspaceId: row.workspace_id,
                repeat: row.repeat as any,
                repeatOn: row.repeat_on || undefined,
                repeatEnd: row.repeat_end || undefined,
                exceptions: row.exceptions || undefined,
                color: row.color || undefined,
              });
              break;
            
            case 'kanban':
              const columns = row.columns as any;
              await db.putKanban({
                workspaceId: row.workspace_id,
                columns: columns,
              });
              break;
            
            case 'settings':
              // Exclude activeWorkspaceId from sync - it's a per-device preference
              if (row.key !== 'activeWorkspaceId' && !row.key.includes(':')) {
                await db.putSetting({
                  key: row.key,
                  value: row.value,
                });
              }
              break;
          }
        } else if (payload.eventType === 'DELETE') {
          const row = payload.old;
          
          switch (tableName) {
            case 'workspaces':
              await db.deleteWorkspace(row.id);
              break;
            case 'folders':
              await db.deleteFolder(row.id);
              break;
            case 'notes':
              await db.deleteNote(row.id);
              break;
            case 'calendar_events':
              await db.deleteCalendarEvent(row.id);
              break;
            case 'kanban':
              await db.deleteKanban(row.workspace_id);
              break;
            case 'settings':
              // Note: Settings deletion is less common, but handle it if needed
              break;
          }
        }

        // Notify that data changed - reload UI
        await onDataChange();
      } catch (error) {
        console.error(`[realtime] Error handling ${tableName} change:`, error);
      }
    };

    // Subscribe to all tables
    const tables = ['workspaces', 'folders', 'notes', 'note_content', 'calendar_events', 'kanban', 'settings'];
    
    for (const table of tables) {
      const channel = supabase
        .channel(`${table}-changes`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: table,
            filter: `user_id=eq.${userId}`,
          },
          (payload) => handleChange(payload, table)
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[realtime] Subscribed to ${table} changes`);
          } else if (status === 'CHANNEL_ERROR') {
            console.error(`[realtime] Error subscribing to ${table}:`, status);
          } else if (status === 'TIMED_OUT') {
            console.warn(`[realtime] Timeout subscribing to ${table}`);
          } else if (status === 'CLOSED') {
            console.log(`[realtime] Channel closed for ${table}`);
          }
        });

      realtimeChannels.push(channel);
    }

    console.log(`[realtime] Set up subscriptions for ${tables.length} tables`);
    return {
      success: true,
      unsubscribe: cleanupRealtimeSubscriptions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    cleanupRealtimeSubscriptions();
    return { success: false, error: errorMessage, unsubscribe: () => {} };
  }
}

/**
 * Cleans up all realtime subscriptions
 */
export function cleanupRealtimeSubscriptions(): void {
  for (const channel of realtimeChannels) {
    if (channel) {
      supabase?.removeChannel(channel);
    }
  }
  realtimeChannels = [];
}

