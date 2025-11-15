#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_fs::init as init_fs;

fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content_html TEXT, updated_at INTEGER NOT NULL, workspace_id TEXT NOT NULL, folder_id TEXT, "order" INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'text', spreadsheet TEXT);
                CREATE TABLE IF NOT EXISTS calendarEvents (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, time TEXT, workspace_id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS kanban (workspace_id TEXT PRIMARY KEY, columns TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_calendar_repeat_fields",
            sql: r#"
                ALTER TABLE calendarEvents ADD COLUMN repeat TEXT;
                ALTER TABLE calendarEvents ADD COLUMN repeat_on TEXT;
                ALTER TABLE calendarEvents ADD COLUMN repeat_end TEXT;
                ALTER TABLE calendarEvents ADD COLUMN exceptions TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_calendar_event_color",
            sql: r#"
                ALTER TABLE calendarEvents ADD COLUMN color TEXT;
            "#,
            kind: MigrationKind::Up,
        }
    ]
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:neuronotes.db", get_migrations())
                .add_migrations("sqlite:neuronotes_dev.db", get_migrations())
                .build()
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(init_fs())
        .plugin(tauri_plugin_log::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
