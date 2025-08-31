<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import * as db from "$lib/db";
  import type {
    Workspace,
    Note,
    CalendarEvent,
    Column,
    Kanban,
    Task
  } from "$lib/db";
  
  let DOMPurify: any;
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ----- Actions -----
  function focus(node: HTMLElement) {
    node.focus();
    return {
      destroy() {}
    };
  }

  // ----- Utilities -----
  function debounce<T extends (...args: any[]) => any>(
    func: T,
    timeout = 300
  ) {
    let timer: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, timeout);
    };
  }

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

  // ----- Workspace State -----
  let workspaces: Workspace[] = [];
  let activeWorkspaceId = "";
  let editingWorkspaceId: string | null = null;

  $: activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  async function switchWorkspace(id: string) {
    if (id === activeWorkspaceId) return;
    activeWorkspaceId = id;
    await db.put("settings", { key: "activeWorkspaceId", value: id });
    await loadActiveWorkspaceData();
  }

  async function addWorkspace() {
    const name = prompt("Enter new workspace name:", "New Workspace");
    if (!name || !name.trim()) return;

    const newWorkspace: Workspace = {
      id: crypto.randomUUID(),
      name: name.trim()
    };
    await db.put("workspaces", newWorkspace);
    workspaces = [...workspaces, newWorkspace];
    await switchWorkspace(newWorkspace.id);
  }

  async function renameWorkspace(id: string, newName: string) {
    const ws = workspaces.find((w) => w.id === id);
    if (ws && newName.trim()) {
      ws.name = newName.trim();
      await db.put("workspaces", ws);
      workspaces = [...workspaces];
    }
    editingWorkspaceId = null;
  }

  async function deleteWorkspace(id: string) {
    if (workspaces.length <= 1) {
      alert("Cannot delete the last workspace.");
      return;
    }
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;

    if (
      !confirm(
        `Are you sure you want to delete "${ws.name}"? All its data will be lost.`
      )
    ) {
      return;
    }

    const notesToDelete = await db.getAllByIndex<Note>("notes", "workspaceId", id);
    for (const note of notesToDelete) {
      await db.remove("notes", note.id);
    }
    const eventsToDelete = await db.getAllByIndex<CalendarEvent>(
      "calendarEvents",
      "workspaceId",
      id
    );
    for (const event of eventsToDelete) {
      await db.remove("calendarEvents", event.id);
    }
    await db.remove("kanban", id);
    await db.remove("workspaces", id);

    workspaces = workspaces.filter((w) => w.id !== id);

    if (activeWorkspaceId === id) {
      await switchWorkspace(workspaces[0].id);
    }
  }

  // ----- Notes State -----
  let notes: Note[] = [];
  let selectedNoteId = "";

  async function selectNote(id: string) {
    selectedNoteId = id;
    await db.put("settings", {
      key: `selectedNoteId:${activeWorkspaceId}`,
      value: id
    });
  }

  async function addNote() {
    const n: Note = {
      id: crypto.randomUUID(),
      title: "Untitled",
      contentHTML: "",
      updatedAt: Date.now(),
      workspaceId: activeWorkspaceId
    };
    await db.put("notes", n);
    notes = [n, ...notes];
    await selectNote(n.id);
  }

  async function deleteNote(id: string) {
    await db.remove("notes", id);
    notes = notes.filter((n) => n.id !== id);
    if (selectedNoteId === id) {
      await selectNote(notes[0]?.id ?? "");
    }
  }

  $: currentNote =
    notes.find((n) => n.id === selectedNoteId) ?? (notes[0] ?? null);

  async function updateNote(note: Note) {
    note.updatedAt = Date.now();
    // +++ SECURITY: Sanitize HTML content before saving
    if (browser && DOMPurify) {
      note.contentHTML = DOMPurify.sanitize(note.contentHTML);
    }
    await db.put("notes", note);
  }

  const debouncedUpdateNote = debounce(updateNote, 400);

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  }

  // ----- Weekly Calendar State -----
  let calendarEvents: CalendarEvent[] = [];
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
    if (!acc[dayKey]) acc[dayKey] = [];
    acc[dayKey].push(event);
    acc[dayKey].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  let newEventTitle = "";
  let newEventTime = "";
  let newEventDate = "1970-01-01";

  async function addEvent() {
    if (!newEventTitle.trim() || !newEventDate) return;
    const newEvent: CalendarEvent = {
      id: crypto.randomUUID(),
      date: newEventDate,
      title: newEventTitle.trim(),
      time: newEventTime || undefined,
      workspaceId: activeWorkspaceId
    };
    await db.put("calendarEvents", newEvent);
    calendarEvents = [...calendarEvents, newEvent];
    newEventTitle = "";
    newEventTime = "";
    newEventDate = ymd(today);
  }

  async function deleteEvent(id: string) {
    await db.remove("calendarEvents", id);
    calendarEvents = calendarEvents.filter((e) => e.id !== id);
  }

  // ----- Kanban State -----
  let kanban: Column[] = [];
  let editingColumnId: string | null = null;
  let editingTaskId: string | null = null;

  async function persistKanban() {
    if (!activeWorkspaceId || !kanban) return;
    const kanbanData: Kanban = { workspaceId: activeWorkspaceId, columns: kanban };
    await db.put("kanban", kanbanData);
  }

  $: if (browser && kanban.length > 0) {
    persistKanban();
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
  }

  function renameColumn(col: Column, title: string) {
    if (title.trim()) {
      col.title = title.trim();
      kanban = [...kanban];
    }
    editingColumnId = null;
  }

  function deleteColumn(colId: string) {
    kanban = kanban.filter((c) => c.id !== colId);
  }

  function addTask(col: Column, text: string) {
    if (!text.trim()) return;
    col.tasks.push({ id: crypto.randomUUID(), text: text.trim() });
    kanban = [...kanban];
  }

  function renameTask(col: Column, taskId: string, text: string) {
    const t = col.tasks.find((x) => x.id === taskId);
    if (t && text.trim()) {
      t.text = text.trim();
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

  // ----- Drag and Drop -----
  let isDragging = false;
  let draggedTaskGhost: { id: string; text: string; x: number; y: number } | null =
    null;

  function onTaskDragStart(
    colId: string,
    task: Task,
    ev: DragEvent
  ) {
    isDragging = true;
    draggedTaskGhost = { id: task.id, text: task.text, x: ev.clientX, y: ev.clientY };
    ev.dataTransfer?.setData("text/plain", JSON.stringify({ colId, taskId: task.id }));
    ev.dataTransfer!.effectAllowed = "move";
    ev.dataTransfer?.setDragImage(new Image(), 0, 0);
    window.addEventListener('dragover', updateGhostPosition);
  }

  function updateGhostPosition(ev: DragEvent) {
    if (!draggedTaskGhost) return;
    if (ev.clientX === 0 && ev.clientY === 0) {
      return;
    }
    draggedTaskGhost = {
      ...draggedTaskGhost,
      x: ev.clientX,
      y: ev.clientY
    };
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
  }

  function handleDragEnd() {
    isDragging = false;
    draggedTaskGhost = null;
    window.removeEventListener('dragover', updateGhostPosition);
  }

  // ----- Data Loading -----
  async function loadActiveWorkspaceData() {
    if (!browser || !activeWorkspaceId) return;

    const loadedNotes = await db.getAllByIndex<Note>(
      "notes",
      "workspaceId",
      activeWorkspaceId
    );
    notes = loadedNotes.sort((a, b) => b.updatedAt - a.updatedAt);

    const selectedNoteSetting = await db.get(
      "settings",
      `selectedNoteId:${activeWorkspaceId}`
    );
    selectedNoteId = selectedNoteSetting?.value ?? notes[0]?.id ?? "";

    calendarEvents = await db.getAllByIndex<CalendarEvent>(
      "calendarEvents",
      "workspaceId",
      activeWorkspaceId
    );

    const kanbanData = await db.get<Kanban>("kanban", activeWorkspaceId);
    kanban = kanbanData
      ? kanbanData.columns.map((c) => ({ ...c, isCollapsed: !!c.isCollapsed }))
      : [];
  }

  // ----- Lifecycle -----
  onMount(async () => {
    DOMPurify = (await import("dompurify")).default;
    
    const loadedWorkspaces = await db.getAll<Workspace>("workspaces");
    if (loadedWorkspaces.length > 0) {
      workspaces = loadedWorkspaces;
    } else {
      const defaultWorkspace = {
        id: crypto.randomUUID(),
        name: "My Workspace"
      };
      await db.put("workspaces", defaultWorkspace);
      workspaces = [defaultWorkspace];
    }

    const lastActive = await db.get("settings", "activeWorkspaceId");
    const lastActiveId = lastActive?.value ?? "";
    if (lastActiveId && workspaces.some((w) => w.id === lastActiveId)) {
      activeWorkspaceId = lastActiveId;
    } else {
      activeWorkspaceId = workspaces[0].id;
      await db.put("settings", {
        key: "activeWorkspaceId",
        value: activeWorkspaceId
      });
    }

    await loadActiveWorkspaceData();

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
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .note-list::-webkit-scrollbar {
    display: none;
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
    min-height: 0;
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
  .calendar-cell .day-name {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: -2px;
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
  .kanban-col-title-text {
    font-weight: 600;
    flex: 1;
    min-width: 0;
    cursor: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    font-size: 1rem;
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
    scroll-behavior: smooth;
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
    transition: opacity 0.2s;
  }
  .kanban-task.dragging {
    opacity: 0.4;
  }
  .kanban-task:active {
    cursor: grabbing;
    border-color: var(--accent-red);
  }
  .kanban-task-text {
    min-width: 0;
    cursor: text;
    overflow-wrap: break-word;
  }
  .kanban-task input {
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 1rem;
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

  .kanban-task-ghost {
    position: fixed;
    pointer-events: none;
    z-index: 9999;
    background: var(--panel-bg);
    border: 1px solid var(--accent-red);
    border-radius: 10px;
    padding: 10px;
    width: 218px; /* 240px col - 2*12px padding - 2*1px border */
    transform: translate(-50%, -50%) rotate(3deg);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
    opacity: 0.95;
  }

  /* ----- Responsive Styles ----- */
  @media (max-width: 1200px) {
    .main {
      grid-template-columns: 1fr;
      overflow-y: auto;
      overflow-x: hidden;
      scroll-behavior: smooth;
    }
    .panel {
      min-height: 500px;
    }
    .right {
      grid-template-rows: 1fr 1fr;
    }
  }

  @media (max-width: 768px) {
    .main {
      padding: 12px;
      gap: 12px;
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
      grid-template-rows: auto auto;
      grid-template-columns: 1fr;
    }
    .calendar-grid {
      grid-template-columns: 1fr;
      border-top: none;
      border-left: none;
    }
    .calendar-cell {
      border-left: 1px solid var(--border);
    }
    .calendar-add {
      flex-wrap: wrap;
    }
    .calendar-add input[type="text"] {
      flex-basis: 100%;
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
</style>

{#if isDragging && draggedTaskGhost}
  <div
    class="kanban-task-ghost"
    style="left: {draggedTaskGhost.x}px; top: {draggedTaskGhost.y}px;"
  >
    {draggedTaskGhost.text}
  </div>
{/if}

<div class="app">
  <div class="nav">
    <div class="brand">NEURONOTES</div>

    <div class="workspace-tabs">
      {#each workspaces as ws (ws.id)}
        <div
          class="workspace-tab"
          class:active={ws.id === activeWorkspaceId}
          on:click={() => switchWorkspace(ws.id)}
        >
          {#if editingWorkspaceId === ws.id}
            <input
              value={ws.name}
              use:focus
              on:blur={(e) =>
                renameWorkspace(ws.id, (e.target as HTMLInputElement).value)}
              on:keydown={(e) => {
                if (e.key === 'Enter')
                  (e.target as HTMLInputElement).blur();
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
      <button
        class="add-workspace-btn"
        on:click={addWorkspace}
        title="New Workspace"
      >
        +
      </button>
    </div>

    <div class="spacer"></div>
    <div class="nav-right-placeholder"></div>
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
              value={currentNote.title}
              on:input={(e) => {
                currentNote.title = (e.target as HTMLInputElement).value;
                debouncedUpdateNote(currentNote);
              }}
              placeholder="Note title..."
            />

            <div class="note-content">
              <div
                class="contenteditable"
                contenteditable="true"
                innerHTML={currentNote.contentHTML}
                on:input={(e) => {
                  currentNote.contentHTML = (
                    e.currentTarget as HTMLElement
                  ).innerHTML;
                  debouncedUpdateNote(currentNote);
                }}
                on:paste={handlePaste}
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
            {#each weekDays as d, i (ymd(d))}
              <div class="calendar-cell" class:today={ymd(d) === ymd(today)}>
                <div class="date">{dmy(d)}</div>
                <div class="day-name">{DAY_NAMES[i]}</div>
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

                {#if editingColumnId === col.id}
                  <input
                    value={col.title}
                    use:focus
                    on:blur={(e) =>
                      renameColumn(col, (e.target as HTMLInputElement).value)}
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
                  {#each col.tasks as t (t.id)}
                    <div
                      class="kanban-task"
                      class:dragging={isDragging && draggedTaskGhost?.id === t.id}
                      draggable="true"
                      on:dragstart={(e) => onTaskDragStart(col.id, t, e)}
                      on:dragend={handleDragEnd}
                    >
                      {#if editingTaskId === t.id}
                        <input
                          value={t.text}
                          use:focus
                          on:blur={(e) =>
                            renameTask(
                              col,
                              t.id,
                              (e.target as HTMLInputElement).value
                            )}
                          on:keydown={(e) => {
                            if (e.key === 'Enter')
                              (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') editingTaskId = null;
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
