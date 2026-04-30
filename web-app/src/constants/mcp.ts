export const SILENCE_BROWSER_MCP_NAME = 'Silence Browser MCP'
export const LEGACY_JAN_BROWSER_MCP_NAME = 'Jan Browser MCP'

export const BROWSER_MCP_SERVER_NAMES = [
  SILENCE_BROWSER_MCP_NAME,
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
