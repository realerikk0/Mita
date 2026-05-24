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
  MITA_TEAMS_MODES,
  MITA_TEAMS_ROLE_COLORS,
  patchMitaTeamsConfig,
  type MitaTeamsChannelId,
  type MitaTeamsConfig,
  type MitaTeamsMode,
  type MitaTeamsRoleConfig,
  type MitaTeamsRoleId,
} from '@/types/mita-teams'
import type { UIMessage } from '@ai-sdk/react'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileText,
  Hash,
  MessageSquare,
  Minus,
  MoreVertical,
  Plus,
  Settings2,
  UsersRound,
} from 'lucide-react'
import { memo, type ReactNode, useCallback, useMemo } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import ProvidersAvatar from '@/containers/ProvidersAvatar'

type MitaTeamsWorkspaceProps = {
  thread?: Thread
  config: MitaTeamsConfig
  messages: UIMessage[]
  messageItems: ReactNode
  inputArea: ReactNode
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
              {t('mita-teams:configureRole', { role: role.name })}
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
  onConfigChange,
}: MitaTeamsWorkspaceProps) {
  const { t } = useTranslation()
  const providers = useModelProvider((state) => state.providers)
  const hasMessages = messages.length > 0
  const enabledRoles = config.roles.filter((role) => role.enabled)
  const activeRole =
    config.roles.find((role) => role.id === config.activeRoleId) ??
    config.roles[0]
  const activeChannel =
    config.channels.find((channel) => channel.id === config.activeChannel) ??
    config.channels[0] ??
    MITA_TEAMS_CHANNELS[0]
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
        provider.models.map((model) => ({
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
        activeRoleId: template.id,
        workspaceView: 'role-config',
      })
    },
    [activeRole?.modelId, activeRole?.provider, config.roles, patchConfig]
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

      patchConfig({
        channels: [...config.channels, template],
        activeChannel: template.id,
        workspaceView: 'team-chat',
      })
    },
    [config.channels, patchConfig]
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

  const mainTitle = isRoleConfig
    ? t('mita-teams:configureRole', { role: activeRole.name })
    : isRoleChat
      ? activeRole.name
      : activeChannel.label
  const mainSubtitle =
    isRoleChat || isRoleConfig ? activeRole.description : activeChannel.description

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
                      # {channel.label}
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
                # {channel.label}
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
                      <span>{role.name}</span>
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
                        {role.name}
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
                      role: role.name,
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
                    : MITA_TEAMS_MODES.find((mode) => mode.id === config.mode)
                        ?.label}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {mainSubtitle}
            </div>
          </div>
          {!isRoleConfig && (
            <div className="hidden shrink-0 items-center gap-1 md:flex">
              {enabledRoles.slice(0, 5).map((role) => (
                <span
                  key={role.id}
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-[10px] font-medium text-primary-foreground',
                    role.color
                  )}
                  title={`${role.name}: ${role.modelId || t('mita-teams:unassigned')}`}
                >
                  {role.label.slice(0, 1)}
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
                {!hasMessages && (
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
                                role: activeRole.name,
                              })
                            : t('mita-teams:emptyTitle')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {isRoleChat
                            ? activeRole.description
                            : t('mita-teams:emptyDescription')}
                        </div>
                      </div>
                    </div>
                    {!isRoleChat && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {[
                          t('mita-teams:starterPlan.research'),
                          t('mita-teams:starterPlan.architect'),
                          t('mita-teams:starterPlan.builder'),
                          t('mita-teams:starterPlan.reviewer'),
                        ].map((item, index) => (
                          <div
                            key={item}
                            className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
                          >
                            <span className="flex size-5 items-center justify-center rounded-full bg-background text-[10px] text-muted-foreground">
                              {index + 1}
                            </span>
                            {item}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {messageItems}
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
                  <div className="text-xs font-medium">{mode.label}</div>
                  <div className="line-clamp-2 whitespace-normal break-words text-[11px] font-normal text-muted-foreground">
                    {mode.description}
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
            {config.roles.map((role) => (
              <div key={role.id} className="rounded-lg border bg-background p-3">
                <div className="mb-2 flex items-start gap-2">
                  <span
                    className={cn('mt-1 size-2.5 rounded-full', role.color)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{role.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                      {role.description}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                    {t(`mita-teams:${permissionLabel(role.permission)}`)}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {role.modelId || t('mita-teams:unassigned')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <CheckCircle2 className="size-3.5" />
            {t('mita-teams:plan')}
          </div>
          <div className="space-y-2 text-xs">
            {[
              t('mita-teams:starterPlan.research'),
              t('mita-teams:starterPlan.architect'),
              t('mita-teams:starterPlan.builder'),
              t('mita-teams:starterPlan.reviewer'),
            ].map((item, index) => (
              <div key={item} className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    index < 2 ? 'bg-primary' : 'bg-muted-foreground/30'
                  )}
                />
                <span className="truncate">{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <AlertTriangle className="size-3.5" />
            {t('mita-teams:decisions')}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('mita-teams:decisionsEmpty')}
          </p>
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <FileText className="size-3.5" />
            {t('mita-teams:artifacts')}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('mita-teams:artifactsEmpty')}
          </p>
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
