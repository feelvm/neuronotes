// src-tauri/src/db.rs
use serde::{Deserialize, Serialize};


#[derive(Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub order: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub order: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    #[serde(rename = "contentHTML")]
    pub content_html: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "folderId")]
    pub folder_id: Option<String>,
    pub order: i64,
    #[serde(rename = "type")]
    pub type_field: String, // Use `type_field` because `type` is a Rust keyword
    pub spreadsheet: Option<String>, // Stored as a JSON string
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub date: String,
    pub title: String,
    pub time: Option<String>,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Kanban {
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub columns: String, // Stored as a JSON string
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String, // Stored as a JSON string
}
