import { useEffect, useState, memo } from 'react'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSub,
  DropDrawerLabel,
  DropDrawerSubContent,
  DropDrawerSeparator,
  DropDrawerSubTrigger,
  DropDrawerTrigger,
  DropDrawerGroup,
} from '@/components/ui/dropdrawer'

import { Switch } from '@/components/ui/switch'

import { useThreads } from '@/hooks/useThreads'
import { useToolAvailable } from '@/hooks/useToolAvailable'

import React from 'react'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import { isBrowserMCPServerName } from '@/constants/mcp'

interface DropdownToolsAvailableProps {
  children: (isOpen: boolean, toolsCount: number) => React.ReactNode
  initialMessage?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export default memo(function DropdownToolsAvailable({
  children,
  initialMessage = false,
  onOpenChange,
}: DropdownToolsAvailableProps) {
  const allTools = useAppState((state) => state.tools)
  // Filter out internal Mita Web Research tools from the manual tool picker.
  const tools = allTools.filter((tool) => !isBrowserMCPServerName(tool.server))
  const [isOpen, setIsOpen] = useState(false)
  const { t } = useTranslation()

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    onOpenChange?.(open)
  }
  const { getCurrentThread } = useThreads()
  const {
    isToolDisabled,
    setToolDisabledForThread,
    setDefaultDisabledTools,
    initializeThreadTools,
    getDisabledToolsForThread,
    getDefaultDisabledTools,
  } = useToolAvailable()

  const currentThread = getCurrentThread()
  const getToolKey = (serverName: string, toolName: string) =>
    `${serverName}::${toolName}`

  // Separate effect for thread initialization - only when we have tools and a new thread
  useEffect(() => {
    if (tools.length > 0 && currentThread?.id) {
      initializeThreadTools(currentThread.id, tools)
    }
  }, [currentThread?.id, tools, initializeThreadTools])

  const handleToolToggle = (serverName: string, toolName: string, checked: boolean) => {
    if (initialMessage) {
      // Update default tools for new threads/index page
      const currentDefaults = getDefaultDisabledTools()
      const toolKey = getToolKey(serverName, toolName)
      if (checked) {
        setDefaultDisabledTools(
          currentDefaults.filter((key) => key !== toolKey)
        )
      } else {
        setDefaultDisabledTools([...new Set([...currentDefaults, toolKey])])
      }
    } else if (currentThread?.id) {
      // Update tools for specific thread
      setToolDisabledForThread(currentThread.id, serverName, toolName, checked)
    }
  }

  const isToolChecked = (serverName: string, toolName: string): boolean => {
    if (initialMessage) {
      // Use default tools for index page
      const toolKey = getToolKey(serverName, toolName)
      return !getDefaultDisabledTools().includes(toolKey)
    } else if (currentThread?.id) {
      // Use thread-specific tools
      return !isToolDisabled(currentThread.id, serverName, toolName)
    }
    return false
  }

  const handleAllServerToolsToggle = (
    serverName: string,
    available: boolean
  ) => {
    const allToolsByServer = getToolsByServer()
    const serverTools = allToolsByServer[serverName] || []
    const serverToolKeys = serverTools.map((tool) =>
      getToolKey(tool.server, tool.name)
    )
    const serverToolKeySet = new Set(serverToolKeys)

    if (initialMessage) {
      const currentDefaults = getDefaultDisabledTools()
      setDefaultDisabledTools(
        available
          ? currentDefaults.filter((key) => !serverToolKeySet.has(key))
          : [...new Set([...currentDefaults, ...serverToolKeys])]
      )
      return
    }

    if (!currentThread?.id) return

    const disabledTools = new Set(getDisabledToolsForThread(currentThread.id))
    serverTools.forEach((tool) => {
      const toolKey = getToolKey(tool.server, tool.name)
      const isDisabled = disabledTools.has(toolKey)
      if (available && isDisabled) {
        setToolDisabledForThread(currentThread.id, tool.server, tool.name, true)
      } else if (!available && !isDisabled) {
        setToolDisabledForThread(currentThread.id, tool.server, tool.name, false)
      }
    })
  }

  const handleAllServerToolsRowClick = (serverName: string) => {
    handleAllServerToolsToggle(
      serverName,
      !areAllServerToolsEnabled(serverName)
    )
  }

  const areAllServerToolsEnabled = (serverName: string): boolean => {
    const allToolsByServer = getToolsByServer()
    const serverTools = allToolsByServer[serverName] || []
    return serverTools.every((tool) => isToolChecked(tool.server, tool.name))
  }

  const getEnabledToolsCount = (): number => {
    const disabledToolKeys = initialMessage
      ? getDefaultDisabledTools()
      : currentThread?.id
        ? getDisabledToolsForThread(currentThread.id)
        : []
    return tools.filter((tool) => {
      const toolKey = getToolKey(tool.server, tool.name)
      return !disabledToolKeys.includes(toolKey)
    }).length
  }

  const getToolsByServer = () => {
    const toolsByServer = tools.reduce(
      (acc, tool) => {
        if (!acc[tool.server]) {
          acc[tool.server] = []
        }
        acc[tool.server].push(tool)
        return acc
      },
      {} as Record<string, typeof tools>
    )

    return toolsByServer
  }

  const renderTrigger = () => children(isOpen, getEnabledToolsCount())

  if (tools.length === 0) {
    return (
      <DropDrawer onOpenChange={handleOpenChange}>
        <DropDrawerTrigger asChild>{renderTrigger()}</DropDrawerTrigger>
        <DropDrawerContent align="start" className="max-w-64">
          <DropDrawerItem disabled>
            {t('common:noToolsAvailable')}
          </DropDrawerItem>
        </DropDrawerContent>
      </DropDrawer>
    )
  }

  const toolsByServer = getToolsByServer()

  return (
    <DropDrawer onOpenChange={handleOpenChange}>
      <DropDrawerTrigger asChild>{renderTrigger()}</DropDrawerTrigger>
      <DropDrawerContent
        side="top"
        align="start"
        className="overflow-hidden!"
        onClick={(e) => e.stopPropagation()}
      >
        <DropDrawerLabel className="flex items-center gap-2 sticky -top-1 z-10 px-4 pl-2 py-1">
          Available Tools
        </DropDrawerLabel>
        <DropDrawerSeparator />
        <div className="max-h-64 overflow-y-auto">
          <DropDrawerGroup>
            {Object.entries(toolsByServer).map(([serverName, serverTools]) => (
              <DropDrawerSub
                id={`server-${serverName}`}
                key={serverName}
              >
                <DropDrawerSubTrigger className="py-2 hover:backdrop-blur-2xl rounded-sm px-2 mx-auto w-full">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm">
                      {serverName}
                    </span>
                    <span className="text-xs text-muted-foreground inline-flex items-center mr-1 border px-1 rounded-sm">
                      {
                        serverTools.filter((tool) => isToolChecked(tool.server, tool.name))
                          .length
                      }
                    </span>
                  </div>
                </DropDrawerSubTrigger>
                <DropDrawerSubContent className="max-w-64 max-h-70 w-full overflow-hidden">
                  <DropDrawerGroup>
                    {serverTools.length > 1 && (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`Toggle all tools for ${serverName}`}
                        className="sticky top-0 z-10 border-b px-4 md:px-2 pr-2 py-1.5 flex cursor-pointer items-center justify-between select-none"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleAllServerToolsRowClick(serverName)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          handleAllServerToolsRowClick(serverName)
                        }}
                      >
                        <span className="text-xs font-medium">
                          All Tools
                        </span>
                        <div
                          className={cn(
                            'flex items-center gap-2',
                            serverTools.length > 5
                              ? 'mr-3 md:mr-1.5'
                              : 'mr-2 md:mr-0'
                          )}
                        >
                          <Switch
                            aria-label={`All tools for ${serverName}`}
                            checked={areAllServerToolsEnabled(serverName)}
                            onCheckedChange={(checked) =>
                              handleAllServerToolsToggle(serverName, checked)
                            }
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          />
                        </div>
                      </div>
                    )}
                    <div className="max-h-56 overflow-y-auto p-1">
                      {serverTools.map((tool) => {
                        const isChecked = isToolChecked(tool.server, tool.name)
                        return (
                          <DropDrawerItem
                            onClick={(e) => {
                              handleToolToggle(tool.server, tool.name, !isChecked)
                              e.preventDefault()
                            }}
                            onSelect={(e) => {
                              handleToolToggle(tool.server, tool.name, !isChecked)
                              e.preventDefault()
                            }}
                            key={`${tool.server}::${tool.name}`}
                            className="mt-1 first:mt-0 py-1.5"
                            icon={
                              <Switch
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  handleToolToggle(tool.server, tool.name, checked)
                                }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                }}
                              />
                            }
                          >
                            <div className="overflow-hidden flex flex-col items-start w-full">
                              <span
                                className="text-sm font-medium truncate block w-full"
                                title={tool.name}
                              >
                                {tool.name}
                              </span>

                              {tool.description && (
                                <p
                                  className="text-xs text-muted-foreground mt-1 line-clamp-1"
                                  title={tool.description}
                                >
                                  {tool.description}
                                </p>
                              )}
                            </div>
                          </DropDrawerItem>
                        )
                      })}
                    </div>
                  </DropDrawerGroup>
                </DropDrawerSubContent>
              </DropDrawerSub>
            ))}
          </DropDrawerGroup>
        </div>
      </DropDrawerContent>
    </DropDrawer>
  )
})
