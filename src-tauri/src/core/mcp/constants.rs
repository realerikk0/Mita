use serde_json::{json, Map, Value};

pub const SILENCE_BROWSER_MCP_NAME: &str = "Silence Browser MCP";
pub const LEGACY_JAN_BROWSER_MCP_NAME: &str = "Jan Browser MCP";

pub fn is_browser_mcp_name(name: &str) -> bool {
    matches!(name, SILENCE_BROWSER_MCP_NAME | LEGACY_JAN_BROWSER_MCP_NAME)
}

pub fn default_browser_mcp_config() -> Value {
    json!({
        "command": "npx",
        "args": ["-y", "search-mcp-server@latest"],
        "env": {
            "BRIDGE_HOST": "127.0.0.1",
            "BRIDGE_PORT": "17389"
        },
        "active": false,
        "official": true
    })
}

pub fn normalize_browser_mcp_server_key(mcp_servers: &mut Map<String, Value>) -> bool {
    let has_silence = mcp_servers.contains_key(SILENCE_BROWSER_MCP_NAME);
    let legacy_config = mcp_servers.remove(LEGACY_JAN_BROWSER_MCP_NAME);

    if has_silence {
        return legacy_config.is_some();
    }

    let browser_config = legacy_config.unwrap_or_else(default_browser_mcp_config);
    mcp_servers.insert(SILENCE_BROWSER_MCP_NAME.to_string(), browser_config);
    true
}

// Default MCP runtime settings
pub const DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_MCP_BASE_RESTART_DELAY_MS: u64 = 1000; // Start with 1 second
pub const DEFAULT_MCP_MAX_RESTART_DELAY_MS: u64 = 30000; // Cap at 30 seconds
pub const DEFAULT_MCP_BACKOFF_MULTIPLIER: f64 = 2.0; // Double the delay each time

pub const DEFAULT_MCP_CONFIG: &str = r#"{
  "mcpServers": {
    "Silence Browser MCP": {
      "command": "npx",
      "args": ["-y", "search-mcp-server@latest"],
      "env": {
        "BRIDGE_HOST": "127.0.0.1",
        "BRIDGE_PORT": "17389"
      },
      "active": false,
      "official": true
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
    "enableSmartToolRouting": true,
    "useLightweightRouterModel": false,
    "routerModelProvider": "",
    "routerModelId": ""
  }
}"#;
