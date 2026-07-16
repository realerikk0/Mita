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
import { useBiyanWebResearch } from '@/hooks/useBiyanWebResearch'
import { useEffect, useState } from 'react'
import ChangeDataFolderLocation from '@/containers/dialogs/ChangeDataFolderLocation'
import { LegacyLocalDataCleanupDialog } from '@/containers/dialogs/LegacyLocalDataCleanupDialog'
import { ClearLogsDialog, FactoryResetDialog } from '@/containers/dialogs'
import type { FactoryResetOptions } from '@/services/app/types'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  IconBrandGithub,
  IconExternalLink,
  IconFolder,
  IconLogs,
  IconCopy,
  IconCopyCheck,
  IconTrash,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useHardware } from '@/hooks/useHardware'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { isRootDir } from '@/utils/path'
import {
  logUserAction,
  logUserError,
  logUserWarning,
} from '@/lib/user-log'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const {
    spellCheckChatInput,
    setSpellCheckChatInput,
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
  } = useBiyanWebResearch()

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
  const [biyanDataFolder, setBiyanDataFolder] = useState<
    string | undefined
  >()
  const [logsDirectory, setLogsDirectory] = useState<string | undefined>()
  const [isCopied, setIsCopied] = useState(false)
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null)
  const [cliPath, setCliPath] = useState<string | null>(null)
  const [isCliLoading, setIsCliLoading] = useState(false)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  useEffect(() => {
    const fetchStoragePaths = async () => {
      try {
        const [dataFolder, logsPath] = await Promise.all([
          serviceHub.app().getBiyanDataFolder(),
          serviceHub.app().getLogsDirectory(),
        ])
        setBiyanDataFolder(dataFolder)
        setLogsDirectory(logsPath)
        void logUserAction('settings.general.opened', 'General settings opened')
      } catch (error) {
        console.error('Failed to load storage paths:', error)
        void logUserError('settings.storage_paths.load_failed', error)
      }
    }

    fetchStoragePaths()
  }, [serviceHub])

  useEffect(() => {
    if (!IS_TAURI) return
    invoke<{ installed: boolean; path: string | null }>('check_biyan_cli_installed')
      .then((s) => { setCliInstalled(s.installed); setCliPath(s.path) })
      .catch(() => setCliInstalled(false))
  }, [])

  const handleInstallCli = async () => {
    setIsCliLoading(true)
    try {
      const s = await invoke<{ installed: boolean; path: string | null }>('install_biyan_cli')
      setCliInstalled(s.installed)
      setCliPath(s.path)
      toast.success(`Biyan CLI installed to ${s.path}`)
      void logUserAction('cli.install.succeeded', 'Biyan CLI installed')
    } catch (e) {
      toast.error('Install failed', { description: String(e) })
      void logUserError('cli.install.failed', e, undefined, 'settings')
    } finally {
      setIsCliLoading(false)
    }
  }

  const handleUninstallCli = async () => {
    setIsCliLoading(true)
    try {
      await invoke('uninstall_biyan_cli')
      setCliInstalled(false)
      setCliPath(null)
      toast.success('Biyan CLI uninstalled')
      void logUserAction('cli.uninstall.succeeded', 'Biyan CLI uninstalled')
    } catch (e) {
      toast.error('Uninstall failed', { description: String(e) })
      void logUserError('cli.uninstall.failed', e, undefined, 'settings')
    } finally {
      setIsCliLoading(false)
    }
  }

  const resetApp = async (options: FactoryResetOptions) => {
    if (isRootDir(biyanDataFolder ?? '/')) {
      toast.error(t('settings:general.couldNotResetRootDirectory'))
      void logUserWarning(
        'factory_reset.blocked_root_directory',
        'Factory reset blocked because data folder is root'
      )
      return
    }
    pausePolling()
    void logUserAction('factory_reset.requested', 'Factory reset requested', {
      keepAppData: options.keepAppData,
      keepConfigurations: options.keepConfigurations,
    })
    await serviceHub.app().factoryReset(options)
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLogsWindow()
      void logUserAction('settings.logs_window.opened', 'Logs window opened')
    } catch (error) {
      console.error('Failed to open logs window:', error)
      void logUserError('settings.logs_window.open_failed', error)
    }
  }

  const handleRevealLogsFolder = async () => {
    if (!logsDirectory) return
    try {
      await serviceHub.opener().revealItemInDir(logsDirectory)
      void logUserAction('settings.logs_directory.revealed')
    } catch (error) {
      console.error('Failed to reveal logs folder:', error)
      void logUserError('settings.logs_directory.reveal_failed', error)
    }
  }

  const handleClearLogs = async () => {
    try {
      await serviceHub.app().clearLogs()
      toast.success(t('settings:general.clearLogsSuccess'))
      void logUserAction('settings.logs_cleared', 'Local diagnostic logs cleared')
    } catch (error) {
      console.error('Failed to clear logs:', error)
      toast.error(t('settings:general.clearLogsError'))
      void logUserError('settings.logs_clear.failed', error)
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
        void logUserWarning('app_update.available', 'App update available', {
          version: update.version,
        })
      } else {
        toast.success(t('settings:general.noUpdateAvailable'))
        void logUserAction('app_update.no_update', 'No app update available')
      }
    } catch (error) {
      console.error('Failed to check for app updates:', error)
      toast.error(t('settings:general.updateError'))
      void logUserError('app_update.check_failed', error, undefined, 'settings')
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
      defaultPath: biyanDataFolder,
    })

    if (selectedPath === biyanDataFolder) return
    if (selectedPath !== null) {
      void logUserAction('data_folder.change_selected')
      setSelectedNewPath(selectedPath as string)
      setIsDialogOpen(true)
    }
  }

  const confirmDataFolderChange = async () => {
    if (selectedNewPath) {
      try {
        setTimeout(async () => {
          try {
            // Prevent relocating to root directory (e.g., C:\ or D:\ on Windows, / on Unix)
            if (isRootDir(selectedNewPath))
              throw new Error(t('settings:general.couldNotRelocateToRoot'))
            await serviceHub.app().relocateBiyanDataFolder(selectedNewPath)
            setBiyanDataFolder(selectedNewPath)
            void logUserAction('data_folder.relocate_succeeded')
            // Only relaunch if relocation was successful
            window.core?.api?.relaunch()
            setSelectedNewPath(null)
            setIsDialogOpen(false)
          } catch (error) {
            console.error(error)
            void logUserError('data_folder.relocate_failed', error)
            toast.error(
              error instanceof Error
                ? error.message
                : t('settings:general.failedToRelocateDataFolder')
            )
          }
        }, 1000)
      } catch (error) {
        console.error('Failed to relocate data folder:', error)
        void logUserError('data_folder.prepare_relocate_failed', error)
        // Revert the data folder path on error
        const originalPath = await serviceHub.app().getBiyanDataFolder()
        setBiyanDataFolder(originalPath)

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
                          title={biyanDataFolder}
                          className="text-xs line-clamp-1 break-all"
                        >
                          {biyanDataFolder}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          biyanDataFolder && copyToClipboard(biyanDataFolder)
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
                        currentPath={biyanDataFolder || ''}
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
                description={
                  <>
                    <span>{t('settings:dataFolder.appLogsDesc')}</span>
                    {logsDirectory && (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="max-w-100 bg-secondary rounded-sm px-1 py-0.5">
                          <span
                            title={logsDirectory}
                            className="text-xs line-clamp-1 break-all"
                          >
                            {logsDirectory}
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                }
                className="items-start flex-row gap-y-2"
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="p-0"
                      onClick={handleRevealLogsFolder}
                      disabled={!logsDirectory}
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
                    <ClearLogsDialog onClear={handleClearLogs}>
                      <Button
                        variant="destructive"
                        size="sm"
                        title={t('settings:general.clearLogs')}
                      >
                        <IconTrash
                          size={12}
                          className="text-destructive-foreground"
                        />
                        <span>{t('settings:general.clearLogs')}</span>
                      </Button>
                    </ClearLogsDialog>
                  </div>
                }
              />
            </Card>

            {/* Advanced - Desktop only */}
            <Card title="Advanced">
              {IS_TAURI && (
                <CardItem
                  title="Biyan CLI"
                  description={
                    cliInstalled && cliPath
                      ? `Installed at ${cliPath} — use biyan from your terminal to access the remote-provider gateway.`
                      : 'Use biyan from your terminal to access configured remote providers.'
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
              {IS_TAURI && (
                <CardItem
                  title="Retired local data"
                  description="Inspect downloaded local models and retired indexing data. Nothing is deleted until you review the exact paths and confirm a second time."
                  actions={<LegacyLocalDataCleanupDialog />}
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
                title={t('settings:others.webSearch', {
                  ns: 'settings',
                })}
                description={
                  hasWebResearchConfig
                    ? t('settings:others.webSearchDescConfigured', {
                        ns: 'settings',
                      })
                    : t('settings:others.webSearchDescUnconfigured', {
                        ns: 'settings',
                      })
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
