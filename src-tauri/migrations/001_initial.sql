-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    "order" INTEGER DEFAULT 0
);

-- Folders
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    "order" INTEGER DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_folders_workspace ON folders(workspace_id);

-- Notes
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content_html TEXT,
    updated_at INTEGER NOT NULL,
    workspace_id TEXT NOT NULL,
    folder_id TEXT,
    "order" INTEGER DEFAULT 0,
    type TEXT DEFAULT 'text',
    spreadsheet_data TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE INDEX idx_notes_workspace ON notes(workspace_id);
CREATE INDEX idx_notes_folder ON notes(folder_id);
CREATE INDEX idx_notes_workspace_folder ON notes(workspace_id, folder_id);

-- Calendar Events
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    time TEXT,
    workspace_id TEXT NOT NULL,
    repeat TEXT DEFAULT 'none',
    repeat_on TEXT,
    exceptions TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_workspace ON calendar_events(workspace_id);
CREATE INDEX idx_events_date ON calendar_events(date);

-- Kanban
CREATE TABLE IF NOT EXISTS kanban (
    workspace_id TEXT PRIMARY KEY,
    columns_data TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
