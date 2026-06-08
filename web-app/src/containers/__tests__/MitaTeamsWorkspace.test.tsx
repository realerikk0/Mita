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

import { MitaTeamsWorkspace } from '@/containers/MitaTeamsWorkspace'
import {
  createDefaultMitaTeamsConfig,
  type MitaTeamsConfig,
} from '@/types/mita-teams'

const h = vi.hoisted(() => {
  const translations: Record<string, string> = {
    'mita-teams:workspaceOverview': 'Workspace overview',
    'mita-teams:channels': 'Channels',
    'mita-teams:roles': 'Roles',
    'mita-teams:goal': 'Goal',
    'mita-teams:template': 'Template',
    'mita-teams:mode': 'Mode',
    'mita-teams:taskBoard': 'Task board',
    'mita-teams:artifacts': 'Artifacts',
    'mita-teams:projectMemory': 'Project memory',
    'mita-teams:budget': 'Budget',
    'mita-teams:roundsUsed': 'Rounds',
    'mita-teams:rounds': 'Rounds',
    'mita-teams:decreaseRounds': 'Decrease rounds',
    'mita-teams:increaseRounds': 'Increase rounds',
    'mita-teams:roleCalls': 'Calls',
    'mita-teams:elapsed': 'Elapsed',
    'mita-teams:tokenUsage': 'Tokens',
    'mita-teams:tokenUsageDetail': 'Prompt {{prompt}} · Completion {{completion}}',
    'mita-teams:reserved': 'Reserved',
    'mita-teams:waitingForOwner': 'Choose one option to continue',
    'mita-teams:planReviewTitle': 'Review plan',
    'mita-teams:planReviewDescription': 'Approve the plan before the team starts.',
    'mita-teams:planApprovedDescription': 'Approved plan. The team is executing it.',
    'mita-teams:approvePlan': 'Approve and continue',
    'mita-teams:modifyPlan': 'Modify plan',
    'mita-teams:submitPlanRevision': 'Submit plan revision',
    'mita-teams:planRevisionPlaceholder': 'Describe what should change.',
    'mita-teams:planScope': 'Scope',
    'mita-teams:planAcceptanceCriteria': 'Acceptance criteria',
    'mita-teams:planTasks': 'Tasks',
    'mita-teams:planRoles': 'Planned roles',
    'mita-teams:keepRoleEditsTitle': 'Keep role edits?',
    'mita-teams:freeTextPlaceholder': 'Type your answer.',
    'mita-teams:submitFreeText': 'Submit answer',
    'mita-teams:statusIdle': 'Idle',
    'mita-teams:statusWaiting': 'Waiting',
    'mita-teams:statusRunning': 'Running',
    'mita-teams:statusCompleted': 'Done',
    'mita-teams:statusFailed': 'Failed',
    'mita-teams:statusStopped': 'Stopped',
    'mita-teams:tasksEmpty': 'No tasks yet',
    'mita-teams:artifactsEmpty': 'No artifacts yet',
    'mita-teams:memoryEmpty': 'No memory yet',
    'mita-teams:teamTimeline': 'Team timeline',
    'mita-teams:timelineShowOlder': 'Show {{count}} older events',
    'mita-teams:timelineHideOlder': 'Hide older events',
    'mita-teams:emptyTitle': 'Start with one concrete goal',
    'mita-teams:emptyDescription': 'Describe the goal.',
    'mita-teams:addChannel': 'Add channel',
    'mita-teams:addRole': 'Add role',
    'mita-teams:noChannelTemplates': 'All channels added',
    'mita-teams:noRoleTemplates': 'All roles added',
    'mita-teams:unassigned': 'Unassigned',
    'mita-teams:directChat': 'Direct chat',
    'mita-teams:configureRole': 'Configure {{role}}',
    'mita-teams:roundLimit': '{{count}} rounds',
    'mita-teams:memoryVersion': 'Memory v{{version}}',
    'mita-teams:roleChatTitle': 'Chat with {{role}}',
    'mita-teams:owner': 'Owner',
    'mita-teams:host': 'Host',
    'mita-teams:you': 'You',
    'mita-teams:expandMessage': 'Show more',
    'mita-teams:collapseMessage': 'Show less',
    'mita-teams:streamingMessage': 'Generating...',
    'mita-teams:runtimeThinking': 'Thinking...',
    'mita-teams:runtimeRunning': 'Running...',
    'mita-teams:runtimeRunningRole': 'Running {{role}}...',
    'mita-teams:orchestratorProgressTitle': 'Host progress',
    'mita-teams:orchestratorProgressUnderstanding': 'Understanding request',
    'mita-teams:orchestratorProgressPlanning': 'Preparing next step',
    'mita-teams:orchestratorProgressFinalizing': 'Finalizing plan',
    'mita-teams:streamEmpty': 'No stream yet.',
    'mita-teams:backToTeam': 'Back to team',
    'mita-teams:roleName': 'Role name',
    'mita-teams:roleColor': 'Role color',
    'mita-teams:roleDescription': 'Role description',
    'mita-teams:rolePrompt': 'Role prompt',
    'mita-teams:roleModel': 'Role model',
    'mita-teams:archiveRole': 'Archive role',
    'mita-teams:permissions': 'Permissions',
    'mita-teams:permissionRead': 'Read',
    'mita-teams:permissionTools': 'Tools',
    'mita-teams:permissionWrite': 'Write',
    'mita-teams:taskStatusTodo': 'To confirm',
    'mita-teams:taskStatusResearching': 'Researching',
    'mita-teams:taskStatusImplementing': 'Implementing',
    'mita-teams:taskStatusReviewing': 'To review',
    'mita-teams:taskStatusDone': 'Done',
    'mita-teams:artifactTypeDecision': 'Decision',
    'mita-teams:artifactTypeRisk': 'Risk',
    'mita-teams:artifactTypeArtifact': 'Artifact',
    'mita-teams:artifactTypeTestResult': 'Test',
    'mita-teams:artifactTypeFinalDraft': 'Draft',
    'mita-teams:templatesById.code.label': 'Code',
    'mita-teams:templatesById.code.description': 'Code work',
    'mita-teams:templatesById.research.label': 'Research',
    'mita-teams:templatesById.research.description': 'Research work',
    'mita-teams:templatesById.product.label': 'Product',
    'mita-teams:templatesById.product.description': 'Product work',
    'mita-teams:templatesById.writing.label': 'Writing',
    'mita-teams:templatesById.writing.description': 'Writing work',
    'mita-teams:templatesById.debugging.label': 'Debugging',
    'mita-teams:templatesById.debugging.description': 'Debugging work',
    'mita-teams:modesById.relay.label': 'Relay',
    'mita-teams:modesById.relay.description': 'Relay flow',
    'mita-teams:modesById.roundtable.label': 'Roundtable',
    'mita-teams:modesById.roundtable.description': 'Roundtable flow',
    'mita-teams:modesById.debate.label': 'Debate',
    'mita-teams:modesById.debate.description': 'Debate flow',
    'mita-teams:modesById.red-team.label': 'Red team',
    'mita-teams:modesById.red-team.description': 'Red team flow',
    'mita-teams:modesById.silent.label': 'Silent',
    'mita-teams:modesById.silent.description': 'Silent flow',
    'mita-teams:channelsById.task.label': 'Current task',
    'mita-teams:channelsById.task.description': 'Main task room',
    'mita-teams:channelsById.research.label': 'Research',
    'mita-teams:channelsById.research.description': 'Research room',
    'mita-teams:rolesById.orchestrator.name': 'Orchestrator',
    'mita-teams:rolesById.orchestrator.label': 'Host',
    'mita-teams:rolesById.orchestrator.description': 'Coordinate the team.',
    'mita-teams:rolesById.researcher.name': 'Researcher',
    'mita-teams:rolesById.researcher.label': 'Research',
    'mita-teams:rolesById.researcher.description': 'Researches evidence.',
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

function createConfig(): MitaTeamsConfig {
  const config = createDefaultMitaTeamsConfig({
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

function createUnlockedConfig(): MitaTeamsConfig {
  return createDefaultMitaTeamsConfig({
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
  onConfigChange = vi.fn(),
}: {
  config?: MitaTeamsConfig
  inputArea?: ReactNode
  messageItems?: ReactNode
  messages?: ComponentProps<typeof MitaTeamsWorkspace>['messages']
  isRuntimeBusy?: boolean
  onChoiceSelect?: (optionId: string) => void
  onPlanApprove?: () => void
  onPlanRevise?: (revision: string) => void
  onTextResponse?: (text: string) => void
  onConfigChange?: (config: MitaTeamsConfig) => void
} = {}) {
  render(
    <MitaTeamsWorkspace
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
      onConfigChange={onConfigChange}
    />
  )

  return {
    config,
    onChoiceSelect,
    onPlanApprove,
    onPlanRevise,
    onTextResponse,
    onConfigChange,
  }
}

function withResearchChannel(
  base: MitaTeamsConfig,
  role = base.roles[0]
): MitaTeamsConfig {
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

describe('MitaTeamsWorkspace', () => {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
          question: 'Review and approve the Mita Teams plan.',
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
      screen.queryByText('Review and approve the Mita Teams plan.')
    ).not.toBeInTheDocument()
  })

  it('shows a host progress card below the owner message while the runtime is busy', () => {
    const base = createConfig()
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
      ...withResearchChannel(base),
      runtime: {
        ...base.runtime,
        userChoiceRequest: undefined,
        teamEvents: [
          {
            id: 'late',
            type: 'role_completed',
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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
    const config: MitaTeamsConfig = {
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

    const roleLabels = screen.getAllByTestId('mita-role-mention')

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
    const config: MitaTeamsConfig = {
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
