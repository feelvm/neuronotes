// src/lib/db_types.ts
// TypeScript types that match the Rust database structs

export type Workspace = {
  id: string;
  name: string;
  order: number;
};

export type Folder = {
  id: string;
  name: string;
  workspaceId: string;
  order: number;
};

export type SpreadsheetCellStyle = {
  fontWeight?: 'bold' | 'normal';
  fontStyle?: 'italic' | 'normal';
  textAlign?: 'left' | 'center' | 'right';
};

export type SpreadsheetCell = {
  value: string;
  style?: SpreadsheetCellStyle;
  rowspan?: number;
  colspan?: number;
  merged?: boolean;
  computedValue?: string;
};

export type Spreadsheet = {
  data: SpreadsheetCell[][];
  rowHeights: Record<number, number>;
  colWidths: Record<number, number>;
};

export type Note = {
  id: string;
  title: string;
  contentHTML: string;
  updatedAt: number;
  workspaceId: string;
  folderId: string | null;
  order: number;
  type: 'text' | 'spreadsheet';
  spreadsheet?: Spreadsheet;
};

export type CalendarEvent = {
  id: string;
  date: string;
  title: string;
  time?: string;
  workspaceId: string;
};

export type Task = {
  id: string;
  text: string;
};

export type Column = {
  id: string;
  title: string;
  tasks: Task[];
  isCollapsed: boolean;
};

export type Kanban = {
  workspaceId: string;
  columns: Column[];
};

export type Setting = {
  key: string;
  value: any;
};
