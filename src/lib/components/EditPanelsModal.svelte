<script lang="ts">
    export let open = false;
    export let showNotes = true;
    export let showCalendar = true;
    export let showKanban = true;
    export let savePanelSelection = false;

    export let onClose: () => void;
    export let onDone: () => void;
</script>

{#if open}
    <div 
        class="backup-modal-overlay" 
        role="button"
        tabindex="0"
        on:click={onClose}
        on:keydown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                onClose();
            }
        }}
    >
        <div 
            class="backup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-panels-modal-title"
            tabindex="-1"
            on:click|stopPropagation
            on:keydown={(e) => {
                if (e.key === 'Escape') {
                    onClose();
                }
            }}
        >
            <div class="backup-modal-header">
                <h2 id="edit-panels-modal-title">Edit Panels</h2>
                <button class="backup-modal-close" on:click={onClose}>×</button>
            </div>
            <div class="backup-modal-content">
                <p style="margin-bottom: 20px; color: var(--text-secondary);">Select which panels to display:</p>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <label 
                        style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px; border-radius: 8px; border: 1px solid var(--border); transition: background 0.2s;" 
                        class:active={showNotes}
                        on:mouseenter={(e) => e.currentTarget.style.background = 'var(--panel-bg-darker)'}
                        on:mouseleave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <input type="checkbox" bind:checked={showNotes} style="width: 18px; height: 18px; cursor: pointer;" />
                        <span style="font-weight: 500;">Notes</span>
                    </label>
                    <label 
                        style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px; border-radius: 8px; border: 1px solid var(--border); transition: background 0.2s;" 
                        class:active={showCalendar}
                        on:mouseenter={(e) => e.currentTarget.style.background = 'var(--panel-bg-darker)'}
                        on:mouseleave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <input type="checkbox" bind:checked={showCalendar} style="width: 18px; height: 18px; cursor: pointer;" />
                        <span style="font-weight: 500;">Calendar</span>
                    </label>
                    <label 
                        style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px; border-radius: 8px; border: 1px solid var(--border); transition: background 0.2s;" 
                        class:active={showKanban}
                        on:mouseenter={(e) => e.currentTarget.style.background = 'var(--panel-bg-darker)'}
                        on:mouseleave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <input type="checkbox" bind:checked={showKanban} style="width: 18px; height: 18px; cursor: pointer;" />
                        <span style="font-weight: 500;">Kanban</span>
                    </label>
                </div>
                {#if !showNotes && !showCalendar && !showKanban}
                    <p style="margin-top: 16px; color: var(--accent-red); font-size: 14px;">At least one panel must be visible.</p>
                {/if}
                <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border);">
                    <label 
                        style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px; border-radius: 8px; border: 1px solid var(--border); transition: background 0.2s;" 
                        on:mouseenter={(e) => e.currentTarget.style.background = 'var(--panel-bg-darker)'}
                        on:mouseleave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <input type="checkbox" bind:checked={savePanelSelection} style="width: 18px; height: 18px; cursor: pointer;" />
                        <span style="font-weight: 500;">Save panel selection</span>
                    </label>
                    <p style="margin-top: 8px; margin-left: 30px; color: var(--text-secondary); font-size: 12px;">When unchecked, panel selection will reset to default after reload.</p>
                </div>
            </div>
            <div class="backup-modal-footer">
                <button 
                    class="backup-btn" 
                    on:click={() => {
                        if (showNotes || showCalendar || showKanban) {
                            onDone();
                            onClose();
                        }
                    }}
                    disabled={!showNotes && !showCalendar && !showKanban}
                >
                    Done
                </button>
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

    .backup-modal-footer {
        padding: 20px;
        border-top: 1px solid var(--border);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
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

    .backup-btn:hover:not(:disabled) {
        background: var(--accent-red-hover, #d32f2f);
    }

    .backup-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>

