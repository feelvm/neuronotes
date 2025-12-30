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
        handlePlainTextPaste,
        linkifyEditor
    } from '$lib/utils/textFormatting';
    import { convertToWebP, blobToDataUrl } from '$lib/utils/image';
    import { uploadNoteImageWebP, deleteNoteImage } from '$lib/supabase/storage';
    import * as syncModule from '$lib/supabase/sync';
    import { supabase, isSupabaseConfigured } from '$lib/supabase/client';
    import WorkspaceModal from '$lib/components/WorkspaceModal.svelte';
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
    
    // Helper function to sanitize HTML while preserving link, checkbox, and image attributes
    function sanitizeHTML(html: string): string {
        if (!browser || !DOMPurify) return html;
        // Configure DOMPurify to allow target and rel on anchor tags, checkbox attributes, and safe image attributes
        // Use KEEP_CONTENT to preserve all content
        return DOMPurify.sanitize(html, {
            ADD_ATTR: ['target', 'rel'],
            ALLOWED_ATTR: [
                'href',
                'target',
                'rel',
                'class',
                'style',
                'src',
                'alt',
                'width',
                'height',
                'data-image-path',
                'data-image-src',
                'data-rotation',
                // Allow checkbox-related attributes so they keep working after sanitization
                'type',
                'checked'
            ],
            ALLOWED_TAGS: [
                'a',
                'p',
                'br',
                'strong',
                'em',
                'u',
                'span',
                'div',
                'ul',
                'ol',
                'li',
                'input',
                'b',
                'i',
                'img'
            ]
        });
    }

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
    let showFolderModal = false;
    let folderName = '';
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
    let showCurrencyDropdown = false;
    let currencyDropdownJustOpened = false;
    let currencyDropdownWrapper: HTMLElement;
    let sheetSelection: {
        start: { row: number; col: number };
        end: { row: number; col: number };
    } | null = null;
    let imageFileInput: HTMLInputElement;
    let isInsertingImage = false;
    let imageInsertError: string | null = null;

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
    // Use separate reactive statements to avoid cycle - don't update notes inside this block
    $: {
        let items: DisplayItem[] = [];
        if (activeWorkspaceId) {
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
                // Combine folders and notes, then sort by order to allow interleaving
                items = [...allFolders, ...rootNotes];
            } else {
                items = notes
                    .filter((n) => n.folderId === currentFolderId && n.workspaceId === activeWorkspaceId)
                    .map((n) => ({ ...n, displayType: 'note' as const }));
            }
            // Sort by order to allow folders and notes to be interleaved
            displayList = items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        } else {
            displayList = [];
        }
    }

    $: currentFolder = folders.find((f) => f.id === currentFolderId);
    $: currentNote = notes.find((n) => n.id === selectedNoteId) ?? null;
    
    // Sanitized content for contenteditable to prevent XSS
    $: sanitizedNoteContent = currentNote && currentNote.type === 'text' && browser && DOMPurify
        ? sanitizeHTML(currentNote.contentHTML || '')
        : (currentNote?.contentHTML || '');
    
    // Helper function to update note content without triggering reactive cycle
    function updateNoteContent(noteId: string, content: string) {
        const noteIndex = notes.findIndex((n) => n.id === noteId);
        if (noteIndex !== -1) {
            const updatedNotes = [...notes];
            updatedNotes[noteIndex] = { ...updatedNotes[noteIndex], contentHTML: content };
            notes = updatedNotes;
        }
    }
    
    /**
     * Initialize drag/resize/rotate behavior for any image wrappers
     * present in the current editor content.
     */
    function initializeImageInteractions() {
        if (!browser || !editorDiv) return;

        // Helper to visually mark a single image as active (show handles)
        function setActiveWrapper(active: HTMLElement | null) {
            const all = editorDiv.querySelectorAll<HTMLElement>('.note-image-wrapper');
            all.forEach((w) => {
                if (active && w === active) {
                    w.classList.add('is-active');
                } else {
                    w.classList.remove('is-active');
                }
            });
        }

        // Install a one-time handler to clear active image when clicking elsewhere
        const editorAny = editorDiv as any;
        if (!editorAny._imageClickHandlerInstalled) {
            editorDiv.addEventListener('mousedown', (event: MouseEvent) => {
                const target = event.target as HTMLElement;
                if (target.closest('.note-image-wrapper')) {
                    // Clicked on an image wrapper or its handles - let their handlers decide
                    return;
                }
                setActiveWrapper(null);
            });
            editorAny._imageClickHandlerInstalled = true;
        }

        const wrappers = editorDiv.querySelectorAll<HTMLElement>('.note-image-wrapper');
        wrappers.forEach((wrapper) => {
            // Ensure base styles are present even if they were stripped/modified
            wrapper.setAttribute('contenteditable', 'false');
            wrapper.style.position = wrapper.style.position || 'absolute';
            wrapper.style.transformOrigin = 'center center';
            
            const img = wrapper.querySelector<HTMLImageElement>('img');
            if (img) {
                img.draggable = false;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
                img.style.pointerEvents = 'none';
            }
            
            // Dragging
            let isDraggingImage = false;
            let dragStartX = 0;
            let dragStartY = 0;
            let startLeft = 0;
            let startTop = 0;
            
            function onMouseMoveDrag(e: MouseEvent) {
                if (!isDraggingImage) return;
                e.preventDefault();
                
                const dx = e.clientX - dragStartX;
                const dy = e.clientY - dragStartY;
                
                const editorBounds = editorDiv.getBoundingClientRect();
                const wrapperBounds = wrapper.getBoundingClientRect();
                
                let newLeft = startLeft + dx;
                let newTop = startTop + dy;
                
                const maxLeft = editorBounds.width - wrapperBounds.width;
                const maxTop = editorBounds.height - wrapperBounds.height;
                
                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));
                
                wrapper.style.left = `${newLeft}px`;
                wrapper.style.top = `${newTop}px`;
            }
            
            function stopDragging() {
                if (!isDraggingImage) return;
                isDraggingImage = false;
                window.removeEventListener('mousemove', onMouseMoveDrag);
                window.removeEventListener('mouseup', stopDragging);
                
                if (currentNote && editorDiv && browser) {
                    currentNote.contentHTML = editorDiv.innerHTML;
                    debouncedUpdateNote(currentNote);
                }
            }
            
            wrapper.onmousedown = (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                // If a handle was clicked, let its own handler manage events
                if (
                    target.closest('.image-resize-handle') || 
                    target.closest('.image-rotate-handle') ||
                    target.closest('.image-delete-handle')
                ) {
                    return;
                }
                
                if (!editorDiv.contains(wrapper)) return;
                
                e.preventDefault();
                e.stopPropagation();

                // Mark this image as active so its handles show
                setActiveWrapper(wrapper);
                
                const wrapperBounds = wrapper.getBoundingClientRect();
                const editorBounds = editorDiv.getBoundingClientRect();
                
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                startLeft = wrapperBounds.left - editorBounds.left;
                startTop = wrapperBounds.top - editorBounds.top;
                isDraggingImage = true;
                
                window.addEventListener('mousemove', onMouseMoveDrag);
                window.addEventListener('mouseup', stopDragging);
            };
            
            // Resize from bottom-right corner
            let isResizing = false;
            let resizeStartX = 0;
            let resizeStartY = 0;
            let startWidth = 0;
            let startHeight = 0;
            let startLeftResize = 0;
            let startTopResize = 0;
            
            const resizeHandle =
                wrapper.querySelector<HTMLElement>('.image-resize-handle') ||
                (() => {
                    const h = document.createElement('div');
                    h.className = 'image-handle image-resize-handle';
                    wrapper.appendChild(h);
                    return h;
                })();
            
            function onMouseMoveResize(e: MouseEvent) {
                if (!isResizing) return;
                e.preventDefault();
                
                const dx = e.clientX - resizeStartX;
                const dy = e.clientY - resizeStartY;
                
                const editorBounds = editorDiv.getBoundingClientRect();
                
                let newWidth = Math.max(40, startWidth + dx);
                let newHeight = Math.max(40, startHeight + dy);
                
                // Constrain within editor bounds
                const maxWidth = editorBounds.width - startLeftResize;
                const maxHeight = editorBounds.height - startTopResize;
                
                newWidth = Math.min(newWidth, maxWidth);
                newHeight = Math.min(newHeight, maxHeight);
                
                wrapper.style.width = `${newWidth}px`;
                wrapper.style.height = `${newHeight}px`;
            }
            
            function stopResizing() {
                if (!isResizing) return;
                isResizing = false;
                window.removeEventListener('mousemove', onMouseMoveResize);
                window.removeEventListener('mouseup', stopResizing);
                
                if (currentNote && editorDiv && browser) {
                    currentNote.contentHTML = editorDiv.innerHTML;
                    debouncedUpdateNote(currentNote);
                }
            }
            
            resizeHandle.onmousedown = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                // Ensure this image is active when resizing
                setActiveWrapper(wrapper);
                
                const bounds = wrapper.getBoundingClientRect();
                const editorBounds = editorDiv.getBoundingClientRect();
                
                resizeStartX = e.clientX;
                resizeStartY = e.clientY;
                startWidth = bounds.width;
                startHeight = bounds.height;
                startLeftResize = bounds.left - editorBounds.left;
                startTopResize = bounds.top - editorBounds.top;
                isResizing = true;
                
                window.addEventListener('mousemove', onMouseMoveResize);
                window.addEventListener('mouseup', stopResizing);
            };
            
            // Rotation from top-center handle
            let isRotating = false;
            let rotationStartAngle = 0;
            let initialRotation = parseFloat(wrapper.dataset.rotation || '0') || 0;
            
            const rotateHandle =
                wrapper.querySelector<HTMLElement>('.image-rotate-handle') ||
                (() => {
                    const h = document.createElement('div');
                    h.className = 'image-handle image-rotate-handle';
                    wrapper.appendChild(h);
                    return h;
                })();
            
            function getAngle(e: MouseEvent) {
                const bounds = wrapper.getBoundingClientRect();
                const centerX = bounds.left + bounds.width / 2;
                const centerY = bounds.top + bounds.height / 2;
                return Math.atan2(e.clientY - centerY, e.clientX - centerX);
            }
            
            function onMouseMoveRotate(e: MouseEvent) {
                if (!isRotating) return;
                e.preventDefault();
                
                const angle = getAngle(e);
                const delta = angle - rotationStartAngle;
                const degrees = (initialRotation + (delta * 180) / Math.PI) % 360;
                
                wrapper.dataset.rotation = degrees.toString();
                wrapper.style.transform = `rotate(${degrees}deg)`;
            }
            
            function stopRotating() {
                if (!isRotating) return;
                isRotating = false;
                window.removeEventListener('mousemove', onMouseMoveRotate);
                window.removeEventListener('mouseup', stopRotating);
                
                if (currentNote && editorDiv && browser) {
                    currentNote.contentHTML = editorDiv.innerHTML;
                    debouncedUpdateNote(currentNote);
                }
            }
            
            rotateHandle.onmousedown = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                // Ensure this image is active when rotating
                setActiveWrapper(wrapper);
                
                rotationStartAngle = getAngle(e);
                initialRotation = parseFloat(wrapper.dataset.rotation || '0') || 0;
                isRotating = true;
                
                window.addEventListener('mousemove', onMouseMoveRotate);
                window.addEventListener('mouseup', stopRotating);
            };

            // Delete handle (top-right "X")
            const deleteHandle =
                wrapper.querySelector<HTMLElement>('.image-delete-handle') ||
                (() => {
                    const h = document.createElement('div');
                    h.className = 'image-handle image-delete-handle';
                    h.textContent = '×';
                    wrapper.appendChild(h);
                    return h;
                })();

            deleteHandle.onmousedown = async (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                if (!editorDiv.contains(wrapper)) return;

                // Ask for confirmation, same UX as other deletions
                const confirmed = await showDeleteDialog(
                    'Delete this image from the note?',
                    'Delete image'
                );
                if (!confirmed) {
                    return;
                }

                // Attempt to delete the underlying storage object, if any
                const imagePath = wrapper.dataset.imagePath;
                if (imagePath) {
                    deleteNoteImage(imagePath).catch((err) => {
                        console.warn('[notes] Failed to delete image from storage', imagePath, err);
                    });
                }

                wrapper.remove();

                if (currentNote && editorDiv && browser) {
                    currentNote.contentHTML = editorDiv.innerHTML;
                    debouncedSaveNoteHistory(currentNote.id, editorDiv.innerHTML);
                    debouncedUpdateNote(currentNote);
                }

                // Clear active state once deleted
                setActiveWrapper(null);
            };
        });
    }
    
    /**
     * Ensure any checkbox inputs in the editor behave correctly after
     * sanitization or HTML string assignment.
     */
    function initializeCheckboxInteractions() {
        if (!browser || !editorDiv) return;

        const checkboxes = editorDiv.querySelectorAll<HTMLInputElement>('input.note-checkbox');
        checkboxes.forEach((checkbox) => {
            // If DOMPurify stripped the type attribute from saved content,
            // force it back to a real checkbox so it can be clicked.
            if (checkbox.type !== 'checkbox') {
                checkbox.type = 'checkbox';
            }

            // Avoid attaching duplicate listeners
            if ((checkbox as any)._neuronotesCheckboxInit) return;
            (checkbox as any)._neuronotesCheckboxInit = true;

            checkbox.addEventListener('change', () => {
                if (currentNote) {
                    debouncedUpdateNote(currentNote);
                }
            });
        });
    }
    
    // Update editor content only when note changes (not during typing)
    $: if (editorDiv && selectedNoteId && (selectedNoteId !== previousNoteId || (editorDiv.innerHTML === '' && !isMinimized))) {
        const note = notes.find((n) => n.id === selectedNoteId);
        if (note && note.type === 'text') {
            const noteWithMeta = note as any;
            if ((!note.contentHTML || note.contentHTML === '') && !noteWithMeta._contentLoaded) {
                const noteId = note.id;
                // Load content asynchronously to break reactive cycle
                db.getNoteContent(noteId).then(rawContent => {
                    if (rawContent && editorDiv && selectedNoteId === noteId) {
                        const sanitized = (browser && DOMPurify) 
                            ? sanitizeHTML(rawContent)
                            : rawContent;
                        updateNoteContent(noteId, sanitized);
                        const noteIndex = notes.findIndex((n) => n.id === noteId);
                        if (noteIndex !== -1) {
                            const updatedNoteWithMeta = notes[noteIndex] as any;
                            updatedNoteWithMeta._contentLoaded = true;
                            notes = [...notes];
                        }
                        if (editorDiv && (editorDiv.innerHTML === '' || editorDiv.innerHTML !== sanitized)) {
                            editorDiv.innerHTML = sanitized;
                            // Linkify any URLs in the loaded content
                            tick().then(() => {
                                if (editorDiv && browser) {
                                    try {
                                        linkifyEditor(editorDiv);
                                        // Initialize interactions for existing content
                                        initializeImageInteractions();
                                        initializeCheckboxInteractions();
                                        // Update note content with linkified version
                                        updateNoteContent(noteId, editorDiv.innerHTML);
                                    } catch (err) {
                                        console.warn('Linkify error on load:', err);
                                    }
                                }
                                updateFormattingState();
                            });
                        } else {
                            // Update formatting state after content is loaded
                            tick().then(() => updateFormattingState());
                        }
                    }
                }).catch(e => {
                    console.error('Failed to load note content:', e);
                });
            } else if (note.contentHTML) {
                const sanitized = browser && DOMPurify
                    ? sanitizeHTML(note.contentHTML)
                    : note.contentHTML;
                
                if (editorDiv.innerHTML === '' && sanitized) {
                    editorDiv.innerHTML = sanitized;
                    tick().then(() => {
                        if (editorDiv && browser) {
                            try {
                                linkifyEditor(editorDiv);
                                initializeImageInteractions();
                                initializeCheckboxInteractions();
                                // Update note content with linkified version
                                updateNoteContent(note.id, editorDiv.innerHTML);
                            } catch (err) {
                                console.warn('Linkify error:', err);
                            }
                        }
                        updateFormattingState();
                    });
                } else if (editorDiv.innerHTML !== sanitized && sanitized && previousNoteId !== selectedNoteId) {
                    editorDiv.innerHTML = sanitized;
                    tick().then(() => {
                        if (editorDiv && browser) {
                            try {
                                linkifyEditor(editorDiv);
                                initializeImageInteractions();
                                initializeCheckboxInteractions();
                                // Update note content with linkified version
                                updateNoteContent(note.id, editorDiv.innerHTML);
                            } catch (err) {
                                console.warn('Linkify error:', err);
                            }
                        }
                        updateFormattingState();
                    });
                } else {
                    // Update formatting state after content is set
                    tick().then(() => updateFormattingState());
                }
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
                    ? sanitizeHTML(updatedNote.contentHTML || '')
                    : (updatedNote.contentHTML || '');
                    if (editorDiv.innerHTML !== sanitized) {
                        editorDiv.innerHTML = sanitized;
                        tick().then(() => {
                            if (editorDiv && browser) {
                                try {
                                        linkifyEditor(editorDiv);
                                        // Update note content with linkified version - find note again to avoid cycle
                                        const noteId = note.id;
                                        const noteIndex = notes.findIndex((n) => n.id === noteId);
                                        if (noteIndex !== -1) {
                                            const updatedNotes = [...notes];
                                            updatedNotes[noteIndex] = { ...updatedNotes[noteIndex], contentHTML: editorDiv.innerHTML };
                                            notes = updatedNotes;
                                        }
                                } catch (err) {
                                    console.warn('Linkify error:', err);
                                }
                            }
                        });
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
            // Use push-first sync to preserve the newly created note
            // This prevents it from being deleted during a pull-first sync
            if (isSupabaseConfigured() && supabase) {
                const user = (await supabase.auth.getUser()).data.user;
                if (user) {
                    await syncModule.pushFirstSync();
                    return;
                }
            }
            // Fallback to regular sync if not logged in
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

    function addFolder() {
        folderName = 'New Folder';
        showFolderModal = true;
    }

    async function handleFolderSubmit(name: string) {
        if (!name?.trim()) return;

        try {
            // Calculate order as last position in the mixed list (folders + notes)
            // This allows folders to be placed anywhere, including after notes
            const allItems = displayList.filter(item => 
                (item.displayType === 'folder' || item.displayType === 'note')
            );
            const maxOrder = allItems.length > 0 
                ? Math.max(...allItems.map(item => item.order ?? 0))
                : -1;
            
            const f: Folder = {
                id: generateUUID(),
                name: name.trim(),
                workspaceId: activeWorkspaceId!,
                order: maxOrder + 1
            };
            await db.putFolder(f);
            const reloadedFolders = await db.getFoldersByWorkspaceId(activeWorkspaceId!);
            const reloadedFolder = reloadedFolders.find(folder => folder.id === f.id);
            if (reloadedFolder) {
                const folderIndex = folders.findIndex(folder => folder.id === f.id);
                if (folderIndex !== -1) {
                    folders[folderIndex] = reloadedFolder;
                    folders = [...folders];
                } else {
                    folders = [...folders, reloadedFolder];
                }
            } else {
                folders = [...folders, f];
            }
            
            // Use push-first sync to preserve the newly created folder
            // This prevents it from being deleted during a pull-first sync
            if (isSupabaseConfigured() && supabase) {
                const user = (await supabase.auth.getUser()).data.user;
                if (user) {
                    await syncModule.pushFirstSync();
                    return;
                }
            }
            
            // Fallback to regular sync if not logged in
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
        
        // Use push-first sync to preserve the deletion
        // This prevents the folder from being restored during a pull-first sync
        if (isSupabaseConfigured() && supabase) {
            const user = (await supabase.auth.getUser()).data.user;
            if (user) {
                await syncModule.pushFirstSync();
                return;
            }
        }
        
        // Fallback to regular sync if not logged in
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
                    ? sanitizeHTML(previousState.content)
                    : previousState.content;
                currentNote.contentHTML = sanitized;
                if (editorDiv) {
                    editorDiv.innerHTML = sanitized;
                    initializeImageInteractions();
                    initializeCheckboxInteractions();
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
                    ? sanitizeHTML(nextState.content)
                    : nextState.content;
                currentNote.contentHTML = sanitized;
                if (editorDiv) {
                    editorDiv.innerHTML = sanitized;
                    initializeImageInteractions();
                    initializeCheckboxInteractions();
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
            noteToSave.contentHTML = sanitizeHTML(noteToSave.contentHTML);
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
    // Reduced debounce from 1000ms to 500ms for faster sync - prevents data loss
    const debouncedSyncIfLoggedIn = debounce(onSyncIfLoggedIn, 500);

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
                const oldFolderId = noteToMove.folderId;
                noteToMove.folderId = targetFolder.id;
                noteToMove.updatedAt = Date.now();
                noteToMove.order = notes.filter((n) => n.folderId === targetFolder.id).length;
                await db.putNote(noteToMove);
                const nextNotes = [...notes];
                nextNotes[noteToMoveIndex] = noteToMove;
                notes = nextNotes;
                
                // Use push-first sync to preserve the folder change
                // This prevents the note from being restored to its old folder during a pull-first sync
                if (isSupabaseConfigured() && supabase) {
                    const user = (await supabase.auth.getUser()).data.user;
                    if (user) {
                        await syncModule.pushFirstSync();
                        isDragging = false;
                        draggedItemType = null;
                        return;
                    }
                }
                
                // Fallback to regular sync if not logged in
                await onSyncIfLoggedIn();
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
                // Calculate order as last position among root notes only
                const rootNotes = notes.filter((n) => n.folderId === null && n.workspaceId === activeWorkspaceId);
                const maxOrder = rootNotes.length > 0 
                    ? Math.max(...rootNotes.map(n => n.order ?? 0))
                    : -1;
                noteToMove.order = maxOrder + 1;
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
        
        // Use unified order space so folders and notes can be interleaved
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
                // Use position in mixed list for unified ordering
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
                // Use position in mixed list for unified ordering
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
        
        // Sync to preserve the new order - use push-first to prevent overwriting
        if (isSupabaseConfigured() && supabase) {
            const user = (await supabase.auth.getUser()).data.user;
            if (user) {
                await syncModule.pushFirstSync();
                return;
            }
        }
        
        // Fallback to regular sync if not logged in
        await onSyncIfLoggedIn();
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

    async function insertImageFromFile(file: File) {
        if (!browser || !editorDiv || !currentNote || currentNote.type !== 'text') return;

        isInsertingImage = true;
        imageInsertError = null;

        try {
            const { blob, width, height } = await convertToWebP(file, {
                quality: 0.75,
                maxWidth: 1200,
                maxHeight: 1200,
                adaptiveQuality: true,
                minQuality: 0.65,
                maxQuality: 0.8,
                skipIfSmall: 200 * 1024 // Skip compression for files under 200KB
            });

            let src: string;
            let imagePath: string | null = null;

            try {
                const uploadResult = await uploadNoteImageWebP(currentNote.id, blob);
                src = uploadResult.publicUrl;
                imagePath = uploadResult.path;
            } catch (error) {
                console.warn('[notes] Failed to upload image to Supabase, falling back to data URL:', error);
                src = await blobToDataUrl(blob);
            }

            const maxDisplaySize = 260;
            const scale = Math.min(1, maxDisplaySize / Math.max(width, height));
            const displayWidth = Math.round(width * scale);
            const displayHeight = Math.round(height * scale);

            const wrapper = document.createElement('div');
            wrapper.className = 'note-image-wrapper';
            wrapper.setAttribute('contenteditable', 'false');
            wrapper.dataset.imageSrc = src;
            if (imagePath) {
                wrapper.dataset.imagePath = imagePath;
            }
            wrapper.dataset.rotation = '0';
            wrapper.style.left = '20px';
            wrapper.style.top = '20px';
            wrapper.style.width = `${displayWidth}px`;
            wrapper.style.height = `${displayHeight}px`;

            const img = document.createElement('img');
            img.src = src;
            img.alt = 'Note image';
            img.draggable = false;
            wrapper.appendChild(img);

            editorDiv.appendChild(wrapper);

            // Wire up drag/resize/rotate
            initializeImageInteractions();

            currentNote.contentHTML = editorDiv.innerHTML;
            debouncedSaveNoteHistory(currentNote.id, editorDiv.innerHTML);
            debouncedUpdateNote(currentNote);
        } catch (error) {
            console.error('[notes] Failed to insert image into note:', error);
            imageInsertError = 'Failed to insert image';
        } finally {
            isInsertingImage = false;
        }
    }

    async function handleImagePaste(event: ClipboardEvent): Promise<boolean> {
        if (!browser) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (!file) continue;

                event.preventDefault();
                event.stopPropagation();

                await insertImageFromFile(file);
                return true;
            }
        }

        return false;
    }

    function openImageFilePicker() {
        if (!imageFileInput || !browser || !currentNote || currentNote.type !== 'text') return;
        imageFileInput.value = '';
        imageFileInput.click();
    }

    async function handleImageFileChange(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.files || input.files.length === 0) return;

        const file = input.files[0];
        await insertImageFromFile(file);

        // Reset the input so the same file can be chosen again if needed
        input.value = '';
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
            // Restore selected note - use selectNote() to properly open it
            if (initialSelectedId) {
                // Clear selectedNoteId first so selectNote() will properly load the note
                // (selectNote returns early if id matches selectedNoteId)
                selectedNoteId = '';
                // Call selectNote to properly load and open the note with all its content
                await selectNote(initialSelectedId);
            } else {
                selectedNoteId = '';
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

            // Close currency dropdown when clicking outside
            // Temporarily disabled to debug
            /*
            const handleClickOutside = (e: MouseEvent) => {
                // Skip if dropdown was just opened by button click
                if (currencyDropdownJustOpened) {
                    currencyDropdownJustOpened = false;
                    return;
                }
                // Use setTimeout to allow the click event to complete first
                setTimeout(() => {
                    // Only close if dropdown is actually open
                    if (!showCurrencyDropdown) return;
                    const target = e.target as HTMLElement;
                    if (!target.closest('.currency-dropdown-wrapper')) {
                        showCurrencyDropdown = false;
                    }
                }, 100);
            };
            window.addEventListener('click', handleClickOutside);
            (window as any).__currencyDropdownClickHandler = handleClickOutside;
            */

            // Listen for selection changes to update formatting state
            const handleSelectionChange = () => {
                if (editorDiv && document.activeElement === editorDiv) {
                    updateFormattingState();
                }
            };
            document.addEventListener('selectionchange', handleSelectionChange);

            // Throttle Realtime updates to prevent UI lag from rapid changes
            let lastUpdateTime = 0;
            const UPDATE_THROTTLE_MS = 100; // Minimum 100ms between updates
            
            // Listen for Realtime updates
            const handleRealtimeUpdate = async (event: CustomEvent) => {
                const { tableName, changedId } = event.detail;
                console.log(`[NotesPanel] Realtime update: ${tableName} - ${changedId}`);
                
                // Throttle rapid updates
                const now = Date.now();
                if (now - lastUpdateTime < UPDATE_THROTTLE_MS) {
                    // Queue this update to process after throttle period
                    setTimeout(() => handleRealtimeUpdate(event), UPDATE_THROTTLE_MS - (now - lastUpdateTime));
                    return;
                }
                lastUpdateTime = now;
                
                // Reload notes data when notes, folders, or workspaces are updated
                if (tableName === 'notes' || tableName === 'note_content' || tableName === 'folders' || tableName === 'workspaces') {
                    // Check if the updated note is currently selected
                    const isSelectedNote = selectedNoteId === changedId;
                    const isCurrentlyEditing = isSelectedNote && 
                        editorDiv && 
                        document.activeElement === editorDiv;
                    
                    if (isSelectedNote && tableName === 'notes') {
                        // This is the currently selected note - update it carefully
                        try {
                            const updatedNotes = await db.getNotesByWorkspaceId(activeWorkspaceId!);
                            const updatedNote = updatedNotes.find(n => n.id === changedId);
                            if (updatedNote) {
                                const noteIndex = notes.findIndex(n => n.id === changedId);
                                if (noteIndex !== -1) {
                                    const currentNote = notes[noteIndex];
                                    
                                    if (isCurrentlyEditing) {
                                        // User is actively typing - update metadata but preserve editor content
                                        notes[noteIndex] = {
                                            ...updatedNote,
                                            contentHTML: currentNote.contentHTML // Keep current editor content
                                        };
                                        notes = [...notes];
                                        console.log(`[NotesPanel] Note ${changedId} updated from Realtime (preserving editor content - user is typing)`);
                                    } else {
                                        // User is not actively typing - update both note and editor
                                        notes[noteIndex] = updatedNote;
                                        notes = [...notes];
                                        
                                        // Update the editor content if it's a text note
                                        if (updatedNote.type === 'text' && editorDiv) {
                                            const sanitized = (browser && DOMPurify) 
                                                ? sanitizeHTML(updatedNote.contentHTML || '')
                                                : (updatedNote.contentHTML || '');
                                            editorDiv.innerHTML = sanitized;
                                            // Update note history
                                            if (updatedNote.contentHTML && !noteHistory.has(changedId)) {
                                                saveNoteHistory(changedId, updatedNote.contentHTML);
                                            }
                                        }
                                        console.log(`[NotesPanel] Note ${changedId} updated from Realtime (updated editor content)`);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('Failed to update note from Realtime:', e);
                            // Fallback to full reload
                            await loadNotesData();
                        }
                    } else {
                        // Not the selected note, or different table - safe to reload
                        await loadNotesData();
                    }
                }
            };
            
            window.addEventListener('realtime-note-update', handleRealtimeUpdate as EventListener);
            
            // Store cleanup function
            (window as any).__notesPanelSelectionCleanup = () => {
                document.removeEventListener('selectionchange', handleSelectionChange);
                window.removeEventListener('resize', updateMobileVisibility);
                window.removeEventListener('realtime-note-update', handleRealtimeUpdate as EventListener);
                if ((window as any).__currencyDropdownClickHandler) {
                    window.removeEventListener('click', (window as any).__currencyDropdownClickHandler, true);
                    delete (window as any).__currencyDropdownClickHandler;
                }
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
    style="max-width: 100%; overflow: hidden; height: 100%;"
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
                        on:click={openImageFilePicker}
                        on:mousedown={(e) => e.preventDefault()}
                        title="Insert image">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M14.2647 15.9377L12.5473 14.2346C11.758 13.4519 11.3633 13.0605 10.9089 12.9137C10.5092 12.7845 10.079 12.7845 9.67922 12.9137C9.22485 13.0605 8.83017 13.4519 8.04082 14.2346L4.04193 18.2622M14.2647 15.9377L14.606 15.5991C15.412 14.7999 15.8149 14.4003 16.2773 14.2545C16.6839 14.1262 17.1208 14.1312 17.5244 14.2688C17.9832 14.4253 18.3769 14.834 19.1642 15.6515L20 16.5001M14.2647 15.9377L18.22 19.9628M18.22 19.9628C17.8703 20 17.4213 20 16.8 20H7.2C6.07989 20 5.51984 20 5.09202 19.782C4.7157 19.5903 4.40973 19.2843 4.21799 18.908C4.12583 18.7271 4.07264 18.5226 4.04193 18.2622M18.22 19.9628C18.5007 19.9329 18.7175 19.8791 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.782 18.908C20 18.4802 20 17.9201 20 16.8V13M11 4H7.2C6.07989 4 5.51984 4 5.09202 4.21799C4.7157 4.40973 4.40973 4.71569 4.21799 5.09202C4 5.51984 4 6.0799 4 7.2V16.8C4 17.4466 4 17.9066 4.04193 18.2622M18 9V6M18 6V3M18 6H21M18 6H15"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </button>
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
                    <div class="currency-dropdown-wrapper" bind:this={currencyDropdownWrapper}>
                        <button
                            class="toolbar-btn currency-btn"
                            type="button"
                            on:click|stopPropagation={async (e) => {
                                console.log('Currency button clicked');
                                currencyDropdownJustOpened = true;
                                showCurrencyDropdown = !showCurrencyDropdown;
                                console.log('showCurrencyDropdown:', showCurrencyDropdown);
                                if (showCurrencyDropdown && currencyDropdownWrapper) {
                                    await tick();
                                    const buttonRect = currencyDropdownWrapper.getBoundingClientRect();
                                    const dropdown = currencyDropdownWrapper.querySelector('.currency-dropdown') as HTMLElement;
                                    if (dropdown) {
                                        dropdown.style.top = `${buttonRect.bottom + 4}px`;
                                        dropdown.style.left = `${buttonRect.left}px`;
                                        console.log('Dropdown positioned at:', dropdown.style.top, dropdown.style.left);
                                    }
                                }
                            }}
                            title="Currency Format">$</button
                        >
                        {#if showCurrencyDropdown}
                            <div class="currency-dropdown" on:click|stopPropagation>
                                <button
                                    class="currency-option"
                                    on:click={() => {
                                        spreadsheetComponentInstance.applyCurrencyFormat('EUR');
                                        showCurrencyDropdown = false;
                                    }}
                                    on:mousedown={(e) => e.preventDefault()}
                                >EUR</button>
                                <button
                                    class="currency-option"
                                    on:click={() => {
                                        spreadsheetComponentInstance.applyCurrencyFormat('USD');
                                        showCurrencyDropdown = false;
                                    }}
                                    on:mousedown={(e) => e.preventDefault()}
                                >USD</button>
                                <button
                                    class="currency-option"
                                    on:click={() => {
                                        spreadsheetComponentInstance.applyCurrencyFormat('CZK');
                                        showCurrencyDropdown = false;
                                    }}
                                    on:mousedown={(e) => e.preventDefault()}
                                >CZK</button>
                                <button
                                    class="currency-option"
                                    on:click={() => {
                                        spreadsheetComponentInstance.applyCurrencyFormat('GBP');
                                        showCurrencyDropdown = false;
                                    }}
                                    on:mousedown={(e) => e.preventDefault()}
                                >GBP</button>
                                <button
                                    class="currency-option"
                                    on:click={() => {
                                        spreadsheetComponentInstance.applyCurrencyFormat('CNY');
                                        showCurrencyDropdown = false;
                                    }}
                                    on:mousedown={(e) => e.preventDefault()}
                                >CNY</button>
                                <button
                                    class="currency-option"
                                    on:click={() => {
                                        spreadsheetComponentInstance.applyCurrencyFormat('JPY');
                                        showCurrencyDropdown = false;
                                    }}
                                    on:mousedown={(e) => e.preventDefault()}
                                >JPY</button>
                                <button
                                    class="currency-option"
                                    on:click={() => {
                                        spreadsheetComponentInstance.applyCurrencyFormat(undefined);
                                        showCurrencyDropdown = false;
                                    }}
                                    on:mousedown={(e) => e.preventDefault()}
                                >Remove</button>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
        <input
            type="file"
            accept="image/*"
            bind:this={imageFileInput}
            on:change={handleImageFileChange}
            style="display: none;"
        />
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
                                        if (currentNote && editorDiv && browser) {
                                            currentNote.contentHTML = editorDiv.innerHTML;
                                            debouncedSaveNoteHistory(currentNote.id, editorDiv.innerHTML);
                                            debouncedUpdateNote(currentNote);
                                            
                                            // Linkify URLs in the content after a short delay
                                            // Only if the content actually changed (not from paste handler)
                                            setTimeout(() => {
                                                if (editorDiv && currentNote && browser) {
                                                    try {
                                                        linkifyEditor(editorDiv);
                                                        // Only update if content actually changed
                                                        if (currentNote.contentHTML !== editorDiv.innerHTML) {
                                                            currentNote.contentHTML = editorDiv.innerHTML;
                                                            debouncedUpdateNote(currentNote);
                                                        }
                                                    } catch (err) {
                                                        console.warn('Linkify error:', err);
                                                    }
                                                }
                                            }, 150);
                                        }
                                    }}
                                    on:mousedown={(e) => {
                                        // Handle link clicks to open in new tab
                                        const target = e.target as HTMLElement;
                                        const link = target.tagName === 'A' 
                                            ? target as HTMLAnchorElement 
                                            : target.closest('a') as HTMLAnchorElement;
                                        if (link && link.href) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            window.open(link.href, '_blank', 'noopener,noreferrer');
                                            return false;
                                        }
                                    }}
                                    on:focus={async () => {
                                        await tick();
                                        // Linkify any URLs when editor gains focus
                                        if (editorDiv && browser) {
                                            try {
                                                linkifyEditor(editorDiv);
                                                if (currentNote) {
                                                    currentNote.contentHTML = editorDiv.innerHTML;
                                                }
                                            } catch (err) {
                                                console.warn('Linkify error on focus:', err);
                                            }
                                        }
                                        updateFormattingState();
                                        updateSelectedFontSize();
                                    }}
                                    on:blur={() => {
                                        // Linkify URLs when editor loses focus
                                        if (editorDiv && currentNote && browser) {
                                            try {
                                                linkifyEditor(editorDiv);
                                                currentNote.contentHTML = editorDiv.innerHTML;
                                                debouncedUpdateNote(currentNote);
                                            } catch (err) {
                                                console.warn('Linkify error on blur:', err);
                                            }
                                        }
                                    }}
                                    on:paste={async (e) => {
                                        // First, try to handle image paste (from clipboard)
                                        if (await handleImagePaste(e as ClipboardEvent)) {
                                            if (editorDiv && currentNote && browser) {
                                                try {
                                                    linkifyEditor(editorDiv);
                                                    currentNote.contentHTML = editorDiv.innerHTML;
                                                    debouncedUpdateNote(currentNote);
                                                } catch (err) {
                                                    console.warn('Linkify error after image paste:', err);
                                                }
                                            }
                                            return;
                                        }

                                        // Fallback: handle plain text paste and then linkify
                                        const result = handlePlainTextPaste(e as ClipboardEvent);
                                        if (result && editorDiv && currentNote && browser) {
                                            // Linkify after paste completes
                                            setTimeout(() => {
                                                if (editorDiv && currentNote && browser) {
                                                    try {
                                                        linkifyEditor(editorDiv);
                                                        if (currentNote.contentHTML !== editorDiv.innerHTML) {
                                                            currentNote.contentHTML = editorDiv.innerHTML;
                                                            debouncedUpdateNote(currentNote);
                                                        }
                                                    } catch (err) {
                                                        console.warn('Linkify error after paste:', err);
                                                    }
                                                }
                                            }, 50);
                                        }
                                    }}
                                    on:keydown={(e) => {
                                        // Detect URLs when space or enter is pressed
                                        if ((e.key === ' ' || e.key === 'Enter') && !e.ctrlKey && !e.metaKey && browser) {
                                            // Small delay to allow the character to be inserted first
                                            setTimeout(() => {
                                                if (editorDiv && currentNote && browser) {
                                                    try {
                                                        linkifyEditor(editorDiv);
                                                        if (currentNote.contentHTML !== editorDiv.innerHTML) {
                                                            currentNote.contentHTML = editorDiv.innerHTML;
                                                            debouncedUpdateNote(currentNote);
                                                        }
                                                    } catch (err) {
                                                        console.warn('Linkify error on keydown:', err);
                                                    }
                                                }
                                            }, 20);
                                        }
                                        
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

<WorkspaceModal
    open={showFolderModal}
    bind:workspaceName={folderName}
    title="Create Folder"
    label="Folder Name"
    placeholder="Enter folder name"
    submitButtonText="Create"
    onClose={() => showFolderModal = false}
    onSubmit={handleFolderSubmit}
/>

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
        height: 100%;
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
        max-height: none;
        overflow: visible !important;
        position: relative;
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
        grid-template-rows: 1fr;
        flex: 1;
        min-width: 0;
        min-height: 0;
        max-height: 100%;
        height: 100%;
        overflow: hidden;
        transition: grid-template-columns 0.2s ease-in-out;
    }

    .note-list {
        border-right: 1px solid var(--border);
        overflow: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        min-width: 0;
        min-height: 0;
        height: 100%;
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
        display: grid;
        grid-template-rows: 1fr;
        min-width: 0;
        min-height: 0;
        max-height: 100%;
        overflow: hidden;
        height: 100%;
        width: 100%;
        align-items: stretch;
        align-content: stretch;
        align-self: stretch;
        position: relative;
    }

    .note-content {
        padding: 16px;
        min-height: 0;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        scrollbar-width: none;
        -ms-overflow-style: none;
        align-self: stretch;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
    }

    .contenteditable {
        flex: 1 1 0;
        min-height: 0;
        max-height: 100%;
        width: 100%;
        outline: none;
        border-radius: 8px;
        padding: 12px;
        padding-bottom: 24px;
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        transition: border-color 0.2s;
        overflow-wrap: break-word;
        overflow-y: auto;
        overflow-x: hidden;
        box-sizing: border-box;
        position: relative;
    }
    
    
    .contenteditable:empty::before {
        content: '\200B';
        display: block;
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
    
    :global(.contenteditable a.note-link),
    :global(.contenteditable .note-link) {
        color: #4a9eff !important;
        text-decoration: underline !important;
        cursor: pointer !important;
        transition: color 0.2s;
    }
    
    :global(.contenteditable a.note-link:hover),
    :global(.contenteditable .note-link:hover) {
        color: #6bb3ff !important;
    }
    
    :global(.contenteditable a) {
        color: #4a9eff !important;
        text-decoration: underline !important;
        cursor: pointer !important;
    }
    
    :global(.contenteditable a:hover) {
        color: #6bb3ff !important;
    }

    /* Draggable / resizable / rotatable images inside notes */
    :global(.contenteditable .note-image-wrapper) {
        position: absolute;
        box-sizing: border-box;
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        cursor: move;
        padding: 0;
        /* Allow resize/rotate/delete handles to extend outside the image box */
        overflow: visible;
    }

    :global(.contenteditable .note-image-wrapper.is-active) {
        border-color: rgba(255, 255, 255, 0.3);
        background: rgba(0, 0, 0, 0.1);
    }

    :global(.contenteditable .note-image-wrapper img) {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
    }

    :global(.contenteditable .note-image-wrapper .image-handle) {
        position: absolute;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--accent-red);
        border: 2px solid #fff;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
        z-index: 2;
        display: none;
    }

    :global(.contenteditable .note-image-wrapper.is-active .image-handle) {
        display: flex;
    }

    :global(.contenteditable .note-image-wrapper .image-resize-handle) {
        right: -6px;
        bottom: -6px;
        cursor: se-resize;
    }

    :global(.contenteditable .note-image-wrapper .image-rotate-handle) {
        top: -18px;
        left: 50%;
        transform: translateX(-50%);
        cursor: grab;
    }

    :global(.contenteditable .note-image-wrapper .image-delete-handle) {
        top: -6px;
        right: -6px;
        width: 16px;
        height: 16px;
        align-items: center;
        justify-content: center;
        background: #ff4d4f;
        border-radius: 50%;
        font-size: 12px;
        font-weight: bold;
        color: #fff;
        cursor: pointer;
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
        overflow: visible;
        z-index: 1000;
    }

    .format-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        justify-content: center;
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: visible;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding-left: 40px;
        padding-right: 40px;
        position: relative;
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

    .currency-dropdown-wrapper {
        position: relative;
        overflow: visible;
        z-index: 10001;
        display: inline-block;
    }
    
    .currency-btn {
        pointer-events: auto !important;
        cursor: pointer !important;
    }

    .currency-dropdown {
        position: fixed;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 99999;
        min-width: 100px;
        overflow: hidden;
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
    }

    .currency-option {
        display: block;
        width: 100%;
        padding: 8px 12px;
        background: none;
        border: none;
        color: var(--text);
        font-size: 14px;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .currency-option:hover {
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
        .panel {
            min-height: 420px;
        }
        .folder-item input,
        .note-item input {
            font-size: 16px !important;
            transform: scale(0.875);
            transform-origin: left center;
        }

        .note-content {
            flex: 1 1 0;
            min-height: 0;
            max-height: 100%;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .contenteditable {
            height: 100%;
            min-height: 0;
            max-height: 100%;
            overflow-y: auto;
            overflow-x: hidden;
        }
    }
</style>

