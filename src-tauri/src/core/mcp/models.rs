use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Configuration parameters extracted from MCP server config
#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub transport_type: Option<String>,
    pub url: Option<String>,
    pub command: String,
    pub args: Vec<Value>,
    pub envs: serde_json::Map<String, Value>,
    pub timeout: Option<Duration>,
    pub headers: serde_json::Map<String, Value>,
}

fn default_tool_call_timeout_seconds() -> u64 {
    super::constants::DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS
}

fn default_base_restart_delay_ms() -> u64 {
    super::constants::DEFAULT_MCP_BASE_RESTART_DELAY_MS
}

fn default_max_restart_delay_ms() -> u64 {
    super::constants::DEFAULT_MCP_MAX_RESTART_DELAY_MS
}

fn default_backoff_multiplier() -> f64 {
    super::constants::DEFAULT_MCP_BACKOFF_MULTIPLIER
}

fn default_max_reconnect_attempts() -> u32 {
    super::constants::DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS
}

fn default_enable_smart_tool_routing() -> bool {
    true
}

fn default_use_lightweight_router_model() -> bool {
    false
}

fn default_router_model_provider() -> String {
    String::new()
}

fn default_router_model_id() -> String {
    String::new()
}

fn default_computer_agent_enabled() -> bool {
    false
}

fn default_computer_agent_allowed_roots() -> Vec<String> {
    Vec::new()
}

fn default_computer_agent_shell_enabled() -> bool {
    false
}

fn default_computer_agent_approval_policy() -> String {
    "alwaysAsk".to_string()
}

fn default_computer_agent_sandbox_access() -> String {
    "readWrite".to_string()
}

/// Runtime MCP settings that can be adjusted via UI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    #[serde(default = "default_tool_call_timeout_seconds")]
    pub tool_call_timeout_seconds: u64,
    #[serde(default = "default_base_restart_delay_ms")]
    pub base_restart_delay_ms: u64,
    #[serde(default = "default_max_restart_delay_ms")]
    pub max_restart_delay_ms: u64,
    #[serde(default = "default_backoff_multiplier")]
    pub backoff_multiplier: f64,
    #[serde(default = "default_max_reconnect_attempts")]
    pub max_reconnect_attempts: u32,
    #[serde(default = "default_enable_smart_tool_routing")]
    pub enable_smart_tool_routing: bool,
    #[serde(default = "default_use_lightweight_router_model")]
    pub use_lightweight_router_model: bool,
    #[serde(default = "default_router_model_provider")]
    pub router_model_provider: String,
    #[serde(default = "default_router_model_id")]
    pub router_model_id: String,
    #[serde(
        default = "default_computer_agent_enabled",
        alias = "computerUseEnabled"
    )]
    pub computer_agent_enabled: bool,
    #[serde(
        default = "default_computer_agent_allowed_roots",
        alias = "computerAllowedRoots"
    )]
    pub computer_agent_allowed_roots: Vec<String>,
    #[serde(
        default = "default_computer_agent_shell_enabled",
        alias = "computerShellEnabled"
    )]
    pub computer_agent_shell_enabled: bool,
    #[serde(default = "default_computer_agent_approval_policy")]
    pub computer_agent_approval_policy: String,
    #[serde(default = "default_computer_agent_sandbox_access")]
    pub computer_agent_sandbox_access: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            tool_call_timeout_seconds: super::constants::DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS,
            base_restart_delay_ms: super::constants::DEFAULT_MCP_BASE_RESTART_DELAY_MS,
            max_restart_delay_ms: super::constants::DEFAULT_MCP_MAX_RESTART_DELAY_MS,
            backoff_multiplier: super::constants::DEFAULT_MCP_BACKOFF_MULTIPLIER,
            max_reconnect_attempts: super::constants::DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS,
            enable_smart_tool_routing: true,
            use_lightweight_router_model: false,
            router_model_provider: String::new(),
            router_model_id: String::new(),
            computer_agent_enabled: false,
            computer_agent_allowed_roots: Vec::new(),
            computer_agent_shell_enabled: false,
            computer_agent_approval_policy: default_computer_agent_approval_policy(),
            computer_agent_sandbox_access: default_computer_agent_sandbox_access(),
        }
    }
}

impl McpSettings {
    /// Returns the tool call timeout duration, enforcing a minimum of 1 second to avoid zero-duration timeouts.
    pub fn tool_call_timeout_duration(&self) -> std::time::Duration {
        std::time::Duration::from_secs(self.tool_call_timeout_seconds.max(1))
    }

    pub fn computer_agent_allows_writes(&self) -> bool {
        self.computer_agent_sandbox_access == "readWrite"
    }

    pub fn mcp_reconnect_attempts_exceeded(&self, consecutive_failures: u32) -> bool {
        consecutive_failures >= self.max_reconnect_attempts
    }
}

/// Tool with server information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolWithServer {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
    pub server: String,
}

/// Lightweight server metadata used by the frontend orchestrator for tool routing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSummary {
    pub name: String,
    pub capabilities: Vec<String>,
    pub description: String,
}
