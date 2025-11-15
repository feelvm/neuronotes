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
  date: string; // Start date for recurring events
  title: string;
  time?: string;
  workspaceId: string;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  repeatOn?: number[]; // For custom weekly repeat: day numbers (1=Mon, 2=Tue, ..., 7=Sun)
  repeatEnd?: string; // Optional end date for recurring events
  exceptions?: string[]; // Dates (YYYY-MM-DD) of deleted recurring instances
  color?: string; // Hex color code for the event (e.g., "#8C7AE6")
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
