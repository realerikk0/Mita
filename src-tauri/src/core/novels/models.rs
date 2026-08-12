use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const NOVEL_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NovelProject {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub kind: String,
    pub genre: String,
    pub synopsis: String,
    pub status: String,
    pub active_unit_id: String,
    pub unit_order: Vec<String>,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNovelProjectRequest {
    pub title: String,
    #[serde(default = "default_novel_kind")]
    pub kind: String,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub synopsis: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub initial_content: Option<Value>,
}

fn default_novel_kind() -> String {
    "web_novel".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NovelProjectSummary {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub kind: String,
    pub genre: String,
    pub synopsis: String,
    pub status: String,
    pub active_unit_id: String,
    pub unit_order: Vec<String>,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
    pub unit_count: usize,
    pub word_count: u64,
}

impl From<&NovelProject> for NovelProjectSummary {
    fn from(project: &NovelProject) -> Self {
        Self {
            schema_version: project.schema_version,
            id: project.id.clone(),
            title: project.title.clone(),
            kind: project.kind.clone(),
            genre: project.genre.clone(),
            synopsis: project.synopsis.clone(),
            status: project.status.clone(),
            active_unit_id: project.active_unit_id.clone(),
            unit_order: project.unit_order.clone(),
            revision: project.revision,
            created_at: project.created_at.clone(),
            updated_at: project.updated_at.clone(),
            unit_count: project.unit_order.len(),
            word_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptUnit {
    pub schema_version: u32,
    pub id: String,
    pub novel_id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub position: i64,
    pub summary: String,
    pub goal: String,
    pub word_count: u64,
    pub content: Value,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionedCollection {
    pub schema_version: u32,
    pub revision: u64,
    pub updated_at: String,
    pub items: Vec<Value>,
}

impl VersionedCollection {
    pub fn empty(items: Vec<Value>, updated_at: String) -> Self {
        Self {
            schema_version: NOVEL_SCHEMA_VERSION,
            revision: 0,
            updated_at,
            items,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveManuscriptUnitRequest {
    pub novel_id: String,
    pub unit: ManuscriptUnit,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNovelResourceRequest {
    pub novel_id: String,
    pub expected_revision: u64,
    pub items: Vec<Value>,
    #[serde(default)]
    pub unit_id: Option<String>,
}

pub type SaveNovelSuggestionsRequest = SaveNovelResourceRequest;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NovelBundle {
    pub project: NovelProject,
    pub units: Vec<ManuscriptUnit>,
    pub characters: VersionedCollection,
    pub relationships: VersionedCollection,
    pub outline: VersionedCollection,
    pub clues: VersionedCollection,
    pub comments: VersionedCollection,
    pub suggestions: VersionedCollection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NovelRevisionSummary {
    pub id: String,
    pub novel_id: String,
    pub unit_id: String,
    pub revision: u64,
    pub created_at: String,
    pub word_count: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreNovelRevisionRequest {
    pub novel_id: String,
    pub unit_id: String,
    pub revision_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNovelProjectRequest {
    pub project: NovelProject,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelImportRequest {
    #[serde(default)]
    pub title: Option<String>,
    pub kind: String,
    pub format: String,
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelExportRequest {
    pub novel_id: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NovelExportResult {
    pub file_name: String,
    pub mime_type: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NovelJournalEntry {
    pub operation: String,
    pub novel_id: String,
    #[serde(default)]
    pub unit_id: Option<String>,
    #[serde(default)]
    pub resource: Option<String>,
    pub revision: u64,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NovelStorageError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<u64>,
    pub outcome_unknown: bool,
}

impl NovelStorageError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            current_revision: None,
            outcome_unknown: false,
        }
    }

    pub fn conflict(expected: u64, current: u64) -> Self {
        Self {
            code: "revision_conflict".to_string(),
            message: format!("Expected revision {expected}, but current revision is {current}"),
            current_revision: Some(current),
            outcome_unknown: false,
        }
    }

    pub fn with_outcome_unknown(mut self) -> Self {
        self.outcome_unknown = true;
        self
    }
}

impl From<String> for NovelStorageError {
    fn from(message: String) -> Self {
        Self::new("storage_error", message)
    }
}

impl From<std::io::Error> for NovelStorageError {
    fn from(error: std::io::Error) -> Self {
        Self::new("io_error", error.to_string())
    }
}

impl From<serde_json::Error> for NovelStorageError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("invalid_json", error.to_string())
    }
}

pub type NovelResult<T> = Result<T, NovelStorageError>;
