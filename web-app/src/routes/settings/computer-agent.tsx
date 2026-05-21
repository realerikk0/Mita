import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import {
  IconAlertTriangle,
  IconCopy,
  IconFolderCog,
  IconFolderOpen,
  IconRefresh,
  IconShieldCheck,
  IconTerminal2,
  IconTrash,
} from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'

export const Route = createFileRoute('/settings/computer-agent')({
  component: ComputerAgentSettings,
})

type ComputerAgentShellStatus = {
  platform: string
  available: boolean
  reason?: string
  sandboxKind?: string
  blockers?: string[]
}

function statusSummary(status: ComputerAgentShellStatus | null) {
  if (!status) return 'settings:computerAgent.shellStatusUnknown'
  if (status.available) return 'settings:computerAgent.shellStatusAvailable'
  return 'settings:computerAgent.shellStatusUnavailable'
}

function ComputerAgentSettings() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { settings, updateSettings, syncServers } = useMCPServers()
  const [shellStatus, setShellStatus] =
    useState<ComputerAgentShellStatus | null>(null)
  const [rootInput, setRootInput] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const refreshShellStatus = useCallback(async () => {
    try {
      const status = await invoke<ComputerAgentShellStatus>(
        'get_computer_agent_shell_status'
      )
      setShellStatus(status)
    } catch {
      setShellStatus({
        platform: 'unknown',
        available: false,
        reason: t('settings:computerAgent.shellStatusInspectFailed'),
      })
    }
  }, [t])

  useEffect(() => {
    void refreshShellStatus()
  }, [refreshShellStatus])

  useEffect(() => {
    const loadWorkspaceRoot = async () => {
      const dataFolder = await serviceHub.app().getMitaDataFolder()
      if (!dataFolder) return
      setWorkspaceRoot(await serviceHub.path().join(dataFolder, 'agent-workspaces'))
    }

    void loadWorkspaceRoot()
  }, [serviceHub])

  const persistSettings = (partial: Partial<typeof settings>) => {
    updateSettings(partial)
    void syncServers()
  }

  const validateAndAddRoot = async (rawRoot: string) => {
    const trimmed = rawRoot.trim()
    if (!trimmed) return

    try {
      const canonical = await invoke<string>(
        'validate_computer_agent_allowed_root',
        { path: trimmed }
      )
      const roots = settings.computerAgentAllowedRoots ?? []
      if (
        roots.some((root) => root.toLowerCase() === canonical.toLowerCase())
      ) {
        setRootInput('')
        return
      }

      persistSettings({
        computerAgentAllowedRoots: [...roots, canonical],
      })
      setRootInput('')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('settings:computerAgent.allowedRootInvalid')
      )
    }
  }

  const pickAllowedRoot = async () => {
    const selected = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
      defaultPath: workspaceRoot || undefined,
    })

    if (typeof selected === 'string') {
      await validateAndAddRoot(selected)
    }
  }

  const removeAllowedRoot = (root: string) => {
    persistSettings({
      computerAgentAllowedRoots: (
        settings.computerAgentAllowedRoots ?? []
      ).filter((value) => value !== root),
    })
  }

  const copyWorkspacePath = async () => {
    if (!workspaceRoot) return
    await navigator.clipboard.writeText(workspaceRoot)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const revealWorkspace = async () => {
    if (!workspaceRoot) return
    await serviceHub.opener().revealItemInDir(workspaceRoot)
  }

  const shellDescription = [
    t(statusSummary(shellStatus)),
    shellStatus && !shellStatus.available ? shellStatus.reason : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  const approvalPolicy = settings.computerAgentApprovalPolicy ?? 'alwaysAsk'
  const sandboxAccess = settings.computerAgentSandboxAccess ?? 'readWrite'
  const shellBlockedByReadOnly = sandboxAccess === 'readOnly'

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card title={t('settings:computerAgent.title')}>
              <CardItem
                title={t('settings:computerAgent.enableTitle')}
                description={t('settings:computerAgent.enableDescription')}
                actions={
                  <div className="shrink-0 ml-4">
                    <Switch
                      checked={settings.computerAgentEnabled}
                      onCheckedChange={(checked) => {
                        persistSettings(
                          checked
                            ? { computerAgentEnabled: true }
                            : {
                                computerAgentEnabled: false,
                                computerAgentShellEnabled: false,
                              }
                        )
                      }}
                    />
                  </div>
                }
              />
              <CardItem
                title={
                  <span className="inline-flex items-center gap-2">
                    <IconTerminal2 size={16} />
                    {t('settings:computerAgent.shellTitle')}
                  </span>
                }
                description={shellDescription}
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void refreshShellStatus()}
                      title={t('settings:computerAgent.refreshShellStatus')}
                    >
                      <IconRefresh size={15} />
                    </Button>
                    <Switch
                      checked={
                        settings.computerAgentShellEnabled &&
                        shellStatus?.available === true &&
                        !shellBlockedByReadOnly
                      }
                      disabled={
                        !settings.computerAgentEnabled ||
                        shellStatus?.available !== true ||
                        shellBlockedByReadOnly
                      }
                      onCheckedChange={(checked) => {
                        persistSettings({
                          computerAgentShellEnabled: checked,
                        })
                      }}
                    />
                  </div>
                }
              />
              {shellStatus?.blockers?.length ? (
                <CardItem
                  title={t('settings:computerAgent.shellBlockersTitle')}
                  description={
                    <div className="space-y-1">
                      {shellStatus.blockers.slice(0, 4).map((blocker) => (
                        <div key={blocker}>{blocker}</div>
                      ))}
                    </div>
                  }
                />
              ) : null}
            </Card>

            <Card title={t('settings:computerAgent.policyTitle')}>
              <CardItem
                title={t('settings:computerAgent.approvalPolicySelectTitle')}
                description={t(
                  'settings:computerAgent.approvalPolicySelectDescription'
                )}
                actions={
                  <select
                    className="h-8 min-w-48 rounded-md border bg-background px-2 text-sm"
                    value={approvalPolicy}
                    disabled={!settings.computerAgentEnabled}
                    onChange={(event) => {
                      persistSettings({
                        computerAgentApprovalPolicy: event.target
                          .value as typeof approvalPolicy,
                      })
                    }}
                  >
                    <option value="alwaysAsk">
                      {t('settings:computerAgent.approvalAlwaysAsk')}
                    </option>
                    <option value="oncePerThread">
                      {t('settings:computerAgent.approvalOncePerThread')}
                    </option>
                    <option value="never">
                      {t('settings:computerAgent.approvalNever')}
                    </option>
                  </select>
                }
              />
              {approvalPolicy === 'never' ? (
                <CardItem
                  title={
                    <span className="inline-flex items-center gap-2 text-destructive">
                      <IconAlertTriangle size={16} />
                      {t('settings:computerAgent.approvalNeverDangerTitle')}
                    </span>
                  }
                  description={
                    <span className="text-destructive">
                      {t(
                        'settings:computerAgent.approvalNeverDangerDescription'
                      )}
                    </span>
                  }
                />
              ) : null}
              <CardItem
                title={t('settings:computerAgent.sandboxAccessTitle')}
                description={t(
                  'settings:computerAgent.sandboxAccessDescription'
                )}
                actions={
                  <select
                    className="h-8 min-w-48 rounded-md border bg-background px-2 text-sm"
                    value={sandboxAccess}
                    disabled={!settings.computerAgentEnabled}
                    onChange={(event) => {
                      const value = event.target
                        .value as typeof sandboxAccess
                      persistSettings({
                        computerAgentSandboxAccess: value,
                        ...(value === 'readOnly'
                          ? { computerAgentShellEnabled: false }
                          : {}),
                      })
                    }}
                  >
                    <option value="readOnly">
                      {t('settings:computerAgent.sandboxReadOnly')}
                    </option>
                    <option value="readWrite">
                      {t('settings:computerAgent.sandboxReadWrite')}
                    </option>
                  </select>
                }
              />
              {sandboxAccess === 'readOnly' ? (
                <CardItem
                  title={t('settings:computerAgent.sandboxReadOnlyNoteTitle')}
                  description={t(
                    'settings:computerAgent.sandboxReadOnlyNoteDescription'
                  )}
                />
              ) : null}
            </Card>

            <Card title={t('settings:computerAgent.workspaceTitle')}>
              <CardItem
                title={
                  <span className="inline-flex items-center gap-2">
                    <IconFolderCog size={16} />
                    {t('settings:computerAgent.workspaceRootTitle')}
                  </span>
                }
                description={t('settings:computerAgent.workspaceRootDescription')}
                column
                actions={
                  <div className="flex flex-col gap-2 w-full">
                    <div className="rounded-md border bg-secondary px-2 py-1 font-mono text-xs break-all">
                      {workspaceRoot || t('settings:computerAgent.workspaceUnknown')}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!workspaceRoot}
                        onClick={copyWorkspacePath}
                      >
                        <IconCopy size={15} />
                        {copied
                          ? t('settings:computerAgent.copied')
                          : t('settings:computerAgent.copyPath')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!workspaceRoot}
                        onClick={revealWorkspace}
                      >
                        <IconFolderOpen size={15} />
                        {t('settings:computerAgent.showInFileExplorer')}
                      </Button>
                    </div>
                  </div>
                }
              />
            </Card>

            <Card title={t('settings:computerAgent.allowedRootsTitle')}>
              <CardItem
                title={t('settings:computerAgent.allowedRootsManageTitle')}
                description={t(
                  'settings:computerAgent.allowedRootsManageDescription'
                )}
                column
                actions={
                  <div className="w-full space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={rootInput}
                        onChange={(event) => setRootInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void validateAndAddRoot(rootInput)
                          }
                        }}
                        placeholder={t(
                          'settings:computerAgent.allowedRootPlaceholder'
                        )}
                        disabled={!settings.computerAgentEnabled}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!settings.computerAgentEnabled}
                        onClick={pickAllowedRoot}
                      >
                        <IconFolderOpen size={15} />
                        {t('settings:computerAgent.chooseFolder')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          !settings.computerAgentEnabled || !rootInput.trim()
                        }
                        onClick={() => validateAndAddRoot(rootInput)}
                      >
                        {t('settings:computerAgent.addRoot')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('settings:computerAgent.allowedRootsShellNote')}
                    </p>
                    {(settings.computerAgentAllowedRoots ?? []).length > 0 && (
                      <div className="space-y-1">
                        {(settings.computerAgentAllowedRoots ?? []).map(
                          (root) => (
                            <div
                              key={root}
                              className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1 text-xs"
                            >
                              <span className="break-all">{root}</span>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => removeAllowedRoot(root)}
                                title={t('settings:computerAgent.removeRoot')}
                              >
                                <IconTrash
                                  size={14}
                                  className="text-muted-foreground"
                                />
                              </Button>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                }
              />
            </Card>

            <Card title={t('settings:computerAgent.safetyTitle')}>
              <CardItem
                title={
                  <span className="inline-flex items-center gap-2">
                    <IconShieldCheck size={16} />
                    {t('settings:computerAgent.safetyBoundaryTitle')}
                  </span>
                }
                description={t('settings:computerAgent.safetyBoundaryDescription')}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
