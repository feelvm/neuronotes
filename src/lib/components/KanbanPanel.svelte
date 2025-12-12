<script lang="ts">
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import * as db from '$lib/db';
    import { generateUUID } from '$lib/utils/uuid';
    import { debounce } from '$lib/utils/debounce';
    import type { Column, Task } from '$lib/db_types';

    // Props
    export let isMinimized: boolean;
    export let activeWorkspaceId: string | null;
    export let onToggleMinimized: () => void;
    export let onSyncIfLoggedIn: () => Promise<void>;
    export let onLoadActiveWorkspaceData: () => Promise<void>;

    let kanban: Column[] = [];
    let isKanbanLoaded = false;
    let editingColumnId: string | null = null;
    let editingTaskId: string | null = null;
    let draggedTaskInfo: { colId: string; taskId: string } | null = null;
    let kanbanDropTarget: { colId: string; taskIndex: number } | null = null;
    let isDraggingTask = false;

    function focus(node: HTMLElement) {
        node.focus();
        return { destroy() {} };
    }

    const debouncedPersistKanban = debounce(async () => {
        if (!activeWorkspaceId) {
            return;
        }
        if (!kanban || kanban.length === 0) {
            return;
        }
        try {
            await db.putKanban({
                workspaceId: activeWorkspaceId,
                columns: kanban
            });
            await onSyncIfLoggedIn();
        } catch (error) {
            console.error('[kanban] Failed to save kanban:', error);
        }
    }, 400);
    
    $: if (browser && activeWorkspaceId && kanban) {
        debouncedPersistKanban();
    }

    function addColumn() {
        kanban = [
            ...kanban,
            {
                id: generateUUID(),
                title: 'New Column',
                tasks: [],
                isCollapsed: false
            }
        ];
    }

    function renameColumn(colId: string, title: string) {
        const col = kanban.find((c) => c.id === colId);
        if (col && title.trim()) {
            col.title = title.trim();
            kanban = [...kanban];
        }
        editingColumnId = null;
    }

    async function deleteColumn(colId: string) {
        const col = kanban.find((c) => c.id === colId);
        if (!col) return;
        
        const taskCount = col.tasks.length;
        const taskWarning = taskCount > 0 
            ? `\n\nThis will also permanently delete ${taskCount} task${taskCount === 1 ? '' : 's'} in this column.`
            : '';
        
        const confirmed = await showDeleteDialog(`Are you sure you want to delete the column "${col.title}"?${taskWarning}\n\nThis action cannot be undone.`);
        if (!confirmed) {
            return;
        }
        
        kanban = kanban.filter((c) => c.id !== colId);
    }

    function addTask(col: Column, text: string) {
        if (!text.trim()) return;
        col.tasks.push({ id: generateUUID(), text: text.trim() });
        kanban = [...kanban];
    }

    function renameTask(colId: string, taskId: string, text: string) {
        const col = kanban.find((c) => c.id === colId);
        const task = col?.tasks.find((t) => t.id === taskId);
        if (task && text.trim()) {
            task.text = text.trim();
            kanban = [...kanban];
        }
        editingTaskId = null;
    }

    async function deleteTask(col: Column, taskId: string) {
        const task = col.tasks.find((t) => t.id === taskId);
        if (!task) return;
        
        const confirmed = await showDeleteDialog(`Are you sure you want to delete the task "${task.text}"?`);
        if (!confirmed) {
            return;
        }
        
        col.tasks = col.tasks.filter((t) => t.id !== taskId);
        kanban = [...kanban];
    }

    function toggleColumnCollapse(colId: string) {
        const col = kanban.find((c) => c.id === colId);
        if (col) {
            col.isCollapsed = !col.isCollapsed;
            kanban = [...kanban];
        }
    }

    function onTaskDragStart(colId: string, task: Task, ev: DragEvent) {
        ev.stopPropagation();
        draggedTaskInfo = { colId, taskId: task.id };
        isDraggingTask = true;
        if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.dropEffect = 'move';

            ev.dataTransfer.setData('text/plain', task.id);
            ev.dataTransfer.setData(
                'application/json',
                JSON.stringify({
                    colId,
                    taskId: task.id,
                    text: task.text
                })
            );

            const dragImage = document.createElement('div');
            dragImage.textContent = task.text;
            dragImage.style.cssText = `
                position: absolute;
                left: -9999px;
                top: -9999px;
                padding: 6px;
                background: var(--panel-bg);
                border: 1px solid var(--accent-red);
                border-radius: 10px;
                width: 218px;
                font-size: 14px;
                color: var(--text);
                overflow-wrap: break-word;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            `;
            document.body.appendChild(dragImage);

            ev.dataTransfer.setDragImage(dragImage, 109, 15);
            requestAnimationFrame(() => {
                setTimeout(() => {
                    if (document.body.contains(dragImage)) {
                        document.body.removeChild(dragImage);
                    }
                }, 0);
            });
        }
    }

    function onTaskDragOver(ev: DragEvent, targetColId: string, targetTaskIndex: number) {
        ev.preventDefault();
        ev.stopPropagation();

        if (ev.dataTransfer) {
            ev.dataTransfer.dropEffect = 'move';
        }

        if (draggedTaskInfo) {
            kanbanDropTarget = {
                colId: targetColId,
                taskIndex: targetTaskIndex
            };
        }
    }

    function onColumnDragOver(ev: DragEvent, targetColId: string) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.dataTransfer) {
            ev.dataTransfer.dropEffect = 'move';
        }

        if (draggedTaskInfo) {
            const col = kanban.find((c) => c.id === targetColId);
            if (col) {
                kanbanDropTarget = {
                    colId: targetColId,
                    taskIndex: col.tasks.length
                };
            }
        }
    }

    function onColumnDrop(targetColId: string, ev: DragEvent, isTaskDrop = false) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!draggedTaskInfo) {
            try {
                const jsonData = ev.dataTransfer?.getData('application/json');
                if (jsonData) {
                    const parsed = JSON.parse(jsonData);
                    draggedTaskInfo = {
                        colId: parsed.colId,
                        taskId: parsed.taskId
                    };
                }
            } catch (e) {
                console.error('Failed to recover drag data:', e);
                handleDragEnd();
                return;
            }
        }

        if (!draggedTaskInfo) {
            handleDragEnd();
            return;
        }

        const { colId, taskId } = draggedTaskInfo;

        const fromColIndex = kanban.findIndex((c) => c.id === colId);
        const toColIndex = kanban.findIndex((c) => c.id === targetColId);

        if (fromColIndex === -1 || toColIndex === -1) {
            handleDragEnd();
            return;
        }

        const fromCol = kanban[fromColIndex];
        const toCol = kanban[toColIndex];

        const fromIndex = fromCol.tasks.findIndex((t) => t.id === taskId);
        if (fromIndex < 0) {
            handleDragEnd();
            return;
        }

        let toIndex = toCol.tasks.length;
        if (kanbanDropTarget?.colId === targetColId) {
            toIndex = kanbanDropTarget.taskIndex;
        }

        if (fromCol.id === toCol.id && fromIndex < toIndex) {
            toIndex--;
        }

        const taskToMove = { ...fromCol.tasks[fromIndex] };
        const newKanban = kanban.map((col, idx) => {
            if (idx === fromColIndex) {
                const newTasks = col.tasks.filter((t) => t.id !== taskId);

                if (idx === toColIndex) {
                    newTasks.splice(toIndex, 0, taskToMove);
                }

                return { ...col, tasks: newTasks };
            }

            if (idx === toColIndex && idx !== fromColIndex) {
                const newTasks = [...col.tasks];
                newTasks.splice(toIndex, 0, taskToMove);
                return { ...col, tasks: newTasks };
            }

            return col;
        });
        kanban = newKanban;
        handleDragEnd();
    }

    function handleDragEnd(ev?: DragEvent) {
        if (ev) {
            ev.preventDefault();
        }

        draggedTaskInfo = null;
        isDraggingTask = false;
        kanbanDropTarget = null;
    }

    async function loadKanbanData(force = false) {
        if ((isKanbanLoaded && !force) || !browser || !activeWorkspaceId) return;
        try {
            const kData = await db.getKanbanByWorkspaceId(activeWorkspaceId);
            kanban = kData ? kData.columns : [];
            isKanbanLoaded = true;
        } catch (e) {
            console.error('Failed to load kanban data:', e);
            isKanbanLoaded = true; // Set to true even on error to prevent infinite retries
        }
    }

    function showDeleteDialog(message: string, deleteButtonText: string = 'Delete'): Promise<boolean> {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            const content = document.createElement('div');
            content.style.cssText = `
                background: var(--panel-bg);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 24px;
                max-width: 400px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            `;
            
            const sanitizedMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const sanitizedButtonText = deleteButtonText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            content.innerHTML = `
                <div style="color: var(--text); margin-bottom: 20px; line-height: 1.5; white-space: pre-wrap;">${sanitizedMessage}</div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="cancel" style="padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-bg); color: var(--text); cursor: pointer;">Cancel</button>
                    <button id="delete" style="padding: 8px 16px; border-radius: 8px; border: 1px solid var(--accent-red); background: rgba(255, 71, 87, 0.1); color: #ff6b81; cursor: pointer;">${sanitizedButtonText}</button>
                </div>
            `;
            
            dialog.appendChild(content);
            document.body.appendChild(dialog);
            
            const cleanup = () => {
                if (document.body.contains(dialog)) {
                    document.body.removeChild(dialog);
                }
            };
            
            content.querySelector('#delete')?.addEventListener('click', () => {
                cleanup();
                resolve(true);
            });
            
            content.querySelector('#cancel')?.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });
            
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    cleanup();
                    resolve(false);
                }
            });
        });
    }

    $: if (browser && !isMinimized && !isKanbanLoaded && activeWorkspaceId) {
        loadKanbanData();
    }

    $: if (activeWorkspaceId) {
        isKanbanLoaded = false;
    }
