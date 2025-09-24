<script lang="ts">
	// --- Component & Type Imports ---
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
		SpreadsheetCell,
	} from "$lib/db";
	// Dynamically import DOMPurify to avoid SSR issues
	let DOMPurify: any;

	// ----- Panel Resizing and Minimizing State -----
	let notesPanelWidth = 50; // In percentage
	let calendarPanelHeight = 50; // In percentage
	let isNoteListVisible = true;

	// Panel minimized state
	let isNotesMinimized = false;
	let isCalendarMinimized = false;
	let isKanbanMinimized = false;

	// Store last dimensions to restore them after un-minimizing
	let lastNotesWidth = 50;
	let lastCalendarHeight = 50;

	// Flags for drag-resizing events
	let isVerticalResizing = false;
	let isHorizontalResizing = false;
	// Target for the bind:clientWidth directive. Must be declared.
	let notesPanelClientWidth = 0;

	// This block handles the complex logic of automatically adjusting panel sizes
	// when one or more panels are minimized or maximized.
	$: minimizedCount =
		(isNotesMinimized ? 1 : 0) +
		(isCalendarMinimized ? 1 : 0) +
		(isKanbanMinimized ? 1 : 0);

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
			lastCalendarHeight > 7 && lastCalendarHeight < 93
				? lastCalendarHeight
				: 50;
	}

	$: if (minimizedCount === 2) {
		if (!isNotesMinimized) notesPanelWidth = 94;
		else if (!isCalendarMinimized) calendarPanelHeight = 94;
		else if (!isKanbanMinimized) calendarPanelHeight = 6;
	} else if (minimizedCount < 2) {
		if (!isNotesMinimized && notesPanelWidth > 90) {
			notesPanelWidth = lastNotesWidth > 7 ? lastNotesWidth : 50;
		}
		if (
			!isCalendarMinimized &&
			!isKanbanMinimized &&
			calendarPanelHeight > 90
		) {
			calendarPanelHeight =
				lastCalendarHeight > 7 && lastCalendarHeight < 93
					? lastCalendarHeight
					: 50;
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

	// Handlers for resizing the panels via drag-and-drop
	function startVerticalResize(e: MouseEvent) {
		e.preventDefault();
		isVerticalResizing = true;
		window.addEventListener("mousemove", doVerticalResize);
		window.addEventListener("mouseup", stopResize);
	}

	function doVerticalResize(e: MouseEvent) {
		if (!isVerticalResizing) return;
		const mainEl = document.querySelector(".main");
		if (!mainEl) return;
		const mainRect = mainEl.getBoundingClientRect();
		const newWidth = ((e.clientX - mainRect.left) / mainRect.width) * 100;
		notesPanelWidth = Math.max(6, Math.min(94, newWidth)); // Clamp width
		lastNotesWidth = notesPanelWidth;
	}

	function startHorizontalResize(e: MouseEvent) {
		e.preventDefault();
		isHorizontalResizing = true;
		window.addEventListener("mousemove", doHorizontalResize);
		window.addEventListener("mouseup", stopResize);
	}

	function doHorizontalResize(e: MouseEvent) {
		if (!isHorizontalResizing) return;
		const rightEl = document.querySelector(".right");
		if (!rightEl) return;
		const rightRect = rightEl.getBoundingClientRect();
		const newHeight = ((e.clientY - rightRect.top) / rightRect.height) * 100;
		calendarPanelHeight = Math.max(6, Math.min(94, newHeight)); // Clamp height
		lastCalendarHeight = calendarPanelHeight;
	}

	function stopResize() {
		isVerticalResizing = false;
		isHorizontalResizing = false;
		window.removeEventListener("mousemove", doVerticalResize);
		window.removeEventListener("mousemove", doHorizontalResize);
		window.removeEventListener("mouseup", stopResize);
	}

	// ----- Shared Utilities -----
	const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	const DAY_NAMES_LONG = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];

	/** Svelte action to automatically focus an element on render. */
	function focus(node: HTMLElement) {
		node.focus();
		return { destroy() {} };
	}

	/** Prevents a function from firing too often, with an added `flush` method to execute immediately. */
	function debounce<T extends (...args: any[]) => any>(
		func: T,
		timeout = 300,
	) {
		let timer: ReturnType<typeof setTimeout>;
		let pendingArgs: Parameters<T> | null = null;

		const debounced = (...args: Parameters<T>) => {
			pendingArgs = args;
			clearTimeout(timer);
			timer = setTimeout(() => {
				func.apply(this, pendingArgs);
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

	// ----- Editor & Toolbar State -----
	let editorDiv: HTMLElement; // Bound to the contenteditable div for text notes
	let selectedFontSize = 14;

	// Spreadsheet component state
	let spreadsheetComponentInstance: Spreadsheet;
	let selectedSheetCell: { row: number; col: number } | null = null;
	let sheetSelection: {
		start: { row: number; col: number };
		end: { row: number; col: number };
	} | null = null;

	/** Reactive check to determine if the merge/unmerge button should be enabled. */
	$: canMergeOrUnmerge = (() => {
		if (!sheetSelection || !currentNote?.spreadsheet) return false;
		const { start, end } = sheetSelection;
		const minRow = Math.min(start.row, end.row);
		const minCol = Math.min(start.col, end.col);
		const maxRow = Math.max(start.row, end.row);
		const maxCol = Math.max(start.col, end.col);

		// Enable if selecting more than one cell
		if (minRow !== maxRow || minCol !== maxCol) return true;

		// Also enable if selecting a single cell that is already part of a merge
		const cell = currentNote.spreadsheet.data[minRow][minCol];
		return (cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1;
	})();

	function applyFormat(command: string) {
		if (editorDiv) editorDiv.focus();
		document.execCommand(command, false);
	}

	/** Increases or decreases the font size of the selected text. */
	function modifyFontSize(amount: number) {
		if (!editorDiv) return;
		editorDiv.focus();

		const selection = window.getSelection();
		if (!selection?.rangeCount) return;

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

			document.execCommand("fontSize", false, "1"); // Placeholder for wrapper
			const fontElements = editorDiv.getElementsByTagName("font");
			for (const element of Array.from(fontElements)) {
				if (element.size === "1") {
					element.removeAttribute("size");
					element.style.fontSize = `${newSize}px`;
				}
			}

			selectedFontSize = newSize;
			editorDiv.dispatchEvent(new Event("input", { bubbles: true }));
		}
	}

	/** Updates the displayed font size based on the current text selection. */
	function updateSelectedFontSize() {
		if (!browser || !editorDiv) return;
		const selection = window.getSelection();
		if (!selection?.rangeCount) return;

		const range = selection.getRangeAt(0);
		const parentElement =
			range.commonAncestorContainer.nodeType === Node.TEXT_NODE
				? range.commonAncestorContainer.parentElement
				: (range.commonAncestorContainer as HTMLElement);

		if (parentElement && editorDiv.contains(parentElement)) {
			const sizeStr =
				window.getComputedStyle(parentElement).fontSize || "14px";
			selectedFontSize = parseInt(sizeStr);
		}
	}

	// ----- Workspace State -----
	let workspaces: Workspace[] = [];
	let activeWorkspaceId = "";
	let editingWorkspaceId: string | null = null;
	let draggedWorkspaceId: string | null = null;

	$: activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

	async function switchWorkspace(id: string) {
		if (id === activeWorkspaceId) return;
		debouncedUpdateNote.flush(); // Save any pending changes before switching

		notes = [];
		folders = [];
		calendarEvents = [];
		kanban = [];
		selectedNoteId = "";
		currentFolderId = null;

		activeWorkspaceId = id;
		await db.put("settings", { key: "activeWorkspaceId", value: id });
		await loadActiveWorkspaceData();
	}

	async function addWorkspace() {
		const name = prompt("Enter new workspace name:", "New Workspace");
		if (!name?.trim()) return;

		const newWorkspace: Workspace = {
			id: crypto.randomUUID(),
			name: name.trim(),
			order: workspaces.length,
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
				`Are you sure you want to delete "${ws.name}"? All its data will be lost.`,
			)
		) {
			return;
		}

		// Delete all data associated with this workspace to prevent orphans
		const notesToDelete = await db.getAllByIndex<Note>(
			"notes",
			"workspaceId",
			id,
		);
		for (const note of notesToDelete) await db.remove("notes", note.id);

		const foldersToDelete = await db.getAllByIndex<Folder>(
			"folders",
			"workspaceId",
			id,
		);
		for (const f of foldersToDelete) await db.remove("folders", f.id);

	  const eventsToDelete = await db.getAllByIndex<CalendarEvent>(
			"calendarEvents",
			"workspaceId",
			id,
		);
		for (const e of eventsToDelete)
			await db.remove("calendarEvents", e.id);

		await db.remove("kanban", id);
		await db.remove("workspaces", id);

		workspaces = workspaces.filter((w) => w.id !== id);
		if (activeWorkspaceId === id) {
			await switchWorkspace(workspaces[0].id);
		}
	}

	function handleWorkspaceDragStart(e: DragEvent, workspaceId: string) {
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", workspaceId);
		}
		draggedWorkspaceId = workspaceId;
	}

	async function handleWorkspaceDrop(e: DragEvent, targetIndex: number) {
		e.preventDefault();
		if (!draggedWorkspaceId) return;

		const draggedIndex = workspaces.findIndex(
			(w) => w.id === draggedWorkspaceId,
		);
		if (draggedIndex === -1 || draggedIndex === targetIndex) return;

		const reordered = [...workspaces];
		const [moved] = reordered.splice(draggedIndex, 1);
		reordered.splice(targetIndex, 0, moved);

		const promises = reordered.map((ws, index) => {
			ws.order = index;
			return db.put("workspaces", ws);
		});

		await Promise.all(promises);
		workspaces = reordered;
		draggedWorkspaceId = null;
	}

	// ----- Notes & Folders State -----
	let notes: Note[] = [];
	let folders: Folder[] = [];
	let selectedNoteId = "";
	let currentFolderId: string | null = null; // null means we are in the root view

	// State for drag-and-drop operations
	let dragOverFolderId: string | null = null;
	let dropIndex: number | null = null;
	let dragOverRoot = false;

	// State for inline renaming
	let editingFolderId: string | null = null;
	let editingNoteId: string | null = null;
	let isEditingHeaderName = false;

	/** A combined list of notes and folders for the current view (root or inside a folder). */
	type DisplayItem = (Note & { type: "note" }) | (Folder & { type: "folder" });
	let displayList: DisplayItem[] = [];

	$: {
		let items: DisplayItem[];
		if (currentFolderId === null) {
			// Root view: show all folders and notes without a folderId
			const rootNotes = notes
				.filter((n) => n.folderId === null)
				.map((n) => ({ ...n, type: "note" as const }));
			const allFolders = folders.map((f) => ({
				...f,
				type: "folder" as const,
			}));
			items = [...allFolders, ...rootNotes];
		} else {
			// Folder view: show only notes within the current folder
			items = notes
				.filter((n) => n.folderId === currentFolderId)
				.map((n) => ({ ...n, type: "note" as const }));
		}
		// Sort items by their 'order' property
		displayList = items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}

	$: currentFolder = folders.find((f) => f.id === currentFolderId);
	$: currentNote = notes.find((n) => n.id === selectedNoteId) ?? null;

	async function selectNote(id: string) {
		if (selectedNoteId === id) return;
		debouncedUpdateNote.flush(); // Save pending changes on the old note
		selectedSheetCell = null;
		sheetSelection = null;
		selectedNoteId = id;
		await db.put("settings", {
			key: `selectedNoteId:${activeWorkspaceId}`,
			value: id,
		});
	}

	async function addNote(type: "text" | "spreadsheet" = "text") {
		const notesInCurrentView = displayList.filter(
			(item) => item.type === "note",
		);

		const n: Note = {
			id: crypto.randomUUID(),
			title: type === "spreadsheet" ? "Untitled Sheet" : "Untitled Note",
			contentHTML: "",
			updatedAt: Date.now(),
			workspaceId: activeWorkspaceId,
			folderId: currentFolderId,
			order: notesInCurrentView.length,
			type: type,
			spreadsheet:
				type === "spreadsheet" ? createEmptySpreadsheet() : undefined,
		};
		await db.put("notes", n);
		notes = [...notes, n];
		await selectNote(n.id);
	}

	/** Factory function for creating a default spreadsheet structure. */
	function createEmptySpreadsheet(rows = 50, cols = 20) {
		const data: SpreadsheetCell[][] = Array.from({ length: rows }, () =>
			Array.from({ length: cols }, () => ({ value: "" })),
		);
		const colWidths: Record<number, number> = {};
		for (let i = 0; i < cols; i++) colWidths[i] = 100;
		const rowHeights: Record<number, number> = {};
		for (let i = 0; i < rows; i++) rowHeights[i] = 25;
		return { data, colWidths, rowHeights };
	}

	async function addFolder() {
		const name = prompt("Enter new folder name:", "New Folder");
		if (!name?.trim()) return;

		const f: Folder = {
			id: crypto.randomUUID(),
			name: name.trim(),
			workspaceId: activeWorkspaceId,
			order: displayList.length,
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

	async function renameNote(id: string, newName: string) {
		const note = notes.find((n) => n.id === id);
		if (note && newName.trim()) {
			note.title = newName.trim();
			await db.put("notes", note);
			notes = [...notes];
		}
		editingNoteId = null;
	}

	async function deleteFolder(folderId: string) {
		const folder = folders.find((f) => f.id === folderId);
		if (!folder) return;
		if (
			!confirm(
				`Delete "${folder.name}"? All notes inside will be PERMANENTLY DELETED.`,
			)
		)
			return;

		const notesToDelete = notes.filter((n) => n.folderId === folderId);
		const deletePromises = notesToDelete.map((note) =>
			db.remove("notes", note.id),
		);
		await Promise.all(deletePromises);
		await db.remove("folders", folderId);

		const deletedNoteIds = new Set(notesToDelete.map((n) => n.id));
		notes = notes.filter((n) => !deletedNoteIds.has(n.id));
		folders = folders.filter((f) => f.id !== folderId);

		if (currentFolderId === folderId) await goBack();
	}

	async function deleteNote(id: string) {
		await db.remove("notes", id);
		notes = notes.filter((n) => n.id !== id);
		if (selectedNoteId === id) {
			const nextNote = displayList.find(
				(item) => item.type === "note" && item.id !== id,
			);
			await selectNote(nextNote?.id ?? "");
		}
	}

	/** Triggers a reactive update for the `notes` array, used by child components. */
	function triggerNoteUpdate() {
		if (!currentNote) return;
		notes = [...notes];
	}

	async function updateNote(note: Note) {
		const noteToSave = { ...note, updatedAt: Date.now() };
		if (browser && DOMPurify && noteToSave.type === "text") {
			noteToSave.contentHTML = DOMPurify.sanitize(noteToSave.contentHTML);
		}
		await db.put("notes", noteToSave);
		const index = notes.findIndex((n) => n.id === noteToSave.id);
		if (index !== -1) {
			notes[index] = noteToSave;
			notes = [...notes]; // Trigger reactivity
		}
	}

	const debouncedUpdateNote = debounce(updateNote, 400);

	/** Sanitizes pasted content to be plain text. */
	function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		const text = event.clipboardData?.getData("text/plain") || "";
		document.execCommand("insertText", false, text);
	}

	async function openFolder(folderId: string) {
		debouncedUpdateNote.flush();
		currentFolderId = folderId;
		selectedNoteId = "";
	}

	async function goBack() {
		debouncedUpdateNote.flush();
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
				noteToMove.order = notes.filter(
					(n) => n.folderId === targetFolder.id,
				).length;
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
				noteToMove.updatedAt = Date.now();
				noteToMove.order = displayList.length;
				await db.put("notes", noteToMove);
				notes = [...notes];
			}
		}
	}

	async function handleReorderDrop(ev: DragEvent, targetIndex: number) {
		ev.preventDefault();
		dropIndex = null;
		const data = ev.dataTransfer?.getData("application/json");
		if (!data) return;
		const draggedItem = JSON.parse(data) as DisplayItem;

		const currentViewList = [...displayList];
		const draggedIndex = currentViewList.findIndex(
			(item) => item.id === draggedItem.id,
		);
		if (draggedIndex === -1) return;

		const [movedItem] = currentViewList.splice(draggedIndex, 1);
		currentViewList.splice(targetIndex, 0, movedItem);

		const promises = currentViewList.map((item, index) => {
			item.order = index;
			const storeName = item.type === "folder" ? "folders" : "notes";
			return db.put(storeName, item);
		});
		await Promise.all(promises);

		// Manually update local state to reflect new order
		folders = [...folders];
		notes = [...notes];
	}

	// ----- Weekly Calendar State -----
	let calendarEvents: CalendarEvent[] = [];
	let today = new Date();
	let weekStart = new Date();

    $: todayDateString = browser
      ? `${DAY_NAMES_LONG[today.getDay()]}, ${dmy(today)}`
      : "Calendar";

    $: todayTimeString = browser
      ? today.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : "";
	$: weekDays = browser
		? Array.from({ length: 7 }, (_, i) => {
				const d = new Date(weekStart);
				d.setDate(d.getDate() + i);
				return d;
		  })
		: [];
	$: eventsByDay = calendarEvents.reduce(
		(acc, event) => {
			const dayKey = event.date; // YYYY-MM-DD
			if (!acc[dayKey]) acc[dayKey] = [];
			acc[dayKey].push(event);
			acc[dayKey].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
			return acc;
		},
		{} as Record<string, CalendarEvent[]>,
	);

	let newEventTitle = "";
	let newEventTime = "";
	let newEventDate = "";

	function startOfWeek(date: Date, weekStartsOn = 1) {
		const d = new Date(date);
		const day = d.getDay();
		const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
		d.setDate(d.getDate() - diff);
		d.setHours(0, 0, 0, 0);
		return d;
	}
	function ymd(date: Date) {
       const year = date.getFullYear();
       const month = String(date.getMonth() + 1).padStart(2, "0");
       const day = String(date.getDate()).padStart(2, "0");
       return `${year}-${month}-${day}`;
    }
	function dmy(date: Date) {
		const dd = String(date.getDate()).padStart(2, "0");
		const mm = String(date.getMonth() + 1).padStart(2, "0");
		const yyyy = date.getFullYear();
		return `${dd}-${mm}-${yyyy}`;
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
		const newEvent: CalendarEvent = {
			id: crypto.randomUUID(),
			date: newEventDate,
			title: newEventTitle.trim(),
			time: newEventTime || undefined,
			workspaceId: activeWorkspaceId,
		};
		await db.put("calendarEvents", newEvent);
		calendarEvents = [...calendarEvents, newEvent];
		newEventTitle = "";
		newEventTime = "";
	}

	async function deleteEvent(id: string) {
		await db.remove("calendarEvents", id);
		calendarEvents = calendarEvents.filter((e) => e.id !== id);
	}

	// ----- Kanban State -----
	let kanban: Column[] = [];
	let editingColumnId: string | null = null;
	let editingTaskId: string | null = null;
    let draggedTaskInfo: { colId: string; taskId: string } | null = null;
	let kanbanDropTarget: { colId: string; taskIndex: number } | null = null;
	let isDraggingTask = false;
	let draggedTaskGhost: {
		id: string;
		text: string;
		x: number;
		y: number;
	} | null = null;

	/** Persists the entire Kanban board state to the database. */
	const debouncedPersistKanban = debounce(async () => {
		if (!activeWorkspaceId || !kanban) return;
		await db.put("kanban", { workspaceId: activeWorkspaceId, columns: kanban });
	}, 400);
	$: if (browser && kanban.length >= 0) {
		debouncedPersistKanban();
	}

	function addColumn() {
		kanban = [
			...kanban,
			{
				id: crypto.randomUUID(),
				title: "New Column",
				tasks: [],
				isCollapsed: false,
			},
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
		kanban = kanban.filter((c) => c.id !== colId);
	}

	function addTask(col: Column, text: string) {
		if (!text.trim()) return;
		col.tasks.push({ id: crypto.randomUUID(), text: text.trim() });
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

	function onTaskDragStart(colId: string, task: db.Task, ev: DragEvent) {
		draggedTaskInfo = { colId, taskId: task.id };
        isDraggingTask = true;
		draggedTaskGhost = {
			id: task.id,
			text: task.text,
			x: ev.clientX,
			y: ev.clientY,
		};
		if (ev.dataTransfer) {
			ev.dataTransfer.setData("text/plain", task.id);
			ev.dataTransfer.effectAllowed = "move";
		}
		ev.dataTransfer?.setDragImage(new Image(), 0, 0); // Hide default ghost
		window.addEventListener("dragover", updateGhostPosition);
	}

	function updateGhostPosition(ev: DragEvent) {
		if (!draggedTaskGhost) return;
		if (ev.clientX === 0 && ev.clientY === 0) return; // Ignore reset events
		draggedTaskGhost = {
			...draggedTaskGhost,
			x: ev.clientX,
			y: ev.clientY,
		};
	}

	function onTaskDragOver(
		ev: DragEvent,
		targetColId: string,
		targetTaskIndex: number,
	) {
		ev.preventDefault();
		kanbanDropTarget = { colId: targetColId, taskIndex: targetTaskIndex };
	}

	function onColumnDrop(
		targetColId: string,
		ev: DragEvent,
		isTaskDrop = false,
	) {
		ev.preventDefault();
		if (isTaskDrop) ev.stopPropagation();

		if (!draggedTaskInfo) return;
		const { colId, taskId } = draggedTaskInfo;

		const fromCol = kanban.find((c) => c.id === colId);
		const toCol = kanban.find((c) => c.id === targetColId);
		if (!fromCol || !toCol) return;

		const fromIndex = fromCol.tasks.findIndex((t) => t.id === taskId);
		if (fromIndex < 0) return;

		let toIndex =
			kanbanDropTarget?.colId === targetColId
				? kanbanDropTarget.taskIndex
				: toCol.tasks.length;

		if (fromCol.id === toCol.id && fromIndex < toIndex) toIndex--;

		const [moved] = fromCol.tasks.splice(fromIndex, 1);
		toCol.tasks.splice(toIndex, 0, moved);

		kanban = [...kanban];
		kanbanDropTarget = null;
	}

	function handleDragEnd() {
		draggedTaskInfo = null;
		isDraggingTask = false;
		draggedTaskGhost = null;
		window.removeEventListener("dragover", updateGhostPosition);
		kanbanDropTarget = null;
	}

	// ----- Data Loading & Lifecycle -----

	/** Loads all data for the currently active workspace from IndexedDB. */
	async function loadActiveWorkspaceData() {
		if (!browser || !activeWorkspaceId) return;

		currentFolderId = null;

		const [loadedFolders, loadedNotes, selectedNoteSetting, events, kData] =
			await Promise.all([
				db.getAllByIndex<Folder>(
					"folders",
					"workspaceId",
					activeWorkspaceId,
				),
				db.getAllByIndex<Note>("notes", "workspaceId", activeWorkspaceId),
				db.get("settings", `selectedNoteId:${activeWorkspaceId}`),
				db.getAllByIndex<CalendarEvent>(
					"calendarEvents",
					"workspaceId",
					activeWorkspaceId,
				),
				db.get<Kanban>("kanban", activeWorkspaceId),
			]);

		folders = loadedFolders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		notes = loadedNotes;
		selectedNoteId =
			loadedNotes.find((n) => n.id === selectedNoteSetting?.value)?.id ??
			loadedNotes.find((n) => n.folderId === null)?.id ??
			"";

		calendarEvents = events;
		kanban = kData ? kData.columns : [];
	}

    onMount(async () => {
      DOMPurify = (await import("dompurify")).default;

      let loadedWorkspaces = await db.getAll<Workspace>("workspaces");
      if (loadedWorkspaces.length > 0) {
         workspaces = loadedWorkspaces.sort(
           (a, b) => (a.order ?? 0) - (b.order ?? 0),
         );
         } else {
      const defaultWorkspace = {
        id: crypto.randomUUID(),
        name: "My Workspace",
        order: 0,
      };
      await db.put("workspaces", defaultWorkspace);
      workspaces = [defaultWorkspace];
    }

    const lastActive = await db.get("settings", "activeWorkspaceId");
    activeWorkspaceId =
      workspaces.find((w) => w.id === lastActive?.value)?.id ??
      workspaces[0].id;

    await loadActiveWorkspaceData();

    today = new Date();
    weekStart = startOfWeek(today, 1);
    newEventDate = ymd(today);

    const timer = setInterval(() => {
      today = new Date();
    }, 60 * 1000);

    document.addEventListener("selectionchange", updateSelectedFontSize);

    return () => {
      document.removeEventListener("selectionchange", updateSelectedFontSize);
      clearInterval(timer);
    };
  });
</script>

{#if isDraggingTask && draggedTaskGhost}
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
			{#each workspaces as ws, i (ws.id)}
				<div
					class="workspace-tab"
					class:active={ws.id === activeWorkspaceId}
					class:drag-over={draggedWorkspaceId && draggedWorkspaceId !== ws.id}
					draggable="true"
					on:dragstart={(e) => handleWorkspaceDragStart(e, ws.id)}
					on:dragover|preventDefault
					on:drop={(e) => handleWorkspaceDrop(e, i)}
					on:dragend={() => (draggedWorkspaceId = null)}
					on:click={() => switchWorkspace(ws.id)}
				>
					{#if editingWorkspaceId === ws.id}
						<input
							value={ws.name}
							use:focus
							on:blur={(e) =>
								renameWorkspace(ws.id, (e.target as HTMLInputElement).value)}
							on:keydown={(e) => {
								if (e.key === "Enter")
									(e.target as HTMLInputElement).blur();
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
											(e.target as HTMLInputElement).value,
										)}
									on:keydown={(e) => {
										if (e.key === "Enter")
											(e.target as HTMLInputElement).blur();
										if (e.key === "Escape") isEditingHeaderName = false;
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
								>Delete Folder</button
							>
						{/if}
						<button class="small-btn" on:click={addFolder}>+ Folder</button>
						<button class="small-btn" on:click={() => addNote("spreadsheet")}
							>+ Sheet</button
						>
						<button class="small-btn" on:click={() => addNote("text")}
							>+ Note</button
						>
					</div>
				{/if}

				<button
					class="small-btn panel-minimize-btn"
					on:click={toggleNotesMinimized}
					title={isNotesMinimized ? "Expand" : "Collapse"}
				>
					{isNotesMinimized ? "⤢" : "⤡"}
				</button>
			</div>

			{#if !isNotesMinimized && currentNote}
				<div class="panel-header toolbar-container">
					<button
						class="toolbar-btn toggle-notelist-btn"
						on:click={toggleNoteList}
						title={isNoteListVisible ? "Hide Note List" : "Show Note List"}
					>
						{isNoteListVisible ? "«" : "»"}
					</button>
					{#if currentNote.type !== "spreadsheet"}
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
								style="font-weight:
                  bold;">B</button
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
					{:else}
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
									spreadsheetComponentInstance.applyStyle(
										"fontStyle",
										"italic",
									)}
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
									spreadsheetComponentInstance.applyStyle(
										"textAlign",
										"center",
									)}
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
							{#if item.type === "folder"}
								<div
									class="folder-item"
									class:drag-over={dragOverFolderId === item.id}
									draggable="true"
									on:click={() => {
										if (editingFolderId !== item.id) openFolder(item.id);
									}}
									on:dragstart={(e) => handleDragStart(e, item)}
									on:dragover={(e) => {
										e.preventDefault();
										dropIndex = i;
										const data = e.dataTransfer?.getData("application/json");
										if (data && JSON.parse(data).type === "note") {
											dragOverFolderId = item.id;
										}
									}}
									on:dragleave={() => (dragOverFolderId = null)}
									on:drop|preventDefault={(e) => {
										const data = e.dataTransfer?.getData("application/json");
										if (data && JSON.parse(data).type === "note") {
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
												renameFolder(
													item.id,
													(e.target as HTMLInputElement).value,
												)}
											on:keydown={(e) => {
												if (e.key === "Enter")
													(e.target as HTMLInputElement).blur();
												if (e.key === "Escape") editingFolderId = null;
											}}
										/>
									{:else}
										<div
											class="title"
											on:dblclick|stopPropagation={() =>
												(editingFolderId = item.id)}
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
									on:dragover={(e) => {
										e.preventDefault();
										dropIndex = i;
									}}
									on:drop|preventDefault={(e) => handleReorderDrop(e, i)}
								>
									{#if dropIndex === i}
										<div class="drop-indicator"></div>
									{/if}
									{#if editingNoteId === item.id}
										<input
											value={item.title}
											use:focus
											on:blur={(e) =>
												renameNote(
													item.id,
													(e.target as HTMLInputElement).value,
												)}
											on:keydown={(e) => {
												if (e.key === "Enter")
													(e.target as HTMLInputElement).blur();
												if (e.key === "Escape") editingNoteId = null;
											}}
										/>
									{:else}
										<div
											class="title"
											on:dblclick|stopPropagation={() => (editingNoteId = item.id)}
										>
											{item.title || "Untitled"}
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
								{#if currentNote.type === "spreadsheet"}
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
			{/if}
		</section>

		<div
			class="resizer-wrapper vertical"
			on:mousedown={startVerticalResize}
			title="Resize"
		>
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
						title={isCalendarMinimized ? "Expand" : "Collapse"}
					>
						{isCalendarMinimized ? "⤢" : "⤡"}
					</button>
				</div>

				{#if browser && !isCalendarMinimized}
					<div class="calendar-grid">
						{#each weekDays as d (ymd(d))}
							<div class="calendar-cell" class:today={ymd(d) === ymd(today)}>
								<div class="date">{dmy(d)}</div>
								<div class="day-name">{DAY_NAMES[d.getDay()]}</div>
								{#each eventsByDay[ymd(d)] || [] as ev (ev.id)}
									<div class="event" title={ev.title}>
										<div class="event-details">
											{#if ev.time}
												<div class="time">{ev.time}</div>
											{/if}
											<div class="title">{ev.title}</div>
										</div>
										<button
											class="delete-event-btn"
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
							on:keydown={(e) => {
								if (e.key === 'Enter') addEvent();
							}}
						/>
						<button class="small-btn" on:click={addEvent}>Add</button>
					</div>
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
							title={isKanbanMinimized ? "Expand" : "Collapse"}
						>
							{isKanbanMinimized ? "⤢" : "⤡"}
						</button>
					</div>
				</div>

				{#if !isKanbanMinimized}
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
												renameColumn(
													col.id,
													(e.target as HTMLInputElement).value,
												)}
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
												class:dragging={isDraggingTask &&
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
																col.id,
																t.id,
																(e.target as HTMLInputElement).value,
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
												if (e.key === "Enter" && target.value.trim()) {
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
												if (input.value.trim()) {
													addTask(col, input.value);
													input.value = "";
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

  .notes-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
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
    top: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--accent-red);
    pointer-events: none;
    z-index: 10;
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
  .delete-event-btn {
    display:flex;
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
    transition: all 0.2s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .small-btn:hover {
    border-color: var(--accent-red);
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
    font-size: 0.9rem;
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
    padding: 10px;
    width: 218px;
    transform: translate(-50%, -50%) rotate(3deg);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
    opacity: 0.95;
    overflow-wrap: break-word;
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
    }
    .calendar-cell {
      border-left: 1px solid var(--border);
    }
    .calendar-add {
      flex-wrap: nowrap;
      overflow-x: auto;
    }
    .calendar-add input[type="text"] {
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
