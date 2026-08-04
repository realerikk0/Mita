use super::commands::{detect_media_format, validate_endpoint, validate_media};
use std::path::Path;

const MIB: u64 = 1024 * 1024;

#[test]
fn validates_supported_media_limits() {
    assert!(validate_media("image", "image/png", 30 * MIB - 1).is_ok());
    assert!(validate_media("audio", "audio/mpeg", 15 * MIB).is_ok());
    assert!(validate_media("video", "video/mp4", 200 * MIB).is_ok());

    let image_error = validate_media("image", "image/png", 30 * MIB).unwrap_err();
    assert_eq!(image_error.code, "file_too_large");
    assert_eq!(image_error.status, Some(413));
    assert!(validate_media("audio", "audio/mpeg", 15 * MIB + 1).is_err());
    assert!(validate_media("video", "video/mp4", 200 * MIB + 1).is_err());
}

#[test]
fn rejects_mismatched_or_unsupported_media_types() {
    let mismatch = validate_media("video", "image/png", 1).unwrap_err();
    assert_eq!(mismatch.code, "unsupported_media_type");

    let unsupported = validate_media("audio", "audio/flac", 1).unwrap_err();
    assert_eq!(unsupported.code, "unsupported_media_type");
}

#[test]
fn only_accepts_credential_free_http_endpoints() {
    assert!(validate_endpoint("https://api.biyuan.ai/v1/media").is_ok());
    assert!(validate_endpoint("https://api.jingxing.uk/v1/media").is_ok());
    assert!(validate_endpoint("http://api.biyuan.ai/v1/media").is_err());
    assert!(validate_endpoint("https://localhost/v1/media").is_err());
    assert!(validate_endpoint("https://api.biyuan.ai.evil/v1/media").is_err());
    assert!(validate_endpoint("https://api.biyuan.ai/v1/media?target=other").is_err());
    assert!(validate_endpoint("file:///tmp/media").is_err());
    assert!(validate_endpoint("https://user:secret@example.test/media").is_err());
}

#[test]
fn verifies_extension_and_magic_before_uploading() {
    let png = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    assert_eq!(
        detect_media_format("image", Path::new("reference.png"), &png).unwrap(),
        ("image/png".to_string(), "png")
    );
    assert!(detect_media_format("image", Path::new("reference.png"), b"not png").is_err());
    assert!(detect_media_format("image", Path::new("reference.webp"), &png).is_err());

    let mp4 = [0, 0, 0, 16, b'f', b't', b'y', b'p'];
    assert_eq!(
        detect_media_format("video", Path::new("reference.mp4"), &mp4).unwrap(),
        ("video/mp4".to_string(), "mp4")
    );
    assert!(detect_media_format("audio", Path::new("reference.mp3"), &mp4).is_err());
}