</script>

<div class="panel kanban-panel" class:minimized={isMinimized}>
    <div class="panel-header">
        <div class="panel-title">Kanban</div>
        <div class="spacer" />
        <div class="kanban-header-actions">
            {#if !isMinimized}
                <button class="small-btn" on:click={addColumn}>+ Column</button>
            {/if}
            <button
                class="small-btn panel-minimize-btn"
                on:click={onToggleMinimized}
                title={isMinimized ? 'Expand' : 'Collapse'}
            >
                {isMinimized ? '⤢' : '⤡'}
            </button>
        </div>
    </div>

    {#if !isMinimized}
        <div class="kanban-board">
            {#each kanban as col (col.id)}
                <div
                    class="kanban-col"
                    class:collapsed={col.isCollapsed}
                    on:dragover|preventDefault={(e) => onColumnDragOver(e, col.id)}
                    on:drop={(e) => onColumnDrop(col.id, e, false)}
                >
                    <div class="kanban-col-header">
                        <button
                            class="small-btn kanban-col-collapse-btn"
                            on:click={() => toggleColumnCollapse(col.id)}
                            title={col.isCollapsed ? 'Expand' : 'Collapse'}
                        >
                            {col.isCollapsed ? '⤢' : '⤡'}
                        </button>

                        {#if editingColumnId === col.id}
                            <input
                                value={col.title}
                                use:focus
                                on:blur={(e) =>
                                    renameColumn(
                                        col.id,
                                        (e.target as HTMLInputElement).value
                                    )}
                                on:keydown={(e) => {
                                    if (e.key === 'Enter')
                                        (e.target as HTMLInputElement).blur();
                                    if (e.key === 'Escape') editingColumnId = null;
                                }}
                            />
                        {:else}
                            <div
                                class="kanban-col-title-text"
                                on:dblclick={() => (editingColumnId = col.id)}
                                title="Double-click to rename"
                            >
                                {col.title}
                            </div>
                        {/if}

                        {#if !col.isCollapsed}
                            <button
                                class="small-btn danger"
                                on:click={() => deleteColumn(col.id)}
                                title="Delete column"
                            >
                                Delete
                            </button>
                        {/if}
                    </div>

                    {#if !col.isCollapsed}
                        <div class="kanban-tasks">
                            {#each col.tasks as t, i (t.id)}
                                {#if kanbanDropTarget?.colId === col.id && kanbanDropTarget?.taskIndex === i}
                                    <div class="drop-indicator"></div>
                                {/if}
                                <div
                                    class="kanban-task"
                                    class:dragging={isDraggingTask &&
                                        draggedTaskInfo?.taskId === t.id}
                                    draggable="true"
                                    on:dragstart={(e) => onTaskDragStart(col.id, t, e)}
                                    on:dragend={(e) => handleDragEnd(e)}
                                    on:dragover|preventDefault|stopPropagation={(e) =>
                                        onTaskDragOver(e, col.id, i)}
                                    on:drop|preventDefault|stopPropagation={(e) =>
                                        onColumnDrop(col.id, e, true)}
                                >
                                    {#if editingTaskId === t.id}
                                        <input
                                            value={t.text}
                                            use:focus
                                            on:blur={(e) =>
                                                renameTask(
                                                    col.id,
                                                    t.id,
                                                    (e.target as HTMLInputElement).value
                                                )}
                                            on:keydown={(e) => {
                                                if (e.key === 'Enter')
                                                    (
                                                        e.target as HTMLInputElement
                                                    ).blur();
                                                if (e.key === 'Escape')
                                                    editingTaskId = null;
                                            }}
                                        />
                                    {:else}
                                        <div
                                            class="kanban-task-text"
                                            on:dblclick={() => (editingTaskId = t.id)}
                                            title="Double-click to rename"
                                        >
                                            {t.text}
                                        </div>
                                    {/if}
                                    <button
                                        class="small-btn danger"
                                        on:click={() => deleteTask(col, t.id)}
                                        title="Delete task"
                                    >
                                        ×
                                    </button>
                                </div>
                            {/each}
                            {#if kanbanDropTarget?.colId === col.id && kanbanDropTarget?.taskIndex === col.tasks.length}
                                <div class="drop-indicator"></div>
                            {/if}
                        </div>

                        <div class="kanban-actions">
                            <input
                                type="text"
                                placeholder="New task..."
                                on:keydown={(e) => {
                                    const target = e.target as HTMLInputElement;
                                    if (e.key === 'Enter' && target.value.trim()) {
                                        addTask(col, target.value);
                                        target.value = '';
                                    }
                                }}
                            />
                            <button
                                class="small-btn"
                                on:click={(e) => {
                                    const input = (e.currentTarget as HTMLElement)
                                        .previousElementSibling as HTMLInputElement;
                                    if (input.value.trim()) {
                                        addTask(col, input.value);
                                        input.value = '';
                                    }
                                }}
                            >
                                Add
                            </button>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    * {
        box-sizing: border-box;
    }

    .panel {
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 16px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        max-width: 100%;
        max-height: 100%;
        transition: all 0.2s ease-in-out;
        position: relative;
        z-index: 1;
    }

    .panel.minimized {
        max-height: 60px;
        overflow: hidden;
    }

    .panel.minimized .panel-header {
        border-bottom: none;
    }

    .panel-header {
        padding: 12px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        flex-wrap: nowrap;
        min-height: 48px;
        max-height: 48px;
    }

    .panel-header .spacer {
        flex: 1;
    }

    .panel.minimized .panel-header .spacer {
        display: none;
    }

    .panel.minimized .panel-header {
        justify-content: center;
        position: relative;
    }

    .panel-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    .kanban-header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        flex-shrink: 0;
        max-width: 100%;
        margin-right: 0;
    }

    .kanban-header-actions::-webkit-scrollbar {
        display: none;
    }

    .panel.minimized .panel-minimize-btn {
        position: absolute;
        right: 12px;
    }

    .kanban-board {
        padding: 16px;
        display: flex;
        gap: 16px;
        overflow-x: auto;
        overflow-y: hidden;
        flex: 1;
        min-height: 0;
        max-height: 100%;
        align-items: flex-start;
        scroll-behavior: smooth;
    }

    .kanban-col {
        width: 240px;
        min-width: 240px;
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        max-height: 100%;
        height: 100%;
        flex-shrink: 0;
        transition: all 0.2s ease-in-out;
        position: relative;
    }

    .kanban-col.collapsed {
        width: 60px;
        min-width: 60px;
        height: auto;
    }

    .kanban-col-header {
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 15px;
        padding: 8px;
        min-height: 40px;
        border-bottom: 1px solid var(--border);
    }

    .kanban-col-collapse-btn {
        width: 28px;
        height: 28px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        font-size: 14px;
    }

    .kanban-col.collapsed .kanban-col-header {
        justify-content: center;
        border-bottom: none;
        padding: 8px 0;
    }

    .kanban-col-title-text {
        font-weight: 600;
        flex: 1;
        min-width: 0;
        cursor: text;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .kanban-col.collapsed .kanban-col-title-text {
        display: none;
    }

    .kanban-col-header input {
        background: transparent;
        color: var(--text);
        border: none;
        outline: none;
        font-weight: 600;
        flex: 1;
        min-width: 0;
        font-family: var(--font-sans);
        font-size: 0.9rem;
    }

    .kanban-col.collapsed .kanban-col-header input {
        display: none;
    }

    .kanban-tasks {
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        font-size: 14px;
        overflow-y: auto;
        flex: 1;
        scroll-behavior: smooth;
        min-height: 0;
    }

    .kanban-task {
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 6px;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
        cursor: grab;
        transition: opacity 0.2s;
    }

    .kanban-task.dragging {
        opacity: 0.3;
        transform: scale(1);
    }

    .kanban-task:active {
        cursor: grabbing;
        border-color: var(--accent-red);
    }

    .kanban-task-text {
        min-width: 0;
        cursor: text;
        overflow-wrap: break-word;
        padding: 4px;
    }

    .kanban-task input {
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--text);
        font-family: var(--font-sans);
        font-size: 14px;
        padding: 4px;
    }

    .kanban-actions {
        display: flex;
        gap: 10px;
        padding: 12px;
        border-top: 1px solid var(--border);
        background: var(--panel-bg-darker);
        border-radius: 0 0 12px 12px;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }

    .kanban-actions::-webkit-scrollbar {
        display: none;
    }

    .kanban-actions input {
        flex: 1;
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 6px 8px;
        color: var(--text);
        min-width: 120px;
        flex-shrink: 0;
        font-family: var(--font-sans);
        font-size: 12px;
    }

    .kanban-actions .small-btn {
        background: var(--accent-red);
        border-color: transparent;
        color: white;
        flex-shrink: 0;
    }

    .kanban-board,
    .kanban-tasks {
        scrollbar-width: thin;
        scrollbar-color: var(--border) transparent;
    }

    .kanban-board::-webkit-scrollbar,
    .kanban-tasks::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }

    .kanban-board::-webkit-scrollbar-thumb,
    .kanban-tasks::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 3px;
    }

    .drop-indicator {
        position: absolute;
        top: -2px;
        left: 0;
        right: 0;
        height: 3px;
        background-color: var(--accent-red);
        pointer-events: none;
        z-index: 10;
        box-shadow: 0 0 8px var(--accent-red);
    }

    .small-btn {
        background: var(--panel-bg);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 6px 10px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
        flex-shrink: 0;
        white-space: nowrap;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }

    .small-btn:hover {
        border-color: var(--accent-red);
    }

    .small-btn.danger:hover {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
    }

    .panel-minimize-btn {
        width: 32px;
        height: 32px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        font-size: 16px;
    }
</style>

