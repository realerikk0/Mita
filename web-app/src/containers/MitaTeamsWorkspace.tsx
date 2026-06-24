import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
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
  MITA_TEAMS_TASK_TEMPLATES,
  archiveMitaTeamsRole,
  markMitaTeamsRoleUserEdit,
  patchMitaTeamsConfig,
  type MitaTeamsArtifact,
  type MitaTeamsChannelConfig,
  type MitaTeamsChannelId,
  type MitaTeamsChoiceRequest,
  type MitaTeamsConfig,
  type MitaTeamsMode,
  type MitaTeamsPlanDraft,
  type MitaTeamsRoleConfig,
  type MitaTeamsRoleEditableField,
  type MitaTeamsRoleId,
  type MitaTeamsRoleState,
  type MitaTeamsTaskStatus,
  type MitaTeamsTaskTemplateId,
  type MitaTeamsTeamEvent,
  type MitaTeamsTokenUsage,
} from '@/types/mita-teams'
import type { UIMessage } from '@ai-sdk/react'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  FileText,
  GitBranch,
  Hash,
  ListChecks,
  Loader2,
  MessageSquare,
  Minus,
  MoreVertical,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Target,
  UsersRound,
} from 'lucide-react'
import {
  memo,
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { configuredChatModels } from '@/lib/configured-model-providers'
import { RenderMarkdown } from '@/containers/RenderMarkdown'

type MitaTeamsWorkspaceProps = {
  thread?: Thread
  config: MitaTeamsConfig
  messages: UIMessage[]
  messageItems: ReactNode
  inputArea: ReactNode
  isRuntimeBusy?: boolean
  onChoiceSelect?: (optionId: string) => void
  onTextResponse?: (text: string) => void
  onPlanApprove?: () => void
  onPlanRevise?: (revision: string) => void
  onConfigChange: (config: MitaTeamsConfig) => void
}

type ModelOption = {
  provider: string
  modelId: string
  label: string
  model: Model
}

type RoleMentionTarget = {
  id: MitaTeamsRoleId
  label: string
  color: string
  aliases: string[]
}

const ROLE_MENTION_LINK_PREFIX = '#mita-role-'
const MARKDOWN_PROTECTED_SEGMENT_RE =
  /(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]+\]\([^)]+\))/g

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
  const source = text || fallback || 'Biyan Teams workspace'
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
  return role.modelId
    ? `${role.provider ?? 'provider'} / ${role.modelId}`
    : fallback
}

// Shows which provider/model actually produced a role's message. Reads the
// model captured on the message at generation time (so it survives later
// role-config edits), falling back to the role's current model.
function MessageModelBadge({
  model,
  role,
}: {
  model?: ThreadModel
  role: MitaTeamsRoleConfig
}) {
  const modelId = model?.id ?? role.modelId
  const provider = model?.provider ?? role.provider
  if (!modelId && !provider) return null

  const logoProvider = getModelLogoProvider(modelId ?? '', provider ?? 'provider')
  const label = modelId
    ? getModelDisplayName(modelId)
    : getProviderTitle(provider ?? '')

  return (
    <span
      className="inline-flex min-w-0 max-w-[10rem] items-center gap-1"
      title={roleModelLabel(role, label)}
    >
      <ProvidersAvatar provider={{ provider: logoProvider }} />
      <span className="truncate">{label}</span>
    </span>
  )
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function localizedChannelLabel(channel: MitaTeamsChannelConfig, t: Translate) {
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

function localizedModeLabel(
  mode: MitaTeamsMode,
  fallback: string,
  t: Translate
) {
  return t(`mita-teams:modesById.${mode}.label`) || fallback
}

function localizedTaskTemplateLabel(
  templateId: MitaTeamsTaskTemplateId,
  fallback: string,
  t: Translate
) {
  return t(`mita-teams:templatesById.${templateId}.label`) || fallback
}

function localizedTaskTemplateDescription(
  templateId: MitaTeamsTaskTemplateId,
  fallback: string,
  t: Translate
) {
  return t(`mita-teams:templatesById.${templateId}.description`) || fallback
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/]/g, '\\]')
}

function roleMentionHref(roleId: MitaTeamsRoleId) {
  return `${ROLE_MENTION_LINK_PREFIX}${encodeURIComponent(roleId)}`
}

function roleIdFromMentionHref(href?: string) {
  if (!href?.startsWith(ROLE_MENTION_LINK_PREFIX)) return undefined
  return decodeURIComponent(href.slice(ROLE_MENTION_LINK_PREFIX.length))
}

