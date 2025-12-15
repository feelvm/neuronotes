<script lang="ts">
    export let open = false;
    export let workspaceName = '';

    // Callbacks
    export let onClose: () => void;
    export let onSubmit: (name: string) => void;

    function handleSubmit() {
        if (!workspaceName?.trim()) return;
        onSubmit(workspaceName.trim());
        workspaceName = '';
        onClose();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            onClose();
        }
    }

    function handleInputKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit();
        }
    }
</script>

{#if open}
    <div 
        class="login-modal-overlay" 
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
            class="login-modal" 
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-modal-title"
            tabindex="-1"
            on:click|stopPropagation
            on:keydown={handleKeydown}
        >
            <div class="login-modal-header">
                <h2 id="workspace-modal-title">Create Workspace</h2>
                <button class="login-modal-close" on:click={onClose}>×</button>
            </div>
            <div class="login-modal-content">
                <form on:submit|preventDefault={handleSubmit}>
                    <div class="login-field">
                        <label for="workspace-name">Workspace Name</label>
                        <input
                            id="workspace-name"
                            type="text"
                            bind:value={workspaceName}
                            placeholder="Enter workspace name"
                            required
                            on:keydown={handleInputKeydown}
                        />
                    </div>
                    <div class="login-actions">
                        <button type="submit" class="login-submit-btn">Create</button>
                        <button type="button" class="login-signup-btn" on:click={onClose}>Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
{/if}

<style>
    .login-modal-overlay {
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

    .login-modal {
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        width: 90%;
        max-width: 400px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .login-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border);
    }

    .login-modal-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
    }

    .login-modal-close {
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

    .login-modal-close:hover {
        background: var(--border);
    }

    .login-modal-content {
        padding: 20px;
    }

    .login-field {
        margin-bottom: 20px;
    }

    .login-field label {
        display: block;
        margin-bottom: 8px;
        font-size: 14px;
        font-weight: 500;
        color: var(--text);
    }

    .login-field input[type="text"] {
        width: 100%;
        padding: 10px 12px;
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text);
        font-size: 16px;
        transform: scale(0.875);
        transform-origin: left center;
        transition: border-color 0.2s, background-color 0.2s;
        box-sizing: border-box;
    }

    .login-field input[type="text"]:focus {
        outline: none;
        border-color: var(--accent-red);
    }

    .login-actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .login-submit-btn,
    .login-signup-btn {
        flex: 1;
        padding: 12px 20px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .login-submit-btn {
        background: var(--accent-red);
        color: white;
    }

    .login-submit-btn:hover {
        background: #ff3838;
    }

    .login-signup-btn {
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        color: var(--text);
    }

    .login-signup-btn:hover {
        background: var(--border);
    }
</style>
