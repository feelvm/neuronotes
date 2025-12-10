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
    import CalendarPanel from '$lib/components/CalendarPanel.svelte';
    import KanbanPanel from '$lib/components/KanbanPanel.svelte';
    import NotesPanel from '$lib/components/NotesPanel.svelte';
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
    let calendarPanelWidth = 50; // Width when calendar and kanban are side by side
    let isNotesMinimized = false;
    let isCalendarMinimized = false;
    let isKanbanMinimized = false;
    let hasHandledInitialSession = false; // Track if we've handled initial session to avoid duplicate data clearing
    
    let showNotes = true;
    let showCalendar = true;
    let showKanban = true;
    let showEditPanelsModal = false;
    let savePanelSelection = false;
    
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
    
    let lastNotesWidth = 50;
    let lastCalendarHeight = 50;
    let isVerticalResizing = false;
    let isHorizontalResizing = false;
    let notesPanelClientWidth = 0;
    
    // Refs for resize handlers to avoid DOM queries
    let mainEl: HTMLElement;
    let rightEl: HTMLElement;

    // Consolidated reactive statement for panel sizing to prevent cascading updates
    $: {
        const minimizedCount = (isNotesMinimized ? 1 : 0) + (isCalendarMinimized ? 1 : 0) + (isKanbanMinimized ? 1 : 0);
        
        // Handle notes panel width
        if (isNotesMinimized) {
            notesPanelWidth = 6;
        } else if (minimizedCount === 2 && !isNotesMinimized) {
            notesPanelWidth = 94;
        } else if (minimizedCount < 2 && notesPanelWidth > 90) {
            notesPanelWidth = lastNotesWidth > 7 ? lastNotesWidth : 50;
        } else if (notesPanelWidth < 7) {
            notesPanelWidth = lastNotesWidth > 7 ? lastNotesWidth : 50;
        }
        
        // Handle calendar panel height
        if (isCalendarMinimized) {
            calendarPanelHeight = 6;
        } else if (isKanbanMinimized) {
            calendarPanelHeight = 94;
        } else if (minimizedCount === 2) {
            if (!isCalendarMinimized) {
                calendarPanelHeight = 94;
            } else if (!isKanbanMinimized) {
                calendarPanelHeight = 6;
            }
        } else if (minimizedCount < 2 && !isCalendarMinimized && !isKanbanMinimized) {
            if (calendarPanelHeight > 90) {
                calendarPanelHeight = lastCalendarHeight > 7 && lastCalendarHeight < 93 ? lastCalendarHeight : 50;
            } else if (calendarPanelHeight < 7 || calendarPanelHeight > 93) {
                calendarPanelHeight = lastCalendarHeight > 7 && lastCalendarHeight < 93 ? lastCalendarHeight : 50;
            }
        }
    }

    $: if (browser && !isCalendarMinimized && !isCalendarLoaded) {
        loadCalendarEvents();
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
        if (!showNotes && showCalendar && showKanban) {
            // Resizing calendar and kanban when side by side
            if (!rightEl) return;
            const rightRect = rightEl.getBoundingClientRect();
            const newWidth = ((e.clientX - rightRect.left) / rightRect.width) * 100;
            calendarPanelWidth = Math.max(6, Math.min(94, newWidth));
        } else {
            // Resizing notes panel
            if (!mainEl) return;
            const mainRect = mainEl.getBoundingClientRect();
            const newWidth = ((e.clientX - mainRect.left) / mainRect.width) * 100;
            notesPanelWidth = Math.max(6, Math.min(94, newWidth));
            lastNotesWidth = notesPanelWidth;
        }
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
        const containerEl = rightEl || mainEl;
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
        // Defensive cleanup - remove all possible resize listeners
        window.removeEventListener('mousemove', doVerticalResize);
        window.removeEventListener('mousemove', doHorizontalResize);
        window.removeEventListener('mouseup', stopResize);
        // Reset state to prevent handlers from running after cleanup
        isVerticalResizing = false;
        isHorizontalResizing = false;
        // Restore body styles in case cleanup happens during active resize
        if (document.body) {
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        }
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




    let workspaces: Workspace[] = [];
    let activeWorkspaceId = '';
    let editingWorkspaceId: string | null = null;
    let draggedWorkspaceId: string | null = null;

    $: activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
    async function switchWorkspace(id: string) {
        if (id === activeWorkspaceId) return;

        // Update UI immediately for better responsiveness
        calendarEvents = [];
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

        // Batch all delete operations in parallel for better performance
        const [notesToDelete, foldersToDelete, eventsToDelete] = await Promise.all([
            db.getNotesByWorkspaceId(id),
            db.getFoldersByWorkspaceId(id),
            db.getCalendarEventsByWorkspaceId(id)
        ]);

        // Delete all items in parallel
        await Promise.all([
            ...notesToDelete.map(note => db.deleteNote(note.id)),
            ...foldersToDelete.map(folder => db.deleteFolder(folder.id)),
            ...eventsToDelete.map(event => db.deleteCalendarEvent(event.id)),
            db.deleteWorkspace(id)
        ]);

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
    let userEmail: string | null = null; // Track current user email
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
        
        // Fetch and set user email
        await ensureSupabaseLoaded();
        const user = await auth.getUser();
        userEmail = user?.email || null;
        
        // Clear UI state and reload workspace data
        calendarEvents = [];
        
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
                calendarEvents: calendarEvents,
                activeWorkspaceId: activeWorkspaceId,
                timestamp: Date.now()
            };
            
            // Save to localStorage with user ID as key
            const storageKey = `neuronotes_account_${user.id}`;
            localStorage.setItem(storageKey, JSON.stringify(accountData));
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
                for (const workspace of data.workspaces) {
                    await db.putWorkspace(workspace);
                }
            }

            if (data.folders && data.folders.length > 0) {
                for (const folder of data.folders) {
                    await db.putFolder(folder);
                }
            }

            if (data.notes && data.notes.length > 0) {
                for (const note of data.notes) {
                    // Ensure imported notes have their content properly marked
                    // This prevents putNote from trying to preserve existing content
                    // We set _contentLoaded = true for all imported notes to use backup content (even if empty)
                    const noteWithMeta = note as any;
                    noteWithMeta._contentLoaded = true;
                    
                    // Debug: log note content info
                    
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
                for (const event of data.calendarEvents) {
                    await db.putCalendarEvent(event);
                }
            }

            if (data.kanban && data.kanban.length > 0) {
                for (const kanban of data.kanban) {
                    await db.putKanban(kanban);
                }
            }

            if (data.settings && data.settings.length > 0) {
                for (const setting of data.settings) {
                    await db.putSetting(setting);
                }
            }

            
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


    async function loadActiveWorkspaceData() {
        if (!browser || !activeWorkspaceId) return;

        isCalendarLoaded = false;
        // NotesPanel handles its own loading
        // Load calendar events
        await loadCalendarEvents();
    }

    onMount(() => {
        if (browser) {
            backup.startAutoBackup();
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
            
            // Load saved panel preferences
            try {
                const savedPrefs = await db.getSettingByKey('panelPreferences');
                if (savedPrefs && savedPrefs.value) {
                    const prefs = JSON.parse(savedPrefs.value);
                    showNotes = prefs.showNotes ?? true;
                    showCalendar = prefs.showCalendar ?? true;
                    showKanban = prefs.showKanban ?? true;
                    savePanelSelection = true;
                }
            } catch (e) {
                console.warn('Failed to load panel preferences:', e);
            }
            
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
                userEmail = user?.email || null;
                
                // CRITICAL: Mark that we're handling this user's session in onMount
                // This must be set BEFORE subscribing to auth state changes, because
                // the subscription might fire immediately and we need to skip it
                if (sessionUserId) {
                    handledUserIdInOnMount = sessionUserId;
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
                    // Flush any pending database saves before syncing
                    await db.flushDatabaseSave();
                    
                    if (isSameUser) {
                        // Same user - just sync without clearing
                        
                        // Use fullSync which does pull-then-push to ensure we get latest changes
                        // before pushing local changes. This prevents overwriting newer changes from other devices.
                        try {
                            await ensureSupabaseLoaded();
                            const syncResult = await sync.fullSync();
                            if (!syncResult.success) {
                                console.error('[onMount] Full sync failed:', syncResult.error);
                            }
                        } catch (error) {
                            console.warn('[onMount] Failed to sync:', error);
                        }
                    } else {
                        // Different user or first time - clear and pull
                        
                        // IMPORTANT: Don't push local changes before clearing when switching users
                        // The local data belongs to a different user, we don't want to mix it
                        // Just clear and pull the new user's data
                        
                        // Clear all local data
                        await db.clearAllLocalData();
                        
                        // Pull latest data from Supabase for the new user
                        const pullResult = await sync.pullFromSupabase();
                        if (!pullResult.success) {
                            console.error('[onMount] Failed to pull data:', pullResult.error);
                        } else {
                            await db.flushDatabaseSave();
                            const pulledWorkspaces = await db.getAllWorkspaces();
                        }
                    }
                    
                    // Reload workspaces after sync
                    let loadedWorkspaces = await db.getAllWorkspaces();
                    if (loadedWorkspaces.length > 0) {
                        workspaces = loadedWorkspaces.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                        const lastActive = await db.getSettingByKey('activeWorkspaceId');
                        activeWorkspaceId =
                            workspaces.find((w) => w.id === lastActive?.value)?.id ?? workspaces[0].id;
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
                
                if (event === 'SIGNED_IN' && session) {
                    const newUserId = session.user.id;
                    const isSwitchingUsers = previousUserId && previousUserId !== newUserId;
                    
                    // CRITICAL: If onMount already handled this user's session, skip this handler
                    // This prevents duplicate clearing/pulling when Google OAuth redirects back
                    // and both onMount and this handler try to process the same login
                    if (handledUserIdInOnMount === newUserId) {
                        // Still update the state variables
                        isLoggedIn = true;
                        currentUserId = newUserId;
                        userEmail = session.user.email || null;
                        if (browser && newUserId) {
                            localStorage.setItem('neuronotes_current_user_id', newUserId);
                        }
                        return;
                    }
                    
                    // If switching to a different user, we need to sync their data
                    // If same user and already handled initial session, skip (to avoid duplicate clearing)
                    if (hasHandledInitialSession && !isSwitchingUsers) {
                        return;
                    }
                    
                    // If switching users, reset the flags so we handle the new user's session
                    if (isSwitchingUsers) {
                        hasHandledInitialSession = false;
                        handledUserIdInOnMount = null; // Reset so we can handle the new user
                    }
                    
                    isLoggedIn = true;
                    currentUserId = newUserId;
                    userEmail = session.user.email || null;
                    hasHandledInitialSession = true;
                    
                    // Store new user ID
                    if (browser && newUserId) {
                        localStorage.setItem('neuronotes_current_user_id', newUserId);
                    }
                    
                    // Flush any pending database saves before clearing
                    await db.flushDatabaseSave();
                    // Clear all local data before pulling new user's data
                    await db.clearAllLocalData();
                    // IMPORTANT: After clearing local data, we should ONLY pull from Supabase, not push
                    // Using fullSync() would push the empty local state and delete everything from Supabase!
                    const pullResult = await sync.pullFromSupabase();
                    if (!pullResult.success) {
                        console.error('Failed to pull data from Supabase:', pullResult.error);
                        alert(`Warning: Failed to restore your data from cloud. Error: ${pullResult.error}`);
                    } else {
                        // Flush database to ensure all pulled data is persisted
                        await db.flushDatabaseSave();
                        // Verify data was pulled by checking workspaces
                        const pulledWorkspaces = await db.getAllWorkspaces();
                        if (pulledWorkspaces.length === 0) {
                            console.warn('No workspaces found in Supabase for this user - data may not exist in cloud');
                            alert('No data found in cloud for this account. If you had data before, it may have been lost. Please restore from a backup if available.');
                        }
                    }
                    // Clear UI state and reload
                    calendarEvents = [];
                    
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
                    await loadActiveWorkspaceData();
                    
                    // Set up periodic sync after login
                    setupPeriodicSync();
                } else if (event === 'SIGNED_OUT') {
                    // IMPORTANT: Sync data to Supabase before clearing (if we were logged in)
                    // This ensures data is saved when user logs out via Google OAuth or other automatic logout
                    if (isLoggedIn && previousUserId) {
                        try {
                            await db.flushDatabaseSave();
                            await ensureSupabaseLoaded();
                            await sync.pushToSupabase();
                        } catch (error) {
                            console.error('[SIGNED_OUT] Failed to sync before logout:', error);
                        }
                    }
                    
                    isLoggedIn = false;
                    const loggedOutUserId = currentUserId;
                    currentUserId = null;
                    userEmail = null;
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
                    calendarEvents = [];
                    await loadActiveWorkspaceData();
                } else if (event === 'TOKEN_REFRESHED') {
                    // Session refreshed, continue working
                }
            });
            
            // Store subscription for cleanup
            (window as any).__authSubscription = subscription;
        })();

        const handleBeforeUnload = () => {
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
            // Flush database save
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
            if (timer) clearInterval(timer);
            cleanupResizeListeners();
            
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
        {userEmail}
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
                calendarEvents = [];
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
        bind:savePanelSelection
        onClose={() => showEditPanelsModal = false}
        onDone={async () => {
            if (!showNotes) {
                isNotesMinimized = false;
            }
            if (!showCalendar) {
                isCalendarMinimized = false;
            }
            if (!showKanban) {
                isKanbanMinimized = false;
            }
            
            if (savePanelSelection) {
                // Save panel preferences
                try {
                    await db.putSetting({ 
                        key: 'panelPreferences', 
                        value: JSON.stringify({ showNotes, showCalendar, showKanban }) 
                    });
                } catch (e) {
                    console.error('Failed to save panel preferences:', e);
                }
            } else {
                // Clear saved preferences and reset to defaults
                try {
                    const existing = await db.getSettingByKey('panelPreferences');
                    if (existing) {
                        await db.putSetting({ key: 'panelPreferences', value: '' });
                    }
                    // Reset to default (all panels visible)
                    showNotes = true;
                    showCalendar = true;
                    showKanban = true;
                } catch (e) {
                    console.error('Failed to clear panel preferences:', e);
                }
            }
        }}
    />

    <div
        bind:this={mainEl}
        class="main"
        class:notes-maximized={notesPanelWidth > 90}
        class:blurred={showLoginModal || showSignupModal || showEditPanelsModal}
        class:notes-only={showNotes && !showCalendar && !showKanban}
        class:calendar-only={!showNotes && showCalendar && !showKanban}
        class:kanban-only={!showNotes && !showCalendar && showKanban}
        class:notes-calendar={showNotes && showCalendar && !showKanban}
        class:notes-kanban={showNotes && !showCalendar && showKanban}
        class:calendar-kanban={!showNotes && showCalendar && showKanban}
        style="--notes-width: {notesPanelWidth}%; --calendar-height: {calendarPanelHeight}%; --calendar-width: {calendarPanelWidth}%"
    >
        {#if showNotes}
        <NotesPanel
            isMinimized={isNotesMinimized}
            {activeWorkspaceId}
            onToggleMinimized={toggleNotesMinimized}
            onSyncIfLoggedIn={syncIfLoggedIn}
            onLoadActiveWorkspaceData={loadActiveWorkspaceData}
            bind:notesPanelClientWidth
        />
        {/if}

        {#if showNotes && showCalendar && showKanban}
        <div class="resizer-wrapper vertical" class:hidden={isNotesMinimized} on:mousedown={startVerticalResize} title="Resize">
            <div class="panel-resizer-pill">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        </div>
        {/if}

        {#if showCalendar || showKanban}
        <section
            bind:this={rightEl}
            class="right"
            class:calendar-minimized={isCalendarMinimized}
            class:kanban-minimized={isKanbanMinimized}
            class:single-panel={(showCalendar && !showKanban) || (!showCalendar && showKanban)}
        >
            {#if showCalendar}
            <CalendarPanel
                isMinimized={isCalendarMinimized}
                {activeWorkspaceId}
                onToggleMinimized={toggleCalendarMinimized}
                onSyncIfLoggedIn={syncIfLoggedIn}
                onLoadActiveWorkspaceData={loadActiveWorkspaceData}
            />
            {/if}

            {#if showCalendar && showKanban && showNotes}
            <div
                class="resizer-wrapper horizontal"
                class:hidden={isCalendarMinimized || isKanbanMinimized}
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
            <KanbanPanel
                isMinimized={isKanbanMinimized}
                {activeWorkspaceId}
                onToggleMinimized={toggleKanbanMinimized}
                onSyncIfLoggedIn={syncIfLoggedIn}
                onLoadActiveWorkspaceData={loadActiveWorkspaceData}
                                        />
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
        grid-template-columns: var(--notes-width, 50%) 1fr;
        gap: 24px;
    }
    
    .main.calendar-kanban {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr;
    }
    
    .main.calendar-kanban > .resizer-wrapper.horizontal {
        display: none;
    }
    
    .main.calendar-kanban .right {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        grid-template-rows: 1fr !important;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        gap: 24px;
    }
    
    .main.calendar-kanban .right .panel {
        min-width: 0;
        min-height: 0;
    }
    
    .main.calendar-kanban .right .calendar-panel {
        grid-column: 1 !important;
        grid-row: 1 !important;
    }
    
    .main.calendar-kanban .right .kanban-panel {
        grid-column: 2 !important;
        grid-row: 1 !important;
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
    
    .main.notes-calendar .right,
    .main.notes-kanban .right {
        grid-column: 2;
        min-width: 0;
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
    .resizer-wrapper.vertical.hidden {
        visibility: hidden;
        pointer-events: none;
        min-width: 0;
        width: 0;
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
    .resizer-wrapper.horizontal.hidden {
        visibility: hidden;
        pointer-events: none;
        min-height: 0;
        height: 0;
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