function uniqueTextValues(values: Array<string | undefined>) {
  const seen = new Set<string>()
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function buildRoleMentionTargets(
  roles: MitaTeamsRoleConfig[],
  t: Translate
): RoleMentionTarget[] {
  return roles
    .filter((role) => role.enabled)
    .map((role) => {
      const name = localizedRoleName(role, t)
      const label = localizedRoleLabel(role, t)
      return {
        id: role.id,
        label: name,
        color: role.color,
        aliases: uniqueTextValues([name, label, role.name, role.label]),
      }
    })
    .filter((role) => role.aliases.length > 0)
}

function linkifyRoleMentions(content: string, targets: RoleMentionTarget[]) {
  if (targets.length === 0) return content

  const aliases = targets
    .flatMap((target) =>
      target.aliases.map((alias) => ({ alias, target }))
    )
    .sort((a, b) => b.alias.length - a.alias.length)

  if (aliases.length === 0) return content

  const aliasByText = new Map(
    aliases.map((item) => [item.alias.toLocaleLowerCase(), item.target])
  )
  const aliasPattern = aliases.map((item) => escapeRegExp(item.alias)).join('|')
  const mentionRegex = new RegExp(
    `(^|[^\\p{L}\\p{N}_])@?(${aliasPattern})(?=$|[^\\p{L}\\p{N}_])`,
    'giu'
  )

  return content
    .split(MARKDOWN_PROTECTED_SEGMENT_RE)
    .map((segment, index) => {
      if (!segment || index % 2 === 1) return segment

      return segment.replace(mentionRegex, (match, prefix, roleName) => {
        const target = aliasByText.get(roleName.toLocaleLowerCase())
        if (!target) return match
        return `${prefix}[${escapeMarkdownLinkLabel(roleName)}](${roleMentionHref(
          target.id
        )})`
      })
    })
    .join('')
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

function taskStatusLabel(status: MitaTeamsTaskStatus) {
  switch (status) {
    case 'researching':
      return 'taskStatusResearching'
    case 'implementing':
      return 'taskStatusImplementing'
    case 'reviewing':
      return 'taskStatusReviewing'
    case 'done':
      return 'taskStatusDone'
    default:
      return 'taskStatusTodo'
  }
}

function artifactTypeLabel(type: MitaTeamsArtifact['type']) {
  switch (type) {
    case 'decision':
      return 'artifactTypeDecision'
    case 'risk':
      return 'artifactTypeRisk'
    case 'test_result':
      return 'artifactTypeTestResult'
    case 'final_draft':
      return 'artifactTypeFinalDraft'
    default:
      return 'artifactTypeArtifact'
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

function displayDuration(value?: number) {
  if (!value || value < 0) return '0s'
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function formatTokenCount(value?: number) {
  if (!value || value <= 0) return undefined
  return new Intl.NumberFormat().format(Math.round(value))
}

function totalTokenCount(usage?: MitaTeamsTokenUsage) {
  if (!usage) return undefined
  if (usage.totalTokens && usage.totalTokens > 0) return usage.totalTokens
  const prompt = usage.promptTokens ?? 0
  const completion = usage.completionTokens ?? 0
  const total = prompt + completion
  return total > 0 ? total : undefined
}

function RuntimeTokenUsageSummary({
  usage,
}: {
  usage?: MitaTeamsTokenUsage
}) {
  const { t } = useTranslation()
  const total = formatTokenCount(totalTokenCount(usage))
  if (!total) return null

  const prompt = formatTokenCount(usage?.promptTokens)
  const completion = formatTokenCount(usage?.completionTokens)
  const detail =
    prompt || completion
      ? t('mita-teams:tokenUsageDetail', {
          prompt: prompt ?? '0',
          completion: completion ?? '0',
        })
      : undefined

  return (
    <div className="mb-4 flex justify-center">
      <div className="inline-flex max-w-[min(44rem,92%)] flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        <Brain className="size-3.5 text-primary" />
        <span className="font-medium text-foreground">
          {t('mita-teams:tokenUsage')}
        </span>
        <span>{total} tokens</span>
        {detail && <span className="text-[11px]">{detail}</span>}
      </div>
    </div>
  )
}

function timeValue(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function rolesForChannel(
  channel: MitaTeamsChannelConfig,
  roles: MitaTeamsRoleConfig[]
) {
  const enabledRoles = roles.filter((role) => role.enabled)
  const roleIds = new Set(channel.roleIds)
  const channelRoles = channel.roleIds.length
    ? enabledRoles.filter((role) => roleIds.has(role.id))
    : []

  if (channelRoles.length) return channelRoles

  const orchestrator = enabledRoles.find(
    (role) => role.id === MITA_TEAMS_ORCHESTRATOR_ROLE_ID
  )
  return orchestrator ? [orchestrator] : enabledRoles.slice(0, 1)
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
  return Boolean(message.channelId && message.channelId === channelId)
}

function isSetupLocked(config: MitaTeamsConfig, messages: UIMessage[]) {
  const runtime = config.runtime
  return (
    messages.length > 0 ||
    Boolean(runtime.run) ||
    runtime.teamEvents.length > 0 ||
    runtime.tasks.length > 0 ||
    runtime.artifacts.length > 0 ||
    runtime.milestones.length > 0 ||
    runtime.projectMemory.version > 0
  )
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

const TASK_STATUS_ORDER: MitaTeamsTaskStatus[] = [
  'todo',
  'researching',
  'implementing',
  'reviewing',
  'done',
]

function TaskBoard({
  tasks,
  roles,
}: {
  tasks: MitaTeamsConfig['runtime']['tasks']
  roles: MitaTeamsRoleConfig[]
}) {
  const { t } = useTranslation()
  const roleNames = useMemo(
    () => new Map(roles.map((role) => [role.id, localizedRoleName(role, t)])),
    [roles, t]
  )

  if (tasks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('mita-teams:tasksEmpty')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {TASK_STATUS_ORDER.map((status) => {
        const items = tasks.filter((task) => task.status === status)
        if (items.length === 0) return null
        return (
          <div key={status}>
            <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
              {t(`mita-teams:${taskStatusLabel(status)}`)}
            </div>
            <div className="space-y-1.5">
              {items.slice(-4).map((task) => (
                <div
                  key={task.id}
                  className="rounded-md border bg-muted/20 px-2 py-1.5"
                >
                  <div className="text-xs font-medium leading-5">
                    {task.title}
                  </div>
                  {(task.roleId || task.channelId) && (
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {[
                        task.roleId
                          ? (roleNames.get(task.roleId) ?? task.roleId)
                          : undefined,
                        task.channelId ? `#${task.channelId}` : undefined,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ArtifactsList({ artifacts }: { artifacts: MitaTeamsArtifact[] }) {
  const { t } = useTranslation()

  if (artifacts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('mita-teams:artifactsEmpty')}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {artifacts
        .slice(-6)
        .reverse()
        .map((artifact) => (
          <div key={artifact.id} className="rounded-md border bg-muted/20 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium">
                {artifact.title}
              </span>
              <span className="shrink-0 rounded-full border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t(`mita-teams:${artifactTypeLabel(artifact.type)}`)}
              </span>
            </div>
            <div className="line-clamp-3 text-xs leading-5 text-muted-foreground">
              {artifact.summary}
            </div>
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
  onTextResponse,
  disabled,
}: {
  choice: MitaTeamsChoiceRequest
  onSelect?: (optionId: string) => void
  onTextResponse?: (text: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [textResponse, setTextResponse] = useState('')
  const isPending = choice.status === 'pending'
  const isFreeText = choice.kind === 'free_text'
  const canSubmitText =
    isFreeText && isPending && !disabled && textResponse.trim().length > 0

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
      {isFreeText ? (
        <div className="grid gap-2">
          <Textarea
            value={textResponse}
            placeholder={t('mita-teams:freeTextPlaceholder')}
            rows={4}
            disabled={disabled || !isPending}
            onChange={(event) => setTextResponse(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!canSubmitText}
              onClick={() => {
                if (!canSubmitText) return
                onTextResponse?.(textResponse.trim())
              }}
            >
              {t('mita-teams:submitFreeText')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {choice.options.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
              disabled={disabled || !isPending}
              onClick={() => {
                if (disabled || !isPending) return
                onSelect?.(option.id)
              }}
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
      )}
    </div>
  )
}

function FloatingDots({ muted = false }: { muted?: boolean }) {
  return (
    <span
      data-testid="progress-floating-dots"
      className="inline-flex w-6 shrink-0 items-center justify-center gap-0.5"
      aria-hidden="true"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'size-1.5 animate-bounce rounded-full',
            muted ? 'bg-muted-foreground/50' : 'bg-primary'
          )}
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </span>
  )
}

function PlanReviewCard({
  plan,
  disabled,
  onApprove,
  onRevise,
}: {
  plan: MitaTeamsPlanDraft
  disabled?: boolean
  onApprove?: () => void
  onRevise?: (revision: string) => void
}) {
  const { t } = useTranslation()
  const [revision, setRevision] = useState('')
  const isApproved = plan.status === 'approved'
  const canSubmitRevision = revision.trim().length > 0 && !disabled

  return (
    <div className="mb-4 rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t('mita-teams:planReviewTitle')}
          </div>
          <div className="mt-1 text-sm leading-5 text-muted-foreground">
            {t(
              isApproved
                ? 'mita-teams:planApprovedDescription'
                : 'mita-teams:planReviewDescription'
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold">{plan.goal}</div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {plan.summary}
          </p>
        </div>

        {plan.scope.length > 0 && (
          <section className="grid gap-1">
            <div className="text-xs font-medium text-muted-foreground">
              {t('mita-teams:planScope')}
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {plan.scope.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {plan.acceptanceCriteria.length > 0 && (
          <section className="grid gap-1">
            <div className="text-xs font-medium text-muted-foreground">
              {t('mita-teams:planAcceptanceCriteria')}
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {plan.acceptanceCriteria.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {plan.tasks.length > 0 && (
          <section className="grid gap-1">
            <div className="text-xs font-medium text-muted-foreground">
              {t('mita-teams:planTasks')}
            </div>
            <div className="grid gap-1.5">
              {plan.tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-md border bg-muted/20 px-3 py-2 text-sm"
                >
                  <div className="font-medium">{task.title}</div>
                  {task.description && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {task.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {plan.roleAssignments.length > 0 && (
          <section className="grid gap-1">
            <div className="text-xs font-medium text-muted-foreground">
              {t('mita-teams:planRoles')}
            </div>
            <div className="grid gap-1.5">
              {plan.roleAssignments.map((role) => (
                <div
                  key={role.roleId}
                  className="rounded-md border bg-muted/20 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{role.name}</span>
                    {role.model && (
                      <span className="truncate text-xs text-muted-foreground">
                        {role.model}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {role.assignment}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!isApproved && (
          <div className="grid gap-2">
            <Textarea
              rows={4}
              value={revision}
              placeholder={t('mita-teams:planRevisionPlaceholder')}
              onChange={(event) => setRevision(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={!canSubmitRevision}
              onClick={() => {
                if (!canSubmitRevision) return
                onRevise?.(revision.trim())
                setRevision('')
              }}
            >
              {t('mita-teams:submitPlanRevision')}
            </Button>
          </div>
        )}

        {!isApproved && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() => onApprove?.()}
            >
              <CheckCircle2 className="size-4" />
              {t('mita-teams:approvePlan')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function shouldCollapseMessage(content: string) {
  const text = content.trim()
  return text.split('\n').length > 5 || text.length > 360
}

function isRoleFailureMessage(content: string) {
  return /(?:角色(?:运行|私聊)?失败|role .*failed|runtime failed|No output generated|stream for errors)/i.test(
    content
  )
}

function CollapsibleMessageText({
  content,
  className,
  roleMentions,
}: {
  content: string
  className?: string
  roleMentions?: RoleMentionTarget[]
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const collapsible = shouldCollapseMessage(content)
  const displayContent = content.trim() || t('mita-teams:streamingMessage')
  const mentionById = useMemo(
    () => new Map((roleMentions ?? []).map((role) => [role.id, role])),
    [roleMentions]
  )
  const renderedContent = useMemo(
    () => linkifyRoleMentions(displayContent, roleMentions ?? []),
    [displayContent, roleMentions]
  )
  const markdownComponents = useMemo<
    ComponentProps<typeof RenderMarkdown>['components']
  >(() => {
    if (mentionById.size === 0) return undefined

    return {
      a: ({ href, children }) => {
        const roleId = roleIdFromMentionHref(href)
        if (!roleId) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="wrap-anywhere font-medium text-primary underline"
            >
              {children}
            </a>
          )
        }

        const role = mentionById.get(roleId)
        return (
          <span
            data-testid="mita-role-mention"
            className="inline-flex max-w-full translate-y-[-1px] items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary align-baseline"
            title={role?.label}
          >
            <span
              className={cn('size-1.5 shrink-0 rounded-full', role?.color)}
            />
            <span className="min-w-0 truncate">{children}</span>
          </span>
        )
      },
    }
  }, [mentionById])

  return (
    <div>
      <RenderMarkdown
        content={renderedContent}
        isAnimating={false}
        components={markdownComponents}
        className={cn(
          'text-sm leading-6 [&_a]:break-words [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-sm [&_h5]:text-sm [&_h6]:text-sm [&_li]:mb-1 [&_ol]:mb-2 [&_p]:mb-2 [&_ul]:mb-2',
          collapsible && !expanded && 'line-clamp-5',
          className
        )}
      />
      {collapsible && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t('mita-teams:collapseMessage')
            : t('mita-teams:expandMessage')}
        </Button>
      )}
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
      {stream.map((message) => {
        const isUserMessage = message.role !== 'assistant'
        const isFailure = isRoleFailureMessage(message.content)

        return (
          <div
            key={message.id}
            className={cn('flex', isUserMessage ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[min(44rem,92%)] rounded-lg border px-3 py-2',
                isUserMessage ? 'bg-primary/10' : 'bg-card',
                isFailure && 'border-destructive/30 bg-destructive/5'
              )}
            >
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      isUserMessage ? 'bg-primary' : role.color
                    )}
                  />
                  <span className="truncate">
                    {isUserMessage ? t('mita-teams:you') : roleName}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-2">
                  {!isUserMessage && (
                    <MessageModelBadge model={message.model} role={role} />
                  )}
                  <span>{displayTime(message.createdAt)}</span>
                </span>
              </div>
              <CollapsibleMessageText
                content={message.content}
                className={cn(isFailure && 'text-destructive')}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TeamTimeline({ events }: { events: MitaTeamsTeamEvent[] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const visibleEvents = [...events]
    .sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt))
    .slice(-40)
  const shouldFold = visibleEvents.length > 5
  const olderCount = Math.max(visibleEvents.length - 5, 0)
  const renderedEvents =
    shouldFold && !expanded ? visibleEvents.slice(-5) : visibleEvents

  if (visibleEvents.length === 0) return null

  return (
    <div className="mb-4 rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <GitBranch className="size-3.5" />
        {t('mita-teams:teamTimeline')}
      </div>
      <div className="space-y-2">
        {shouldFold && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t('mita-teams:timelineHideOlder')
              : t('mita-teams:timelineShowOlder', { count: olderCount })}
          </Button>
        )}
        {renderedEvents.map((event, index) => (
          <div
            key={event.id}
            className="flex gap-2 text-xs leading-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
            style={{
              animationDelay: `${index * 110}ms`,
              animationFillMode: 'both',
            }}
          >
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
  const roleMentionTargets = useMemo(
    () => buildRoleMentionTargets(roles, t),
    [roles, t]
  )
  const roleMessages = roles
    .flatMap((role) => {
      const roleName = localizedRoleName(role, t)
      return (runtime.roleStates[role.id]?.stream ?? [])
        .filter((message) => streamBelongsToChannel(message, channelId))
        .map((message) => ({ role, roleName, message }))
    })
    .sort(
      (a, b) =>
        new Date(a.message.createdAt).getTime() -
        new Date(b.message.createdAt).getTime()
    )
    .slice(-32)

  if (roleMessages.length === 0) return null

  return (
    <div className="mb-4 space-y-3">
      {roleMessages.map(({ role, roleName, message }) => {
        const isHostMessage = message.role !== 'assistant'
        const isFailure = isRoleFailureMessage(message.content)
        const speakerName = isHostMessage ? t('mita-teams:host') : roleName

        return (
          <div key={message.id} className="flex justify-start">
            <div
              className={cn(
                'max-w-[min(44rem,92%)] rounded-lg border px-3 py-2',
                isHostMessage ? 'bg-muted/35' : 'bg-card',
                isFailure && 'border-destructive/30 bg-destructive/5'
              )}
            >
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      isHostMessage ? 'bg-primary' : role.color
                    )}
                  />
                  <span className="truncate">{speakerName}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-2">
                  {!isHostMessage && (
                    <MessageModelBadge model={message.model} role={role} />
                  )}
                  <span>{displayTime(message.createdAt)}</span>
                </span>
              </div>
              <CollapsibleMessageText
                content={message.content}
                className={cn(isFailure && 'text-destructive')}
                roleMentions={isHostMessage ? roleMentionTargets : undefined}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RuntimeActivityIndicator({
  roles,
  runtime,
  isRuntimeBusy,
}: {
  roles: MitaTeamsRoleConfig[]
  runtime: MitaTeamsConfig['runtime']
  isRuntimeBusy?: boolean
}) {
  const { t } = useTranslation()
  const activeRoleIds = runtime.run?.activeRoleIds ?? []
  const activeRoleNames = activeRoleIds
    .map((roleId) => {
      const role = roles.find((item) => item.id === roleId)
      return role ? localizedRoleName(role, t) : roleId
    })
    .filter(Boolean)
  const shouldShow = isRuntimeBusy || runtime.run?.status === 'running'

  if (!shouldShow) return null

  const label = activeRoleNames.length
    ? t('mita-teams:runtimeRunningRole', {
        role: activeRoleNames.slice(0, 2).join(', '),
      })
    : runtime.run?.status === 'running'
      ? t('mita-teams:runtimeThinking')
      : t('mita-teams:runtimeRunning')

  return (
    <div className="mb-4 flex justify-start">
      <div className="inline-flex max-w-[min(44rem,92%)] items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span>{label}</span>
      </div>
    </div>
  )
}

function OrchestratorProgressCard({
  runtime,
}: {
  runtime: MitaTeamsConfig['runtime']
}) {
  const { t } = useTranslation()
  const hasDecision = Boolean(runtime.run?.lastDecision)
  const hasPlan = Boolean(runtime.planDraft)
  const steps = [
    {
      id: 'understanding',
      label: t('mita-teams:orchestratorProgressUnderstanding'),
      done: hasDecision || hasPlan,
      active: !hasDecision && !hasPlan,
    },
    {
      id: 'planning',
      label: t('mita-teams:orchestratorProgressPlanning'),
      done: hasPlan,
      active: hasDecision && !hasPlan,
    },
    {
      id: 'finalizing',
      label: t('mita-teams:orchestratorProgressFinalizing'),
      done: hasPlan,
      active: hasDecision && !hasPlan,
    },
  ]

  return (
    <div className="mb-4 rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-primary" />
        <div className="text-sm font-medium">
          {t('mita-teams:orchestratorProgressTitle')}
        </div>
      </div>
      <div className="grid gap-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              'flex items-center gap-2 text-sm',
              step.done || step.active
                ? 'text-foreground'
                : 'text-muted-foreground'
            )}
          >
            <FloatingDots muted={!step.done && !step.active} />
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

type WorkspaceInspectorContentProps = {
  activeTemplate: (typeof MITA_TEAMS_TASK_TEMPLATES)[number]
  channelRoles: MitaTeamsRoleConfig[]
  config: MitaTeamsConfig
  runtime: MitaTeamsConfig['runtime']
  setupLocked: boolean
  taskText: string
  setTaskTemplate: (taskTemplateId: MitaTeamsTaskTemplateId) => void
  setMode: (mode: MitaTeamsMode) => void
}

function useResponsiveInspectorSheetState() {
  const [open, setOpen] = useState(false)
  const hasPersistentInspector = useMediaQuery('(min-width: 1280px)')

  useEffect(() => {
    if (hasPersistentInspector) {
      setOpen(false)
    }
  }, [hasPersistentInspector])

  return { open, setOpen }
}

function WorkspaceInspectorContent({
  activeTemplate,
  channelRoles,
  config,
  runtime,
  setupLocked,
  taskText,
  setTaskTemplate,
  setMode,
}: WorkspaceInspectorContentProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-lg border bg-muted/20 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <CircleDot className="size-3.5" />
          {t('mita-teams:goal')}
        </div>
        <p className="text-sm leading-5">{taskText}</p>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <Target className="size-3.5" />
          {t('mita-teams:template')}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-between gap-2 px-2 py-2 text-left"
              disabled={setupLocked}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">
                  {localizedTaskTemplateLabel(
                    activeTemplate.id,
                    activeTemplate.label,
                    t
                  )}
                </span>
                <span className="mt-0.5 block line-clamp-2 whitespace-normal text-[11px] font-normal text-muted-foreground">
                  {localizedTaskTemplateDescription(
                    activeTemplate.id,
                    activeTemplate.description,
                    t
                  )}
                </span>
              </span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {MITA_TEAMS_TASK_TEMPLATES.map((template) => (
              <DropdownMenuItem
                key={template.id}
                className="flex-col items-start gap-1"
                disabled={setupLocked}
                onClick={() => {
                  if (setupLocked) return
                  setTaskTemplate(template.id)
                }}
              >
                <span className="text-xs font-medium">
                  {localizedTaskTemplateLabel(template.id, template.label, t)}
                </span>
                <span className="line-clamp-2 text-[11px] text-muted-foreground">
                  {localizedTaskTemplateDescription(
                    template.id,
                    template.description,
                    t
                  )}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
              disabled={setupLocked}
              onClick={() => {
                if (setupLocked) return
                setMode(mode.id)
              }}
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
                  <span className={cn('mt-1 size-2.5 rounded-full', role.color)} />
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
                    {t(
                      `mita-teams:${roleStatusLabel(state?.status ?? 'idle')}`
                    )}
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
          <ListChecks className="size-3.5" />
          {t('mita-teams:taskBoard')}
        </div>
        <TaskBoard tasks={runtime.tasks} roles={config.roles} />
      </section>

      <section className="rounded-lg border bg-background p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <FileText className="size-3.5" />
          {t('mita-teams:artifacts')}
        </div>
        <ArtifactsList artifacts={runtime.artifacts} />
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
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div className="rounded-md bg-muted/30 px-2 py-1.5">
            <div>{t('mita-teams:roundsUsed')}</div>
            <div className="text-xs font-medium text-foreground">
              {runtime.run?.currentRound ?? 0}
            </div>
          </div>
          <div className="rounded-md bg-muted/30 px-2 py-1.5">
            <div>{t('mita-teams:roleCalls')}</div>
            <div className="text-xs font-medium text-foreground">
              {runtime.run?.callCount ?? 0}
            </div>
          </div>
          <div className="rounded-md bg-muted/30 px-2 py-1.5">
            <div>{t('mita-teams:elapsed')}</div>
            <div className="text-xs font-medium text-foreground">
              {displayDuration(runtime.run?.durationMs)}
            </div>
          </div>
          <div className="rounded-md bg-muted/30 px-2 py-1.5">
            <div>{t('mita-teams:tokenUsage')}</div>
            <div className="text-xs font-medium text-foreground">
              {runtime.run?.usage?.totalTokens ?? t('mita-teams:reserved')}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function WorkspaceInspectorSheet({
  trigger,
  ...contentProps
}: WorkspaceInspectorContentProps & { trigger: ReactNode }) {
  const { t } = useTranslation()
  const { open, setOpen } = useResponsiveInspectorSheetState()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-[min(26rem,92vw)] gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b p-4">
          <SheetTitle>{t('mita-teams:workspaceOverview')}</SheetTitle>
          <SheetDescription className="sr-only">
            {contentProps.taskText}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <WorkspaceInspectorContent {...contentProps} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function WorkspaceInspectorRail(props: WorkspaceInspectorContentProps) {
  const { t } = useTranslation()
  const label = t('mita-teams:workspaceOverview')
  const { open, setOpen } = useResponsiveInspectorSheetState()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <aside className="hidden w-12 shrink-0 flex-col items-center rounded-lg border bg-card px-1.5 py-2 lg:flex xl:hidden">
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground hover:text-foreground"
            aria-label={label}
            title={label}
          >
            <ListChecks className="size-4" />
          </Button>
        </SheetTrigger>
      </aside>
      <SheetContent side="right" className="w-[min(26rem,92vw)] gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b p-4">
          <SheetTitle>{t('mita-teams:workspaceOverview')}</SheetTitle>
          <SheetDescription className="sr-only">
            {props.taskText}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <WorkspaceInspectorContent {...props} />
        </div>
      </SheetContent>
    </Sheet>
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
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-72 overflow-y-auto"
      >
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
                      <ProvidersAvatar
                        provider={{ provider: option.provider }}
                      />
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
  onArchive,
}: {
  role: MitaTeamsRoleConfig
  modelOptions: ModelOption[]
  onBack: () => void
  onUpdate: (
    roleId: MitaTeamsRoleId,
    patch: Partial<MitaTeamsRoleConfig>
  ) => void
  onSelectModel: (roleId: MitaTeamsRoleId, option: ModelOption) => void
  onArchive: (roleId: MitaTeamsRoleId) => void
}) {
  const { t } = useTranslation()
  const roleName = localizedRoleName(role, t)
  const canArchive = role.id !== MITA_TEAMS_ORCHESTRATOR_ROLE_ID

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
            onChange={(event) =>
              onUpdate(role.id, { name: event.target.value })
            }
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
                  role.color === color.value &&
                    'ring-2 ring-primary ring-offset-2'
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

        <section className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t('mita-teams:permissions')}
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full justify-between text-xs font-normal"
              >
                <span>
                  {t(`mita-teams:${permissionLabel(role.permission)}`)}
                </span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(['read', 'tools', 'write'] as const).map((permission) => (
                <DropdownMenuItem
                  key={permission}
                  className="gap-2"
                  onClick={() => onUpdate(role.id, { permission })}
                >
                  <ShieldCheck className="size-3.5 text-muted-foreground" />
                  {t(`mita-teams:${permissionLabel(permission)}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        {canArchive && (
          <section className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full justify-start gap-2 text-xs text-muted-foreground"
              onClick={() => onArchive(role.id)}
            >
              <Archive className="size-3.5" />
              {t('mita-teams:archiveRole')}
            </Button>
          </section>
        )}
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
  onTextResponse,
  onPlanApprove,
  onPlanRevise,
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
  const isRoleConfig = config.workspaceView === 'role-config'
  const isRoleChat = config.workspaceView === 'role-chat'
  const activePrivateRoleState = activeRoleState
    ? {
        ...activeRoleState,
        stream: activeRoleState.stream.filter((message) => !message.channelId),
      }
    : undefined
  const setupLocked = isSetupLocked(config, messages)
  const pendingChoice =
    runtime.userChoiceRequest?.status === 'pending' &&
    runtime.userChoiceRequest.kind !== 'plan_approval'
      ? runtime.userChoiceRequest
      : undefined
  const reviewPlan =
    runtime.approvedPlan ??
    (runtime.phase === 'awaiting_plan_approval' ? runtime.planDraft : undefined)
  const activeChannel =
    config.channels.find((channel) => channel.id === config.activeChannel) ??
    config.channels[0] ??
    MITA_TEAMS_CHANNELS[0]
  const showThreadMessages = activeChannel.id === MITA_TEAMS_TASK_CHANNEL_ID
  const showChannelDiscussion = !showThreadMessages
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
  const channelHasRoleMessages = useMemo(
    () =>
      channelRoles.some(
        (role) =>
          role.enabled &&
          (runtime.roleStates[role.id]?.stream ?? []).some((message) =>
            streamBelongsToChannel(message, activeChannel.id)
          )
      ),
    [activeChannel.id, channelRoles, runtime.roleStates]
  )
  const hasActiveRoleCalls = (runtime.run?.activeRoleIds ?? []).length > 0
  const showOrchestratorProgress =
    showThreadMessages &&
    !isRoleChat &&
    !runtime.approvedPlan &&
    !reviewPlan &&
    !hasActiveRoleCalls &&
    (isRuntimeBusy || runtime.run?.status === 'running')
  const hasMessages =
    isRoleChat
      ? (activePrivateRoleState?.stream.length ?? 0) > 0
      : (showThreadMessages && messages.length > 0) ||
        (showChannelDiscussion && channelEvents.length > 0) ||
        (showChannelDiscussion && channelHasRoleMessages) ||
        showOrchestratorProgress ||
        (showThreadMessages && Boolean(reviewPlan)) ||
        (showThreadMessages && Boolean(pendingChoice))
  const taskText = compactTaskText(messages, thread?.title)
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
      const nextConfig = patchMitaTeamsConfig(config, {
        roles: config.roles.map((role) =>
          role.id === roleId ? { ...role, ...patch } : role
        ),
      })
      onConfigChange(
        markMitaTeamsRoleUserEdit(
          nextConfig,
          roleId,
          Object.keys(patch) as MitaTeamsRoleEditableField[]
        )
      )
    },
    [config, onConfigChange]
  )

  const archiveRole = useCallback(
    (roleId: MitaTeamsRoleId) => {
      if (roleId === MITA_TEAMS_ORCHESTRATOR_ROLE_ID) return
      onConfigChange(archiveMitaTeamsRole(config, roleId))
    },
    [config, onConfigChange]
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
    (mode: MitaTeamsMode) => {
      if (setupLocked) return
      patchConfig({ mode })
    },
    [patchConfig, setupLocked]
  )

  const setRoundLimit = useCallback(
    (roundLimit: number) => patchConfig({ roundLimit }),
    [patchConfig]
  )

  const setTaskTemplate = useCallback(
    (taskTemplateId: MitaTeamsTaskTemplateId) => {
      if (setupLocked) return
      const template = MITA_TEAMS_TASK_TEMPLATES.find(
        (item) => item.id === taskTemplateId
      )
      patchConfig({
        taskTemplateId,
        mode: template?.defaultMode ?? config.mode,
      })
    },
    [config.mode, patchConfig, setupLocked]
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
  const activeTemplate =
    MITA_TEAMS_TASK_TEMPLATES.find(
      (template) => template.id === config.taskTemplateId
    ) ?? MITA_TEAMS_TASK_TEMPLATES[0]
  const mainTitle = isRoleConfig
    ? t('mita-teams:configureRole', { role: activeRoleName })
    : isRoleChat
      ? activeRoleName
      : activeChannelLabel
  const mainSubtitle =
    isRoleChat || isRoleConfig
      ? activeRoleDescription
      : activeChannelDescription
  const headerRoles =
    isRoleChat || isRoleConfig ? enabledRoles : channelEnabledRoles
  const inspectorContentProps: WorkspaceInspectorContentProps = {
    activeTemplate,
    channelRoles,
    config,
    runtime,
    setupLocked,
    taskText,
    setTaskTemplate,
    setMode,
  }

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
                      <span
                        className={cn('size-2.5 rounded-full', role.color)}
                      />
                      <span>{localizedRoleName(role, t)}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="space-y-2">
            {enabledRoles.map((role) => {
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
                aria-label={t('mita-teams:decreaseRounds')}
                onClick={() =>
                  setRoundLimit(Math.max(1, config.roundLimit - 1))
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
                aria-label={t('mita-teams:increaseRounds')}
                onClick={() =>
                  setRoundLimit(Math.min(10, config.roundLimit + 1))
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
                <RuntimeStatusBadge status={runStatus} isBusy={isRuntimeBusy} />
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
                      <span
                        className={cn('size-2.5 rounded-full', role.color)}
                      />
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
            <WorkspaceInspectorSheet
              {...inspectorContentProps}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full lg:hidden"
                  aria-label={t('mita-teams:workspaceOverview')}
                >
                  <ListChecks className="size-4" />
                </Button>
              }
            />
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
              onArchive={archiveRole}
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
                            className={cn(
                              'size-3 rounded-full',
                              activeRole.color
                            )}
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
                {isRoleChat ? (
                  <>
                    <RoleStreamPanel
                      role={activeRole}
                      state={activePrivateRoleState}
                    />
                    <RuntimeTokenUsageSummary usage={runtime.run?.usage} />
                  </>
                ) : (
                  <>
                    {showChannelDiscussion && (
                      <TeamTimeline events={channelEvents} />
                    )}
                    {showThreadMessages && messageItems}
                    {showOrchestratorProgress && (
                      <OrchestratorProgressCard runtime={runtime} />
                    )}
                    {showThreadMessages && pendingChoice && !isRoleChat && (
                      <ChoiceRequestCard
                        choice={pendingChoice}
                        disabled={isRuntimeBusy}
                        onSelect={onChoiceSelect}
                        onTextResponse={onTextResponse}
                      />
                    )}
                    {showThreadMessages && reviewPlan && !isRoleChat && (
                      <PlanReviewCard
                        plan={reviewPlan}
                        disabled={isRuntimeBusy}
                        onApprove={onPlanApprove}
                        onRevise={onPlanRevise}
                      />
                    )}
                    {showChannelDiscussion && (
                      <ChannelRoleStreams
                        roles={channelEnabledRoles}
                        runtime={runtime}
                        channelId={activeChannel.id}
                      />
                    )}
                    {!showOrchestratorProgress && (
                      <RuntimeActivityIndicator
                        roles={config.roles}
                        runtime={runtime}
                        isRuntimeBusy={isRuntimeBusy}
                      />
                    )}
                    <RuntimeTokenUsageSummary usage={runtime.run?.usage} />
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

      <WorkspaceInspectorRail {...inspectorContentProps} />

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
            <Target className="size-3.5" />
            {t('mita-teams:template')}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-between gap-2 px-2 py-2 text-left"
                disabled={setupLocked}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {localizedTaskTemplateLabel(
                      activeTemplate.id,
                      activeTemplate.label,
                      t
                    )}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 whitespace-normal text-[11px] font-normal text-muted-foreground">
                    {localizedTaskTemplateDescription(
                      activeTemplate.id,
                      activeTemplate.description,
                      t
                    )}
                  </span>
                </span>
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {MITA_TEAMS_TASK_TEMPLATES.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  className="flex-col items-start gap-1"
                  disabled={setupLocked}
                  onClick={() => {
                    if (setupLocked) return
                    setTaskTemplate(template.id)
                  }}
                >
                  <span className="text-xs font-medium">
                    {localizedTaskTemplateLabel(template.id, template.label, t)}
                  </span>
                  <span className="line-clamp-2 text-[11px] text-muted-foreground">
                    {localizedTaskTemplateDescription(
                      template.id,
                      template.description,
                      t
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
                disabled={setupLocked}
                onClick={() => {
                  if (setupLocked) return
                  setMode(mode.id)
                }}
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
                <div
                  key={role.id}
                  className="rounded-lg border bg-background p-3"
                >
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
                      {t(
                        `mita-teams:${roleStatusLabel(state?.status ?? 'idle')}`
                      )}
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
            <ListChecks className="size-3.5" />
            {t('mita-teams:taskBoard')}
          </div>
          <TaskBoard tasks={runtime.tasks} roles={config.roles} />
        </section>

        <section className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <FileText className="size-3.5" />
            {t('mita-teams:artifacts')}
          </div>
          <ArtifactsList artifacts={runtime.artifacts} />
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
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <div className="rounded-md bg-muted/30 px-2 py-1.5">
              <div>{t('mita-teams:roundsUsed')}</div>
              <div className="text-xs font-medium text-foreground">
                {runtime.run?.currentRound ?? 0}
              </div>
            </div>
            <div className="rounded-md bg-muted/30 px-2 py-1.5">
              <div>{t('mita-teams:roleCalls')}</div>
              <div className="text-xs font-medium text-foreground">
                {runtime.run?.callCount ?? 0}
              </div>
            </div>
            <div className="rounded-md bg-muted/30 px-2 py-1.5">
              <div>{t('mita-teams:elapsed')}</div>
              <div className="text-xs font-medium text-foreground">
                {displayDuration(runtime.run?.durationMs)}
              </div>
            </div>
            <div className="rounded-md bg-muted/30 px-2 py-1.5">
              <div>{t('mita-teams:tokenUsage')}</div>
              <div className="text-xs font-medium text-foreground">
                {runtime.run?.usage?.totalTokens ?? t('mita-teams:reserved')}
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>
  )
})
