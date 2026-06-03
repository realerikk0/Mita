import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useWebSearch } from '@/hooks/useWebSearch'
import { useMitaWebResearch } from '@/hooks/useMitaWebResearch'
import { useEffect, useState } from 'react'
import ChangeDataFolderLocation from '@/containers/dialogs/ChangeDataFolderLocation'
import { FactoryResetDialog } from '@/containers/dialogs'
import type { FactoryResetOptions } from '@/services/app/types'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  IconBrandGithub,
  IconExternalLink,
  IconFolder,
  IconLogs,
  IconCopy,
  IconCopyCheck,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { SystemEvent } from '@/types/events'
import { Input } from '@/components/ui/input'
import { useHardware } from '@/hooks/useHardware'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { isRootDir } from '@/utils/path'
const TOKEN_VALIDATION_TIMEOUT_MS = 10_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const {
    spellCheckChatInput,
    setSpellCheckChatInput,
    huggingfaceToken,
    setHuggingfaceToken,
  } = useGeneralSetting()
  const { checkForUpdate } = useAppUpdater()
  const serviceHub = useServiceHub()
  const webSearchEnabled = useWebSearch((state) => state.enabled)
  const setWebSearchEnabled = useWebSearch((state) => state.setEnabled)
  const {
    hasConfig: hasWebResearchConfig,
    isActive: webResearchActive,
    isLoading: webResearchLoading,
    setActive: setWebResearchActive,
  } = useMitaWebResearch()

  const openFileTitle = (): string => {
    if (IS_MACOS) {
      return t('settings:general.showInFinder')
    } else if (IS_WINDOWS) {
      return t('settings:general.showInFileExplorer')
    } else {
      return t('settings:general.openContainingFolder')
    }
  }
  const { pausePolling } = useHardware()
  const [mitaDataFolder, setMitaDataFolder] = useState<
    string | undefined
  >()
  const [isCopied, setIsCopied] = useState(false)
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isValidatingToken, setIsValidatingToken] = useState(false)
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null)
  const [cliPath, setCliPath] = useState<string | null>(null)
  const [isCliLoading, setIsCliLoading] = useState(false)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  useEffect(() => {
    const fetchDataFolder = async () => {
      const path = await serviceHub.app().getMitaDataFolder()
      setMitaDataFolder(path)
    }

    fetchDataFolder()
  }, [serviceHub])

  useEffect(() => {
    if (!IS_TAURI) return
    invoke<{ installed: boolean; path: string | null }>('check_mita_cli_installed')
      .then((s) => { setCliInstalled(s.installed); setCliPath(s.path) })
      .catch(() => setCliInstalled(false))
  }, [])

  const handleInstallCli = async () => {
    setIsCliLoading(true)
    try {
      const s = await invoke<{ installed: boolean; path: string | null }>('install_mita_cli')
      setCliInstalled(s.installed)
      setCliPath(s.path)
      toast.success(`Mita CLI installed to ${s.path}`)
    } catch (e) {
      toast.error('Install failed', { description: String(e) })
    } finally {
      setIsCliLoading(false)
    }
  }

  const handleUninstallCli = async () => {
    setIsCliLoading(true)
    try {
      await invoke('uninstall_mita_cli')
      setCliInstalled(false)
      setCliPath(null)
      toast.success('Mita CLI uninstalled')
    } catch (e) {
      toast.error('Uninstall failed', { description: String(e) })
    } finally {
      setIsCliLoading(false)
    }
  }

  const resetApp = async (options: FactoryResetOptions) => {
    if (isRootDir(mitaDataFolder ?? '/')) {
      toast.error(t('settings:general.couldNotResetRootDirectory'))
      return
    }
    pausePolling()
    await serviceHub.app().factoryReset(options)
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLogsWindow()
    } catch (error) {
      console.error('Failed to open logs window:', error)
    }
  }

  const handleCheckForUpdates = async () => {
    if (isCheckingForUpdates) return

    setIsCheckingForUpdates(true)
    try {
      const update = await checkForUpdate(true)
      if (update) {
        toast.success(t('updater:updateAvailable'), {
          description: t('updater:newVersion', {
            version: update.version,
          }),
        })
      } else {
        toast.success(t('settings:general.noUpdateAvailable'))
      }
    } catch (error) {
      console.error('Failed to check for app updates:', error)
      toast.error(t('settings:general.updateError'))
    } finally {
      setIsCheckingForUpdates(false)
    }
  }

  const handleWebSearchChange = async (enabled: boolean) => {
    setWebSearchEnabled(enabled)

    if (!hasWebResearchConfig) return

    if (enabled && !webResearchActive) {
      await setWebResearchActive(true)
      return
    }

    if (!enabled && webResearchActive) {
      await setWebResearchActive(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000) // Reset after 2 seconds
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleDataFolderChange = async () => {
    const selectedPath = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
      defaultPath: mitaDataFolder,
    })

    if (selectedPath === mitaDataFolder) return
    if (selectedPath !== null) {
      setSelectedNewPath(selectedPath as string)
      setIsDialogOpen(true)
    }
  }

  const confirmDataFolderChange = async () => {
    if (selectedNewPath) {
      try {
        await serviceHub.models().stopAllModels()
        serviceHub.events().emit(SystemEvent.KILL_SIDECAR)
        setTimeout(async () => {
          try {
            // Prevent relocating to root directory (e.g., C:\ or D:\ on Windows, / on Unix)
            if (isRootDir(selectedNewPath))
              throw new Error(t('settings:general.couldNotRelocateToRoot'))
            await serviceHub.app().relocateMitaDataFolder(selectedNewPath)
            setMitaDataFolder(selectedNewPath)
            // Only relaunch if relocation was successful
            window.core?.api?.relaunch()
            setSelectedNewPath(null)
            setIsDialogOpen(false)
          } catch (error) {
            console.error(error)
            toast.error(
              error instanceof Error
                ? error.message
                : t('settings:general.failedToRelocateDataFolder')
            )
          }
        }, 1000)
      } catch (error) {
        console.error('Failed to relocate data folder:', error)
        // Revert the data folder path on error
        const originalPath = await serviceHub.app().getMitaDataFolder()
        setMitaDataFolder(originalPath)

        toast.error(t('settings:general.failedToRelocateDataFolderDesc'))
      }
    }
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">

            {/* General */}
            <Card title={t('common:general')}>
              <CardItem
                title={t('settings:general.appVersion')}
                actions={
                  <span className="text-foreground font-medium">
                    v{VERSION}
                  </span>
                }
              />
              <CardItem
                title={t('settings:general.checkForUpdates')}
                description={t('settings:general.checkForUpdatesDesc')}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingForUpdates}
                  >
                    {isCheckingForUpdates
                      ? t('settings:general.checkingForUpdates')
                      : t('settings:general.checkForUpdates')}
                  </Button>
                }
              />
              <CardItem
                title={t('common:language')}
                actions={<LanguageSwitcher />}
              />
            </Card>

            {/* Data folder - Desktop only */}
            <Card title={t('common:dataFolder')}>
              <CardItem
                title={t('settings:dataFolder.appData', {
                  ns: 'settings',
                })}
                align="start"
                className="items-start flex-row gap-2"
                description={
                  <>
                    <span>
                      {t('settings:dataFolder.appDataDesc', {
                        ns: 'settings',
                      })}
                      &nbsp;
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="max-w-100 bg-secondary rounded-sm px-1 py-0.5">
                        <span
                          title={mitaDataFolder}
                          className="text-xs line-clamp-1 break-all"
                        >
                          {mitaDataFolder}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          mitaDataFolder && copyToClipboard(mitaDataFolder)
                        }
                        className="cursor-pointer flex items-center justify-center rounded-sm bg-secondary transition-all duration-200 ease-in-out p-1"
                        title={
                          isCopied
                            ? t('settings:general.copied')
                            : t('settings:general.copyPath')
                        }
                      >
                        {isCopied ? (
                          <div className="flex items-center gap-1">
                            <IconCopyCheck size={14} className="text-green-500 dark:text-green-600" />
                            <span className="text-xs leading-0">
                              {t('settings:general.copied')}
                            </span>
                          </div>
                        ) : (
                          <IconCopy
                            size={14}
                            className="text-muted-foreground"
                          />
                        )}
                      </button>
                    </div>
                  </>
                }
                actions={
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      title={t('settings:dataFolder.appData')}
                      onClick={handleDataFolderChange}
                    >
                        <IconFolder
                          size={12}
                          className="text-muted-foreground"
                        />
                        <span>{t('settings:general.changeLocation')}</span>
                    </Button>
                    {selectedNewPath && (
                      <ChangeDataFolderLocation
                        currentPath={mitaDataFolder || ''}
                        newPath={selectedNewPath}
                        onConfirm={confirmDataFolderChange}
                        open={isDialogOpen}
                        onOpenChange={(open) => {
                          setIsDialogOpen(open)
                          if (!open) {
                            setSelectedNewPath(null)
                          }
                        }}
                      >
                        <div />
                      </ChangeDataFolderLocation>
                    )}
                  </>
                }
              />
              <CardItem
                title={t('settings:dataFolder.appLogs', {
                  ns: 'settings',
                })}
                description={t('settings:dataFolder.appLogsDesc')}
                className="items-start flex-row gap-y-2"
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="p-0"
                      onClick={async () => {
                        if (mitaDataFolder) {
                          try {
                            const logsPath = await serviceHub.path().join(
                              mitaDataFolder,
                              'logs'
                            )
                            await serviceHub.opener().revealItemInDir(logsPath)
                          } catch (error) {
                            console.error(
                              'Failed to reveal logs folder:',
                              error
                            )
                          }
                        }
                      }}
                      title={t('settings:general.revealLogs')}
                    >
                      <IconFolder
                        size={12}
                        className="text-muted-foreground"
                      />
                      <span>{openFileTitle()}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenLogs}
                      title={t('settings:dataFolder.appLogs')}
                    >
                      <IconLogs size={12} className="text-muted-foreground" />
                      <span>{t('settings:general.openLogs')}</span>
                    </Button>
                  </div>
                }
              />
            </Card>

            {/* Advanced - Desktop only */}
            <Card title="Advanced">
              {IS_TAURI && (
                <CardItem
                  title="Mita CLI"
                  description={
                    cliInstalled && cliPath
                      ? `Installed at ${cliPath} — use mita from your terminal to serve models.`
                      : 'Use mita from your terminal to serve models without opening the app.'
                  }
                  actions={
                    cliInstalled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUninstallCli}
                        disabled={isCliLoading || cliInstalled === null}
                      >
                        {isCliLoading ? 'Uninstalling…' : 'Uninstall'}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleInstallCli}
                        disabled={isCliLoading || cliInstalled === null}
                      >
                        {isCliLoading ? 'Installing…' : 'Install'}
                      </Button>
                    )
                  }
                />
              )}
              <CardItem
                title={t('settings:others.resetFactory', {
                  ns: 'settings',
                })}
                description={t('settings:others.resetFactoryDesc', {
                  ns: 'settings',
                })}
                actions={
                  <FactoryResetDialog onReset={resetApp}>
                    <Button variant="destructive" size="sm">
                      {t('common:reset')}
                    </Button>
                  </FactoryResetDialog>
                }
              />
            </Card>

            {/* Other */}
            <Card title={t('common:others')}>
              <CardItem
                title={t('settings:others.spellCheck', {
                  ns: 'settings',
                })}
                description={t('settings:others.spellCheckDesc', {
                  ns: 'settings',
                })}
                actions={
                  <Switch
                    checked={spellCheckChatInput}
                    onCheckedChange={(e) => setSpellCheckChatInput(e)}
                  />
                }
              />
              <CardItem
                title="Web Search"
                description={
                  hasWebResearchConfig
                    ? 'Enable native web search for supported models and keep Mita Web Research available for tool-based browsing.'
                    : 'Enable native web search for supported Jingxing models. Configure Mita Web Research in MCP Servers for tool-based browsing.'
                }
                actions={
                  <Switch
                    checked={webSearchEnabled}
                    disabled={webResearchLoading}
                    onCheckedChange={(enabled) => {
                      void handleWebSearchChange(enabled)
                    }}
                  />
                }
              />
              <CardItem
                title={t('settings:general.huggingfaceToken', {
                  ns: 'settings',
                })}
                description={t('settings:general.huggingfaceTokenDesc', {
                  ns: 'settings',
                })}
                actions={
                  <div className="flex items-center gap-2">
                    <Input
                      id="hf-token"
                      value={huggingfaceToken || ''}
                      onChange={(e) => setHuggingfaceToken(e.target.value)}
                      placeholder={'hf_xxx_xxx'}
                      required
                    />
                    <Button
                      variant="outline"
                      size='sm'
                      disabled={isValidatingToken}
                      onClick={async () => {
                        const token = (huggingfaceToken || '').trim()
                        if (!token) {
                          toast.error(
                            'Please enter a Hugging Face token to validate'
                          )
                          return
                        }
                        setIsValidatingToken(true)
                        const controller = new AbortController()
                        const timeoutId = setTimeout(
                          () => controller.abort(),
                          TOKEN_VALIDATION_TIMEOUT_MS
                        )
                        try {
                          const resp = await fetch(
                            'https://huggingface.co/api/whoami-v2',
                            {
                              headers: { Authorization: `Bearer ${token}` },
                              signal: controller.signal,
                            }
                          )
                          if (resp.ok) {
                            const data = await resp.json()
                            toast.success('Token is valid', {
                              description: data?.name
                                ? `Signed in as ${data.name}`
                                : 'Your Hugging Face token is valid.',
                            })
                          } else {
                            toast.error('Token invalid', {
                              description:
                                'The provided Hugging Face token is invalid. Please check your token and try again.',
                            })
                          }
                        } catch (e) {
                          const name = (e as { name?: string })?.name
                          if (name === 'AbortError') {
                            toast.error('Validation timed out', {
                              description:
                                'The validation request timed out. Please check your network connection and try again.',
                            })
                          } else {
                            toast.error('Validation failed', {
                              description:
                                'A network error occurred while validating the token. Please check your internet connection.',
                            })
                          }
                        } finally {
                          clearTimeout(timeoutId)
                          setIsValidatingToken(false)
                        }
                      }}
                    >
                      Verify
                    </Button>
                  </div>
                }
              />
            </Card>

            {/* Resources */}
            <Card title={t('settings:general.resources')}>
              <CardItem
                title={t('settings:general.documentation')}
                description={t('settings:general.documentationDesc')}
                actions={
                  <a
                    href="https://github.com/realerikk0/Mita#readme"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="flex items-center gap-1">
                      <span>{t('settings:general.viewDocs')}</span>
                      <IconExternalLink size={14} />
                    </div>
                  </a>
                }
              />
              <CardItem
                title={t('settings:general.releaseNotes')}
                description={t('settings:general.releaseNotesDesc')}
                actions={
                  <a
                    href="https://github.com/realerikk0/Mita/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="flex items-center gap-1">
                      <span>{t('settings:general.viewReleases')}</span>
                      <IconExternalLink size={14} />
                    </div>
                  </a>
                }
              />
            </Card>

            {/* Community */}
            <Card title={t('settings:general.community')}>
              <CardItem
                title={t('settings:general.github')}
                description={t('settings:general.githubDesc')}
                actions={
                  <a
                    href="https://github.com/realerikk0/Mita"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                      <IconBrandGithub
                        size={18}
                        className="text-muted-foreground"
                      />
                  </a>
                }
              />
            </Card>

            {/* Support */}
            <Card title={t('settings:general.support')}>
              <CardItem
                title={t('settings:general.reportAnIssue')}
                description={t('settings:general.reportAnIssueDesc')}
                actions={
                  <a
                    href="https://github.com/realerikk0/Mita/issues/new"
                    target="_blank"
                  >
                    <div className="flex items-center gap-1">
                      <span>{t('settings:general.reportIssue')}</span>
                      <IconExternalLink size={14} />
                    </div>
                  </a>
                }
              />
            </Card>

            {/* Credits */}
            <Card title={t('settings:general.credits')}>
              <CardItem
                align="start"
                description={
                  <div className="text-muted-foreground -mt-2">
                    <p>{t('settings:general.creditsDesc1')}</p>
                    <p className="mt-2">{t('settings:general.creditsDesc2')}</p>
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
