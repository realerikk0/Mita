use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum DocumentParserError {
    #[error("Failed to parse document: {0}")]
    ParseError(String),

    #[error("Unsupported file type: {0}")]
    UnsupportedFileType(String),

    #[error("IO error: {0}")]
    IoError(String),
}

impl From<std::io::Error> for DocumentParserError {
    fn from(err: std::io::Error) -> Self {
        DocumentParserError::IoError(err.to_string())
    }
}
