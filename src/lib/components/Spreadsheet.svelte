<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import type { Spreadsheet, SpreadsheetCell } from "$lib/db";

  export let spreadsheetData: Spreadsheet;
  export let selectedCell: { row: number; col: number } | null = null;
  export let selection: {
    start: { row: number; col: number };
    end: { row: number; col: number };
  } | null = null;

  let isSelecting = false;
  const dispatch = createEventDispatcher();
  let container: HTMLElement;
  let colBeingResized: number | null = null;
  let rowBeingResized: number | null = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let editingCell: { row: number; col: number } | null = null;

  const MIN_WIDTH = 40;
  const MIN_HEIGHT = 25;

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
  let clipboardMode: "cut" | "copy" | null = null;

  type CellStyleKey = keyof NonNullable<SpreadsheetCell["style"]>;

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
      colCount: maxCol - minCol + 1
    };
  })();

  $: rowPositions = (() => {
    const positions = [0];
    let currentPos = 0;
    for (let i = 0; i < spreadsheetData.data.length; i++) {
      currentPos += (spreadsheetData.rowHeights[i] || MIN_HEIGHT) + 1;
      positions.push(currentPos);
    }
    return positions;
  })();

  $: colPositions = (() => {
    const positions = [0];
    let currentPos = 0;
    for (let i = 0; i < spreadsheetData.data[0].length; i++) {
      currentPos += (spreadsheetData.colWidths[i] || 100) + 1;
      positions.push(currentPos);
    }
    return positions;
  })();

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
        startWidth + diffX
      );
    }
    if (rowBeingResized !== null) {
      const diffY = e.clientY - startY;
      spreadsheetData.rowHeights[rowBeingResized] = Math.max(
        MIN_HEIGHT,
        startHeight + diffY
      );
    }
    spreadsheetData = spreadsheetData;
    dispatch("update");
  }

  function handleMouseUp() {
    colBeingResized = null;
    rowBeingResized = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    dispatch("update");
  }

  function handleCellFocus(rowIndex: number, colIndex: number) {
    selectedCell = { row: rowIndex, col: colIndex };
    handleCellMouseDown(rowIndex, colIndex);
    editingCell = { row: rowIndex, col: colIndex };
  }

  function handleCellMouseDown(row: number, col: number) {
    if (
      !editingCell ||
      editingCell.row !== row ||
      editingCell.col !== col
    ) {
      isSelecting = true;
      selection = { start: { row, col }, end: { row, col } };
      window.addEventListener("mouseover", handleCellMouseOver);
      window.addEventListener("mouseup", handleCellMouseUp);
    }
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

  function calculateMergedHeight(cell: SpreadsheetCell, rowIndex: number) {
    const rowspan = cell.rowspan || 1;
    if (rowspan <= 1) {
      return spreadsheetData.rowHeights[rowIndex] || MIN_HEIGHT;
    }
    let totalHeight = 0;
    for (let i = 0; i < rowspan; i++) {
      totalHeight += spreadsheetData.rowHeights[rowIndex + i] || MIN_HEIGHT;
    }
    totalHeight += rowspan - 1;
    return totalHeight;
  }

  function applyStyleToCell(
    row: number,
    col: number,
    style: CellStyleKey,
    value: string | undefined
  ) {
    const cell = spreadsheetData.data[row][col];
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

  export function applyStyle(style: CellStyleKey, value: string | undefined) {
    if (!selectionArea) return;
    const { minRow, maxRow, minCol, maxCol } = selectionArea;

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        applyStyleToCell(r, c, style, value);
      }
    }

    spreadsheetData = spreadsheetData;
    dispatch("update");
  }

  export function toggleMerge() {
    if (!selectionArea) return;

    const { minRow, maxRow, minCol, maxCol } = selectionArea;
    const topLeftCell = spreadsheetData.data[minRow][minCol];

    if (
      selectionArea.rowCount === 1 &&
      selectionArea.colCount === 1 &&
      ((topLeftCell.rowspan || 1) > 1 || (topLeftCell.colspan || 1) > 1)
    ) {
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
    } else {
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
      end: { row: minRow, col: minCol }
    };
    dispatch("update");
  }

  $: gridTemplateColumns = Object.values(spreadsheetData.colWidths)
    .map((w) => `${w}px`)
    .join(" ");

  function getColIndexFromName(name: string): number {
    let result = 0;
    for (let i = 0; i < name.length; i++) {
      result *= 26;
      result += name.charCodeAt(i) - "A".charCodeAt(0) + 1;
    }
    return result - 1;
  }

  function parseCellReference(ref: string): { row: number; col: number } | null { // prettier-ignore
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

  function getCellValueForCalculation(cell: SpreadsheetCell): number {
    const num = parseFloat(cell.computedValue);
    return isNaN(num) ? 0 : num;
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
          const minRow = Math.min(start.row, end.row);
          const maxRow = Math.max(start.row, end.row);
          const minCol = Math.min(start.col, end.col);
          const maxCol = Math.max(start.col, end.col);

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

  function evaluateSimpleMath(expression: string): string {
    const resolvedExpression = expression.replace(
      /[A-Z]+\d+/gi,
      (match) => {
        const coords = parseCellReference(match);
        if (coords) {
          const cell = spreadsheetData.data[coords.row][coords.col];
          const val = getCellValueForCalculation(cell);
          return val.toString();
        }
        return "0";
      }
    );

    try {
      if (/^[\d\s()+\-*/.]+$/.test(resolvedExpression)) {
        const result = new Function(`return ${resolvedExpression}`)();
        if (typeof result === "number" && isFinite(result)) {
          return result.toString();
        }
      }
      return "#ERROR!";
    } catch (e) {
      return "#ERROR!";
    }
  }

  function evaluateFormula(
    formula: string,
    evaluating: Set<string>
  ): string {
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

    return evaluateSimpleMath(expression.trim());
  }

  function recalculateSheet() {
    if (!spreadsheetData || !spreadsheetData.data) return;

    const formulaCells: { row: number; col: number }[] = [];
    for (let r = 0; r < spreadsheetData.data.length; r++) {
      for (let c = 0; c < spreadsheetData.data[0].length; c++) {
        const cell = spreadsheetData.data[r][c];
        if (typeof cell.value === "string" && cell.value.startsWith("=")) {
          formulaCells.push({ row: r, col: c });
        } else {
          cell.computedValue = cell.value;
        }
      }
    }

    for (let i = 0; i < 10; i++) {
      let changed = false;
      for (const { row, col } of formulaCells) {
        const cell = spreadsheetData.data[row][col];
        const newValue = evaluateFormula(cell.value, new Set());
        if (cell.computedValue !== newValue) {
          cell.computedValue = newValue;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  function handleCopy() {
    if (!selectionArea) return;
    const { minRow, maxRow, minCol, maxCol } = selectionArea;
    const bufferData: SpreadsheetCell[][] = [];

    for (let r = minRow; r <= maxRow; r++) {
      const rowData: SpreadsheetCell[] = [];
      for (let c = minCol; c <= maxCol; c++) {
        rowData.push(JSON.parse(JSON.stringify(spreadsheetData.data[r][c])));
      }
      bufferData.push(rowData);
    }

    clipboardBuffer = {
      data: bufferData,
      rowCount: maxRow - minRow + 1,
      colCount: maxCol - minCol + 1
    };

    clipboardMode = "copy";
    clipboardSourceArea = null;
    selection = null;
    dispatch("update");
  }

  function handleCut() {
    if (!selectionArea) return;
    const { minRow, maxRow, minCol, maxCol } = selectionArea;
    const bufferData: SpreadsheetCell[][] = [];

    for (let r = minRow; r <= maxRow; r++) {
      const rowData: SpreadsheetCell[] = [];
      for (let c = minCol; c <= maxCol; c++) {
        rowData.push(JSON.parse(JSON.stringify(spreadsheetData.data[r][c])));
      }
      bufferData.push(rowData);
    }

    clipboardBuffer = {
      data: bufferData,
      rowCount: maxRow - minRow + 1,
      colCount: maxCol - minCol + 1
    };

    clipboardMode = "cut";
    clipboardSourceArea = { ...selectionArea };
    selection = null;
    dispatch("update");
  }

  function handlePaste() {
    if (!clipboardBuffer || !selectedCell) return;
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
          spreadsheetData.data[targetRow][targetCol] = JSON.parse(
            JSON.stringify(clipboardBuffer.data[r][c])
          );
        }
      }
    }

    clipboardBuffer = null;
    clipboardSourceArea = null;
    clipboardMode = null;

    spreadsheetData = spreadsheetData;
    dispatch("update");
  }

  const debouncedRecalculateAndUpdate = debounce(() => {
    recalculateSheet();
    spreadsheetData = spreadsheetData;
    dispatch("update");
  }, 300);

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
      e.preventDefault();
      handleCut();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      handleCopy();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      handlePaste();
    } else if (e.key === "Escape") {
      if (clipboardMode === "cut") {
        e.preventDefault();
        clipboardBuffer = null;
        clipboardSourceArea = null;
        clipboardMode = null;
      }
    }
  }

  function handleInputKeydown(e: KeyboardEvent, cell: SpreadsheetCell) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  }

  onMount(() => {
    container.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    if (container) {
      container.removeEventListener("keydown", handleKeyDown);
    }
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("mouseover", handleCellMouseOver);
    window.removeEventListener("mouseup", handleCellMouseUp);

    debouncedRecalculateAndUpdate.flush?.();
  });
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="spreadsheet-container" bind:this={container} tabindex="0">
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
          style="height: {spreadsheetData.rowHeights[rowIndex] || MIN_HEIGHT}px;"
        >
          {rowIndex + 1}
          <div
            class="row-resizer"
            on:mousedown={(e) => handleRowMouseDown(e, rowIndex)}
          ></div>
        </div>
      {/each}
    </div>

    <div class="data-grid" style="grid-template-columns: {gridTemplateColumns};">
      {#if clipboardMode === "cut" && clipboardSourceArea}
        {@const top = rowPositions[clipboardSourceArea.minRow]}
        {@const left = colPositions[clipboardSourceArea.minCol]}
        {@const width = colPositions[clipboardSourceArea.maxCol + 1] - left - 1}
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
                1}; height: {calculateMergedHeight(cell, rowIndex)}px;"
              on:mousedown={() => handleCellMouseDown(rowIndex, colIndex)}
            >
              <input
                type="text"
                class="cell"
                value={editingCell?.row === rowIndex &&
                editingCell.col === colIndex
                  ? cell.value
                  : cell.computedValue}
                on:input={(e) => {
                  cell.value = (e.target as HTMLInputElement).value;
                  debouncedRecalculateAndUpdate();
                }}
                on:blur={() => (editingCell = null)}
                on:keydown={(e) => handleInputKeydown(e, cell)}
                on:focus|capture={() => handleCellFocus(rowIndex, colIndex)}
                on:dblclick={() => handleCellFocus(rowIndex, colIndex)}
                style="font-weight: {cell.style
                  ?.fontWeight}; font-style: {cell.style
                  ?.fontStyle}; text-align: {cell.style?.textAlign};"
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
    overflow: scroll;
    position: relative;
    background-color: var(--panel-bg-darker);
    scrollbar-width: none;
    -ms-overflow-style: none;
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
  }
  .cell-wrapper.selected {
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
    font-size: 13px;
    font-family: var(--font-sans);
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
  .cell:focus {
    outline: none;
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
