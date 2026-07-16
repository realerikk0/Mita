import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'

import { BiyanTeamsWorkspace } from '@/containers/BiyanTeamsWorkspace'
import {
  createDefaultBiyanTeamsConfig,
  normalizeBiyanTeamsConfig,
  type BiyanTeamsConfig,
} from '@/types/biyan-teams'

const h = vi.hoisted(() => {
  const translations: Record<string, string> = {
    'biyan-teams:workspaceOverview': 'Workspace overview',
    'biyan-teams:channels': 'Channels',
    'biyan-teams:roles': 'Roles',
    'biyan-teams:goal': 'Goal',
    'biyan-teams:template': 'Template',
    'biyan-teams:mode': 'Mode',
    'biyan-teams:taskBoard': 'Task board',
    'biyan-teams:artifacts': 'Artifacts',
    'biyan-teams:projectMemory': 'Project memory',
    'biyan-teams:budget': 'Budget',
    'biyan-teams:roundsUsed': 'Rounds',
    'biyan-teams:rounds': 'Rounds',
    'biyan-teams:decreaseRounds': 'Decrease rounds',
    'biyan-teams:increaseRounds': 'Increase rounds',
    'biyan-teams:roleCalls': 'Calls',
    'biyan-teams:elapsed': 'Elapsed',
    'biyan-teams:tokenUsage': 'Tokens',
    'biyan-teams:tokenUsageDetail': 'Prompt {{prompt}} · Completion {{completion}}',
    'biyan-teams:reserved': 'Reserved',
    'biyan-teams:waitingForOwner': 'Choose one option to continue',
    'biyan-teams:planReviewTitle': 'Review plan',
    'biyan-teams:planReviewDescription': 'Approve the plan before the team starts.',
    'biyan-teams:planApprovedDescription': 'Approved plan. The team is executing it.',
    'biyan-teams:approvePlan': 'Approve and continue',
    'biyan-teams:modifyPlan': 'Modify plan',
    'biyan-teams:submitPlanRevision': 'Submit plan revision',
    'biyan-teams:planRevisionPlaceholder': 'Describe what should change.',
    'biyan-teams:planScope': 'Scope',
    'biyan-teams:planAcceptanceCriteria': 'Acceptance criteria',
    'biyan-teams:planTasks': 'Tasks',
    'biyan-teams:planRoles': 'Planned roles',
    'biyan-teams:keepRoleEditsTitle': 'Keep role edits?',
    'biyan-teams:freeTextPlaceholder': 'Type your answer.',
    'biyan-teams:submitFreeText': 'Submit answer',
    'biyan-teams:statusIdle': 'Idle',
    'biyan-teams:statusWaiting': 'Waiting',
    'biyan-teams:statusRunning': 'Running',
    'biyan-teams:statusCompleted': 'Done',
    'biyan-teams:statusFailed': 'Failed',
    'biyan-teams:statusStopped': 'Stopped',
    'biyan-teams:tasksEmpty': 'No tasks yet',
    'biyan-teams:artifactsEmpty': 'No artifacts yet',
    'biyan-teams:memoryEmpty': 'No memory yet',
    'biyan-teams:teamTimeline': 'Team timeline',
    'biyan-teams:timelineShowOlder': 'Show {{count}} older events',
    'biyan-teams:timelineHideOlder': 'Hide older events',
    'biyan-teams:emptyTitle': 'Start with one concrete goal',
    'biyan-teams:emptyDescription': 'Describe the goal.',
    'biyan-teams:addChannel': 'Add channel',
    'biyan-teams:addRole': 'Add role',
    'biyan-teams:noChannelTemplates': 'All channels added',
    'biyan-teams:noRoleTemplates': 'All roles added',
    'biyan-teams:unassigned': 'Unassigned',
    'biyan-teams:directChat': 'Direct chat',
    'biyan-teams:configureRole': 'Configure {{role}}',
    'biyan-teams:roundLimit': '{{count}} rounds',
    'biyan-teams:memoryVersion': 'Memory v{{version}}',
    'biyan-teams:roleChatTitle': 'Chat with {{role}}',
    'biyan-teams:owner': 'Owner',
    'biyan-teams:host': 'Host',
    'biyan-teams:you': 'You',
    'biyan-teams:expandMessage': 'Show more',
    'biyan-teams:collapseMessage': 'Show less',
    'biyan-teams:streamingMessage': 'Generating...',
    'biyan-teams:runtimeThinking': 'Thinking...',
    'biyan-teams:runtimeRunning': 'Running...',
    'biyan-teams:runtimeRunningRole': 'Running {{role}}...',
    'biyan-teams:orchestratorProgressTitle': 'Host progress',
    'biyan-teams:orchestratorProgressUnderstanding': 'Understanding request',
    'biyan-teams:orchestratorProgressPlanning': 'Preparing next step',
    'biyan-teams:orchestratorProgressFinalizing': 'Finalizing plan',
    'biyan-teams:streamEmpty': 'No stream yet.',
    'biyan-teams:backToTeam': 'Back to team',
    'biyan-teams:roleName': 'Role name',
    'biyan-teams:roleColor': 'Role color',
    'biyan-teams:roleDescription': 'Role description',
    'biyan-teams:rolePrompt': 'Role prompt',
    'biyan-teams:roleModel': 'Role model',
    'biyan-teams:archiveRole': 'Archive role',
    'biyan-teams:retryRun': 'Retry',
    'biyan-teams:recoveryFailedTitle': 'The run stopped on an error',
    'biyan-teams:recoveryStoppedTitle': 'The run was stopped',
    'biyan-teams:onboardingStep1': 'Describe your goal',
    'biyan-teams:onboardingExample1': 'Compare two options',
    'biyan-teams:silentCollabNote': 'Collaboration is running quietly.',
    'biyan-teams:valueTitle': 'What the team did for you',
    'biyan-teams:valuePerspectives': 'Brought together {{count}} perspectives',
    'biyan-teams:valueChallenged': 'Stress-tested by a skeptic',
    'biyan-teams:valueCheckpoints': 'Logged {{count}} checkpoints',
    'biyan-teams:eventTitle.role_completed': '{{role}} finished',
    'biyan-teams:eventTitle.run_completed': 'Run completed',
    'biyan-teams:permissions': 'Permissions',
    'biyan-teams:permissionRead': 'Read',
    'biyan-teams:permissionTools': 'Tools',
    'biyan-teams:permissionWrite': 'Write',
    'biyan-teams:taskStatusTodo': 'To confirm',
    'biyan-teams:taskStatusResearching': 'Researching',
    'biyan-teams:taskStatusImplementing': 'Implementing',
    'biyan-teams:taskStatusReviewing': 'To review',
    'biyan-teams:taskStatusDone': 'Done',
    'biyan-teams:artifactTypeDecision': 'Decision',
    'biyan-teams:artifactTypeRisk': 'Risk',
    'biyan-teams:artifactTypeArtifact': 'Artifact',
    'biyan-teams:artifactTypeTestResult': 'Test',
    'biyan-teams:artifactTypeFinalDraft': 'Draft',
    'biyan-teams:templatesById.code.label': 'Code',
    'biyan-teams:templatesById.code.description': 'Code work',
    'biyan-teams:templatesById.research.label': 'Research',
    'biyan-teams:templatesById.research.description': 'Research work',
    'biyan-teams:templatesById.product.label': 'Product',
    'biyan-teams:templatesById.product.description': 'Product work',
    'biyan-teams:templatesById.writing.label': 'Writing',
    'biyan-teams:templatesById.writing.description': 'Writing work',
    'biyan-teams:templatesById.debugging.label': 'Debugging',
    'biyan-teams:templatesById.debugging.description': 'Debugging work',
    'biyan-teams:modesById.relay.label': 'Relay',
    'biyan-teams:modesById.relay.description': 'Relay flow',
    'biyan-teams:modesById.roundtable.label': 'Roundtable',
    'biyan-teams:modesById.roundtable.description': 'Roundtable flow',
    'biyan-teams:modesById.debate.label': 'Debate',
    'biyan-teams:modesById.debate.description': 'Debate flow',
    'biyan-teams:modesById.red-team.label': 'Red team',
    'biyan-teams:modesById.red-team.description': 'Red team flow',
    'biyan-teams:modesById.silent.label': 'Silent',
    'biyan-teams:modesById.silent.description': 'Silent flow',
    'biyan-teams:channelsById.task.label': 'Current task',
    'biyan-teams:channelsById.task.description': 'Main task room',
    'biyan-teams:channelsById.research.label': 'Research',
    'biyan-teams:channelsById.research.description': 'Research room',
    'biyan-teams:rolesById.orchestrator.name': 'Orchestrator',
    'biyan-teams:rolesById.orchestrator.label': 'Host',
    'biyan-teams:rolesById.orchestrator.description': 'Coordinate the team.',
    'biyan-teams:rolesById.researcher.name': 'Researcher',
    'biyan-teams:rolesById.researcher.label': 'Research',
    'biyan-teams:rolesById.researcher.description': 'Researches evidence.',
    'common:noModels': 'No models',
  }

  return {
    translations,
    providerState: {
      providers: [],
    },
  }
})

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const template = h.translations[key] ?? key
      return template.replace(/\{\{(\w+)\}\}/g, (_match, variable) =>
        options?.[variable] !== undefined
          ? String(options[variable])
          : `{{${variable}}}`
      )
    },
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector?: (state: typeof h.providerState) => unknown) =>
    typeof selector === 'function' ? selector(h.providerState) : h.providerState,
}))

