use super::commands::{
    delete_image_asset, import_image_asset, list_image_assets, save_image_asset,
    update_image_asset_project,
};
use super::models::{ImageAssetProject, ImportImageAssetRequest, SaveImageAssetRequest};
use crate::core::app::commands::get_mita_data_folder_path;
use std::fs;
use tauri::test::mock_app;

fn test_asset(id: &str) -> SaveImageAssetRequest {
    SaveImageAssetRequest {
        id: id.to_string(),
        prompt: "A quiet moonlit desktop".to_string(),
        mode: "generate".to_string(),
        provider: "jingxing".to_string(),
        model: "gpt-image-2".to_string(),
        ratio: "1:1".to_string(),
        size: "1024x1024".to_string(),
        quality: "high".to_string(),
        source_asset_ids: Vec::new(),
        usage: None,
        revised_prompt: Some("A quiet moonlit desktop".to_string()),
        status: "succeeded".to_string(),
        mime_type: "image/png".to_string(),
        b64_json: "iVBORw0KGgo=".to_string(),
        extension: Some("png".to_string()),
        created_at: Some("2026-05-11T00:00:00Z".to_string()),
        asset_kind: None,
        project: None,
    }
}

fn test_import_asset(id: &str, source_path: String) -> ImportImageAssetRequest {
    ImportImageAssetRequest {
        id: id.to_string(),
        source_path,
        prompt: Some("Local logo".to_string()),
        created_at: Some("2026-05-11T00:00:00Z".to_string()),
    }
}

#[test]
fn saves_lists_and_deletes_image_asset_under_data_folder() {
    let app = mock_app();
    let id = "test-image-asset-roundtrip";
    let _ = delete_image_asset(app.handle().clone(), id.to_string());

    let record = save_image_asset(app.handle().clone(), test_asset(id)).unwrap();
    let data_folder = get_mita_data_folder_path(app.handle().clone());

    assert!(record
        .path
        .starts_with(data_folder.to_string_lossy().as_ref()));
    assert!(record.path.ends_with("image.png"));
    assert!(fs::metadata(&record.path).unwrap().is_file());

    let assets = list_image_assets(app.handle().clone()).unwrap();
    assert!(assets.iter().any(|asset| asset.id == id));

    delete_image_asset(app.handle().clone(), id.to_string()).unwrap();
    assert!(!fs::metadata(&record.path).is_ok());
}

#[test]
fn preserves_source_asset_ids_when_listing_saved_assets() {
    let app = mock_app();
    let id = "test-image-asset-source-roundtrip";
    let reference_id = "test-image-asset-reference-source";
    let _ = delete_image_asset(app.handle().clone(), id.to_string());
    let _ = delete_image_asset(app.handle().clone(), reference_id.to_string());

    let source_path = std::env::temp_dir().join("mita-test-source-reference.png");
    fs::write(&source_path, b"fake image bytes").unwrap();
    let reference = import_image_asset(
        app.handle().clone(),
        test_import_asset(reference_id, source_path.to_string_lossy().to_string()),
    )
    .unwrap();

    let mut request = test_asset(id);
    request.mode = "edit".to_string();
    request.source_asset_ids = vec![reference.id.clone()];
    let record = save_image_asset(app.handle().clone(), request).unwrap();
    assert_eq!(record.source_asset_ids, vec![reference.id.clone()]);

    let assets = list_image_assets(app.handle().clone()).unwrap();
    let listed = assets
        .iter()
        .find(|asset| asset.id == id)
        .expect("saved asset is listed");
    assert_eq!(listed.source_asset_ids, vec![reference.id.clone()]);
    assert!(assets.iter().any(|asset| asset.id == reference_id));

    delete_image_asset(app.handle().clone(), id.to_string()).unwrap();
    delete_image_asset(app.handle().clone(), reference_id.to_string()).unwrap();
    let _ = fs::remove_file(source_path);
}

#[test]
fn updates_image_asset_project_metadata() {
    let app = mock_app();
    let id = "test-image-asset-project-metadata";
    let _ = delete_image_asset(app.handle().clone(), id.to_string());

    let record = save_image_asset(app.handle().clone(), test_asset(id)).unwrap();
    assert!(record.project.is_none());

    let project = ImageAssetProject {
        id: "project-1".to_string(),
        name: "Client Work".to_string(),
        updated_at: 1_780_000_000_000,
    };
    let updated =
        update_image_asset_project(app.handle().clone(), id.to_string(), Some(project)).unwrap();
    assert_eq!(updated.project.as_ref().map(|project| project.id.as_str()), Some("project-1"));

    let assets = list_image_assets(app.handle().clone()).unwrap();
    let listed = assets
        .iter()
        .find(|asset| asset.id == id)
        .expect("saved asset is listed");
    assert_eq!(listed.project.as_ref().map(|project| project.name.as_str()), Some("Client Work"));

    let cleared = update_image_asset_project(app.handle().clone(), id.to_string(), None).unwrap();
    assert!(cleared.project.is_none());

    delete_image_asset(app.handle().clone(), id.to_string()).unwrap();
}

#[test]
fn rejects_unsafe_asset_ids() {
    let app = mock_app();
    let result = save_image_asset(app.handle().clone(), test_asset("../outside"));
    assert!(result.is_err());
}

#[test]
fn rejects_invalid_base64() {
    let app = mock_app();
    let mut asset = test_asset("test-image-asset-invalid-base64");
    asset.b64_json = "not base64".to_string();

    let result = save_image_asset(app.handle().clone(), asset);
    assert!(result.is_err());
}

#[test]
fn imports_reference_asset_under_data_folder() {
    let app = mock_app();
    let id = "test-image-asset-import";
    let _ = delete_image_asset(app.handle().clone(), id.to_string());
    let source_path = std::env::temp_dir().join("mita-test-reference.png");
    fs::write(&source_path, b"fake image bytes").unwrap();

    let record = import_image_asset(
        app.handle().clone(),
        test_import_asset(id, source_path.to_string_lossy().to_string()),
    )
    .unwrap();
    let data_folder = get_mita_data_folder_path(app.handle().clone());

    assert!(record
        .path
        .starts_with(data_folder.to_string_lossy().as_ref()));
    assert!(record.path.ends_with("image.png"));
    assert_eq!(record.asset_kind.as_deref(), Some("reference"));
    assert_eq!(record.provider, "local");
    assert_eq!(record.model, "reference-image");
    assert_eq!(record.quality, "source");
    assert_eq!(fs::read(&record.path).unwrap(), b"fake image bytes");

    delete_image_asset(app.handle().clone(), id.to_string()).unwrap();
    let _ = fs::remove_file(source_path);
}

#[test]
fn rejects_importing_directories() {
    let app = mock_app();
    let result = import_image_asset(
        app.handle().clone(),
        test_import_asset(
            "test-image-asset-import-directory",
            std::env::temp_dir().to_string_lossy().to_string(),
        ),
    );
    assert!(result.is_err());
}

#[test]
fn rejects_unsupported_import_extensions() {
    let app = mock_app();
    let source_path = std::env::temp_dir().join("mita-test-reference.txt");
    fs::write(&source_path, b"not an image").unwrap();

    let result = import_image_asset(
        app.handle().clone(),
        test_import_asset(
            "test-image-asset-import-extension",
            source_path.to_string_lossy().to_string(),
        ),
    );

    assert!(result.is_err());
    let _ = fs::remove_file(source_path);
}
