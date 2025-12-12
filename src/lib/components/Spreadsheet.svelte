<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
    import type { Spreadsheet as SpreadsheetData, SpreadsheetCell } from "$lib/db_types";
    import { debounce } from "$lib/utils/debounce";

	export let spreadsheetData: SpreadsheetData;
	export let selectedCell: { row: number; col: number } | null = null;
	export let selection: {
		start: { row: number; col: number };
		end: { row: number; col: number };
	} | null = null;

	const dispatch = createEventDispatcher();

	const MIN_WIDTH = 40;
	const MIN_HEIGHT = 25;

	function deepClone<T>(obj: T): T {
		if (typeof structuredClone !== 'undefined') {
			return structuredClone(obj);
		}
		return JSON.parse(JSON.stringify(obj));
	}

	let container: HTMLElement;
	let isSelecting = false;
	let editingCell: { row: number; col: number } | null = null;

	let colBeingResized: number | null = null;
	let rowBeingResized: number | null = null;
	let startX = 0;
	let startY = 0;
	let startWidth = 0;
	let startHeight = 0;

	let clipboardBuffer: {
		data: SpreadsheetCell[][];
		rowCount: number;
		colCount: number;
	} | null = null;
	let clipboardSourceArea: {
		minRow: number;
		maxRow: number;
		minCol: number;
		maxCol: number;
	} | null = null;

	let cachedFormulaCells: { row: number; col: number }[] | null = null;
	let formulaDependencies: Map<string, Set<string>> = new Map();
	let needsFormulaCacheRebuild = true;
	let clipboardMode: "cut" | "copy" | null = null;
	
	let cachedRowPositions: number[] = [];
	let cachedColPositions: number[] = [];
	let cachedRowCount = 0;
	let cachedColCount = 0;
	let cachedRowHeights: Record<number, number> = {};
	let cachedColWidths: Record<number, number> = {};

	type CellChange = {
		row: number;
		col: number;
		oldValue: SpreadsheetCell;
		newValue: SpreadsheetCell;
	};

	type SpreadsheetHistoryEntry = {
		data?: SpreadsheetData;
		changes?: CellChange[];
		timestamp: number;
	};

	let history: SpreadsheetHistoryEntry[] = [];
	let historyIndex = -1;
	const MAX_HISTORY = 50;
	const CHECKPOINT_INTERVAL = 10;
	let lastSavedCellValue: string | null = null;
	let hasSavedHistoryForCurrentEdit = false;
	let lastHistorySnapshot: SpreadsheetData | null = null;
	
	onMount(() => {
		if (spreadsheetData?.data) {
			lastHistorySnapshot = deepClone(spreadsheetData);
		}
	});

	$: selectionArea = (() => {
		if (!selection) return null;
		const minRow = Math.min(selection.start.row, selection.end.row);
		const maxRow = Math.max(selection.start.row, selection.end.row);
		const minCol = Math.min(selection.start.col, selection.end.col);
		const maxCol = Math.max(selection.start.col, selection.end.col);
		return {
			minRow,
			maxRow,
			minCol,
			maxCol,
			rowCount: maxRow - minRow + 1,
			colCount: maxCol - minCol + 1,
		};
	})();

	$: rowPositions = (() => {
		const rowCount = spreadsheetData.data.length;
		const rowHeights = spreadsheetData.rowHeights || {};
		
		const needsRecalc = 
			rowCount !== cachedRowCount ||
			JSON.stringify(rowHeights) !== JSON.stringify(cachedRowHeights);
		
		if (!needsRecalc && cachedRowPositions.length > 0) {
			return cachedRowPositions;
		}
		
		const positions = [0];
		let currentPos = 0;
		for (let i = 0; i < rowCount; i++) {
			currentPos += (rowHeights[i] || MIN_HEIGHT) + 1;
			positions.push(currentPos);
		}
		
		cachedRowPositions = positions;
		cachedRowCount = rowCount;
		cachedRowHeights = { ...rowHeights };
		
		return positions;
	})();

	$: colPositions = (() => {
		if (!spreadsheetData.data[0]) return [0];
		
		const colCount = spreadsheetData.data[0].length;
		const colWidths = spreadsheetData.colWidths || {};
		
		const needsRecalc = 
			colCount !== cachedColCount ||
			JSON.stringify(colWidths) !== JSON.stringify(cachedColWidths);
		
		if (!needsRecalc && cachedColPositions.length > 0) {
			return cachedColPositions;
		}
		
		const positions = [0];
		let currentPos = 0;
		for (let i = 0; i < colCount; i++) {
			currentPos += (colWidths[i] || 100) + 1;
			positions.push(currentPos);
		}
		
		cachedColPositions = positions;
		cachedColCount = colCount;
		cachedColWidths = { ...colWidths };
		
		return positions;
	})();

	$: gridTemplateColumns = Object.values(spreadsheetData.colWidths)
		.map((w) => `${w}px`)
		.join(" ");

	function isInSelection(row: number, col: number) {
		if (!selectionArea) return false;
		return (
			row >= selectionArea.minRow &&
			row <= selectionArea.maxRow &&
			col >= selectionArea.minCol &&
			col <= selectionArea.maxCol
		);
	}

	function getColName(n: number) {
		let name = "";
		while (n >= 0) {
			name = String.fromCharCode((n % 26) + 65) + name;
			n = Math.floor(n / 26) - 1;
		}
		return name;
	}

	function calculateMergedHeight(cell: SpreadsheetCell, rowIndex: number) {
		const rowspan = cell.rowspan || 1;
		if (rowspan <= 1) {
			return spreadsheetData.rowHeights[rowIndex] || MIN_HEIGHT;
		}
		let totalHeight = 0;
		for (let i = 0; i < rowspan; i++) {
			totalHeight +=
				spreadsheetData.rowHeights[rowIndex + i] || MIN_HEIGHT;
		}
		totalHeight += rowspan - 1;
		return totalHeight;
	}

	const debouncedResizeUpdate = debounce(() => dispatch("update"), 100);

	function handleColMouseDown(e: MouseEvent, colIndex: number) {
		colBeingResized = colIndex;
		startX = e.clientX;
		startWidth = spreadsheetData.colWidths[colIndex] || 100;
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
	}

	function handleRowMouseDown(e: MouseEvent, rowIndex: number) {
		rowBeingResized = rowIndex;
		startY = e.clientY;
		startHeight = spreadsheetData.rowHeights[rowIndex] || MIN_HEIGHT;
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
	}

	function handleMouseMove(e: MouseEvent) {
		if (colBeingResized !== null) {
			const diffX = e.clientX - startX;
			spreadsheetData.colWidths[colBeingResized] = Math.max(
				MIN_WIDTH,
				startWidth + diffX,
			);
		}
		if (rowBeingResized !== null) {
			const diffY = e.clientY - startY;
			spreadsheetData.rowHeights[rowBeingResized] = Math.max(
				MIN_HEIGHT,
				startHeight + diffY,
			);
		}
		spreadsheetData = spreadsheetData;
		debouncedResizeUpdate();
	}

	function handleMouseUp() {
		colBeingResized = null;
		rowBeingResized = null;
		window.removeEventListener("mousemove", handleMouseMove);
		window.removeEventListener("mouseup", handleMouseUp);
		dispatch("update");
	}

	function handleCellMouseDown(row: number, col: number) {
		if (editingCell?.row === row && editingCell?.col === col) {
			return;
		}
		isSelecting = true;
		selection = { start: { row, col }, end: { row, col } };
		window.addEventListener("mouseover", handleCellMouseOver);
		window.addEventListener("mouseup", handleCellMouseUp);
	}

	function handleCellMouseOver(e: MouseEvent) {
		if (!isSelecting) return;
		const target = e.target as HTMLElement;
		const cellWrapper = target.closest(".cell-wrapper");
		if (cellWrapper) {
			const row = parseInt(cellWrapper.getAttribute("data-row")!, 10);
			const col = parseInt(cellWrapper.getAttribute("data-col")!, 10);
			selection = { ...selection!, end: { row, col } };
		}
	}

	function handleCellMouseUp() {
		isSelecting = false;
		window.removeEventListener("mouseover", handleCellMouseOver);
		window.removeEventListener("mouseup", handleCellMouseUp);
	}

	type CellStyleKey = keyof NonNullable<SpreadsheetCell["style"]>;

	export function applyStyle(style: CellStyleKey, value: string | undefined) {
		if (!selectionArea) return;
		const { minRow, maxRow, minCol, maxCol } = selectionArea;

		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				const cell = spreadsheetData.data[r][c];
				cell.style = cell.style || {};

				if (
					(style === "fontWeight" || style === "fontStyle") &&
					cell.style[style] === value
				) {
					delete cell.style[style];
				} else {
					(cell.style as any)[style] = value;
				}
			}
		}

		spreadsheetData = spreadsheetData;
		dispatch("update");
	}

	export function toggleMerge() {
		if (!selectionArea) return;

		const { minRow, maxRow, minCol, maxCol } = selectionArea;
		const topLeftCell = spreadsheetData.data[minRow][minCol];

		const isSingleCellSelection =
			selectionArea.rowCount === 1 && selectionArea.colCount === 1;
		const isMergedCell =
			(topLeftCell.rowspan || 1) > 1 || (topLeftCell.colspan || 1) > 1;

		if (isSingleCellSelection && isMergedCell) {
			const { rowspan = 1, colspan = 1, value } = topLeftCell;
			for (let r = minRow; r < minRow + rowspan; r++) {
				for (let c = minCol; c < minCol + colspan; c++) {
					const cell = spreadsheetData.data[r][c];
					delete cell.merged;
					delete cell.rowspan;
					delete cell.colspan;
					cell.value = "";
				}
			}
			topLeftCell.value = value;
		}
		else if (!isSingleCellSelection) {
			const newRowspan = maxRow - minRow + 1;
			const newColspan = maxCol - minCol + 1;
			const valueToKeep = topLeftCell.value;

			for (let r = minRow; r <= maxRow; r++) {
				for (let c = minCol; c <= maxCol; c++) {
					const cell = spreadsheetData.data[r][c];
					if (r === minRow && c === minCol) {
						cell.rowspan = newRowspan;
						cell.colspan = newColspan;
						cell.value = valueToKeep;
						delete cell.merged;
					} else {
						cell.value = "";
						cell.merged = true;
						delete cell.rowspan;
						delete cell.colspan;
					}
				}
			}
		}
		spreadsheetData = spreadsheetData;
		selection = {
			start: { row: minRow, col: minCol },
			end: { row: minRow, col: minCol },
		};
		debouncedRecalculateAndUpdate();
	}

	const debouncedRecalculateAndUpdate = debounce(() => {
		recalculateSheet();
		spreadsheetData = spreadsheetData;
		dispatch("update");
	}, 300);

	let lastSavedStateHash: string | null = null;
	
	const debouncedSaveHistory = debounce(() => {
		if (spreadsheetData?.data) {
			const currentHash = JSON.stringify(spreadsheetData.data);
			if (currentHash !== lastSavedStateHash) {
				saveHistory();
				lastSavedStateHash = currentHash;
			}
		}
	}, 500);

	function saveHistory() {
		if (!spreadsheetData?.data) return;
		
		lastSavedStateHash = JSON.stringify(spreadsheetData.data);
		
		history = history.slice(0, historyIndex + 1);
		
		const shouldCreateCheckpoint = 
			history.length === 0 || 
			history.length % CHECKPOINT_INTERVAL === 0 ||
			!lastHistorySnapshot;
		
		if (shouldCreateCheckpoint) {
			const snapshot = deepClone(spreadsheetData);
			lastHistorySnapshot = snapshot;
			history.push({ data: snapshot, timestamp: Date.now() });
		} else {
			let baseSnapshot: SpreadsheetData | null = lastHistorySnapshot;
			let baseIndex = history.length - 1;
			
			while (baseIndex >= 0 && !history[baseIndex].data) {
				baseIndex--;
			}
			
			if (baseIndex >= 0 && history[baseIndex].data) {
				baseSnapshot = history[baseIndex].data || null;
			}
			
			if (baseSnapshot && baseSnapshot.data) {
				const changes: CellChange[] = [];
				const baseData = baseSnapshot.data;
				const currentData = spreadsheetData.data;
				
				for (let r = 0; r < currentData.length; r++) {
					for (let c = 0; c < currentData[0].length; c++) {
						const oldCell = baseData[r]?.[c];
						const newCell = currentData[r][c];
						
						if (JSON.stringify(oldCell) !== JSON.stringify(newCell)) {
							changes.push({
								row: r,
								col: c,
								oldValue: oldCell ? deepClone(oldCell) : { value: "", computedValue: "" },
								newValue: deepClone(newCell)
							});
						}
					}
				}
				
				if (changes.length > 0) {
					history.push({ changes, timestamp: Date.now() });
				} else {
					return;
				}
			} else {
				const snapshot = deepClone(spreadsheetData);
				lastHistorySnapshot = snapshot;
				history.push({ data: snapshot, timestamp: Date.now() });
			}
		}
		
		historyIndex = history.length - 1;
		if (history.length > MAX_HISTORY) {
			history.shift();
			historyIndex--;
			if (history.length > 0 && !history[0].data) {
				lastHistorySnapshot = null;
			}
		}
	}

	function restoreFromHistory(entry: SpreadsheetHistoryEntry): SpreadsheetData | null {
		if (entry.data) {
			return deepClone(entry.data);
		} else if (entry.changes) {
			const entryIndex = history.indexOf(entry);
			let baseIndex = entryIndex - 1;
			while (baseIndex >= 0 && !history[baseIndex].data) {
				baseIndex--;
			}
			
			if (baseIndex >= 0 && history[baseIndex].data) {
				const baseSnapshot = history[baseIndex].data;
				if (baseSnapshot) {
					const base = deepClone(baseSnapshot);
					for (let i = baseIndex + 1; i <= entryIndex; i++) {
						if (history[i]?.changes) {
							for (const change of history[i].changes!) {
								if (!base.data[change.row]) {
									base.data[change.row] = [];
								}
								base.data[change.row][change.col] = deepClone(change.newValue);
							}
						}
					}
					return base;
				}
			}
		}
		return null;
	}

	function undo() {
		const beforeFlushLength = history.length;
		debouncedSaveHistory.flush();
		const afterFlushLength = history.length;
		
		if (afterFlushLength > beforeFlushLength) {
			if (historyIndex > 0) {
				historyIndex--;
			}
		} else if (historyIndex >= 0) {
			if (historyIndex > 0) {
				historyIndex--;
			} else {
				return;
			}
		} else {
			return;
		}
		
		const previousState = history[historyIndex];
		if (previousState) {
			const restored = restoreFromHistory(previousState);
			if (restored) {
				spreadsheetData = {
					...spreadsheetData,
					data: restored.data,
					colWidths: restored.colWidths || {},
					rowHeights: restored.rowHeights || {}
				};
				needsFormulaCacheRebuild = true;
				recalculateSheet();
				dispatch("update");
				hasSavedHistoryForCurrentEdit = false;
			}
		}
	}

	function redo() {
		debouncedSaveHistory.flush();
		if (historyIndex < history.length - 1 && history.length > 0) {
			historyIndex++;
			const nextState = history[historyIndex];
			if (nextState) {
				const restored = restoreFromHistory(nextState);
				if (restored) {
					spreadsheetData = {
						...spreadsheetData,
						data: restored.data,
						colWidths: restored.colWidths || {},
						rowHeights: restored.rowHeights || {}
					};
					needsFormulaCacheRebuild = true;
					recalculateSheet();
					dispatch("update");
				}
			}
		}
	}

	function getCellKey(row: number, col: number): string {
		return `${row},${col}`;
	}

	function extractCellReferences(formula: string): Set<string> {
		const refs = new Set<string>();
		const cellRefPattern = /[A-Z]+\d+/gi;
		const matches = formula.match(cellRefPattern);
		if (matches) {
			for (const match of matches) {
				const coords = parseCellReference(match);
				if (coords) {
					refs.add(getCellKey(coords.row, coords.col));
				}
			}
		}
		const rangePattern = /([A-Z]+\d+):([A-Z]+\d+)/gi;
		const rangeMatches = formula.matchAll(rangePattern);
		for (const match of rangeMatches) {
			const start = parseCellReference(match[1]);
			const end = parseCellReference(match[2]);
			if (start && end) {
				const minRow = Math.min(start.row, end.row);
				const maxRow = Math.max(start.row, end.row);
				const minCol = Math.min(start.col, end.col);
				const maxCol = Math.max(start.col, end.col);
				for (let r = minRow; r <= maxRow; r++) {
					for (let c = minCol; c <= maxCol; c++) {
						refs.add(getCellKey(r, c));
					}
				}
			}
		}
		return refs;
	}

	function rebuildFormulaCache() {
		if (!spreadsheetData?.data) return;
		
		cachedFormulaCells = [];
		formulaDependencies.clear();

		for (let r = 0; r < spreadsheetData.data.length; r++) {
			for (let c = 0; c < spreadsheetData.data[0].length; c++) {
				const cell = spreadsheetData.data[r][c];
				if (typeof cell.value === "string" && cell.value.startsWith("=")) {
					const cellKey = getCellKey(r, c);
					cachedFormulaCells.push({ row: r, col: c });
					formulaDependencies.set(cellKey, extractCellReferences(cell.value));
				} else {
					cell.computedValue = cell.value;
				}
			}
		}
		needsFormulaCacheRebuild = false;
	}

	function recalculateSheet(changedCells?: Set<string>) {
		if (!spreadsheetData?.data) return;

		if (needsFormulaCacheRebuild || !cachedFormulaCells) {
			rebuildFormulaCache();
		}

		if (!cachedFormulaCells) return;

		if (!changedCells || changedCells.size === 0) {
			for (let i = 0; i < 10; i++) {
				let changed = false;
				for (const { row, col } of cachedFormulaCells) {
					const cell = spreadsheetData.data[row][col];
					const newValue = evaluateFormula(cell.value, new Set());
					if (cell.computedValue !== newValue) {
						cell.computedValue = newValue;
						changed = true;
					}
				}
				if (!changed) break;
			}
			return;
		}

		const changedFormulaCells = new Set<string>();
		for (const changedCellKey of changedCells) {
			const [rowStr, colStr] = changedCellKey.split(',');
			const row = parseInt(rowStr, 10);
			const col = parseInt(colStr, 10);
			if (row >= 0 && row < spreadsheetData.data.length && 
			    col >= 0 && col < spreadsheetData.data[0].length) {
				const cell = spreadsheetData.data[row][col];
				if (typeof cell.value === "string" && cell.value.startsWith("=")) {
					changedFormulaCells.add(changedCellKey);
				} else {
					cell.computedValue = cell.value;
				}
			}
		}

		const formulasToRecalculate = new Set<string>(changedFormulaCells);
		for (const [formulaKey, dependencies] of formulaDependencies.entries()) {
			for (const changedCell of changedCells) {
				if (dependencies.has(changedCell)) {
					formulasToRecalculate.add(formulaKey);
					break;
				}
			}
		}

		if (formulasToRecalculate.size === 0) return;

		for (let i = 0; i < 10; i++) {
			let changed = false;
			for (const formulaKey of formulasToRecalculate) {
				const [rowStr, colStr] = formulaKey.split(',');
				const row = parseInt(rowStr, 10);
				const col = parseInt(colStr, 10);
				const cell = spreadsheetData.data[row][col];
				const newValue = evaluateFormula(cell.value, new Set());
				if (cell.computedValue !== newValue) {
					cell.computedValue = newValue;
					changed = true;
					changedCells.add(formulaKey);
				}
			}
			if (!changed) break;
			
			const newFormulasToCheck = new Set<string>();
			for (const [formulaKey, dependencies] of formulaDependencies.entries()) {
				if (formulasToRecalculate.has(formulaKey)) continue;
				for (const changedCell of changedCells) {
					if (dependencies.has(changedCell)) {
						newFormulasToCheck.add(formulaKey);
						break;
					}
				}
			}
			for (const key of newFormulasToCheck) {
				formulasToRecalculate.add(key);
			}
		}
	}

	function evaluateFormula(formula: string, evaluating: Set<string>): string {
		if (evaluating.has(formula)) {
			return "#REF!";
		}
		evaluating.add(formula);

		const expression = formula.substring(1);
		const upperExpr = expression.trim().toUpperCase();

		const sumMatch = upperExpr.match(/^SUM\((.*)\)$/);
		if (sumMatch) {
			return handleSumFunction(sumMatch[1]);
		}

		const avgMatch = upperExpr.match(/^AVG\((.*)\)$/);
		if (avgMatch) {
			return handleAvgFunction(avgMatch[1]);
		}

		return evaluateSimpleMath(expression.trim());
	}

	function handleSumFunction(argsStr: string): string {
		const args = argsStr.split(",");
		let sum = 0;
		for (const arg of args) {
			const trimmedArg = arg.trim();
			if (trimmedArg.includes(":")) {
				const [startRef, endRef] = trimmedArg.split(":");
				const start = parseCellReference(startRef);
				const end = parseCellReference(endRef);
				if (start && end) {
					const { minRow, maxRow, minCol, maxCol } = {
						minRow: Math.min(start.row, end.row),
						maxRow: Math.max(start.row, end.row),
						minCol: Math.min(start.col, end.col),
						maxCol: Math.max(start.col, end.col),
					};
					for (let r = minRow; r <= maxRow; r++) {
						for (let c = minCol; c <= maxCol; c++) {
							const cell = spreadsheetData.data[r][c];
							sum += getCellValueForCalculation(cell);
						}
					}
				}
			} else {
				const cellCoords = parseCellReference(trimmedArg);
				if (cellCoords) {
					const cell = spreadsheetData.data[cellCoords.row][cellCoords.col];
					sum += getCellValueForCalculation(cell);
				}
			}
		}
		return sum.toString();
	}

	function handleAvgFunction(argsStr: string): string {
		const args = argsStr.split(",");
		let sum = 0;
		let count = 0;

		for (const arg of args) {
			const trimmedArg = arg.trim();
			if (trimmedArg.includes(":")) {
				const [startRef, endRef] = trimmedArg.split(":");
				const start = parseCellReference(startRef);
				const end = parseCellReference(endRef);
				if (start && end) {
					const { minRow, maxRow, minCol, maxCol } = {
						minRow: Math.min(start.row, end.row),
						maxRow: Math.max(start.row, end.row),
						minCol: Math.min(start.col, end.col),
						maxCol: Math.max(start.col, end.col),
					};
					for (let r = minRow; r <= maxRow; r++) {
						for (let c = minCol; c <= maxCol; c++) {
							const cell = spreadsheetData.data[r][c];
							sum += getCellValueForCalculation(cell);
							count++;
						}
					}
				}
			} else {
				const cellCoords = parseCellReference(trimmedArg);
				if (cellCoords) {
					const cell = spreadsheetData.data[cellCoords.row][cellCoords.col];
					sum += getCellValueForCalculation(cell);
					count++;
				}
			}
		}

		if (count === 0) {
			return "#ERROR!";
		}

		const average = sum / count;
		return average.toString();
	}

	function evaluateSimpleMath(expression: string): string {
		const resolvedExpression = expression.replace(/[A-Z]+\d+/gi, (match) => {
			const coords = parseCellReference(match);
			if (coords) {
				const cell = spreadsheetData.data[coords.row][coords.col];
				const value = getCellValueForCalculation(cell).toString();
				return value;
			}
			return "0";
		});

		try {
			const validPattern = /^[\d\s()+\-*/.]+$/;
			if (!validPattern.test(resolvedExpression)) {
				return "#ERROR!";
			}
			
			const result = evaluateExpression(resolvedExpression);
			
			if (typeof result === "number" && isFinite(result)) {
				return result.toString();
			}
			return "#ERROR!";
		} catch (e) {
			return "#ERROR!";
		}
	}

	function evaluateExpression(expr: string): number {
		expr = expr.replace(/\s/g, '');
		
		while (expr.includes('(')) {
			const start = expr.lastIndexOf('(');
			const end = expr.indexOf(')', start);
			if (end === -1) throw new Error('Mismatched parentheses');
			
			const inner = expr.substring(start + 1, end);
			const innerResult = evaluateExpression(inner);
			expr = expr.substring(0, start) + innerResult.toString() + expr.substring(end + 1);
		}
		
		while (expr.includes('*') || expr.includes('/')) {
			const mulIndex = expr.indexOf('*');
			const divIndex = expr.indexOf('/');
			const opIndex = (mulIndex !== -1 && divIndex !== -1) 
				? Math.min(mulIndex, divIndex)
				: (mulIndex !== -1 ? mulIndex : divIndex);
			
			if (opIndex === -1) break;
			
			const left = parseOperand(expr, opIndex - 1, -1);
			const right = parseOperand(expr, opIndex + 1, 1);
			
			const result = expr[opIndex] === '*' 
				? left.value * right.value 
				: left.value / right.value;
			
			expr = expr.substring(0, left.start) + result.toString() + expr.substring(right.end);
		}
		
		while (expr.includes('+') || (expr.includes('-') && expr.indexOf('-') > 0)) {
			const plusIndex = expr.indexOf('+');
			const minusIndex = expr.indexOf('-', 1);
			const opIndex = (plusIndex !== -1 && minusIndex !== -1)
				? Math.min(plusIndex, minusIndex)
				: (plusIndex !== -1 ? plusIndex : minusIndex);
			
			if (opIndex === -1) break;
			
			const left = parseOperand(expr, opIndex - 1, -1);
			const right = parseOperand(expr, opIndex + 1, 1);
			
			const result = expr[opIndex] === '+'
				? left.value + right.value
				: left.value - right.value;
			
			expr = expr.substring(0, left.start) + result.toString() + expr.substring(right.end);
		}
		
		const final = parseFloat(expr);
		if (isNaN(final)) throw new Error('Invalid expression');
		return final;
	}
	
	function parseOperand(expr: string, start: number, direction: number): { value: number; start: number; end: number } {
		let i = start;
		let hasDecimal = false;
		
		if (direction < 0) {
			while (i >= 0 && (/\d/.test(expr[i]) || expr[i] === '.' || (i === start && expr[i] === '-'))) {
				if (expr[i] === '.') {
					if (hasDecimal) break;
					hasDecimal = true;
				}
				i--;
			}
			i++;
			const numStr = expr.substring(i, start + 1);
			const value = parseFloat(numStr);
			return { value, start: i, end: start + 1 };
		} else {
			if (expr[i] === '-') {
				i++;
			}
			while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === '.')) {
				if (expr[i] === '.') {
					if (hasDecimal) break;
					hasDecimal = true;
				}
				i++;
			}
			const numStr = expr.substring(start, i);
			const value = parseFloat(numStr);
			return { value, start, end: i };
		}
	}

	function parseCellReference(
		ref: string,
	): { row: number; col: number } | null {
		const match = ref.trim().match(/^([A-Z]+)(\d+)$/i);
		if (!match) return null;

		const [, colName, rowNum] = match;
		const col = getColIndexFromName(colName.toUpperCase());
		const row = parseInt(rowNum, 10) - 1;

		if (
			row >= 0 &&
			row < spreadsheetData.data.length &&
			col >= 0 &&
			col < spreadsheetData.data[0].length
		) {
			return { row, col };
		}
		return null;
	}

	function getColIndexFromName(name: string): number {
		let result = 0;
		for (let i = 0; i < name.length; i++) {
			result *= 26;
			result += name.charCodeAt(i) - "A".charCodeAt(0) + 1;
		}
		return result - 1;
	}

	function getCellValueForCalculation(cell: SpreadsheetCell): number {
		const num = parseFloat(cell.computedValue || cell.value);
		return isNaN(num) ? 0 : num;
	}

	function handleCopy() {
		if (!selectionArea) return;
		const { minRow, maxRow, minCol, maxCol } = selectionArea;
		const bufferData: SpreadsheetCell[][] = [];

		for (let r = minRow; r <= maxRow; r++) {
			const rowData: SpreadsheetCell[] = [];
			for (let c = minCol; c <= maxCol; c++) {
				rowData.push(
					deepClone(spreadsheetData.data[r][c]),
				);
			}
			bufferData.push(rowData);
		}

		clipboardBuffer = { data: bufferData, rowCount: maxRow-minRow+1, colCount: maxCol-minCol+1 };
		clipboardMode = "copy";
		clipboardSourceArea = null;
		selection = null;
		dispatch("update");
	}

	function handleCut() {
		if (!selectionArea) return;
		saveHistory();
		const { minRow, maxRow, minCol, maxCol } = selectionArea;
		const bufferData: SpreadsheetCell[][] = [];

		for (let r = minRow; r <= maxRow; r++) {
			const rowData: SpreadsheetCell[] = [];
			for (let c = minCol; c <= maxCol; c++) {
				rowData.push(
					deepClone(spreadsheetData.data[r][c]),
				);
			}
			bufferData.push(rowData);
		}

		clipboardBuffer = { data: bufferData, rowCount: maxRow-minRow+1, colCount: maxCol-minCol+1 };
		clipboardMode = "cut";
		clipboardSourceArea = { ...selectionArea };
		selection = null;
		dispatch("update");
	}

	function handlePaste() {
		if (!clipboardBuffer || !selectedCell) return;
		saveHistory();
		const { row: startRow, col: startCol } = selectedCell;

		if (clipboardMode === "cut" && clipboardSourceArea) {
			const { minRow, maxRow, minCol, maxCol } = clipboardSourceArea;
			for (let r = minRow; r <= maxRow; r++) {
				for (let c = minCol; c <= maxCol; c++) {
					spreadsheetData.data[r][c] = { value: "", computedValue: "" };
				}
			}
		}

		for (let r = 0; r < clipboardBuffer.rowCount; r++) {
			for (let c = 0; c < clipboardBuffer.colCount; c++) {
				const targetRow = startRow + r;
				const targetCol = startCol + c;

				if (
					targetRow < spreadsheetData.data.length &&
					targetCol < spreadsheetData.data[0].length
				) {
					spreadsheetData.data[targetRow][targetCol] = deepClone(
						clipboardBuffer.data[r][c],
					);
				}
			}
		}

		clipboardBuffer = null;
		clipboardSourceArea = null;
		clipboardMode = null;
		debouncedRecalculateAndUpdate();
	}

	async function handleGridKeyDown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			debouncedSaveHistory.flush();
			undo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
			e.preventDefault();
			e.stopPropagation();
			debouncedSaveHistory.flush();
			redo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
			e.preventDefault();
			handleCut();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
			e.preventDefault();
			handleCopy();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
			e.preventDefault();
			handlePaste();
			return;
		}
		if (e.key === "Escape") {
			if (clipboardMode === "cut") {
				e.preventDefault();
				clipboardBuffer = null;
				clipboardSourceArea = null;
				clipboardMode = null;
			}
			return;
		}

		if (
			(e.key === "Backspace" || e.key === "Delete") &&
			selectionArea &&
			!editingCell
		) {
			e.preventDefault();
			saveHistory();
			const { minRow, maxRow, minCol, maxCol } = selectionArea;
			for (let r = minRow; r <= maxRow; r++) {
				for (let c = minCol; c <= maxCol; c++) {
					spreadsheetData.data[r][c].value = "";
				}
			}
			debouncedRecalculateAndUpdate();
			return;
		}

		const navigationKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"];
		if (!navigationKeys.includes(e.key) || !selectedCell) {
			return;
		}
		
		e.preventDefault();
		let { row, col } = selectedCell;

		switch (e.key) {
			case "ArrowUp":    row = Math.max(0, row - 1); break;
			case "ArrowDown":  row = Math.min(spreadsheetData.data.length - 1, row + 1); break;
			case "ArrowLeft":  col = Math.max(0, col - 1); break;
			case "ArrowRight": col = Math.min(spreadsheetData.data[0].length - 1, col + 1); break;
			case "Enter":      row = Math.min(spreadsheetData.data.length - 1, row + 1); break;
		}

		selectedCell = { row, col };
		selection = { start: { row, col }, end: { row, col } };
		editingCell = null;

		await tick();
		const input = container.querySelector<HTMLInputElement>(
			`.cell-wrapper[data-row="${row}"][data-col="${col}"] input`,
		);
		input?.focus();
	}

	function handleCellFocus(rowIndex: number, colIndex: number) {
		const wasEditing = editingCell !== null;
		const cellChanged = !wasEditing || (editingCell !== null && (editingCell.row !== rowIndex || editingCell.col !== colIndex));
		
		selectedCell = { row: rowIndex, col: colIndex };
		selection = {
			start: { row: rowIndex, col: colIndex },
			end: { row: rowIndex, col: colIndex },
		};
		editingCell = { row: rowIndex, col: colIndex };
		
		if (cellChanged) {
			debouncedSaveHistory.flush();
			hasSavedHistoryForCurrentEdit = false;
			saveHistory();
			hasSavedHistoryForCurrentEdit = true;
		}
	}

	onMount(() => {
		rebuildFormulaCache();
		recalculateSheet();
		saveHistory();
	});

	onDestroy(() => {
		window.removeEventListener("mousemove", handleMouseMove);
		window.removeEventListener("mouseup", handleMouseUp);
		window.removeEventListener("mouseover", handleCellMouseOver);
		window.removeEventListener("mouseup", handleCellMouseUp);
		
		colBeingResized = null;
		rowBeingResized = null;
		isSelecting = false;

		debouncedRecalculateAndUpdate.flush();
	});
