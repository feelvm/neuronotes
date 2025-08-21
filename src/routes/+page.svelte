<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";

  // ----- Utilities -----
  function startOfWeek(date: Date, weekStartsOn = 1) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date: Date, n: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function ymd(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dmy(date: Date) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  // ----- Local storage helpers -----
  function loadLS<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  function saveLS<T>(key: string, value: T) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  // ----- Nav State (to do later) -----
  let isLoggedIn = false;
  function toggleAuth() {
    isLoggedIn = !isLoggedIn;
    saveLS("auth:isLoggedIn", isLoggedIn);
  }

  // ----- Notes State -----
  type Note = {
    id: string;
    title: string;
    contentHTML: string;
    updatedAt: number;
  };

  let notes: Note[] = [];
  let selectedNoteId = "";

  function selectNote(id: string) {
    selectedNoteId = id;
    saveLS("notes:selected", selectedNoteId);
  }

  function addNote() {
    const n: Note = {
      id: crypto.randomUUID(),
      title: "Untitled",
      contentHTML: "",
      updatedAt: Date.now()
    };
    notes = [n, ...notes];
    selectedNoteId = n.id;
    persistNotes();
  }

  function deleteNote(id: string) {
    const idx = notes.findIndex((n) => n.id === id);
    if (idx >= 0) {
      notes.splice(idx, 1);
      notes = [...notes];
      if (selectedNoteId === id) {
        selectedNoteId = notes[0]?.id ?? "";
      }
      persistNotes();
    }
  }

  function persistNotes() {
    saveLS("notes", notes);
    saveLS("notes:selected", selectedNoteId);
  }

  $: currentNote =
    notes.find((n) => n.id === selectedNoteId) ?? (notes[0] ?? null);

  function updateNoteTitle(note: Note, title: string) {
    note.title = title;
    note.updatedAt = Date.now();
    notes = [...notes];
    persistNotes();
  }

  function updateNoteContent(note: Note, html: string) {
    note.contentHTML = html;
    note.updatedAt = Date.now();
    notes = [...notes];
    persistNotes();
  }

  // ----- Weekly Calendar State -----
  type CalendarEvent = {
    id: string;
    date: string; // YYYY-MM-DD
    title: string;
    time?: string; // HH:MM
  };

  let calendarEvents: CalendarEvent[] = [];

  function persistCalendar() {
    saveLS("calendar:events", calendarEvents);
  }

  // SSR placeholders
  let today = new Date(0);
  let weekStart = new Date(0);

  function prevWeek() {
    weekStart = addDays(weekStart, -7);
  }
  function nextWeek() {
    weekStart = addDays(weekStart, 7);
  }

  $: weekDays = browser
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [];

  $: eventsByDay = calendarEvents.reduce((acc, event) => {
    const dayKey = event.date;
    if (!acc[dayKey]) {
      acc[dayKey] = [];
    }
    acc[dayKey].push(event);
    acc[dayKey].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  let newEventTitle = "";
  let newEventTime = "";
  let newEventDate = "1970-01-01";

  function addEvent() {
    if (!newEventTitle.trim() || !newEventDate) return;
    calendarEvents = [
      ...calendarEvents,
      {
        id: crypto.randomUUID(),
        date: newEventDate,
        title: newEventTitle.trim(),
        time: newEventTime || undefined
      }
    ];
    newEventTitle = "";
    newEventTime = "";
    newEventDate = ymd(today);
    persistCalendar();
  }

  function deleteEvent(id: string) {
    calendarEvents = calendarEvents.filter((e) => e.id !== id);
    persistCalendar();
  }

  // ----- Kanban State -----
  type Task = { id: string; text: string };
  type Column = {
    id: string;
    title: string;
    tasks: Task[];
    isCollapsed: boolean;
  };

  let kanban: Column[] = [];

  function persistKanban() {
    saveLS("kanban", kanban);
  }

  function addColumn() {
    kanban = [
      ...kanban,
      {
        id: crypto.randomUUID(),
        title: "New Column",
        tasks: [],
        isCollapsed: false
      }
    ];
    persistKanban();
  }

  function renameColumn(col: Column, title: string) {
    col.title = title;
    kanban = [...kanban];
    persistKanban();
  }

  function deleteColumn(colId: string) {
    kanban = kanban.filter((c) => c.id !== colId);
    persistKanban();
  }

  function addTask(col: Column, text: string) {
    if (!text.trim()) return;
    col.tasks.push({ id: crypto.randomUUID(), text: text.trim() });
    kanban = [...kanban];
    persistKanban();
  }

  function renameTask(col: Column, taskId: string, text: string) {
    const t = col.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.text = text;
    kanban = [...kanban];
    persistKanban();
  }

  function deleteTask(col: Column, taskId: string) {
    col.tasks = col.tasks.filter((t) => t.id !== taskId);
    kanban = [...kanban];
    persistKanban();
  }

  function toggleColumnCollapse(colId: string) {
    const col = kanban.find((c) => c.id === colId);
    if (col) {
      col.isCollapsed = !col.isCollapsed;
      kanban = [...kanban];
      persistKanban();
    }
  }

  // Drag and Drop
  let dragTask: { colId: string; taskId: string } | null = null;

  function onTaskDragStart(colId: string, taskId: string, ev: DragEvent) {
    dragTask = { colId, taskId };
    ev.dataTransfer?.setData("text/plain", JSON.stringify(dragTask));
    ev.dataTransfer?.setDragImage(new Image(), 0, 0);
  }
  function onTaskDragOver(ev: DragEvent) {
    ev.preventDefault();
  }
  function onColumnDrop(targetColId: string, ev: DragEvent) {
    ev.preventDefault();
    const data = ev.dataTransfer?.getData("text/plain");
    if (!data) return;
    const payload = JSON.parse(data) as { colId: string; taskId: string };
    if (!payload || payload.colId === targetColId) return;

    const fromCol = kanban.find((c) => c.id === payload.colId);
    const toCol = kanban.find((c) => c.id === targetColId);
    if (!fromCol || !toCol) return;

    const idx = fromCol.tasks.findIndex((t) => t.id === payload.taskId);
    if (idx < 0) return;

    const [moved] = fromCol.tasks.splice(idx, 1);
    toCol.tasks.push(moved);
    kanban = [...kanban];
    persistKanban();
  }

  // ----- Client only initialization -----
  onMount(() => {
    isLoggedIn = loadLS<boolean>("auth:isLoggedIn", false);

    // Load notes, defaulting to an empty array for new users
    notes = loadLS<Note[]>("notes", []);
    selectedNoteId = loadLS<string>("notes:selected", notes[0]?.id ?? "");

    calendarEvents = loadLS<CalendarEvent[]>("calendar:events", []);

    // Load kanban, defaulting to an empty array for new users
    const loadedKanban = loadLS<Column[]>("kanban", []);
    if (loadedKanban.length > 0) {
      kanban = loadedKanban.map((c) => ({ ...c, isCollapsed: !!c.isCollapsed }));
    } else {
      kanban = [];
    }

    today = new Date();
    weekStart = startOfWeek(today, 1);
    newEventDate = ymd(today);
  });
</script>

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
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
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

  body,
  html,
  #app {
    height: 100%;
  }

  .app {
    background: radial-gradient(
      circle at 10% 20%,
      rgba(255, 71, 87, 0.1),
      transparent 40%
    );
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
  }
  .nav .brand {
    font-weight: 700;
  }
  .nav .spacer {
    flex: 1;
  }
  .nav .btn {
    background: var(--panel-bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.2s;
  }
  .nav .btn:hover {
    border-color: var(--accent-red);
  }

  .main {
    flex: 1;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
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
  }

  .panel-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .panel-title {
    font-weight: 600;
  }

  .notes {
    display: grid;
    grid-template-columns: 180px 1fr;
    height: 100%;
  }

  .note-list {
    border-right: 1px solid var(--border);
    overflow: auto;
  }
  .note-item {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background-color 0.2s;
  }
  .note-item.active {
    background: rgba(255, 71, 87, 0.15);
  }
  .note-item .title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-editor {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .note-title {
    background: transparent;
    border: none;
    outline: none;
    font-size: 20px;
    font-weight: 600;
    color: var(--text);
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }
  .note-content {
    padding: 16px;
    flex: 1;
    overflow: auto;
  }
  .contenteditable {
    min-height: 100%;
    outline: none;
    border-radius: 8px;
    padding: 12px;
    background: var(--panel-bg-darker);
    border: 1px solid var(--border);
    transition: border-color 0.2s;
  }
  .contenteditable:focus {
    border-color: var(--accent-red);
  }

  .right {
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    gap: 24px;
    height: 100%;
    min-height: 0;
  }

  /* Calendar */
  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    border-top: 1px solid var(--border);
    border-left: 1px solid var(--border);
    flex: 1;
    min-height: 0;
  }
  .calendar-cell {
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    transition: background-color 0.2s;
  }
  .calendar-cell.today {
    background-color: rgba(255, 71, 87, 0.1);
  }
  .calendar-cell .date {
    font-size: 12px;
    color: var(--text-muted);
  }
  .calendar-cell.today .date {
    color: var(--accent-red);
    font-weight: 600;
  }
  .event {
    background: rgba(140, 122, 230, 0.2);
    border: 1px solid var(--accent-purple);
    border-radius: 8px;
    padding: 6px 8px;
    display: flex;
    justify-content: space-between;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    line-height: 1.2;
  }
  .event .time {
    color: var(--accent-purple);
    font-variant-numeric: tabular-nums;
  }
  .calendar-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
  }
  .calendar-add {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }
  .calendar-add input {
    background: var(--panel-bg-darker);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    color: var(--text);
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
  .small-btn {
    background: var(--panel-bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: border-color 0.2s;
  }
  .small-btn:hover {
    border-color: var(--accent-red);
  }
  .danger {
    color: var(--accent-red);
  }
  .danger:hover {
    border-color: var(--accent-red);
    background: rgba(255, 71, 87, 0.1);
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
    align-items: flex-start;
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
    flex-shrink: 0;
    transition: all 0.2s ease-in-out;
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
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .kanban-col.collapsed .kanban-col-header {
    justify-content: center;
    border-bottom: none;
  }
  .kanban-col-header input {
    background: transparent;
    color: var(--text);
    border: none;
    outline: none;
    font-weight: 600;
    flex: 1;
    min-width: 0;
  }
  .kanban-col.collapsed .kanban-col-header input {
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
  .kanban-tasks {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    flex: 1;
  }
  .kanban-task {
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    cursor: grab;
  }
  .kanban-task:active {
    cursor: grabbing;
    border-color: var(--accent-red);
  }
  .kanban-task input {
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
  }
  .kanban-actions {
    display: flex;
    gap: 10px;
    padding: 12px;
    border-top: 1px solid var(--border);
  }
  .kanban-actions input {
    flex: 1;
    background: var(--panel-bg-darker);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    color: var(--text);
    min-width: 0;
  }
  .kanban-actions .small-btn {
    background: var(--accent-red);
    border-color: transparent;
    color: white;
  }

  .kanban-board,
  .kanban-tasks {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .kanban-board::-webkit-scrollbar,
  .kanban-tasks::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  @media (max-width: 1100px) {
    .main {
      grid-template-columns: 1fr;
    }
    .right {
      grid-template-rows: 1fr 1fr;
    }
    .notes {
      grid-template-columns: 1fr;
    }
    .note-list {
      display: none;
    }
  }
</style>

<div class="app">
  <div class="nav">
    <div class="brand">NEURONOTES</div>
    <div class="spacer"></div>
    {#if isLoggedIn}
      <button class="btn" on:click={toggleAuth}>Account</button>
    {:else}
      <button class="btn" on:click={toggleAuth}>Login</button>
    {/if}
  </div>

  <div class="main">
    <!-- Left: Notes -->
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">Notes</div>
        <div class="spacer"></div>
        <button class="small-btn" on:click={addNote}>New Note</button>
      </div>

      <div class="notes">
        <aside class="note-list">
          {#each notes as n (n.id)}
            <div
              class="note-item {selectedNoteId === n.id ? 'active' : ''}"
              on:click={() => selectNote(n.id)}
            >
              <div class="title">{n.title || "Untitled"}</div>
              <button
                class="small-btn danger"
                on:click|stopPropagation={() => deleteNote(n.id)}
                title="Delete note"
              >
                Delete
              </button>
            </div>
          {/each}
        </aside>

        <div class="note-editor">
          {#if currentNote}
            <input
              class="note-title"
              bind:value={currentNote.title}
              on:input={(e) =>
                updateNoteTitle(
                  currentNote,
                  (e.target as HTMLInputElement).value
                )}
              placeholder="Note title..."
            />

            <div class="note-content">
              <div
                class="contenteditable"
                contenteditable="true"
                bind:innerHTML={currentNote.contentHTML}
                on:input={(e) =>
                  updateNoteContent(
                    currentNote,
                    (e.currentTarget as HTMLElement).innerHTML
                  )}
              />
            </div>
          {:else}
            <div style="padding:16px; color: var(--text-muted);">
              No notes. Create one to get started.
            </div>
          {/if}
        </div>
      </div>
    </section>

    <!-- Right: Calendar and Kanban -->
    <section class="right">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            {#if browser}Week of {dmy(weekStart)}{:else}Calendar{/if}
          </div>
          {#if browser}
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
        </div>

        {#if browser}
          <div class="calendar-grid">
            {#each weekDays as d (ymd(d))}
              <div class="calendar-cell" class:today={ymd(d) === ymd(today)}>
                <div class="date">{dmy(d)}</div>
                {#each eventsByDay[ymd(d)] || [] as ev (ev.id)}
                  <div class="event">
                    <div>
                      {#if ev.time}<span class="time">{ev.time}</span>{/if}
                      <span>{ev.title}</span>
                    </div>
                    <button
                      class="small-btn danger"
                      on:click={() => deleteEvent(ev.id)}
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
            <input
              type="date"
              bind:value={newEventDate}
              aria-label="Event date"
            />
            <input
              type="time"
              bind:value={newEventTime}
              aria-label="Event time"
            />
            <input
              type="text"
              bind:value={newEventTitle}
              placeholder="Event title"
              aria-label="Event title"
            />
            <button class="small-btn" on:click={addEvent}>Add</button>
          </div>
        {:else}
          <div style="padding:16px; color: var(--text-muted);">Loading…</div>
        {/if}
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Kanban</div>
          <div class="spacer" />
          <button class="small-btn" on:click={addColumn}>+ Column</button>
        </div>

        <div class="kanban-board">
          {#each kanban as col (col.id)}
            <div
              class="kanban-col"
              class:collapsed={col.isCollapsed}
              on:dragover={onTaskDragOver}
              on:drop={(e) => onColumnDrop(col.id, e)}
            >
              <div class="kanban-col-header">
                <button
                  class="small-btn"
                  on:click={() => toggleColumnCollapse(col.id)}
                  title={col.isCollapsed ? 'Expand' : 'Collapse'}
                >
                  {col.isCollapsed ? '⤢' : '⤡'}
                </button>
                <input
                  value={col.title}
                  on:input={(e) =>
                    renameColumn(col, (e.target as HTMLInputElement).value)}
                />
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
                  {#each col.tasks as t (t.id)}
                    <div
                      class="kanban-task"
                      draggable="true"
                      on:dragstart={(e) => onTaskDragStart(col.id, t.id, e)}
                    >
                      <input
                        value={t.text}
                        on:input={(e) =>
                          renameTask(
                            col,
                            t.id,
                            (e.target as HTMLInputElement).value
                          )}
                      />
                      <button
                        class="small-btn danger"
                        on:click={() => deleteTask(col, t.id)}
                        title="Delete task"
                      >
                        ×
                      </button>
                    </div>
                  {/each}
                </div>

                <div class="kanban-actions">
                  <input
                    type="text"
                    placeholder="New task..."
                    on:keydown={(e) => {
                      const target = e.target as HTMLInputElement;
                      if (e.key === 'Enter') {
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
                      addTask(col, input.value);
                      input.value = '';
                    }}
                  >
                    Add
                  </button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </section>
  </div>
</div>
