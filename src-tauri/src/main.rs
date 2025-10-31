#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri_plugin_sql::{Migration, MigrationKind};

fn main() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, "order" INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT NOT NULL, "order" INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content_html TEXT, updated_at INTEGER NOT NULL, workspace_id TEXT NOT NULL, folder_id TEXT, "order" INTEGER NOT NULL, type TEXT NOT NULL, spreadsheet TEXT);
                CREATE TABLE IF NOT EXISTS calendarEvents (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, time TEXT, workspace_id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS kanban (workspace_id TEXT PRIMARY KEY, columns TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
            "#,
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:neuronotes.db", migrations)
                .build()
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
