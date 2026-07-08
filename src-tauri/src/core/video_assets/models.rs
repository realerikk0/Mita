use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVideoAssetRequest {
    pub id: String,
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub resolution: String,
    pub duration: u32,
    pub fps: u32,
    #[serde(default)]
    pub source_asset_ids: Vec<String>,
    pub usage: Option<serde_json::Value>,
    pub status: String,
    pub mime_type: String,
    #[serde(default)]
    pub b64_json: Option<String>,
    #[serde(default)]
    pub video_url: Option<String>,
    pub extension: Option<String>,
    pub created_at: Option<String>,
    pub asset_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAssetRecord {
    pub id: String,
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub ratio: String,
    pub resolution: String,
    pub duration: u32,
    pub fps: u32,
    pub source_asset_ids: Vec<String>,
    pub created_at: String,
    pub usage: Option<serde_json::Value>,
    pub status: String,
    pub path: String,
    pub file_name: String,
    pub mime_type: String,
    pub asset_kind: Option<String>,
}
