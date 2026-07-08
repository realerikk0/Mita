use super::commands::{delete_video_asset, list_video_assets, save_video_asset};
use super::models::SaveVideoAssetRequest;
use crate::core::app::commands::get_mita_data_folder_path;
use std::fs;
use tauri::test::mock_app;

fn test_asset(id: &str) -> SaveVideoAssetRequest {
    SaveVideoAssetRequest {
        id: id.to_string(),
        prompt: "A gold robot walks through a neon city".to_string(),
        provider: "jingxing".to_string(),
        model: "seedance-2.0".to_string(),
        ratio: "16:9".to_string(),
        resolution: "1080p".to_string(),
        duration: 8,
        fps: 30,
        source_asset_ids: vec!["storyboard-1".to_string()],
        usage: None,
        status: "succeeded".to_string(),
        mime_type: "video/mp4".to_string(),
        b64_json: Some("AAAA".to_string()),
        video_url: None,
        extension: Some("mp4".to_string()),
        created_at: Some("2026-06-04T00:00:00Z".to_string()),
        asset_kind: None,
    }
}

#[test]
fn saves_lists_and_deletes_video_asset_under_data_folder() {
    let app = mock_app();
    let id = "test-video-asset-roundtrip";
    let _ = delete_video_asset(app.handle().clone(), id.to_string());

    let record = save_video_asset(app.handle().clone(), test_asset(id)).unwrap();
    let data_folder = get_mita_data_folder_path(app.handle().clone());

    assert!(record
        .path
        .starts_with(data_folder.to_string_lossy().as_ref()));
    assert!(record.path.ends_with("video.mp4"));
    assert!(fs::metadata(&record.path).unwrap().is_file());
    assert_eq!(record.source_asset_ids, vec!["storyboard-1".to_string()]);
    assert_eq!(record.asset_kind.as_deref(), Some("generated"));

    let assets = list_video_assets(app.handle().clone()).unwrap();
    assert!(assets.iter().any(|asset| asset.id == id));

    delete_video_asset(app.handle().clone(), id.to_string()).unwrap();
    assert!(!fs::metadata(&record.path).is_ok());
}

#[test]
fn rejects_unsafe_video_asset_ids() {
    let app = mock_app();
    let result = save_video_asset(app.handle().clone(), test_asset("../outside"));
    assert!(result.is_err());
}

#[test]
fn rejects_invalid_video_base64() {
    let app = mock_app();
    let mut asset = test_asset("test-video-asset-invalid-base64");
    asset.b64_json = Some("not base64".to_string());

    let result = save_video_asset(app.handle().clone(), asset);
    assert!(result.is_err());
}

#[test]
fn infers_video_extension_from_mime_when_extension_is_missing() {
    let app = mock_app();
    let id = "test-video-asset-webm-extension";
    let _ = delete_video_asset(app.handle().clone(), id.to_string());

    let mut asset = test_asset(id);
    asset.mime_type = "video/webm".to_string();
    asset.extension = None;

    let record = save_video_asset(app.handle().clone(), asset).unwrap();

    assert_eq!(record.file_name, "video.webm");
    assert!(record.path.ends_with("video.webm"));

    delete_video_asset(app.handle().clone(), id.to_string()).unwrap();
}
