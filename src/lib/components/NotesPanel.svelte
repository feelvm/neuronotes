<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { browser } from '$app/environment';
    import * as db from '$lib/db';
    import { generateUUID } from '$lib/utils/uuid';
    import { debounce } from '$lib/utils/debounce';
    import { 
        applyFormat, 
        modifyFontSize as modifyFontSizeUtil, 
        getSelectedFontSize,
        handlePlainTextPaste
    } from '$lib/utils/textFormatting';
    import type { Note, Folder, SpreadsheetCell } from '$lib/db_types';

    // Props
    export let isMinimized: boolean;
    export let activeWorkspaceId: string | null;
    export let onToggleMinimized: () => void;
    export let onSyncIfLoggedIn: () => Promise<void>;
    export let onLoadActiveWorkspaceData: () => Promise<void>;
    export let notesPanelClientWidth: number = 0; // For binding

    // SVG Icon
    const FolderIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 3C1.45 3 1 3.45 1 4V13C1 13.55 1.45 14 2 14H14C14.55 14 15 13.55 15 13V5C15 4.45 14.55 4 14 4H8L6.5 2.5C6.22 2.22 5.78 2 5.5 2H2ZM2 3H5.5L7 4.5C7.28 4.78 7.72 5 8 5H14V13H2V4V3Z" fill="currentColor"/>
    </svg>`;

    let DOMPurify: any;

    // State
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
    let isNoteListVisible = true;
    let isMobileView = false;
    let editorDiv: HTMLElement;
    let previousNoteId: string | null = null;
    let selectedFontSize = 14;
    let isBold = false;
    let isItalic = false;
    let SpreadsheetComponent: any = null;
    let spreadsheetComponentInstance: any;
    let isSpreadsheetLoaded = false;
    let selectedSheetCell: { row: number; col: number } | null = null;
    let sheetSelection: {
        start: { row: number; col: number };
        end: { row: number; col: number };
    } | null = null;

    type DisplayItem = (Note & { displayType: 'note' }) | (Folder & { displayType: 'folder' });
    let displayList: DisplayItem[] = [];

    // Note history
    type NoteHistoryEntry = {
        content: string;
        timestamp: number;
    };
    const noteHistory: Map<string, NoteHistoryEntry[]> = new Map();
    const noteHistoryIndex: Map<string, number> = new Map();
    const MAX_NOTE_HISTORY = 50;

    // Compute displayList reactively
    $: {
        let items: DisplayItem[];
        if (currentFolderId === null) {
            const rootNotes = notes
                .filter((n) => n.folderId === null && n.workspaceId === activeWorkspaceId)
                .map((n) => ({ ...n, displayType: 'note' as const }));
            const allFolders = folders
                .filter((f) => f.workspaceId === activeWorkspaceId)
                .map((f) => ({
                    ...f,
                    displayType: 'folder' as const
                }));
            items = [...allFolders, ...rootNotes];
        } else {
            items = notes
                .filter((n) => n.folderId === currentFolderId && n.workspaceId === activeWorkspaceId)
                .map((n) => ({ ...n, displayType: 'note' as const }));
        }
        displayList = items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    $: currentFolder = folders.find((f) => f.id === currentFolderId);
    $: currentNote = notes.find((n) => n.id === selectedNoteId) ?? null;
    
    // Sanitized content for contenteditable to prevent XSS
    $: sanitizedNoteContent = currentNote && currentNote.type === 'text' && browser && DOMPurify
        ? DOMPurify.sanitize(currentNote.contentHTML || '')
        : (currentNote?.contentHTML || '');
    
    // Update editor content only when note changes (not during typing)
    $: if (editorDiv && selectedNoteId && (selectedNoteId !== previousNoteId || (editorDiv.innerHTML === '' && !isMinimized))) {
        const note = notes.find((n) => n.id === selectedNoteId);
        if (note && note.type === 'text') {
            const noteWithMeta = note as any;
            if ((!note.contentHTML || note.contentHTML === '') && !noteWithMeta._contentLoaded) {
                const noteId = note.id;
                db.getNoteContent(noteId).then(rawContent => {
                    if (rawContent && editorDiv && selectedNoteId === noteId) {
                        const sanitized = (browser && DOMPurify) 
                            ? DOMPurify.sanitize(rawContent)
                            : rawContent;
                        const noteIndex = notes.findIndex((n) => n.id === noteId);
                        if (noteIndex !== -1) {
                            notes[noteIndex] = { ...notes[noteIndex], contentHTML: sanitized };
                            const updatedNoteWithMeta = notes[noteIndex] as any;
                            updatedNoteWithMeta._contentLoaded = true;
                            notes = [...notes];
                        }
                        if (editorDiv && (editorDiv.innerHTML === '' || editorDiv.innerHTML !== sanitized)) {
                            editorDiv.innerHTML = sanitized;
                        }
                        // Update formatting state after content is loaded
                        tick().then(() => updateFormattingState());
                    }
                }).catch(e => {
                    console.error('Failed to load note content:', e);
                });
            } else if (note.contentHTML) {
                const sanitized = browser && DOMPurify
                    ? DOMPurify.sanitize(note.contentHTML)
                    : note.contentHTML;
                
                if (editorDiv.innerHTML === '' && sanitized) {
                    editorDiv.innerHTML = sanitized;
                } else if (editorDiv.innerHTML !== sanitized && sanitized && previousNoteId !== selectedNoteId) {
                    editorDiv.innerHTML = sanitized;
                }
                // Update formatting state after content is set
                tick().then(() => updateFormattingState());
            }
        }
        previousNoteId = selectedNoteId;
    } else if (!selectedNoteId) {
        previousNoteId = null;
    }
    
    // Parse current note's spreadsheet JSON
    $: parsedCurrentNote = currentNote ? (() => {
        if (currentNote.type === 'spreadsheet') {
            const noteWithRaw = currentNote as any;
            if (typeof noteWithRaw._spreadsheetJson === 'string' && !currentNote.spreadsheet) {
                try {
                    const parsed = JSON.parse(noteWithRaw._spreadsheetJson);
                    noteWithRaw.spreadsheet = parsed;
                    noteWithRaw._spreadsheetJson = parsed;
                    return { ...currentNote, spreadsheet: parsed };
                } catch (e) {
                    console.error('Failed to parse spreadsheet JSON:', e);
                    return currentNote;
                }
            }
        }
        return currentNote;
    })() : null;

    // Compute canMergeOrUnmerge as a function to avoid reactive cycle
    function getCanMergeOrUnmerge(): boolean {
        if (!sheetSelection || !selectedNoteId) return false;
        
        const note = notes.find((n) => n.id === selectedNoteId);
        if (!note || note.type !== 'spreadsheet') return false;
        
        let spreadsheet = note.spreadsheet;
        if (!spreadsheet) {
            const noteWithRaw = note as any;
            if (noteWithRaw._spreadsheetJson) {
                try {
                    spreadsheet = JSON.parse(noteWithRaw._spreadsheetJson);
                } catch (e) {
                    return false;
                }
            } else {
                return false;
            }
        }
        
        const { start, end } = sheetSelection;
        const minRow = Math.min(start.row, end.row);
        const minCol = Math.min(start.col, end.col);
        const maxRow = Math.max(start.row, end.row);
        const maxCol = Math.max(start.col, end.col);

        if (minRow !== maxRow || minCol !== maxCol) return true;

        if (!spreadsheet || !spreadsheet.data) return false;
        const cell = spreadsheet.data[minRow]?.[minCol];
        if (!cell) return false;
        return (cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1;
    }
    
    let canMergeOrUnmerge = false;
    $: if (sheetSelection && selectedNoteId) {
        tick().then(() => {
            canMergeOrUnmerge = getCanMergeOrUnmerge();
        });
    } else {
        canMergeOrUnmerge = false;
    }

    // Focus action for inputs
    function focus(node: HTMLElement) {
        node.focus();
        return { destroy() {} };
    }

    async function loadSpreadsheetComponent() {
        if (isSpreadsheetLoaded) return;
        try {
            const module = await import('$lib/components/Spreadsheet.svelte');
            SpreadsheetComponent = module.default;
            isSpreadsheetLoaded = true;
        } catch (e) {
            console.error('Failed to load Spreadsheet component:', e);
        }
    }

    async function selectNote(id: string) {
        if (selectedNoteId === id) return;
        
        // Save current note before switching
        if (currentNote && currentNote.type === 'text' && editorDiv) {
            currentNote.contentHTML = editorDiv.innerHTML;
            saveNoteHistory(currentNote.id, editorDiv.innerHTML);
            await debouncedUpdateNote.flush();
        } else {
            await debouncedUpdateNote.flush();
        }
        
        const note = notes.find((n) => n.id === id);
        if (note) {
            const noteWithMeta = note as any;
            
            if (note.type === 'text') {
                if ((!note.contentHTML || note.contentHTML === '') && !noteWithMeta._contentLoaded) {
                    try {
                        const rawContent = await db.getNoteContent(id);
                        if (rawContent) {
                            note.contentHTML = (browser && DOMPurify) 
                                ? DOMPurify.sanitize(rawContent)
                                : rawContent;
                        } else {
                            note.contentHTML = '';
                        }
                        noteWithMeta._contentLoaded = true;
                    } catch (e) {
                        console.error('Failed to load note content:', e);
                        note.contentHTML = '';
                        noteWithMeta._contentLoaded = true;
                    }
                } else {
                    noteWithMeta._contentLoaded = true;
                }
                
                if (note.contentHTML && !noteHistory.has(id)) {
                    saveNoteHistory(id, note.contentHTML);
                }
            }
            
            notes = [...notes];
            
            if (note.type === 'spreadsheet') {
                await tick();
                await loadSpreadsheetComponent();
            }
        }
        
        selectedSheetCell = null;
        sheetSelection = null;
        selectedNoteId = id;
        
        if (note && note.type === 'text' && editorDiv) {
            tick().then(() => {
                const updatedNote = notes.find((n) => n.id === id);
                if (updatedNote && updatedNote.type === 'text' && editorDiv) {
                    const sanitized = (browser && DOMPurify) 
                        ? DOMPurify.sanitize(updatedNote.contentHTML || '')
                        : (updatedNote.contentHTML || '');
                    if (editorDiv.innerHTML !== sanitized) {
                        editorDiv.innerHTML = sanitized;
                    }
                }
            });
        }
        
        await tick();
        try {
            await db.putSetting({
                key: `selectedNoteId:${activeWorkspaceId}`,
                value: id
            });
        } catch (e) {
            console.error('Failed to save selected note:', e);
        }
    }

    async function addNote(type: 'text' | 'spreadsheet' = 'text') {
        try {
            if (type === 'spreadsheet') {
                await loadSpreadsheetComponent();
            }
            const notesInCurrentView = displayList.filter((item) => item.displayType === 'note');
            const n: Note = {
                id: generateUUID(),
                title: type === 'spreadsheet' ? 'Untitled Sheet' : 'Untitled Note',
                contentHTML: '',
                updatedAt: Date.now(),
                workspaceId: activeWorkspaceId!,
                folderId: currentFolderId,
                order: notesInCurrentView.length,
                type: type,
                spreadsheet: type === 'spreadsheet' ? createEmptySpreadsheet() : undefined
            };
            await db.putNote(n);
            const reloadedNotes = await db.getNotesByWorkspaceId(activeWorkspaceId!);
            const reloadedNote = reloadedNotes.find(note => note.id === n.id);
            if (reloadedNote) {
                const noteIndex = notes.findIndex(note => note.id === n.id);
                if (noteIndex !== -1) {
                    notes[noteIndex] = reloadedNote;
                    notes = [...notes];
                } else {
                    notes = [...notes, reloadedNote];
                }
            } else {
                notes = [...notes, n];
            }
            await selectNote(n.id);
            await onSyncIfLoggedIn();
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
                workspaceId: activeWorkspaceId!,
                order: displayList.length
            };
            await db.putFolder(f);
            folders = [...folders, f];
            await onSyncIfLoggedIn();
        } catch (error) {
            console.error('Failed to add folder:', error);
            alert('Failed to create folder. Please try again.');
        }
    }

    async function renameFolder(id: string, newName: string) {
        const folder = folders.find((f) => f.id === id);
        const trimmed = newName.trim();
        if (folder && trimmed && trimmed !== folder.name) {
            folder.name = trimmed;
            await db.putFolder(folder);
            folders = [...folders];
        }
        editingFolderId = null;
        isEditingHeaderName = false;
    }

    async function renameNote(id: string, newName: string) {
        const note = notes.find((n) => n.id === id);
        const trimmed = newName.trim();
        if (note && trimmed && trimmed !== note.title) {
            note.title = trimmed;
            note.updatedAt = Date.now();
            await db.putNote(note);
            notes = [...notes];
            await onSyncIfLoggedIn();
        }
        editingNoteId = null;
    }

    async function deleteFolder(folderId: string) {
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) return;
        const confirmed = await showDeleteDialog(`Delete "${folder.name}"?\n\nAll notes inside will be permanently deleted.`);
        if (!confirmed) {
            return;
        }

        const notesToDelete = notes.filter((n) => n.folderId === folderId);
        const deletePromises = notesToDelete.map((note) => db.deleteNote(note.id));
        await Promise.all(deletePromises);
        await db.deleteFolder(folderId);

        const deletedNoteIds = new Set(notesToDelete.map((n) => n.id));
        const newNotes = notes.filter((n) => !deletedNoteIds.has(n.id));
        const newFolders = folders.filter((f) => f.id !== folderId);
        if (newNotes.length !== notes.length) {
            notes = newNotes;
        }
        if (newFolders.length !== folders.length) {
            folders = newFolders;
        }

        if (currentFolderId === folderId) await goBack();
        await onSyncIfLoggedIn();
    }

    async function deleteNote(id: string) {
        const note = notes.find((n) => n.id === id);
        if (!note) return;
        
        if (selectedNoteId === id && currentNote && currentNote.type === 'text' && editorDiv) {
            currentNote.contentHTML = editorDiv.innerHTML;
            saveNoteHistory(currentNote.id, editorDiv.innerHTML);
            await debouncedUpdateNote.flush();
        }
        
        const noteType = note.type === 'spreadsheet' ? 'spreadsheet' : 'note';
        const noteTitle = note.title || 'Untitled';
        
        const confirmed = await showDeleteDialog(`Are you sure you want to delete "${noteTitle}"?\n\nThis ${noteType} will be permanently deleted and cannot be recovered.`);
        if (!confirmed) {
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
        await onSyncIfLoggedIn();
    }

    function triggerNoteUpdate() {
        if (!currentNote) return;
        notes = [...notes];
    }

    function saveNoteHistory(noteId: string, content: string) {
        if (!noteHistory.has(noteId)) {
            noteHistory.set(noteId, []);
            noteHistoryIndex.set(noteId, -1);
        }
        const history = noteHistory.get(noteId)!;
        const index = noteHistoryIndex.get(noteId)!;
        
        history.splice(index + 1);
        history.push({ content, timestamp: Date.now() });
        let newIndex = history.length - 1;
        
        if (history.length > MAX_NOTE_HISTORY) {
            history.shift();
            newIndex--;
        }
        noteHistoryIndex.set(noteId, newIndex);
    }

    function undoNote(noteId: string) {
        if (!noteHistory.has(noteId)) return false;
        const history = noteHistory.get(noteId)!;
        const index = noteHistoryIndex.get(noteId)!;
        
        if (index > 0) {
            noteHistoryIndex.set(noteId, index - 1);
            const previousState = history[index - 1];
            if (previousState && currentNote && currentNote.id === noteId) {
                const sanitized = (browser && DOMPurify) 
                    ? DOMPurify.sanitize(previousState.content)
                    : previousState.content;
                currentNote.contentHTML = sanitized;
                if (editorDiv) {
                    editorDiv.innerHTML = sanitized;
                }
                debouncedUpdateNote(currentNote);
                return true;
            }
        }
        return false;
    }

    function redoNote(noteId: string) {
        if (!noteHistory.has(noteId)) return false;
        const history = noteHistory.get(noteId)!;
        const index = noteHistoryIndex.get(noteId)!;
        
        if (index < history.length - 1) {
            noteHistoryIndex.set(noteId, index + 1);
            const nextState = history[index + 1];
            if (nextState && currentNote && currentNote.id === noteId) {
                const sanitized = (browser && DOMPurify) 
                    ? DOMPurify.sanitize(nextState.content)
                    : nextState.content;
                currentNote.contentHTML = sanitized;
                if (editorDiv) {
                    editorDiv.innerHTML = sanitized;
                }
                debouncedUpdateNote(currentNote);
                return true;
            }
        }
        return false;
    }

    const debouncedSaveNoteHistory = debounce((noteId: string, content: string) => {
        saveNoteHistory(noteId, content);
    }, 300);

    async function updateNote(note: Note) {
        let contentHTML = note.contentHTML;
        if (note.type === 'text' && selectedNoteId === note.id && editorDiv) {
            contentHTML = editorDiv.innerHTML;
        }
        
        let spreadsheet = note.spreadsheet;
        if (note.type === 'spreadsheet' && selectedNoteId === note.id) {
            if (!spreadsheet && parsedCurrentNote && parsedCurrentNote.spreadsheet) {
                spreadsheet = parsedCurrentNote.spreadsheet;
            }
            if (!spreadsheet) {
                console.warn(`[updateNote] No spreadsheet data found for spreadsheet note ${note.id}`);
            }
        }
        
        const noteToSave = { 
            ...note, 
            contentHTML: contentHTML,
            spreadsheet: spreadsheet,
            updatedAt: Date.now() 
        };
        
        if (browser && DOMPurify && noteToSave.type === 'text') {
            noteToSave.contentHTML = DOMPurify.sanitize(noteToSave.contentHTML);
        }
        
        await db.putNote(noteToSave);
        
        if (noteToSave.type === 'spreadsheet') {
            try {
                const reloadedNotes = await db.getNotesByWorkspaceId(noteToSave.workspaceId);
                const reloadedNote = reloadedNotes.find(n => n.id === noteToSave.id);
                if (reloadedNote) {
                    const noteToUpdate = {
                        ...reloadedNote,
                        updatedAt: noteToSave.updatedAt,
                        spreadsheet: noteToSave.spreadsheet
                    };
                    const index = notes.findIndex((n) => n.id === noteToSave.id);
                    if (index !== -1) {
                        const nextNotes = [...notes];
                        nextNotes[index] = noteToUpdate;
                        notes = nextNotes;
                    }
                } else {
                    console.warn(`[updateNote] Could not find reloaded note ${noteToSave.id} in database`);
                }
            } catch (e) {
                console.warn('Failed to reload note from database after save:', e);
                const index = notes.findIndex((n) => n.id === noteToSave.id);
                if (index !== -1) {
                    const nextNotes = [...notes];
                    nextNotes[index] = { ...noteToSave, contentHTML: noteToSave.contentHTML, spreadsheet: noteToSave.spreadsheet };
                    notes = nextNotes;
                }
            }
        } else {
            const index = notes.findIndex((n) => n.id === noteToSave.id);
            if (index !== -1) {
                const nextNotes = [...notes];
                nextNotes[index] = { ...noteToSave, contentHTML: noteToSave.contentHTML, spreadsheet: noteToSave.spreadsheet };
                notes = nextNotes;
            }
        }
        
        debouncedSyncIfLoggedIn();
    }

    const debouncedUpdateNote = debounce(updateNote, 400);
    const debouncedSyncIfLoggedIn = debounce(onSyncIfLoggedIn, 1000);

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

    function toggleNoteList() {
        isNoteListVisible = !isNoteListVisible;
    }

    function handleDragStart(ev: DragEvent, item: DisplayItem) {
        if (!ev.dataTransfer) return;

        isDragging = true;
        draggedItemType = item.displayType;
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.dropEffect = 'move';
        const itemData = JSON.stringify(item);
        ev.dataTransfer.setData('application/json', itemData);
        ev.dataTransfer.setData('text/plain', item.id);

        const dragImage = document.createElement('div');
        dragImage.textContent =
            item.displayType === 'folder' ? `${(item as Folder).name}` : (item as Note).title;
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
            requestAnimationFrame(() => {
                if (document.body.contains(dragImage)) {
                    document.body.removeChild(dragImage);
                }
            });
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
            const noteToMoveIndex = notes.findIndex((n) => n.id === draggedItem.id);
            if (noteToMoveIndex !== -1) {
                const noteToMove = { ...notes[noteToMoveIndex] };
                noteToMove.folderId = targetFolder.id;
                noteToMove.updatedAt = Date.now();
                noteToMove.order = notes.filter((n) => n.folderId === targetFolder.id).length;
                await db.putNote(noteToMove);
                const nextNotes = [...notes];
                nextNotes[noteToMoveIndex] = noteToMove;
                notes = nextNotes;
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
            const noteToMoveIndex = notes.findIndex((n) => n.id === draggedItem.id);
            if (noteToMoveIndex !== -1) {
                const noteToMove = { ...notes[noteToMoveIndex] };
                noteToMove.folderId = null;
                noteToMove.updatedAt = Date.now();
                noteToMove.order = displayList.length;
                await db.putNote(noteToMove);
                const nextNotes = [...notes];
                nextNotes[noteToMoveIndex] = noteToMove;
                notes = nextNotes;
            }
        }
        isDragging = false;
        draggedItemType = null;
    }

    async function handleReorderDrop(ev: DragEvent, targetIndex: number) {
        ev.preventDefault();
        ev.stopPropagation();
        dropIndex = null;

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
            if (item.displayType === 'folder') {
                const folder = item as Folder & { displayType: 'folder' };
                const originalFolder = folders.find(f => f.id === folder.id);
                if (!originalFolder) {
                    console.error('Original folder not found:', folder.id);
                    throw new Error(`Folder ${folder.id} not found`);
                }
                const workspaceId = (originalFolder as any).workspaceId || (originalFolder as any).workspace_id;
                if (!workspaceId) {
                    console.error('Original folder missing workspaceId:', originalFolder);
                    throw new Error(`Folder ${originalFolder.id} is missing workspaceId in original data`);
                }
                const updatedFolder: Folder = {
                    id: originalFolder.id,
                    name: originalFolder.name,
                    workspaceId: workspaceId,
                    order: index
                };
                return { 
                    ...updatedFolder,
                    displayType: 'folder' as const
                } as Folder & { displayType: 'folder' };
            } else {
                const note = item as Note & { displayType: 'note' };
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
                return { 
                    ...updatedNote,
                    displayType: 'note' as const
                } as Note & { displayType: 'note' };
            }
        });
        
        const promises = updates.map(async (item) => {
            if (item.displayType === 'folder') {
                const folder = item as Folder;
                if (!folder.workspaceId) {
                    console.error('Folder missing workspaceId:', folder);
                    throw new Error(`Folder ${folder.id} is missing workspaceId`);
                }
                try {
                    await db.putFolder(folder);
                } catch (error) {
                    console.error('Error saving folder:', folder, error);
                    throw error;
                }
            } else {
                const note = item as Note;
                if (!note.workspaceId) {
                    console.error('Note missing workspaceId:', note);
                    throw new Error(`Note ${note.id} is missing workspaceId`);
                }
                try {
                    await db.putNote(note);
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

        notes = [...notes];
        folders = [...folders];
        isDragging = false;
        draggedItemType = null;
    }

    async function applyFormatCommand(command: string) {
        if (editorDiv) editorDiv.focus();
        applyFormat(command);
        // Update formatting state after applying command
        await tick();
        updateFormattingState();
    }

    function modifyFontSize(amount: number) {
        if (!editorDiv) return;
        editorDiv.focus();
        
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        
        const range = selection.getRangeAt(0);
        const hasSelection = !range.collapsed;
        
        if (hasSelection) {
            // If there's a selection, modify the selected text only
            selectedFontSize = modifyFontSizeUtil(editorDiv, amount);
        } else {
            // If there's no selection, prepare for new text to use the new font size
            const currentSize = selectedFontSize || 14;
            const newSize = Math.max(8, Math.min(72, currentSize + amount));
            selectedFontSize = newSize;
            
            // Insert a zero-width span with the new font size at the cursor position
            // This ensures the next typed character uses the new size
            try {
                // Check what font size is currently at the cursor position
                let container: Node = range.commonAncestorContainer;
                let currentFontSize = 14;
                
                if (container.nodeType === Node.TEXT_NODE) {
                    container = container.parentElement!;
                }
                
                if (container instanceof HTMLElement && container !== editorDiv) {
                    const computedSize = window.getComputedStyle(container).fontSize;
                    currentFontSize = parseInt(computedSize) || 14;
                }
                
                // Always create a NEW span at the cursor position for future text
                // We don't want to modify existing spans that might contain text
                // Split text nodes if needed to insert the span at the exact cursor position
                
                let textNode: Text | null = null;
                let offset = 0;
                
                // If cursor is in a text node, we need to split it
                if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
                    textNode = range.commonAncestorContainer as Text;
                    offset = range.startOffset;
                    
                    // If cursor is at the start or end, we can insert without splitting
                    if (offset === 0) {
                        // At start of text node - insert span before it
                        const span = document.createElement('span');
                        span.style.fontSize = `${newSize}px`;
                        const zeroWidthNode = document.createTextNode('\u200B');
                        span.appendChild(zeroWidthNode);
                        textNode.parentNode?.insertBefore(span, textNode);
                        range.setStart(zeroWidthNode, 1);
                        range.setEnd(zeroWidthNode, 1);
                    } else if (offset === textNode.length) {
                        // At end of text node - insert span after it
                        const span = document.createElement('span');
                        span.style.fontSize = `${newSize}px`;
                        const zeroWidthNode = document.createTextNode('\u200B');
                        span.appendChild(zeroWidthNode);
                        textNode.parentNode?.insertBefore(span, textNode.nextSibling);
                        range.setStart(zeroWidthNode, 1);
                        range.setEnd(zeroWidthNode, 1);
                    } else {
                        // In the middle - split the text node
                        const afterText = textNode.splitText(offset);
                        const span = document.createElement('span');
                        span.style.fontSize = `${newSize}px`;
                        const zeroWidthNode = document.createTextNode('\u200B');
                        span.appendChild(zeroWidthNode);
                        textNode.parentNode?.insertBefore(span, afterText);
                        range.setStart(zeroWidthNode, 1);
                        range.setEnd(zeroWidthNode, 1);
                    }
                } else {
                    // Cursor is at a boundary between elements - just insert the span
                    const span = document.createElement('span');
                    span.style.fontSize = `${newSize}px`;
                    const zeroWidthNode = document.createTextNode('\u200B');
                    span.appendChild(zeroWidthNode);
                    range.insertNode(span);
                    range.setStart(zeroWidthNode, 1);
                    range.setEnd(zeroWidthNode, 1);
                }
                
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (e) {
                console.warn('Failed to set font size at cursor:', e);
            }
        }
        
        editorDiv.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function updateSelectedFontSize() {
        if (!browser || !editorDiv) return;
        selectedFontSize = getSelectedFontSize(editorDiv);
    }

    function updateFormattingState() {
        if (!browser || !editorDiv) return;
        try {
            isBold = document.queryCommandState('bold');
            isItalic = document.queryCommandState('italic');
        } catch (e) {
            // queryCommandState may fail in some contexts
            isBold = false;
            isItalic = false;
        }
    }

    function insertCheckbox() {
        if (!editorDiv) return;
        editorDiv.focus();

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'note-checkbox';
        checkbox.style.marginRight = '6px';
        checkbox.style.verticalAlign = 'middle';
        checkbox.style.cursor = 'pointer';
        
        checkbox.addEventListener('change', () => {
            if (currentNote) {
                debouncedUpdateNote(currentNote);
            }
        });

        range.deleteContents();
        range.insertNode(checkbox);
        
        const space = document.createTextNode(' ');
        range.setStartAfter(checkbox);
        range.setEndAfter(checkbox);
        range.insertNode(space);
        
        range.setStartAfter(space);
        range.setEndAfter(space);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        if (currentNote && editorDiv) {
            currentNote.contentHTML = editorDiv.innerHTML;
            debouncedSaveNoteHistory(currentNote.id, editorDiv.innerHTML);
            debouncedUpdateNote(currentNote);
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

    async function loadNotesData() {
        if (!browser || !activeWorkspaceId) return;
        try {
            const [loadedFolders, loadedNotes, selectedNoteSetting] = await Promise.all([
                db.getFoldersByWorkspaceId(activeWorkspaceId),
                db.getNotesByWorkspaceId(activeWorkspaceId),
                db.getSettingByKey(`selectedNoteId:${activeWorkspaceId}`)
            ]);
            folders = loadedFolders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            notes = loadedNotes;
            const initialSelectedId =
                loadedNotes.find((n) => n.id === selectedNoteSetting?.value)?.id ??
                loadedNotes.find((n) => n.folderId === null)?.id ??
                '';
            selectedNoteId = initialSelectedId;

            if (initialSelectedId) {
                const note = loadedNotes.find((n) => n.id === initialSelectedId);
                if (note && note.contentHTML === '') {
                    try {
                        const rawContent = await db.getNoteContent(initialSelectedId);
                        if (rawContent) {
                            note.contentHTML = (browser && DOMPurify) 
                                ? DOMPurify.sanitize(rawContent)
                                : rawContent;
                        }
                        const noteWithMeta = note as any;
                        noteWithMeta._contentLoaded = true;
                        notes = [...notes];
                    } catch (e) {
                        console.error('Failed to load initial note content:', e);
                    }
                }
                if (note && note.type === 'spreadsheet') {
                    await loadSpreadsheetComponent();
                }
            }
        } catch (e) {
            console.error('Failed to load notes data:', e);
        }
    }

    // Load DOMPurify on mount
    onMount(() => {
        if (browser) {
            import('dompurify').then(module => {
                DOMPurify = module.default;
            }).catch(err => {
                console.warn('Failed to load DOMPurify:', err);
            });
            
            const updateMobileVisibility = () => {
                const nowMobile = window.innerWidth <= 768;
                if (nowMobile && !isMobileView) {
                    isNoteListVisible = false;
                }
                isMobileView = nowMobile;
            };
            updateMobileVisibility();
            window.addEventListener('resize', updateMobileVisibility);

            // Listen for selection changes to update formatting state
            const handleSelectionChange = () => {
                if (editorDiv && document.activeElement === editorDiv) {
                    updateFormattingState();
                }
            };
            document.addEventListener('selectionchange', handleSelectionChange);

            // Store cleanup function
            (window as any).__notesPanelSelectionCleanup = () => {
                document.removeEventListener('selectionchange', handleSelectionChange);
                window.removeEventListener('resize', updateMobileVisibility);
            };
        }
    });

    // Load notes when not minimized and workspace changes
    $: if (browser && !isMinimized && activeWorkspaceId) {
        loadNotesData();
    }

    // Reset when workspace changes
    $: if (activeWorkspaceId) {
        currentFolderId = null;
        selectedNoteId = '';
        notes = [];
        folders = [];
    }

    onDestroy(() => {
        // Cleanup selection change listener
        if (browser && (window as any).__notesPanelSelectionCleanup) {
            (window as any).__notesPanelSelectionCleanup();
            delete (window as any).__notesPanelSelectionCleanup;
        }
        
        // Cleanup any debounced functions
        if (debouncedUpdateNote) {
            debouncedUpdateNote.flush?.();
        }
    });
</script>

<section
    class="panel notes-panel"
    class:minimized={isMinimized}
    bind:clientWidth={notesPanelClientWidth}
    style="max-width: 100%; overflow: hidden;"
>
    <div class="panel-header">
        {#if !isMinimized}
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

        {#if !isMinimized}
            <button
                class="small-btn toggle-notelist-btn-header"
                on:click={toggleNoteList}
                title={isNoteListVisible ? 'Hide Note List' : 'Show Note List'}
            >
                {isNoteListVisible ? '«' : '»'}
            </button>
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
            on:click={onToggleMinimized}
            title={isMinimized ? 'Expand' : 'Collapse'}
        >
            {isMinimized ? '⤢' : '⤡'}
        </button>
    </div>

    {#if !isMinimized && currentNote}
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
                        class:active={isBold}
                        on:click={() => applyFormatCommand('bold')}
                        on:mousedown={(e) => e.preventDefault()}
                        title="Bold"
                        style="font-weight: bold;">B</button
                    >
                    <button
                        class="toolbar-btn"
                        class:active={isItalic}
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

    {#if !isMinimized}
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
                        ... ← Back to root
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
                                        handleReorderDrop(e, i);
                                    }
                                } else {
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
                                    <span class="folder-icon">{@html FolderIcon}</span> {(item as Folder).name}
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
                                {#if SpreadsheetComponent}
                                    <svelte:component
                                        this={SpreadsheetComponent}
                                        bind:this={spreadsheetComponentInstance}
                                        bind:spreadsheetData={parsedCurrentNote.spreadsheet}
                                        bind:selectedCell={selectedSheetCell}
                                        bind:selection={sheetSelection}
                                        on:update={() => {
                                            if (currentNote && currentNote.type === 'spreadsheet') {
                                                const latestSpreadsheet = parsedCurrentNote?.spreadsheet;
                                                
                                                if (latestSpreadsheet) {
                                                    
                                                    const index = notes.findIndex((n) => n.id === currentNote.id);
                                                    if (index !== -1) {
                                                        const noteWithRaw = notes[index] as any;
                                                        noteWithRaw.spreadsheet = latestSpreadsheet;
                                                        noteWithRaw._spreadsheetJson = latestSpreadsheet;
                                                        notes[index] = {
                                                            ...notes[index],
                                                            spreadsheet: latestSpreadsheet,
                                                            updatedAt: Date.now()
                                                        };
                                                        notes = [...notes];
                                                    }
                                                    
                                                    const noteWithLatestData = {
                                                        ...currentNote,
                                                        spreadsheet: latestSpreadsheet
                                                    };
                                                    
                                                    debouncedUpdateNote(noteWithLatestData);
                                                } else {
                                                    console.warn('[spreadsheet update] No spreadsheet data found in parsedCurrentNote for note', currentNote.id);
                                                }
                                            }
                                            triggerNoteUpdate();
                                        }}
                                    />
                                    {:else}
                                        <div style="padding: 20px; text-align: center; color: var(--text-muted);">
                                            Loading spreadsheet...
                                        </div>
                                    {/if}
                            </div>
                        {:else}
                            <div class="note-content">
                                <div
                                    class="contenteditable"
                                    contenteditable="true"
                                    bind:this={editorDiv}
                                    on:input={(e) => {
                                        if (currentNote && editorDiv) {
                                            currentNote.contentHTML = editorDiv.innerHTML;
                                            debouncedSaveNoteHistory(currentNote.id, editorDiv.innerHTML);
                                            debouncedUpdateNote(currentNote);
                                        }
                                    }}
                                    on:focus={async () => {
                                        await tick();
                                        updateFormattingState();
                                        updateSelectedFontSize();
                                    }}
                                    on:paste={handlePlainTextPaste}
                                    on:keydown={(e) => {
                                        // Ensure new text uses the selected font size when typing
                                        // Only do this if we're about to type a regular character
                                        if (!e.ctrlKey && !e.metaKey && e.key.length === 1 && !e.shiftKey && e.key !== 'Enter') {
                                            const selection = window.getSelection();
                                            if (selection && selection.rangeCount > 0) {
                                                const range = selection.getRangeAt(0);
                                                if (range.collapsed) {
                                                    // Check the current font size at cursor
                                                    let container: Node = range.commonAncestorContainer;
                                                    let currentFontSize = 14;
                                                    
                                                    if (container.nodeType === Node.TEXT_NODE) {
                                                        container = container.parentElement!;
                                                    }
                                                    
                                                    if (container instanceof HTMLElement && container !== editorDiv) {
                                                        const computedSize = window.getComputedStyle(container).fontSize;
                                                        currentFontSize = parseInt(computedSize) || 14;
                                                    }
                                                    
                                                    // Only insert a span if the font size is different from selectedFontSize
                                                    if (currentFontSize !== selectedFontSize) {
                                                        try {
                                                            // Always create a NEW span at cursor position, don't modify existing ones
                                                            // This ensures only future text gets the new font size
                                                            
                                                            let textNode: Text | null = null;
                                                            let offset = 0;
                                                            
                                                            // If cursor is in a text node, we need to split it
                                                            if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
                                                                textNode = range.commonAncestorContainer as Text;
                                                                offset = range.startOffset;
                                                                
                                                                // If cursor is at the start or end, we can insert without splitting
                                                                if (offset === 0) {
                                                                    // At start of text node - insert span before it
                                                                    const span = document.createElement('span');
                                                                    span.style.fontSize = `${selectedFontSize}px`;
                                                                    const zeroWidthNode = document.createTextNode('\u200B');
                                                                    span.appendChild(zeroWidthNode);
                                                                    textNode.parentNode?.insertBefore(span, textNode);
                                                                    range.setStart(zeroWidthNode, 1);
                                                                    range.setEnd(zeroWidthNode, 1);
                                                                } else if (offset === textNode.length) {
                                                                    // At end of text node - insert span after it
                                                                    const span = document.createElement('span');
                                                                    span.style.fontSize = `${selectedFontSize}px`;
                                                                    const zeroWidthNode = document.createTextNode('\u200B');
                                                                    span.appendChild(zeroWidthNode);
                                                                    textNode.parentNode?.insertBefore(span, textNode.nextSibling);
                                                                    range.setStart(zeroWidthNode, 1);
                                                                    range.setEnd(zeroWidthNode, 1);
                                                                } else {
                                                                    // In the middle - split the text node
                                                                    const afterText = textNode.splitText(offset);
                                                                    const span = document.createElement('span');
                                                                    span.style.fontSize = `${selectedFontSize}px`;
                                                                    const zeroWidthNode = document.createTextNode('\u200B');
                                                                    span.appendChild(zeroWidthNode);
                                                                    textNode.parentNode?.insertBefore(span, afterText);
                                                                    range.setStart(zeroWidthNode, 1);
                                                                    range.setEnd(zeroWidthNode, 1);
                                                                }
                                                            } else {
                                                                // Cursor is at a boundary between elements - just insert the span
                                                                const span = document.createElement('span');
                                                                span.style.fontSize = `${selectedFontSize}px`;
                                                                const zeroWidthNode = document.createTextNode('\u200B');
                                                                span.appendChild(zeroWidthNode);
                                                                range.insertNode(span);
                                                                range.setStart(zeroWidthNode, 1);
                                                                range.setEnd(zeroWidthNode, 1);
                                                            }
                                                            
                                                            selection.removeAllRanges();
                                                            selection.addRange(range);
                                                        } catch (err) {
                                                            // Ignore errors, let normal typing proceed
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        
                                        // Handle undo/redo
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                                            e.preventDefault();
                                            if (currentNote && undoNote(currentNote.id)) {
                                                return;
                                            }
                                            document.execCommand('undo');
                                        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                                            e.preventDefault();
                                            if (currentNote && redoNote(currentNote.id)) {
                                                return;
                                            }
                                            document.execCommand('redo');
                                        } else if (e.key === 'Enter') {
                                            const selection = window.getSelection();
                                            if (selection && selection.rangeCount > 0) {
                                                const range = selection.getRangeAt(0);
                                                const container = range.commonAncestorContainer;
                                                
                                                let lineElement = container.nodeType === Node.TEXT_NODE 
                                                    ? container.parentElement 
                                                    : container as Element;
                                                
                                                while (lineElement && lineElement !== editorDiv && 
                                                       lineElement.nodeName !== 'DIV' && 
                                                       lineElement.nodeName !== 'P' &&
                                                       lineElement.nodeName !== 'BR') {
                                                    lineElement = lineElement.parentElement;
                                                }
                                                
                                                let hasCheckbox = false;
                                                
                                                if (lineElement) {
                                                    hasCheckbox = lineElement.querySelector('.note-checkbox') !== null;
                                                }
                                                
                                                const node = range.startContainer;
                                                const offset = range.startOffset;
                                                
                                                if (node.nodeType === Node.TEXT_NODE && offset === 0) {
                                                    const prevSibling = node.previousSibling;
                                                    if (prevSibling && prevSibling.nodeName === 'INPUT' && 
                                                        (prevSibling as HTMLInputElement).type === 'checkbox') {
                                                        hasCheckbox = true;
                                                    }
                                                } else if (node.nodeType === Node.TEXT_NODE) {
                                                    let checkNode = node.previousSibling;
                                                    while (checkNode) {
                                                        if (checkNode.nodeName === 'INPUT' && 
                                                            (checkNode as HTMLInputElement).type === 'checkbox') {
                                                            hasCheckbox = true;
                                                            break;
                                                        }
                                                        if (checkNode.nodeName === 'BR') {
                                                            break;
                                                        }
                                                        checkNode = checkNode.previousSibling;
                                                    }
                                                }
                                                
                                                if (!hasCheckbox) {
                                                    let checkElement: Node | null = container;
                                                    while (checkElement && checkElement !== editorDiv) {
                                                        if (checkElement.nodeType === Node.ELEMENT_NODE) {
                                                            const el = checkElement as Element;
                                                            if (el.querySelector && el.querySelector('.note-checkbox')) {
                                                                hasCheckbox = true;
                                                                break;
                                                            }
                                                        }
                                                        checkElement = checkElement.parentNode;
                                                    }
                                                }
                                                
                                                if (hasCheckbox) {
                                                    e.preventDefault();
                                                    
                                                    const br = document.createElement('br');
                                                    range.insertNode(br);
                                                    
                                                    const checkbox = document.createElement('input');
                                                    checkbox.type = 'checkbox';
                                                    checkbox.className = 'note-checkbox';
                                                    checkbox.style.marginRight = '6px';
                                                    checkbox.style.verticalAlign = 'middle';
                                                    checkbox.style.cursor = 'pointer';
                                                    
                                                    checkbox.addEventListener('change', () => {
                                                        if (currentNote) {
                                                            debouncedUpdateNote(currentNote);
                                                        }
                                                    });
                                                    
                                                    range.setStartAfter(br);
                                                    range.setEndAfter(br);
                                                    range.insertNode(checkbox);
                                                    
                                                    const space = document.createTextNode(' ');
                                                    range.setStartAfter(checkbox);
                                                    range.setEndAfter(checkbox);
                                                    range.insertNode(space);
                                                    
                                                    range.setStartAfter(space);
                                                    range.setEndAfter(space);
                                                    range.collapse(true);
                                                    
                                                    selection.removeAllRanges();
                                                    selection.addRange(range);
                                                    
                                                    if (currentNote && editorDiv) {
                                                        currentNote.contentHTML = editorDiv.innerHTML;
                                                        debouncedSaveNoteHistory(currentNote.id, editorDiv.innerHTML);
                                                        debouncedUpdateNote(currentNote);
                                                    }
                                                }
                                            }
                                        }
                                    }}
                                ></div>
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
        min-width: 120px;
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
        justify-content: flex-start;
        position: relative;
        gap: 8px;
        padding-right: 12px;
    }

    .panel-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    .panel.minimized .panel-title {
        flex-shrink: 0;
        flex-basis: 55px;
        min-width: 55px;
        text-overflow: ellipsis;
        overflow: hidden;
    }

    .panel.minimized .panel-minimize-btn {
        flex-shrink: 0;
        margin-left: auto;
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
        margin-right: 0;
    }

    .notes-actions::-webkit-scrollbar {
        display: none;
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

    .notes {
        display: grid;
        grid-template-columns: 180px 1fr;
        height: 100%;
        transition: grid-template-columns 0.2s ease-in-out;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
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
        flex: 1;
        overflow: hidden;
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
    
    :global(.contenteditable ul) {
        padding-left: 40px;
        margin: 0;
    }
    
    :global(.contenteditable li) {
        margin: 0;
        padding: 0;
    }
    
    :global(.note-checkbox) {
        margin-left: 40px;
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
        min-width: 0;
        max-width: 100%;
        max-height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
    }

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

    .toolbar-btn.active {
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2), 0 0 4px rgba(255, 255, 255, 0.1);
        background-color: rgba(255, 255, 255, 0.05);
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

    .toggle-notelist-btn-header {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        flex-shrink: 0;
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
        color: #ff6b81;
    }

    .folder-icon {
        display: inline-flex;
        align-items: center;
        margin-right: 6px;
    }

    @media (max-width: 768px) {
        .folder-item input,
        .note-item input {
            font-size: 16px !important;
            transform: scale(0.875);
            transform-origin: left center;
        }
    }
</style>

