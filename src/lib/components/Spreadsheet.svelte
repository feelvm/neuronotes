<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
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

  const MIN_WIDTH = 40;
  const MIN_HEIGHT = 25;

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
  }

  function handleMouseUp() {
    colBeingResized = null;
    rowBeingResized = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    dispatch("update");
  }

  function handleInput() {
    dispatch("update");
  }

  function handleCellFocus(rowIndex: number, colIndex: number) {
    selectedCell = { row: rowIndex, col: colIndex };
  }

  function handleCellMouseDown(row: number, col: number) {
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

  function calculateMergedHeight(cell: SpreadsheetCell, rowIndex: number) {
    const rowspan = cell.rowspan || 1;
    if (rowspan <= 1) {
      return spreadsheetData.rowHeights[rowIndex] || MIN_HEIGHT;
    }
    let totalHeight = 0;
    for (let i = 0; i < rowspan; i++) {
      totalHeight += spreadsheetData.rowHeights[rowIndex + i] || MIN_HEIGHT;
    }
    // Add the height of the borders between the merged rows
    totalHeight += rowspan - 1;
    return totalHeight;
  }

  export function applyStyle(
    style: keyof NonNullable<SpreadsheetCell["style"]>,
    value: string | undefined
  ) {
    if (!selectedCell) return; // Safe guard
    const { row, col } = selectedCell;
    const cell = spreadsheetData.data[row][col];
    cell.style = cell.style || {};

    if (
      (style === "fontWeight" || style === "fontStyle") &&
      cell.style[style] === value
    ) {
      delete cell.style[style];
    } else {
      cell.style[style] = value;
    }

    spreadsheetData = spreadsheetData;
    dispatch("update");
  }

  export function toggleMerge() {
    if (!selectionArea) return;

    const { minRow, maxRow, minCol, maxCol } = selectionArea;
    const topLeftCell = spreadsheetData.data[minRow][minCol];

    // Check if we are unmerging
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
      // Otherwise, we are merging
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
</script>

<div class="spreadsheet-container" bind:this={container}>
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
                bind:value={cell.value}
                on:input={handleInput}
                on:focus={() => handleCellFocus(rowIndex, colIndex)}
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