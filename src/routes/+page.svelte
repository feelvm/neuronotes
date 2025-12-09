<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import * as db from '$lib/db';
    import * as backup from '$lib/backup';
    // Supabase imports are loaded dynamically to reduce bundle size
    let auth: typeof import('$lib/supabase/auth');
    let sync: typeof import('$lib/supabase/sync');
    let migrations: typeof import('$lib/supabase/migrations');
    let onAuthStateChange: typeof import('$lib/supabase/auth').onAuthStateChange;
    import { debounce } from '$lib/utils/debounce';
    import { generateUUID } from '$lib/utils/uuid';
    import { ymd, dmy, startOfWeek, localDateFromYMD } from '$lib/utils/dateHelpers';
    import { 
        applyFormat, 
        modifyFontSize as modifyFontSizeUtil, 
        getSelectedFontSize,
        handlePlainTextPaste
    } from '$lib/utils/textFormatting';
    import LoginModal from '$lib/components/LoginModal.svelte';
    import SignupModal from '$lib/components/SignupModal.svelte';
    import BackupModal from '$lib/components/BackupModal.svelte';
    import NavigationBar from '$lib/components/NavigationBar.svelte';
    import EditPanelsModal from '$lib/components/EditPanelsModal.svelte';
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

    // SVG Icon Components
    const LockIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.5 7H12V5C12 2.79 10.21 1 8 1S4 2.79 4 5V7H3.5C2.67 7 2 7.67 2 8.5V13.5C2 14.33 2.67 15 3.5 15H12.5C13.33 15 14 14.33 14 13.5V8.5C14 7.67 13.33 7 12.5 7ZM5 5C5 3.34 6.34 2 8 2S11 3.34 11 5V7H5V5ZM13 13.5C13 13.78 12.78 14 12.5 14H3.5C3.22 14 3 13.78 3 13.5V8.5C3 8.22 3.22 8 3.5 8H12.5C12.78 8 13 8.22 13 8.5V13.5Z" fill="currentColor"/>
    </svg>`;

    const UserIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 8C10.21 8 12 6.21 12 4C12 1.79 10.21 0 8 0C5.79 0 4 1.79 4 4C4 6.21 5.79 8 8 8ZM8 1C9.66 1 11 2.34 11 4C11 5.66 9.66 7 8 7C6.34 7 5 5.66 5 4C5 2.34 6.34 1 8 1ZM8 9C5.33 9 0 10.34 0 13V15C0 15.55 0.45 16 1 16H15C15.55 16 16 15.55 16 15V13C16 10.34 10.67 9 8 9ZM1 13C1.22 11.28 5.31 10 8 10C10.69 10 14.78 11.28 15 13V14H1V13Z" fill="currentColor"/>
    </svg>`;


    const ExpandIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 3H13V13H3V3ZM4 4V12H12V4H4ZM6 6H10V7H6V6ZM6 9H10V10H6V9Z" fill="currentColor"/>
    </svg>`;

    const CollapseIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 3H13V13H3V3ZM4 4V12H12V4H4ZM6 6H10V7H6V6Z" fill="currentColor"/>
    </svg>`;

    const FolderIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 3C1.45 3 1 3.45 1 4V13C1 13.55 1.45 14 2 14H14C14.55 14 15 13.55 15 13V5C15 4.45 14.55 4 14 4H8L6.5 2.5C6.22 2.22 5.78 2 5.5 2H2ZM2 3H5.5L7 4.5C7.28 4.78 7.72 5 8 5H14V13H2V4V3Z" fill="currentColor"/>
    </svg>`;

    const GlobeIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0ZM7 14.93C4.05 14.44 1.56 11.95 1.07 9H3.09C3.57 10.84 5.16 12.43 7 12.91V14.93ZM7 11.93C5.84 11.6 4.4 10.16 4.07 9H7V11.93ZM7 8H4.07C4.4 6.84 5.84 5.4 7 5.07V8ZM7 4.09C5.16 4.57 3.57 6.16 3.09 8H1.07C1.56 5.05 4.05 2.56 7 2.07V4.09ZM9 2.07C11.95 2.56 14.44 5.05 14.93 8H12.91C12.43 6.16 10.84 4.57 9 4.09V2.07ZM9 5.07C10.16 5.4 11.6 6.84 11.93 8H9V5.07ZM9 9H11.93C11.6 10.16 10.16 11.6 9 11.93V9ZM9 12.91C10.84 12.43 12.43 10.84 12.91 9H14.93C14.44 11.95 11.95 14.44 9 14.93V12.91Z" fill="currentColor"/>
    </svg>`;


    const RepeatIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 2L21 6M21 6L17 10M21 6H7.8C6.11984 6 5.27976 6 4.63803 6.32698C4.07354 6.6146 3.6146 7.07354 3.32698 7.63803C3 8.27976 3 9.11984 3 10.8V11M3 18H16.2C17.8802 18 18.7202 18 19.362 17.673C19.9265 17.3854 20.3854 16.9265 20.673 16.362C21 15.7202 21 14.8802 21 13.2V13M3 18L7 22M3 18L7 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    let DOMPurify: any;
    let notesPanelWidth = 50;
    let calendarPanelHeight = 50;
    let isNoteListVisible = true;
    let isNotesMinimized = false;
    let isCalendarMinimized = false;
    let isKanbanMinimized = false;
    let hasHandledInitialSession = false; // Track if we've handled initial session to avoid duplicate data clearing
    
    let showNotes = true;
    let showCalendar = true;
    let showKanban = true;
    let showEditPanelsModal = false;
    
    $: {
        if (!showNotes) {
            isNotesMinimized = false;
        }
        if (!showCalendar) {
            isCalendarMinimized = false;
        }
        if (!showKanban) {
            isKanbanMinimized = false;
        }
    }
    
    // Save content when panel is hidden - use a function instead of reactive statement to avoid cycle
    let previousShowNotes = true;
    function handleShowNotesChange() {
        if (!showNotes && previousShowNotes && selectedNoteId && editorDiv) {
            const content = editorDiv.innerHTML;
            saveNoteHistory(selectedNoteId, content);
            // Save content directly to database without reading from notes to avoid cycle
            setTimeout(async () => {
                // Get note outside reactive context to avoid cycle
                const note = notes.find((n) => n.id === selectedNoteId);
                if (note && note.type === 'text') {
                    note.contentHTML = content;
                    await debouncedUpdateNote.flush().catch((e: any) => {
                        console.warn('Failed to save note when hiding notes panel:', e);
                    });
                }
            }, 0);
        }
        previousShowNotes = showNotes;
    }
    
    // Watch for showNotes changes and call handler
    $: {
        handleShowNotesChange();
    }
    let lastNotesWidth = 50;
    let lastCalendarHeight = 50;
    let isVerticalResizing = false;
    let isHorizontalResizing = false;
    let notesPanelClientWidth = 0;

    type NoteHistoryEntry = {
        content: string;
        timestamp: number;
    };

    const noteHistory: Map<string, NoteHistoryEntry[]> = new Map();
    const noteHistoryIndex: Map<string, number> = new Map();
    const MAX_NOTE_HISTORY = 50;

    $: minimizedCount =
        (isNotesMinimized ? 1 : 0) + (isCalendarMinimized ? 1 : 0) + (isKanbanMinimized ? 1 : 0);
    
    // Track when panel is restored to reload content if needed
    let previousIsNotesMinimized = false;
    $: {
        // When panel is restored (was minimized, now not minimized)
        if (!isNotesMinimized && previousIsNotesMinimized && selectedNoteId) {
            // Panel just restored - ensure content is loaded
            setTimeout(() => {
                const note = notes.find((n) => n.id === selectedNoteId);
                if (note && note.type === 'text' && editorDiv) {
                    // If note has content, restore it to editor
                    if (note.contentHTML) {
                        const sanitized = browser && DOMPurify
                            ? DOMPurify.sanitize(note.contentHTML)
                            : note.contentHTML;
                        if (editorDiv.innerHTML !== sanitized) {
                            editorDiv.innerHTML = sanitized;
                        }
                    } else {
                        // If content is missing, try to load from database
                        const noteWithMeta = note as any;
                        if (!noteWithMeta._contentLoaded) {
                            db.getNoteContent(selectedNoteId).then(rawContent => {
                                if (rawContent && editorDiv && selectedNoteId === note.id) {
                                    const sanitized = (browser && DOMPurify) 
                                        ? DOMPurify.sanitize(rawContent)
                                        : rawContent;
                                    const noteIndex = notes.findIndex((n) => n.id === note.id);
                                    if (noteIndex !== -1) {
                                        notes[noteIndex] = { ...notes[noteIndex], contentHTML: sanitized };
                                        const updatedNoteWithMeta = notes[noteIndex] as any;
                                        updatedNoteWithMeta._contentLoaded = true;
                                        notes = [...notes];
                                    }
                                    if (editorDiv && editorDiv.innerHTML !== sanitized) {
                                        editorDiv.innerHTML = sanitized;
                                    }
                                }
                            }).catch(e => {
                                console.error('Failed to load note content when restoring panel:', e);
                            });
                        }
                    }
                }
            }, 100); // Delay to ensure editor div is recreated in DOM
        }
        previousIsNotesMinimized = isNotesMinimized;
    }

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

    $: if (browser && !isCalendarMinimized && !isCalendarLoaded) {
        loadCalendarEvents();
    }

    $: if (browser && !isKanbanMinimized && !isKanbanLoaded) {
        loadKanbanData();
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

    async function toggleNotesMinimized() {
        // Save current note content before minimizing
        if (selectedNoteId && editorDiv) {
            const content = editorDiv.innerHTML;
            saveNoteHistory(selectedNoteId, content);
            // Update the note in the notes array using selectedNoteId to avoid cycle
            const noteIndex = notes.findIndex((n) => n.id === selectedNoteId);
            if (noteIndex !== -1 && notes[noteIndex].type === 'text') {
                notes[noteIndex] = { ...notes[noteIndex], contentHTML: content };
                notes = [...notes];
                // Update note via debouncedUpdateNote
                await debouncedUpdateNote.flush();
            }
        }
        const wasMinimized = isNotesMinimized;
        isNotesMinimized = !isNotesMinimized;
        
        // When restoring the panel, ensure content is loaded
        if (wasMinimized && !isNotesMinimized && selectedNoteId) {
            // Panel is being restored - ensure content is loaded
            setTimeout(() => {
                const note = notes.find((n) => n.id === selectedNoteId);
                if (note && note.type === 'text' && editorDiv) {
                    // If note has content, restore it to editor
                    if (note.contentHTML) {
                        const sanitized = browser && DOMPurify
                            ? DOMPurify.sanitize(note.contentHTML)
                            : note.contentHTML;
                        if (editorDiv.innerHTML !== sanitized) {
                            editorDiv.innerHTML = sanitized;
                        }
                    } else {
                        // If content is missing, try to load from database
                        const noteWithMeta = note as any;
                        if (!noteWithMeta._contentLoaded) {
                            db.getNoteContent(selectedNoteId).then(rawContent => {
                                if (rawContent && editorDiv && selectedNoteId === note.id) {
                                    const sanitized = (browser && DOMPurify) 
                                        ? DOMPurify.sanitize(rawContent)
                                        : rawContent;
                                    const noteIndex = notes.findIndex((n) => n.id === note.id);
                                    if (noteIndex !== -1) {
                                        notes[noteIndex] = { ...notes[noteIndex], contentHTML: sanitized };
                                        const updatedNoteWithMeta = notes[noteIndex] as any;
                                        updatedNoteWithMeta._contentLoaded = true;
                                        notes = [...notes];
                                    }
                                    if (editorDiv && editorDiv.innerHTML !== sanitized) {
                                        editorDiv.innerHTML = sanitized;
                                    }
                                }
                            }).catch(e => {
                                console.error('Failed to load note content when restoring panel:', e);
                            });
                        }
                    }
                }
            }, 50); // Small delay to ensure editor div is recreated
        }
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
        e.stopPropagation();
        isVerticalResizing = true;
        window.addEventListener('mousemove', doVerticalResize);
        window.addEventListener('mouseup', stopResize);
        // Also prevent default on body to avoid text selection
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    }

    function doVerticalResize(e: MouseEvent) {
        if (!isVerticalResizing) return;
        e.preventDefault();
        const mainEl = document.querySelector('.main');
        if (!mainEl) return;
        const mainRect = mainEl.getBoundingClientRect();
        const newWidth = ((e.clientX - mainRect.left) / mainRect.width) * 100;
        notesPanelWidth = Math.max(6, Math.min(94, newWidth));
        lastNotesWidth = notesPanelWidth;
    }

    function startHorizontalResize(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        isHorizontalResizing = true;
        window.addEventListener('mousemove', doHorizontalResize);
        window.addEventListener('mouseup', stopResize);
        // Also prevent default on body to avoid text selection
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';
    }

    function doHorizontalResize(e: MouseEvent) {
        if (!isHorizontalResizing) return;
        e.preventDefault();
        // When notes are hidden, panels are in .main; when notes are shown, they're in .right
        let containerEl = document.querySelector('.right');
        if (!containerEl) {
            // When notes are hidden, use .main.calendar-kanban or .main
            containerEl = document.querySelector('.main.calendar-kanban') || document.querySelector('.main');
        }
        if (!containerEl) return;
        const containerRect = containerEl.getBoundingClientRect();
        const newHeight = ((e.clientY - containerRect.top) / containerRect.height) * 100;
        calendarPanelHeight = Math.max(6, Math.min(94, newHeight));
        lastCalendarHeight = calendarPanelHeight;
    }

    function stopResize() {
        isVerticalResizing = false;
        isHorizontalResizing = false;
        window.removeEventListener('mousemove', doVerticalResize);
        window.removeEventListener('mousemove', doHorizontalResize);
        window.removeEventListener('mouseup', stopResize);
        // Restore body styles
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }
    
    function cleanupResizeListeners() {
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


    let editorDiv: HTMLElement;
    let previousNoteId: string | null = null;
    let selectedFontSize = 14;
    let SpreadsheetComponent: any = null;
    let spreadsheetComponentInstance: any;
    let isSpreadsheetLoaded = false;
    let selectedSheetCell: { row: number; col: number } | null = null;
    let sheetSelection: {
        start: { row: number; col: number };
        end: { row: number; col: number };
    } | null = null;

    // Compute canMergeOrUnmerge as a function to avoid reactive cycle
    function getCanMergeOrUnmerge(): boolean {
        if (!sheetSelection || !selectedNoteId) return false;
        
        // Find note without using currentNote to break cycle
        const note = notes.find((n) => n.id === selectedNoteId);
        if (!note || note.type !== 'spreadsheet') return false;
        
        // Get spreadsheet data directly from note to avoid cycle
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
    
    // Create reactive variable that updates when dependencies change, but compute in function
    let canMergeOrUnmerge = false;
    $: if (sheetSelection && selectedNoteId) {
        // Use setTimeout to break cycle - compute value asynchronously
        setTimeout(() => {
            canMergeOrUnmerge = getCanMergeOrUnmerge();
        }, 0);
    } else {
        canMergeOrUnmerge = false;
    }

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
        
        // Insert checkbox first
        range.insertNode(checkbox);
        
        // Insert space after checkbox
        const space = document.createTextNode(' ');
        range.setStartAfter(checkbox);
        range.setEndAfter(checkbox);
        range.insertNode(space);
        
        // Insert a zero-width space as cursor anchor after the regular space
        const cursorAnchor = document.createTextNode('\u200B');
        range.setStartAfter(space);
        range.setEndAfter(space);
        range.insertNode(cursorAnchor);
        
        // Position cursor at the zero-width space
        const cursorRange = document.createRange();
        cursorRange.setStart(cursorAnchor, 0);
        cursorRange.setEnd(cursorAnchor, 0);
        cursorRange.collapse(true);
        
        selection.removeAllRanges();
        selection.addRange(cursorRange);

        // Force cursor position multiple times to ensure it sticks
        const forceCursor = () => {
            const sel = window.getSelection();
            if (sel && cursorAnchor.parentNode) {
                try {
                    const fixRange = document.createRange();
                    fixRange.setStart(cursorAnchor, 0);
                    fixRange.setEnd(cursorAnchor, 0);
                    fixRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(fixRange);
                } catch (e) {
                    // Fallback: position after cursor anchor
                    const fallbackRange = document.createRange();
                    fallbackRange.setStartAfter(cursorAnchor);
                    fallbackRange.setEndAfter(cursorAnchor);
                    fallbackRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(fallbackRange);
                }
            }
            editorDiv.focus();
        };
        
        // Force cursor position immediately and after delays
        forceCursor();
        setTimeout(forceCursor, 0);
        setTimeout(forceCursor, 10);
        requestAnimationFrame(() => {
            requestAnimationFrame(forceCursor);
        });

        // Delay input event to allow cursor to settle
        setTimeout(() => {
        editorDiv.dispatchEvent(new Event('input', { bubbles: true }));
        }, 20);
    }

    let workspaces: Workspace[] = [];
    let activeWorkspaceId = '';
    let editingWorkspaceId: string | null = null;
    let draggedWorkspaceId: string | null = null;

    $: activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
    async function switchWorkspace(id: string) {
        if (id === activeWorkspaceId) return;
        debouncedUpdateNote.flush();

        // Update UI immediately for better responsiveness
        notes = [];
        folders = [];
        calendarEvents = [];
        kanban = [];
        selectedNoteId = '';
        currentFolderId = null;
        activeWorkspaceId = id;

        // Defer database operations to avoid blocking the main thread
        setTimeout(async () => {
            try {
                await db.putSetting({ key: 'activeWorkspaceId', value: id });
                await loadActiveWorkspaceData();
            } catch (error) {
                console.error('Failed to switch workspace:', error);
            }
        }, 0);
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
            await syncIfLoggedIn();
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
            await syncIfLoggedIn();
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
        const confirmed = await showDeleteDialog(`Are you sure you want to delete "${ws.name}"?\n\nAll its data (notes, folders, events, kanban) will be permanently lost.`);
        if (!confirmed) {
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

    // Compute displayList reactively - explicitly depend on notes, folders, currentFolderId, and activeWorkspaceId
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
    // Use selectedNoteId instead of currentNote to avoid cycle
    // Also check if panel was just restored (editor might be empty after being removed from DOM)
    $: if (editorDiv && selectedNoteId && (selectedNoteId !== previousNoteId || (editorDiv.innerHTML === '' && !isNotesMinimized))) {
        // Find note using selectedNoteId to avoid depending on currentNote
        const note = notes.find((n) => n.id === selectedNoteId);
        if (note && note.type === 'text') {
            // If content is missing, try to load it from database
            const noteWithMeta = note as any;
            if ((!note.contentHTML || note.contentHTML === '') && !noteWithMeta._contentLoaded) {
                const noteId = note.id;
                db.getNoteContent(noteId).then(rawContent => {
                    if (rawContent && editorDiv && selectedNoteId === noteId) {
                        const sanitized = (browser && DOMPurify) 
                            ? DOMPurify.sanitize(rawContent)
                            : rawContent;
                        // Update notes array using selectedNoteId to avoid cycle
                        const noteIndex = notes.findIndex((n) => n.id === noteId);
                        if (noteIndex !== -1) {
                            notes[noteIndex] = { ...notes[noteIndex], contentHTML: sanitized };
                            const updatedNoteWithMeta = notes[noteIndex] as any;
                            updatedNoteWithMeta._contentLoaded = true;
                            notes = [...notes];
                        }
                        // Update editor only if it's empty or different
                        if (editorDiv && (editorDiv.innerHTML === '' || editorDiv.innerHTML !== sanitized)) {
                            editorDiv.innerHTML = sanitized;
                        }
                    }
                }).catch(e => {
                    console.error('Failed to load note content:', e);
                });
                // Don't update editor yet - wait for content to load
            } else if (note.contentHTML) {
                // Note has content - update editor if needed
                const sanitized = browser && DOMPurify
                    ? DOMPurify.sanitize(note.contentHTML)
                    : note.contentHTML;
                
                // Only update if:
                // 1. Editor is empty and note has content (including when panel is restored), OR
                // 2. Editor content is different from note content AND user switched notes
                // Don't clear editor if it has content but note.contentHTML is empty (user might be typing)
                // Also don't update if editor has content and we're on the same note (user might be typing)
                if (editorDiv.innerHTML === '' && sanitized) {
                    // Editor is empty, note has content - update it (this handles panel restoration)
                    editorDiv.innerHTML = sanitized;
                } else if (editorDiv.innerHTML !== sanitized && sanitized && previousNoteId !== selectedNoteId) {
                    // User switched notes - update editor
                    editorDiv.innerHTML = sanitized;
                }
                // If editor has content and we're on the same note, don't update (user is typing)
            }
            // If editor has content but note.contentHTML is empty, don't clear it (user might be typing)
        }
        previousNoteId = selectedNoteId;
    } else if (!selectedNoteId) {
        previousNoteId = null;
    }
    
    // Parse current note's spreadsheet JSON the first time it's needed.
    // Cache the parsed object back onto the note so we don't re-parse on every update,
    // which was causing the first edit after reload to be overwritten.
    $: parsedCurrentNote = currentNote ? (() => {
        if (currentNote.type === 'spreadsheet') {
            const noteWithRaw = currentNote as any;
            // If _spreadsheetJson is a JSON string and we don't yet have a parsed spreadsheet object
            if (typeof noteWithRaw._spreadsheetJson === 'string' && !currentNote.spreadsheet) {
                try {
                    const parsed = JSON.parse(noteWithRaw._spreadsheetJson);
                    // Cache the parsed spreadsheet on the current note so future updates
                    // operate on the same object instead of re-parsing from the original JSON.
                    noteWithRaw.spreadsheet = parsed;
                    // Optionally replace _spreadsheetJson with the parsed object so we don't reparse
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
            // Update currentNote with latest content from editor before saving
            currentNote.contentHTML = editorDiv.innerHTML;
            saveNoteHistory(currentNote.id, editorDiv.innerHTML);
            // Flush the update to ensure it's saved
            await debouncedUpdateNote.flush();
        } else {
            // For non-text notes or when editorDiv is not available, just flush
            await debouncedUpdateNote.flush();
        }
        
        // Find the note we're switching to
        const note = notes.find((n) => n.id === id);
        if (note) {
            const noteWithMeta = note as any;
            let contentUpdated = false;
            
            // Load content BEFORE switching to avoid clearing the editor
            if (note.type === 'text') {
                // If content is empty and not yet loaded, load from database
                if ((!note.contentHTML || note.contentHTML === '') && !noteWithMeta._contentLoaded) {
                    try {
                        const rawContent = await db.getNoteContent(id);
                        // Sanitize content when loading from database
                        if (rawContent) {
                            note.contentHTML = (browser && DOMPurify) 
                                ? DOMPurify.sanitize(rawContent)
                                : rawContent;
                        } else {
                            note.contentHTML = '';
                        }
                        noteWithMeta._contentLoaded = true;
                        contentUpdated = true;
                    } catch (e) {
                        console.error('Failed to load note content:', e);
                        note.contentHTML = '';
                        noteWithMeta._contentLoaded = true;
                        contentUpdated = true;
                    }
                } else {
                    // Content exists, mark as loaded
                    noteWithMeta._contentLoaded = true;
                }
                
                // Initialize note history if needed
                if (note.contentHTML && !noteHistory.has(id)) {
                    saveNoteHistory(id, note.contentHTML);
                }
            }
            
            // Update notes array if content was loaded (triggers reactivity)
            // Always update notes array to ensure reactivity works, even if content wasn't just loaded
            // This ensures currentNote gets the updated note object with content
            notes = [...notes];
            
            // Load spreadsheet component if needed (defer to avoid blocking)
            if (note.type === 'spreadsheet') {
                setTimeout(async () => {
                    await loadSpreadsheetComponent();
                }, 0);
            }
        }
        
        // Now update UI - content is already loaded and notes array is updated
        // Set selectedNoteId AFTER notes array is updated so currentNote gets the correct note
        selectedSheetCell = null;
        sheetSelection = null;
        selectedNoteId = id;
        
        // Explicitly update editor div after a brief delay to ensure reactivity has processed
        // This is a fallback in case the reactive statement doesn't fire immediately
        if (note && note.type === 'text' && editorDiv) {
            setTimeout(() => {
                const updatedNote = notes.find((n) => n.id === id);
                if (updatedNote && updatedNote.type === 'text' && editorDiv) {
                    const sanitized = (browser && DOMPurify) 
                        ? DOMPurify.sanitize(updatedNote.contentHTML || '')
                        : (updatedNote.contentHTML || '');
                    if (editorDiv.innerHTML !== sanitized) {
                        editorDiv.innerHTML = sanitized;
                    }
                }
            }, 0);
        }
        
        // Save setting asynchronously
        setTimeout(async () => {
            try {
                await db.putSetting({
                    key: `selectedNoteId:${activeWorkspaceId}`,
                    value: id
                });
            } catch (e) {
                console.error('Failed to save selected note:', e);
            }
        }, 0);
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
                workspaceId: activeWorkspaceId,
                folderId: currentFolderId,
                order: notesInCurrentView.length,
                type: type,
                spreadsheet: type === 'spreadsheet' ? createEmptySpreadsheet() : undefined
            };
            await db.putNote(n);
            // Reload the note from database to ensure it has _spreadsheetJson set correctly for sync
            const reloadedNotes = await db.getNotesByWorkspaceId(activeWorkspaceId);
            const reloadedNote = reloadedNotes.find(note => note.id === n.id);
            if (reloadedNote) {
                // Replace the note in the array with the reloaded version from DB
                const noteIndex = notes.findIndex(note => note.id === n.id);
                if (noteIndex !== -1) {
                    notes[noteIndex] = reloadedNote;
                } else {
                    notes = [...notes, reloadedNote];
                }
                notes = [...notes]; // Trigger reactivity
            } else {
                notes = [...notes, n];
            }
            await selectNote(n.id);
            await syncIfLoggedIn();
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
            await syncIfLoggedIn();
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
            note.updatedAt = Date.now();
            await db.putNote(note);
            notes = [...notes];
            await syncIfLoggedIn();
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
        notes = notes.filter((n) => !deletedNoteIds.has(n.id));
        folders = folders.filter((f) => f.id !== folderId);

        if (currentFolderId === folderId) await goBack();
        // Sync deletions to Supabase
        await syncIfLoggedIn();
    }

    async function deleteNote(id: string) {
        const note = notes.find((n) => n.id === id);
        if (!note) return;
        
        // Save current note content before deleting if it's the selected note
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
        // Sync deletion to Supabase
        await syncIfLoggedIn();
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
                // Sanitize content before setting
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
                // Sanitize content before setting
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
        // If this is the currently selected text note, get the latest content from the editor
        let contentHTML = note.contentHTML;
        if (note.type === 'text' && selectedNoteId === note.id && editorDiv) {
            // Use the editor's current content as the source of truth
            contentHTML = editorDiv.innerHTML;
        }
        
        // If this is the currently selected spreadsheet note, get the latest spreadsheet data
        let spreadsheet = note.spreadsheet;
        // Only use parsedCurrentNote.spreadsheet if the note parameter doesn't already have spreadsheet data
        // This allows us to pass in the latest spreadsheet data directly from the component
        if (note.type === 'spreadsheet' && selectedNoteId === note.id) {
            // If spreadsheet is already provided in the note parameter, use it (it's the latest from component)
            // Otherwise, fall back to parsedCurrentNote.spreadsheet
            if (!spreadsheet && parsedCurrentNote && parsedCurrentNote.spreadsheet) {
                spreadsheet = parsedCurrentNote.spreadsheet;
            }
            // If we still don't have spreadsheet data, log a warning
            if (!spreadsheet) {
                console.warn(`[updateNote] No spreadsheet data found for spreadsheet note ${note.id}`);
            } else {
                console.log(`[updateNote] Saving spreadsheet note ${note.id} with data:`, spreadsheet);
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
        
        console.log(`[updateNote] Saving note ${noteToSave.id} (type: ${noteToSave.type}) to database with updatedAt: ${noteToSave.updatedAt}`);
        await db.putNote(noteToSave);
        console.log(`[updateNote] Successfully saved note ${noteToSave.id} to database`);
        
        // For spreadsheet notes, reload from database to ensure _spreadsheetJson is set correctly
        // But preserve the updatedAt timestamp we just set
        if (noteToSave.type === 'spreadsheet') {
            try {
                const reloadedNotes = await db.getNotesByWorkspaceId(noteToSave.workspaceId);
                const reloadedNote = reloadedNotes.find(n => n.id === noteToSave.id);
                if (reloadedNote) {
                    console.log(`[updateNote] Reloaded note ${reloadedNote.id} from database with updatedAt: ${reloadedNote.updatedAt}`);
                    // Preserve the updatedAt we just set (it should be the same, but ensure it is)
                    const noteToUpdate = {
                        ...reloadedNote,
                        updatedAt: noteToSave.updatedAt, // Use the timestamp we just saved
                        spreadsheet: noteToSave.spreadsheet // Also preserve the spreadsheet we just saved
                    };
                    const index = notes.findIndex((n) => n.id === noteToSave.id);
                    if (index !== -1) {
                        notes[index] = noteToUpdate;
                        notes = [...notes];
                        console.log(`[updateNote] Updated note in array with updatedAt: ${noteToUpdate.updatedAt}`);
                    }
                } else {
                    console.warn(`[updateNote] Could not find reloaded note ${noteToSave.id} in database`);
                }
            } catch (e) {
                console.warn('Failed to reload note from database after save:', e);
                // Fall back to updating with the saved note
                const index = notes.findIndex((n) => n.id === noteToSave.id);
                if (index !== -1) {
                    notes[index] = { ...noteToSave, contentHTML: noteToSave.contentHTML, spreadsheet: noteToSave.spreadsheet };
                    notes = [...notes];
                }
            }
        } else {
            // Update the note in the array, preserving contentHTML and spreadsheet
            const index = notes.findIndex((n) => n.id === noteToSave.id);
            if (index !== -1) {
                // Preserve the contentHTML and spreadsheet when updating the notes array
                notes[index] = { ...noteToSave, contentHTML: noteToSave.contentHTML, spreadsheet: noteToSave.spreadsheet };
                notes = [...notes];
            }
        }
        
        // Sync is debounced separately to ensure it happens reliably even if note updates are batched
        debouncedSyncIfLoggedIn();
    }

    const debouncedUpdateNote = debounce(updateNote, 400);
    
    // Separate debounced sync function that fires more frequently than note updates
    // This ensures sync happens even if note updates are batched
    const debouncedSyncIfLoggedIn = debounce(syncIfLoggedIn, 1000);

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
                    console.error('Available folders:', folders.map(f => ({ id: f.id, name: f.name, workspaceId: f.workspaceId })));
                    throw new Error(`Folder ${folder.id} not found`);
                }
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
        console.log('State updated - folders:', folders.length, 'notes:', notes.length);
        console.log('Updated folders:', folders.map(f => ({ id: f.id, name: f.name, order: f.order })));
        console.log('Updated notes (root):', notes.filter(n => n.folderId === null).map(n => ({ id: n.id, title: n.title, order: n.order })));
        isDragging = false;
        draggedItemType = null;
    }

    let calendarEvents: CalendarEvent[] = [];
    let isCalendarLoaded = false;
    let useCommonCalendar = false;
    let today = new Date();
    let weekStart = startOfWeek(today, 1);
    let startWithCurrentDay = false;
    let currentDayViewDate = new Date(today);
    let todayDateString = 'Calendar';
    let todayTimeString = '';
    $: weekDays = browser
        ? (() => {
              if (startWithCurrentDay) {
                  // Generate 7 days starting from currentDayViewDate
                  const viewDate = new Date(currentDayViewDate);
                  viewDate.setHours(0, 0, 0, 0);
                  return Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(viewDate);
                      d.setDate(d.getDate() + i);
                      return d;
                  });
              } else {
                  // Default: Monday-first week view
                  return Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(weekStart);
                      d.setDate(d.getDate() + i);
                      return d;
                  });
              }
          })()
        : [];
    $: eventsByDay = (() => {
        if (!browser || weekDays.length === 0) return {};

        const occurrences: Record<string, CalendarEvent[]> = {};
        const viewStartDate = weekDays[0];
        const viewEndDate = weekDays[6];

        for (const event of calendarEvents) {
            const eventStartDate = localDateFromYMD(event.date);
            
            if (!event.repeat || event.repeat === 'none') {
                if (eventStartDate >= viewStartDate && eventStartDate <= viewEndDate) {
                    const dayKey = event.date;
                    if (!occurrences[dayKey]) occurrences[dayKey] = [];
                    occurrences[dayKey].push(event);
                }
            } else {
                const instances = generateRecurringInstances(event, viewStartDate, viewEndDate);
                for (const instanceDate of instances) {
                    const dayKey = ymd(instanceDate);
                    if (!occurrences[dayKey]) occurrences[dayKey] = [];
                    occurrences[dayKey].push(event);
                }
            }
        }

        for (const dayKey in occurrences) {
            occurrences[dayKey].sort((a, b) => {
                // Events without time go to the top
                if (!a.time && !b.time) return 0;
                if (!a.time) return -1;
                if (!b.time) return 1;
                // Events with time are sorted by time
                return a.time.localeCompare(b.time);
            });
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
    let newEventCustomDays: boolean[] = [false, false, false, false, false, false, false];
    const eventColors = ['#FF4444', '#FF8800', '#FFD700', '#4CAF50', '#8C7AE6', '#2196F3', '#03A9F4']; // red, orange, yellow, green, purple, blue, light blue
    let newEventColor = '#8C7AE6';
    let showRepeatOptions = false;
    
    // Event editing state
    let editingEventId: string | null = null;
    let editingEventDate: string | null = null;
    let editingEventTitle = '';
    let editingEventTime = '';

    function cycleEventColor() {
        const currentIndex = eventColors.indexOf(newEventColor);
        // If current color not in array, start from first color, otherwise cycle to next
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % eventColors.length;
        newEventColor = eventColors[nextIndex];
    }

    function hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    let showSettingsDropdown = false;
    let showBackupModal = false;
    
    let isLoggedIn = false;
    let currentUserId: string | null = null; // Track current user ID to detect user switches
    let showLoginModal = false;
    let loginEmail = '';
    let loginPassword = '';
    let rememberMe = false;
    let isEmailInvalid = false;
    
    let showSignupModal = false;
    let signupEmail = '';
    let signupPassword = '';
    let signupRepeatPassword = '';
    let isSignupEmailInvalid = false;
    let isPasswordMismatch = false;
    let isPasswordInvalid = false;
    
    // Helper function to load Supabase modules if not already loaded
    async function ensureSupabaseLoaded() {
        if (!auth) {
            const authModule = await import('$lib/supabase/auth');
            auth = authModule;
            onAuthStateChange = authModule.onAuthStateChange;
            sync = await import('$lib/supabase/sync');
            migrations = await import('$lib/supabase/migrations');
        }
    }
    
    // Helper function to sync data to Supabase if logged in
    // Pushes local changes to Supabase (for user actions like create/update/delete)
    async function syncIfLoggedIn() {
        if (isLoggedIn) {
            try {
                // Flush database to ensure all writes are persisted before syncing
                await db.flushDatabaseSave();
                
                await ensureSupabaseLoaded();
                // Just push - don't pull, as that could overwrite local changes
                // Pull happens on initial load and periodic sync
                const result = await sync.pushToSupabase();
                if (!result.success) {
                    console.error('Sync push failed:', result.error);
                } else {
                    console.log('Sync push successful');
                }
            } catch (error) {
                console.error('Sync failed:', error);
                // Don't block user operations if sync fails
            }
        }
    }
    
    // Set up periodic sync to pull changes from other devices (every 30 seconds)
    let syncInterval: ReturnType<typeof setInterval> | undefined;
    const setupPeriodicSync = () => {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = undefined;
        }
        if (isLoggedIn) {
            syncInterval = setInterval(async () => {
                if (isLoggedIn) {
                    try {
                        await ensureSupabaseLoaded();
                        // Use fullSync to sync both directions with conflict resolution
                        // Conflict resolution ensures we don't overwrite newer changes
                        const result = await sync.fullSync();
                        if (result.success && activeWorkspaceId) {
                            // Reload UI after successful sync to show changes from other devices
                            await loadActiveWorkspaceData();
                        }
                    } catch (error) {
                        console.error('Periodic sync failed:', error);
                        // Don't block if sync fails
                    }
                }
            }, 30000); // Every 30 seconds
        }
    };

    // Callback for successful login - handles post-login state updates
    async function handleLoginSuccess(userId: string) {
        isLoggedIn = true;
        currentUserId = userId;
        
        // Clear UI state and reload workspace data
        notes = [];
        folders = [];
        calendarEvents = [];
        kanban = [];
        selectedNoteId = '';
        currentFolderId = null;
        
        // Reload workspaces and set active workspace
        let loadedWorkspaces = await db.getAllWorkspaces();
        if (loadedWorkspaces.length > 0) {
            workspaces = loadedWorkspaces.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            activeWorkspaceId = workspaces[0].id;
        } else {
            // Create default workspace if none exist
            const defaultWorkspace: Workspace = {
                id: generateUUID(),
                name: 'My Workspace',
                order: 0
            };
            await db.putWorkspace(defaultWorkspace);
            workspaces = [defaultWorkspace];
            activeWorkspaceId = defaultWorkspace.id;
        }
        
        // Reset kanban loaded flag to force reload after sync
        isKanbanLoaded = false;
        await loadActiveWorkspaceData();
        
        // Set up periodic sync after login
        setupPeriodicSync();
    }
    
    // Save current account data to localStorage before logout
    async function saveAccountDataToLocalStorage(): Promise<void> {
        if (!browser) return;
        
        try {
            await ensureSupabaseLoaded();
            const user = await auth.getUser();
            if (!user) return;
            
            // Get all data for the current user
            const accountData = {
                userId: user.id,
                email: user.email,
                workspaces: workspaces,
                folders: folders,
                notes: notes,
                calendarEvents: calendarEvents,
                kanban: kanban,
                activeWorkspaceId: activeWorkspaceId,
                timestamp: Date.now()
            };
            
            // Save to localStorage with user ID as key
            const storageKey = `neuronotes_account_${user.id}`;
            localStorage.setItem(storageKey, JSON.stringify(accountData));
            console.log('[auth] Saved account data to localStorage before logout');
        } catch (error) {
            console.error('[auth] Failed to save account data to localStorage:', error);
        }
    }
    
    function validateEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    function validatePassword(password: string): boolean {
        return password.length >= 8;
    }
    
    
    async function importData(data: {
        workspaces?: Workspace[];
        folders?: Folder[];
        notes?: Note[];
        calendarEvents?: CalendarEvent[];
        kanban?: Kanban[];
        settings?: Setting[];
    }) {
        try {
            await db.init();

            if (data.workspaces && data.workspaces.length > 0) {
                console.log('Importing workspaces:', data.workspaces.length);
                for (const workspace of data.workspaces) {
                    await db.putWorkspace(workspace);
                }
            }

            if (data.folders && data.folders.length > 0) {
                console.log('Importing folders:', data.folders.length);
                for (const folder of data.folders) {
                    await db.putFolder(folder);
                }
            }

            if (data.notes && data.notes.length > 0) {
                console.log('Importing notes:', data.notes.length);
                for (const note of data.notes) {
                    // Ensure imported notes have their content properly marked
                    // This prevents putNote from trying to preserve existing content
                    // We set _contentLoaded = true for all imported notes to use backup content (even if empty)
                    const noteWithMeta = note as any;
                    noteWithMeta._contentLoaded = true;
                    
                    // Debug: log note content info
                    if (import.meta.env.DEV) {
                        console.log(`[import] Note ${note.id} (${note.type}): contentHTML length=${note.contentHTML?.length || 0}, has content=${!!note.contentHTML}`);
                    }
                    
                    // For spreadsheets, ensure _spreadsheetJson is set if spreadsheet data exists
                    if (note.type === 'spreadsheet' && note.spreadsheet && !noteWithMeta._spreadsheetJson) {
                        if (typeof note.spreadsheet === 'string') {
                            noteWithMeta._spreadsheetJson = note.spreadsheet;
                        } else {
                            noteWithMeta._spreadsheetJson = JSON.stringify(note.spreadsheet);
                        }
                    }
                    
                    // Ensure contentHTML is explicitly set (even if empty) so putNote uses it
                    if (note.contentHTML === undefined) {
                        note.contentHTML = '';
                    }
                    
                    await db.putNote(note);
                }
            }

            if (data.calendarEvents && data.calendarEvents.length > 0) {
                console.log('Importing calendar events:', data.calendarEvents.length);
                for (const event of data.calendarEvents) {
                    await db.putCalendarEvent(event);
                }
            }

            if (data.kanban && data.kanban.length > 0) {
                console.log('Importing kanban boards:', data.kanban.length);
                for (const kanban of data.kanban) {
                    await db.putKanban(kanban);
                }
            }

            if (data.settings && data.settings.length > 0) {
                console.log('Importing settings:', data.settings.length);
                for (const setting of data.settings) {
                    await db.putSetting(setting);
                }
            }

            console.log('Import completed successfully');
            
            // Reload UI state from database after import
            // This ensures the UI reflects the imported data
            const loadedWorkspaces = await db.getAllWorkspaces();
            if (loadedWorkspaces.length > 0) {
                workspaces = loadedWorkspaces.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                
                // Set active workspace - prefer existing if valid, otherwise use first or last active setting
                const lastActive = await db.getSettingByKey('activeWorkspaceId');
                const preferredWorkspaceId = lastActive?.value;
                
                if (activeWorkspaceId && workspaces.find(w => w.id === activeWorkspaceId)) {
                    // Keep current active workspace if it still exists
                    // activeWorkspaceId stays the same
                } else if (preferredWorkspaceId && workspaces.find(w => w.id === preferredWorkspaceId)) {
                    activeWorkspaceId = preferredWorkspaceId;
                } else {
                    activeWorkspaceId = workspaces[0].id;
                }
                
                // Save the active workspace setting
                await db.putSetting({ key: 'activeWorkspaceId', value: activeWorkspaceId });
            } else {
                // No workspaces after import - create default
                const defaultWorkspace: Workspace = {
                    id: generateUUID(),
                    name: 'My Workspace',
                    order: 0
                };
                await db.putWorkspace(defaultWorkspace);
                workspaces = [defaultWorkspace];
                activeWorkspaceId = defaultWorkspace.id;
                await db.putSetting({ key: 'activeWorkspaceId', value: activeWorkspaceId });
            }
            
            // Reload active workspace data to update UI (this will update notes, folders, calendar, kanban)
            if (activeWorkspaceId) {
                await loadActiveWorkspaceData();
            }
            
            // If logged in, push imported data to Supabase to sync it
            // This ensures the imported data becomes the source of truth in the cloud
            if (isLoggedIn) {
                try {
                    await ensureSupabaseLoaded();
                    await sync.pushToSupabase();
                    console.log('Imported data synced to Supabase');
                } catch (syncError) {
                    console.warn('Failed to sync imported data to Supabase:', syncError);
                    // Don't throw - import was successful, sync can happen later
                }
            }
        } catch (error) {
            console.error('Import error:', error);
            throw error;
        }
    }


    function prevWeek() {
        if (startWithCurrentDay) {
            const newDate = new Date(currentDayViewDate);
            newDate.setDate(newDate.getDate() - 7);
            currentDayViewDate = newDate;
        } else {
            const newDate = new Date(weekStart);
            newDate.setDate(newDate.getDate() - 7);
            weekStart = newDate;
        }
    }
    function nextWeek() {
        if (startWithCurrentDay) {
            const newDate = new Date(currentDayViewDate);
            newDate.setDate(newDate.getDate() + 7);
            currentDayViewDate = newDate;
        } else {
            const newDate = new Date(weekStart);
            newDate.setDate(newDate.getDate() + 7);
            weekStart = newDate;
        }
    }
    
    function goToToday() {
        if (startWithCurrentDay) {
            currentDayViewDate = new Date(today);
        } else {
            weekStart = startOfWeek(today, 1);
        }
    }

    function convertDateToISO(dateStr: string): string | null {
        // Support multiple date formats: D/M/YYYY, D.M.YYYY, DD.MM.YYYY, D-M-YYYY, DD-MM-YYYY, DD/MM/YYYY
        const trimmed = dateStr.trim();
        
        // Try different separators: /, ., -
        let parts: string[] | null = null;
        
        if (trimmed.includes('/')) {
            parts = trimmed.split('/');
        } else if (trimmed.includes('.')) {
            parts = trimmed.split('.');
        } else if (trimmed.includes('-')) {
            parts = trimmed.split('-');
        }
        
        if (!parts || parts.length !== 3) return null;
        
        const [day, month, year] = parts;
        
        // Validate year (must be 4 digits)
        if (year.length !== 4) return null;
        
        const dayNum = parseInt(day, 10);
        const monthNum = parseInt(month, 10);
        const yearNum = parseInt(year, 10);
        
        if (isNaN(dayNum) || isNaN(monthNum) || isNaN(yearNum)) return null;
        if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) return null;
        
        // Validate date (e.g., check if day is valid for the month)
        const date = new Date(yearNum, monthNum - 1, dayNum);
        if (date.getDate() !== dayNum || date.getMonth() !== monthNum - 1 || date.getFullYear() !== yearNum) {
            return null; // Invalid date (e.g., 31/02/2024)
        }
        
        // Return in ISO format: YYYY-MM-DD
        return `${yearNum}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
    }

    function convertISOToDate(isoDate: string): string {
        // Convert YYYY-MM-DD to DD/MM/YYYY
        const [year, month, day] = isoDate.split('-');
        return `${day}/${month}/${year}`;
    }

    function startEditingEvent(event: CalendarEvent, dateKey: string) {
        editingEventId = event.id;
        editingEventDate = dateKey;
        editingEventTitle = event.title;
        editingEventTime = event.time || '';
        // Auto-focus the title input after a brief delay to ensure DOM is updated
        setTimeout(() => {
            const titleInput = document.querySelector('.event-edit-title') as HTMLInputElement;
            if (titleInput) titleInput.focus();
        }, 10);
    }

    function cancelEditingEvent() {
        editingEventId = null;
        editingEventDate = null;
        editingEventTitle = '';
        editingEventTime = '';
    }

    async function saveEditedEvent() {
        if (!editingEventId || !editingEventDate) return;
        
        const event = calendarEvents.find(e => e.id === editingEventId);
        if (!event) {
            cancelEditingEvent();
            return;
        }

        if (!editingEventTitle.trim()) {
            alert('Event title cannot be empty.');
            return;
        }

        // Validate time format if provided
        let formattedTime = editingEventTime.trim();
        if (formattedTime) {
            const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
            if (!timePattern.test(formattedTime)) {
                alert('Invalid time format. Please use HH:MM format (24-hour, e.g., 14:30).');
                return;
            }
            // Ensure two-digit hours
            const [hours, minutes] = formattedTime.split(':');
            formattedTime = `${hours.padStart(2, '0')}:${minutes}`;
        }

        try {
            const updatedEvent: CalendarEvent = {
                ...event,
                title: editingEventTitle.trim(),
                time: formattedTime || undefined
            };
            
            await db.putCalendarEvent(updatedEvent);
            const index = calendarEvents.findIndex((e) => e.id === event.id);
            if (index !== -1) {
                calendarEvents[index] = updatedEvent;
                calendarEvents = [...calendarEvents];
            }
            await syncIfLoggedIn();
            cancelEditingEvent();
        } catch (error) {
            console.error('Failed to update event:', error);
            alert(`Failed to update event: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async function addEvent() {
        if (!newEventTitle.trim() || !newEventDate) {
            console.warn('Cannot add event: missing title or date', { title: newEventTitle, date: newEventDate });
            return;
        }

        if (!activeWorkspaceId) {
            console.error('Cannot add event: no active workspace');
            alert('Please select a workspace first.');
            return;
        }

        // Convert date to ISO format (supports D/M/YYYY, D.M.YYYY, DD.MM.YYYY, D-M-YYYY, DD-MM-YYYY, DD/MM/YYYY)
        const isoDate = convertDateToISO(newEventDate);
        if (!isoDate) {
            alert('Invalid date format. Please use one of these formats: D/M/YYYY, D.M.YYYY, DD.MM.YYYY, D-M-YYYY, DD-MM-YYYY, or DD/MM/YYYY.');
            return;
        }

        // Validate time format (HH:MM)
        let formattedTime = newEventTime.trim();
        if (formattedTime) {
            const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
            if (!timePattern.test(formattedTime)) {
                alert('Invalid time format. Please use HH:MM format (24-hour, e.g., 14:30).');
                return;
            }
            // Ensure two-digit hours
            const [hours, minutes] = formattedTime.split(':');
            formattedTime = `${hours.padStart(2, '0')}:${minutes}`;
        }

        try {
            const newEvent: CalendarEvent = {
                id: generateUUID(),
                date: isoDate,
                title: newEventTitle.trim(),
                time: formattedTime || undefined,
                workspaceId: activeWorkspaceId,
                repeat: newEventRepeat,
                repeatOn: newEventRepeat === 'custom' 
                    ? newEventCustomDays.map((checked, i) => checked ? i + 1 : -1).filter(d => d > 0)
                    : undefined,
                exceptions: [],
                color: newEventColor
            };
            
            console.log('Adding event:', newEvent);
            await db.putCalendarEvent(newEvent);
            calendarEvents = [...calendarEvents, newEvent];
            await syncIfLoggedIn();
            
            // Reset form
            newEventTitle = '';
            newEventTime = '';
            newEventRepeat = 'none';
            newEventCustomDays = [false, false, false, false, false, false, false];
            // Don't reset newEventColor - keep the selected color until page reload
            showRepeatOptions = false;
            
            console.log('Event added successfully');
        } catch (error) {
            console.error('Failed to add event:', error);
            alert(`Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async function toggleCalendarMode() {
        useCommonCalendar = !useCommonCalendar;
        await db.putSetting({
            key: 'useCommonCalendar',
            value: useCommonCalendar
        });
        await loadActiveWorkspaceData();
    }

    async function deleteEvent(event: CalendarEvent, specificDate?: string) {
        if (!event.repeat || event.repeat === 'none') {
            const confirmed = await showDeleteDialog(`Are you sure you want to delete "${event.title}"?`);
            if (confirmed) {
                await db.deleteCalendarEvent(event.id);
                calendarEvents = calendarEvents.filter((e) => e.id !== event.id);
                await syncIfLoggedIn();
            }
        } else {
            const choice = await showDeleteRecurringDialog(event.title);
            
            if (choice === 'this') {
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
                    await syncIfLoggedIn();
                }
            } else if (choice === 'all') {
                await db.deleteCalendarEvent(event.id);
                calendarEvents = calendarEvents.filter((e) => e.id !== event.id);
                await syncIfLoggedIn();
            }
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
            
            // Sanitize message to prevent XSS - strip all HTML, only allow text
            const sanitizedMessage = (browser && DOMPurify) 
                ? DOMPurify.sanitize(message, { ALLOWED_TAGS: [] })
                : message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const sanitizedButtonText = (browser && DOMPurify)
                ? DOMPurify.sanitize(deleteButtonText, { ALLOWED_TAGS: [] })
                : deleteButtonText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
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

    function showDeleteRecurringDialog(title: string): Promise<'this' | 'all' | 'cancel'> {
        return new Promise((resolve) => {
            const message = `"${title}" is a repeating event.\n\nDelete only this occurrence or all future occurrences?`;
            
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
            
            // Sanitize message to prevent XSS - strip all HTML, only allow text
            const sanitizedMessage = (browser && DOMPurify) 
                ? DOMPurify.sanitize(message, { ALLOWED_TAGS: [] })
                : message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            content.innerHTML = `
                <div style="color: var(--text); margin-bottom: 20px; line-height: 1.5; white-space: pre-wrap;">${sanitizedMessage}</div>
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
    let isKanbanLoaded = false;
    let editingColumnId: string | null = null;
    let editingTaskId: string | null = null;
    let draggedTaskInfo: { colId: string; taskId: string } | null = null;
    let kanbanDropTarget: { colId: string; taskIndex: number } | null = null;
    let isDraggingTask = false;
    const debouncedPersistKanban = debounce(async () => {
        if (!activeWorkspaceId) {
            console.log('[kanban] Skipping save - no active workspace');
            return;
        }
        // Only save if kanban exists and has at least one column
        // Empty kanban arrays shouldn't overwrite existing data
        if (!kanban || kanban.length === 0) {
            console.log('[kanban] Skipping save - kanban is empty');
            return;
        }
        try {
            console.log(`[kanban] Saving kanban for workspace ${activeWorkspaceId}:`, kanban.length, 'columns', kanban);
            await db.putKanban({
                workspaceId: activeWorkspaceId,
                columns: kanban
            });
            console.log('[kanban] Saved kanban data to local DB');
            await syncIfLoggedIn();
            console.log('[kanban] Synced kanban to Supabase');
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

    async function loadCalendarEvents() {
        if (isCalendarLoaded || !browser || !activeWorkspaceId) return;
        try {
            if (useCommonCalendar) {
                calendarEvents = await db.getAllCalendarEvents();
            } else {
                calendarEvents = await db.getCalendarEventsByWorkspaceId(activeWorkspaceId);
            }
            isCalendarLoaded = true;
        } catch (e) {
            console.error('Failed to load calendar events:', e);
        }
    }

    async function loadKanbanData(force = false) {
        if ((isKanbanLoaded && !force) || !browser || !activeWorkspaceId) return;
        try {
            console.log(`[kanban] Loading kanban for workspace ${activeWorkspaceId}, force=${force}`);
            const kData = await db.getKanbanByWorkspaceId(activeWorkspaceId);
            console.log(`[kanban] Retrieved from DB:`, kData ? `found ${kData.columns?.length || 0} columns` : 'null');
            kanban = kData ? kData.columns : [];
            isKanbanLoaded = true;
            console.log('[kanban] Loaded kanban data:', kanban.length, 'columns', kanban);
        } catch (e) {
            console.error('Failed to load kanban data:', e);
            isKanbanLoaded = true; // Set to true even on error to prevent infinite retries
        }
    }

    async function loadActiveWorkspaceData() {
        if (!browser || !activeWorkspaceId) return;

        currentFolderId = null;
        isCalendarLoaded = false;
        isKanbanLoaded = false;
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
                    // Sanitize content when loading from database
                    note.contentHTML = (browser && DOMPurify) 
                        ? DOMPurify.sanitize(rawContent)
                        : rawContent;
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

        // Load calendar events and kanban data in parallel
        // Force reload kanban to ensure we get the latest data after sync
        await Promise.all([
            loadCalendarEvents(),
            loadKanbanData(true) // Force reload to ensure we get synced data
        ]);
    }

    onMount(() => {
        if (browser) {
            backup.startAutoBackup();
            // Collapse notes list by default on mobile
            if (window.innerWidth <= 768) {
                isNoteListVisible = false;
            }
        }
        let timer: ReturnType<typeof setInterval> | undefined;

        (async () => {
            // Defer DOMPurify import to improve initial load time
            import('dompurify').then(module => {
                DOMPurify = module.default;
            }).catch(err => {
                console.warn('Failed to load DOMPurify:', err);
            });
            
            // Load Supabase modules dynamically to reduce initial bundle size
            // Only load when needed (auth check or user interaction)
            const loadSupabaseModules = async () => {
                if (!auth) {
                    const authModule = await import('$lib/supabase/auth');
                    auth = authModule;
                    onAuthStateChange = authModule.onAuthStateChange;
                    sync = await import('$lib/supabase/sync');
                    migrations = await import('$lib/supabase/migrations');
                }
            };
            
            await db.init();
            
            // Load Supabase modules after db init but before auth check
            await loadSupabaseModules();
            
            // Track which user's session we've already handled in onMount
            // This prevents the auth state change handler from duplicating the work
            // Must be declared BEFORE we check for session and BEFORE setting up the subscription
            let handledUserIdInOnMount: string | null = null;

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

            const calendarModeSetting = await db.getSettingByKey('useCommonCalendar');
            useCommonCalendar = calendarModeSetting?.value === true;

            // Check if user is already logged in
            // IMPORTANT: We must check for session and set handledUserIdInOnMount BEFORE
            // subscribing to auth state changes, because the subscription might fire immediately
            const session = await auth.getSession();
            if (session) {
                // Get current user ID immediately
                const user = await auth.getUser();
                const sessionUserId = user?.id || null;
                
                // CRITICAL: Mark that we're handling this user's session in onMount
                // This must be set BEFORE subscribing to auth state changes, because
                // the subscription might fire immediately and we need to skip it
                if (sessionUserId) {
                    handledUserIdInOnMount = sessionUserId;
                    console.log(`[onMount] Marking user ${sessionUserId} as handled in onMount`);
                }
                
                isLoggedIn = true;
                hasHandledInitialSession = true;
                
                // Check if this is the same user
                // IMPORTANT: We check currentUserId (from previous session) instead of localStorage
                // because localStorage gets cleared on logout, but currentUserId persists until logout
                // This way we can detect if it's the same user even after logout/login
                const storedUserId = browser ? localStorage.getItem('neuronotes_current_user_id') : null;
                const isSameUser = (currentUserId === sessionUserId) || (storedUserId === sessionUserId);
                
                // Store current user ID
                if (browser && sessionUserId) {
                    localStorage.setItem('neuronotes_current_user_id', sessionUserId);
                }
                currentUserId = sessionUserId;
                
                // Defer heavy sync operations to improve initial load
                setTimeout(async () => {
                    // Flush any pending debounced saves (notes, kanban) before syncing
                    const noteUpdatePromise = debouncedUpdateNote.flush();
                    const kanbanUpdatePromise = debouncedPersistKanban.flush();
                    
                    // Wait for both to complete
                    if (noteUpdatePromise && typeof noteUpdatePromise.then === 'function') {
                        try {
                            await noteUpdatePromise;
                        } catch (e) {
                            console.warn('Note update failed on reload:', e);
                        }
                    }
                    if (kanbanUpdatePromise && typeof kanbanUpdatePromise.then === 'function') {
                        try {
                            await kanbanUpdatePromise;
                        } catch (e) {
                            console.warn('Kanban update failed on reload:', e);
                        }
                    }
                    
                    // Flush any pending database saves before syncing
                    await db.flushDatabaseSave();
                    
                    if (isSameUser) {
                        // Same user - just sync without clearing
                        console.log('[onMount] Same user detected, syncing without clearing...');
                        
                        // Use fullSync which does pull-then-push to ensure we get latest changes
                        // before pushing local changes. This prevents overwriting newer changes from other devices.
                        console.log('[onMount] Performing full sync (pull then push)...');
                        try {
                            await ensureSupabaseLoaded();
                            const syncResult = await sync.fullSync();
                            if (!syncResult.success) {
                                console.error('[onMount] Full sync failed:', syncResult.error);
                            } else {
                                console.log('[onMount] Full sync completed successfully');
                            }
                        } catch (error) {
                            console.warn('[onMount] Failed to sync:', error);
                        }
                    } else {
                        // Different user or first time - clear and pull
                        console.log('[onMount] Different user or first login, clearing and syncing...');
                        console.log(`[onMount] currentUserId: ${currentUserId}, sessionUserId: ${sessionUserId}, storedUserId: ${storedUserId}`);
                        
                        // IMPORTANT: Don't push local changes before clearing when switching users
                        // The local data belongs to a different user, we don't want to mix it
                        // Just clear and pull the new user's data
                        
                        // Clear all local data
                        await db.clearAllLocalData();
                        
                        // Pull latest data from Supabase for the new user
                        console.log('[onMount] Pulling data from Supabase for user:', sessionUserId);
                        const pullResult = await sync.pullFromSupabase();
                        if (!pullResult.success) {
                            console.error('[onMount] Failed to pull data:', pullResult.error);
                        } else {
                            console.log('[onMount] Successfully pulled data from Supabase');
                            await db.flushDatabaseSave();
                            const pulledWorkspaces = await db.getAllWorkspaces();
                            console.log(`[onMount] Pulled ${pulledWorkspaces.length} workspaces`);
                        }
                    }
                    
                    // Reload workspaces after sync
                    let loadedWorkspaces = await db.getAllWorkspaces();
                    if (loadedWorkspaces.length > 0) {
                        workspaces = loadedWorkspaces.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                        const lastActive = await db.getSettingByKey('activeWorkspaceId');
                        activeWorkspaceId =
                            workspaces.find((w) => w.id === lastActive?.value)?.id ?? workspaces[0].id;
                        // Reset kanban loaded flag to force reload after sync
                        isKanbanLoaded = false;
                        await loadActiveWorkspaceData();
                    }
                    
                    // Set up periodic sync after initial load
                    setupPeriodicSync();
                }, 0);
            } else {
                // Load workspace data immediately if not logged in
                await loadActiveWorkspaceData();
            }

            const updateDateTimeDisplay = () => {
                today = new Date();
                todayDateString = `${DAY_NAMES_LONG[today.getDay()]}, ${dmy(today)}`;
                const hours = String(today.getHours()).padStart(2, '0');
                const minutes = String(today.getMinutes()).padStart(2, '0');
                todayTimeString = `${hours}:${minutes}`;
            };

            updateDateTimeDisplay();
            weekStart = startOfWeek(today, 1);
            // Don't set newEventDate - let it be empty so placeholder shows

            timer = setInterval(updateDateTimeDisplay, 60 * 1000);
            
            // Set up periodic sync if already logged in
            if (isLoggedIn) {
                setupPeriodicSync();
            }

            document.addEventListener('selectionchange', updateSelectedFontSize);
            
            // Check for OAuth callback (when user returns from Google)
            const urlParams = new URLSearchParams(window.location.search);
            const code = urlParams.get('code');
            if (code) {
                // OAuth callback detected, close login modal if open
                showLoginModal = false;
                showSignupModal = false;
            }
            
            // Listen for auth state changes
            // IMPORTANT: The subscription might fire immediately with the current session
            // So we must ensure handledUserIdInOnMount is set BEFORE subscribing
            const { data: { subscription } } = onAuthStateChange(async (event, session) => {
                // Capture previousUserId before it changes
                const previousUserId = currentUserId;
                console.log('Auth state changed:', event, session?.user?.email, 'handledUserIdInOnMount:', handledUserIdInOnMount, 'previousUserId:', previousUserId);
                
                if (event === 'SIGNED_IN' && session) {
                    const newUserId = session.user.id;
                    const isSwitchingUsers = previousUserId && previousUserId !== newUserId;
                    
                    // CRITICAL: If onMount already handled this user's session, skip this handler
                    // This prevents duplicate clearing/pulling when Google OAuth redirects back
                    // and both onMount and this handler try to process the same login
                    if (handledUserIdInOnMount === newUserId) {
                        console.log(`[auth-state-change] Skipping - onMount already handled session for user ${newUserId}`);
                        // Still update the state variables
                        isLoggedIn = true;
                        currentUserId = newUserId;
                        if (browser && newUserId) {
                            localStorage.setItem('neuronotes_current_user_id', newUserId);
                        }
                        return;
                    }
                    
                    // If switching to a different user, we need to sync their data
                    // If same user and already handled initial session, skip (to avoid duplicate clearing)
                    if (hasHandledInitialSession && !isSwitchingUsers) {
                        console.log('[auth-state-change] Skipping - already handled initial session for same user');
                        return;
                    }
                    
                    // If switching users, reset the flags so we handle the new user's session
                    if (isSwitchingUsers) {
                        console.log(`[auth-state-change] Switching from user ${previousUserId} to ${newUserId} - will sync new user's data`);
                        hasHandledInitialSession = false;
                        handledUserIdInOnMount = null; // Reset so we can handle the new user
                    }
                    
                    isLoggedIn = true;
                    currentUserId = newUserId;
                    hasHandledInitialSession = true;
                    
                    // Store new user ID
                    if (browser && newUserId) {
                        localStorage.setItem('neuronotes_current_user_id', newUserId);
                    }
                    
                    // Flush any pending database saves before clearing
                    await db.flushDatabaseSave();
                    // Clear all local data before pulling new user's data
                    console.log('Clearing local data for new user...');
                    await db.clearAllLocalData();
                    // IMPORTANT: After clearing local data, we should ONLY pull from Supabase, not push
                    // Using fullSync() would push the empty local state and delete everything from Supabase!
                    console.log('Pulling data from Supabase for user:', newUserId);
                    const pullResult = await sync.pullFromSupabase();
                    if (!pullResult.success) {
                        console.error('Failed to pull data from Supabase:', pullResult.error);
                        alert(`Warning: Failed to restore your data from cloud. Error: ${pullResult.error}`);
                    } else {
                        console.log('Successfully pulled data from Supabase');
                        // Flush database to ensure all pulled data is persisted
                        await db.flushDatabaseSave();
                        // Verify data was pulled by checking workspaces
                        const pulledWorkspaces = await db.getAllWorkspaces();
                        console.log(`Pulled ${pulledWorkspaces.length} workspaces from Supabase`);
                        if (pulledWorkspaces.length === 0) {
                            console.warn('No workspaces found in Supabase for this user - data may not exist in cloud');
                            alert('No data found in cloud for this account. If you had data before, it may have been lost. Please restore from a backup if available.');
                        }
                    }
                    // Clear UI state and reload
                    notes = [];
                    folders = [];
                    calendarEvents = [];
                    kanban = [];
                    selectedNoteId = '';
                    currentFolderId = null;
                    
                    // Reload workspaces and set active workspace
                    let loadedWorkspaces = await db.getAllWorkspaces();
                    if (loadedWorkspaces.length > 0) {
                        workspaces = loadedWorkspaces.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                        activeWorkspaceId = workspaces[0].id;
                    } else {
                        // Create default workspace if none exist
                        const defaultWorkspace: Workspace = {
                            id: generateUUID(),
                            name: 'My Workspace',
                            order: 0
                        };
                        await db.putWorkspace(defaultWorkspace);
                        workspaces = [defaultWorkspace];
                        activeWorkspaceId = defaultWorkspace.id;
                    }
                    
                    // Reset kanban loaded flag to force reload after sync
                    isKanbanLoaded = false;
                    await loadActiveWorkspaceData();
                    
                    // Set up periodic sync after login
                    setupPeriodicSync();
                } else if (event === 'SIGNED_OUT') {
                    // IMPORTANT: Sync data to Supabase before clearing (if we were logged in)
                    // This ensures data is saved when user logs out via Google OAuth or other automatic logout
                    if (isLoggedIn && previousUserId) {
                        try {
                            console.log('[SIGNED_OUT] Syncing data to Supabase before logout...');
                            await db.flushDatabaseSave();
                            await ensureSupabaseLoaded();
                            await sync.pushToSupabase();
                            console.log('[SIGNED_OUT] Data synced successfully');
                        } catch (error) {
                            console.error('[SIGNED_OUT] Failed to sync before logout:', error);
                        }
                    }
                    
                    isLoggedIn = false;
                    const loggedOutUserId = currentUserId;
                    currentUserId = null;
                    // Reset the flags so next login will handle the session
                    hasHandledInitialSession = false;
                    handledUserIdInOnMount = null;
                    // Clear stored user ID
                    if (browser) {
                        localStorage.removeItem('neuronotes_current_user_id');
                    }
                    // Stop periodic sync on logout
                    if (syncInterval) {
                        clearInterval(syncInterval);
                        syncInterval = undefined;
                    }
                    // Clear UI state on logout
                    notes = [];
                    folders = [];
                    calendarEvents = [];
                    kanban = [];
                    selectedNoteId = '';
                    currentFolderId = null;
                    await loadActiveWorkspaceData();
                } else if (event === 'TOKEN_REFRESHED') {
                    // Session refreshed, continue working
                    console.log('Session refreshed');
                }
            });
            
            // Store subscription for cleanup
            (window as any).__authSubscription = subscription;
        })();

        const handleBeforeUnload = () => {
            // Flush pending note updates and sync (synchronously start them)
            debouncedUpdateNote.flush();
            debouncedSyncIfLoggedIn.flush();
            debouncedPersistKanban.flush();
            // Flush database save synchronously to ensure current state is saved
            db.flushDatabaseSave().catch(e => {
                console.warn('Failed to flush database save on unload:', e);
            });
            // Try to sync to Supabase (fire and forget, as beforeunload is synchronous)
            if (isLoggedIn) {
                ensureSupabaseLoaded().then(() => {
                    sync.pushToSupabase().catch(e => {
                        console.warn('Failed to sync to Supabase on beforeunload:', e);
                    });
                }).catch(e => {
                    console.warn('Failed to load Supabase on beforeunload:', e);
                });
            }
        };
        
        const handlePageHide = async (e: PageTransitionEvent) => {
            // pagehide event allows async operations and is more reliable
            // Flush pending note updates and sync, then wait for them
            const noteUpdatePromise = debouncedUpdateNote.flush();
            const syncPromise = debouncedSyncIfLoggedIn.flush();
            debouncedPersistKanban.flush();
            
            // Wait for note updates to complete, then flush database save
            if (noteUpdatePromise && typeof noteUpdatePromise.then === 'function') {
                try {
                    await noteUpdatePromise;
                } catch (e) {
                    console.warn('Note update failed on page hide:', e);
                }
            }
            
            // Wait for sync to complete
            if (syncPromise && typeof syncPromise.then === 'function') {
                try {
                    await syncPromise;
                } catch (e) {
                    console.warn('Sync failed on page hide:', e);
                }
            }
            
            // Ensure database is saved after note updates complete
            try {
                await db.flushDatabaseSave();
            } catch (e) {
                console.warn('Failed to flush database save on page hide:', e);
            }
            
            // Explicitly sync to Supabase after all updates are saved
            // This ensures changes are synced even if the debounced sync didn't fire
            if (isLoggedIn) {
                try {
                    await ensureSupabaseLoaded();
                    const syncResult = await sync.pushToSupabase();
                    if (syncResult.success) {
                        console.log('Successfully synced to Supabase on page hide');
                    } else {
                        console.warn('Failed to sync to Supabase on page hide:', syncResult.error);
                    }
                } catch (e) {
                    console.warn('Error syncing to Supabase on page hide:', e);
                }
            }
        };
        
        if (browser) {
            window.addEventListener('beforeunload', handleBeforeUnload);
            window.addEventListener('pagehide', handlePageHide);
        }

        return () => {
            document.removeEventListener('selectionchange', updateSelectedFontSize);
            if (timer) clearInterval(timer);
            cleanupResizeListeners();
            debouncedUpdateNote.flush();
            debouncedSyncIfLoggedIn.flush();
            debouncedPersistKanban.flush();
            
            // Cleanup auth subscription
            if ((window as any).__authSubscription) {
                (window as any).__authSubscription.unsubscribe();
                delete (window as any).__authSubscription;
            }
            if (browser) {
                window.removeEventListener('beforeunload', handleBeforeUnload);
                window.removeEventListener('pagehide', handlePageHide);
            }
        };
    });
</script>

<div class="app">
    <NavigationBar
        {workspaces}
        {activeWorkspaceId}
        {isLoggedIn}
        {editingWorkspaceId}
        {draggedWorkspaceId}
        {showSettingsDropdown}
        onSwitchWorkspace={switchWorkspace}
        onAddWorkspace={addWorkspace}
        onRenameWorkspace={renameWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onWorkspaceDragStart={handleWorkspaceDragStart}
        onWorkspaceDrop={handleWorkspaceDrop}
        onWorkspaceDragEnd={handleWorkspaceDragEnd}
        onSetEditingWorkspaceId={(id) => editingWorkspaceId = id}
        onShowLoginModal={() => showLoginModal = true}
        onLogout={async () => {
            await ensureSupabaseLoaded();
            // Sync current account data to Supabase before logout
            if (isLoggedIn) {
                try {
                    await db.flushDatabaseSave();
                    await sync.pushToSupabase();
                    console.log('[logout] Synced data to Supabase before logout');
                } catch (error) {
                    console.error('[logout] Failed to sync before logout:', error);
                }
            }
            // Save current account data to localStorage before logout
            await saveAccountDataToLocalStorage();
            
            const result = await auth.signOut();
            if (result.success) {
                isLoggedIn = false;
                currentUserId = null;
                // Clear stored user ID
                if (browser) {
                    localStorage.removeItem('neuronotes_current_user_id');
                }
                // Clear UI state on logout
                notes = [];
                folders = [];
                calendarEvents = [];
                kanban = [];
                selectedNoteId = '';
                currentFolderId = null;
                // Reload workspace data (will load from local DB)
                await loadActiveWorkspaceData();
            }
        }}
        onToggleSettingsDropdown={() => showSettingsDropdown = !showSettingsDropdown}
        onShowBackupModal={() => showBackupModal = true}
        onShowEditPanelsModal={() => showEditPanelsModal = true}
    />

    <BackupModal
        open={showBackupModal}
        isLoggedIn={isLoggedIn}
        onClose={() => showBackupModal = false}
        onRestore={async () => {
            // Reload UI state from database after restore
            const loadedWorkspaces = await db.getAllWorkspaces();
            if (loadedWorkspaces.length > 0) {
                workspaces = loadedWorkspaces.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                
                // Set active workspace - prefer existing if valid, otherwise use first or last active setting
                const lastActive = await db.getSettingByKey('activeWorkspaceId');
                const preferredWorkspaceId = lastActive?.value;
                
                if (activeWorkspaceId && workspaces.find(w => w.id === activeWorkspaceId)) {
                    // Keep current active workspace if it still exists
                    // activeWorkspaceId stays the same
                } else if (preferredWorkspaceId && workspaces.find(w => w.id === preferredWorkspaceId)) {
                    activeWorkspaceId = preferredWorkspaceId;
                                } else {
                    activeWorkspaceId = workspaces[0].id;
                }
                
                // Save the active workspace setting
                await db.putSetting({ key: 'activeWorkspaceId', value: activeWorkspaceId });
                                } else {
                // No workspaces after restore - create default
                                    const defaultWorkspace: Workspace = {
                                        id: generateUUID(),
                                        name: 'My Workspace',
                                        order: 0
                                    };
                                    await db.putWorkspace(defaultWorkspace);
                                    workspaces = [defaultWorkspace];
                                    activeWorkspaceId = defaultWorkspace.id;
                await db.putSetting({ key: 'activeWorkspaceId', value: activeWorkspaceId });
                                }
                                
            // Reload active workspace data to update UI (this will update notes, folders, calendar, kanban)
            if (activeWorkspaceId) {
                                await loadActiveWorkspaceData();
            }
        }}
        showDeleteDialog={showDeleteDialog}
        ensureSupabaseLoaded={ensureSupabaseLoaded}
        sync={sync}
    />

    <LoginModal
        open={showLoginModal}
        bind:loginEmail
        bind:loginPassword
        bind:rememberMe
        bind:isEmailInvalid
        onClose={() => showLoginModal = false}
        onOpenSignup={() => {
                                showLoginModal = false;
                                showSignupModal = true;
        }}
        onLoginSuccess={handleLoginSuccess}
    />

    <SignupModal
        open={showSignupModal}
        bind:signupEmail
        bind:signupPassword
        bind:signupRepeatPassword
        bind:isSignupEmailInvalid
        bind:isPasswordMismatch
        bind:isPasswordInvalid
        onClose={() => showSignupModal = false}
        onOpenLogin={() => {
                            showSignupModal = false;
            showLoginModal = true;
        }}
        onSignupSuccess={handleLoginSuccess}
    />

    <EditPanelsModal
        open={showEditPanelsModal}
        bind:showNotes
        bind:showCalendar
        bind:showKanban
        onClose={() => showEditPanelsModal = false}
        onDone={() => {
            if (!showNotes) {
                isNotesMinimized = false;
            }
            if (!showCalendar) {
                isCalendarMinimized = false;
            }
            if (!showKanban) {
                isKanbanMinimized = false;
            }
        }}
    />

    <div
        class="main"
        class:notes-maximized={notesPanelWidth > 90}
        class:blurred={showLoginModal || showSignupModal || showEditPanelsModal}
        class:notes-only={showNotes && !showCalendar && !showKanban}
        class:calendar-only={!showNotes && showCalendar && !showKanban}
        class:kanban-only={!showNotes && !showCalendar && showKanban}
        class:notes-calendar={showNotes && showCalendar && !showKanban}
        class:notes-kanban={showNotes && !showCalendar && showKanban}
        class:calendar-kanban={!showNotes && showCalendar && showKanban}
        style="--notes-width: {notesPanelWidth}%; --calendar-height: {calendarPanelHeight}%"
    >
        {#if showNotes}
        <section
            class="panel notes-panel"
            class:minimized={isNotesMinimized}
            bind:clientWidth={notesPanelClientWidth}
            style="max-width: 100%; overflow: hidden;"
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
                                                // When spreadsheet component updates, get the latest data from parsedCurrentNote
                                                // The bind:spreadsheetData={parsedCurrentNote.spreadsheet} updates parsedCurrentNote.spreadsheet
                                                if (currentNote && currentNote.type === 'spreadsheet') {
                                                    // Get the latest spreadsheet data from parsedCurrentNote (updated via bind)
                                                    const latestSpreadsheet = parsedCurrentNote?.spreadsheet;
                                                    
                                                    if (latestSpreadsheet) {
                                                        console.log('[spreadsheet update] Saving spreadsheet data for note', currentNote.id);
                                                        
                                                        // Update the note in the array immediately so UI reflects changes
                                                        const index = notes.findIndex((n) => n.id === currentNote.id);
                                                        if (index !== -1) {
                                                            // Also update the note's _spreadsheetJson to keep it in sync
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
                                                        
                                                        // Create note object with latest spreadsheet data for saving
                                                        const noteWithLatestData = {
                                                            ...currentNote,
                                                            spreadsheet: latestSpreadsheet
                                                        };
                                                        
                                                        // Use debouncedUpdateNote which will handle saving, reloading, and syncing
                                                        debouncedUpdateNote(noteWithLatestData);
                                                    } else {
                                                        console.warn('[spreadsheet update] No spreadsheet data found in parsedCurrentNote for note', currentNote.id, 'parsedCurrentNote:', parsedCurrentNote);
                                                    }
                                                } else {
                                                    if (!currentNote) console.warn('[spreadsheet update] No currentNote');
                                                    if (currentNote && currentNote.type !== 'spreadsheet') console.warn('[spreadsheet update] Note is not a spreadsheet:', currentNote.type);
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
                                                    // Update currentNote.contentHTML from editor
                                                    currentNote.contentHTML = editorDiv.innerHTML;
                                                    debouncedSaveNoteHistory(currentNote.id, editorDiv.innerHTML);
                                                    debouncedUpdateNote(currentNote);
                                                }
                                            }}
                                            on:paste={handlePlainTextPaste}
                                            on:keydown={(e) => {
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
                                                    // Check if current line has a checkbox
                                                    const selection = window.getSelection();
                                                    if (selection && selection.rangeCount > 0) {
                                                        const range = selection.getRangeAt(0);
                                                        const container = range.commonAncestorContainer;
                                                        
                                                        // Find the current line/block element
                                                        let lineElement = container.nodeType === Node.TEXT_NODE 
                                                            ? container.parentElement 
                                                            : container as Element;
                                                        
                                                        // Walk up to find the block element (div, p, or the editor itself)
                                                        while (lineElement && lineElement !== editorDiv && 
                                                               lineElement.nodeName !== 'DIV' && 
                                                               lineElement.nodeName !== 'P' &&
                                                               lineElement.nodeName !== 'BR') {
                                                            lineElement = lineElement.parentElement;
                                                        }
                                                        
                                                        // Check if this line contains a checkbox
                                                        let hasCheckbox = false;
                                                        
                                                        if (lineElement) {
                                                            hasCheckbox = lineElement.querySelector('.note-checkbox') !== null;
                                                        }
                                                        
                                                        // Also check if we're right after a checkbox
                                                        const node = range.startContainer;
                                                        const offset = range.startOffset;
                                                        
                                                        // Check if we're immediately after a checkbox
                                                        if (node.nodeType === Node.TEXT_NODE && offset === 0) {
                                                            const prevSibling = node.previousSibling;
                                                            if (prevSibling && prevSibling.nodeName === 'INPUT' && 
                                                                (prevSibling as HTMLInputElement).type === 'checkbox') {
                                                                hasCheckbox = true;
                                                            }
                                                        } else if (node.nodeType === Node.TEXT_NODE) {
                                                            // Check previous siblings
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
                                                        
                                                        // Also check the current container and its parents for checkboxes
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
                                                            
                                                            // Insert a line break
                                                            const br = document.createElement('br');
                                                            range.insertNode(br);
                                                            
                                                            // Create a new checkbox
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
                                                            
                                                            // Insert checkbox after the line break
                                                            range.setStartAfter(br);
                                                            range.setEndAfter(br);
                                                            range.insertNode(checkbox);
                                                            
                                                            // Insert space after checkbox
                                                            const space = document.createTextNode(' ');
                                                            range.setStartAfter(checkbox);
                                                            range.setEndAfter(checkbox);
                                                            range.insertNode(space);
                                                            
                                                            // Position cursor after the space
                                                            range.setStartAfter(space);
                                                            range.setEndAfter(space);
                                                            range.collapse(true);
                                                            
                                                            selection.removeAllRanges();
                                                            selection.addRange(range);
                                                            
                                                            // Trigger input event to save
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
        {/if}

        {#if showNotes && (showCalendar || showKanban)}
        <div class="resizer-wrapper vertical" on:mousedown={startVerticalResize} title="Resize">
            <div class="panel-resizer-pill">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        </div>
        {/if}

        {#if !showNotes && showCalendar && showKanban}
            {#if showCalendar}
            <div class="panel calendar-panel" class:minimized={isCalendarMinimized}>
                <div class="panel-header">
                    <div class="panel-title today-header">
                        <span class="date">{todayDateString}</span>
                        <span class="time">{todayTimeString}</span>
                    </div>
                    <div class="spacer"></div>
                    {#if browser && !isCalendarMinimized}
                        <div class="calendar-controls">
                            <button 
                                class="small-btn" 
                                class:active={useCommonCalendar}
                                on:click={toggleCalendarMode}
                                title={useCommonCalendar ? 'Common calendar (all workspaces)' : 'Workspace-specific calendar'}
                            >
                                {@html useCommonCalendar ? GlobeIcon : FolderIcon}
                            </button>
                            <button class="small-btn" on:click={prevWeek}>&larr; <span class="btn-text">Prev</span></button>
                            <button
                                class="small-btn"
                                on:click={() => (weekStart = startOfWeek(today, 1))}
                            >
                                Today
                            </button>
                            <button class="small-btn" on:click={nextWeek}><span class="btn-text">Next</span> &rarr;</button>
                            <button
                                class="small-btn"
                                class:active={startWithCurrentDay}
                                on:click={() => (startWithCurrentDay = !startWithCurrentDay)}
                                title={startWithCurrentDay ? 'Start week with Monday' : 'Start week with current day'}
                            >
                                {startWithCurrentDay ? 'Mon' : 'Today'}
                            </button>
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
                                        class:event-no-time={!ev.time}
                                        title={ev.title}
                                        style="background: {ev.color ? hexToRgba(ev.color, 0.2) : 'rgba(140, 122, 230, 0.2)'}; border-color: {ev.color || 'var(--accent-purple)'};"
                                        on:dblclick={() => startEditingEvent(ev, ymd(d))}
                                    >
                                        {#if editingEventId === ev.id && editingEventDate === ymd(d)}
                                            <div class="event-details event-editing">
                                                <input
                                                    type="text"
                                                    class="event-edit-time"
                                                    bind:value={editingEventTime}
                                                    placeholder="HH:MM"
                                                    style="border-color: {ev.color || 'var(--accent-purple)'};"
                                                    on:keydown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            saveEditedEvent();
                                                        }
                                                        if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelEditingEvent();
                                                        }
                                                    }}
                                                    on:focus={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = `0 0 0 1px ${color}`;
                                                    }}
                                                    on:blur={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = 'none';
                                                    }}
                                                />
                                                <input
                                                    type="text"
                                                    class="event-edit-title"
                                                    bind:value={editingEventTitle}
                                                    placeholder="Event title"
                                                    style="border-color: {ev.color || 'var(--accent-purple)'};"
                                                    on:keydown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            saveEditedEvent();
                                                        }
                                                        if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelEditingEvent();
                                                        }
                                                    }}
                                                    on:focus={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = `0 0 0 1px ${color}`;
                                                    }}
                                                    on:blur={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = 'none';
                                                    }}
                                                />
                                            </div>
                                        {:else}
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
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/each}
                    </div>

                    <div class="calendar-add">
                        <input 
                            type="text" 
                            bind:value={newEventDate} 
                            placeholder={dmy(today).replace(/-/g, '/')}
                            aria-label="Event date"
                            pattern="\d{2}/\d{2}/\d{4}"
                        />
                        <input 
                            type="text" 
                            bind:value={newEventTime} 
                            placeholder="HH:MM"
                            aria-label="Event time"
                            pattern="([0-1]?[0-9]|2[0-3]):[0-5][0-9]"
                        />
                        <input
                            type="text"
                            bind:value={newEventTitle}
                            placeholder="Title"
                            aria-label="Event title"
                            on:keydown={(e) => {
                                if (e.key === 'Enter' && !showRepeatOptions) addEvent();
                            }}
                        />
                        <button
                            type="button"
                            class="color-cycle-btn"
                            style="background-color: {newEventColor};"
                            on:click={cycleEventColor}
                            aria-label="Event color"
                            title="Click to cycle through colors"
                        ></button>
                        <button 
                            class="small-btn" 
                            class:active={showRepeatOptions}
                            on:click={() => showRepeatOptions = !showRepeatOptions}
                            title="Repeat options"
                        >
                            {@html RepeatIcon}
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
            {/if}

            {#if showCalendar && showKanban}
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
            {/if}

            {#if showKanban}
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
            {/if}
        {:else if showCalendar || showKanban}
        <section
            class="right"
            class:calendar-minimized={isCalendarMinimized}
            class:kanban-minimized={isKanbanMinimized}
            class:single-panel={(showCalendar && !showKanban) || (!showCalendar && showKanban)}
        >
            {#if showCalendar}
            <div class="panel calendar-panel" class:minimized={isCalendarMinimized}>
                <div class="panel-header">
                    <div class="panel-title today-header">
                        <span class="date">{todayDateString}</span>
                        <span class="time">{todayTimeString}</span>
                    </div>
                    <div class="spacer"></div>
                    {#if browser && !isCalendarMinimized}
                        <div class="calendar-controls">
                            <button 
                                class="small-btn" 
                                class:active={useCommonCalendar}
                                on:click={toggleCalendarMode}
                                title={useCommonCalendar ? 'Common calendar (all workspaces)' : 'Workspace-specific calendar'}
                            >
                                {@html useCommonCalendar ? GlobeIcon : FolderIcon}
                            </button>
                            <button class="small-btn" on:click={prevWeek}>&larr; <span class="btn-text">Prev</span></button>
                            <button
                                class="small-btn"
                                on:click={goToToday}
                            >
                                Today
                            </button>
                            <button class="small-btn" on:click={nextWeek}><span class="btn-text">Next</span> &rarr;</button>
                            <button
                                class="small-btn"
                                class:active={startWithCurrentDay}
                                on:click={() => {
                                    startWithCurrentDay = !startWithCurrentDay;
                                    if (startWithCurrentDay) {
                                        currentDayViewDate = new Date(today);
                                    } else {
                                        weekStart = startOfWeek(today, 1);
                                    }
                                }}
                                title={startWithCurrentDay ? 'Start week with Monday' : 'Start week with current day'}
                            >
                                {startWithCurrentDay ? 'Mon' : 'Today'}
                            </button>
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
                                        class:event-no-time={!ev.time}
                                        title={ev.title}
                                        style="background: {ev.color ? hexToRgba(ev.color, 0.2) : 'rgba(140, 122, 230, 0.2)'}; border-color: {ev.color || 'var(--accent-purple)'};"
                                        on:dblclick={() => startEditingEvent(ev, ymd(d))}
                                    >
                                        {#if editingEventId === ev.id && editingEventDate === ymd(d)}
                                            <div class="event-details event-editing">
                                                <input
                                                    type="text"
                                                    class="event-edit-time"
                                                    bind:value={editingEventTime}
                                                    placeholder="HH:MM"
                                                    style="border-color: {ev.color || 'var(--accent-purple)'};"
                                                    on:keydown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            saveEditedEvent();
                                                        }
                                                        if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelEditingEvent();
                                                        }
                                                    }}
                                                    on:focus={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = `0 0 0 1px ${color}`;
                                                    }}
                                                    on:blur={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = 'none';
                                                    }}
                                                />
                                                <input
                                                    type="text"
                                                    class="event-edit-title"
                                                    bind:value={editingEventTitle}
                                                    placeholder="Event title"
                                                    style="border-color: {ev.color || 'var(--accent-purple)'};"
                                                    on:keydown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            saveEditedEvent();
                                                        }
                                                        if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelEditingEvent();
                                                        }
                                                    }}
                                                    on:focus={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = `0 0 0 1px ${color}`;
                                                    }}
                                                    on:blur={(e) => {
                                                        const color = ev.color || 'var(--accent-purple)';
                                                        e.currentTarget.style.borderColor = color;
                                                        e.currentTarget.style.boxShadow = 'none';
                                                    }}
                                                />
                                            </div>
                                        {:else}
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
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/each}
                    </div>

                    <div class="calendar-add">
                        <input 
                            type="text" 
                            bind:value={newEventDate} 
                            placeholder={dmy(today).replace(/-/g, '/')}
                            aria-label="Event date"
                            pattern="\d{2}/\d{2}/\d{4}"
                        />
                        <input 
                            type="text" 
                            bind:value={newEventTime} 
                            placeholder="HH:MM"
                            aria-label="Event time"
                            pattern="([0-1]?[0-9]|2[0-3]):[0-5][0-9]"
                        />
                        <input
                            type="text"
                            bind:value={newEventTitle}
                            placeholder="Title"
                            aria-label="Event title"
                            on:keydown={(e) => {
                                if (e.key === 'Enter' && !showRepeatOptions) addEvent();
                            }}
                        />
                        <button
                            type="button"
                            class="color-cycle-btn"
                            style="background-color: {newEventColor};"
                            on:click={cycleEventColor}
                            aria-label="Event color"
                            title="Click to cycle through colors"
                        ></button>
                        <button 
                            class="small-btn" 
                            class:active={showRepeatOptions}
                            on:click={() => showRepeatOptions = !showRepeatOptions}
                            title="Repeat options"
                        >
                            {@html RepeatIcon}
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
            {/if}

            {#if showCalendar && showKanban}
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
            {/if}

            {#if showKanban}
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
            {/if}
        </section>
        {/if}
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
        position: relative;
        z-index: 10002;
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

    .main.blurred {
        filter: blur(4px);
        pointer-events: none;
        user-select: none;
    }


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
        max-width: 800px;
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

    .folder-icon {
        display: inline-flex;
        align-items: center;
        width: 16px;
        height: 16px;
        margin-right: 4px;
        vertical-align: middle;
    }

    .folder-icon svg {
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
        grid-template-columns: var(--notes-width) 24px 1fr;
        gap: 0;
        padding: 24px;
    }
    
    .main.notes-only {
        grid-template-columns: 1fr;
    }
    
    .main.calendar-only,
    .main.kanban-only {
        grid-template-columns: 1fr;
    }
    
    .main.notes-calendar,
    .main.notes-kanban {
        grid-template-columns: var(--notes-width, 50%) 24px 1fr;
    }
    
    .main.calendar-kanban {
        grid-template-rows: var(--calendar-height, 50%) 24px 1fr;
        grid-template-columns: 1fr;
    }
    
    .main.calendar-kanban > .resizer-wrapper.horizontal {
        grid-row: 2;
        overflow: visible;
    }
    
    .main.calendar-kanban .right {
        display: grid;
        grid-template-columns: 1fr 24px 1fr;
        grid-template-rows: 1fr;
    }
    
    .right.calendar-kanban-only {
        display: grid !important;
        grid-template-columns: 1fr 24px 1fr !important;
        grid-template-rows: 1fr !important;
    }
    
    .right.calendar-kanban-only .panel {
        grid-column: auto;
        grid-row: 1;
    }
    
    .right.calendar-kanban-only .resizer-wrapper.horizontal {
        grid-column: auto;
        grid-row: 1;
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
        margin-right: 0;
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
        margin-right: 0;
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

    .right {
        display: grid;
        grid-template-rows: var(--calendar-height, 50%) 24px 1fr;
        gap: 0;
        height: 100%;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        position: relative;
    }
    
    .right > .resizer-wrapper.horizontal {
        grid-row: 2;
        overflow: visible;
    }
    
    .right.single-panel {
        grid-template-rows: 1fr !important;
    }
    
    .right.single-panel .resizer-wrapper.horizontal {
        display: none !important;
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
    .event.event-no-time {
        padding: 3px 4px 1px 5px;
        font-size: 11px;
        line-height: 1.3;
        min-height: auto;
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
    .color-cycle-btn {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        cursor: pointer;
        flex-shrink: 0;
        transition: transform 0.1s, opacity 0.2s;
    }
    .color-cycle-btn:hover {
        transform: scale(1.05);
        opacity: 0.9;
    }
    .color-cycle-btn:active {
        transform: scale(0.95);
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
    .event-editing {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
    }
    .event-edit-time,
    .event-edit-title {
        background: var(--panel-bg);
        border: 1px solid var(--accent-purple);
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 11px;
        color: var(--text);
        font-family: var(--font-sans);
        width: 100%;
    }
    .event-edit-time {
        width: 50px;
        flex-shrink: 0;
    }
    .event-edit-title {
        flex: 1;
        min-width: 0;
    }
    .event-edit-time:focus,
    .event-edit-title:focus {
        outline: none;
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
        margin-right: 0;
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
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }
    .small-btn svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
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
    .panel-minimize-btn svg {
        width: 16px;
        height: 16px;
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
    .kanban-col-collapse-btn svg {
        width: 14px;
        height: 14px;
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

    @media (max-width: 1200px) {
        .app {
            overflow: hidden;
            height: 100vh;
        }
        .main {
            grid-template-columns: 1fr;
            grid-template-rows: min-content min-content;
            gap: 12px;
            overflow-y: auto;
            overflow-x: hidden;
            scroll-behavior: smooth;
            flex: 1 1 auto;
            min-height: 0;
            max-height: calc(100vh - 50px);
        }
        .main::-webkit-scrollbar {
            display: none;
        }
        .main {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
        .main .resizer-wrapper {
            display: none !important;
        }
        .panel {
            min-height: 400px;
            height: auto;
            flex-shrink: 0;
        }
        .right {
            display: flex;
            flex-direction: column;
            gap: 12px;
            height: auto;
            min-height: min-content;
        }
        .right .resizer-wrapper.horizontal {
            display: none !important;
        }
        .right .panel {
            flex-shrink: 0;
            min-height: 400px;
        }
    }

    @media (max-width: 768px) {
        .app {
            overflow: hidden;
            height: 100vh;
        }
        .main {
            padding: 12px;
            gap: 12px;
            grid-template-rows: min-content min-content;
            flex: 1 1 auto;
            min-height: 0;
            max-height: calc(100vh - 50px);
        }
        .main::-webkit-scrollbar {
            display: none;
        }
        .main {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
        .main .resizer-wrapper {
            display: none !important;
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
        .auth-container {
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
        .workspace-tabs {
            overflow-x: auto;
            flex: 1;
            min-width: 0;
        }
        .notes {
            grid-template-columns: 1fr;
            grid-template-rows: auto minmax(0, 1fr);
        }
        .note-list {
            border-right: none;
            border-bottom: 1px solid var(--border);
            max-height: 300px;
        }
        .right {
            display: flex;
            flex-direction: column;
            gap: 12px;
            flex: 1;
            min-height: 0;
        }
        .right .resizer-wrapper.horizontal {
            display: none !important;
        }
        .right .panel {
            flex-shrink: 0;
            min-height: 300px;
        }
        .panel {
            min-height: 300px;
            height: auto;
            flex-shrink: 0;
        }
        .notes-panel {
            flex: 1;
            min-height: 300px;
            height: auto;
        }
        .notes-panel.minimized {
            min-height: 0;
            flex: 0 0 auto;
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
            justify-content: center;
        }
        .calendar-add input[type='text'] {
            flex-basis: auto;
            min-width: 120px;
        }
        .calendar-add input[type='text'] {
            min-width: 60px;
            flex: 0 0 60px;
        }
        .panel-header {
            padding: 8px 12px;
        }
        .notes-panel .panel-header .panel-title {
            display: none;
        }
        .notes-panel .panel-header {
            justify-content: center;
        }
        .notes-panel .panel-header .spacer {
            display: none;
        }
        .notes-panel.minimized {
            min-height: 0;
            height: auto;
        }
        .toolbar-container {
            position: relative;
            min-height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .toggle-notelist-btn {
            display: none !important;
        }
        .toggle-notelist-btn-header {
            display: flex !important;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            flex-shrink: 0;
        }
        .calendar-panel .panel-header {
            padding: 16px 12px;
            min-height: 64px;
            max-height: none;
        }
        .calendar-panel:not(.minimized) {
            padding: 12px;
            display: flex;
            flex-direction: column;
        }
        .calendar-panel:not(.minimized) .calendar-grid {
            margin-top: 8px;
            margin-bottom: 8px;
        }
        .calendar-controls .small-btn .btn-text {
            display: none;
        }
        .panel-title {
            font-size: 14px;
        }
        .small-btn {
            padding: 4px 8px;
            font-size: 11px;
        }
        .contenteditable {
            min-height: 280px;
        }
    }

    .resizer-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        position: relative;
        pointer-events: auto;
        isolation: isolate;
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
    }
    .resizer-wrapper.vertical {
        cursor: col-resize;
        width: 100%;
        height: 100%;
        min-width: 24px;
    }
    .resizer-wrapper.horizontal {
        cursor: row-resize;
        width: 100%;
        height: 100%;
        min-height: 24px;
        background: transparent;
        position: relative;
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
    }
    .panel-resizer-pill {
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-evenly;
        transition: background-color 0.2s;
        border-radius: 8px;
        pointer-events: auto;
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

    /* Prevent iOS zoom on input focus by using 16px font-size and scaling down visually */
    @media (max-width: 768px) {
        .calendar-add input {
            font-size: 16px !important;
            transform: scale(0.75);
            transform-origin: left center;
        }
        .folder-item input,
        .note-item input {
            font-size: 16px !important;
            transform: scale(0.875);
            transform-origin: left center;
        }
        .kanban-task input {
            font-size: 16px !important;
            transform: scale(0.875);
            transform-origin: left center;
        }
        .kanban-actions input {
            font-size: 16px !important;
        }
    }
</style>