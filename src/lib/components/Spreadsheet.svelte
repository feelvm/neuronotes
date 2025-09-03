<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  export let spreadsheetData: {
    data: string[][];
    rowHeights: Record<number, number>;
    colWidths: Record<number, number>;
  };

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

  $: gridTemplateColumns = Object.values(spreadsheetData.colWidths)
    .map((w) => `${w}px`)
    .join(" ");
</script>

<div class="spreadsheet-container" bind:this={container}>
  <div class="grid-wrapper">
    <div class="corner-header"></div>

    <div class="col-headers" style="grid-template-columns: {gridTemplateColumns};">
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
          <input
            type="text"
            class="cell"
            bind:value={spreadsheetData.data[rowIndex][colIndex]}
            on:input={handleInput}
            style="height: {spreadsheetData.rowHeights[rowIndex] || MIN_HEIGHT}px;"
          />
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
  .cell {
    background: var(--panel-bg);
    border: none;
    outline: none;
    color: var(--text);
    padding: 0 4px;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    font-size: 13px;
    font-family: var(--font-sans);
  }
  .cell:focus {
    outline: 2px solid var(--accent-red);
    position: relative;
    z-index: 1;
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
