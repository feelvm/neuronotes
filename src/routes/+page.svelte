<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import Spreadsheet from "$lib/components/Spreadsheet.svelte";
  import * as db from "$lib/db";
  import type {
    Workspace,
    Note,
    Folder,
    CalendarEvent,
    Column,
    Kanban,
    Task,
    SpreadsheetCell
  } from "$lib/db";

  let DOMPurify: any;
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let editorDiv: HTMLElement; // Reference to the contenteditable div
  let selectedFontSize = 14; // To display the current font size
  let spreadsheetComponentInstance: Spreadsheet;
  let selectedSheetCell: { row: number; col: number } | null = null;
  let sheetSelection: {
    start: { row: number; col: number };
    end: { row: number; col: number };
  } | null = null;

  $: canMergeOrUnmerge = (() => {
    if (!sheetSelection) return false;
    const { start, end } = sheetSelection;
    const minRow = Math.min(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxRow = Math.max(start.row, end.row);
    const maxCol = Math.max(start.col, end.col);

    if (minRow !== maxRow || minCol !== maxCol) return true;

    if (currentNote?.spreadsheet) {
      const cell = currentNote.spreadsheet.data[minRow][minCol];
      return (cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1;
    }
    return false;
  })();

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
    let pendingArgs: Parameters<T> | null = null;

    const debounced = (...args: Parameters<T>) => {
      pendingArgs = args;
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
        pendingArgs = null;
      }, timeout);
    };

    debounced.flush = () => {
      clearTimeout(timer);
      if (pendingArgs) {
        func.apply(this, pendingArgs);
        pendingArgs = null;
      }
    };
    return debounced;
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

  // ----- Text Formatting -----
  function applyFormat(command: string) {
    if (editorDiv) editorDiv.focus(); // Ensure editor has focus
    document.execCommand(command, false);
  }

  function modifyFontSize(amount: number) {
    if (editorDiv) editorDiv.focus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    const parentElement =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : (range.commonAncestorContainer as HTMLElement);

    if (parentElement && editorDiv.contains(parentElement)) {
      const currentSize =
        window.getComputedStyle(parentElement).fontSize || "14px";
      const newSize = Math.max(8, parseInt(currentSize) + amount);

      const contents = range.extractContents();
      const span = document.createElement("span");
      span.style.fontSize = `${newSize}px`;
      span.appendChild(contents);
      range.insertNode(span);

      selection.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      selection.addRange(newRange);

      selectedFontSize = newSize;

      editorDiv.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function updateSelectedFontSize() {
    if (!browser || !editorDiv) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const parentElement =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : (range.commonAncestorContainer as HTMLElement);

    if (parentElement && editorDiv.contains(parentElement)) {
      const sizeStr = window.getComputedStyle(parentElement).fontSize || "14px";
      selectedFontSize = parseInt(sizeStr);
    }
  }

  // ----- Workspace State -----
  let workspaces: Workspace[] = [];
  let activeWorkspaceId = "";
  let editingWorkspaceId: string | null = null;

  $: activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  async function switchWorkspace(id: string) {
    if (id === activeWorkspaceId) return;
    debouncedUpdateNote.flush();
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

    const notesToDelete = await db.getAllByIndex<Note>(
      "notes",
      "workspaceId",
      id
    );
    for (const note of notesToDelete) {
      await db.remove("notes", note.id);
    }
    const foldersToDelete = await db.getAllByIndex<Folder>(
      "folders",
      "workspaceId",
      id
    );
    for (const folder of foldersToDelete) {
      await db.remove("folders", folder.id);
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

  // ----- Notes & Folders State -----
  let notes: Note[] = [];
  let folders: Folder[] = [];
  let selectedNoteId = "";
  let currentFolderId: string | null = null;
  let dragOverFolderId: string | null = null;
  let dropIndex: number | null = null;
  let editingFolderId: string | null = null;
  let isEditingHeaderName = false;
  let dragOverRoot = false;

  type DisplayItem = (Note & { type: "note" }) | (Folder & { type: "folder" });
  let displayList: DisplayItem[] = [];
  $: {
    if (currentFolderId === null) {
      const rootNotes = notes
        .filter((n) => n.folderId === null)
        .map((n) => ({ ...n, type: "note" as const }));
      const allFolders = folders.map((f) => ({
        ...f,
        type: "folder" as const
      }));
      displayList = [...allFolders, ...rootNotes].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
    } else {
      displayList = notes
        .filter((n) => n.folderId === currentFolderId)
        .map((n) => ({ ...n, type: "note" as const }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
  }

  $: currentFolder = folders.find((f) => f.id === currentFolderId);
  async function selectNote(id: string) {
    if (selectedNoteId === id) return;
    debouncedUpdateNote.flush();
    selectedSheetCell = null;
    sheetSelection = null;
    selectedNoteId = id;
    await db.put("settings", {
      key: `selectedNoteId:${activeWorkspaceId}`,
      value: id
    });
  }

  async function addNote() {
    const notesInCurrentView = displayList.filter(
      (item) => item.type === "note"
    );
    const n: Note = {
      id: crypto.randomUUID(),
      title: "Untitled",
      contentHTML: "",
      updatedAt: Date.now(),
      workspaceId: activeWorkspaceId,
      folderId: currentFolderId,
      order: notesInCurrentView.length
    };
    await db.put("notes", n);
    notes = [...notes, n];
    await selectNote(n.id);
  }

  function createEmptySpreadsheet(rows = 50, cols = 20) {
    const data: SpreadsheetCell[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ value: "" }))
    );
    const colWidths: Record<number, number> = {};
    for (let i = 0; i < cols; i++) colWidths[i] = 100;
    const rowHeights: Record<number, number> = {};
    for (let i = 0; i < rows; i++) rowHeights[i] = 25;
    return { data, colWidths, rowHeights };
  }

  async function addSpreadsheetNote() {
    const notesInCurrentView = displayList.filter(
      (item) => item.type === "note"
    );
    const n: Note = {
      id: crypto.randomUUID(),
      title: "Untitled Spreadsheet",
      contentHTML: "",
      updatedAt: Date.now(),
      workspaceId: activeWorkspaceId,
      folderId: currentFolderId,
      order: notesInCurrentView.length,
      type: "spreadsheet",
      spreadsheet: createEmptySpreadsheet()
    };
    await db.put("notes", n);
    notes = [...notes, n];
    await selectNote(n.id);
  }

  async function addFolder() {
    const name = prompt("Enter new folder name:", "New Folder");
    if (!name || !name.trim()) return;
    const f: Folder = {
      id: crypto.randomUUID(),
      name: name.trim(),
      workspaceId: activeWorkspaceId,
      order: displayList.length
    };
    await db.put("folders", f);
    folders = [...folders, f];
  }

  async function renameFolder(id: string, newName: string) {
    const folder = folders.find((f) => f.id === id);
    if (folder && newName.trim()) {
      folder.name = newName.trim();
      await db.put("folders", folder);
      folders = [...folders];
    }
    editingFolderId = null;
    isEditingHeaderName = false;
  }

  async function deleteFolder(folderId: string) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    if (
      !confirm(
        `Are you sure you want to delete the folder "${folder.name}"? All notes inside will be PERMANENTLY DELETED.`
      )
    ) {
      return;
    }

    const notesToDelete = await db.getAllByIndex<Note>(
      "notes",
      "workspaceId_folderId",
      [activeWorkspaceId, folderId]
    );
    const deleteNotePromises = notesToDelete.map((note) =>
      db.remove("notes", note.id)
    );
    await Promise.all(deleteNotePromises);

    await db.remove("folders", folderId);

    const deletedNoteIds = new Set(notesToDelete.map((n) => n.id));
    notes = notes.filter((n) => !deletedNoteIds.has(n.id));
    folders = folders.filter((f) => f.id !== folderId);

    await goBack();
  }

  async function deleteNote(id: string) {
    await db.remove("notes", id);
    notes = notes.filter((n) => n.id !== id);
    if (selectedNoteId === id) {
      await selectNote(
        displayList.find((item) => item.type === "note")?.id ?? ""
      );
    }
  }

  $: currentNote = notes.find((n) => n.id === selectedNoteId) ?? null;

  function triggerNoteUpdate() {
    if (!currentNote) return;
    notes = [...notes];
  }

  async function updateNote(note: Note) {
    const noteToSave = { ...note, updatedAt: Date.now() };
    if (browser && DOMPurify) {
      noteToSave.contentHTML = DOMPurify.sanitize(noteToSave.contentHTML);
    }
    await db.put("notes", noteToSave);
    const index = notes.findIndex((n) => n.id === noteToSave.id);
    if (index !== -1) {
      notes[index] = noteToSave;
      notes = [...notes];
    }
  }

  const debouncedUpdateNote = debounce(updateNote, 400);

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  }

  // ----- Folder Navigation -----
  async function openFolder(folderId: string) {
    currentFolderId = folderId;
    selectedNoteId = "";
  }

  async function goBack() {
    currentFolderId = null;
    selectedNoteId = "";
  }

  function handleDragStart(ev: DragEvent, item: DisplayItem) {
    ev.dataTransfer?.setData("application/json", JSON.stringify(item));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
  }

  async function handleDropOnFolder(ev: DragEvent, targetFolder: Folder) {
    ev.preventDefault();
    dragOverFolderId = null;
    const data = ev.dataTransfer?.getData("application/json");
    if (!data) return;
    const draggedItem = JSON.parse(data) as DisplayItem;

    if (
      draggedItem.type === "note" &&
      draggedItem.folderId !== targetFolder.id
    ) {
      const noteToMove = notes.find((n) => n.id === draggedItem.id);
      if (noteToMove) {
        noteToMove.folderId = targetFolder.id;
        noteToMove.updatedAt = Date.now();
        const notesInTargetFolder = notes.filter(
          (n) => n.folderId === targetFolder.id
        );
        noteToMove.order = notesInTargetFolder.length;

        await db.put("notes", noteToMove);
        notes = [...notes];
      }
    }
  }

  async function handleDropOnRoot(ev: DragEvent) {
    dragOverRoot = false;
    const data = ev.dataTransfer?.getData("application/json");
    if (!data) return;
    const draggedItem = JSON.parse(data) as DisplayItem;
    if (draggedItem.type === "note" && draggedItem.folderId !== null) {
      const noteToMove = notes.find((n) => n.id === draggedItem.id);
      if (noteToMove) {
        noteToMove.folderId = null;
        // Move to root
        noteToMove.updatedAt = Date.now();
        const rootItemCount =
          folders.length + notes.filter((n) => n.folderId === null).length;
        noteToMove.order = rootItemCount;

        await db.put("notes", noteToMove);
        notes = [...notes]; // Trigger reactivity
      }
    }
  }

  function handleDragOver(ev: DragEvent, index: number) {
    ev.preventDefault();
    dropIndex = index;
  }

  async function handleReorderDrop(ev: DragEvent, targetIndex: number) {
    ev.preventDefault();
    dropIndex = null;
    const data = ev.dataTransfer?.getData("application/json");
    if (!data) return;
    const draggedItem = JSON.parse(data) as DisplayItem;

    const currentViewList = [...displayList];
    const draggedIndex = currentViewList.findIndex(
      (item) => item.id === draggedItem.id
    );
    if (draggedIndex === -1) return;

    const [movedItem] = currentViewList.splice(draggedIndex, 1);
    currentViewList.splice(targetIndex, 0, movedItem);
    const promises = currentViewList.map((item, index) => {
      item.order = index;
      if (item.type === "folder") {
        const folder = folders.find((f) => f.id === item.id);
        if (folder) {
          folder.order = index;
          return db.put("folders", folder);
        }
      } else {
        const note = notes.find((n) => n.id === item.id);
        if (note) {
          note.order = index;
          return db.put("notes", note);
        }
      }
      return Promise.resolve();
    });
    await Promise.all(promises);

    folders = [...folders];
    notes = [...notes];
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
  $: eventsByDay = calendarEvents.reduce(
    (acc, event) => {
      const dayKey = event.date;
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push(event);
      acc[dayKey].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      return acc;
    },
    {} as Record<string, CalendarEvent[]>
  );
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
  let kanbanDropTarget: { colId: string; taskIndex: number } | null = null;

  async function persistKanban() {
    if (!activeWorkspaceId || !kanban) return;
    const kanbanData: Kanban = {
      workspaceId: activeWorkspaceId,
      columns: kanban
    };
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

  // ----- Kanban Drag and Drop -----
  let isDragging = false;
  let draggedTaskGhost: {
    id: string;
    text: string;
    x: number;
    y: number;
  } | null = null;
  function onTaskDragStart(colId: string, task: Task, ev: DragEvent) {
    isDragging = true;
    draggedTaskGhost = {
      id: task.id,
      text: task.text,
      x: ev.clientX,
      y: ev.clientY
    };
    ev.dataTransfer?.setData(
      "application/json",
      JSON.stringify({ colId, taskId: task.id })
    );
    ev.dataTransfer!.effectAllowed = "move";
    ev.dataTransfer?.setDragImage(new Image(), 0, 0);
    window.addEventListener("dragover", updateGhostPosition);
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

  function onTaskDragOver(
    ev: DragEvent,
    targetColId: string,
    targetTaskIndex: number
  ) {
    ev.preventDefault();
    kanbanDropTarget = { colId: targetColId, taskIndex: targetTaskIndex };
  }

  function onColumnDrop(targetColId: string, ev: DragEvent, isTaskDrop = false) {
    ev.preventDefault();
    if (isTaskDrop) ev.stopPropagation();

    const data = ev.dataTransfer?.getData("application/json");
    if (!data) return;
    const payload = JSON.parse(data) as { colId: string; taskId: string };

    const fromCol = kanban.find((c) => c.id === payload.colId);
    const toCol = kanban.find((c) => c.id === targetColId);
    if (!fromCol || !toCol) return;

    const fromIndex = fromCol.tasks.findIndex((t) => t.id === payload.taskId);
    if (fromIndex < 0) return;

    let toIndex = toCol.tasks.length;
    if (kanbanDropTarget && kanbanDropTarget.colId === targetColId) {
      toIndex = kanbanDropTarget.taskIndex;
    }

    if (fromCol.id === toCol.id && fromIndex < toIndex) {
      toIndex--;
    }

    const [moved] = fromCol.tasks.splice(fromIndex, 1);
    toCol.tasks.splice(toIndex, 0, moved);

    kanban = [...kanban];
    kanbanDropTarget = null;
  }

  function handleDragEnd() {
    isDragging = false;
    draggedTaskGhost = null;
    window.removeEventListener("dragover", updateGhostPosition);
    kanbanDropTarget = null;
  }

  // ----- Data Loading -----
  async function loadActiveWorkspaceData() {
    if (!browser || !activeWorkspaceId) return;
    currentFolderId = null;

    const loadedFolders = await db.getAllByIndex<Folder>(
      "folders",
      "workspaceId",
      activeWorkspaceId
    );
    folders = loadedFolders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const loadedNotes = await db.getAllByIndex<Note>(
      "notes",
      "workspaceId",
      activeWorkspaceId
    );
    notes = loadedNotes;

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

  async function runDataMigration() {
    const MIGRATION_KEY = "neuronotes_v1_migration_complete";
    if (localStorage.getItem(MIGRATION_KEY)) {
      return;
    }
    console.log("Running one-time data migration for notes...");
    const allNotes = await db.getAll<Note>("notes");
    const notesToUpdate = allNotes.filter(
      (note) => typeof note.folderId === "undefined"
    );

    const notesToMigrate = allNotes.filter((note) => {
      const needsType = typeof note.type === "undefined";
      const needsSpreadsheetUpgrade =
        note.type === "spreadsheet" &&
        note.spreadsheet &&
        note.spreadsheet.data.length > 0 &&
        typeof note.spreadsheet.data[0][0] === "string";
      return needsType || needsSpreadsheetUpgrade;
    });

    notesToMigrate.forEach((note) => {
      if (typeof note.type === "undefined") {
        note.type = "text";
      }
      if (note.type === "spreadsheet" && note.spreadsheet) {
        note.spreadsheet.data = note.spreadsheet.data.map((row: string[]) =>
          row.map((cell: string) => ({ value: cell }))
        );
      }
    });

    if (notesToUpdate.length > 0) {
      const promises = notesToUpdate.map((note) => {
        note.folderId = null;
        return db.put("notes", note);
      });
      await Promise.all(promises);
      console.log(`Migrated ${notesToUpdate.length} notes.`);
    }
    if (notesToMigrate.length > 0) {
      const promises = notesToMigrate.map((note) => db.put("notes", note));
      await Promise.all(promises);
      console.log(
        `Migrated ${notesToMigrate.length} notes for type and spreadsheet format.`
      );
    }
    localStorage.setItem(MIGRATION_KEY, "true");
  }

  // ----- Lifecycle -----
  onMount(async () => {
    DOMPurify = (await import("dompurify")).default;

    await runDataMigration();

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

    document.addEventListener("selectionchange", updateSelectedFontSize);

    return () => {
      document.removeEventListener("selectionchange", updateSelectedFontSize);
    };
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
    flex-wrap: wrap;
  }

  .panel-title {
    font-weight: 600;
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
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background-color: 0.2s;
    position: relative;
  }
  .folder-item {
    background-color: rgba(140, 122, 230, 0.1);
    font-weight: 500;
  }
  .folder-item.drag-over {
    background-color: rgba(140, 122, 230, 0.3);
    outline: 2px solid var(--accent-purple);
  }
  .note-item.active {
    background: rgba(255, 71, 87, 0.15);
  }
  .note-item .title,
  .folder-item .title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .folder-item input {
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
    top: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--accent-red);
    pointer-events: none;
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
    transition: border-color: 0.2s;
    overflow-wrap: break-word;
  }
  .contenteditable:focus {
    border-color: var(--accent-red);
  }

  .spreadsheet-wrapper {
    flex: 1;
    min-height: 0;
    overflow: hidden;
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
    transition: background-color: 0.2s;
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
    transition: border-color: 0.2s;
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
    font-size: 15px;
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
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 14px;
    overflow-y: auto;
    flex: 1;
    scroll-behavior: smooth;
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
    width: 218px;
    transform: translate(-50%, -50%) rotate(3deg);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
    opacity: 0.95;
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
  .format-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    /* New styles for separation and positioning */
    margin-left: auto;
    padding-left: 16px;
    border-left: 1px solid var(--border);
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
    .format-toolbar {
      width: 100%;
      margin: 8px 0 0 0;
      padding: 8px 0 0 0;
      border-top: 1px solid var(--border);
      border-left: none;
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
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") editingWorkspaceId = null;
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
    <section class="panel">
      <div class="panel-header">
        {#if currentFolder}
          <button class="small-btn" on:click={goBack} title="Go back"
            >&larr;</button
          >
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
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
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

        <div class="spacer"></div>

        {#if currentFolder}
          <button
            class="small-btn danger"
            on:click={() => deleteFolder(currentFolder.id)}
            >Delete Folder</button
          >
        {/if}
        <button class="small-btn" on:click={addFolder}>+ Folder</button>
        <button class="small-btn" on:click={addSpreadsheetNote}>+ Sheet</button>
        <button class="small-btn" on:click={addNote}>+ Note</button>

        <!-- Note Formatting Toolbar -->
        {#if currentNote && currentNote.type !== "spreadsheet"}
          <div class="format-toolbar">
            <div class="font-size-controls" title="Change font size">
              <button
                class="toolbar-btn"
                on:click={() => modifyFontSize(-2)}
                on:mousedown={(e) => e.preventDefault()}>▼</button
              >
              <div class="font-size-display">{selectedFontSize}px</div>
              <button
                class="toolbar-btn"
                on:click={() => modifyFontSize(2)}
                on:mousedown={(e) => e.preventDefault()}>▲</button
              >
            </div>
            <button
              class="toolbar-btn"
              on:click={() => applyFormat("bold")}
              on:mousedown={(e) => e.preventDefault()}
              title="Bold"
              style="font-weight: bold;">B</button
            >
            <button
              class="toolbar-btn"
              on:click={() => applyFormat("italic")}
              on:mousedown={(e) => e.preventDefault()}
              title="Italic"
              style="font-style: italic;">I</button
            >
            <button
              class="toolbar-btn"
              on:click={() => applyFormat("insertUnorderedList")}
              on:mousedown={(e) => e.preventDefault()}
              title="Dotted list">●</button
            >
            <button
              class="toolbar-btn"
              on:click={() => applyFormat("justifyLeft")}
              on:mousedown={(e) => e.preventDefault()}
              title="Align left">◧</button
            >
            <button
              class="toolbar-btn"
              on:click={() => applyFormat("justifyCenter")}
              on:mousedown={(e) => e.preventDefault()}
              title="Align center">◫</button
            >
            <button
              class="toolbar-btn"
              on:click={() => applyFormat("justifyRight")}
              on:mousedown={(e) => e.preventDefault()}
              title="Align right">◨</button
            >
          </div>
        {/if}

        <!-- Spreadsheet Formatting Toolbar -->
        {#if currentNote && currentNote.type === "spreadsheet"}
          <div class="format-toolbar">
            <button
              class="toolbar-btn"
              on:click={() =>
                spreadsheetComponentInstance.applyStyle("fontWeight", "bold")}
              on:mousedown={(e) => e.preventDefault()}
              title="Bold"
              style="font-weight: bold;">B</button
            >
            <button
              class="toolbar-btn"
              on:click={() =>
                spreadsheetComponentInstance.applyStyle("fontStyle", "italic")}
              on:mousedown={(e) => e.preventDefault()}
              title="Italic"
              style="font-style: italic;">I</button
            >
            <button
              class="toolbar-btn"
              on:click={() =>
                spreadsheetComponentInstance.applyStyle("textAlign", "left")}
              on:mousedown={(e) => e.preventDefault()}
              title="Align left">◧</button
            >
            <button
              class="toolbar-btn"
              on:click={() =>
                spreadsheetComponentInstance.applyStyle("textAlign", "center")}
              on:mousedown={(e) => e.preventDefault()}
              title="Align center">◫</button
            >
            <button
              class="toolbar-btn"
              on:click={() =>
                spreadsheetComponentInstance.applyStyle("textAlign", "right")}
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

      <div class="notes">
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
            {#if item.type === "folder"}
              <div
                class="folder-item"
                class:drag-over={dragOverFolderId === item.id}
                draggable="true"
                on:click={(e) => {
                  if (editingFolderId !== item.id) openFolder(item.id);
                }}
                on:dragstart={(e) => handleDragStart(e, item)}
                on:dragover={(e) => {
                  handleDragOver(e, i);
                  if (e.dataTransfer?.types.includes('application/json')) {
                    const data = e.dataTransfer.getData('application/json');
                    if (data) {
                      const dragged = JSON.parse(data);
                      if (dragged.type === 'note') {
                        dragOverFolderId = item.id;
                      }
                    }
                  }
                }}
                on:dragleave={() => (dragOverFolderId = null)}
                on:drop|preventDefault={(e) => {
                  const data = e.dataTransfer.getData('application/json');
                  if (data && JSON.parse(data).type === 'note') {
                    handleDropOnFolder(e, item);
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
                    value={item.name}
                    use:focus
                    on:blur={(e) =>
                      renameFolder(item.id, (e.target as HTMLInputElement).value)}
                    on:keydown={(e) => {
                      if (e.key === 'Enter')
                        (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') editingFolderId = null;
                    }}
                  />
                {:else}
                  <div
                    class="title"
                    on:dblclick|stopPropagation={() => (editingFolderId = item.id)}
                  >
                    📁 {item.name}
                  </div>
                {/if}
              </div>
            {:else}
              <div
                class="note-item {selectedNoteId === item.id ? 'active' : ''}"
                on:click={() => selectNote(item.id)}
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, item)}
                on:dragover={(e) => handleDragOver(e, i)}
                on:drop|preventDefault={(e) => handleReorderDrop(e, i)}
              >
                {#if dropIndex === i}
                  <div class="drop-indicator"></div>
                {/if}
                <div class="title">{item.title || "Untitled"}</div>
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
              {#if currentNote.type === "spreadsheet"}
                <input
                  class="note-title"
                  bind:value={currentNote.title}
                  on:input={() => debouncedUpdateNote(currentNote)}
                  placeholder="Spreadsheet title..."
                />
                <div class="spreadsheet-wrapper">
                  <Spreadsheet
                    bind:this={spreadsheetComponentInstance}
                    bind:spreadsheetData={currentNote.spreadsheet!}
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
                <input
                  class="note-title"
                  bind:value={currentNote.title}
                  on:input={() => debouncedUpdateNote(currentNote)}
                  placeholder="Note title..."
                />
                <div class="note-content">
                  <div
                    class="contenteditable"
                    contenteditable="true"
                    bind:this={editorDiv}
                    bind:innerHTML={currentNote.contentHTML}
                    on:input={() => debouncedUpdateNote(currentNote)}
                    on:paste={handlePaste}
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
    </section>

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
              on:dragover={(e) => {
                onTaskDragOver(e, col.id, col.tasks.length);
              }}
              on:drop={(e) => onColumnDrop(col.id, e, false)}
            >
              <div class="kanban-col-header">
                <button
                  class="small-btn"
                  on:click={() => toggleColumnCollapse(col.id)}
                  title={col.isCollapsed ? "Expand" : "Collapse"}
                >
                  {col.isCollapsed ? "⤢" : "⤡"}
                </button>

                {#if editingColumnId === col.id}
                  <input
                    value={col.title}
                    use:focus
                    on:blur={(e) =>
                      renameColumn(col, (e.target as HTMLInputElement).value)}
                    on:keydown={(e) => {
                      if (e.key === "Enter")
                        (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") editingColumnId = null;
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
                      class:dragging={isDragging &&
                        draggedTaskGhost?.id === t.id}
                      draggable="true"
                      on:dragstart={(e) => onTaskDragStart(col.id, t, e)}
                      on:dragend={handleDragEnd}
                      on:dragover={(e) => onTaskDragOver(e, col.id, i)}
                      on:drop={(e) => onColumnDrop(col.id, e, true)}
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
                            if (e.key === "Enter")
                              (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") editingTaskId = null;
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
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </section>
  </div>
</div>
