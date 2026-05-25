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
    expect(Object.keys(config.runtime.roleStates)).toHaveLength(1)
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
        roles: [{ id: 'reviewer', enabled: false, modelId: 'claude' }],
      },
      { provider: 'openai', id: 'gpt-5' }
    )

    expect(config?.mode).toBe('relay')
    expect(config?.activeChannel).toBe('task')
    expect(config?.workspaceView).toBe('team-chat')
    expect(config?.activeRoleId).toBe('reviewer')
    expect(config?.roundLimit).toBe(10)
    expect(config?.roles.find((role) => role.id === 'reviewer')?.enabled).toBe(
      false
    )
    expect(config?.roles.find((role) => role.id === 'reviewer')?.modelId).toBe(
      'claude'
    )
    expect(config?.runtime.roleStates.reviewer?.roleId).toBe('reviewer')
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
      },
      { provider: 'openai', id: 'gpt-5' }
    )

    expect(config?.roles.map((role) => role.id)).toEqual(['market-strategist'])
    expect(config?.channels[0].id).toBe('strategy-room')
    expect(config?.channels[0].roleIds).toEqual(['market-strategist'])
    expect(config?.runtime.roleStates['market-strategist']?.roleId).toBe(
      'market-strategist'
    )
  })

  it('renders orchestration instructions without claiming private model calls', () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const instructions = renderMitaTeamsSystemInstructions(config)

    expect(instructions).toContain('Mita Teams mode is active')
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
      roles: [
        DEFAULT_MITA_TEAMS_ROLES.find((role) => role.id === 'reviewer')!,
      ],
      activeRoleId: 'reviewer' as const,
      workspaceView: 'role-chat' as const,
    }

    const instructions = renderMitaTeamsSystemInstructions(config)

    expect(instructions).toContain('Direct role chat')
    expect(instructions).toContain('Answer as Reviewer')
  })
})
