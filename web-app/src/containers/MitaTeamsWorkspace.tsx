import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  cn,
  getModelDisplayName,
  getModelLogoProvider,
  getProviderTitle,
} from '@/lib/utils'
import {
  DEFAULT_MITA_TEAMS_ROLES,
  MITA_TEAMS_CHANNELS,
  MITA_TEAMS_ORCHESTRATOR_ROLE_ID,
  MITA_TEAMS_TASK_CHANNEL_ID,
  MITA_TEAMS_MODES,
  MITA_TEAMS_ROLE_COLORS,
  patchMitaTeamsConfig,
  type MitaTeamsChannelConfig,
  type MitaTeamsChannelId,
  type MitaTeamsChoiceRequest,
  type MitaTeamsConfig,
  type MitaTeamsMode,
  type MitaTeamsRoleConfig,
  type MitaTeamsRoleId,
  type MitaTeamsRoleState,
  type MitaTeamsTeamEvent,
} from '@/types/mita-teams'
import type { UIMessage } from '@ai-sdk/react'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  GitBranch,
  Hash,
  ListChecks,
  MessageSquare,
  Minus,
  MoreVertical,
  Plus,
  Radio,
  Settings2,
  UsersRound,
} from 'lucide-react'
import { memo, type ReactNode, useCallback, useMemo } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { configuredChatModels } from '@/lib/configured-model-providers'

type MitaTeamsWorkspaceProps = {
  thread?: Thread
  config: MitaTeamsConfig
  messages: UIMessage[]
  messageItems: ReactNode
  inputArea: ReactNode
  isRuntimeBusy?: boolean
  onChoiceSelect?: (optionId: string) => void
  onConfigChange: (config: MitaTeamsConfig) => void
}

type ModelOption = {
  provider: string
  modelId: string
  label: string
  model: Model
}

function messageText(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
}

function compactTaskText(messages: UIMessage[], fallback?: string) {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  const text = firstUserMessage ? messageText(firstUserMessage) : ''
  const source = text || fallback || 'Mita Teams workspace'
  return source.length > 160 ? `${source.slice(0, 157)}...` : source
}

function permissionLabel(permission: MitaTeamsRoleConfig['permission']) {
  switch (permission) {
    case 'write':
      return 'permissionWrite'
    case 'tools':
      return 'permissionTools'
    default:
      return 'permissionRead'
  }
}

