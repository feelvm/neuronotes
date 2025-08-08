<script lang="ts">
  // ----- Utilities -----
  const today = new Date();

  function startOfWeek(date: Date, weekStartsOn = 1) {
    // 0 = Sunday ... 6 = Saturday; default Monday (1)
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

  function prettyDate(date: Date) {
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
  }

type EventsByDate = Record<string, CalendarEvent[]>;

 $: eventsByDate = calendarEvents.reduce((acc, e) => {
   (acc[e.date] ||= []).push(e);
   return acc;
 }, {} as EventsByDate);

// Keep each day’s events sorted by time
 $: Object.values(eventsByDate).forEach((list) => {
   list.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
 });

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

  // ----- Nav State (auth mock) -----
  let isLoggedIn = loadLS<boolean>("auth:isLoggedIn", false);
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

  let notes: Note[] = loadLS<Note[]>("notes", [
    {
      id: crypto.randomUUID(),
      title: "Welcome",
      contentHTML:
        "<p>This is your notes area. Click and start typing. Content saves automatically.</p>",
      updatedAt: Date.now()
    }
  ]);
  let selectedNoteId: string = loadLS<string>(
    "notes:selected",
    notes.length ? notes[0].id : ""
  );

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
    date: string; // DD-MM-YYYY
    title: string;
    time?: string; // HH:MM
  };

  let calendarEvents: CalendarEvent[] =
    loadLS<CalendarEvent[]>("calendar:events", []);

  function persistCalendar() {
    saveLS("calendar:events", calendarEvents);
  }

  let weekStart = startOfWeek(today, 1); // Monday as start

  function prevWeek() {
    weekStart = addDays(weekStart, -7);
  }
  function nextWeek() {
    weekStart = addDays(weekStart, 7);
  }

  $: weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function eventsForDay(d: Date) {
    const dayKey = ymd(d);
    return calendarEvents
      .filter((e) => e.date === dayKey)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  let newEventTitle = "";
  let newEventTime = "";
  let newEventDate = ymd(today);

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
  type Task = {
    id: string;
    text: string;
  };
  type Column = {
    id: string;
    title: string;
    tasks: Task[];
  };

  let kanban: Column[] = loadLS<Column[]>("kanban", [
    {
      id: crypto.randomUUID(),
      title: "Todo",
      tasks: [
        { id: crypto.randomUUID(), text: "Try the app" },
        { id: crypto.randomUUID(), text: "Add your tasks" }
      ]
    },
    { id: crypto.randomUUID(), title: "Doing", tasks: [] },
    { id: crypto.randomUUID(), title: "Done", tasks: [] }
  ]);

  function persistKanban() {
    saveLS("kanban", kanban);
  }

  function addColumn() {
    kanban = [
      ...kanban,
      { id: crypto.randomUUID(), title: "New Column", tasks: [] }
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

  // Drag-and-drop for tasks
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

    if (!payload) return;
    if (payload.colId === targetColId) return;

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
</script>

<style>
  :root {
    --bg: #0b1020;
    --panel: #11172b;
    --panel-2: #0f1528;
    --muted: #7d8ab0;
    --text: #e7ebfb;
    --accent: #5f8cff;
    --accent-2: #87b0ff;
    --danger: #ff6b6b;
    --ok: #2ecc71;
    --border: #223053;
    --shadow: rgba(0, 0, 0, 0.25);
  }

  * {
    box-sizing: border-box;
    
  }

  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #0b1020; /* optional, to match your app bg */
    height: 100%;
  }

  body,
  html,
  #app {
    height: 100%;
    
  }

  .app {
    background: linear-gradient(180deg, #0b1020, #0a0f1e);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Nav */
  .nav {
    height: 50px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: rgba(15, 21, 40, 0.8);
    backdrop-filter: blur(8px);
  }
  .nav .brand {
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  .nav .spacer {
    flex: 1;
  }
  .nav .btn {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
  }
  .nav .btn:hover {
    border-color: var(--accent);
  }

  /* Layout */
  .main {
    flex: 1;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 12px;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 24px var(--shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .panel-header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--panel-2);
  }

  .panel-title {
    font-weight: 600;
  }

  /* Notes panel (left) */
  .notes {
    display: grid;
    grid-template-columns: 160px 1fr;
    height: 100%;
  }

  .note-list {
    border-right: 1px solid var(--border);
    overflow: auto;
    background: linear-gradient(180deg, #0e1430, #0e1430);
  }
  .note-list-header {
    padding: 8px;
    display: flex;
    gap: 8px;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }
  .note-list .btn {
    width: 100%;
    background: var(--accent);
    border: 1px solid transparent;
    color: #0a0f1e;
    font-weight: 600;
  }
  .note-item {
    padding: 10px 10px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .note-item.active {
    background: rgba(95, 140, 255, 0.15);
  }
  .note-item .title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-item .delete {
    color: var(--danger);
    opacity: 0.9;
    font-size: 12px;
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
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }
  .note-content {
    padding: 12px;
    flex: 1;
    overflow: auto;
  }
  .contenteditable {
    min-height: 100%;
    outline: none;
    border-radius: 8px;
    padding: 12px;
    background: #0f1633;
    border: 1px solid var(--border);
  }
  .contenteditable:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(95, 140, 255, 0.2) inset;
  }

  /* Right side split */
  .right {
    display: grid;
    grid-template-rows: 1fr 1fr;
    gap: 12px;
    height: 100%;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
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
  }
 .calendar-grid .event {
   font-size: 12px;
   line-height: 1.2;
  }
 .calendar-grid .event > div:first-child {
   flex: 1 1 auto;
   min-width: 0;
   overflow: hidden;
 }
 .calendar-grid .event > div:first-child span:last-child {
   overflow: hidden;
   text-overflow: ellipsis;
   white-space: nowrap;
 }
 .calendar-grid .event .small-btn {
   flex: 0 0 auto;
   padding: 4px 8px;
   font-size: 12px;
   line-height: 1;
 }
  .calendar-cell .date {
    font-size: 12px;
    color: var(--muted);
  }
  .event {
    background: rgba(95, 140, 255, 0.2);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 6px 8px;
    display: flex;
    justify-content: space-between;
    gap: 6px;
    align-items: center;
    font-size: 12px;
  }
  .event .time {
    color: var(--accent-2);
    font-variant-numeric: tabular-nums;
  }
  .calendar-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
  }
  .calendar-controls .btn {
    padding: 6px 10px;
  }
  .calendar-add {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--panel-2);
  }
  .calendar-add input {
    background: #0f1633;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    color: var(--text);
  }
  .small-btn {
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 5px;
    border-radius: 8px;
    cursor: pointer;
    min-width: 0;
    flex: 1 1 0;
    white-space: nowrap;
    text-align: center;
    font-size: clamp(5px, 5vw, 10px);
  }
  .small-btn:hover {
    border-color: var(--accent);
  }
  .danger {
    color: var(--danger);
  }

  /* Kanban */
  .kanban-board {
    padding: 12px;
    display: flex;
    gap: 12px;
    overflow: auto;
    flex: 1 1 0;
    min-height: 0;
   overflow-x: auto;
   overflow-y: hidden;
  }
  .kanban-col {
    min-width: 220px;
    background: #0f1633;
    border: 1px solid var(--border);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    max-height: 100%;
    flex-wrap: nowrap;
    height: 100%;
   overflow-y: auto;
   overflow-x: hidden;
  }
  .kanban-col-header {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 5px;
    border-bottom: 1px solid var(--border);
    flex-wrap: nowrap;
  }
  .kanban-col-header input {
    background: transparent;
    color: var(--text);
    border: none;
    outline: none;
    font-weight: 600;
    
  }
  .kanban-tasks {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    flex: 1 1 auto; 
    min-height: 0;
    overflow-y: auto;
  }
  .kanban-task {
    background: #121a3a;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    cursor: grab;
  }
  .kanban-task:active {
    cursor: grabbing;
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
    flex: 0 0 auto;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid var(--border);
  }
  .kanban-actions input {
    flex: 1 1 auto;
    min-width: 0;
    background: #0f1633;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    color: var(--text);
  }

.kanban-actions .small-btn {
  flex: 0 0 54px; /* wider button; tweak 72–100px to taste */
  padding: 6px 12px;
  font-size: 10px;
}

  /* Responsive */
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

.kanban-board,
.kanban-tasks {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE 10+ */
}
.kanban-board::-webkit-scrollbar,
.kanban-tasks::-webkit-scrollbar {
  width: 0;
  height: 0; /* WebKit */
}
</style>

<div class="app">
  <div class="nav">
    <div class="brand">Productivity Hub</div>
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
          <div class="note-list-header">
            <button class="btn" on:click={addNote}>+ Add Note</button>
          </div>
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
                updateNoteTitle(currentNote, (e.target as HTMLInputElement).value)}
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
                  )}>
              </div>
            </div>
          {:else}
            <div style="padding:12px">No notes. Create one to get started.</div>
          {/if}
        </div>
      </div>
    </section>

    <!-- Right: Calendar (top) and Kanban (bottom) -->
    <section class="right">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            Week of {dmy(weekStart)}
          </div>
          <div class="calendar-controls">
            <button class="small-btn" on:click={prevWeek}>&larr; Prev</button>
            <button class="small-btn" on:click={() => (weekStart = startOfWeek(today, 1))}>
              Today
            </button>
            <button class="small-btn" on:click={nextWeek}>Next &rarr;</button>
          </div>
        </div>

        <div class="calendar-grid">
          {#each weekDays as d (ymd(d))}
            <div class="calendar-cell">
              <div class="date">{dmy(d)}</div>
              {#each eventsForDay(d) as ev (ev.id)}
                <div class="event">
                  <div style="display:flex; gap:6px; align-items:center;">
                    {#if ev.time}
                      <span class="time">{ev.time}</span>
                    {/if}
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
              on:dragover={onTaskDragOver}
              on:drop={(e) => onColumnDrop(col.id, e)}
            >
              <div class="kanban-col-header">
                <input
                  value={col.title}
                  on:input={(e) =>
                    renameColumn(col, (e.target as HTMLInputElement).value)}
                />
                <button
                  class="small-btn danger"
                  on:click={() => deleteColumn(col.id)}
                  title="Delete column"
                >
                  Delete
                </button>
              </div>

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
                    if (e.key === "Enter") {
                      addTask(col, target.value);
                      target.value = "";
                    }
                  }}
                />
                <button
                  class="small-btn"
                  on:click={(e) => {
                    const input = (e.currentTarget as HTMLElement)
                      .previousElementSibling as HTMLInputElement;
                    addTask(col, input.value);
                    input.value = "";
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>
  </div>
</div>