vi.mock('@/containers/ProvidersAvatar', () => ({
  default: ({ provider }: { provider: { provider: string } }) => (
    <span data-testid="provider-avatar">{provider.provider}</span>
  ),
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock

type TestMediaQueryListener = (event: { matches: boolean; media: string }) => void

function installMatchMediaController() {
  const originalMatchMedia = window.matchMedia
  const matchesByQuery = new Map<string, boolean>()
  const listenersByQuery = new Map<string, Set<TestMediaQueryListener>>()

  const getListeners = (query: string) => {
    let listeners = listenersByQuery.get(query)
    if (!listeners) {
      listeners = new Set<TestMediaQueryListener>()
      listenersByQuery.set(query, listeners)
    }
    return listeners
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const listeners = getListeners(query)

      return {
        matches: matchesByQuery.get(query) ?? false,
        media: query,
        onchange: null,
        addListener: vi.fn((listener: TestMediaQueryListener) => {
          listeners.add(listener)
        }),
        removeListener: vi.fn((listener: TestMediaQueryListener) => {
          listeners.delete(listener)
        }),
        addEventListener: vi.fn(
          (event: string, listener: TestMediaQueryListener) => {
            if (event === 'change') {
              listeners.add(listener)
            }
          }
        ),
        removeEventListener: vi.fn(
          (event: string, listener: TestMediaQueryListener) => {
            if (event === 'change') {
              listeners.delete(listener)
            }
          }
        ),
        dispatchEvent: vi.fn(),
      }
    }),
  })

  return {
    restore: () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: originalMatchMedia,
      })
    },
    setMatches: (query: string, matches: boolean) => {
      matchesByQuery.set(query, matches)
      getListeners(query).forEach((listener) =>
        listener({ matches, media: query })
      )
    },
  }
}

function createConfig(): BiyanTeamsConfig {
  const config = createDefaultBiyanTeamsConfig({
    provider: 'jingxing',
    id: 'claude-sonnet-4-6',
  })
  const now = '2026-05-29T00:00:00.000Z'

  return {
    ...config,
    runtime: {
      ...config.runtime,
      run: {
        id: 'run-1',
        status: 'waiting-for-user' as const,
        currentRound: 1,
        maxRounds: 5,
        callCount: 2,
        activeRoleIds: [],
        startedAt: now,
        updatedAt: now,
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      },
      projectMemory: {
        ...config.runtime.projectMemory,
        summary: 'The team is planning the launch.',
        milestones: ['Scope accepted'],
      },
      tasks: [
        {
          id: 'task-1',
          title: 'Review launch plan',
          status: 'reviewing' as const,
          roleId: 'orchestrator',
          channelId: 'task',
          createdAt: now,
          updatedAt: now,
        },
      ],
      artifacts: [
        {
          id: 'artifact-1',
          type: 'decision' as const,
          title: 'Launch scope',
          summary: 'Keep the beta narrow.',
          createdAt: now,
          updatedAt: now,
        },
      ],
      userChoiceRequest: {
        id: 'choice-1',
        question: 'Pick a launch scope.',
        options: [
          { id: 'small', label: 'Small beta' },
          { id: 'full', label: 'Full launch' },
        ],
        status: 'pending' as const,
        createdAt: now,
      },
    },
  }
}

