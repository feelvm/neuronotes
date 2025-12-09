<script lang="ts">
    import type { Workspace } from '$lib/db_types';

    export let workspaces: Workspace[];
    export let activeWorkspaceId: string | null;
    export let isLoggedIn: boolean;
    export let editingWorkspaceId: string | null;
    export let draggedWorkspaceId: string | null;
    export let showSettingsDropdown: boolean;

    // Callbacks
    export let onSwitchWorkspace: (id: string) => Promise<void>;
    export let onAddWorkspace: () => Promise<void>;
    export let onRenameWorkspace: (id: string, newName: string) => Promise<void>;
    export let onDeleteWorkspace: (id: string) => Promise<void>;
    export let onWorkspaceDragStart: (e: DragEvent, workspaceId: string) => void;
    export let onWorkspaceDrop: (e: DragEvent, targetIndex: number) => Promise<void>;
    export let onWorkspaceDragEnd: () => void;
    export let onSetEditingWorkspaceId: (id: string | null) => void;
    export let onShowLoginModal: () => void;
    export let onLogout: () => Promise<void>;
    export let onToggleSettingsDropdown: () => void;
    export let onShowBackupModal: () => void;
    export let onShowEditPanelsModal: () => void;

    // Settings dropdown positioning
    function settingsDropdown(node: HTMLElement) {
        function updatePosition() {
            const settingsBtn = document.querySelector('.settings-btn') as HTMLElement;
            if (settingsBtn && node) {
                const rect = settingsBtn.getBoundingClientRect();
                node.style.top = `${rect.bottom + 8}px`;
                node.style.right = `${window.innerWidth - rect.right}px`;
            }
        }

        function handleClickOutside(event: MouseEvent) {
            if (node && !node.contains(event.target as Node) && 
                !(event.target as HTMLElement)?.closest('.settings-btn')) {
                onToggleSettingsDropdown();
            }
        }

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        document.addEventListener('click', handleClickOutside);

        return {
            update() {
                updatePosition();
            },
            destroy() {
                window.removeEventListener('resize', updatePosition);
                window.removeEventListener('scroll', updatePosition, true);
                document.removeEventListener('click', handleClickOutside);
            }
        };
    }

    const SettingsIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 8.25C9.92894 8.25 8.25 9.92893 8.25 12C8.25 14.0711 9.92894 15.75 12 15.75C14.0711 15.75 15.75 14.0711 15.75 12C15.75 9.92893 14.0711 8.25 12 8.25ZM9.75 12C9.75 10.7574 10.7574 9.75 12 9.75C13.2426 9.75 14.25 10.7574 14.25 12C14.25 13.2426 13.2426 14.25 12 14.25C10.7574 14.25 9.75 13.2426 9.75 12Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M11.9747 1.25C11.5303 1.24999 11.1592 1.24999 10.8546 1.27077C10.5375 1.29241 10.238 1.33905 9.94761 1.45933C9.27379 1.73844 8.73843 2.27379 8.45932 2.94762C8.31402 3.29842 8.27467 3.66812 8.25964 4.06996C8.24756 4.39299 8.08454 4.66251 7.84395 4.80141C7.60337 4.94031 7.28845 4.94673 7.00266 4.79568C6.64714 4.60777 6.30729 4.45699 5.93083 4.40743C5.20773 4.31223 4.47642 4.50819 3.89779 4.95219C3.64843 5.14353 3.45827 5.3796 3.28099 5.6434C3.11068 5.89681 2.92517 6.21815 2.70294 6.60307L2.67769 6.64681C2.45545 7.03172 2.26993 7.35304 2.13562 7.62723C1.99581 7.91267 1.88644 8.19539 1.84541 8.50701C1.75021 9.23012 1.94617 9.96142 2.39016 10.5401C2.62128 10.8412 2.92173 11.0602 3.26217 11.2741C3.53595 11.4461 3.68788 11.7221 3.68786 12C3.68785 12.2778 3.53592 12.5538 3.26217 12.7258C2.92169 12.9397 2.62121 13.1587 2.39007 13.4599C1.94607 14.0385 1.75012 14.7698 1.84531 15.4929C1.88634 15.8045 1.99571 16.0873 2.13552 16.3727C2.26983 16.6582 2.45535 16.9795 2.67759 17.3644L2.70284 17.4082C2.92507 17.7931 3.11059 18.1144 3.2809 18.3678C3.45818 18.6316 3.64834 18.8677 3.8977 19.059C4.47633 19.503 5.20764 19.699 5.93074 19.6038C6.3072 19.5542 6.64705 19.4034 7.00257 19.2155C7.28836 19.0645 7.60328 19.0709 7.84386 19.2098C8.08445 19.3487 8.24747 19.6182 8.25955 19.9412C8.27458 20.3431 8.31393 20.7128 8.45923 21.0636C8.73834 21.7374 9.2737 22.2728 9.94752 22.5519C10.2379 22.6722 10.5374 22.7188 10.8545 22.7405C11.1591 22.7612 11.5302 22.7612 11.9746 22.7612H12.0254C12.4698 22.7612 12.8409 22.7612 13.1455 22.7405C13.4626 22.7188 13.7621 22.6722 14.0525 22.5519C14.7263 22.2728 15.2617 21.7374 15.5408 21.0636C15.6861 20.7128 15.7254 20.3431 15.7405 19.9412C15.7525 19.6182 15.9156 19.3487 16.1562 19.2098C16.3968 19.0709 16.7117 19.0645 16.9975 19.2155C17.353 19.4034 17.6929 19.5542 18.0693 19.6038C18.7924 19.699 19.5237 19.503 20.1024 19.059C20.3517 18.8677 20.5419 18.6316 20.7192 18.3678C20.8895 18.1144 21.075 17.7931 21.2972 17.4082L21.3225 17.3644C21.5447 16.9795 21.7302 16.6582 21.8701 16.3727C22.0044 16.0873 22.1137 15.8045 22.1548 15.4929C22.25 14.7698 22.054 14.0385 21.61 13.4599C21.3789 13.1587 21.0784 12.9397 20.7379 12.7258C20.4642 12.5538 20.3122 12.2778 20.3122 12C20.3122 11.7221 20.4642 11.4461 20.7379 11.2741C21.0784 11.0602 21.3789 10.8412 21.61 10.5401C22.054 9.96142 22.25 9.23012 22.1548 8.50701C22.1137 8.19539 22.0044 7.91267 21.8701 7.62723C21.7302 7.35304 21.5447 7.03172 21.3225 6.64681L21.2972 6.60307C21.075 6.21815 20.8895 5.89681 20.7192 5.6434C20.5419 5.3796 20.3517 5.14353 20.1024 4.95219C19.5237 4.50819 18.7924 4.31223 18.0693 4.40743C17.6929 4.45699 17.353 4.60777 16.9975 4.79568C16.7117 4.94673 16.3968 4.94031 16.1562 4.80141C15.9156 4.66251 15.7525 4.39299 15.7405 4.06996C15.7254 3.66812 15.6861 3.29842 15.5408 2.94762C15.2617 2.27379 14.7263 1.73844 14.0525 1.45933C13.7621 1.33905 13.4626 1.29241 13.1455 1.27077C12.8409 1.24999 12.4698 1.24999 12.0254 1.25H11.9747Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>`;
</script>

<div class="nav">
    <div class="brand">NEURONOTES</div>

    <div class="workspace-tabs">
        {#each workspaces as ws, i (ws.id)}
            <div
                class="workspace-tab"
                class:active={ws.id === activeWorkspaceId}
                class:drag-over={draggedWorkspaceId && draggedWorkspaceId !== ws.id}
                draggable="true"
                on:dragstart={(e) => onWorkspaceDragStart(e, ws.id)}
                on:dragover|preventDefault
                on:drop={(e) => onWorkspaceDrop(e, i)}
                on:dragend={onWorkspaceDragEnd}
                on:click={() => onSwitchWorkspace(ws.id)}
            >
                {#if editingWorkspaceId === ws.id}
                    <input
                        value={ws.name}
                        use:focus
                        on:blur={(e) =>
                            onRenameWorkspace(ws.id, (e.target as HTMLInputElement).value)}
                        on:keydown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') onSetEditingWorkspaceId(null);
                        }}
                    />
                {:else}
                    <div
                        class="workspace-name"
                        on:dblclick={() => onSetEditingWorkspaceId(ws.id)}
                        title="Double-click to rename"
                    >
                        {ws.name}
                    </div>
                {/if}
                <button
                    class="delete-ws-btn"
                    title="Delete Workspace"
                    on:click|stopPropagation={() => onDeleteWorkspace(ws.id)}
                >
                    ×
                </button>
            </div>
        {/each}
        <button class="add-workspace-btn" on:click={onAddWorkspace} title="New Workspace">
            +
        </button>
    </div>

    <div class="spacer"></div>
    
    <div class="nav-buttons-group">
        <div class="auth-container">
            {#if !isLoggedIn}
                <button 
                    class="auth-btn"
                    on:click={onShowLoginModal}
                    title="Login"
                >
                    Log in
                </button>
            {:else}
                <button 
                    class="auth-btn"
                    on:click={onLogout}
                    title="Logout"
                >
                    Log out
                </button>
            {/if}
        </div>
    
        <div class="settings-container">
            <button 
                class="settings-btn"
                class:active={showSettingsDropdown}
                on:click={onToggleSettingsDropdown}
                title="Settings"
            >
                {@html SettingsIcon}
            </button>
            {#if showSettingsDropdown}
                <div class="settings-dropdown" use:settingsDropdown>
                    {#if !isLoggedIn}
                        <button 
                            class="settings-item" 
                            on:click={() => { 
                                onToggleSettingsDropdown();
                                onShowLoginModal(); 
                            }}>
                            Log in
                        </button>
                    {:else}
                        <button 
                            class="settings-item" 
                            on:click={async () => {
                                onToggleSettingsDropdown();
                                await onLogout();
                            }}>
                            Log out
                        </button>
                    {/if}
                    <div class="settings-divider"></div>
                    <button class="settings-item" on:click={() => { onToggleSettingsDropdown(); onShowBackupModal(); }}>
                        Manage Backups
                    </button>
                    <button class="settings-item" on:click={() => { onToggleSettingsDropdown(); onShowEditPanelsModal(); }}>
                        Edit Panels
                    </button>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .nav {
        height: 50px;
        display: flex;
        align-items: center;
        padding: 0 24px;
        border-bottom: 1px solid var(--border);
        background: rgba(26, 26, 26, 0.8);
        backdrop-filter: blur(8px);
        flex-shrink: 0;
        gap: 24px;
        position: relative;
        z-index: 10002;
    }

    .brand {
        font-weight: 700;
        flex-shrink: 0;
    }

    .spacer {
        flex: 1;
        min-width: 24px;
    }

    .nav-right-placeholder {
        width: 100px;
        flex-shrink: 0;
    }

    .nav-buttons-group {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
    }

    .auth-container {
        position: relative;
        flex-shrink: 0;
    }

    .auth-btn {
        height: 36px;
        padding: 8px 16px;
        border-radius: 8px;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        color: var(--text);
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
    }

    .auth-btn:hover {
        border-color: var(--accent-red);
        background: var(--panel-bg-darker);
    }

    .settings-container {
        position: relative;
        flex-shrink: 0;
    }

    .settings-btn {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        color: var(--text);
        cursor: pointer;
        font-size: 18px;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
    }

    .settings-btn svg {
        width: 18px;
        height: 18px;
    }

    .settings-btn:hover {
        border-color: var(--accent-red);
        background: var(--panel-bg-darker);
    }

    .settings-btn.active {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
    }

    .settings-dropdown {
        position: fixed;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 4px;
        width: 160px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10003;
    }

    .settings-item {
        width: 100%;
        padding: 8px 12px;
        background: transparent;
        border: none;
        color: var(--text);
        text-align: left;
        cursor: pointer;
        border-radius: 4px;
        font-size: 13px;
        transition: background-color 0.2s;
    }
    .settings-item:hover {
        background: var(--panel-bg-darker);
    }
    .settings-divider {
        height: 1px;
        background: var(--border);
        margin: 4px 0;
    }

    .workspace-tabs {
        display: flex;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }

    .workspace-tabs::-webkit-scrollbar {
        display: none;
    }

    .workspace-tab {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px;
        border-radius: 8px;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        cursor: pointer;
        transition: all 0.2s;
        flex-shrink: 0;
        font-size: 13px;
    }

    .workspace-tab:hover {
        border-color: var(--text-muted);
    }

    .workspace-tab.active {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
    }

    .workspace-tab.drag-over {
        outline: 2px solid var(--accent-red);
        outline-offset: 2px;
    }

    .workspace-name {
        padding: 2px 0;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .workspace-tab input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--text);
        width: 120px;
        padding: 2px 0;
        font-family: var(--font-sans);
    }

    .delete-ws-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 0;
        margin: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        opacity: 0.7;
        transition: all 0.2s;
    }

    .delete-ws-btn:hover {
        color: var(--accent-red);
        background: rgba(255, 71, 87, 0.2);
        opacity: 1;
    }

    .add-workspace-btn {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        color: var(--text);
        cursor: pointer;
        font-size: 16px;
        transition: all 0.2s;
        flex-shrink: 0;
    }

    .add-workspace-btn:hover {
        border-color: var(--accent-red);
        background: var(--panel-bg-darker);
    }

    @media (max-width: 768px) {
        .nav {
            flex-wrap: wrap;
        }
        .nav-right-placeholder {
            display: none;
        }
        .auth-container {
            display: none;
        }
        .settings-container {
            margin-left: auto;
        }
        .workspace-tabs {
            overflow-x: auto;
        }
    }
</style>

