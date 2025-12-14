import type { Workspace, Folder, Note, CalendarEvent, Kanban, Setting } from './db_types';
import * as db from './db';

export interface BackupMetadata {
  id: string;
  timestamp: number;
  date: string;
  size: number;
  type: 'manual' | 'automatic';
  description?: string;
}

export interface BackupData {
  version: string;
  backupDate: string;
  metadata: BackupMetadata;
  data: {
    workspaces: Workspace[];
    folders: Folder[];
    notes: Note[];
    calendarEvents: CalendarEvent[];
    kanban: Kanban[];
    settings: Setting[];
  };
}

const BACKUP_STORAGE_KEY = 'neuronotes_backups';
const MAX_BACKUPS = 30;
const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000;

export async function createBackup(type: 'manual' | 'automatic' = 'manual', description?: string): Promise<BackupMetadata> {
  try {
    await db.init();

    const workspaces = await db.getAllWorkspaces();
    
    const [folders, notes, calendarEvents, kanban, settings] = await Promise.all([
      (async () => {
        const allFolders: Folder[] = [];
        for (const ws of workspaces) {
          const wsFolders = await db.getFoldersByWorkspaceId(ws.id);
          allFolders.push(...wsFolders);
        }
        return allFolders;
      })(),
      (async () => {
        const allNotes: Note[] = [];
        for (const ws of workspaces) {
          const wsNotes = await db.getNotesByWorkspaceId(ws.id);
          allNotes.push(...wsNotes);
        }
        return allNotes;
      })(),
      (async () => {
        const allEvents: CalendarEvent[] = [];
        for (const ws of workspaces) {
          const wsEvents = await db.getCalendarEventsByWorkspaceId(ws.id);
          allEvents.push(...wsEvents);
        }
        return allEvents;
      })(),
      (async () => {
        const allKanban: Kanban[] = [];
        for (const ws of workspaces) {
          const kanbanData = await db.getKanbanByWorkspaceId(ws.id);
          if (kanbanData) {
            allKanban.push(kanbanData);
          }
        }
        return allKanban;
      })(),
      (async () => {
        return await db.getAll<Setting>('settings');
      })()
    ]);

    const backupData: BackupData = {
      version: '1.0',
      backupDate: new Date().toISOString(),
      metadata: {
        id: `backup-${Date.now()}`,
        timestamp: Date.now(),
        date: new Date().toISOString(),
        size: 0, // Will be calculated after stringification
        type,
        description
      },
      data: {
        workspaces,
        folders,
        notes,
        calendarEvents,
        kanban,
        settings
      }
    };

    const jsonData = JSON.stringify(backupData);
    backupData.metadata.size = new Blob([jsonData]).size;

    await saveBackup(backupData);

    await cleanupOldBackups();

    return backupData.metadata;
  } catch (error) {
    console.error('[backup] Failed to create backup:', error);
    throw error;
  }
}

async function saveBackup(backupData: BackupData): Promise<void> {
  await saveBackupBrowser(backupData);
}

async function saveBackupBrowser(backupData: BackupData): Promise<void> {
  try {
    const backupListJson = localStorage.getItem(BACKUP_STORAGE_KEY);
    let backupList: BackupMetadata[] = [];
    if (backupListJson) {
      try {
        backupList = JSON.parse(backupListJson);
      } catch (parseError) {
        console.warn('[backup] Failed to parse backup list, starting fresh:', parseError);
        backupList = [];
      }
    }
    
    const backupKey = `backup_${backupData.metadata.id}`;
    localStorage.setItem(backupKey, JSON.stringify(backupData));
    
    backupList.push(backupData.metadata);
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backupList));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.warn('[backup] localStorage full, cleaning up old backups...');
      await cleanupOldBackups();
      const backupListJson = localStorage.getItem(BACKUP_STORAGE_KEY);
      let backupList: BackupMetadata[] = [];
      if (backupListJson) {
        try {
          backupList = JSON.parse(backupListJson);
        } catch (parseError) {
          console.warn('[backup] Failed to parse backup list after cleanup:', parseError);
          backupList = [];
        }
      }
      const backupKey = `backup_${backupData.metadata.id}`;
      localStorage.setItem(backupKey, JSON.stringify(backupData));
      backupList.push(backupData.metadata);
      localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backupList));
    } else {
      throw error;
    }
  }
}

export async function getAllBackups(): Promise<BackupData[]> {
  return await getAllBackupsBrowser();
}

async function getAllBackupsBrowser(): Promise<BackupData[]> {
  try {
    const backupListJson = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!backupListJson) {
      return [];
    }
    
    let backupList: BackupMetadata[] = [];
    try {
      backupList = JSON.parse(backupListJson);
    } catch (parseError) {
      console.warn('[backup] Failed to parse backup list:', parseError);
      return [];
    }
    
    const backups: BackupData[] = [];
    
    for (const metadata of backupList) {
      const backupKey = `backup_${metadata.id}`;
      const backupJson = localStorage.getItem(backupKey);
      if (backupJson) {
        try {
          const backup: BackupData = JSON.parse(backupJson);
          backups.push(backup);
        } catch (e) {
          console.warn(`[backup] Failed to parse backup ${metadata.id}:`, e);
        }
      }
    }
    
    backups.sort((a, b) => b.metadata.timestamp - a.metadata.timestamp);
    return backups;
  } catch (error) {
    console.error('[backup] Failed to get backups from browser:', error);
    return [];
  }
}