function createUnlockedConfig(): BiyanTeamsConfig {
  return createDefaultBiyanTeamsConfig({
    provider: 'jingxing',
    id: 'claude-sonnet-4-6',
  })
}

function renderWorkspace({
  config = createConfig(),
  inputArea = <button type="button">Composer</button>,
  messageItems = <div>Messages</div>,
  messages = [],
  isRuntimeBusy = false,
  onChoiceSelect = vi.fn(),
  onPlanApprove = vi.fn(),
  onPlanRevise = vi.fn(),
  onTextResponse = vi.fn(),
  onRetry = vi.fn(),
  onUseExample = vi.fn(),
  onConfigChange = vi.fn(),
}: {
  config?: BiyanTeamsConfig
  inputArea?: ReactNode
  messageItems?: ReactNode
  messages?: ComponentProps<typeof BiyanTeamsWorkspace>['messages']
  isRuntimeBusy?: boolean
  onChoiceSelect?: (optionId: string) => void
  onPlanApprove?: () => void
  onPlanRevise?: (revision: string) => void
  onTextResponse?: (text: string) => void
  onRetry?: () => void
  onUseExample?: (goal: string) => void
  onConfigChange?: (config: BiyanTeamsConfig) => void
} = {}) {
  render(
    <BiyanTeamsWorkspace
      thread={{ id: 'thread-1', title: 'Launch plan' } as Thread}
      config={config}
      messages={messages}
      messageItems={messageItems}
      inputArea={inputArea}
      isRuntimeBusy={isRuntimeBusy}
      onChoiceSelect={onChoiceSelect}
      onPlanApprove={onPlanApprove}
      onPlanRevise={onPlanRevise}
      onTextResponse={onTextResponse}
      onRetry={onRetry}
      onUseExample={onUseExample}
      onConfigChange={onConfigChange}
    />
  )

  return {
    config,
    onChoiceSelect,
    onPlanApprove,
    onPlanRevise,
    onTextResponse,
    onRetry,
    onUseExample,
    onConfigChange,
  }
}

function withResearchChannel(
  base: BiyanTeamsConfig,
  role = base.roles[0]
): BiyanTeamsConfig {
  return {
    ...base,
    activeChannel: 'research',
    channels: [
      ...base.channels,
      {
        id: 'research',
        label: 'Research',
        description: 'Research room',
        roleIds: [role.id],
      },
    ],
  }
}

