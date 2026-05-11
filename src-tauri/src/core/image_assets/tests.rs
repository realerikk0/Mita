use super::commands::{delete_image_asset, list_image_assets, save_image_asset};
use super::models::SaveImageAssetRequest;
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
    }
}

#[test]
fn saves_lists_and_deletes_image_asset_under_data_folder() {
    let app = mock_app();
    let id = "test-image-asset-roundtrip";
    let _ = delete_image_asset(app.handle().clone(), id.to_string());

    let record = save_image_asset(app.handle().clone(), test_asset(id)).unwrap();
    let data_folder = get_mita_data_folder_path(app.handle().clone());

    assert!(record.path.starts_with(data_folder.to_string_lossy().as_ref()));
    assert!(record.path.ends_with("image.png"));
    assert!(fs::metadata(&record.path).unwrap().is_file());

    let assets = list_image_assets(app.handle().clone()).unwrap();
    assert!(assets.iter().any(|asset| asset.id == id));

    delete_image_asset(app.handle().clone(), id.to_string()).unwrap();
    assert!(!fs::metadata(&record.path).is_ok());
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
