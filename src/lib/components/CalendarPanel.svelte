<script lang="ts">
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import * as db from '$lib/db';
    import { generateUUID } from '$lib/utils/uuid';
    import { ymd, dmy, startOfWeek, localDateFromYMD } from '$lib/utils/dateHelpers';
    import type { CalendarEvent } from '$lib/db_types';

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

    // Props
    export let isMinimized: boolean;
    export let activeWorkspaceId: string | null;
    export let onToggleMinimized: () => void;
    export let onSyncIfLoggedIn: () => Promise<void>;
    export let onLoadActiveWorkspaceData: () => Promise<void>;

    // Icons
    const GlobeIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0ZM7 14.93C4.05 14.44 1.56 11.95 1.07 9H3.09C3.57 10.84 5.16 12.43 7 12.91V14.93ZM7 11.93C5.84 11.6 4.4 10.16 4.07 9H7V11.93ZM7 8H4.07C4.4 6.84 5.84 5.4 7 5.07V8ZM7 4.09C5.16 4.57 3.57 6.16 3.09 8H1.07C1.56 5.05 4.05 2.56 7 2.07V4.09ZM9 2.07C11.95 2.56 14.44 5.05 14.93 8H12.91C12.43 6.16 10.84 4.57 9 4.09V2.07ZM9 5.07C10.16 5.4 11.6 6.84 11.93 8H9V5.07ZM9 9H11.93C11.6 10.16 10.16 11.6 9 11.93V9ZM9 12.91C10.84 12.43 12.43 10.84 12.91 9H14.93C14.44 11.95 11.95 14.44 9 14.93V12.91Z" fill="currentColor"/>
    </svg>`;

    const FolderIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 3C1.45 3 1 3.45 1 4V13C1 13.55 1.45 14 2 14H14C14.55 14 15 13.55 15 13V5C15 4.45 14.55 4 14 4H8L6.5 2.5C6.22 2.22 5.78 2 5.5 2H2ZM2 3H5.5L7 4.5C7.28 4.78 7.72 5 8 5H14V13H2V4V3Z" fill="currentColor"/>
    </svg>`;

    const RepeatIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 2L21 6M21 6L17 10M21 6H7.8C6.11984 6 5.27976 6 4.63803 6.32698C4.07354 6.6146 3.6146 7.07354 3.32698 7.63803C3 8.27976 3 9.11984 3 10.8V11M3 18H16.2C17.8802 18 18.7202 18 19.362 17.673C19.9265 17.3854 20.3854 16.9265 20.673 16.362C21 15.7202 21 14.8802 21 13.2V13M3 18L7 22M3 18L7 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    // State
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
                  const viewDate = new Date(currentDayViewDate);
                  viewDate.setHours(0, 0, 0, 0);
                  return Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(viewDate);
                      d.setDate(d.getDate() + i);
                      return d;
                  });
              } else {
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
                if (!a.time && !b.time) return 0;
                if (!a.time) return -1;
                if (!b.time) return 1;
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
    const eventColors = ['#FF4444', '#FF8800', '#FFD700', '#4CAF50', '#8C7AE6', '#2196F3', '#03A9F4'];
    let newEventColor = '#8C7AE6';
    let showRepeatOptions = false;
    
    // Event editing state
    let editingEventId: string | null = null;
    let editingEventDate: string | null = null;
    let editingEventTitle = '';
    let editingEventTime = '';

    function cycleEventColor() {
        const currentIndex = eventColors.indexOf(newEventColor);
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % eventColors.length;
        newEventColor = eventColors[nextIndex];
    }

    function hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
        const trimmed = dateStr.trim();
        
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
        
        if (year.length !== 4) return null;
        
        const dayNum = parseInt(day, 10);
        const monthNum = parseInt(month, 10);
        const yearNum = parseInt(year, 10);
        
        if (isNaN(dayNum) || isNaN(monthNum) || isNaN(yearNum)) return null;
        if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) return null;
        
        const date = new Date(yearNum, monthNum - 1, dayNum);
        if (date.getDate() !== dayNum || date.getMonth() !== monthNum - 1 || date.getFullYear() !== yearNum) {
            return null;
        }
        
        return `${yearNum}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
    }

    function startEditingEvent(event: CalendarEvent, dateKey: string) {
        editingEventId = event.id;
        editingEventDate = dateKey;
        editingEventTitle = event.title;
        editingEventTime = event.time || '';
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

        let formattedTime = editingEventTime.trim();
        if (formattedTime) {
            const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
            if (!timePattern.test(formattedTime)) {
                alert('Invalid time format. Please use HH:MM format (24-hour, e.g., 14:30).');
                return;
            }
            const [hours, minutes] = formattedTime.split(':');
            formattedTime = `${hours.padStart(2, '0')}:${minutes}`;
        }

        // Save values before closing UI
        const savedTitle = editingEventTitle.trim();
        const savedTime = formattedTime || undefined;
        const eventId = editingEventId;
        const eventDate = editingEventDate;
        
        // Close editing UI immediately for better UX
        cancelEditingEvent();

        try {
            const updatedEvent: CalendarEvent = {
                ...event,
                title: savedTitle,
                time: savedTime
            };
            
            // Update UI optimistically
            const index = calendarEvents.findIndex((e) => e.id === event.id);
            if (index !== -1) {
                calendarEvents[index] = updatedEvent;
                calendarEvents = [...calendarEvents];
            }
            
            // Save to database and sync in background (don't await to avoid blocking)
            db.putCalendarEvent(updatedEvent).then(() => {
                return onSyncIfLoggedIn();
            }).catch((error) => {
                console.error('Failed to update event:', error);
                // Revert UI changes on error
                const revertIndex = calendarEvents.findIndex((e) => e.id === event.id);
                if (revertIndex !== -1) {
                    calendarEvents[revertIndex] = event;
                    calendarEvents = [...calendarEvents];
                }
                alert(`Failed to update event: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
        } catch (error) {
            console.error('Failed to update event:', error);
            // Revert UI changes on error
            const index = calendarEvents.findIndex((e) => e.id === event.id);
            if (index !== -1) {
                calendarEvents[index] = event;
                calendarEvents = [...calendarEvents];
            }
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

        const isoDate = convertDateToISO(newEventDate);
        if (!isoDate) {
            alert('Invalid date format. Please use one of these formats: D/M/YYYY, D.M.YYYY, DD.MM.YYYY, D-M-YYYY, DD-MM-YYYY, or DD/MM/YYYY.');
            return;
        }

        let formattedTime = newEventTime.trim();
        if (formattedTime) {
            const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
            if (!timePattern.test(formattedTime)) {
                alert('Invalid time format. Please use HH:MM format (24-hour, e.g., 14:30).');
                return;
            }
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
            await onSyncIfLoggedIn();
            
            // Reset form
            newEventTitle = '';
            newEventTime = '';
            newEventRepeat = 'none';
            newEventCustomDays = [false, false, false, false, false, false, false];
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
        isCalendarLoaded = false;
        await loadCalendarEvents();
    }

    async function deleteEvent(event: CalendarEvent, specificDate?: string) {
        if (!event.repeat || event.repeat === 'none') {
            const confirmed = await showDeleteDialog(`Are you sure you want to delete "${event.title}"?`);
            if (confirmed) {
                await db.deleteCalendarEvent(event.id);
                calendarEvents = calendarEvents.filter((e) => e.id !== event.id);
                await onSyncIfLoggedIn();
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
                    await onSyncIfLoggedIn();
                }
            } else if (choice === 'all') {
                await db.deleteCalendarEvent(event.id);
                calendarEvents = calendarEvents.filter((e) => e.id !== event.id);
                await onSyncIfLoggedIn();
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
            
            const sanitizedMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
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

    // Load calendar mode setting
    onMount(async () => {
        if (browser) {
            const setting = await db.getSettingByKey('useCommonCalendar');
            if (setting?.value) {
                useCommonCalendar = setting.value;
            }
        }
    });

    // Load events when not minimized
    $: if (browser && !isMinimized && !isCalendarLoaded && activeWorkspaceId) {
        loadCalendarEvents();
    }

    // Update today date/time
    $: if (browser) {
        today = new Date();
        todayDateString = `${DAY_NAMES_LONG[today.getDay()]}, ${dmy(today)}`;
        const hours = String(today.getHours()).padStart(2, '0');
        const minutes = String(today.getMinutes()).padStart(2, '0');
        todayTimeString = `${hours}:${minutes}`;
    }

    // Reset loaded flag when workspace changes
    $: if (activeWorkspaceId) {
        isCalendarLoaded = false;
    }
</script>

<div class="panel calendar-panel" class:minimized={isMinimized}>
    <div class="panel-header">
        <div class="panel-title today-header">
            <span class="date">{todayDateString}</span>
            <span class="time">{todayTimeString}</span>
        </div>
        <div class="spacer"></div>
        {#if browser && !isMinimized}
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
                    on:click={() => (startWithCurrentDay = !startWithCurrentDay)}
                    title={startWithCurrentDay ? 'Start week with Monday' : 'Start week with current day'}
                >
                    {startWithCurrentDay ? 'Mon' : 'Today'}
                </button>
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

    {#if browser && !isMinimized}
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
                                            // Close editing when clicking elsewhere (with delay to allow switching between inputs)
                                            setTimeout(() => {
                                                const activeElement = document.activeElement;
                                                const titleInput = document.querySelector('.event-edit-title') as HTMLElement;
                                                const timeInput = document.querySelector('.event-edit-time') as HTMLElement;
                                                // Only close if neither input is focused
                                                if (activeElement !== titleInput && activeElement !== timeInput) {
                                                    saveEditedEvent();
                                                }
                                            }, 50);
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
                                            // Close editing when clicking elsewhere (with delay to allow switching between inputs)
                                            setTimeout(() => {
                                                const activeElement = document.activeElement;
                                                const titleInput = document.querySelector('.event-edit-title') as HTMLElement;
                                                const timeInput = document.querySelector('.event-edit-time') as HTMLElement;
                                                // Only close if neither input is focused
                                                if (activeElement !== titleInput && activeElement !== timeInput) {
                                                    saveEditedEvent();
                                                }
                                            }, 50);
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
    {:else if !isMinimized}
        <div style="padding:16px; color: var(--text-muted);">Loading…</div>
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
        position: relative;
        border-bottom: none;
    }

    .panel.minimized .panel-minimize-btn {
        position: absolute;
        right: 12px;
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
    }

    .panel-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    .calendar-panel {
        overflow: visible !important;
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

    .event-details .title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .event .time {
        color: var(--accent-purple);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
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
        box-sizing: border-box;
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

    .color-cycle-btn {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        cursor: pointer;
        flex-shrink: 0;
        transition: transform 0.1s, opacity 0.2s;
        box-sizing: border-box;
    }

    .color-cycle-btn:hover {
        transform: scale(1.05);
        opacity: 0.9;
    }

    .color-cycle-btn:active {
        transform: scale(0.95);
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
        box-sizing: border-box;
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
        box-sizing: border-box;
    }

    .small-btn:hover {
        border-color: var(--accent-red);
    }

    .small-btn.active {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
    }

    @media (max-width: 1200px) {
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
    }
</style>

