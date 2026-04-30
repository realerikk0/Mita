import { useState, useCallback, useRef } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useMCPServers } from '@/hooks/useMCPServers'
import { toast } from 'sonner'
import type { SilenceBrowserExtensionDialogState } from '@/containers/dialogs/SilenceBrowserExtensionDialog'
import {
  LEGACY_JAN_BROWSER_MCP_NAME,
  SILENCE_BROWSER_MCP_NAME,
} from '@/constants/mcp'

// Timeout and polling configuration
const PING_TIMEOUT_MS = 6000 // Backend ping takes up to 3s
const POLL_INTERVAL_MS = 500
const SERVER_START_DELAY_MS = 1000

export function useSilenceBrowserExtension() {
  const serviceHub = useServiceHub()
  const { mcpServers, editServer, syncServers } = useMCPServers()

  const [dialogState, setDialogState] =
    useState<SilenceBrowserExtensionDialogState>('closed')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const cancelledRef = useRef(false)
  const cancelDeactivationPromiseRef = useRef<Promise<void> | null>(null)
  const operationInProgressRef = useRef(false)

  const silenceBrowserConfig =
    mcpServers[SILENCE_BROWSER_MCP_NAME] ??
    mcpServers[LEGACY_JAN_BROWSER_MCP_NAME]
  const serverName = mcpServers[SILENCE_BROWSER_MCP_NAME]
    ? SILENCE_BROWSER_MCP_NAME
    : LEGACY_JAN_BROWSER_MCP_NAME
  const hasConfig = !!silenceBrowserConfig
  const isActive = silenceBrowserConfig?.active ?? false

  /**
   * Check if the browser extension is connected (single check)
   */
  const checkExtensionConnection = useCallback(async (): Promise<boolean> => {
    try {
      return await serviceHub.mcp().checkSilenceBrowserExtensionConnected()
    } catch (error) {
      console.error('Error checking extension connection:', error)
      return false
    }
  }, [serviceHub])

  /**
   * Poll for extension connection with timeout
   */
  const waitForExtensionConnection = useCallback(
    async (
      maxWaitMs: number = PING_TIMEOUT_MS,
      pollIntervalMs: number = POLL_INTERVAL_MS
    ): Promise<boolean> => {
      const startTime = Date.now()
      while (Date.now() - startTime < maxWaitMs) {
        if (cancelledRef.current) {
          return false
        }
        const connected = await checkExtensionConnection()
        if (connected) {
          return true
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }
      return false
    },
    [checkExtensionConnection]
  )

  /**
   * Handle successful connection - close dialog and show toast
   */
  const handleConnectionSuccess = useCallback(() => {
    setDialogOpen(false)
    setDialogState('closed')
    toast.success('Silence Browser MCP enabled')
  }, [])

  /**
   * Handle cancel async
   */
  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    setDialogOpen(false)
    setDialogState('closed')
    setIsLoading(false)

    if (silenceBrowserConfig) {
      setIsCancelling(true)

      editServer(serverName, {
        ...silenceBrowserConfig,
        active: false,
      })

      const deactivationPromise = Promise.all([
        serviceHub.mcp().deactivateMCPServer(serverName),
        syncServers(),
      ])
        .then(() => {})
        .catch((error) => {
          console.error('Error deactivating Silence Browser MCP on cancel:', error)
        })
        .finally(() => {
          cancelDeactivationPromiseRef.current = null
          setIsCancelling(false)
        })

      cancelDeactivationPromiseRef.current = deactivationPromise
    }
  }, [silenceBrowserConfig, serverName, serviceHub, editServer, syncServers])

  /**
   * Toggle the Silence Browser MCP (called when clicking the browser icon)
   */
  const toggleBrowser = useCallback(async () => {
    // Atomic check - refs update synchronously, prevents race conditions
    if (operationInProgressRef.current) return
    operationInProgressRef.current = true

    try {
      if (!silenceBrowserConfig) {
        toast.error('Silence Browser MCP not found', {
          description: 'Please check your MCP server configuration',
        })
        return
      }

      if (cancelDeactivationPromiseRef.current) {
        await cancelDeactivationPromiseRef.current
      }

      const newActiveState = !isActive
      cancelledRef.current = false

      setIsLoading(true)
      if (newActiveState) {
        // Activate the server
        await serviceHub.mcp().activateMCPServer(serverName, {
          ...silenceBrowserConfig,
          active: true,
        })

        // Check if cancelled during activation
        if (cancelledRef.current) return

        editServer(serverName, {
          ...silenceBrowserConfig,
          active: true,
        })
        await syncServers()

        // Show dialog and check for extension connection
        setDialogOpen(true)
        setDialogState('checking')

        // Wait for server to fully start
        await new Promise((resolve) =>
          setTimeout(resolve, SERVER_START_DELAY_MS)
        )

        const connected = await waitForExtensionConnection(
          PING_TIMEOUT_MS,
          POLL_INTERVAL_MS
        )

        // Check if cancelled during connection check
        if (cancelledRef.current) return

        if (connected) {
          handleConnectionSuccess()
        } else {
          // Extension not connected - show install/connect prompt
          setDialogState('not_installed')
        }
      } else {
        // Deactivate the server
        await serviceHub.mcp().deactivateMCPServer(serverName)
        toast.success('Silence Browser MCP disabled')

        editServer(serverName, {
          ...silenceBrowserConfig,
          active: false,
        })
        await syncServers()
      }
    } catch (error) {
      // Don't show error if cancelled
      if (cancelledRef.current) return
      console.error('Error toggling Silence Browser MCP:', error)
      setDialogOpen(false)
      setDialogState('closed')
    } finally {
      if (!cancelledRef.current) {
        setIsLoading(false)
      }
      // Always release the mutex
      operationInProgressRef.current = false
    }
  }, [
    silenceBrowserConfig,
    serverName,
    isActive,
    serviceHub,
    editServer,
    syncServers,
    waitForExtensionConnection,
    handleConnectionSuccess,
  ])

  return {
    // State
    hasConfig,
    isActive,
    isLoading: isLoading || isCancelling,
    dialogOpen,
    dialogState,

    // Actions
    toggleBrowser,
    handleCancel,
    setDialogOpen,
  }
}
