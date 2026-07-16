import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BIYAN_WEB_RESEARCH_MCP_NAME } from '@/constants/mcp'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useServiceHub } from '@/hooks/useServiceHub'

export function useBiyanWebResearch() {
  const serviceHub = useServiceHub()
  const { mcpServers, editServer, syncServers } = useMCPServers()
  const [isLoading, setIsLoading] = useState(false)

  const config = mcpServers[BIYAN_WEB_RESEARCH_MCP_NAME]
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
            .activateMCPServer(BIYAN_WEB_RESEARCH_MCP_NAME, nextConfig)
          toast.success('Web Search enabled')
        } else {
          await serviceHub
            .mcp()
            .deactivateMCPServer(BIYAN_WEB_RESEARCH_MCP_NAME)
          toast.success('Web Search disabled')
        }

        editServer(BIYAN_WEB_RESEARCH_MCP_NAME, nextConfig)
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
    [config, editServer, serviceHub, syncServers]
  )

  return useMemo(
    () => ({ hasConfig, isActive, isLoading, setActive }),
    [hasConfig, isActive, isLoading, setActive]
  )
}
