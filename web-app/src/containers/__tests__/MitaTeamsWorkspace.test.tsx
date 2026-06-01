import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    'mita-teams:reserved': 'Reserved',
    'mita-teams:waitingForOwner': 'Choose one option to continue',
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
    'mita-teams:streamEmpty': 'No stream yet.',
    'mita-teams:backToTeam': 'Back to team',
    'mita-teams:roleName': 'Role name',
    'mita-teams:roleColor': 'Role color',
    'mita-teams:roleDescription': 'Role description',
    'mita-teams:rolePrompt': 'Role prompt',
    'mita-teams:roleModel': 'Role model',
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
  onConfigChange = vi.fn(),
}: {
  config?: MitaTeamsConfig
  inputArea?: ReactNode
  messageItems?: ReactNode
  messages?: ComponentProps<typeof MitaTeamsWorkspace>['messages']
  isRuntimeBusy?: boolean
  onChoiceSelect?: (optionId: string) => void
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
      onConfigChange={onConfigChange}
    />
  )

  return { config, onChoiceSelect, onConfigChange }
}

describe('MitaTeamsWorkspace', () => {
  it('exposes workspace overview controls for widths below the xl side panel', async () => {
    const user = userEvent.setup()
    const { onConfigChange } = renderWorkspace()

    const overviewButton = screen.getByRole('button', {
      name: 'Workspace overview',
    })
    expect(overviewButton).toHaveClass('xl:hidden')

    await user.click(overviewButton)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Task board')).toBeInTheDocument()
    expect(within(menu).getByText('Review launch plan')).toBeInTheDocument()
    expect(within(menu).getByText('Launch scope')).toBeInTheDocument()
    expect(within(menu).getByText('15')).toBeInTheDocument()
    expect(
      within(menu).getByRole('button', { name: 'Increase rounds' })
    ).toBeInTheDocument()

    await user.click(within(menu).getByText('Debate'))
    expect(onConfigChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'debate' })
    )
  })

  it('allows choosing template and mode before the first team run starts', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    renderWorkspace({ config: createUnlockedConfig(), onConfigChange })

    await user.click(
      screen.getByRole('button', {
        name: 'Workspace overview',
      })
    )
    const menu = await screen.findByRole('menu')

    await user.click(within(menu).getByText('Debate'))
    await waitFor(() =>
      expect(onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'debate' })
      )
    )
  })

  it('keeps setup actions reachable from the responsive overview menu', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    renderWorkspace({ onConfigChange })

    await user.click(
      screen.getByRole('button', {
        name: 'Workspace overview',
      })
    )
    const menu = await screen.findByRole('menu')

    await user.click(within(menu).getByText('Researcher'))
    await waitFor(() =>
      expect(onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({
          activeRoleId: 'researcher',
          workspaceView: 'role-config',
        })
      )
    )

    onConfigChange.mockClear()
    await user.click(
      screen.getByRole('button', {
        name: 'Workspace overview',
      })
    )
    const reopenedMenu = await screen.findByRole('menu')
    await user.click(
      within(reopenedMenu).getByRole('button', { name: 'Increase rounds' })
    )
    await waitFor(() =>
      expect(onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({ roundLimit: 6 })
      )
    )
  })

  it('disables owner choice actions while the runtime is busy', () => {
    const onChoiceSelect = vi.fn()
    renderWorkspace({ isRuntimeBusy: true, onChoiceSelect })

    const option = screen.getByRole('button', { name: 'Small beta' })
    expect(option).toBeDisabled()

    fireEvent.click(option)
    expect(onChoiceSelect).not.toHaveBeenCalled()
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
  })
})
