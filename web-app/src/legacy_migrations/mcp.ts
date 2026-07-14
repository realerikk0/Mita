const LEGACY_BROWSER_MCP_NAMES = new Set([
  'Mita Web Research',
  'Silence Web Research',
  'Silence Browser MCP',
  'Jan Browser MCP',
])

export function isLegacyBrowserMCPName(name?: string): boolean {
  return !!name && LEGACY_BROWSER_MCP_NAMES.has(name)
}
