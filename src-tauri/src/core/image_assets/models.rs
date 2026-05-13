use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageAssetRequest {
    pub id: String,
    pub prompt: String,
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub size: String,
    pub quality: String,
    #[serde(default)]
    pub source_asset_ids: Vec<String>,
    pub usage: Option<serde_json::Value>,
    pub revised_prompt: Option<String>,
    pub status: String,
    pub mime_type: String,
    pub b64_json: String,
    pub extension: Option<String>,
    pub created_at: Option<String>,
    pub asset_kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageAssetRequest {
    pub id: String,
    pub source_path: String,
    pub prompt: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAssetRecord {
    pub id: String,
    pub prompt: String,
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub size: String,
    pub quality: String,
    pub source_asset_ids: Vec<String>,
    pub created_at: String,
    pub usage: Option<serde_json::Value>,
    pub revised_prompt: Option<String>,
    pub status: String,
    pub path: String,
    pub file_name: String,
    pub mime_type: String,
    pub asset_kind: Option<String>,
}
