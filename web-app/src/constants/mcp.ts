export const MITA_WEB_RESEARCH_MCP_NAME = 'Biyan Web Research'
export const LEGACY_MITA_WEB_RESEARCH_MCP_NAME = 'Mita Web Research'
export const LEGACY_SILENCE_WEB_RESEARCH_MCP_NAME = 'Silence Web Research'
export const LEGACY_SILENCE_BROWSER_MCP_NAME = 'Silence Browser MCP'
export const LEGACY_JAN_BROWSER_MCP_NAME = 'Jan Browser MCP'

export const BROWSER_MCP_SERVER_NAMES = [
  MITA_WEB_RESEARCH_MCP_NAME,
  LEGACY_MITA_WEB_RESEARCH_MCP_NAME,
  LEGACY_SILENCE_WEB_RESEARCH_MCP_NAME,
  LEGACY_SILENCE_BROWSER_MCP_NAME,
  LEGACY_JAN_BROWSER_MCP_NAME,
] as const

export function isBrowserMCPServerName(serverName?: string) {
  return (
    !!serverName &&
    BROWSER_MCP_SERVER_NAMES.includes(
      serverName as (typeof BROWSER_MCP_SERVER_NAMES)[number]
    )
  )
}