describe('BiyanTeamsWorkspace', () => {
  it('opens the workspace overview sheet from the small-screen header button', async () => {
    const user = userEvent.setup()
    const { onConfigChange } = renderWorkspace()

    const overviewButton = screen
      .getAllByRole('button', { name: 'Workspace overview' })
      .find((button) => button.classList.contains('lg:hidden'))
    expect(overviewButton).toBeDefined()
    expect(overviewButton).toHaveClass('lg:hidden')

    await user.click(overviewButton!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Task board')).toBeInTheDocument()
    expect(within(dialog).getByText('Review launch plan')).toBeInTheDocument()
    expect(within(dialog).getByText('Launch scope')).toBeInTheDocument()
    expect(within(dialog).getByText('15')).toBeInTheDocument()

    await user.click(within(dialog).getByText('Debate'))
    expect(onConfigChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'debate' })
    )
  })

  it('shows token usage at the bottom of the team output', () => {
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        run: base.runtime.run
          ? {
              ...base.runtime.run,
              usage: {
                promptTokens: 800,
                completionTokens: 434,
                totalTokens: 1234,
              },
            }
          : undefined,
      },
    }

    renderWorkspace({ config })

    expect(screen.getByText('1,234 tokens')).toBeInTheDocument()
    expect(screen.getByText('Prompt 800 · Completion 434')).toBeInTheDocument()
  })

  it('offers a one-click retry when a run ends on a failure', async () => {
    const user = userEvent.setup()
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        run: base.runtime.run
          ? { ...base.runtime.run, status: 'failed', error: 'Provider timed out' }
          : undefined,
        // No pending owner choice -> a true dead-end the card recovers from.
        userChoiceRequest: undefined,
      },
    }
    const onRetry = vi.fn()
    renderWorkspace({ config, onRetry })

    expect(
      screen.getByText('The run stopped on an error')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('onboards the empty state with steps and example goals', async () => {
    const user = userEvent.setup()
    const onUseExample = vi.fn()
    renderWorkspace({ config: createUnlockedConfig(), onUseExample })

    expect(screen.getByText('Describe your goal')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Compare two options' })
    )
    expect(onUseExample).toHaveBeenCalledWith('Compare two options')
  })

  it('silent mode hides role chatter behind a quiet note', () => {
    const config = normalizeBiyanTeamsConfig(
      {
        enabled: true,
        mode: 'silent',
        activeChannel: 'discussion',
        activeRoleId: 'orchestrator',
        roles: [
          {
            id: 'analyst',
            name: 'Analyst',
            label: 'A',
            description: 'd',
            prompt: 'p',
            color: 'bg-violet-600',
            permission: 'tools',
            enabled: true,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Task',
            description: '',
            roleIds: ['orchestrator'],
          },
          {
            id: 'discussion',
            label: 'Discussion',
            description: '',
            roleIds: ['orchestrator', 'analyst'],
          },
        ],
        runtime: {
          version: 1,
          roleStates: {
            analyst: {
              roleId: 'analyst',
              status: 'done',
              stream: [
                {
                  id: 'm1',
                  turnId: 't1',
                  roleId: 'analyst',
                  channelId: 'discussion',
                  role: 'assistant',
                  content: 'SECRET_INTERNAL_CHATTER',
                  createdAt: '2026-06-08T00:00:00.000Z',
                },
              ],
            },
          },
        },
      },
      { provider: 'openai', id: 'gpt-5' }
    )!

    renderWorkspace({ config })

    expect(
      screen.queryByText('SECRET_INTERNAL_CHATTER')
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Collaboration is running quietly.')
    ).toBeInTheDocument()
  })

  it('surfaces a value strip with what the team did after a completed run', () => {
    const now = '2026-05-29T00:00:00.000Z'
    const config = normalizeBiyanTeamsConfig(
      {
        enabled: true,
        activeChannel: 'task',
        activeRoleId: 'orchestrator',
        roles: [
          {
            id: 'analyst',
            name: 'Analyst',
            label: 'A',
            description: 'd',
            prompt: 'p',
            color: 'bg-violet-600',
            permission: 'tools',
            enabled: true,
          },
          {
            id: 'skeptic',
            name: 'Skeptic Reviewer',
            label: 'S',
            description: 'd',
            prompt: 'p',
            color: 'bg-red-600',
            permission: 'read',
            enabled: true,
          },
        ],
        runtime: {
          version: 1,
          run: {
            id: 'run-x',
            status: 'completed',
            currentRound: 2,
            maxRounds: 5,
            callCount: 3,
            activeRoleIds: [],
            startedAt: now,
            updatedAt: now,
            completedAt: now,
          },
          milestones: [
            {
              id: 'm1',
              title: 'Checkpoint',
              createdAt: now,
              sourceRoleId: 'orchestrator',
            },
          ],
          roleStates: {
            analyst: {
              roleId: 'analyst',
              status: 'done',
              stream: [
                {
                  id: 'a1',
                  turnId: 't1',
                  roleId: 'analyst',
                  channelId: 'task',
                  role: 'assistant',
                  content: 'Analysis result',
                  createdAt: now,
                },
              ],
            },
            skeptic: {
              roleId: 'skeptic',
              status: 'done',
              stream: [
                {
                  id: 's1',
                  turnId: 't1',
                  roleId: 'skeptic',
                  channelId: 'task',
                  role: 'assistant',
                  content: 'Risk found',
                  createdAt: now,
                },
              ],
            },
          },
        },
      },
      { provider: 'openai', id: 'gpt-5' }
    )!

    renderWorkspace({
      config,
      messages: [
        {
          id: 'final-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Final deliverable' }],
        },
      ] as ComponentProps<typeof BiyanTeamsWorkspace>['messages'],
    })

    expect(screen.getByText('What the team did for you')).toBeInTheDocument()
    expect(
      screen.getByText('Brought together 2 perspectives')
    ).toBeInTheDocument()
    expect(screen.getByText('Stress-tested by a skeptic')).toBeInTheDocument()
    expect(screen.getByText('Logged 1 checkpoints')).toBeInTheDocument()
  })

  it('localizes team-timeline event titles by type', () => {
    const now = '2026-06-08T00:00:00.000Z'
    const config = normalizeBiyanTeamsConfig(
      {
        enabled: true,
        activeChannel: 'discussion',
        activeRoleId: 'orchestrator',
        roles: [
          {
            id: 'analyst',
            name: 'Analyst',
            label: 'A',
            description: 'd',
            prompt: 'p',
            color: 'bg-violet-600',
            permission: 'tools',
            enabled: true,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Task',
            description: '',
            roleIds: ['orchestrator'],
          },
          {
            id: 'discussion',
            label: 'Discussion',
            description: '',
            roleIds: ['orchestrator', 'analyst'],
          },
        ],
        runtime: {
          version: 1,
          teamEvents: [
            {
              id: 'e1',
              type: 'role_completed',
              title: 'RAW_ENGLISH_TITLE_A',
              roleId: 'analyst',
              channelId: 'discussion',
              createdAt: now,
            },
            {
              id: 'e2',
              type: 'run_completed',
              title: 'RAW_ENGLISH_TITLE_B',
              channelId: 'discussion',
              createdAt: now,
            },
          ],
        },
      },
      { provider: 'openai', id: 'gpt-5' }
    )!

    renderWorkspace({ config })

    // Localized by type (role name interpolated), not the stored English title.
    const timeline = screen.getByText('Team timeline').closest('.rounded-lg')
    expect(timeline).toBeTruthy()
    expect(
      within(timeline as HTMLElement).getByText('Analyst finished')
    ).toBeInTheDocument()
    expect(
      within(timeline as HTMLElement).getByText('Run completed')
    ).toBeInTheDocument()
    expect(screen.queryByText('RAW_ENGLISH_TITLE_A')).not.toBeInTheDocument()
  })

  it('allows choosing template and mode before the first team run starts', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    renderWorkspace({ config: createUnlockedConfig(), onConfigChange })

    const overviewButton = screen
      .getAllByRole('button', { name: 'Workspace overview' })
      .find((button) => button.classList.contains('lg:hidden'))
    expect(overviewButton).toBeDefined()

    await user.click(overviewButton!)
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByText('Debate'))
    await waitFor(() =>
      expect(onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'debate' })
      )
    )
  })

  it('exposes a slim inspector rail for middle-width layouts', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    const railButton = screen
      .getAllByRole('button', { name: 'Workspace overview' })
      .find((button) => button.closest('aside')?.classList.contains('lg:flex'))
    expect(railButton).toBeDefined()
    expect(railButton!.closest('aside')).toHaveClass('lg:flex')
    expect(railButton!.closest('aside')).toHaveClass('xl:hidden')
    expect(railButton!.closest('aside')?.querySelectorAll('button')).toHaveLength(
      1
    )

    await user.click(railButton!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Project memory')).toBeInTheDocument()
    expect(within(dialog).getByText('Scope accepted')).toBeInTheDocument()
  })

  it('closes the responsive inspector sheet once the persistent inspector is available', async () => {
    const media = installMatchMediaController()
    const user = userEvent.setup()

    try {
      renderWorkspace()

      const railButton = screen
        .getAllByRole('button', { name: 'Workspace overview' })
        .find((button) =>
          button.closest('aside')?.classList.contains('lg:flex')
        )
      expect(railButton).toBeDefined()

      await user.click(railButton!)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()

      act(() => {
        media.setMatches('(min-width: 1280px)', true)
      })

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
    } finally {
      media.restore()
    }
  })

  it('disables owner choice actions while the runtime is busy', () => {
    const onChoiceSelect = vi.fn()
    renderWorkspace({ isRuntimeBusy: true, onChoiceSelect })

    const option = screen.getByRole('button', { name: 'Small beta' })
    expect(option).toBeDisabled()

    fireEvent.click(option)
    expect(onChoiceSelect).not.toHaveBeenCalled()
  })

  it('submits a free-text owner clarification', async () => {
    const user = userEvent.setup()
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        userChoiceRequest: {
          id: 'text-1',
          kind: 'free_text',
          question: 'What deadline should the team optimize for?',
          options: [],
          status: 'pending',
          createdAt: '2026-06-08T00:00:00.000Z',
        },
      },
    }
    const onTextResponse = vi.fn()

    renderWorkspace({ config, onTextResponse })

    await user.type(screen.getByPlaceholderText('Type your answer.'), 'Friday')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(onTextResponse).toHaveBeenCalledWith('Friday')
  })

  it('renders a plan review card and approves the plan from the task channel', async () => {
    const user = userEvent.setup()
    const now = '2026-06-08T00:00:00.000Z'
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        phase: 'awaiting_plan_approval',
        planDraft: {
          id: 'plan-1',
          version: 1,
          status: 'draft',
          goal: 'Ship a safer release workflow',
          summary: 'Inspect, implement, and verify the release path.',
          scope: ['Release workflow only'],
          acceptanceCriteria: ['Owner approves before execution'],
          tasks: [
            {
              id: 'task-1',
              title: 'Inspect release workflow',
              roleId: 'orchestrator',
            },
          ],
          roleAssignments: [
            {
              roleId: 'orchestrator',
              name: 'Orchestrator',
              assignment: 'Own the plan gate.',
              model: 'jingxing / claude-sonnet-4-6',
            },
          ],
          executionOrder: ['Inspect release workflow'],
          createdAt: now,
          updatedAt: now,
        },
      },
    }
    const onPlanApprove = vi.fn()

    renderWorkspace({ config, onPlanApprove })

    expect(screen.getByText('Review plan')).toBeInTheDocument()
    expect(screen.getByText('Ship a safer release workflow')).toBeInTheDocument()
    expect(screen.getByText('Owner approves before execution')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve and continue' }))
    expect(onPlanApprove).toHaveBeenCalledTimes(1)
  })

  it('shows thread messages before the plan review and hides duplicate plan approval choices', () => {
    const now = '2026-06-08T00:00:00.000Z'
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        phase: 'awaiting_plan_approval',
        planDraft: {
          id: 'plan-1',
          version: 1,
          status: 'draft',
          goal: 'Review the owner request',
          summary: 'Plan from the current owner request.',
          scope: ['Task channel'],
          acceptanceCriteria: ['Owner approves once'],
          tasks: [{ id: 'task-1', title: 'Review', roleId: 'orchestrator' }],
          roleAssignments: [
            {
              roleId: 'orchestrator',
              name: 'Orchestrator',
              assignment: 'Coordinate.',
            },
          ],
          executionOrder: ['Review'],
          createdAt: now,
          updatedAt: now,
        },
        userChoiceRequest: {
          id: 'plan-choice-1',
          kind: 'plan_approval',
          question: 'Review and approve the Biyan Teams plan.',
          options: [
            { id: 'approve', label: 'Approve and continue' },
            { id: 'revise', label: 'Modify plan' },
          ],
          status: 'pending',
          createdAt: now,
        },
      },
    }

    renderWorkspace({
      config,
      messageItems: <div data-testid="owner-message">Owner request</div>,
    })

    const ownerMessage = screen.getByTestId('owner-message')
    const planTitle = screen.getByText('Review plan')

    expect(
      ownerMessage.compareDocumentPosition(planTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Approve and continue' }))
      .toHaveLength(1)
    expect(screen.queryByText('Choose one option to continue')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Review and approve the Biyan Teams plan.')
    ).not.toBeInTheDocument()
  })

  it('shows a host progress card below the owner message while the runtime is busy', () => {
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        phase: 'running',
        userChoiceRequest: undefined,
        run: {
          ...base.runtime.run!,
          status: 'running',
          lastDecision: undefined,
        },
      },
    }

    renderWorkspace({
      config,
      isRuntimeBusy: true,
      messageItems: <div data-testid="owner-message">Owner request</div>,
    })

    const ownerMessage = screen.getByTestId('owner-message')
    const progressTitle = screen.getByText('Host progress')

    expect(
      ownerMessage.compareDocumentPosition(progressTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('Understanding request')).toBeInTheDocument()
    expect(screen.getByText('Preparing next step')).toBeInTheDocument()
    expect(screen.getByText('Finalizing plan')).toBeInTheDocument()
    expect(screen.getAllByTestId('progress-floating-dots')).toHaveLength(3)
  })

  it('shows the plan revision text area without first toggling edit mode', async () => {
    const user = userEvent.setup()
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        phase: 'awaiting_plan_approval',
        planDraft: {
          id: 'plan-1',
          version: 1,
          status: 'draft',
          goal: 'Draft onboarding plan',
          summary: 'Plan first.',
          scope: ['Onboarding'],
          acceptanceCriteria: ['Reviewed'],
          tasks: [{ id: 'task-1', title: 'Draft', roleId: 'orchestrator' }],
          roleAssignments: [
            {
              roleId: 'orchestrator',
              name: 'Orchestrator',
              assignment: 'Coordinate.',
            },
          ],
          executionOrder: ['Draft'],
          createdAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
      },
    }
    const onPlanRevise = vi.fn()

    renderWorkspace({ config, onPlanRevise })

    expect(
      screen.getByPlaceholderText('Describe what should change.')
    ).toBeInTheDocument()
    await user.type(
      screen.getByPlaceholderText('Describe what should change.'),
      'Add a reviewer role.'
    )
    await user.click(screen.getByRole('button', { name: 'Submit plan revision' }))

    expect(onPlanRevise).toHaveBeenCalledWith('Add a reviewer role.')
  })

  it('keeps the approved plan body visible after approval', () => {
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...base,
      runtime: {
        ...base.runtime,
        phase: 'running',
        approvedPlan: {
          id: 'plan-1',
          version: 1,
          status: 'approved',
          goal: 'Draft onboarding plan',
          summary: 'Plan first.',
          scope: ['Onboarding'],
          acceptanceCriteria: ['Reviewed'],
          tasks: [{ id: 'task-1', title: 'Draft', roleId: 'orchestrator' }],
          roleAssignments: [
            {
              roleId: 'orchestrator',
              name: 'Orchestrator',
              assignment: 'Coordinate.',
            },
          ],
          executionOrder: ['Draft'],
          createdAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z',
          approvedAt: '2026-06-08T00:01:00.000Z',
        },
      },
    }

    renderWorkspace({ config })

    expect(screen.getByText('Draft onboarding plan')).toBeInTheDocument()
    expect(screen.getByText('Plan first.')).toBeInTheDocument()
    expect(screen.getByText('Approved plan. The team is executing it.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve and continue' })
    ).not.toBeInTheDocument()
  })

  it('persists role-config navigation through onConfigChange', () => {
    const onConfigChange = vi.fn()
    renderWorkspace({ onConfigChange })

    fireEvent.click(
      screen.getByRole('button', { name: 'Configure Orchestrator' })
    )

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRoleId: 'orchestrator',
        workspaceView: 'role-config',
      })
    )
  })

  it('marks role prompt edits as user role edits', () => {
    const onConfigChange = vi.fn()
    const config = {
      ...createConfig(),
      workspaceView: 'role-config' as const,
      activeRoleId: 'orchestrator',
    }

    renderWorkspace({ config, onConfigChange })

    fireEvent.change(screen.getByDisplayValue(config.roles[0].prompt), {
      target: { value: 'Use the owner-approved plan before executing.' },
    })

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          roleUserEdits: expect.objectContaining({
            orchestrator: expect.objectContaining({
              fields: expect.arrayContaining(['prompt']),
            }),
          }),
        }),
      })
    )
  })

  it('archives a non-host role from role configuration and removes it from channels', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    const base = createConfig()
    const strayRole = {
      ...base.roles[0],
      id: 'data_scout',
      name: 'Data Scout',
      label: 'Data',
      description: 'Unexpected fallback role.',
      prompt: 'Collect market data.',
      color: 'bg-sky-600',
      enabled: true,
    }
    const config: BiyanTeamsConfig = {
      ...base,
      activeChannel: 'research',
      activeRoleId: strayRole.id,
      workspaceView: 'role-config',
      roles: [...base.roles, strayRole],
      channels: [
        ...base.channels,
        {
          id: 'research',
          label: 'Research',
          description: 'Research room',
          roleIds: [strayRole.id],
        },
      ],
    }
    renderWorkspace({ config, onConfigChange })

    await user.click(screen.getByRole('button', { name: 'Archive role' }))

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRoleId: 'orchestrator',
        workspaceView: 'team-chat',
        roles: expect.arrayContaining([
          expect.objectContaining({ id: 'data_scout', enabled: false }),
        ]),
        channels: expect.arrayContaining([
          expect.objectContaining({ id: 'research', roleIds: [] }),
        ]),
      })
    )
  })

  it('hides archived roles from channel roster when saved membership is stale', () => {
    const base = createConfig()
    const archivedRole = {
      ...base.roles[0],
      id: 'data_scout',
      name: 'Data Scout',
      label: 'Data',
      description: 'Unexpected fallback role.',
      prompt: 'Collect market data.',
      color: 'bg-sky-600',
      enabled: false,
    }
    const config: BiyanTeamsConfig = {
      ...base,
      activeChannel: 'research',
      roles: [...base.roles, archivedRole],
      channels: [
        ...base.channels,
        {
          id: 'research',
          label: 'Research',
          description: 'Research room',
          roleIds: [archivedRole.id],
        },
      ],
    }

    renderWorkspace({ config })

    expect(screen.queryByText('Data Scout')).not.toBeInTheDocument()
  })

  it('renders the team timeline and channel discussion in readable order outside current task', () => {
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const role = base.roles[0]
    const config: BiyanTeamsConfig = {
      ...withResearchChannel(base, role),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        teamEvents: [
          {
            id: 'event-1',
            type: 'role_called',
            title: 'Team started',
            detail: 'Coordinator prepared the room.',
            roleId: role.id,
            channelId: 'research',
            createdAt: now,
          },
        ],
        roleStates: {
          ...base.runtime.roleStates,
          [role.id]: {
            ...base.runtime.roleStates[role.id]!,
            stream: [
              {
                id: 'host-call',
                turnId: 'turn-1',
                roleId: role.id,
                channelId: 'research',
                role: 'user',
                content: 'Call the role with a scoped instruction.',
                createdAt: now,
              },
              {
                id: 'role-answer',
                turnId: 'turn-1',
                roleId: role.id,
                channelId: 'research',
                role: 'assistant',
                content: 'Role answer in the channel.',
                createdAt: '2026-05-29T00:01:00.000Z',
              },
            ],
          },
        },
      },
    }

    renderWorkspace({
      config,
      messageItems: <div data-testid="owner-message">Owner query</div>,
    })

    const timeline = screen.getByText('Team timeline')
    const roleAnswer = screen.getByText('Role answer in the channel.')

    expect(
      timeline.compareDocumentPosition(roleAnswer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('Host')).toBeInTheDocument()
    expect(screen.queryByTestId('owner-message')).not.toBeInTheDocument()
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
  })

  it('keeps thread messages out of non-task channel discussions', () => {
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const role = base.roles[0]
    const config: BiyanTeamsConfig = {
      ...withResearchChannel(base, role),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        teamEvents: [
          {
            id: 'research-event',
            type: 'role_called',
            title: 'Research started',
            detail: 'Analyst entered the research room.',
            roleId: role.id,
            channelId: 'research',
            createdAt: now,
          },
        ],
        roleStates: {
          ...base.runtime.roleStates,
          [role.id]: {
            ...base.runtime.roleStates[role.id]!,
            stream: [
              {
                id: 'research-answer',
                turnId: 'turn-1',
                roleId: role.id,
                channelId: 'research',
                role: 'assistant',
                content: 'Research channel answer.',
                createdAt: now,
              },
            ],
          },
        },
      },
    }

    renderWorkspace({
      config,
      messageItems: <div data-testid="thread-message">Thread deliverable</div>,
    })

    expect(screen.getAllByText('Research started').length).toBeGreaterThan(0)
    expect(screen.getByText('Research channel answer.')).toBeInTheDocument()
    expect(screen.queryByTestId('thread-message')).not.toBeInTheDocument()
  })

  it('keeps role discussion out of the current task delivery room', () => {
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const role = base.roles[0]
    const config: BiyanTeamsConfig = {
      ...base,
      activeChannel: 'task',
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        roleStates: {
          ...base.runtime.roleStates,
          [role.id]: {
            ...base.runtime.roleStates[role.id]!,
            stream: [
              {
                id: 'task-channel-discussion',
                turnId: 'turn-1',
                roleId: role.id,
                channelId: 'task',
                role: 'assistant',
                content: 'Internal role discussion should stay out of delivery.',
                createdAt: now,
              },
            ],
          },
        },
      },
    }

    renderWorkspace({
      config,
      messageItems: <div data-testid="final-deliverable">Final deliverable</div>,
    })

    expect(screen.getByTestId('final-deliverable')).toBeInTheDocument()
    expect(
      screen.queryByText('Internal role discussion should stay out of delivery.')
    ).not.toBeInTheDocument()
  })

  it('sorts team timeline events chronologically from top to bottom', () => {
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...withResearchChannel(base),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        teamEvents: [
          {
            id: 'late',
            type: 'milestone',
            title: 'Late event',
            channelId: 'research',
            createdAt: '2026-05-29T00:02:00.000Z',
          },
          {
            id: 'early',
            type: 'run_started',
            title: 'Early event',
            channelId: 'research',
            createdAt: '2026-05-29T00:00:00.000Z',
          },
          {
            id: 'middle',
            type: 'decision',
            title: 'Middle event',
            channelId: 'research',
            createdAt: '2026-05-29T00:01:00.000Z',
          },
        ],
      },
    }

    renderWorkspace({ config })

    const timeline = screen.getByText('Team timeline').closest('.rounded-lg')
    expect(timeline).toBeTruthy()

    const early = within(timeline as HTMLElement).getByText('Early event')
    const middle = within(timeline as HTMLElement).getByText('Middle event')
    const late = within(timeline as HTMLElement).getByText('Late event')

    expect(
      early.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      middle.compareDocumentPosition(late) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('folds older timeline events above the latest five entries', async () => {
    const user = userEvent.setup()
    const base = createConfig()
    const config: BiyanTeamsConfig = {
      ...withResearchChannel(base),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        teamEvents: Array.from({ length: 7 }, (_item, index) => ({
          id: `event-${index + 1}`,
          type: 'decision' as const,
          title: `Event ${index + 1}`,
          channelId: 'research',
          createdAt: `2026-05-29T00:0${index}:00.000Z`,
        })),
      },
    }

    renderWorkspace({ config })

    const timeline = screen.getByText('Team timeline').closest('.rounded-lg')
    expect(timeline).toBeTruthy()

    expect(within(timeline as HTMLElement).queryByText('Event 1')).not.toBeInTheDocument()
    expect(within(timeline as HTMLElement).queryByText('Event 2')).not.toBeInTheDocument()
    expect(within(timeline as HTMLElement).getByText('Event 3')).toBeInTheDocument()
    expect(within(timeline as HTMLElement).getByText('Event 7')).toBeInTheDocument()

    await user.click(
      within(timeline as HTMLElement).getByRole('button', {
        name: 'Show 2 older events',
      })
    )

    const first = within(timeline as HTMLElement).getByText('Event 1')
    const last = within(timeline as HTMLElement).getByText('Event 7')
    expect(
      first.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await user.click(
      within(timeline as HTMLElement).getByRole('button', {
        name: 'Hide older events',
      })
    )

    expect(within(timeline as HTMLElement).queryByText('Event 1')).not.toBeInTheDocument()
  })

  it('shows the runtime activity indicator after channel role messages', () => {
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const role = base.roles[0]
    const config: BiyanTeamsConfig = {
      ...withResearchChannel(base, role),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        run: {
          ...base.runtime.run!,
          status: 'running',
          activeRoleIds: [role.id],
          updatedAt: now,
        },
        roleStates: {
          ...base.runtime.roleStates,
          [role.id]: {
            ...base.runtime.roleStates[role.id]!,
            stream: [
              {
                id: 'role-answer',
                turnId: 'turn-1',
                roleId: role.id,
                channelId: 'research',
                role: 'assistant',
                content: 'Role answer before status.',
                createdAt: now,
              },
            ],
          },
        },
      },
    }

    renderWorkspace({ config, isRuntimeBusy: true })

    const roleAnswer = screen.getByText('Role answer before status.')
    const status = screen.getByText('Running Orchestrator...')

    expect(
      roleAnswer.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('collapses long channel role messages and toggles them open', async () => {
    const user = userEvent.setup()
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const role = base.roles[0]
    const longAnswer = [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
    ].join('\n')
    const config: BiyanTeamsConfig = {
      ...withResearchChannel(base, role),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        roleStates: {
          ...base.runtime.roleStates,
          [role.id]: {
            ...base.runtime.roleStates[role.id]!,
            stream: [
              {
                id: 'long-answer',
                turnId: 'turn-1',
                roleId: role.id,
                channelId: 'research',
                role: 'assistant',
                content: longAnswer,
                createdAt: now,
              },
            ],
          },
        },
      },
    }

    renderWorkspace({ config })

    const toggle = screen.getByRole('button', { name: 'Show more' })
    const messageBlock = toggle.closest('div')
    const text = messageBlock?.querySelector('.markdown')
    expect(text).toBeTruthy()
    expect(text).toHaveClass('line-clamp-5')

    await user.click(toggle)
    await waitFor(() => {
      expect(
        within(messageBlock!).getByRole('button', { name: 'Show less' })
      ).toBeInTheDocument()
      const expandedText = messageBlock?.querySelector('.markdown')
      expect(expandedText).not.toHaveClass('line-clamp-5')
    })
  })

  it('renders channel role messages as markdown', async () => {
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const role = base.roles[0]
    const markdownAnswer =
      '**MRVL summary**\n\n### Latest quarter\n\n- Revenue: **$2.4B**\n- Source: [Marvell IR](https://investor.marvell.com)'
    const config: BiyanTeamsConfig = {
      ...withResearchChannel(base, role),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        roleStates: {
          ...base.runtime.roleStates,
          [role.id]: {
            ...base.runtime.roleStates[role.id]!,
            stream: [
              {
                id: 'markdown-answer',
                turnId: 'turn-1',
                roleId: role.id,
                channelId: 'research',
                role: 'assistant',
                content: markdownAnswer,
                createdAt: now,
              },
            ],
          },
        },
      },
    }

    renderWorkspace({ config })

    await screen.findByText(/MRVL summary/)
    const markdownContainer = Array.from(
      document.querySelectorAll('.markdown')
    ).find((node) => node.textContent?.includes('MRVL summary'))

    expect(markdownContainer).toBeTruthy()
    expect(
      markdownContainer?.querySelector('[data-streamdown="strong"]')
    ).toHaveTextContent('MRVL summary')
    expect(markdownContainer?.querySelector('h3')).toHaveTextContent(
      'Latest quarter'
    )
    expect(markdownContainer?.querySelector('a')).toHaveAttribute(
      'href',
      'https://investor.marvell.com/'
    )
    expect(screen.queryByText('**MRVL summary**')).not.toBeInTheDocument()
  })

  it('highlights role names in host channel messages as labels', async () => {
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const host = base.roles[0]
    const dataScout = {
      ...host,
      id: 'data-scout',
      name: 'Data Scout',
      label: 'Data Scout',
      description: 'Collects market facts.',
      prompt: 'Collect market facts.',
      color: 'bg-sky-600',
      permission: 'read' as const,
      enabled: true,
    }
    const marketAnalyst = {
      ...host,
      id: 'market-analyst',
      name: 'Market Analyst',
      label: 'Market Analyst',
      description: 'Analyzes market data.',
      prompt: 'Analyze market data.',
      color: 'bg-emerald-600',
      permission: 'read' as const,
      enabled: true,
    }
    const hostInstruction =
      '基于 Data Scout 在 #research 收集的事实，请 Market Analyst 产出结构化分析。'
    const config: BiyanTeamsConfig = {
      ...base,
      activeChannel: 'research',
      roles: [host, dataScout, marketAnalyst],
      channels: [
        ...base.channels,
        {
          id: 'research',
          label: 'Research',
          description: 'Research room',
          roleIds: [dataScout.id, marketAnalyst.id],
        },
      ],
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        roleStates: {
          ...base.runtime.roleStates,
          [dataScout.id]: {
            roleId: dataScout.id,
            status: 'idle',
            memory: {
              roleId: dataScout.id,
              version: 0,
              summary: '',
              facts: [],
              decisions: [],
              openQuestions: [],
              workingNotes: [],
              updatedAt: now,
            },
            stream: [
              {
                id: 'host-instruction',
                turnId: 'turn-1',
                roleId: dataScout.id,
                channelId: 'research',
                role: 'user',
                content: hostInstruction,
                createdAt: now,
              },
            ],
          },
          [marketAnalyst.id]: {
            roleId: marketAnalyst.id,
            status: 'idle',
            memory: {
              roleId: marketAnalyst.id,
              version: 0,
              summary: '',
              facts: [],
              decisions: [],
              openQuestions: [],
              workingNotes: [],
              updatedAt: now,
            },
            stream: [],
          },
        },
      },
    }

    renderWorkspace({ config })

    const roleLabels = screen.getAllByTestId('biyan-role-mention')

    expect(roleLabels).toHaveLength(2)
    expect(roleLabels[0]).toHaveTextContent('Data Scout')
    expect(roleLabels[1]).toHaveTextContent('Market Analyst')
    expect(
      screen.queryByRole('link', { name: 'Data Scout' })
    ).not.toBeInTheDocument()
  })

  it('keeps role private chat separate from channel role streams', () => {
    const now = '2026-05-29T00:00:00.000Z'
    const base = createConfig()
    const role = base.roles[0]
    const config: BiyanTeamsConfig = {
      ...base,
      activeRoleId: role.id,
      workspaceView: 'role-chat',
      runtime: {
        ...base.runtime,
        roleStates: {
          ...base.runtime.roleStates,
          [role.id]: {
            ...base.runtime.roleStates[role.id]!,
            stream: [
              {
                id: 'private-user',
                turnId: 'private',
                roleId: role.id,
                role: 'user',
                content: 'private question',
                createdAt: now,
              },
              {
                id: 'private-assistant',
                turnId: 'private',
                roleId: role.id,
                role: 'assistant',
                content: 'private answer',
                createdAt: now,
              },
              {
                id: 'channel-assistant',
                turnId: 'channel',
                roleId: role.id,
                channelId: 'task',
                role: 'assistant',
                content: 'channel answer',
                createdAt: now,
              },
            ],
          },
        },
      },
    }

    renderWorkspace({ config })
    expect(screen.getByText('private answer')).toBeInTheDocument()
    expect(screen.queryByText('channel answer')).not.toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
  })
})
