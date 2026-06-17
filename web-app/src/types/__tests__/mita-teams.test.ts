import { describe, expect, it } from 'vitest'

import {
  createDefaultMitaTeamsConfig,
  DEFAULT_MITA_TEAMS_ROLES,
  normalizeMitaTeamsConfig,
  renderMitaTeamsSystemInstructions,
} from '../mita-teams'

describe('mita teams metadata', () => {
  it('creates an orchestrator-first config from the selected thread model', () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'jingxing',
      id: 'gpt-5',
    })

    expect(config.enabled).toBe(true)
    expect(config.mode).toBe('relay')
    expect(config.taskTemplateId).toBe('code')
    expect(config.workspaceView).toBe('team-chat')
    expect(config.activeRoleId).toBe('orchestrator')
    expect(config.channels).toHaveLength(1)
    expect(config.channels[0].id).toBe('task')
    expect(config.channels[0].roleIds).toEqual(['orchestrator'])
    expect(config.roles).toHaveLength(1)
    expect(config.roles[0].id).toBe('orchestrator')
    expect(config.roles.every((role) => role.prompt.length > 0)).toBe(true)
    expect(config.roles.every((role) => role.provider === 'jingxing')).toBe(
      true
    )
    expect(config.roles.every((role) => role.modelId === 'gpt-5')).toBe(true)
    expect(config.runtime.projectMemory.version).toBe(0)
    expect(config.runtime.tasks).toEqual([])
    expect(config.runtime.artifacts).toEqual([])
    expect(Object.keys(config.runtime.roleStates)).toHaveLength(1)
  })

  it('uses the selected task template without pre-creating its recommended roles', () => {
    const config = createDefaultMitaTeamsConfig(
      {
        provider: 'openai',
        id: 'gpt-5',
      },
      'research'
    )

    expect(config.taskTemplateId).toBe('research')
    expect(config.mode).toBe('roundtable')
    expect(config.roles.map((role) => role.id)).toEqual(['orchestrator'])
    expect(config.channels.map((channel) => channel.id)).toEqual(['task'])
  })

  it('normalizes unknown saved values back to safe defaults', () => {
    const config = normalizeMitaTeamsConfig(
      {
        enabled: true,
        mode: 'unknown',
        activeChannel: 'bad-channel',
        workspaceView: 'bad-view',
        activeRoleId: 'bad-role',
        roundLimit: 999,
        taskTemplateId: 'debugging',
        roles: [{ id: 'reviewer', enabled: false, modelId: 'claude' }],
      },
      { provider: 'openai', id: 'gpt-5' }
    )

    expect(config?.mode).toBe('relay')
    expect(config?.taskTemplateId).toBe('debugging')
    expect(config?.activeChannel).toBe('task')
    expect(config?.workspaceView).toBe('team-chat')
    expect(config?.activeRoleId).toBe('orchestrator')
    expect(config?.roundLimit).toBe(10)
    expect(config?.roles.find((role) => role.id === 'reviewer')?.enabled).toBe(
      false
    )
    expect(config?.roles.find((role) => role.id === 'reviewer')?.modelId).toBe(
      'claude'
    )
    expect(config?.runtime.roleStates.orchestrator?.roleId).toBe(
      'orchestrator'
    )
    expect(config?.runtime.roleStates.reviewer?.roleId).toBe('reviewer')
  })

  it('preserves explicit owner workflow control while cleaning unknown values', () => {
    const config = normalizeMitaTeamsConfig(
      {
        enabled: true,
        workflowControl: 'user_spec',
      },
      { provider: 'openai', id: 'gpt-5' }
    )
    const cleaned = normalizeMitaTeamsConfig(
      {
        enabled: true,
        workflowControl: 'auto',
      },
      { provider: 'openai', id: 'gpt-5' }
    )

    expect(config?.workflowControl).toBe('user_spec')
    expect(cleaned?.workflowControl).toBeUndefined()
  })

  it('keeps dynamic roles and channels while cleaning channel membership', () => {
    const config = normalizeMitaTeamsConfig(
      {
        enabled: true,
        activeChannel: 'strategy-room',
        activeRoleId: 'market-strategist',
        roles: [
          {
            id: 'market-strategist',
            name: 'Market Strategist',
            label: 'Market',
            description: 'Shapes market positioning.',
            prompt: 'Find the market angle.',
            color: 'bg-cyan-600',
            permission: 'read',
            enabled: true,
          },
        ],
        channels: [
          {
            id: 'strategy-room',
            label: 'Strategy Room',
            description: 'Positioning work.',
            roleIds: ['market-strategist', 'missing-role'],
          },
        ],
        runtime: {
          version: 1,
          tasks: [
            {
              id: 'investigate',
              title: 'Investigate positioning',
              status: 'researching',
              roleId: 'market-strategist',
              channelId: 'strategy-room',
              createdAt: '2026-05-26T00:00:00.000Z',
              updatedAt: '2026-05-26T00:00:00.000Z',
            },
          ],
          artifacts: [
            {
              id: 'risk-positioning',
              type: 'risk',
              title: 'Positioning risk',
              summary: 'Audience may be too broad.',
              roleId: 'market-strategist',
              channelId: 'strategy-room',
              createdAt: '2026-05-26T00:00:00.000Z',
              updatedAt: '2026-05-26T00:00:00.000Z',
            },
          ],
        },
      },
      { provider: 'openai', id: 'gpt-5' }
    )

    expect(config?.roles.map((role) => role.id)).toEqual([
      'orchestrator',
      'market-strategist',
    ])
    expect(config?.channels.map((channel) => channel.id)).toEqual([
      'task',
      'strategy-room',
    ])
    expect(
      config?.channels.find((channel) => channel.id === 'task')?.roleIds
    ).toEqual(['orchestrator'])
    expect(
      config?.channels.find((channel) => channel.id === 'strategy-room')
        ?.roleIds
    ).toEqual(['market-strategist'])
    expect(config?.runtime.roleStates['market-strategist']?.roleId).toBe(
      'market-strategist'
    )
    expect(config?.runtime.tasks[0].status).toBe('researching')
    expect(config?.runtime.artifacts[0].type).toBe('risk')
  })

  it('normalizes pending choice option ids and answered selections', () => {
    const config = normalizeMitaTeamsConfig({
      enabled: true,
      runtime: {
        version: 1,
        userChoiceRequest: {
          id: 'choice-1',
          question: 'Pick a launch path.',
          status: 'answered',
          selectedOptionId: 'Fast Launch',
          createdAt: '2026-05-29T00:00:00.000Z',
          answeredAt: '2026-05-29T00:01:00.000Z',
          options: [
            { id: 'Fast Launch', label: 'Fast Launch' },
            { id: 'Fast Launch', label: 'Fast Launch again' },
          ],
        },
      },
    })

    expect(
      config?.runtime.userChoiceRequest?.options.map((option) => option.id)
    ).toEqual(['fast-launch', 'fast-launch-2'])
    expect(config?.runtime.userChoiceRequest).toMatchObject({
      status: 'answered',
      selectedOptionId: 'fast-launch',
    })
  })

  it('renders orchestration instructions without claiming private model calls', () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const instructions = renderMitaTeamsSystemInstructions(config)

    expect(instructions).toContain('Biyan Teams mode is active')
    expect(instructions).toContain('Task template: Code')
    expect(instructions).toContain('Act as the Coordinator')
    expect(instructions).toContain('suggest specific roles or channels')
    expect(instructions).toContain('Teams runtime scheduled role calls')
  })

  it('renders direct role chat instructions for the active role', () => {
    const config = {
      ...createDefaultMitaTeamsConfig({
        provider: 'openai',
        id: 'gpt-5',
      }),
      roles: [DEFAULT_MITA_TEAMS_ROLES.find((role) => role.id === 'reviewer')!],
      activeRoleId: 'reviewer' as const,
      workspaceView: 'role-chat' as const,
    }

    const instructions = renderMitaTeamsSystemInstructions(config)

    expect(instructions).toContain('Direct role chat')
    expect(instructions).toContain('Answer as Reviewer')
  })
})