export async function getBackup(backupId: string): Promise<BackupData | null> {
  const backups = await getAllBackups();
  return backups.find(b => b.metadata.id === backupId) || null;
}

/**
 * Saves an imported backup file to the backup list without restoring it
 */
export async function saveImportedBackup(backupData: BackupData): Promise<BackupMetadata> {
  const importedBackup: BackupData = {
    ...backupData,
    metadata: {
      ...backupData.metadata,
      id: `backup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      date: new Date().toISOString(),
      type: 'manual',
      description: backupData.metadata.description || 'Imported backup'
    }
  };
  
  const jsonData = JSON.stringify(importedBackup);
  importedBackup.metadata.size = new Blob([jsonData]).size;
  
  await saveBackup(importedBackup);
  await cleanupOldBackups();
  
  return importedBackup.metadata;
}

export async function restoreBackup(backupId: string): Promise<void> {
  const backup = await getBackup(backupId);
  if (!backup) {
    throw new Error(`Backup ${backupId} not found`);
  }
  
  await db.init();
  
  await importBackupData(backup.data);
}

async function importBackupData(data: {
  workspaces?: Workspace[];
  folders?: Folder[];
  notes?: Note[];
  calendarEvents?: CalendarEvent[];
  kanban?: Kanban[];
  settings?: Setting[];
}): Promise<void> {
  if (data.workspaces && data.workspaces.length > 0) {
    for (const workspace of data.workspaces) {
      await db.putWorkspace(workspace);
    }
  }

  if (data.folders && data.folders.length > 0) {
    for (const folder of data.folders) {
      await db.putFolder(folder);
    }
  }

  if (data.notes && data.notes.length > 0) {
    for (const note of data.notes) {
      const noteWithMeta = note as any;
      noteWithMeta._contentLoaded = true;
      
      if (note.type === 'spreadsheet' && note.spreadsheet && !noteWithMeta._spreadsheetJson) {
        if (typeof note.spreadsheet === 'string') {
          noteWithMeta._spreadsheetJson = note.spreadsheet;
        } else {
          noteWithMeta._spreadsheetJson = JSON.stringify(note.spreadsheet);
        }
      }
      
      if (note.contentHTML === undefined) {
        note.contentHTML = '';
      }
      
      await db.putNote(note);
    }
  }

  if (data.calendarEvents && data.calendarEvents.length > 0) {
    for (const event of data.calendarEvents) {
      await db.putCalendarEvent(event);
    }
  }

  if (data.kanban && data.kanban.length > 0) {
    for (const kanban of data.kanban) {
      await db.putKanban(kanban);
    }
  }

  if (data.settings && data.settings.length > 0) {
    for (const setting of data.settings) {
      await db.putSetting(setting);
    }
  }
}

export async function deleteBackup(backupId: string): Promise<void> {
  await deleteBackupBrowser(backupId);
}

async function deleteBackupBrowser(backupId: string): Promise<void> {
  const backupKey = `backup_${backupId}`;
  localStorage.removeItem(backupKey);
  
  const backups = await getAllBackups();
  const filtered = backups.filter(b => b.metadata.id !== backupId);
  const backupList = filtered.map(b => b.metadata);
  localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backupList));
}

async function cleanupOldBackups(): Promise<void> {
  const backups = await getAllBackups();
  
  if (backups.length <= MAX_BACKUPS) {
    return;
  }
  
  const sorted = [...backups].sort((a, b) => a.metadata.timestamp - b.metadata.timestamp);
  
  const toDelete = sorted.slice(0, backups.length - MAX_BACKUPS);
  for (const backup of toDelete) {
    await deleteBackup(backup.metadata.id);
  }
}

let autoBackupInterval: number | null = null;
let lastBackupTime: number = 0;

export function startAutoBackup(): void {
  if (autoBackupInterval) {
    return;
  }
  
  const lastBackup = localStorage.getItem('last_backup_time');
  if (lastBackup) {
    lastBackupTime = parseInt(lastBackup, 10);
  }
  
  const now = Date.now();
  if (now - lastBackupTime > AUTO_BACKUP_INTERVAL) {
    createBackup('automatic', 'Automatic daily backup').catch(console.error);
    lastBackupTime = now;
    localStorage.setItem('last_backup_time', now.toString());
  }
  
  autoBackupInterval = window.setInterval(() => {
    const now = Date.now();
    if (now - lastBackupTime > AUTO_BACKUP_INTERVAL) {
      createBackup('automatic', 'Automatic daily backup')
        .then(() => {
          lastBackupTime = now;
          localStorage.setItem('last_backup_time', now.toString());
        })
        .catch(console.error);
    }
  }, 60 * 60 * 1000);
}

export function stopAutoBackup(): void {
  if (autoBackupInterval) {
    clearInterval(autoBackupInterval);
    autoBackupInterval = null;
  }
}

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

