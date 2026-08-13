use super::{
    models::{
        CreateNovelProjectRequest, ManuscriptUnit, NovelBundle, NovelExportRequest,
        NovelExportResult, NovelImportRequest, NovelProject, NovelProjectSummary, NovelResult,
        NovelRevisionSummary, RestoreNovelRevisionRequest, SaveManuscriptUnitRequest,
        SaveNovelProjectRequest, SaveNovelResourceRequest, SaveNovelSuggestionsRequest,
        VersionedCollection,
    },
    storage,
};
use crate::core::app::commands::get_biyan_data_folder_path;
use tauri::Runtime;

#[tauri::command]
pub fn list_novel_projects<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> NovelResult<Vec<NovelProjectSummary>> {
    storage::list_projects(&get_biyan_data_folder_path(app))
}

#[tauri::command]
pub fn create_novel_project<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CreateNovelProjectRequest,
) -> NovelResult<NovelBundle> {
    storage::create_project(&get_biyan_data_folder_path(app), request)
}

#[tauri::command]
pub fn open_novel_project<R: Runtime>(
    app: tauri::AppHandle<R>,
    novel_id: String,
) -> NovelResult<NovelBundle> {
    storage::open_project(&get_biyan_data_folder_path(app), &novel_id)
}

#[tauri::command]
pub fn save_novel_project<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SaveNovelProjectRequest,
) -> NovelResult<NovelProject> {
    storage::save_project(&get_biyan_data_folder_path(app), request)
}

#[tauri::command]
pub fn delete_novel_project<R: Runtime>(
    app: tauri::AppHandle<R>,
    novel_id: String,
) -> NovelResult<()> {
    storage::delete_project(&get_biyan_data_folder_path(app), &novel_id)
}

#[tauri::command]
pub fn load_manuscript_unit<R: Runtime>(
    app: tauri::AppHandle<R>,
    novel_id: String,
    unit_id: String,
) -> NovelResult<Option<ManuscriptUnit>> {
    storage::load_manuscript_unit(&get_biyan_data_folder_path(app), &novel_id, &unit_id)
}

#[tauri::command]
pub fn save_manuscript_unit<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SaveManuscriptUnitRequest,
) -> NovelResult<ManuscriptUnit> {
    storage::save_manuscript_unit(&get_biyan_data_folder_path(app), request)
}

macro_rules! resource_command {
    ($function:ident, $resource:literal) => {
        #[tauri::command]
        pub fn $function<R: Runtime>(
            app: tauri::AppHandle<R>,
            request: SaveNovelResourceRequest,
        ) -> NovelResult<VersionedCollection> {
            storage::save_resource(&get_biyan_data_folder_path(app), $resource, request)
        }
    };
}

resource_command!(save_novel_characters, "characters");
resource_command!(save_novel_relationships, "relationships");
resource_command!(save_novel_outline, "outline");
resource_command!(save_novel_clues, "clues");
resource_command!(save_novel_comments, "comments");

#[tauri::command]
pub fn save_novel_suggestions<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SaveNovelSuggestionsRequest,
) -> NovelResult<VersionedCollection> {
    storage::save_suggestions(&get_biyan_data_folder_path(app), request)
}

#[tauri::command]
pub fn import_novel_project<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: NovelImportRequest,
) -> NovelResult<NovelBundle> {
    storage::import_project(&get_biyan_data_folder_path(app), request)
}

#[tauri::command]
pub fn export_novel_project<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: NovelExportRequest,
) -> NovelResult<NovelExportResult> {
    storage::export_project(&get_biyan_data_folder_path(app), request)
}

#[tauri::command]
pub fn list_novel_revisions<R: Runtime>(
    app: tauri::AppHandle<R>,
    novel_id: String,
    unit_id: String,
) -> NovelResult<Vec<NovelRevisionSummary>> {
    storage::list_revisions(&get_biyan_data_folder_path(app), &novel_id, &unit_id)
}

#[tauri::command]
pub fn restore_novel_revision<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: RestoreNovelRevisionRequest,
) -> NovelResult<ManuscriptUnit> {
    storage::restore_revision(&get_biyan_data_folder_path(app), request)
}
