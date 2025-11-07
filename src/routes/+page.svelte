<script lang="ts">
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import Spreadsheet from '$lib/components/Spreadsheet.svelte';
    import * as db from '$lib/db';
    import { debounce } from '$lib/utils/debounce';
    import { generateUUID } from '$lib/utils/uuid';
    import { ymd, dmy, startOfWeek, localDateFromYMD } from '$lib/utils/dateHelpers';
    import { 
        applyFormat, 
        modifyFontSize as modifyFontSizeUtil, 
        getSelectedFontSize,
        handlePlainTextPaste
    } from '$lib/utils/textFormatting';
    import type {
        Workspace,
        Note,
        Folder,
        CalendarEvent,
        Column,
        Kanban,
        SpreadsheetCell,
        Task,
        Setting
    } from '$lib/db_types';

    let DOMPurify: any;
    let notesPanelWidth = 50;
    let calendarPanelHeight = 50;
    let isNoteListVisible = true;
    let isNotesMinimized = false;
    let isCalendarMinimized = false;
    let isKanbanMinimized = false;
    let lastNotesWidth = 50;
    let lastCalendarHeight = 50;
    let isVerticalResizing = false;
    let isHorizontalResizing = false;
    let notesPanelClientWidth = 0;
    let isTauri = false;

    $: minimizedCount =
        (isNotesMinimized ? 1 : 0) + (isCalendarMinimized ? 1 : 0) + (isKanbanMinimized ? 1 : 0);

    $: if (isNotesMinimized) {
        notesPanelWidth = 6;
    } else if (notesPanelWidth < 7) {
        notesPanelWidth = lastNotesWidth > 7 ? lastNotesWidth : 50;
    }

    $: if (isCalendarMinimized) {
        calendarPanelHeight = 6;
    } else if (isKanbanMinimized) {
        calendarPanelHeight = 94;
    } else if (calendarPanelHeight < 7 || calendarPanelHeight > 93) {
        calendarPanelHeight =
            lastCalendarHeight > 7 && lastCalendarHeight < 93 ? lastCalendarHeight : 50;
    }

    $: if (minimizedCount === 2) {
        if (!isNotesMinimized) notesPanelWidth = 94;
        else if (!isCalendarMinimized) calendarPanelHeight = 94;
        else if (!isKanbanMinimized) calendarPanelHeight = 6;
    } else if (minimizedCount < 2) {
        if (!isNotesMinimized && notesPanelWidth > 90) {
            notesPanelWidth = lastNotesWidth > 7 ? lastNotesWidth : 50;
        }
        if (!isCalendarMinimized && !isKanbanMinimized && calendarPanelHeight > 90) {
            calendarPanelHeight =
                lastCalendarHeight > 7 && lastCalendarHeight < 93 ? lastCalendarHeight : 50;
        }
    }

    function toggleNotesMinimized() {
        isNotesMinimized = !isNotesMinimized;
    }
    function toggleCalendarMinimized() {
        isCalendarMinimized = !isCalendarMinimized;
    }
    function toggleKanbanMinimized() {
        isKanbanMinimized = !isKanbanMinimized;
    }
    function toggleNoteList() {
        isNoteListVisible = !isNoteListVisible;
    }

    function startVerticalResize(e: MouseEvent) {
        e.preventDefault();
        isVerticalResizing = true;
        window.addEventListener('mousemove', doVerticalResize);
        window.addEventListener('mouseup', stopResize);
    }

    function doVerticalResize(e: MouseEvent) {
        if (!isVerticalResizing) return;
        const mainEl = document.querySelector('.main');
        if (!mainEl) return;
        const mainRect = mainEl.getBoundingClientRect();
        const newWidth = ((e.clientX - mainRect.left) / mainRect.width) * 100;
        notesPanelWidth = Math.max(6, Math.min(94, newWidth));
        lastNotesWidth = notesPanelWidth;
    }

    function startHorizontalResize(e: MouseEvent) {
        e.preventDefault();
        isHorizontalResizing = true;
        window.addEventListener('mousemove', doHorizontalResize);
        window.addEventListener('mouseup', stopResize);
    }

    function doHorizontalResize(e: MouseEvent) {
        if (!isHorizontalResizing) return;
        const rightEl = document.querySelector('.right');
        if (!rightEl) return;
        const rightRect = rightEl.getBoundingClientRect();
        const newHeight = ((e.clientY - rightRect.top) / rightRect.height) * 100;
        calendarPanelHeight = Math.max(6, Math.min(94, newHeight));
        lastCalendarHeight = calendarPanelHeight;
    }

    function stopResize() {
        isVerticalResizing = false;
        isHorizontalResizing = false;
        // Remove all potential listeners to prevent memory leaks
        window.removeEventListener('mousemove', doVerticalResize);
        window.removeEventListener('mousemove', doHorizontalResize);
        window.removeEventListener('mouseup', stopResize);
    }
    
    function cleanupResizeListeners() {
        // Ensure cleanup on component unmount
        window.removeEventListener('mousemove', doVerticalResize);
        window.removeEventListener('mousemove', doHorizontalResize);
        window.removeEventListener('mouseup', stopResize);
    }

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DAY_NAMES_LONG = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday'
    ];

    function focus(node: HTMLElement) {
        node.focus();
        return { destroy() {} };
    }

    function settingsDropdown(node: HTMLElement) {
        function handleClickOutside(event: MouseEvent) {
            if (node && !node.contains(event.target as Node) && 
                !(event.target as HTMLElement)?.closest('.settings-btn')) {
                showSettingsDropdown = false;
            }
        }

        document.addEventListener('click', handleClickOutside);
        return {
            destroy() {
                document.removeEventListener('click', handleClickOutside);
            }
        };
    }

    let editorDiv: HTMLElement;
    let selectedFontSize = 14;
    let spreadsheetComponentInstance: Spreadsheet;
    let selectedSheetCell: { row: number; col: number } | null = null;
    let sheetSelection: {
        start: { row: number; col: number };
        end: { row: number; col: number };
    } | null = null;

    $: canMergeOrUnmerge = (() => {
        if (!sheetSelection || !parsedCurrentNote?.spreadsheet) return false;
        const { start, end } = sheetSelection;
        const minRow = Math.min(start.row, end.row);
        const minCol = Math.min(start.col, end.col);
        const maxRow = Math.max(start.row, end.row);
        const maxCol = Math.max(start.col, end.col);

        if (minRow !== maxRow || minCol !== maxCol) return true;

        const cell = parsedCurrentNote.spreadsheet.data[minRow][minCol];
        return (cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1;
    })();

    function applyFormatCommand(command: string) {
        if (editorDiv) editorDiv.focus();
        applyFormat(command);
    }

    function modifyFontSize(amount: number) {
        if (!editorDiv) return;
        editorDiv.focus();
        
        selectedFontSize = modifyFontSizeUtil(editorDiv, amount);
        editorDiv.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function updateSelectedFontSize() {
        if (!browser || !editorDiv) return;
        selectedFontSize = getSelectedFontSize(editorDiv);
    }

    function insertCheckbox() {
        if (!editorDiv) return;
        editorDiv.focus();

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        
        // Create checkbox element
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'note-checkbox';
        checkbox.style.marginRight = '6px';
        checkbox.style.verticalAlign = 'middle';
        checkbox.style.cursor = 'pointer';
        
        // Add event listener to save state when checked/unchecked
        checkbox.addEventListener('change', () => {
            if (currentNote) {
                debouncedUpdateNote(currentNote);
            }
        });

        // Insert checkbox at cursor position
        range.deleteContents();
        range.insertNode(checkbox);
        
        // Move cursor after the checkbox so user can type
        range.setStartAfter(checkbox);
        range.setEndAfter(checkbox);
        selection.removeAllRanges();
        selection.addRange(range);

        // Trigger update to save
        editorDiv.dispatchEvent(new Event('input', { bubbles: true }));
    }

    let workspaces: Workspace[] = [];
    let activeWorkspaceId = '';
    let editingWorkspaceId: string | null = null;
    let draggedWorkspaceId: string | null = null;

    $: activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
    async function switchWorkspace(id: string) {
        if (id === activeWorkspaceId) return;
        debouncedUpdateNote.flush();

        notes = [];
        folders = [];
        calendarEvents = [];
        kanban = [];
        selectedNoteId = '';
        currentFolderId = null;

        activeWorkspaceId = id;
        await db.putSetting({ key: 'activeWorkspaceId', value: id });
        await loadActiveWorkspaceData();
    }

    async function addWorkspace() {
        const name = prompt('Enter new workspace name:', 'New Workspace');
        if (!name?.trim()) return;
        try {
            const newWorkspace: Workspace = {
                id: generateUUID(),
                name: name.trim(),
                order: workspaces.length
            };
            await db.putWorkspace(newWorkspace);
            workspaces = [...workspaces, newWorkspace];
            await switchWorkspace(newWorkspace.id);
        } catch (error) {
            console.error('Failed to add workspace:', error);
            alert('Failed to create workspace. Please try again.');
        }
    }

    async function renameWorkspace(id: string, newName: string) {
        const ws = workspaces.find((w) => w.id === id);
        if (ws && newName.trim()) {
            ws.name = newName.trim();
            await db.putWorkspace(ws);
            workspaces = [...workspaces];
        }
        editingWorkspaceId = null;
    }

    async function deleteWorkspace(id: string) {
        if (workspaces.length <= 1) {
            alert('Cannot delete the last workspace.');
            return;
        }
        const ws = workspaces.find((w) => w.id === id);
        if (!ws) return;
        if (!confirm(`Are you sure you want to delete "${ws.name}"? All its data will be lost.`)) {
            return;
        }

        const notesToDelete = await db.getNotesByWorkspaceId(id);
        for (const note of notesToDelete) await db.deleteNote(note.id);

        const foldersToDelete = await db.getFoldersByWorkspaceId(id);
        for (const f of foldersToDelete) await db.deleteFolder(f.id);

        const eventsToDelete = await db.getCalendarEventsByWorkspaceId(id);
        for (const e of eventsToDelete) await db.deleteCalendarEvent(e.id);
        await db.deleteWorkspace(id);

        workspaces = workspaces.filter((w) => w.id !== id);
        if (activeWorkspaceId === id) {
            await switchWorkspace(workspaces[0].id);
        }
    }

    function handleWorkspaceDragStart(e: DragEvent, workspaceId: string) {
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', workspaceId);
        }
        draggedWorkspaceId = workspaceId;
    }

    async function handleWorkspaceDrop(e: DragEvent, targetIndex: number) {
        e.preventDefault();
        if (!draggedWorkspaceId) return;

        const draggedIndex = workspaces.findIndex((w) => w.id === draggedWorkspaceId);
        if (draggedIndex === -1 || draggedIndex === targetIndex) {
            draggedWorkspaceId = null;
            return;
        }

        const reordered = [...workspaces];
        const [moved] = reordered.splice(draggedIndex, 1);
        reordered.splice(targetIndex, 0, moved);

        try {
            const promises = reordered.map((ws, index) => {
                ws.order = index;
                return db.putWorkspace(ws);
            });

            await Promise.all(promises);
            workspaces = reordered;
        } catch (error) {
            console.error('Failed to reorder workspaces:', error);
        } finally {
            draggedWorkspaceId = null;
        }
    }
    
    function handleWorkspaceDragEnd() {
        // Clean up drag state if drag was cancelled
        draggedWorkspaceId = null;
    }

    let notes: Note[] = [];
    let folders: Folder[] = [];
    let selectedNoteId = '';
    let currentFolderId: string | null = null;
    let dragOverFolderId: string | null = null;
    let dropIndex: number | null = null;
    let dragOverRoot = false;
    let editingFolderId: string | null = null;
    let editingNoteId: string | null = null;
    let isEditingHeaderName = false;
    let draggedItemType: 'folder' | 'note' | null = null;
    let isDragging = false;
    type DisplayItem = (Note & { displayType: 'note' }) | (Folder & { displayType: 'folder' });
    let displayList: DisplayItem[] = [];

    $: {
        let items: DisplayItem[];
        if (currentFolderId === null) {
            const rootNotes = notes
                .filter((n) => n.folderId === null)
                .map((n) => ({ ...n, displayType: 'note' as const }));
            const allFolders = folders.map((f) => ({
                ...f,
                displayType: 'folder' as const
            }));
            items = [...allFolders, ...rootNotes];
        } else {
            items = notes
                .filter((n) => n.folderId === currentFolderId)
                .map((n) => ({ ...n, displayType: 'note' as const }));
        }
        displayList = items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    $: currentFolder = folders.find((f) => f.id === currentFolderId);
    $: currentNote = notes.find((n) => n.id === selectedNoteId) ?? null;
    
    // Lazy load spreadsheet JSON - only parse when note is actually opened
    $: parsedCurrentNote = currentNote ? (() => {
        if (currentNote.type === 'spreadsheet') {
            // Check if we have raw JSON that needs parsing
            const noteWithRaw = currentNote as any;
            if (noteWithRaw._spreadsheetJson && !currentNote.spreadsheet) {
                try {
                    const parsed = JSON.parse(noteWithRaw._spreadsheetJson);
                    // Cache the parsed version and clear the raw JSON
                    currentNote.spreadsheet = parsed;
                    delete noteWithRaw._spreadsheetJson;
                    return currentNote;
                } catch (e) {
                    console.error('Failed to parse spreadsheet JSON:', e);
                    return currentNote;
                }
            }
        }
        return currentNote;
    })() : null;

    async function selectNote(id: string) {
        if (selectedNoteId === id) return;
        debouncedUpdateNote.flush();
        selectedSheetCell = null;
        sheetSelection = null;
        selectedNoteId = id;
        
        // Lazy load note contentHTML if not already loaded
        const note = notes.find((n) => n.id === id);
        if (note) {
            const noteWithMeta = note as any;
            if (!noteWithMeta._contentLoaded && note.contentHTML === '') {
                try {
                    note.contentHTML = await db.getNoteContent(id);
                    noteWithMeta._contentLoaded = true;
                    // Trigger reactivity update
                    notes = [...notes];
                } catch (e) {
                    console.error('Failed to load note content:', e);
                }
            }
        }
        
        await db.putSetting({
            key: `selectedNoteId:${activeWorkspaceId}`,
            value: id
        });
    }

    async function addNote(type: 'text' | 'spreadsheet' = 'text') {
        try {
            const notesInCurrentView = displayList.filter((item) => item.displayType === 'note');
            const n: Note = {
                id: generateUUID(),
                title: type === 'spreadsheet' ? 'Untitled Sheet' : 'Untitled Note',
                contentHTML: '',
                updatedAt: Date.now(),
                workspaceId: activeWorkspaceId,
                folderId: currentFolderId,
                order: notesInCurrentView.length,
                type: type,
                spreadsheet: type === 'spreadsheet' ? createEmptySpreadsheet() : undefined
            };
            await db.putNote(n);
            notes = [...notes, n];
            await selectNote(n.id);
        } catch (error) {
            console.error('Failed to add note:', error);
            alert('Failed to create note. Please try again.');
        }
    }

    function createEmptySpreadsheet(rows = 50, cols = 20) {
        const data: SpreadsheetCell[][] = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => ({ value: '' }))
        );
        const colWidths: Record<number, number> = {};
        for (let i = 0; i < cols; i++) colWidths[i] = 100;
        const rowHeights: Record<number, number> = {};
        for (let i = 0; i < rows; i++) rowHeights[i] = 25;
        return { data, colWidths, rowHeights };
    }

    async function addFolder() {
        const name = prompt('Enter new folder name:', 'New Folder');
        if (!name?.trim()) return;

        try {
            const f: Folder = {
                id: generateUUID(),
                name: name.trim(),
                workspaceId: activeWorkspaceId,
                order: displayList.length
            };
            await db.putFolder(f);
            folders = [...folders, f];
        } catch (error) {
            console.error('Failed to add folder:', error);
            alert('Failed to create folder. Please try again.');
        }
    }

    async function renameFolder(id: string, newName: string) {
        const folder = folders.find((f) => f.id === id);
        if (folder && newName.trim()) {
            folder.name = newName.trim();
            await db.putFolder(folder);
            folders = [...folders];
        }
        editingFolderId = null;
        isEditingHeaderName = false;
    }

    async function renameNote(id: string, newName: string) {
        const note = notes.find((n) => n.id === id);
        if (note && newName.trim()) {
            note.title = newName.trim();
            await db.putNote(note);
            notes = [...notes];
        }
        editingNoteId = null;
    }

    async function deleteFolder(folderId: string) {
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) return;
        if (!confirm(`Delete "${folder.name}"? All notes inside will be PERMANENTLY DELETED.`))
            return;

        const notesToDelete = notes.filter((n) => n.folderId === folderId);
        const deletePromises = notesToDelete.map((note) => db.deleteNote(note.id));
        await Promise.all(deletePromises);
        await db.deleteFolder(folderId);

        const deletedNoteIds = new Set(notesToDelete.map((n) => n.id));
        notes = notes.filter((n) => !deletedNoteIds.has(n.id));
        folders = folders.filter((f) => f.id !== folderId);

        if (currentFolderId === folderId) await goBack();
    }

    async function deleteNote(id: string) {
        const note = notes.find((n) => n.id === id);
        if (!note) return;
        
        const noteType = note.type === 'spreadsheet' ? 'spreadsheet' : 'note';
        const noteTitle = note.title || 'Untitled';
        
        if (!confirm(`Are you sure you want to delete "${noteTitle}"? This ${noteType} will be permanently deleted and cannot be recovered.`)) {
            return;
        }
        
        await db.deleteNote(id);
        notes = notes.filter((n) => n.id !== id);
        if (selectedNoteId === id) {
            const nextNote = displayList.find(
                (item) => item.displayType === 'note' && item.id !== id
            );
            await selectNote(nextNote?.id ?? '');
        }
    }

    function triggerNoteUpdate() {
        if (!currentNote) return;
        notes = [...notes];
    }

    async function updateNote(note: Note) {
        const noteToSave = { ...note, updatedAt: Date.now() };
        if (browser && DOMPurify && noteToSave.type === 'text') {
            noteToSave.contentHTML = DOMPurify.sanitize(noteToSave.contentHTML);
        }
        await db.putNote(noteToSave);
        const index = notes.findIndex((n) => n.id === noteToSave.id);
        if (index !== -1) {
            notes[index] = noteToSave;
            notes = [...notes];
        }
    }

    const debouncedUpdateNote = debounce(updateNote, 400);

    async function openFolder(folderId: string) {
        debouncedUpdateNote.flush();
        currentFolderId = folderId;
        selectedNoteId = '';
    }

    async function goBack() {
        debouncedUpdateNote.flush();
        currentFolderId = null;
        selectedNoteId = '';
    }

    function handleDragStart(ev: DragEvent, item: DisplayItem) {
        if (!ev.dataTransfer) return;

        console.log('Drag started:', item.displayType, item);
        isDragging = true;
        draggedItemType = item.displayType;
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.dropEffect = 'move';
        const itemData = JSON.stringify(item);
        ev.dataTransfer.setData('application/json', itemData);
        ev.dataTransfer.setData('text/plain', item.id);

        const dragImage = document.createElement('div');
        dragImage.textContent =
            item.displayType === 'folder' ? `📁 ${(item as Folder).name}` : (item as Note).title;
        dragImage.style.cssText = `
      position: absolute;
      left: -9999px;
      top: -9999px;
      padding: 12px 10px;
      background: var(--panel-bg);
      border: 1px solid var(--accent-red);
      border-radius: 4px;
      width: 160px;
      font-size: 14px;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
        document.body.appendChild(dragImage);

        ev.dataTransfer.setDragImage(dragImage, 80, 20);
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (document.body.contains(dragImage)) {
                    document.body.removeChild(dragImage);
                }
            }, 0);
        });
    }

    async function handleDropOnFolder(ev: DragEvent, targetFolder: Folder) {
        ev.preventDefault();
        dragOverFolderId = null;
        const data = ev.dataTransfer?.getData('application/json');
        if (!data) {
            isDragging = false;
            draggedItemType = null;
            return;
        }
        const draggedItem = JSON.parse(data) as DisplayItem;
        if (
            draggedItem.displayType === 'note' &&
            (draggedItem as Note).folderId !== targetFolder.id
        ) {
            const noteToMove = notes.find((n) => n.id === draggedItem.id);
            if (noteToMove) {
                noteToMove.folderId = targetFolder.id;
                noteToMove.updatedAt = Date.now();
                noteToMove.order = notes.filter((n) => n.folderId === targetFolder.id).length;
                await db.putNote(noteToMove);
                notes = [...notes];
            }
        }
        isDragging = false;
        draggedItemType = null;
    }

    async function handleDropOnRoot(ev: DragEvent) {
        ev.preventDefault();
        dragOverRoot = false;
        const data = ev.dataTransfer?.getData('application/json');
        if (!data) {
            isDragging = false;
            draggedItemType = null;
            return;
        }
        const draggedItem = JSON.parse(data) as DisplayItem;
        if (draggedItem.displayType === 'note' && (draggedItem as Note).folderId !== null) {
            const noteToMove = notes.find((n) => n.id === draggedItem.id);
            if (noteToMove) {
                noteToMove.folderId = null;
                noteToMove.updatedAt = Date.now();
                noteToMove.order = displayList.length;
                await db.putNote(noteToMove);
                notes = [...notes];
            }
        }
        isDragging = false;
        draggedItemType = null;
    }

    async function handleReorderDrop(ev: DragEvent, targetIndex: number) {
        ev.preventDefault();
        ev.stopPropagation();
        dropIndex = null;
        console.log('Reorder drop triggered at index:', targetIndex);

        let data = ev.dataTransfer?.getData('application/json');
        if (!data) {
            const textData = ev.dataTransfer?.getData('text/plain');
            if (textData) {
                const item = displayList.find((i) => i.id === textData);
                if (item) {
                    data = JSON.stringify(item);
                }
            }
        }

        if (!data) {
            // If we still don't have data but have draggedItemType, try to find the item
            // This shouldn't happen but is a fallback
            console.warn('No drag data found for reorder');
            isDragging = false;
            draggedItemType = null;
            return;
        }

        let draggedItem: DisplayItem;
        try {
            draggedItem = JSON.parse(data) as DisplayItem;
        } catch (err) {
            console.error('Failed to parse drag data:', err);
            isDragging = false;
            draggedItemType = null;
            return;
        }

        const currentViewList = [...displayList];
        const draggedIndex = currentViewList.findIndex((item) => item.id === draggedItem.id);

        if (draggedIndex === -1 || draggedIndex === targetIndex) {
            isDragging = false;
            draggedItemType = null;
            return;
        }
        const [movedItem] = currentViewList.splice(draggedIndex, 1);
        currentViewList.splice(targetIndex, 0, movedItem);

        const updates = currentViewList.map((item, index) => {
            // Create new objects instead of mutating, ensuring all required fields are preserved
            if (item.displayType === 'folder') {
                const folder = item as Folder & { displayType: 'folder' };
                // Find the original folder to ensure we have all required fields
                const originalFolder = folders.find(f => f.id === folder.id);
                if (!originalFolder) {
                    console.error('Original folder not found:', folder.id);
                    console.error('Available folders:', folders.map(f => ({ id: f.id, name: f.name, workspaceId: f.workspaceId })));
                    throw new Error(`Folder ${folder.id} not found`);
                }
                // Handle both snake_case (from DB) and camelCase (mapped) formats
                const workspaceId = (originalFolder as any).workspaceId || (originalFolder as any).workspace_id;
                if (!workspaceId) {
                    console.error('Original folder missing workspaceId:', originalFolder);
                    console.error('Available folders:', folders.map(f => ({ id: f.id, name: f.name, workspaceId: (f as any).workspaceId || (f as any).workspace_id })));
                    throw new Error(`Folder ${originalFolder.id} is missing workspaceId in original data`);
                }
                const updatedFolder: Folder = {
                    id: originalFolder.id,
                    name: originalFolder.name,
                    workspaceId: workspaceId,
                    order: index
                };
                console.log('Created folder update:', updatedFolder);
                return { 
                    ...updatedFolder,
                    displayType: 'folder' as const
                } as Folder & { displayType: 'folder' };
            } else {
                const note = item as Note & { displayType: 'note' };
                // Find the original note to ensure we have all required fields
                const originalNote = notes.find(n => n.id === note.id);
                if (!originalNote) {
                    console.error('Original note not found:', note.id);
                    throw new Error(`Note ${note.id} not found`);
                }
                if (!originalNote.workspaceId) {
                    console.error('Original note missing workspaceId:', originalNote);
                    throw new Error(`Note ${originalNote.id} is missing workspaceId in original data`);
                }
                const updatedNote: Note = {
                    ...originalNote,
                    order: index
                };
                console.log('Created note update:', { id: updatedNote.id, title: updatedNote.title, workspaceId: updatedNote.workspaceId, order: updatedNote.order });
                return { 
                    ...updatedNote,
                    displayType: 'note' as const
                } as Note & { displayType: 'note' };
            }
        });
        console.log('About to save updates. Count:', updates.length);
        console.log('Updates breakdown:', {
            folders: updates.filter(i => i.displayType === 'folder').length,
            notes: updates.filter(i => i.displayType === 'note').length
        });
        
        const promises = updates.map(async (item) => {
            if (item.displayType === 'folder') {
                const folder = item as Folder;
                // Ensure all required fields are present
                if (!folder.workspaceId) {
                    console.error('Folder missing workspaceId:', folder);
                    console.error('Full folder object:', JSON.stringify(folder, null, 2));
                    throw new Error(`Folder ${folder.id} is missing workspaceId`);
                }
                console.log('Saving folder:', { id: folder.id, name: folder.name, workspaceId: folder.workspaceId, order: folder.order });
                try {
                    await db.putFolder(folder);
                    console.log('Successfully saved folder:', folder.id);
                } catch (error) {
                    console.error('Error saving folder:', folder, error);
                    throw error;
                }
            } else {
                const note = item as Note;
                // Ensure all required fields are present
                if (!note.workspaceId) {
                    console.error('Note missing workspaceId:', note);
                    throw new Error(`Note ${note.id} is missing workspaceId`);
                }
                console.log('Saving note:', { id: note.id, title: note.title, workspaceId: note.workspaceId, order: note.order });
                try {
                    await db.putNote(note);
                    console.log('Successfully saved note:', note.id);
                } catch (error) {
                    console.error('Error saving note:', note, error);
                    throw error;
                }
            }
        });
        await Promise.all(promises);
        const updatedNotes = updates.filter(
            (i): i is Note & { displayType: 'note' } => i.displayType === 'note'
        );
        const updatedFolders = updates.filter(
            (i): i is Folder & { displayType: 'folder' } => i.displayType === 'folder'
        );
        
        // Update state immediately - create new arrays to trigger reactivity
        if (currentFolderId === null) {
            folders = updatedFolders.map(f => ({ ...f }));
            notes = notes.map((n) => {
                const updatedNote = updatedNotes.find((un) => un.id === n.id);
                return updatedNote && n.folderId === null 
                    ? { ...n, order: updatedNote.order } 
                    : { ...n };
            });
        } else {
            notes = notes.map((n) => {
                const updatedNote = updatedNotes.find((un) => un.id === n.id);
                return updatedNote && n.folderId === currentFolderId
                    ? { ...n, order: updatedNote.order }
                    : { ...n };
            });
        }

        // Force reactivity by creating new array references
        notes = [...notes];
        folders = [...folders];
        console.log('State updated - folders:', folders.length, 'notes:', notes.length);
        console.log('Updated folders:', folders.map(f => ({ id: f.id, name: f.name, order: f.order })));
        console.log('Updated notes (root):', notes.filter(n => n.folderId === null).map(n => ({ id: n.id, title: n.title, order: n.order })));
        isDragging = false;
        draggedItemType = null;
    }

    let calendarEvents: CalendarEvent[] = [];
    let today = new Date();
    let weekStart = new Date();
    let todayDateString = 'Calendar';
    let todayTimeString = '';
    $: weekDays = browser
        ? Array.from({ length: 7 }, (_, i) => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + i);
              return d;
          })
        : [];
    $: eventsByDay = (() => {
        if (!browser) return {};

        const occurrences: Record<string, CalendarEvent[]> = {};
        const viewStartDate = weekStart;
        const viewEndDate = new Date(viewStartDate);
        viewEndDate.setDate(viewEndDate.getDate() + 6);

        for (const event of calendarEvents) {
            const eventStartDate = localDateFromYMD(event.date);
            
            if (!event.repeat || event.repeat === 'none') {
                // Non-repeating event
                if (eventStartDate >= viewStartDate && eventStartDate <= viewEndDate) {
                    const dayKey = event.date;
                    if (!occurrences[dayKey]) occurrences[dayKey] = [];
                    occurrences[dayKey].push(event);
                }
            } else {
                // Repeating event - generate occurrences for the week
                const instances = generateRecurringInstances(event, viewStartDate, viewEndDate);
                for (const instanceDate of instances) {
                    const dayKey = ymd(instanceDate);
                    if (!occurrences[dayKey]) occurrences[dayKey] = [];
                    occurrences[dayKey].push(event);
                }
            }
        }

        for (const dayKey in occurrences) {
            occurrences[dayKey].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        }

        return occurrences;
    })();

    function generateRecurringInstances(event: CalendarEvent, startDate: Date, endDate: Date): Date[] {
        const instances: Date[] = [];
        const eventStart = localDateFromYMD(event.date);
        const exceptions = new Set(event.exceptions || []);
        
        let currentDate = new Date(Math.max(eventStart.getTime(), startDate.getTime()));
        currentDate.setHours(0, 0, 0, 0);

        while (currentDate <= endDate) {
            const dateKey = ymd(currentDate);
            
            // Check if this instance was deleted
            if (!exceptions.has(dateKey)) {
                let shouldInclude = false;

                switch (event.repeat) {
                    case 'daily':
                        shouldInclude = currentDate >= eventStart;
                        break;
                    
                    case 'weekly':
                        const daysSinceStart = Math.floor((currentDate.getTime() - eventStart.getTime()) / (1000 * 60 * 60 * 24));
                        shouldInclude = daysSinceStart >= 0 && daysSinceStart % 7 === 0;
                        break;
                    
                    case 'monthly':
                        shouldInclude = currentDate.getDate() === eventStart.getDate() && currentDate >= eventStart;
                        break;
                    
                    case 'yearly':
                        shouldInclude = currentDate.getMonth() === eventStart.getMonth() && 
                                      currentDate.getDate() === eventStart.getDate() && 
                                      currentDate >= eventStart;
                        break;
                    
                    case 'custom':
                        if (event.repeatOn && event.repeatOn.length > 0) {
                            const dayOfWeek = currentDate.getDay();
                            // Convert Sunday (0) to 7 for our Monday-first system
                            const adjustedDay = dayOfWeek === 0 ? 7 : dayOfWeek;
                            shouldInclude = event.repeatOn.includes(adjustedDay) && currentDate >= eventStart;
                        }
                        break;
                }

                if (shouldInclude) {
                    instances.push(new Date(currentDate));
                }
            }

            currentDate.setDate(currentDate.getDate() + 1);
        }

        return instances;
    }

    let newEventTitle = '';
    let newEventTime = '';
    let newEventDate = '';
    let newEventRepeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' = 'none';
    let newEventCustomDays: boolean[] = [false, false, false, false, false, false, false]; // Mon-Sun
    let newEventColor = '#8C7AE6'; // Default purple color
    let showRepeatOptions = false;

    // Helper function to convert hex color to rgba
    function hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    let showSettingsDropdown = false;
    let importFileInput: HTMLInputElement;
    
    async function exportIndexedDBData() {
        try {
            // Ensure database is initialized
            await db.init();
            
            // Get workspaces first - this is the base for all other queries
            const workspaces = await db.getAllWorkspaces();
            console.log('Export: Found workspaces:', workspaces.length);
            
            if (workspaces.length === 0) {
                alert('No workspaces found to export.');
                return;
            }
            
            // Now get all data for each workspace
            const [folders, notes, calendarEvents, kanban, settings] = await Promise.all([
                (async () => {
                    const allFolders: Folder[] = [];
                    for (const ws of workspaces) {
                        const wsFolders = await db.getFoldersByWorkspaceId(ws.id);
                        allFolders.push(...wsFolders);
                    }
                    console.log('Export: Found folders:', allFolders.length);
                    return allFolders;
                })(),
                (async () => {
                    const allNotes: Note[] = [];
                    for (const ws of workspaces) {
                        const wsNotes = await db.getNotesByWorkspaceId(ws.id);
                        allNotes.push(...wsNotes);
                    }
                    console.log('Export: Found notes:', allNotes.length);
                    return allNotes;
                })(),
                (async () => {
                    const allEvents: CalendarEvent[] = [];
                    for (const ws of workspaces) {
                        const wsEvents = await db.getCalendarEventsByWorkspaceId(ws.id);
                        allEvents.push(...wsEvents);
                    }
                    console.log('Export: Found calendar events:', allEvents.length);
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
                    console.log('Export: Found kanban boards:', allKanban.length);
                    return allKanban;
                })(),
                (async () => {
                    // Get all settings
                    if (isTauri) {
                        // For Tauri, try to get all settings using the database directly
                        // Since we don't have a getAllSettings function, we'll return empty array for now
                        // Settings can be workspace-specific and are usually not critical for migration
                        return [] as Setting[];
                    } else {
                        // For IndexedDB, we can get all settings
                        const sqliteModule = await import('$lib/sqlite');
                        const allSettings = await sqliteModule.getAll<Setting>('settings');
                        console.log('Export: Found settings:', allSettings.length);
                        return allSettings;
                    }
                })()
            ]);

            const exportData = {
                version: '1.0',
                exportDate: new Date().toISOString(),
                data: {
                    workspaces,
                    folders,
                    notes,
                    calendarEvents,
                    kanban,
                    settings
                }
            };

            // Log summary for debugging
            console.log('Export summary:', {
                workspaces: workspaces.length,
                folders: folders.length,
                notes: notes.length,
                calendarEvents: calendarEvents.length,
                kanban: kanban.length,
                settings: settings.length
            });

            const jsonData = JSON.stringify(exportData, null, 2);

            // Download file - browser downloads automatically go to Downloads folder
            // In Tauri, the download also goes to the Downloads folder by default
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `neuronotes-export-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            alert('Data exported successfully! The file has been saved to your Downloads folder (~/Downloads).');
        } catch (error) {
            console.error('Export failed:', error);
            alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async function handleImportFile(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        
        if (!file) return;

        try {
            const fileContent = await file.text();
            const importData = JSON.parse(fileContent);

            // Validate import data structure
            if (!importData.version || !importData.data) {
                alert('Invalid export file format. Please select a valid export file.');
                target.value = '';
                return;
            }

            // Confirm import (this will replace all current data)
            const confirmed = confirm(
                '⚠️ WARNING: Importing data will REPLACE all your current data!\n\n' +
                'This includes:\n' +
                '- All workspaces\n' +
                '- All notes and folders\n' +
                '- All calendar events\n' +
                '- All kanban boards\n' +
                '- All settings\n\n' +
                'Are you sure you want to continue?'
            );

            if (!confirmed) {
                target.value = '';
                return;
            }

            await importIndexedDBData(importData.data);
            
            // Clear the file input
            target.value = '';
            
            alert('Data imported successfully! The application will reload.');
            
            // Reload the page to reflect the imported data
            window.location.reload();
        } catch (error) {
            console.error('Import failed:', error);
            alert(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
            target.value = '';
        }
    }

    async function importIndexedDBData(data: {
        workspaces?: Workspace[];
        folders?: Folder[];
        notes?: Note[];
        calendarEvents?: CalendarEvent[];
        kanban?: Kanban[];
        settings?: Setting[];
    }) {
        try {
            // Ensure database is initialized
            await db.init();

            // Import workspaces first (they're needed for other data)
            if (data.workspaces && data.workspaces.length > 0) {
                console.log('Importing workspaces:', data.workspaces.length);
                for (const workspace of data.workspaces) {
                    await db.putWorkspace(workspace);
                }
            }

            // Import folders
            if (data.folders && data.folders.length > 0) {
                console.log('Importing folders:', data.folders.length);
                for (const folder of data.folders) {
                    await db.putFolder(folder);
                }
            }

            // Import notes
            if (data.notes && data.notes.length > 0) {
                console.log('Importing notes:', data.notes.length);
                for (const note of data.notes) {
                    await db.putNote(note);
                }
            }

            // Import calendar events
            if (data.calendarEvents && data.calendarEvents.length > 0) {
                console.log('Importing calendar events:', data.calendarEvents.length);
                for (const event of data.calendarEvents) {
                    await db.putCalendarEvent(event);
                }
            }

            // Import kanban boards
            if (data.kanban && data.kanban.length > 0) {
                console.log('Importing kanban boards:', data.kanban.length);
                for (const kanban of data.kanban) {
                    await db.putKanban(kanban);
                }
            }

            // Import settings
            if (data.settings && data.settings.length > 0) {
                console.log('Importing settings:', data.settings.length);
                for (const setting of data.settings) {
                    await db.putSetting(setting);
                }
            }

            console.log('Import completed successfully');
        } catch (error) {
            console.error('Import error:', error);
            throw error;
        }
    }

    function prevWeek() {
        const newDate = new Date(weekStart);
        newDate.setDate(newDate.getDate() - 7);
        weekStart = newDate;
    }
    function nextWeek() {
        const newDate = new Date(weekStart);
        newDate.setDate(newDate.getDate() + 7);
        weekStart = newDate;
    }

    async function addEvent() {
        if (!newEventTitle.trim() || !newEventDate) return;

        try {
            const newEvent: CalendarEvent = {
                id: generateUUID(),
                date: newEventDate,
                title: newEventTitle.trim(),
                time: newEventTime || undefined,
                workspaceId: activeWorkspaceId,
                repeat: newEventRepeat,
                repeatOn: newEventRepeat === 'custom' 
                    ? newEventCustomDays.map((checked, i) => checked ? i + 1 : -1).filter(d => d > 0)
                    : undefined,
                exceptions: [],
                color: newEventColor
            };
            await db.putCalendarEvent(newEvent);
            calendarEvents = [...calendarEvents, newEvent];
            newEventTitle = '';
            newEventTime = '';
            newEventRepeat = 'none';
            newEventCustomDays = [false, false, false, false, false, false, false];
            newEventColor = '#8C7AE6'; // Reset to default
            showRepeatOptions = false;
        } catch (error) {
            console.error('Failed to add event:', error);
            alert('Failed to create event. Please try again.');
        }
    }

    async function deleteEvent(event: CalendarEvent, specificDate?: string) {
        if (!event.repeat || event.repeat === 'none') {
            // Non-repeating event
            if (confirm(`Are you sure you want to delete "${event.title}"?`)) {
                await db.deleteCalendarEvent(event.id);
                calendarEvents = calendarEvents.filter((e) => e.id !== event.id);
            }
        } else {
            // Repeating event - give options
            const choice = await showDeleteRecurringDialog(event.title);
            
            if (choice === 'this') {
                // Delete only this instance
                if (specificDate) {
                    const updatedEvent = { 
                        ...event, 
                        exceptions: [...(event.exceptions || []), specificDate] 
                    };
                    await db.putCalendarEvent(updatedEvent);
                    const index = calendarEvents.findIndex((e) => e.id === event.id);
                    if (index !== -1) {
                        calendarEvents[index] = updatedEvent;
                        calendarEvents = [...calendarEvents];
                    }
                }
            } else if (choice === 'all') {
                // Delete all instances
                await db.deleteCalendarEvent(event.id);
                calendarEvents = calendarEvents.filter((e) => e.id !== event.id);
            }
            // If 'cancel', do nothing
        }
    }

    function showDeleteRecurringDialog(title: string): Promise<'this' | 'all' | 'cancel'> {
        return new Promise((resolve) => {
            const message = `"${title}" is a repeating event.\n\nDelete only this occurrence or all future occurrences?`;
            
            // Create custom dialog
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
            
            content.innerHTML = `
                <div style="color: var(--text); margin-bottom: 20px; line-height: 1.5; white-space: pre-wrap;">${message}</div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="delete-this" style="padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-bg); color: var(--text); cursor: pointer;">Delete This Event</button>
                    <button id="delete-all" style="padding: 8px 16px; border-radius: 8px; border: 1px solid var(--accent-red); background: rgba(255, 71, 87, 0.1); color: #ff6b81; cursor: pointer;">Delete All Events</button>
                    <button id="cancel" style="padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-bg); color: var(--text); cursor: pointer;">Cancel</button>
                </div>
            `;
            
            dialog.appendChild(content);
            document.body.appendChild(dialog);
            
            const cleanup = () => document.body.removeChild(dialog);
            
            content.querySelector('#delete-this')?.addEventListener('click', () => {
                cleanup();
                resolve('this');
            });
            
            content.querySelector('#delete-all')?.addEventListener('click', () => {
                cleanup();
                resolve('all');
            });
            
            content.querySelector('#cancel')?.addEventListener('click', () => {
                cleanup();
                resolve('cancel');
            });
            
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    cleanup();
                    resolve('cancel');
                }
            });
        });
    }

    let kanban: Column[] = [];
    let editingColumnId: string | null = null;
    let editingTaskId: string | null = null;
    let draggedTaskInfo: { colId: string; taskId: string } | null = null;
    let kanbanDropTarget: { colId: string; taskIndex: number } | null = null;
    let isDraggingTask = false;
    const debouncedPersistKanban = debounce(async () => {
        if (!activeWorkspaceId || !kanban) return;
        await db.putKanban({
            workspaceId: activeWorkspaceId,
            columns: kanban
        });
    }, 400);
    $: if (browser && kanban.length >= 0) {
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

    function deleteColumn(colId: string) {
        const col = kanban.find((c) => c.id === colId);
        if (!col) return;
        
        const taskCount = col.tasks.length;
        const taskWarning = taskCount > 0 
            ? ` This will also permanently delete ${taskCount} task${taskCount === 1 ? '' : 's'} in this column.`
            : '';
        
        if (!confirm(`Are you sure you want to delete the column "${col.title}"?${taskWarning} This action cannot be undone.`)) {
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

    function deleteTask(col: Column, taskId: string) {
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

    async function loadActiveWorkspaceData() {
        if (!browser || !activeWorkspaceId) return;

        currentFolderId = null;
        const [loadedFolders, loadedNotes, selectedNoteSetting, events, kData] = await Promise.all([
            db.getFoldersByWorkspaceId(activeWorkspaceId),
            db.getNotesByWorkspaceId(activeWorkspaceId),
            db.getSettingByKey(`selectedNoteId:${activeWorkspaceId}`),
            db.getCalendarEventsByWorkspaceId(activeWorkspaceId),
            db.getKanbanByWorkspaceId(activeWorkspaceId)
        ]);
        folders = loadedFolders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        notes = loadedNotes;
        const initialSelectedId =
            loadedNotes.find((n) => n.id === selectedNoteSetting?.value)?.id ??
            loadedNotes.find((n) => n.folderId === null)?.id ??
            '';
        selectedNoteId = initialSelectedId;

        // Load content for initially selected note
        if (initialSelectedId) {
            const note = loadedNotes.find((n) => n.id === initialSelectedId);
            if (note && note.contentHTML === '') {
                try {
                    note.contentHTML = await db.getNoteContent(initialSelectedId);
                    const noteWithMeta = note as any;
                    noteWithMeta._contentLoaded = true;
                    // Trigger reactivity update
                    notes = [...notes];
                } catch (e) {
                    console.error('Failed to load initial note content:', e);
                }
            }
        }

        calendarEvents = events;
        kanban = kData ? kData.columns : [];
    }

    onMount(() => {
        let timer: ReturnType<typeof setInterval> | undefined;

        (async () => {
            DOMPurify = (await import('dompurify')).default;
            isTauri = '__TAURI__' in window;

            await db.init();

            let loadedWorkspaces = await db.getAllWorkspaces();
            if (loadedWorkspaces.length > 0) {
                workspaces = loadedWorkspaces.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            } else {
                const defaultWorkspace: Workspace = {
                    id: generateUUID(),
                    name: 'My Workspace',
                    order: 0
                };
                await db.putWorkspace(defaultWorkspace);
                workspaces = [defaultWorkspace];
            }

            const lastActive = await db.getSettingByKey('activeWorkspaceId');
            activeWorkspaceId =
                workspaces.find((w) => w.id === lastActive?.value)?.id ?? workspaces[0].id;

            await loadActiveWorkspaceData();

            const updateDateTimeDisplay = () => {
                today = new Date();
                todayDateString = `${DAY_NAMES_LONG[today.getDay()]}, ${dmy(today)}`;
                todayTimeString = today.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });
            };

            updateDateTimeDisplay();
            weekStart = startOfWeek(today, 1);
            newEventDate = ymd(today);

            timer = setInterval(updateDateTimeDisplay, 60 * 1000);

            document.addEventListener('selectionchange', updateSelectedFontSize);
        })();

        return () => {
            document.removeEventListener('selectionchange', updateSelectedFontSize);
            if (timer) clearInterval(timer);
            // Clean up any remaining event listeners
            cleanupResizeListeners();
            // Flush any pending updates
            debouncedUpdateNote.flush();
        };
    });
</script>

<div class="app">
    <div class="nav">
        <div class="brand">NEURONOTES</div>

        <div class="workspace-tabs">
            {#each workspaces as ws, i (ws.id)}
                <div
                    class="workspace-tab"
                    class:active={ws.id === activeWorkspaceId}
                    class:drag-over={draggedWorkspaceId && draggedWorkspaceId !== ws.id}
                    draggable="true"
                    on:dragstart={(e) => handleWorkspaceDragStart(e, ws.id)}
                    on:dragover|preventDefault
                    on:drop={(e) => handleWorkspaceDrop(e, i)}
                    on:dragend={handleWorkspaceDragEnd}
                    on:click={() => switchWorkspace(ws.id)}
                >
                    {#if editingWorkspaceId === ws.id}
                        <input
                            value={ws.name}
                            use:focus
                            on:blur={(e) =>
                                renameWorkspace(ws.id, (e.target as HTMLInputElement).value)}
                            on:keydown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') editingWorkspaceId = null;
                            }}
                        />
                    {:else}
                        <div
                            class="workspace-name"
                            on:dblclick={() => (editingWorkspaceId = ws.id)}
                            title="Double-click to rename"
                        >
                            {ws.name}
                        </div>
                    {/if}
                    <button
                        class="delete-ws-btn"
                        title="Delete Workspace"
                        on:click|stopPropagation={() => deleteWorkspace(ws.id)}
                    >
                        ×
                    </button>
                </div>
            {/each}
            <button class="add-workspace-btn" on:click={addWorkspace} title="New Workspace">
                +
            </button>
        </div>

        <div class="spacer"></div>
        
        <div class="settings-container">
            <button 
                class="settings-btn"
                class:active={showSettingsDropdown}
                on:click={() => showSettingsDropdown = !showSettingsDropdown}
                title="Settings"
            >
                ⚙️
            </button>
            {#if showSettingsDropdown}
                <div class="settings-dropdown" use:settingsDropdown>
                    <button class="settings-item" on:click={() => { showSettingsDropdown = false; exportIndexedDBData(); }}>
                        Export Data
                    </button>
                    <button class="settings-item" on:click={() => { showSettingsDropdown = false; importFileInput?.click(); }}>
                        Import Data
                    </button>
                    <button class="settings-item" on:click={() => { showSettingsDropdown = false; /* TODO: Edit Panels */ }}>
                        Edit Panels
                    </button>
                </div>
            {/if}
            <input
                type="file"
                accept=".json"
                bind:this={importFileInput}
                style="display: none;"
                on:change={handleImportFile}
            />
        </div>
    </div>

    <div
        class="main"
        class:notes-maximized={notesPanelWidth > 90}
        style="--notes-width: {notesPanelWidth}%; --calendar-height: {calendarPanelHeight}%"
    >
        <section
            class="panel notes-panel"
            class:minimized={isNotesMinimized}
            bind:clientWidth={notesPanelClientWidth}
        >
            <div class="panel-header">
                {#if !isNotesMinimized}
                    {#if currentFolder}
                        <button class="small-btn" on:click={goBack} title="Go back">&larr;</button>
                        <div
                            class="panel-title"
                            on:dblclick={() => (isEditingHeaderName = true)}
                            title="Double-click to rename"
                        >
                            {#if isEditingHeaderName}
                                <input
                                    value={currentFolder.name}
                                    use:focus
                                    on:blur={(e) =>
                                        renameFolder(
                                            currentFolder.id,
                                            (e.target as HTMLInputElement).value
                                        )}
                                    on:keydown={(e) => {
                                        if (e.key === 'Enter')
                                            (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') isEditingHeaderName = false;
                                    }}
                                />
                            {:else}
                                / {currentFolder.name}
                            {/if}
                        </div>
                    {:else}
                        <div class="panel-title">Notes</div>
                    {/if}
                {:else}
                    <div class="panel-title">Notes</div>
                {/if}

                <div class="spacer"></div>

                {#if !isNotesMinimized}
                    <div class="notes-actions">
                        {#if currentFolder}
                            <button
                                class="small-btn danger"
                                on:click={() => deleteFolder(currentFolder.id)}
                            >
                                Delete Folder
                            </button>
                        {/if}
                        <button class="small-btn" on:click={addFolder}>+ Folder</button>
                        <button class="small-btn" on:click={() => addNote('spreadsheet')}>
                            + Sheet
                        </button>
                        <button class="small-btn" on:click={() => addNote('text')}>+ Note</button>
                    </div>
                {/if}

                <button
                    class="small-btn panel-minimize-btn"
                    on:click={toggleNotesMinimized}
                    title={isNotesMinimized ? 'Expand' : 'Collapse'}
                >
                    {isNotesMinimized ? '⤢' : '⤡'}
                </button>
            </div>

            {#if !isNotesMinimized && currentNote}
                <div class="panel-header toolbar-container">
                    <button
                        class="toolbar-btn toggle-notelist-btn"
                        on:click={toggleNoteList}
                        title={isNoteListVisible ? 'Hide Note List' : 'Show Note List'}
                    >
                        {isNoteListVisible ? '«' : '»'}
                    </button>
                    {#if currentNote.type !== 'spreadsheet'}
                        <div class="format-toolbar">
                            <div class="font-size-controls" title="Change font size">
                                <button
                                    class="toolbar-btn"
                                    on:click={() => modifyFontSize(-2)}
                                    on:mousedown={(e) => e.preventDefault()}>▼</button
                                >
                                <div class="font-size-display">
                                    {selectedFontSize}px
                                </div>
                                <button
                                    class="toolbar-btn"
                                    on:click={() => modifyFontSize(2)}
                                    on:mousedown={(e) => e.preventDefault()}>▲</button
                                >
                            </div>
                            <button
                                class="toolbar-btn"
                                on:click={() => applyFormatCommand('bold')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Bold"
                                style="font-weight: bold;">B</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() => applyFormatCommand('italic')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Italic"
                                style="font-style: italic;">I</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() => applyFormatCommand('insertUnorderedList')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Dotted list">●</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={insertCheckbox}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Insert checkbox">☑</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() => applyFormatCommand('justifyLeft')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Align left">◧</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() => applyFormatCommand('justifyCenter')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Align center">◫</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() => applyFormatCommand('justifyRight')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Align right">◨</button
                            >
                        </div>
                    {:else}
                        <div class="format-toolbar">
                            <button
                                class="toolbar-btn"
                                on:click={() =>
                                    spreadsheetComponentInstance.applyStyle('fontWeight', 'bold')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Bold"
                                style="font-weight: bold;">B</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() =>
                                    spreadsheetComponentInstance.applyStyle('fontStyle', 'italic')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Italic"
                                style="font-style: italic;">I</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() =>
                                    spreadsheetComponentInstance.applyStyle('textAlign', 'left')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Align left">◧</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() =>
                                    spreadsheetComponentInstance.applyStyle('textAlign', 'center')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Align center">◫</button
                            >
                            <button
                                class="toolbar-btn"
                                on:click={() =>
                                    spreadsheetComponentInstance.applyStyle('textAlign', 'right')}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Align right">◨</button
                            >
                            <button
                                class="toolbar-btn"
                                disabled={!canMergeOrUnmerge}
                                on:click={() => spreadsheetComponentInstance.toggleMerge()}
                                on:mousedown={(e) => e.preventDefault()}
                                title="Merge/Unmerge Cells">⧉</button
                            >
                        </div>
                    {/if}
                </div>
            {/if}

            {#if !isNotesMinimized}
                <div
                    class="notes"
                    style="grid-template-columns: {isNoteListVisible ? '180px' : '0'} 1fr;"
                >
                    <aside
                        class="note-list"
                        on:dragleave={() => {
                            dropIndex = null;
                        }}
                    >
                        {#if currentFolder}
                            <div
                                class="back-to-root-item"
                                class:drag-over={dragOverRoot}
                                on:dragover={(e) => {
                                    e.preventDefault();
                                    dragOverRoot = true;
                                }}
                                on:dragleave={() => (dragOverRoot = false)}
                                on:drop|preventDefault={handleDropOnRoot}
                            >
                                ...
                            </div>
                        {/if}

                        {#each displayList as item, i (item.id)}
                            {#if item.displayType === 'folder'}
                                <button
                                    class="folder-item"
                                    class:drag-over={dragOverFolderId === item.id}
                                    draggable="true"
                                    on:click={() => {
                                        if (!isDragging && editingFolderId !== item.id) {
                                            openFolder(item.id);
                                        }
                                    }}
                                    on:dragstart={(e) => {
                                        e.stopPropagation();
                                        handleDragStart(e, item);
                                    }}
                                    on:dragover|preventDefault|stopPropagation={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (e.dataTransfer) {
                                            e.dataTransfer.dropEffect = 'move';
                                        }
                                        dropIndex = i;
                                        if (draggedItemType === 'note') {
                                            dragOverFolderId = item.id;
                                        } else {
                                            dragOverFolderId = null;
                                        }
                                    }}
                                    on:dragleave={() => {
                                        dragOverFolderId = null;
                                        dropIndex = null;
                                    }}
                                    on:dragend={() => {
                                        isDragging = false;
                                        draggedItemType = null;
                                        dragOverFolderId = null;
                                        dropIndex = null;
                                    }}
                                    on:drop|preventDefault|stopPropagation={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const data = e.dataTransfer?.getData('application/json');
                                        if (data) {
                                            try {
                                                const parsed = JSON.parse(data);
                                                if (parsed.displayType === 'note') {
                                                    handleDropOnFolder(e, item);
                                                } else {
                                                    handleReorderDrop(e, i);
                                                }
                                            } catch (err) {
                                                // Fallback to reorder if parsing fails
                                                handleReorderDrop(e, i);
                                            }
                                        } else {
                                            // No data, try to reorder anyway
                                            handleReorderDrop(e, i);
                                        }
                                    }}
                                >
                                    {#if dropIndex === i}
                                        <div class="drop-indicator"></div>
                                    {/if}
                                    {#if editingFolderId === item.id}
                                        <input
                                            value={(item as Folder).name}
                                            use:focus
                                            on:blur={(e) =>
                                                renameFolder(
                                                    item.id,
                                                    (e.target as HTMLInputElement).value
                                                )}
                                            on:keydown={(e) => {
                                                if (e.key === 'Enter')
                                                    (e.target as HTMLInputElement).blur();
                                            }}
                                        />
                                    {:else}
                                        <div
                                            class="name"
                                            on:dblclick|stopPropagation={() =>
                                                (editingFolderId = item.id)}
                                        >
                                            📁 {(item as Folder).name}
                                        </div>
                                    {/if}
                                </button>
                            {:else}
                                <div
                                    class="note-item {selectedNoteId === item.id ? 'active' : ''}"
                                    on:click={() => selectNote(item.id)}
                                    draggable="true"
                                    on:dragstart={(e) => {
                                        e.stopPropagation();
                                        handleDragStart(e, item);
                                    }}
                                    on:dragover|preventDefault|stopPropagation={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (e.dataTransfer) {
                                            e.dataTransfer.dropEffect = 'move';
                                        }
                                        dropIndex = i;
                                    }}
                                    on:dragleave={() => {
                                        dropIndex = null;
                                    }}
                                    on:dragend={() => {
                                        isDragging = false;
                                        draggedItemType = null;
                                        dropIndex = null;
                                    }}
                                    on:drop|preventDefault|stopPropagation={(e) =>
                                        handleReorderDrop(e, i)}
                                >
                                    {#if dropIndex === i}
                                        <div class="drop-indicator"></div>
                                    {/if}
                                    {#if editingNoteId === item.id}
                                        <input
                                            value={(item as Note).title}
                                            use:focus
                                            on:blur={(e) =>
                                                renameNote(
                                                    item.id,
                                                    (e.target as HTMLInputElement).value
                                                )}
                                            on:keydown={(e) => {
                                                if (e.key === 'Enter')
                                                    (e.target as HTMLInputElement).blur();
                                            }}
                                        />
                                    {:else}
                                        <div
                                            class="title"
                                            on:dblclick|stopPropagation={() =>
                                                (editingNoteId = item.id)}
                                        >
                                            {(item as Note).title || 'Untitled'}
                                        </div>
                                    {/if}
                                    <button
                                        class="small-btn danger"
                                        on:click|stopPropagation={() => deleteNote(item.id)}
                                        title="Delete note"
                                    >
                                        Delete
                                    </button>
                                </div>
                            {/if}
                        {/each}
                    </aside>

                    <div class="note-editor">
                        {#if currentNote}
                            {#key currentNote.id}
                                {#if parsedCurrentNote && parsedCurrentNote.type === 'spreadsheet' && parsedCurrentNote.spreadsheet}
                                    <div class="spreadsheet-wrapper">
                                        <Spreadsheet
                                            bind:this={spreadsheetComponentInstance}
                                            bind:spreadsheetData={parsedCurrentNote.spreadsheet}
                                            bind:selectedCell={selectedSheetCell}
                                            bind:selection={sheetSelection}
                                            on:update={() => {
                                                triggerNoteUpdate();
                                                if (currentNote) {
                                                    debouncedUpdateNote(currentNote);
                                                }
                                            }}
                                        />
                                    </div>
                                {:else}
                                    <div class="note-content">
                                        <div
                                            class="contenteditable"
                                            contenteditable="true"
                                            bind:this={editorDiv}
                                            bind:innerHTML={currentNote.contentHTML}
                                            on:input={() => debouncedUpdateNote(currentNote)}
                                            on:paste={handlePlainTextPaste}
                                        />
                                    </div>
                                {/if}
                            {/key}
                        {:else}
                            <div style="padding:16px; color: var(--text-muted);">
                                {#if currentFolder}
                                    Select a note from the list or create a new one.
                                {:else if displayList.length === 0}
                                    Create a note or folder to get started.
                                {:else}
                                    Select a note to view its content.
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
        </section>

        <div class="resizer-wrapper vertical" on:mousedown={startVerticalResize} title="Resize">
            <div class="panel-resizer-pill">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        </div>

        <section
            class="right"
            class:calendar-minimized={isCalendarMinimized}
            class:kanban-minimized={isKanbanMinimized}
        >
            <div class="panel calendar-panel" class:minimized={isCalendarMinimized}>
                <div class="panel-header">
                    <div class="panel-title today-header">
                        <span class="date">{todayDateString}</span>
                        <span class="time">{todayTimeString}</span>
                    </div>
                    <div class="spacer"></div>
                    {#if browser && !isCalendarMinimized}
                        <div class="calendar-controls">
                            <button class="small-btn" on:click={prevWeek}>&larr; Prev</button>
                            <button
                                class="small-btn"
                                on:click={() => (weekStart = startOfWeek(today, 1))}
                            >
                                Today
                            </button>
                            <button class="small-btn" on:click={nextWeek}>Next &rarr;</button>
                        </div>
                    {/if}
                    <button
                        class="small-btn panel-minimize-btn"
                        on:click={toggleCalendarMinimized}
                        title={isCalendarMinimized ? 'Expand' : 'Collapse'}
                    >
                        {isCalendarMinimized ? '⤢' : '⤡'}
                    </button>
                </div>

                {#if browser && !isCalendarMinimized}
                    <div class="calendar-grid">
                        {#each weekDays as d (ymd(d))}
                            <div class="calendar-cell" class:today={ymd(d) === ymd(today)}>
                                <div class="date">{dmy(d)}</div>
                                <div class="day-name">{DAY_NAMES[d.getDay()]}</div>
                                {#each eventsByDay[ymd(d)] || [] as ev (ev.id + ymd(d))}
                                    <div 
                                        class="event" 
                                        title={ev.title}
                                        style="background: {ev.color ? hexToRgba(ev.color, 0.2) : 'rgba(140, 122, 230, 0.2)'}; border-color: {ev.color || 'var(--accent-purple)'};"
                                    >
                                        <div class="event-details">
                                            {#if ev.time}
                                                <div 
                                                    class="time"
                                                    style="color: {ev.color || 'var(--accent-purple)'};"
                                                >
                                                    {ev.time}
                                                </div>
                                            {/if}
                                            <div class="title">{ev.title}</div>
                                        </div>
                                        <button
                                            class="delete-event-btn"
                                            on:click={() => deleteEvent(ev, ymd(d))}
                                            title="Delete event"
                                        >
                                            ×
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        {/each}
                    </div>

                    <div class="calendar-add">
                        <input type="date" bind:value={newEventDate} aria-label="Event date" />
                        <input type="time" bind:value={newEventTime} aria-label="Event time" />
                        <input
                            type="text"
                            bind:value={newEventTitle}
                            placeholder="Event title"
                            aria-label="Event title"
                            on:keydown={(e) => {
                                if (e.key === 'Enter' && !showRepeatOptions) addEvent();
                            }}
                        />
                        <input
                            type="color"
                            bind:value={newEventColor}
                            aria-label="Event color"
                            class="color-picker"
                            title="Choose event color"
                        />
                        <button 
                            class="small-btn" 
                            class:active={showRepeatOptions}
                            on:click={() => showRepeatOptions = !showRepeatOptions}
                            title="Repeat options"
                        >
                            🔁
                        </button>
                        <button class="small-btn" on:click={addEvent}>Add</button>
                    </div>

                    {#if showRepeatOptions}
                        <div class="repeat-options">
                            <div class="repeat-option-row">
                                <label>
                                    <input type="radio" bind:group={newEventRepeat} value="none" />
                                    No repeat
                                </label>
                                <label>
                                    <input type="radio" bind:group={newEventRepeat} value="daily" />
                                    Daily
                                </label>
                                <label>
                                    <input type="radio" bind:group={newEventRepeat} value="weekly" />
                                    Weekly
                                </label>
                                <label>
                                    <input type="radio" bind:group={newEventRepeat} value="monthly" />
                                    Monthly
                                </label>
                                <label>
                                    <input type="radio" bind:group={newEventRepeat} value="yearly" />
                                    Yearly
                                </label>
                                <label>
                                    <input type="radio" bind:group={newEventRepeat} value="custom" />
                                    Custom days
                                </label>
                            </div>
                            {#if newEventRepeat === 'custom'}
                                <div class="custom-days">
                                    {#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as day, i}
                                        <label class="day-checkbox">
                                            <input type="checkbox" bind:checked={newEventCustomDays[i]} />
                                            {day}
                                        </label>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/if}
                {:else if !isCalendarMinimized}
                    <div style="padding:16px; color: var(--text-muted);">Loading…</div>
                {/if}
            </div>

            <div
                class="resizer-wrapper horizontal"
                on:mousedown={startHorizontalResize}
                title="Resize"
            >
                <div class="panel-resizer-pill">
                    <div class="dot"></div>
                    <div class="dot"></div>
                    <div class="dot"></div>
                </div>
            </div>

            <div class="panel kanban-panel" class:minimized={isKanbanMinimized}>
                <div class="panel-header">
                    <div class="panel-title">Kanban</div>
                    <div class="spacer" />
                    <div class="kanban-header-actions">
                        {#if !isKanbanMinimized}
                            <button class="small-btn" on:click={addColumn}>+ Column</button>
                        {/if}
                        <button
                            class="small-btn panel-minimize-btn"
                            on:click={toggleKanbanMinimized}
                            title={isKanbanMinimized ? 'Expand' : 'Collapse'}
                        >
                            {isKanbanMinimized ? '⤢' : '⤡'}
                        </button>
                    </div>
                </div>

                {#if !isKanbanMinimized}
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
                                        class="small-btn"
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
        </section>
    </div>
</div>

<style>
    :root {
        --bg: #1a1a1a;
        --panel-bg: #212121;
        --panel-bg-darker: #1e1e1e;
        --text: #e0e0e0;
        --text-muted: #888;
        --border: #333;
        --accent-red: #ff4757;
        --accent-purple: #8c7ae6;
        --font-sans:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif,
            'Apple Color Emoji', 'Segoe UI Emoji';
    }

    :global(html) {
        scroll-behavior: smooth;
    }

    :global(html, body) {
        margin: 0;
        padding: 0;
        height: 100%;
        background: var(--bg);
        color: var(--text);
        font-family: var(--font-sans);
    }

    * {
        box-sizing: border-box;
    }

    .app {
        background: radial-gradient(circle at 10% 20%, rgba(255, 71, 87, 0.1), transparent 40%);
        height: 100vh;
        display: flex;
        flex-direction: column;
    }

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
    }
    .nav .brand {
        font-weight: 700;
    }
    .nav .spacer {
        flex: 1;
        min-width: 24px;
    }
    .nav-right-placeholder {
        width: 100px;
        flex-shrink: 0;
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
    .settings-btn:hover {
        border-color: var(--accent-red);
        background: var(--panel-bg-darker);
    }
    .settings-btn.active {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
    }
    .settings-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 4px;
        min-width: 180px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 1000;
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

    /* Workspace Tabs Styles */
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
    }
    .workspace-tab.drag-over {
        outline: 2px solid var(--accent-red);
        outline-offset: 2px;
    }
    .main {
        flex: 1;
        overflow: hidden;
        display: grid;
        grid-template-columns: calc(var(--notes-width) - 12px) 24px 1fr;
        gap: 0;
        padding: 24px;
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
        transition: all 0.2s ease-in-out;
    }

    .panel-header {
        padding: 12px 16px;
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
    .panel.calendar-panel {
        overflow: visible !important;
    }
    .notes-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        flex-shrink: 0;
        max-width: 100%;
    }
    .notes-actions::-webkit-scrollbar {
        display: none;
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
    }
    .kanban-header-actions::-webkit-scrollbar {
        display: none;
    }

    .panel-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }
    .panel-title input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--text);
        font-family: var(--font-sans);
        font-size: 1rem;
        font-weight: 600;
        padding: 0;
    }

    .notes {
        display: grid;
        grid-template-columns: 180px 1fr;
        height: 100%;
        transition: grid-template-columns 0.2s ease-in-out;
    }

    .note-list {
        border-right: 1px solid var(--border);
        overflow: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    .note-list::-webkit-scrollbar {
        display: none;
    }
    .note-item,
    .folder-item {
        padding: 12px 10px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: background-color 0.2s;
        position: relative;
    }
    .folder-item {
        background-color: rgba(140, 122, 230, 0.1);
        font-weight: 500;
        width: 100%;
        border: none;
        text-align: left;
        font-family: inherit;
        justify-content: flex-start;
        color: var(--text);
    }
    .folder-item.drag-over {
        background-color: rgba(140, 122, 230, 0.3);
        outline: 2px solid var(--accent-purple);
    }
    .note-item.active {
        background: rgba(255, 71, 87, 0.15);
    }
    .note-item .title,
    .folder-item .title,
    .folder-item .name {
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
    }
    .folder-item input,
    .note-item input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--text);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 500;
        width: 100%;
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
    .note-editor {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
    }
    .note-content {
        padding: 16px;
        flex: 1;
        overflow: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    .contenteditable {
        min-height: 100%;
        outline: none;
        border-radius: 8px;
        padding: 12px;
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        transition: border-color 0.2s;
        overflow-wrap: break-word;
    }
    .contenteditable:focus {
        border-color: var(--accent-red);
    }
    
    /* Checkbox styling in notes */
    :global(.note-checkbox) {
        margin-right: 6px;
        vertical-align: middle;
        cursor: pointer;
        accent-color: rgba(255, 71, 87, 0.6);
        width: 14px;
        height: 14px;
        opacity: 0.8;
    }

    .spreadsheet-wrapper {
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .right {
        display: grid;
        grid-template-rows: calc(var(--calendar-height) - 12px) 24px 1fr;
        gap: 0;
        height: 100%;
        min-height: 0;
    }
    .right.calendar-minimized {
        grid-template-rows: min-content 24px 1fr;
    }
    .right.kanban-minimized {
        grid-template-rows: 1fr 24px min-content;
    }
    .right.calendar-minimized.kanban-minimized {
        grid-template-rows: 1fr 24px 1fr;
    }

    .main.notes-maximized .right {
        grid-template-rows: 1fr 24px 1fr;
    }
    .main.notes-maximized .right.calendar-minimized {
        grid-template-rows: min-content 24px 1fr;
    }
    .main.notes-maximized .right.kanban-minimized {
        grid-template-rows: 1fr 24px min-content;
    }
    .main.notes-maximized .right.calendar-minimized.kanban-minimized {
        grid-template-rows: 1fr 24px 1fr;
    }

    /* Calendar */
    .calendar-panel {
        overflow: visible;
    }
    .calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        border-top: 1px solid var(--border);
        border-left: 1px solid var(--border);
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }
    .calendar-cell {
        border-right: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
        padding: 8px 2px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        transition: background-color 0.2s;
        overflow: hidden;
    }
    .calendar-cell.today {
        background-color: rgba(255, 71, 87, 0.1);
    }
    .calendar-cell .date {
        font-size: 12px;
        color: var(--text-muted);
        margin-left: 2px;
        margin-top: -4px;
    }
    .calendar-cell .day-name {
        font-size: 10px;
        color: var(--text-muted);
        margin-top: -4px;
        margin-left: 4px;
    }
    .calendar-cell.today .date {
        color: var(--accent-red);
        font-weight: 600;
    }
    .today-header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
    }

    .today-header .date {
        font-weight: 600;
        color: var(--text);
    }

    .today-header .time {
        font-size: 0.9em;
        color: var(--accent-red);
        font-weight: 600;
    }
    .event {
        background: rgba(140, 122, 230, 0.2);
        border: 1px solid var(--accent-purple);
        border-radius: 5px;
        padding: 4px 4px 2px 6px;
        display: flex;
        justify-content: space-between;
        gap: 2px;
        align-items: flex-start;
        font-size: 11px;
        line-height: 1.3;
        overflow: hidden;
        width: 100%;
    }
    .event-details {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .event .time {
        color: var(--accent-purple);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
    }
    .color-picker {
        width: 40px;
        height: 32px;
        padding: 2px;
        border: 1px solid var(--border);
        border-radius: 8px;
        cursor: pointer;
        background: var(--panel-bg-darker);
    }
    .color-picker::-webkit-color-swatch-wrapper {
        padding: 0;
    }
    .color-picker::-webkit-color-swatch {
        border: none;
        border-radius: 6px;
    }
    .delete-event-btn {
        display: flex;
        background: rgba(0, 0, 0, 0.2);
        border: none;
        color: var(--text-muted);
        width: 12px;
        height: 12px;
        border-radius: 3px;
        cursor: pointer;
        flex-shrink: 0;
        transition: all 0.2s;
        align-items: center;
        justify-content: center;
        line-height: 1;
    }
    .delete-event-btn:hover {
        background: var(--accent-red);
        color: white;
    }
    .calendar-controls {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        max-width: 100%;
    }
    .calendar-controls::-webkit-scrollbar {
        display: none;
    }
    .calendar-add {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--border);
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        align-items: center;
    }
    .calendar-add::-webkit-scrollbar {
        display: none;
    }
    .calendar-add input {
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 6px 8px;
        color: var(--text);
        flex-shrink: 0;
        min-width: 120px;
        font-size: 12px;
        font-family: var(--font-sans);
        height: 32px;
    }
    .calendar-add input::-webkit-calendar-picker-indicator {
        filter: invert(0.8);
        cursor: pointer;
        opacity: 0.8;
        transition: opacity 0.2s;
    }
    .calendar-add input::-webkit-calendar-picker-indicator:hover {
        opacity: 1;
    }

    .repeat-options {
        padding: 12px 16px;
        border-top: 1px solid var(--border);
        background: var(--panel-bg-darker);
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .repeat-option-row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
    }
    .repeat-option-row label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        cursor: pointer;
        color: var(--text);
    }
    .repeat-option-row input[type="radio"] {
        cursor: pointer;
        accent-color: var(--accent-red);
    }
    .custom-days {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding-top: 4px;
    }
    .day-checkbox {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .day-checkbox:hover {
        border-color: var(--accent-red);
    }
    .day-checkbox input[type="checkbox"] {
        cursor: pointer;
        accent-color: var(--accent-red);
        width: 14px;
        height: 14px;
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
    }
    .small-btn:hover {
        border-color: var(--accent-red);
    }
    .small-btn.active {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
    }
    .danger:hover {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
        color: #ff6b81;
    }

    /* Kanban */
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
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
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

    .kanban-task-ghost {
        position: fixed;
        pointer-events: none;
        z-index: 9999;
        background: var(--panel-bg);
        border: 1px solid var(--accent-red);
        border-radius: 10px;
        padding: 6px;
        width: 218px;
        transform: translate(-50%, -50%);
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
        opacity: 0.95;
        overflow-wrap: break-word;
        font-size: 14px;
        transition: none;
        will-change: transform;
    }

    /* --- Move to root --- */
    .back-to-root-item {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
        color: var(--text-muted);
        font-style: italic;
        font-size: 14px;
        text-align: center;
        background-color: var(--panel-bg-darker);
        border: 2px dashed var(--border);
        margin: 4px;
        border-radius: 8px;
        transition: all 0.2s;
    }
    .back-to-root-item.drag-over {
        border-color: var(--accent-red);
        color: var(--accent-red);
        background-color: rgba(255, 71, 87, 0.1);
    }

    /* ----- Toolbar Styles ----- */
    .toolbar-container {
        justify-content: center;
        padding-top: 0;
        padding-bottom: 0;
        position: relative;
    }
    .format-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        justify-content: center;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding-left: 40px;
        padding-right: 40px;
    }
    .format-toolbar::-webkit-scrollbar {
        display: none;
    }
    .toolbar-btn {
        background: none;
        border: 1px solid transparent;
        color: var(--text-muted);
        width: 28px;
        height: 28px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.2s;
        font-family: var(--font-sans);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .toolbar-btn:hover {
        background-color: var(--panel-bg-darker);
        color: var(--text);
    }
    .toolbar-btn:disabled {
        color: #555;
        cursor: not-allowed;
        background-color: transparent;
    }
    .toggle-notelist-btn {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
    }
    .toggle-notelist-btn:hover {
        background-color: var(--panel-bg-darker);
    }
    .font-size-controls {
        display: flex;
        align-items: center;
        gap: 4px;
        background-color: var(--panel-bg-darker);
        border-radius: 6px;
        padding: 0 4px;
    }
    .font-size-controls .toolbar-btn {
        width: 20px;
        font-size: 12px;
    }
    .font-size-display {
        font-size: 12px;
        color: var(--text-muted);
        min-width: 40px;
        text-align: center;
        font-variant-numeric: tabular-nums;
    }

    /* ----- Responsive Styles ----- */
    @media (max-width: 1200px) {
        .main {
            grid-template-columns: 1fr;
            grid-template-rows: 50vh 24px 1fr;
            overflow-y: auto;
            overflow-x: hidden;
            scroll-behavior: smooth;
        }
        .panel {
            min-height: 400px;
        }
        .right {
            grid-template-rows: 1fr 24px 1fr;
        }
    }

    @media (max-width: 768px) {
        .main {
            padding: 12px;
            gap: 12px;
            grid-template-rows: 50vh 24px 50vh;
        }
        .nav {
            padding: 0 12px;
            gap: 12px;
        }
        .nav .spacer {
            display: none;
        }
        .nav-right-placeholder {
            display: none;
        }
        .settings-container {
            position: static;
        }
        .settings-dropdown {
            right: auto;
            left: 50%;
            transform: translateX(-50%);
        }
        .notes {
            grid-template-columns: 1fr;
            grid-template-rows: auto minmax(0, 1fr);
        }
        .note-list {
            border-right: none;
            border-bottom: 1px solid var(--border);
            max-height: 150px;
        }
        .right {
            grid-template-rows: 1fr 24px 1fr;
            grid-template-columns: 1fr;
        }
        .calendar-grid {
            grid-template-columns: 1fr;
            border-top: none;
            border-left: none;
            overflow: visible;
        }
        .calendar-cell {
            border-left: 1px solid var(--border);
        }
        .calendar-add {
            flex-wrap: nowrap;
            overflow-x: auto;
        }
        .calendar-add input[type='text'] {
            flex-basis: auto;
            min-width: 120px;
        }
        .panel-header {
            padding: 8px 12px;
        }
        .panel-title {
            font-size: 14px;
        }
        .small-btn {
            padding: 4px 8px;
            font-size: 11px;
        }
    }

    /* ----- Panel Resizing & Minimizing ----- */
    .resizer-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
    }
    .resizer-wrapper.vertical {
        cursor: col-resize;
    }
    .resizer-wrapper.horizontal {
        cursor: row-resize;
    }
    .panel-resizer-pill {
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-evenly;
        transition: background-color 0.2s;
        border-radius: 8px;
    }
    .resizer-wrapper:hover .panel-resizer-pill {
        background: var(--accent-red);
    }
    .panel-resizer-pill .dot {
        width: 3px;
        height: 3px;
        background-color: var(--text-muted);
        border-radius: 50%;
    }
    .resizer-wrapper.vertical .panel-resizer-pill {
        width: 16px;
        height: 32px;
        flex-direction: column;
    }
    .resizer-wrapper.horizontal .panel-resizer-pill {
        width: 32px;
        height: 16px;
        flex-direction: row;
    }

    .panel.minimized {
        justify-content: center;
    }
    .panel.minimized > *:not(.panel-header) {
        display: none !important;
    }
    .notes-panel.minimized .panel-header {
        border-bottom: none;
        justify-content: center;
        flex-direction: column;
        gap: 4px;
    }
    .panel.minimized .panel-header .spacer {
        display: none;
    }
    .calendar-panel.minimized,
    .kanban-panel.minimized {
        min-height: 0;
    }
    .calendar-panel.minimized .panel-header,
    .kanban-panel.minimized .panel-header {
        border-bottom: none;
        justify-content: center;
    }
    .kanban-panel.minimized .panel-header .spacer {
        display: none;
    }
</style>