use serde_json::{json, Value};

pub const BIYAN_WEB_RESEARCH_MCP_NAME: &str = "Biyan Web Research";

pub fn is_browser_mcp_name(name: &str) -> bool {
    name == BIYAN_WEB_RESEARCH_MCP_NAME
}

pub fn default_web_research_mcp_config() -> Value {
    json!({
        "command": "biyan-web-research",
        "args": [],
        "env": {
            "BIYAN_WEB_RESEARCH_HEADLESS": "true"
        },
        "active": false,
        "official": true,
        "capabilities": ["web", "search", "browser"],
        "description": "Biyan built-in web research tools using a private browser profile."
    })
}

// Default MCP runtime settings
pub const DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_MCP_BASE_RESTART_DELAY_MS: u64 = 1000; // Start with 1 second
pub const DEFAULT_MCP_MAX_RESTART_DELAY_MS: u64 = 30000; // Cap at 30 seconds
pub const DEFAULT_MCP_BACKOFF_MULTIPLIER: f64 = 2.0; // Double the delay each time
pub const DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS: u32 = 3;

pub const DEFAULT_MCP_CONFIG: &str = r#"{
  "mcpServers": {
    "Biyan Web Research": {
      "command": "biyan-web-research",
      "args": [],
      "env": {
        "BIYAN_WEB_RESEARCH_HEADLESS": "true"
      },
      "active": false,
      "official": true,
      "capabilities": ["web", "search", "browser"],
      "description": "Biyan built-in web research tools using a private browser profile."
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
