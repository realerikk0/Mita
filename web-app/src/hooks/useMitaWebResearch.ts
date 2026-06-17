import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  LEGACY_MITA_WEB_RESEARCH_MCP_NAME,
  MITA_WEB_RESEARCH_MCP_NAME,
} from '@/constants/mcp'

export function useMitaWebResearch() {
  const serviceHub = useServiceHub()
  const { mcpServers, editServer, syncServers } = useMCPServers()
  const [isLoading, setIsLoading] = useState(false)

  const serverName = mcpServers[MITA_WEB_RESEARCH_MCP_NAME]
    ? MITA_WEB_RESEARCH_MCP_NAME
    : LEGACY_MITA_WEB_RESEARCH_MCP_NAME
  const config = mcpServers[serverName]
  const hasConfig = Boolean(config)
  const isActive = config?.active === true

  const setActive = useCallback(
    async (active: boolean) => {
      if (!config) {
        toast.error('Biyan Web Research not found', {
          description: 'Please check your MCP server configuration',
        })
        return false
      }

      setIsLoading(true)
      try {
        const nextConfig = { ...config, active }
        if (active) {
          await serviceHub
            .mcp()
            .activateMCPServer(serverName, nextConfig)
          toast.success('Web Search enabled')
        } else {
          await serviceHub
            .mcp()
            .deactivateMCPServer(serverName)
          toast.success('Web Search disabled')
        }

        editServer(serverName, nextConfig)
        await syncServers()
        return true
      } catch (error) {
        console.error('Failed to toggle Biyan Web Research:', error)
        toast.error('Failed to toggle Web Search')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [config, editServer, serverName, serviceHub, syncServers]
  )

  return useMemo(
    () => ({
      hasConfig,
      isActive,
      isLoading,
      setActive,
    }),
    [hasConfig, isActive, isLoading, setActive]
  )
}
