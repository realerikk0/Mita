//! `SystemLanguageModel`, `TokenUsage`, and `ModelAvailability` types.

use std::ffi::{CStr, CString};
use std::ptr::{self, NonNull};
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::ffi::{self, AvailabilityCode, SwiftPtr};
use crate::tool::{Tool, tools_to_json};

const TOKEN_USAGE_UNAVAILABLE_SENTINEL: i64 = -2;
const TOKEN_ESTIMATE_CHARS_PER_TOKEN: usize = 4;

/// Represents the availability status of a `FoundationModel`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelAvailability {
    /// Model is available and ready to use.
    Available,
    /// Device is not eligible for Apple Intelligence.
    DeviceNotEligible,
    /// Apple Intelligence is not enabled in system settings.
    AppleIntelligenceNotEnabled,
    /// Model is not ready (downloading or other system reasons).
    ModelNotReady,
    /// Unavailability for an unknown reason.
    Unknown,
}

impl ModelAvailability {
    /// Returns an error describing why the model is unavailable.
    pub fn into_error(self) -> Option<Error> {
        match self {
            ModelAvailability::Available => None,
            ModelAvailability::DeviceNotEligible => Some(Error::DeviceNotEligible),
            ModelAvailability::AppleIntelligenceNotEnabled => {
                Some(Error::AppleIntelligenceNotEnabled)
            }
            ModelAvailability::ModelNotReady => Some(Error::ModelNotReady),
            ModelAvailability::Unknown => Some(Error::ModelNotAvailable),
        }
    }
}

impl From<AvailabilityCode> for ModelAvailability {
    fn from(code: AvailabilityCode) -> Self {
        match code {
            AvailabilityCode::Available => ModelAvailability::Available,
            AvailabilityCode::DeviceNotEligible => ModelAvailability::DeviceNotEligible,
            AvailabilityCode::AppleIntelligenceNotEnabled => {
                ModelAvailability::AppleIntelligenceNotEnabled
            }
            AvailabilityCode::ModelNotReady => ModelAvailability::ModelNotReady,
            AvailabilityCode::Unknown => ModelAvailability::Unknown,
        }
    }
}

/// The system language model provided by Apple Intelligence.
///
/// This is the main entry point for using on-device AI capabilities.
/// Use [`SystemLanguageModel::new()`] to get the default model.
///
/// # Example
///
/// ```rust,no_run
/// use fm_rs::SystemLanguageModel;
///
/// let model = SystemLanguageModel::new()?;
/// if model.is_available() {
///     println!("Model is ready to use!");
/// }
/// # Ok::<(), fm_rs::Error>(())
/// ```
pub struct SystemLanguageModel {
    ptr: NonNull<std::ffi::c_void>,
}

/// Token usage returned by `SystemLanguageModel` 26.4+ APIs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenUsage {
    /// Number of tokens reported by the framework.
    pub token_count: usize,
}

impl SystemLanguageModel {
    /// Creates the default system language model.
    ///
    /// # Errors
    ///
    /// Returns an error if the model cannot be created or if `FoundationModels`
    /// is not available on the device.
    pub fn new() -> Result<Self> {
        let mut error: SwiftPtr = ptr::null_mut();

        let ptr = unsafe { ffi::fm_model_default(&raw mut error) };

        if !error.is_null() {
            return Err(error_from_swift(error));
        }

        NonNull::new(ptr).map(|ptr| Self { ptr }).ok_or_else(|| {
            Error::InternalError(
                "SystemLanguageModel creation returned null without error. \
                 This may indicate FoundationModels.framework is unavailable."
                    .to_string(),
            )
        })
    }

    /// Returns a raw pointer to the underlying Swift object.
    ///
    /// This is used internally for FFI calls.
    pub(crate) fn as_ptr(&self) -> SwiftPtr {
        self.ptr.as_ptr()
    }

    /// Checks if the model is available for use.
    ///
    /// Returns `true` if the model is available and ready to generate responses.
    pub fn is_available(&self) -> bool {
        unsafe { ffi::fm_model_is_available(self.ptr.as_ptr()) }
    }

    /// Gets the current availability status of the model.
    ///
    /// This provides more detailed information about why the model might not be available.
    pub fn availability(&self) -> ModelAvailability {
        let code = unsafe { ffi::fm_model_availability(self.ptr.as_ptr()) };
        AvailabilityCode::from(code).into()
    }

