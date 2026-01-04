<script lang="ts">
    export let open = false;

    export let onClose: () => void;
    export let onDone: () => void;

    // Preference toggles - will be populated later
    // For now, we'll create a structure that can be easily extended
    let preferences: Record<string, boolean> = {};

    function handleToggle(key: string) {
        preferences[key] = !preferences[key];
    }
</script>

{#if open}
    <div 
        class="preferences-modal-overlay" 
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
            class="preferences-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preferences-modal-title"
            tabindex="-1"
            on:click|stopPropagation
            on:keydown={(e) => {
                if (e.key === 'Escape') {
                    onClose();
                }
            }}
        >
            <div class="preferences-modal-header">
                <h2 id="preferences-modal-title">Preferences</h2>
                <button class="preferences-modal-close" on:click={onClose}>×</button>
            </div>
            <div class="preferences-modal-content">
                <div class="preferences-list">
                    <!-- Toggle options will be added here later -->
                    <!-- Example structure for future toggles:
                    <label 
                        class="preference-toggle"
                        class:active={preferences.exampleOption}
                        on:mouseenter={(e) => e.currentTarget.style.background = 'var(--panel-bg-darker)'}
                        on:mouseleave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        <input 
                            type="checkbox" 
                            bind:checked={preferences.exampleOption}
                            on:change={() => handleToggle('exampleOption')}
                        />
                        <span class="preference-label">Example Option</span>
                    </label>
                    -->
                    <p style="color: var(--text-secondary); font-style: italic; margin: 0;">Preference options will be added here.</p>
                </div>
            </div>
            <div class="preferences-modal-footer">
                <button 
                    class="preferences-btn" 
                    on:click={() => {
                        onDone();
                        onClose();
                    }}
                >
                    Done
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .preferences-modal-overlay {
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

    .preferences-modal {
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .preferences-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border);
    }

    .preferences-modal-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
    }

    .preferences-modal-close {
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

    .preferences-modal-close:hover {
        background: var(--border);
    }

    .preferences-modal-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
    }

    .preferences-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .preference-toggle {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid var(--border);
        transition: background 0.2s;
    }

    .preference-toggle:hover {
        background: var(--panel-bg-darker);
    }

    .preference-toggle input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
    }

    .preference-label {
        font-weight: 500;
        flex: 1;
    }

    .preferences-modal-footer {
        padding: 20px;
        border-top: 1px solid var(--border);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
    }

    .preferences-btn {
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

    .preferences-btn:hover {
        background: var(--accent-red-hover, #d32f2f);
    }
</style>

