import { describe, expect, it } from 'vitest'

import {
  createDefaultMitaTeamsConfig,
  DEFAULT_MITA_TEAMS_ROLES,
  normalizeMitaTeamsConfig,
  renderMitaTeamsSystemInstructions,
} from '../mita-teams'

describe('mita teams metadata', () => {
  it('creates enabled role configs from the selected thread model', () => {
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
    expect(config.roles).toHaveLength(1)
    expect(config.roles[0].id).toBe('orchestrator')
    expect(config.roles.every((role) => role.prompt.length > 0)).toBe(true)
    expect(config.roles.every((role) => role.provider === 'jingxing')).toBe(
      true
    )
    expect(config.roles.every((role) => role.modelId === 'gpt-5')).toBe(true)
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
    expect(instructions).toContain('Do not claim that separate LLMs privately ran')
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
