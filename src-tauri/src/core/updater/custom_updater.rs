//! Request-header bridge for the official Tauri updater.
//!
//! The frontend still calls `@tauri-apps/plugin-updater::check` so the returned
//! signed `Update` object can be retained through download and install. Rust
//! only creates the authenticated cohort headers; it never performs a second
//! manifest request.

use super::hmac_client::SignedRequestHeaders;
use std::collections::BTreeMap;

pub fn build_signed_request_headers(
    install_id: &str,
    current_version: &str,
) -> BTreeMap<String, String> {
    SignedRequestHeaders::new(
        crate::core::legacy_migrations::updater_request_signing_key(),
        install_id,
        current_version,
    )
    .to_header_pairs()
    .into_iter()
    .map(|(name, value)| (name.to_string(), value))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_headers_for_the_official_updater_request() {
        let headers = build_signed_request_headers("anonymous-install-id", "0.6.634");
        assert_eq!(headers["X-Client-Session"], "anonymous-install-id");
        assert_eq!(headers["X-Client-Version"], "0.6.634");
        assert_eq!(headers["X-Request-Token"].len(), 64);
        assert_eq!(headers["X-Request-Id"].len(), 64);
    }
}