    /// Returns a reason-specific error if the model is unavailable.
    pub fn ensure_available(&self) -> Result<()> {
        match self.availability().into_error() {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }

    /// Returns token usage for a prompt.
    ///
    /// Uses platform token-usage APIs when available in both the build SDK and runtime.
    /// Otherwise returns a heuristic estimate.
    pub fn token_usage_for(&self, prompt: &str) -> Result<TokenUsage> {
        let prompt_c = CString::new(prompt)?;
        let mut error: SwiftPtr = ptr::null_mut();

        let token_count = unsafe {
            ffi::fm_model_token_usage_for(self.ptr.as_ptr(), prompt_c.as_ptr(), &raw mut error)
        };

        if !error.is_null() {
            return Err(error_from_swift(error));
        }

        if token_count == TOKEN_USAGE_UNAVAILABLE_SENTINEL {
            return Ok(TokenUsage {
                token_count: estimate_tokens(prompt, TOKEN_ESTIMATE_CHARS_PER_TOKEN),
            });
        }

        token_usage_from_raw(token_count)
    }

    /// Returns token usage for session instructions and tool definitions.
    ///
    /// Tool definitions are serialized from the Rust [`Tool`] trait objects.
    /// Uses platform token-usage APIs when available in both the build SDK and runtime.
    /// Otherwise returns a heuristic estimate.
    pub fn token_usage_for_tools(
        &self,
        instructions: &str,
        tools: &[Arc<dyn Tool>],
    ) -> Result<TokenUsage> {
        let instructions_c = CString::new(instructions)?;
        let tools_json = if tools.is_empty() {
            None
        } else {
            let tool_refs: Vec<&dyn Tool> = tools.iter().map(std::convert::AsRef::as_ref).collect();
            Some(CString::new(tools_to_json(&tool_refs)?)?)
        };
        let tools_ptr = tools_json.as_ref().map_or(ptr::null(), |s| s.as_ptr());

        let mut error: SwiftPtr = ptr::null_mut();
        let token_count = unsafe {
            ffi::fm_model_token_usage_for_tools(
                self.ptr.as_ptr(),
                instructions_c.as_ptr(),
                tools_ptr,
                &raw mut error,
            )
        };

        if !error.is_null() {
            return Err(error_from_swift(error));
        }

        if token_count == TOKEN_USAGE_UNAVAILABLE_SENTINEL {
            let fallback = estimate_tokens(instructions, TOKEN_ESTIMATE_CHARS_PER_TOKEN)
                + tools_json.as_ref().map_or(0, |json| {
                    estimate_tokens(&json.to_string_lossy(), TOKEN_ESTIMATE_CHARS_PER_TOKEN)
                });
            return Ok(TokenUsage {
                token_count: fallback,
            });
        }

        token_usage_from_raw(token_count)
    }
}

impl std::fmt::Debug for SystemLanguageModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SystemLanguageModel")
            .field("availability", &self.availability())
            .finish()
    }
}

impl Drop for SystemLanguageModel {
    fn drop(&mut self) {
        unsafe {
            ffi::fm_model_free(self.ptr.as_ptr());
        }
    }
}

// SAFETY: SystemLanguageModel is a wrapper around a Swift object that is
// internally thread-safe (uses DispatchQueue for async operations).
unsafe impl Send for SystemLanguageModel {}
unsafe impl Sync for SystemLanguageModel {}

fn token_usage_from_raw(token_count: i64) -> Result<TokenUsage> {
    if token_count < 0 {
        return Err(Error::InternalError(
            "Token usage API returned a negative token count".to_string(),
        ));
    }

    let token_count = usize::try_from(token_count)
        .map_err(|_| Error::InternalError("Token usage value does not fit in usize".to_string()))?;

    Ok(TokenUsage { token_count })
}

fn estimate_tokens(text: &str, chars_per_token: usize) -> usize {
    let denom = chars_per_token.max(1);
    let chars = text.chars().count();
    chars.div_ceil(denom)
}

/// Converts a Swift error pointer to a Rust Error.
pub(crate) fn error_from_swift(error: SwiftPtr) -> Error {
    use crate::error::ToolCallError;

    if error.is_null() {
        return Error::InternalError(
            "FFI error object was null; unable to retrieve error details".to_string(),
        );
    }

    let code = unsafe { ffi::fm_error_code(error) };
    let msg_ptr = unsafe { ffi::fm_error_message(error) };

    let message = if msg_ptr.is_null() {
        "Error message unavailable (null pointer from Swift)".to_string()
    } else {
        unsafe { CStr::from_ptr(msg_ptr).to_string_lossy().into_owned() }
    };

    // Extract tool context if this is a tool error
    let tool_name = unsafe {
        let ptr = ffi::fm_error_tool_name(error);
        if ptr.is_null() {
            None
        } else {
            Some(CStr::from_ptr(ptr).to_string_lossy().into_owned())
        }
    };

    let tool_arguments = unsafe {
        let ptr = ffi::fm_error_tool_arguments(error);
        if ptr.is_null() {
            None
        } else {
            let json_str = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            serde_json::from_str(&json_str).ok()
        }
    };

    unsafe {
        ffi::fm_error_free(error);
    }

    match ffi::ErrorCode::from(code) {
        ffi::ErrorCode::ModelNotAvailable => Error::ModelNotAvailable,
        ffi::ErrorCode::GenerationFailed => Error::GenerationError(message),
        ffi::ErrorCode::Cancelled => Error::GenerationError("Operation cancelled".to_string()),
        ffi::ErrorCode::Timeout => Error::Timeout(message),
        ffi::ErrorCode::ToolError => {
            // Construct ToolCallError with context if available
            Error::ToolCall(ToolCallError {
                tool_name: tool_name.unwrap_or_else(|| "unknown".to_string()),
                arguments: tool_arguments.unwrap_or(serde_json::Value::Null),
                inner_error: message,
            })
        }
        ffi::ErrorCode::InvalidInput => Error::InvalidInput(message),
        ffi::ErrorCode::Unknown => Error::InternalError(message),
    }
}

#[cfg(test)]
mod tests {
    use super::{estimate_tokens, token_usage_from_raw};

    #[test]
    fn token_usage_should_convert_positive_values() {
        let usage = token_usage_from_raw(42).expect("positive token count should convert");
        assert_eq!(usage.token_count, 42);
    }

    #[test]
    fn token_usage_should_reject_negative_values() {
        let err = token_usage_from_raw(-1).expect_err("negative token count should fail");
        assert!(err.to_string().contains("negative token count"));
    }

    #[test]
    fn estimate_tokens_should_use_div_ceil() {
        assert_eq!(estimate_tokens("abcd", 4), 1);
        assert_eq!(estimate_tokens("abcde", 4), 2);
    }
}
