<script lang="ts">
    import { browser } from '$app/environment';
    import * as backup from '$lib/backup';
    import * as db from '$lib/db';
    import { generateUUID } from '$lib/utils/uuid';
    import type { Workspace } from '$lib/db_types';

    export let open = false;
    export let isLoggedIn = false;

    // Callbacks
    export let onClose: () => void;
    export let onRestore: () => Promise<void>; // Called after restore to reload UI state
    export let showDeleteDialog: (message: string, deleteButtonText?: string) => Promise<boolean>;
    export let ensureSupabaseLoaded: () => Promise<void>;
    export let sync: typeof import('$lib/supabase/sync');

    // Local state
    let backups: backup.BackupData[] = [];
    let isLoadingBackups = false;
    let backupFileInput: HTMLInputElement;

    const ManualIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 2H14V14H2V2ZM3 3V13H13V3H3ZM5 5H11V6H5V5ZM5 7H11V8H5V7ZM5 9H8V10H5V9Z" fill="currentColor"/>
    </svg>`;

    const AutomaticIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 0L10.5 5.5L16 8L10.5 10.5L8 16L5.5 10.5L0 8L5.5 5.5L8 0ZM8 2.5L6.5 6.5L2.5 8L6.5 9.5L8 13.5L9.5 9.5L13.5 8L9.5 6.5L8 2.5ZM8 5L9 7.5L11.5 8L9 8.5L8 11L7 8.5L4.5 8L7 7.5L8 5Z" fill="currentColor"/>
    </svg>`;

    // Load backups when modal opens
    $: if (open) {
        loadBackups();
    }

    async function createBackup() {
        try {
            const metadata = await backup.createBackup('manual', 'Manual backup');
            
            // In browser, also download the backup file immediately
            if (browser) {
                try {
                    const backupData = await backup.getBackup(metadata.id);
                    if (backupData) {
                        const jsonData = JSON.stringify(backupData, null, 2);
                        const blob = new Blob([jsonData], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `neuronotes-backup-${metadata.id}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                } catch (downloadError) {
                    console.warn('Failed to auto-download backup:', downloadError);
                    // Continue even if download fails
                }
            }
            
            alert(`Backup created successfully!\n\nBackup ID: ${metadata.id}\nDate: ${new Date(metadata.timestamp).toLocaleString()}\nSize: ${backup.formatBackupSize(metadata.size)}\n${browser ? '\nThe backup file has been downloaded to your Downloads folder.' : ''}`);
            await loadBackups();
        } catch (error) {
            console.error('Backup creation failed:', error);
            alert(`Backup creation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async function downloadBackup(backupId: string) {
        try {
            const backupData = await backup.getBackup(backupId);
            if (!backupData) {
                alert('Backup not found.');
                return;
            }

            const jsonData = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `neuronotes-backup-${backupId}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            alert('Backup downloaded successfully! The file has been saved to your Downloads folder.');
        } catch (error) {
            console.error('Backup download failed:', error);
            alert(`Backup download failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async function handleImportBackupFile(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        
        if (!file) return;

        try {
            const fileContent = await file.text();
            const parsedData = JSON.parse(fileContent);

            // Check if this is a full BackupData structure with metadata
            const isFullBackup = parsedData.metadata && parsedData.data && parsedData.version;
            
            let backupDataToSave: backup.BackupData;
            
            if (isFullBackup) {
                // Full backup structure - save it directly
                backupDataToSave = parsedData as backup.BackupData;
            } else if (parsedData.data) {
                // Has data property but no metadata - construct BackupData
                backupDataToSave = {
                    version: '1.0',
                    backupDate: new Date().toISOString(),
                    metadata: {
                        id: `backup-${Date.now()}`,
                        timestamp: Date.now(),
                        date: new Date().toISOString(),
                        size: 0,
                        type: 'manual',
                        description: `Imported from: ${file.name}`
                    },
                    data: parsedData.data
                };
                // Calculate size
                const jsonData = JSON.stringify(backupDataToSave);
                backupDataToSave.metadata.size = new Blob([jsonData]).size;
            } else if (parsedData.workspaces || parsedData.notes) {
                // Just data without wrapper - construct BackupData
                backupDataToSave = {
                    version: '1.0',
                    backupDate: new Date().toISOString(),
                    metadata: {
                        id: `backup-${Date.now()}`,
                        timestamp: Date.now(),
                        date: new Date().toISOString(),
                        size: 0,
                        type: 'manual',
                        description: `Imported from: ${file.name}`
                    },
                    data: {
                        workspaces: parsedData.workspaces || [],
                        folders: parsedData.folders || [],
                        notes: parsedData.notes || [],
                        calendarEvents: parsedData.calendarEvents || [],
                        kanban: parsedData.kanban || [],
                        settings: parsedData.settings || []
                    }
                };
                // Calculate size
                const jsonData = JSON.stringify(backupDataToSave);
                backupDataToSave.metadata.size = new Blob([jsonData]).size;
            } else {
                alert('Invalid backup file format. Please select a valid backup file.');
                target.value = '';
                return;
            }

            // Save the backup to the backup list (without applying it)
            await backup.saveImportedBackup(backupDataToSave);
            
            target.value = '';
            
            // Reload backups list
            await loadBackups();
            
            alert('Backup imported successfully! You can now restore it from the backup management list.');
        } catch (error) {
            console.error('Backup import failed:', error);
            alert(`Backup import failed: ${error instanceof Error ? error.message : String(error)}`);
            target.value = '';
        }
    }

    async function loadBackups() {
        isLoadingBackups = true;
        try {
            backups = await backup.getAllBackups();
        } catch (error) {
            console.error('Failed to load backups:', error);
            alert(`Failed to load backups: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            isLoadingBackups = false;
        }
    }

    async function restoreFromBackup(backupId: string) {
        const confirmed = await showDeleteDialog(
            '⚠️ WARNING: Restoring from backup will REPLACE all your current data!\n\n' +
            'This includes:\n' +
            '- All workspaces\n' +
            '- All notes and folders\n' +
            '- All calendar events\n' +
            '- All kanban boards\n' +
            '- All settings\n\n' +
            'Are you sure you want to continue?',
            'Restore Backup'
        );

        if (!confirmed) {
            return;
        }

        try {
            await backup.restoreBackup(backupId);
            
            // Call parent's onRestore callback to reload UI state
            await onRestore();
            
            // Close backup modal
            onClose();
            
            // If logged in, push restored data to Supabase to sync it
            // This ensures the restored data becomes the source of truth in the cloud
            if (isLoggedIn && sync) {
                try {
                    await ensureSupabaseLoaded();
                    await sync.pushToSupabase();
                    console.log('Restored data synced to Supabase');
                } catch (syncError) {
                    console.warn('Failed to sync restored data to Supabase:', syncError);
                    // Don't throw - restore was successful, sync can happen later
                }
            }
            
            alert('Backup restored successfully!');
        } catch (error) {
            console.error('Backup restore failed:', error);
            alert(`Backup restore failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async function deleteBackupItem(backupId: string) {
        const confirmed = await showDeleteDialog('Are you sure you want to delete this backup?');
        if (!confirmed) {
            return;
        }

        try {
            await backup.deleteBackup(backupId);
            await loadBackups();
            alert('Backup deleted successfully!');
        } catch (error) {
            console.error('Backup deletion failed:', error);
            alert(`Backup deletion failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
</script>

{#if open}
    <div 
        class="backup-modal-overlay" 
        role="button"
        tabindex="0"
        on:click={onClose}
        on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        }}
    >
        <div 
            class="backup-modal" 
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-modal-title"
            tabindex="-1"
            on:click|stopPropagation
            on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                }
            }}
        >
            <div class="backup-modal-header">
                <h2 id="backup-modal-title">Backup Management</h2>
                <button class="backup-modal-close" on:click={onClose}>×</button>
            </div>
            <div class="backup-modal-content">
                <div class="backup-actions">
                    <button class="backup-btn" on:click={createBackup}>
                        Create New Backup
                    </button>
                    <button class="backup-btn" on:click={() => backupFileInput?.click()}>
                        Import Backup
                    </button>
                    <button class="backup-btn" on:click={loadBackups}>
                        Refresh List
                    </button>
                </div>
                <input
                    type="file"
                    accept=".json"
                    bind:this={backupFileInput}
                    style="display: none;"
                    on:change={handleImportBackupFile}
                />
                {#if isLoadingBackups}
                    <div class="backup-loading">Loading backups...</div>
                {:else if backups.length === 0}
                    <div class="backup-empty">No backups found. Create your first backup!</div>
                {:else}
                    <div class="backup-list">
                        {#each backups as backupItem (backupItem.metadata.id)}
                            <div class="backup-item">
                                <div class="backup-info">
                                    <div class="backup-date">
                                        {new Date(backupItem.metadata.timestamp).toLocaleString()}
                                    </div>
                                    <div class="backup-meta">
                                        <span class="backup-type">
                                            <span class="backup-type-icon">{@html backupItem.metadata.type === 'manual' ? ManualIcon : AutomaticIcon}</span>
                                            {backupItem.metadata.type === 'manual' ? 'Manual' : 'Automatic'}
                                        </span>
                                        <span class="backup-size">{backup.formatBackupSize(backupItem.metadata.size)}</span>
                                        {#if backupItem.metadata.description}
                                            <span class="backup-description">{backupItem.metadata.description}</span>
                                        {/if}
                                    </div>
                                </div>
                                <div class="backup-actions-item">
                                    <button class="backup-action-btn restore" on:click={() => restoreFromBackup(backupItem.metadata.id)}>
                                        Restore
                                    </button>
                                    <button class="backup-action-btn download" on:click={() => downloadBackup(backupItem.metadata.id)}>
                                        Download
                                    </button>
                                    <button class="backup-action-btn delete" on:click={() => deleteBackupItem(backupItem.metadata.id)}>
                                        Delete
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .backup-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    }

    .backup-modal {
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        width: 90%;
        max-width: 700px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .backup-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border);
    }

    .backup-modal-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
    }

    .backup-modal-close {
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: var(--text);
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
    }

    .backup-modal-close:hover {
        background: var(--border);
    }

    .backup-modal-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
    }

    .backup-actions {
        display: flex;
        gap: 12px;
        margin-bottom: 20px;
    }

    .backup-btn {
        padding: 10px 20px;
        background: var(--accent-red);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background 0.2s;
    }

    .backup-btn:hover {
        background: var(--accent-red-hover, #d32f2f);
    }

    .backup-loading,
    .backup-empty {
        text-align: center;
        padding: 40px;
        color: var(--text-secondary);
    }

    .backup-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .backup-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        transition: border-color 0.2s;
    }

    .backup-item:hover {
        border-color: var(--accent-red);
    }

    .backup-info {
        flex: 1;
    }

    .backup-date {
        font-weight: 600;
        margin-bottom: 8px;
        color: var(--text);
    }

    .backup-meta {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        font-size: 13px;
        color: var(--text-secondary);
        align-items: center;
    }

    .backup-type {
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .backup-type-icon {
        display: inline-flex;
        align-items: center;
        width: 14px;
        height: 14px;
    }

    .backup-type-icon svg {
        width: 100%;
        height: 100%;
    }

    .backup-size {
        font-family: monospace;
    }

    .backup-description {
        font-style: italic;
    }

    .backup-actions-item {
        display: flex;
        gap: 8px;
    }

    .backup-action-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
    }

    .backup-action-btn.restore {
        background: #4caf50;
        color: white;
    }

    .backup-action-btn.restore:hover {
        background: #45a049;
    }

    .backup-action-btn.download {
        background: #2196f3;
        color: white;
    }

    .backup-action-btn.download:hover {
        background: #0b7dda;
    }

    .backup-action-btn.delete {
        background: #f44336;
        color: white;
    }

    .backup-action-btn.delete:hover {
        background: #da190b;
    }
</style>

