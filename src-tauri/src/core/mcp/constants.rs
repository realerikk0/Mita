use serde_json::{json, Map, Value};

pub const MITA_WEB_RESEARCH_MCP_NAME: &str = "Mita Web Research";
pub const LEGACY_SILENCE_WEB_RESEARCH_MCP_NAME: &str = "Silence Web Research";
pub const LEGACY_SILENCE_BROWSER_MCP_NAME: &str = "Silence Browser MCP";
pub const LEGACY_JAN_BROWSER_MCP_NAME: &str = "Jan Browser MCP";

pub fn is_browser_mcp_name(name: &str) -> bool {
    matches!(
        name,
        MITA_WEB_RESEARCH_MCP_NAME
            | LEGACY_SILENCE_WEB_RESEARCH_MCP_NAME
            | LEGACY_SILENCE_BROWSER_MCP_NAME
            | LEGACY_JAN_BROWSER_MCP_NAME
    )
}

pub fn default_web_research_mcp_config() -> Value {
    json!({
        "command": "mita-web-research",
        "args": [],
        "env": {
            "MITA_WEB_RESEARCH_HEADLESS": "true"
        },
        "active": false,
        "official": true,
        "capabilities": ["web", "search", "browser"],
        "description": "Mita built-in web research tools using a private browser profile."
    })
}

pub fn normalize_browser_mcp_server_key(mcp_servers: &mut Map<String, Value>) -> bool {
    let has_web_research = mcp_servers.contains_key(MITA_WEB_RESEARCH_MCP_NAME);
    let legacy_silence_web_research_config =
        mcp_servers.remove(LEGACY_SILENCE_WEB_RESEARCH_MCP_NAME);
    let legacy_silence_browser_config = mcp_servers.remove(LEGACY_SILENCE_BROWSER_MCP_NAME);
    let legacy_jan_config = mcp_servers.remove(LEGACY_JAN_BROWSER_MCP_NAME);
    let legacy_config = legacy_silence_web_research_config
        .or(legacy_silence_browser_config)
        .or(legacy_jan_config);

    if has_web_research {
        return legacy_config.is_some();
    }

    let old_active = legacy_config
        .as_ref()
        .and_then(|config| config.get("active"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut browser_config = default_web_research_mcp_config();
    if let Some(config) = browser_config.as_object_mut() {
        config.insert("active".to_string(), json!(old_active));
    }
    mcp_servers.insert(MITA_WEB_RESEARCH_MCP_NAME.to_string(), browser_config);
    true
}

// Default MCP runtime settings
pub const DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_MCP_BASE_RESTART_DELAY_MS: u64 = 1000; // Start with 1 second
pub const DEFAULT_MCP_MAX_RESTART_DELAY_MS: u64 = 30000; // Cap at 30 seconds
pub const DEFAULT_MCP_BACKOFF_MULTIPLIER: f64 = 2.0; // Double the delay each time
pub const DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS: u32 = 3;

pub const DEFAULT_MCP_CONFIG: &str = r#"{
  "mcpServers": {
    "Mita Web Research": {
      "command": "mita-web-research",
      "args": [],
      "env": {
        "MITA_WEB_RESEARCH_HEADLESS": "true"
      },
      "active": false,
      "official": true,
      "capabilities": ["web", "search", "browser"],
      "description": "Mita built-in web research tools using a private browser profile."
    },
    "exa": {
      "type": "http",
      "url": "https://mcp.exa.ai/mcp",
      "command": "",
      "args": [],
      "env": {},
      "active": false
    },
    "browsermcp": {
      "command": "npx",
      "args": ["@browsermcp/mcp"],
      "env": {},
      "active": false
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "env": {},
      "active": false
    },
    "serper": {
      "command": "npx",
      "args": ["-y", "serper-search-scrape-mcp-server"],
      "env": { "SERPER_API_KEY": "YOUR_SERPER_API_KEY_HERE" },
      "active": false
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/other/allowed/dir"
      ],
      "env": {},
      "active": false
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "env": {},
      "active": false
    }
  },
  "mcpSettings": {
    "toolCallTimeoutSeconds": 30,
    "baseRestartDelayMs": 1000,
    "maxRestartDelayMs": 30000,
    "backoffMultiplier": 2.0,
    "maxReconnectAttempts": 3,
    "enableSmartToolRouting": true,
    "useLightweightRouterModel": false,
    "routerModelProvider": "",
    "routerModelId": ""
  }
}"#;
