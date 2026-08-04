use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadVideoReferenceMediaRequest {
    pub endpoint: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub custom_headers: HashMap<String, String>,
    pub reference: UploadVideoReference,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadVideoReference {
    pub kind: String,
    pub asset: UploadVideoReferenceAsset,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadVideoReferenceAsset {
    pub path: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedVideoReferenceMedia {
    pub id: String,
    pub kind: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaUploadError {
    pub code: String,
    pub status: Option<u16>,
    pub message: String,
    pub retry_after_seconds: Option<u64>,
    pub request_id: Option<String>,
    pub outcome_unknown: bool,
}

impl MediaUploadError {
    pub(super) fn new(
        code: impl Into<String>,
        status: Option<u16>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            status,
            message: message.into(),
            retry_after_seconds: None,
            request_id: None,
            outcome_unknown: false,
        }
    }

    pub(super) fn outcome_unknown(mut self) -> Self {
        self.outcome_unknown = true;
        self
    }
}