</script>

<div
	class="spreadsheet-container"
	bind:this={container}
	tabindex="0"
	on:keydown={handleGridKeyDown}
>
	<div class="grid-wrapper">
		<div class="corner-header"></div>

		<div
			class="col-headers"
			style="grid-template-columns: {gridTemplateColumns};"
		>
			{#each spreadsheetData.data[0] as _, colIndex (colIndex)}
				<div class="header-cell">
					{getColName(colIndex)}
					<div
						class="col-resizer"
						on:mousedown={(e) => handleColMouseDown(e, colIndex)}
					></div>
				</div>
			{/each}
		</div>

		<div class="row-headers">
			{#each spreadsheetData.data as _, rowIndex (rowIndex)}
				<div
					class="header-cell"
					style="height: {spreadsheetData.rowHeights[rowIndex] ||
						MIN_HEIGHT}px;"
				>
					{rowIndex + 1}
					<div
						class="row-resizer"
						on:mousedown={(e) => handleRowMouseDown(e, rowIndex)}
					></div>
				</div>
			{/each}
		</div>

		<div
			class="data-grid"
			style="grid-template-columns: {gridTemplateColumns};"
		>
			{#if clipboardMode === "cut" && clipboardSourceArea}
				{@const top = rowPositions[clipboardSourceArea.minRow]}
				{@const left = colPositions[clipboardSourceArea.minCol]}
				{@const width =
					colPositions[clipboardSourceArea.maxCol + 1] - left - 1}
				{@const height =
					rowPositions[clipboardSourceArea.maxRow + 1] - top - 1}
				<div
					class="cut-selection-indicator"
					style="top: {top}px; left: {left}px; width: {width}px; height: {height}px;"
				></div>
			{/if}

			{#each spreadsheetData.data as row, rowIndex (rowIndex)}
				{#each row as cell, colIndex (`${rowIndex}-${colIndex}`)}
					{#if !cell.merged}
						<div
							class="cell-wrapper"
							class:selected={isInSelection(rowIndex, colIndex)}
							data-row={rowIndex}
							data-col={colIndex}
							style="grid-row: span {cell.rowspan ||
								1}; grid-column: span {cell.colspan ||
								1}; height: {calculateMergedHeight(
								cell,
								rowIndex,
							)}px;"
							on:mousedown={() => handleCellMouseDown(rowIndex, colIndex)}
							on:dblclick={() => handleCellFocus(rowIndex, colIndex)}
						>
							<input
								type="text"
								class="cell"
								value={editingCell?.row === rowIndex &&
								editingCell.col === colIndex
									? cell.value
									: cell.computedValue}
								on:input={(e) => {
									const newValue = (e.target as HTMLInputElement).value;
									const oldValue = typeof cell.value === "string" ? cell.value : "";
									const wasDeletion = newValue.length < oldValue.length;
									
									if (!hasSavedHistoryForCurrentEdit) {
										saveHistory();
										hasSavedHistoryForCurrentEdit = true;
									}
									
									if (wasDeletion) {
										debouncedSaveHistory.flush();
										saveHistory();
										hasSavedHistoryForCurrentEdit = false;
									} else {
										debouncedSaveHistory();
									}
									
									const wasFormula = typeof cell.value === "string" && cell.value.startsWith("=");
									const isFormula = newValue.startsWith("=");
									
									cell.value = newValue;
									
									if (wasFormula !== isFormula) {
										needsFormulaCacheRebuild = true;
									}
									
									const changedCell = new Set<string>([getCellKey(rowIndex, colIndex)]);
									recalculateSheet(changedCell);
									spreadsheetData = spreadsheetData;
									dispatch("update");
								}}
								on:blur={(e) => {
									const newValue = (e.target as HTMLInputElement).value;
									debouncedSaveHistory.flush();
									lastSavedCellValue = null;
									hasSavedHistoryForCurrentEdit = false;
									editingCell = null;
								}}
								on:focus={(e) => {
									const currentValue = (e.target as HTMLInputElement).value;
									lastSavedCellValue = currentValue;
									handleCellFocus(rowIndex, colIndex);
								}}
								on:keydown={(e) => {
									if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
										e.preventDefault();
										e.stopPropagation();
										undo();
										return false;
									} else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
										e.preventDefault();
										e.stopPropagation();
										redo();
										return false;
									}
								}}
								style="font-weight: {cell.style
									?.fontWeight}; font-style: {cell.style
									?.fontStyle}; text-align: {cell.style
									?.textAlign};"
							/>
						</div>
					{/if}
				{/each}
			{/each}
		</div>
	</div>
</div>

<style>
  .spreadsheet-container {
    width: 100%;
    height: 100%;
    flex: 1;
    overflow: auto;
    position: relative;
    background-color: var(--panel-bg-darker);
    scrollbar-width: none;
    -ms-overflow-style: none;
    outline: none;
    min-height: 0;
    min-width: 0;
    max-width: 100%;
    max-height: 100%;
    contain: layout style paint;
  }
  .spreadsheet-container::-webkit-scrollbar {
    display: none;
  }
  .grid-wrapper {
    display: grid;
    grid-template-areas:
      "corner col-headers"
      "row-headers data-grid";
    grid-template-columns: 50px 1fr;
    grid-template-rows: 25px 1fr;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: auto;
    max-width: 100%;
    max-height: 100%;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .grid-wrapper::-webkit-scrollbar {
    display: none;
  }
  .corner-header {
    grid-area: corner;
    position: sticky;
    top: 0;
    left: 0;
    z-index: 3;
    background-color: #333;
    border-bottom: 1px solid #444;
    border-right: 1px solid #444;
  }
  .col-headers {
    grid-area: col-headers;
    display: grid;
    position: sticky;
    top: 0;
    z-index: 2;
    background-color: #333;
  }
  .row-headers {
    grid-area: row-headers;
    position: sticky;
    left: 0;
    z-index: 2;
    background-color: #333;
  }
  .data-grid {
    grid-area: data-grid;
    display: grid;
    grid-auto-rows: min-content;
    position: relative;
  }
  .header-cell {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid #444;
    border-right: 1px solid #444;
    position: relative;
    user-select: none;
  }
  .cell-wrapper {
    position: relative;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }
  .cell-wrapper.selected:not(:focus-within) {
    z-index: 2;
    outline: 2px solid var(--accent-red);
    outline-offset: -1px;
  }
  .cut-selection-indicator {
    position: absolute;
    border: 2px dashed var(--accent-purple);
    pointer-events: none;
    z-index: 3;
  }
  .cell {
    background: var(--panel-bg);
    border: none;
    outline: none;
    color: var(--text);
    padding: 0 4px;
    font-size: 16px;
    transform: scale(0.8125);
    transform-origin: top left;
    font-family: var(--font-sans);
    width: calc(100% / 0.8125);
    height: calc(100% / 0.8125);
    box-sizing: border-box;
  }
  .cell:focus {
    outline: 2px solid var(--accent-purple);
    outline-offset: -2px;
  }
  .col-resizer {
    position: absolute;
    top: 0;
    right: -3px;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 4;
  }
  .row-resizer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -3px;
    height: 6px;
    cursor: row-resize;
    z-index: 4;
  }
</style>