function roleModelLabel(role: MitaTeamsRoleConfig, fallback: string) {
  return role.modelId ? `${role.provider ?? 'provider'} / ${role.modelId}` : fallback
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function localizedChannelLabel(
  channel: MitaTeamsChannelConfig,
  t: Translate
) {
  const template = MITA_TEAMS_CHANNELS.find((item) => item.id === channel.id)
  if (!template || channel.label !== template.label) return channel.label
  return t(`mita-teams:channelsById.${channel.id}.label`)
}

function localizedChannelDescription(
  channel: MitaTeamsChannelConfig,
  t: Translate
) {
  const template = MITA_TEAMS_CHANNELS.find((item) => item.id === channel.id)
  if (!template || channel.description !== template.description) {
    return channel.description
  }
  return t(`mita-teams:channelsById.${channel.id}.description`)
}

function localizedModeLabel(mode: MitaTeamsMode, fallback: string, t: Translate) {
  return t(`mita-teams:modesById.${mode}.label`) || fallback
}

function localizedRoleName(role: MitaTeamsRoleConfig, t: Translate) {
  const template = DEFAULT_MITA_TEAMS_ROLES.find((item) => item.id === role.id)
  if (!template || role.name !== template.name) return role.name
  return t(`mita-teams:rolesById.${role.id}.name`)
}

function localizedRoleLabel(role: MitaTeamsRoleConfig, t: Translate) {
  const template = DEFAULT_MITA_TEAMS_ROLES.find((item) => item.id === role.id)
  if (!template || role.label !== template.label) return role.label
  return t(`mita-teams:rolesById.${role.id}.label`)
}

function localizedRoleDescription(role: MitaTeamsRoleConfig, t: Translate) {
  const template = DEFAULT_MITA_TEAMS_ROLES.find((item) => item.id === role.id)
  if (!template || role.description !== template.description) {
    return role.description
  }
  return t(`mita-teams:rolesById.${role.id}.description`)
}

function runtimeStatusLabel(status: string) {
  switch (status) {
    case 'running':
      return 'statusRunning'
    case 'waiting-for-user':
      return 'statusWaiting'
    case 'completed':
      return 'statusCompleted'
    case 'failed':
      return 'statusFailed'
    case 'stopped':
      return 'statusStopped'
    default:
      return 'statusIdle'
  }
}

function roleStatusLabel(status: string) {
  switch (status) {
    case 'running':
      return 'statusRunning'
    case 'done':
      return 'statusCompleted'
    case 'blocked':
      return 'statusWaiting'
    case 'failed':
      return 'statusFailed'
    default:
      return 'statusIdle'
  }
}

function displayTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function rolesForChannel(
  channel: MitaTeamsChannelConfig,
  roles: MitaTeamsRoleConfig[]
) {
  const roleIds = new Set(channel.roleIds)
  const channelRoles = channel.roleIds.length
    ? roles.filter((role) => roleIds.has(role.id))
    : []

  if (channelRoles.length) return channelRoles

  const orchestrator = roles.find(
    (role) => role.id === MITA_TEAMS_ORCHESTRATOR_ROLE_ID
  )
  return orchestrator ? [orchestrator] : roles.slice(0, 1)
}

function eventBelongsToChannel(
  event: MitaTeamsTeamEvent,
  channelId: MitaTeamsChannelId
) {
  if (event.channelId) return event.channelId === channelId
  return channelId === MITA_TEAMS_TASK_CHANNEL_ID
}

function streamBelongsToChannel(
  message: MitaTeamsRoleState['stream'][number],
  channelId: MitaTeamsChannelId
) {
  if (message.channelId) return message.channelId === channelId
  return channelId === MITA_TEAMS_TASK_CHANNEL_ID
}

function MemoryList({
  items,
  emptyText,
}: {
  items: string[]
  emptyText: string
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }

  return (
    <div className="space-y-2 text-xs leading-5">
      {items.slice(-5).map((item) => (
        <div key={item} className="rounded-md bg-muted/40 px-2 py-1.5">
          {item}
        </div>
      ))}
    </div>
  )
}

function RuntimeStatusBadge({
  status,
  isBusy,
}: {
  status: string
  isBusy?: boolean
}) {
  const { t } = useTranslation()
  const active = isBusy || status === 'running'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'bg-muted/40 text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          active ? 'bg-primary' : 'bg-muted-foreground/50'
        )}
      />
      {t(`mita-teams:${runtimeStatusLabel(status)}`)}
    </span>
  )
}

