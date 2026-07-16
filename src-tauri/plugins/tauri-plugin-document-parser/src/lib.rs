use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod constants;
mod error;
mod parser;

pub use constants::*;
pub use error::DocumentParserError;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("document-parser")
        .invoke_handler(tauri::generate_handler![commands::parse_document,])
        .setup(|_app, _api| Ok(()))
        .build()
}