function ChoiceRequestCard({
  choice,
  onSelect,
}: {
  choice: MitaTeamsChoiceRequest
  onSelect?: (optionId: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mb-4 rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-start gap-2">
        <Radio className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t('mita-teams:waitingForOwner')}
          </div>
          <div className="mt-1 text-sm leading-5 text-muted-foreground">
            {choice.question}
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {choice.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="outline"
            className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
            onClick={() => onSelect?.(option.id)}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function RoleStreamPanel({
  role,
  state,
}: {
  role: MitaTeamsRoleConfig
  state?: MitaTeamsRoleState
}) {
  const { t } = useTranslation()
  const stream = state?.stream ?? []
  const roleName = localizedRoleName(role, t)

  if (stream.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-xl rounded-lg border bg-card p-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <span className={cn('size-3 rounded-full', role.color)} />
          {t('mita-teams:roleChatTitle', { role: roleName })}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {t('mita-teams:streamEmpty')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {stream.map((message) => (
        <div
          key={message.id}
          className={cn(
            'rounded-lg border p-3',
            message.role === 'assistant' ? 'bg-card' : 'bg-muted/30'
          )}
        >
            <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className={cn('size-2 rounded-full', role.color)} />
                {message.role === 'assistant' ? roleName : t('mita-teams:owner')}
              </span>
            <span>{displayTime(message.createdAt)}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-6">
            {message.content}
          </div>
        </div>
      ))}
    </div>
  )
}

function TeamTimeline({
  events,
}: {
  events: MitaTeamsTeamEvent[]
}) {
  const { t } = useTranslation()
  const visibleEvents = events.slice(-8).reverse()

  if (visibleEvents.length === 0) return null

  return (
    <div className="mb-4 rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <GitBranch className="size-3.5" />
        {t('mita-teams:teamTimeline')}
      </div>
      <div className="space-y-2">
        {visibleEvents.map((event) => (
          <div key={event.id} className="flex gap-2 text-xs leading-5">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{event.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {displayTime(event.createdAt)}
                </span>
              </div>
              {event.detail && (
                <div className="line-clamp-2 text-muted-foreground">
                  {event.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChannelRoleStreams({
  roles,
  runtime,
  channelId,
}: {
  roles: MitaTeamsRoleConfig[]
  runtime: MitaTeamsConfig['runtime']
  channelId: MitaTeamsChannelId
}) {
  const { t } = useTranslation()
  const roleStreams = roles
    .map((role) => {
      const messages = (runtime.roleStates[role.id]?.stream ?? [])
        .filter((message) => streamBelongsToChannel(message, channelId))
        .slice(-2)
      return { role, roleName: localizedRoleName(role, t), messages }
    })
    .filter((item) => item.messages.length > 0)

  if (roleStreams.length === 0) return null

  return (
    <div className="mb-4 grid gap-3">
      {roleStreams.map(({ role, roleName, messages }) => (
        <div key={role.id} className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex min-w-0 items-center gap-2 font-medium">
              <span className={cn('size-2.5 rounded-full', role.color)} />
              <span className="truncate">{roleName}</span>
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t(`mita-teams:${roleStatusLabel(runtime.roleStates[role.id]?.status ?? 'idle')}`)}
            </span>
          </div>
          <div className="space-y-2">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs leading-5',
                  message.role === 'assistant' ? 'bg-background' : 'bg-muted/40'
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {message.role === 'assistant'
                      ? roleName
                      : t('mita-teams:owner')}
                  </span>
                  <span>{displayTime(message.createdAt)}</span>
                </div>
                <div className="line-clamp-4 whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ModelPicker({
  role,
  modelOptions,
  onSelect,
  className,
}: {
  role: MitaTeamsRoleConfig
  modelOptions: ModelOption[]
  onSelect: (roleId: MitaTeamsRoleId, option: ModelOption) => void
  className?: string
}) {
  const { t } = useTranslation()
  const selectedLabel = role.modelId || t('mita-teams:unassigned')
  const selectedOption = modelOptions.find(
    (option) =>
      option.provider === role.provider && option.modelId === role.modelId
  )
  const selectedLogoProvider =
    selectedOption?.provider && selectedOption.modelId
      ? {
          provider: getModelLogoProvider(
            selectedOption.modelId,
            selectedOption.provider
          ),
        }
      : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9 min-w-0 justify-between gap-2 px-3 text-xs font-normal',
            className
          )}
        >
          {selectedLogoProvider && (
            <span className="shrink-0">
              <ProvidersAvatar provider={selectedLogoProvider} />
            </span>
          )}
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        {modelOptions.length === 0 ? (
          <DropdownMenuItem disabled>{t('common:noModels')}</DropdownMenuItem>
        ) : (
          modelOptions.map((option, index) => {
            const previous = modelOptions[index - 1]
            const showProvider = previous?.provider !== option.provider
            return (
              <div key={`${option.provider}:${option.modelId}`}>
                {showProvider && (
                  <>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem disabled className="gap-2 text-xs">
                      <ProvidersAvatar provider={{ provider: option.provider }} />
                      {getProviderTitle(option.provider)}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => onSelect(role.id, option)}
                >
                  <ProvidersAvatar
                    provider={{
                      provider: getModelLogoProvider(
                        option.modelId,
                        option.provider
                      ),
                    }}
                  />
                  <span className="truncate">{option.label}</span>
                </DropdownMenuItem>
              </div>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RoleConfigPanel({
  role,
  modelOptions,
  onBack,
  onUpdate,
  onSelectModel,
}: {
  role: MitaTeamsRoleConfig
  modelOptions: ModelOption[]
  onBack: () => void
  onUpdate: (roleId: MitaTeamsRoleId, patch: Partial<MitaTeamsRoleConfig>) => void
  onSelectModel: (roleId: MitaTeamsRoleId, option: ModelOption) => void
}) {
  const { t } = useTranslation()
  const roleName = localizedRoleName(role, t)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full"
            onClick={onBack}
            aria-label={t('mita-teams:backToTeam')}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className={cn('size-3 rounded-full', role.color)} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {t('mita-teams:configureRole', { role: roleName })}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {roleModelLabel(role, t('mita-teams:unassigned'))}
            </div>
          </div>
        </div>

        <section className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t('mita-teams:roleName')}
          </label>
          <Input
            value={role.name}
            onChange={(event) => onUpdate(role.id, { name: event.target.value })}
          />
        </section>

        <section className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t('mita-teams:roleColor')}
          </label>
          <div className="flex flex-wrap gap-2">
            {MITA_TEAMS_ROLE_COLORS.map((color) => (
              <Button
                key={color.value}
                type="button"
                variant="outline"
                size="icon-sm"
                className={cn(
                  'rounded-full p-0',
                  role.color === color.value && 'ring-2 ring-primary ring-offset-2'
                )}
                title={color.label}
                onClick={() => onUpdate(role.id, { color: color.value })}
              >
                <span className={cn('size-4 rounded-full', color.value)} />
              </Button>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t('mita-teams:roleDescription')}
          </label>
          <Textarea
            rows={3}
            value={role.description}
            onChange={(event) =>
              onUpdate(role.id, { description: event.target.value })
            }
          />
        </section>

        <section className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t('mita-teams:rolePrompt')}
          </label>
          <Textarea
            rows={7}
            value={role.prompt}
            onChange={(event) =>
              onUpdate(role.id, { prompt: event.target.value })
            }
          />
        </section>

        <section className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t('mita-teams:roleModel')}
          </label>
          <ModelPicker
            role={role}
            modelOptions={modelOptions}
            onSelect={onSelectModel}
            className="w-full"
          />
        </section>
      </div>
    </div>
  )
}

export const MitaTeamsWorkspace = memo(function MitaTeamsWorkspace({
  thread,
  config,
  messages,
  messageItems,
  inputArea,
  isRuntimeBusy,
  onChoiceSelect,
  onConfigChange,
}: MitaTeamsWorkspaceProps) {
  const { t } = useTranslation()
  const providers = useModelProvider((state) => state.providers)
  const enabledRoles = config.roles.filter((role) => role.enabled)
  const activeRole =
    config.roles.find((role) => role.id === config.activeRoleId) ??
    config.roles[0]
  const runtime = config.runtime
  const runStatus = runtime.run?.status ?? 'idle'
  const activeRoleState = runtime.roleStates[activeRole.id]
  const pendingChoice =
    runtime.userChoiceRequest?.status === 'pending'
      ? runtime.userChoiceRequest
      : undefined
  const activeChannel =
    config.channels.find((channel) => channel.id === config.activeChannel) ??
    config.channels[0] ??
    MITA_TEAMS_CHANNELS[0]
  const channelRoles = useMemo(
    () => rolesForChannel(activeChannel, config.roles),
    [activeChannel, config.roles]
  )
  const channelEnabledRoles = channelRoles.filter((role) => role.enabled)
  const channelEvents = useMemo(
    () =>
      runtime.teamEvents.filter((event) =>
        eventBelongsToChannel(event, activeChannel.id)
      ),
    [activeChannel.id, runtime.teamEvents]
  )
  const hasMessages =
    messages.length > 0 ||
    channelEvents.length > 0 ||
    (activeRoleState?.stream.length ?? 0) > 0 ||
    Boolean(pendingChoice)
  const taskText = compactTaskText(messages, thread?.title)
  const isRoleConfig = config.workspaceView === 'role-config'
  const isRoleChat = config.workspaceView === 'role-chat'
  const availableChannelTemplates = useMemo(
    () =>
      MITA_TEAMS_CHANNELS.filter(
        (template) =>
          !config.channels.some((channel) => channel.id === template.id)
      ),
    [config.channels]
  )
  const availableRoleTemplates = useMemo(
    () =>
      DEFAULT_MITA_TEAMS_ROLES.filter(
        (template) => !config.roles.some((role) => role.id === template.id)
      ),
    [config.roles]
  )

  const modelOptions = useMemo(
    () =>
      providers.flatMap((provider) =>
        configuredChatModels(provider).map((model) => ({
          provider: provider.provider,
          modelId: model.id,
          label: getModelDisplayName(model),
          model,
        }))
      ),
    [providers]
  )

  const patchConfig = useCallback(
    (patch: Partial<MitaTeamsConfig>) => {
      onConfigChange(patchMitaTeamsConfig(config, patch))
    },
    [config, onConfigChange]
  )

  const updateRole = useCallback(
    (roleId: MitaTeamsRoleId, patch: Partial<MitaTeamsRoleConfig>) => {
      patchConfig({
        roles: config.roles.map((role) =>
          role.id === roleId ? { ...role, ...patch } : role
        ),
      })
    },
    [config.roles, patchConfig]
  )

  const addRoleFromTemplate = useCallback(
    (roleId: MitaTeamsRoleId) => {
      const template = DEFAULT_MITA_TEAMS_ROLES.find(
        (role) => role.id === roleId
      )
      if (!template || config.roles.some((role) => role.id === roleId)) return

      patchConfig({
        roles: [
          ...config.roles,
          {
            ...template,
            provider: activeRole?.provider,
            modelId: activeRole?.modelId,
            enabled: true,
          },
        ],
        channels: config.channels.map((channel) =>
          channel.id === activeChannel.id
            ? {
                ...channel,
                roleIds: [...new Set([...channel.roleIds, template.id])],
              }
            : channel
        ),
        activeRoleId: template.id,
        workspaceView: 'role-config',
      })
    },
    [
      activeChannel.id,
      activeRole?.modelId,
      activeRole?.provider,
      config.channels,
      config.roles,
      patchConfig,
    ]
  )

  const addChannelFromTemplate = useCallback(
    (channelId: MitaTeamsChannelId) => {
      const template = MITA_TEAMS_CHANNELS.find(
        (channel) => channel.id === channelId
      )
      if (
        !template ||
        config.channels.some((channel) => channel.id === channelId)
      ) {
        return
      }

      const roleIds = template.roleIds.filter((roleId) =>
        config.roles.some((role) => role.id === roleId)
      )
      const fallbackRoleId =
        config.roles.find((role) => role.id === MITA_TEAMS_ORCHESTRATOR_ROLE_ID)
          ?.id ??
        config.roles[0]?.id ??
        MITA_TEAMS_ORCHESTRATOR_ROLE_ID

      patchConfig({
        channels: [
          ...config.channels,
          {
            ...template,
            roleIds: roleIds.length ? roleIds : [fallbackRoleId],
          },
        ],
        activeChannel: template.id,
        workspaceView: 'team-chat',
      })
    },
    [config.channels, config.roles, patchConfig]
  )

  const selectRoleModel = useCallback(
    (roleId: MitaTeamsRoleId, option: ModelOption) => {
      updateRole(roleId, {
        provider: option.provider,
        modelId: option.modelId,
      })
    },
    [updateRole]
  )

  const openTeamChat = useCallback(
    () => patchConfig({ workspaceView: 'team-chat' }),
    [patchConfig]
  )

  const openRoleChat = useCallback(
    (activeRoleId: MitaTeamsRoleId) =>
      patchConfig({ activeRoleId, workspaceView: 'role-chat' }),
    [patchConfig]
  )

  const openRoleConfig = useCallback(
    (activeRoleId: MitaTeamsRoleId) =>
      patchConfig({ activeRoleId, workspaceView: 'role-config' }),
    [patchConfig]
  )

  const setMode = useCallback(
    (mode: MitaTeamsMode) => patchConfig({ mode }),
    [patchConfig]
  )

  const setChannel = useCallback(
    (activeChannel: MitaTeamsChannelId) =>
      patchConfig({ activeChannel, workspaceView: 'team-chat' }),
    [patchConfig]
  )

  const activeRoleName = localizedRoleName(activeRole, t)
  const activeRoleDescription = localizedRoleDescription(activeRole, t)
  const activeChannelLabel = localizedChannelLabel(activeChannel, t)
  const activeChannelDescription = localizedChannelDescription(activeChannel, t)
  const mainTitle = isRoleConfig
    ? t('mita-teams:configureRole', { role: activeRoleName })
    : isRoleChat
      ? activeRoleName
      : activeChannelLabel
  const mainSubtitle =
    isRoleChat || isRoleConfig ? activeRoleDescription : activeChannelDescription
  const headerRoles = isRoleChat || isRoleConfig ? enabledRoles : channelEnabledRoles

  return (
    <div className="flex flex-1 min-h-0 gap-3 px-3 pb-3">
      <aside className="hidden w-56 shrink-0 flex-col rounded-lg border bg-card lg:flex">
        <div className="border-b px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Hash className="size-3.5" />
              {t('mita-teams:channels')}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full text-muted-foreground"
                  aria-label={t('mita-teams:addChannel')}
                >
                  <Plus className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {availableChannelTemplates.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {t('mita-teams:noChannelTemplates')}
                  </DropdownMenuItem>
                ) : (
                  availableChannelTemplates.map((channel) => (
                    <DropdownMenuItem
                      key={channel.id}
                      onClick={() => addChannelFromTemplate(channel.id)}
                    >
                      # {localizedChannelLabel(channel, t)}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="space-y-1">
            {config.channels.map((channel) => (
              <Button
                key={channel.id}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 w-full justify-start px-2 text-xs font-normal',
                  config.activeChannel === channel.id &&
                    config.workspaceView === 'team-chat' &&
                    'bg-primary/10 text-primary hover:bg-primary/10'
                )}
                onClick={() => setChannel(channel.id)}
              >
                # {localizedChannelLabel(channel, t)}
              </Button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <UsersRound className="size-3.5" />
              {t('mita-teams:roles')}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full text-muted-foreground"
                  aria-label={t('mita-teams:addRole')}
                >
                  <Plus className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {availableRoleTemplates.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {t('mita-teams:noRoleTemplates')}
                  </DropdownMenuItem>
                ) : (
                  availableRoleTemplates.map((role) => (
                    <DropdownMenuItem
                      key={role.id}
                      className="gap-2"
                      onClick={() => addRoleFromTemplate(role.id)}
                    >
                      <span className={cn('size-2.5 rounded-full', role.color)} />
                      <span>{localizedRoleName(role, t)}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="space-y-2">
            {config.roles.map((role) => {
              const active = config.activeRoleId === role.id
              const roleViewActive =
                active &&
                (config.workspaceView === 'role-chat' ||
                  config.workspaceView === 'role-config')
              return (
                <div
                  key={role.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md p-1 transition-colors',
                    roleViewActive && 'bg-primary/10'
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-11 min-w-0 flex-1 justify-start gap-2 px-2"
                    onClick={() => openRoleChat(role.id)}
                  >
                    <span className={cn('size-2.5 rounded-full', role.color)} />
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-xs font-medium">
                        {localizedRoleName(role, t)}
                      </span>
                      <span className="block truncate text-[11px] font-normal text-muted-foreground">
                        {role.modelId || t('mita-teams:unassigned')}
                      </span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'shrink-0 rounded-full text-muted-foreground',
                      active &&
                        config.workspaceView === 'role-config' &&
                        'bg-background text-foreground'
                    )}
                    aria-label={t('mita-teams:configureRole', {
                      role: localizedRoleName(role, t),
                    })}
                    onClick={() => openRoleConfig(role.id)}
                  >
                    <MoreVertical className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t p-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-medium">
              {t('mita-teams:rounds')}
            </div>
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                onClick={() =>
                  patchConfig({ roundLimit: Math.max(1, config.roundLimit - 1) })
                }
              >
                <Minus className="size-3" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('mita-teams:roundLimit', { count: config.roundLimit })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                onClick={() =>
                  patchConfig({
                    roundLimit: Math.min(10, config.roundLimit + 1),
                  })
                }
              >
                <Plus className="size-3" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isRoleConfig ? (
                <Settings2 className="size-4 text-primary" />
              ) : (
                <MessageSquare className="size-4 text-primary" />
              )}
              <span className="truncate text-sm font-medium">{mainTitle}</span>
              {!isRoleConfig && (
                <span className="hidden rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">
                  {isRoleChat
                    ? t('mita-teams:directChat')
                    : (() => {
                        const mode = MITA_TEAMS_MODES.find(
                          (item) => item.id === config.mode
                        )
                        return mode
                          ? localizedModeLabel(mode.id, mode.label, t)
                          : config.mode
                      })()}
                </span>
              )}
              {!isRoleConfig && (
                <RuntimeStatusBadge
                  status={runStatus}
                  isBusy={isRuntimeBusy}
                />
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {mainSubtitle}
            </div>
          </div>
          {!isRoleConfig && (
            <div className="flex shrink-0 items-center gap-1 lg:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full"
                    aria-label={t('mita-teams:channels')}
                  >
                    <Hash className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {config.channels.map((channel) => (
                    <DropdownMenuItem
                      key={channel.id}
                      className={cn(
                        'gap-2',
                        channel.id === config.activeChannel &&
                          config.workspaceView === 'team-chat' &&
                          'bg-primary/10 text-primary'
                      )}
                      onClick={() => setChannel(channel.id)}
                    >
                      <Hash className="size-3.5" />
                      <span className="truncate">
                        {localizedChannelLabel(channel, t)}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full"
                    aria-label={t('mita-teams:roles')}
                  >
                    <UsersRound className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {channelRoles.map((role) => (
                    <DropdownMenuItem
                      key={role.id}
                      className={cn(
                        'gap-2',
                        role.id === config.activeRoleId &&
                          config.workspaceView === 'role-chat' &&
                          'bg-primary/10 text-primary'
                      )}
                      onClick={() => openRoleChat(role.id)}
                    >
                      <span className={cn('size-2.5 rounded-full', role.color)} />
                      <span className="min-w-0 flex-1 truncate">
                        {localizedRoleName(role, t)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {role.modelId || t('mita-teams:unassigned')}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {isRoleChat && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label={t('mita-teams:configureRole', {
                    role: activeRoleName,
                  })}
                  onClick={() => openRoleConfig(activeRole.id)}
                >
                  <Settings2 className="size-4" />
                </Button>
              )}
            </div>
          )}
          {!isRoleConfig && (
            <div className="hidden shrink-0 items-center gap-1 md:flex">
              {headerRoles.slice(0, 5).map((role) => (
                <span
                  key={role.id}
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-[10px] font-medium text-primary-foreground',
                    role.color
                  )}
                  title={`${localizedRoleName(role, t)}: ${role.modelId || t('mita-teams:unassigned')}`}
                >
                  {localizedRoleLabel(role, t).slice(0, 1)}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="relative min-h-0 flex-1">
          {isRoleConfig ? (
            <RoleConfigPanel
              role={activeRole}
              modelOptions={modelOptions}
              onBack={openTeamChat}
              onUpdate={updateRole}
              onSelectModel={selectRoleModel}
            />
          ) : (
            <Conversation className="absolute inset-0 text-start">
              <ConversationContent className="mx-auto w-full max-w-3xl px-3 py-4">
                {!hasMessages && !isRoleChat && (
                  <div className="mx-auto mt-12 max-w-xl rounded-lg border bg-card p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                        {isRoleChat ? (
                          <span
                            className={cn('size-3 rounded-full', activeRole.color)}
                          />
                        ) : (
                          <UsersRound className="size-4" />
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {isRoleChat
                            ? t('mita-teams:roleChatTitle', {
                                role: activeRoleName,
                              })
                            : t('mita-teams:emptyTitle')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {isRoleChat
                            ? activeRoleDescription
                            : t('mita-teams:emptyDescription')}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {pendingChoice && !isRoleChat && (
                  <ChoiceRequestCard
                    choice={pendingChoice}
                    onSelect={onChoiceSelect}
                  />
                )}
                {isRoleChat ? (
                  <RoleStreamPanel role={activeRole} state={activeRoleState} />
                ) : (
                  <>
                    <TeamTimeline events={channelEvents} />
                    <ChannelRoleStreams
                      roles={channelEnabledRoles}
                      runtime={runtime}
                      channelId={activeChannel.id}
                    />
                    {messageItems}
                  </>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          )}
        </div>

        {!isRoleConfig && (
          <div className="shrink-0 border-t bg-background/95 px-3 py-3">
            <div className="mx-auto w-full max-w-3xl">{inputArea}</div>
          </div>
        )}
      </main>

      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-3 xl:flex">
        <section className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <CircleDot className="size-3.5" />
            {t('mita-teams:goal')}
          </div>
          <p className="text-sm leading-5">{taskText}</p>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <Boxes className="size-3.5" />
            {t('mita-teams:mode')}
          </div>
          <div className="grid gap-1">
            {MITA_TEAMS_MODES.map((mode) => (
              <Button
                key={mode.id}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto w-full justify-start whitespace-normal px-2 py-2 text-left',
                  config.mode === mode.id &&
                    'bg-primary/10 text-primary hover:bg-primary/10'
                )}
                onClick={() => setMode(mode.id)}
              >
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="text-xs font-medium">
                    {localizedModeLabel(mode.id, mode.label, t)}
                  </div>
                  <div className="line-clamp-2 whitespace-normal break-words text-[11px] font-normal text-muted-foreground">
                    {t(`mita-teams:modesById.${mode.id}.description`)}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <UsersRound className="size-3.5" />
            {t('mita-teams:roles')}
          </div>
          <div className="space-y-2">
            {channelRoles.map((role) => {
              const state = runtime.roleStates[role.id]
              return (
                <div key={role.id} className="rounded-lg border bg-background p-3">
                  <div className="mb-2 flex items-start gap-2">
                    <span
                      className={cn('mt-1 size-2.5 rounded-full', role.color)}
                      />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {localizedRoleName(role, t)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                        {localizedRoleDescription(role, t)}
                      </div>
                    </div>
                  </div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="rounded-full border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                      {t(`mita-teams:${permissionLabel(role.permission)}`)}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {role.modelId || t('mita-teams:unassigned')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {t(`mita-teams:${roleStatusLabel(state?.status ?? 'idle')}`)}
                    </span>
                    <span>
                      {t('mita-teams:memoryVersion', {
                        version: state?.memory.version ?? 0,
                      })}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <Brain className="size-3.5" />
            {t('mita-teams:projectMemory')}
          </div>
          <MemoryList
            items={[
              runtime.projectMemory.summary,
              ...runtime.projectMemory.milestones,
            ].filter(Boolean)}
            emptyText={t('mita-teams:memoryEmpty')}
          />
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <CheckCircle2 className="size-3.5" />
            {t('mita-teams:decisions')}
          </div>
          <MemoryList
            items={runtime.projectMemory.decisions}
            emptyText={t('mita-teams:decisionsEmpty')}
          />
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <ListChecks className="size-3.5" />
            {t('mita-teams:facts')}
          </div>
          <MemoryList
            items={runtime.projectMemory.facts}
            emptyText={t('mita-teams:factsEmpty')}
          />
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <AlertTriangle className="size-3.5" />
            {t('mita-teams:openQuestions')}
          </div>
          <MemoryList
            items={runtime.projectMemory.openQuestions}
            emptyText={t('mita-teams:openQuestionsEmpty')}
          />
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <Clock3 className="size-3.5" />
            {t('mita-teams:events')}
          </div>
          <MemoryList
            items={runtime.teamEvents.slice(-5).map((event) => event.title)}
            emptyText={t('mita-teams:teamEventsEmpty')}
          />
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t('mita-teams:budget')}
          </div>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, config.roundLimit * 10)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('mita-teams:budgetText', { count: config.roundLimit })}
          </p>
        </section>
      </aside>
    </div>
  )
})
