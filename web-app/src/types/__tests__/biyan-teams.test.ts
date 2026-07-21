import { describe, expect, it } from 'vitest'

import {
  approveBiyanTeamsPlan,
  archiveBiyanTeamsRole,
  BIYAN_TEAMS_METADATA_KEY,
  createBiyanTeamsMetadataPatch,
  createDefaultBiyanTeamsConfig,
  DEFAULT_BIYAN_TEAMS_ROLES,
  isBiyanTeamsTeamLocked,
  normalizeBiyanTeamsConfig,
  readBiyanTeamsMetadata,
  renderBiyanTeamsSystemInstructions,
} from '../biyan-teams'
import {
  createLegacyBiyanTeamsMigrationPatch,
  legacyBiyanTeamsMetadataKeyForTests as LEGACY_MITA_TEAMS_METADATA_KEY,
} from '@/legacy_migrations/biyan-teams-metadata'
import { runBiyanTeamsRuntime } from '@/lib/biyan-teams-runtime'

describe('biyan teams metadata', () => {
  it('reads the legacy key once and only emits the canonical key', () => {
    const legacyConfig = createDefaultBiyanTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const legacyMetadata = {
      [LEGACY_MITA_TEAMS_METADATA_KEY]: legacyConfig,
    }

    expect(readBiyanTeamsMetadata(legacyMetadata)).toBe(legacyConfig)
    expect(createLegacyBiyanTeamsMigrationPatch(legacyMetadata)).toEqual({
      [BIYAN_TEAMS_METADATA_KEY]: legacyConfig,
      [LEGACY_MITA_TEAMS_METADATA_KEY]: undefined,
    })
    const canonicalPatch = createBiyanTeamsMetadataPatch(legacyConfig)
    expect(canonicalPatch).toEqual({
      [BIYAN_TEAMS_METADATA_KEY]: legacyConfig,
      [LEGACY_MITA_TEAMS_METADATA_KEY]: undefined,
    })
    expect(JSON.parse(JSON.stringify(canonicalPatch))).toEqual({
      [BIYAN_TEAMS_METADATA_KEY]: legacyConfig,
    })
  })

  it('prefers canonical metadata and never remigrates it', () => {
    const canonical = createDefaultBiyanTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const legacy = { ...canonical, mode: 'debate' as const }
    const metadata = {
      [BIYAN_TEAMS_METADATA_KEY]: canonical,
      [LEGACY_MITA_TEAMS_METADATA_KEY]: legacy,
    }

    expect(readBiyanTeamsMetadata(metadata)).toBe(canonical)
    expect(createLegacyBiyanTeamsMigrationPatch(metadata)).toBeUndefined()
  })

  it('creates an orchestrator-first config from the selected thread model', () => {
    const config = createDefaultBiyanTeamsConfig({
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
    const config = createDefaultBiyanTeamsConfig(
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
    const config = normalizeBiyanTeamsConfig(
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
    const config = normalizeBiyanTeamsConfig(
      {
        enabled: true,
        workflowControl: 'user_spec',
      },
      { provider: 'openai', id: 'gpt-5' }
    )
    const cleaned = normalizeBiyanTeamsConfig(
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
    const config = normalizeBiyanTeamsConfig(
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

  it('archives a role durably and records it in archivedRoleIds', () => {
    const config = normalizeBiyanTeamsConfig(
      {
        enabled: true,
        activeChannel: 'task',
        activeRoleId: 'data_scout',
        roles: [
          {
            id: 'data_scout',
            name: 'Data Scout',
            label: 'Scout',
            description: 'Gathers data.',
            prompt: 'Find data.',
            color: 'bg-cyan-600',
            permission: 'tools',
            enabled: true,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Task',
            description: 'Shared task.',
            roleIds: ['orchestrator', 'data_scout'],
          },
        ],
      },
      { provider: 'openai', id: 'gpt-5' }
    )!

    const archived = archiveBiyanTeamsRole(config, 'data_scout')

    expect(
      archived.roles.find((role) => role.id === 'data_scout')?.enabled
    ).toBe(false)
    expect(archived.runtime.archivedRoleIds).toContain('data_scout')
    expect(
      archived.channels.find((channel) => channel.id === 'task')?.roleIds
    ).not.toContain('data_scout')
    expect(archived.activeRoleId).toBe('orchestrator')

    // archivedRoleIds survives a persistence round-trip (normalize).
    const reloaded = normalizeBiyanTeamsConfig(archived, {
      provider: 'openai',
      id: 'gpt-5',
    })!
    expect(reloaded.runtime.archivedRoleIds).toContain('data_scout')

    // The orchestrator can never be archived.
    expect(archiveBiyanTeamsRole(config, 'orchestrator')).toBe(config)
  })

  it('does not re-enable an archived role when the coordinator reconfigures the team', async () => {
    const config = normalizeBiyanTeamsConfig(
      {
        enabled: true,
        activeChannel: 'task',
        activeRoleId: 'orchestrator',
        roles: [
          {
            id: 'data_scout',
            name: 'Data Scout',
            label: 'Scout',
            description: 'Gathers data.',
            prompt: 'Find data.',
            color: 'bg-cyan-600',
            permission: 'tools',
            enabled: true,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Task',
            description: 'Shared task.',
            roleIds: ['orchestrator', 'data_scout'],
          },
        ],
      },
      { provider: 'openai', id: 'gpt-5' }
    )!
    const archived = approveBiyanTeamsPlan(
      normalizeBiyanTeamsConfig(
        {
          ...archiveBiyanTeamsRole(config, 'data_scout'),
          runtime: {
            ...archiveBiyanTeamsRole(config, 'data_scout').runtime,
            phase: 'awaiting_plan_approval',
            planDraft: {
              id: 'plan-1',
              version: 1,
              status: 'draft',
              goal: 'Continue work.',
              summary: 'Continue.',
              scope: ['x'],
              acceptanceCriteria: ['y'],
              tasks: [
                { id: 't1', title: 'Coordinate', roleId: 'orchestrator' },
              ],
              roleAssignments: [
                {
                  roleId: 'orchestrator',
                  name: 'Orchestrator',
                  assignment: 'Coordinate.',
                },
              ],
              executionOrder: ['Coordinate'],
              createdAt: '2026-06-08T00:00:00.000Z',
              updatedAt: '2026-06-08T00:00:00.000Z',
            },
          },
        },
        { provider: 'openai', id: 'gpt-5' }
      )!
    )

    const result = await runBiyanTeamsRuntime({
      config: archived,
      userText: 'Continue with the team.',
      // Coordinator tries to bring the archived Data Scout back, enabled.
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'configure_team',
          reason: 'Re-add Data Scout.',
          roles: [
            {
              id: 'data_scout',
              name: 'Data Scout',
              prompt: 'Find data.',
              enabled: true,
            },
          ],
          channels: [],
          calls: [],
        }),
      generateRoleText: async () => 'unused',
    })

    expect(
      result.config.roles.find((role) => role.id === 'data_scout')?.enabled
    ).toBe(false)
  })

  it('approving an edited plan keeps only the selected roles and locks the team', () => {
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
            id: 'scout',
            name: 'Scout',
            label: 'S',
            description: 'd',
            prompt: 'p',
            color: 'bg-cyan-600',
            permission: 'tools',
            enabled: true,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Task',
            description: '',
            roleIds: ['orchestrator', 'analyst', 'scout'],
          },
        ],
        runtime: {
          version: 1,
          phase: 'awaiting_plan_approval',
          planDraft: {
            id: 'plan-1',
            version: 1,
            status: 'draft',
            goal: 'Do the thing.',
            summary: 'Plan.',
            scope: ['x'],
            acceptanceCriteria: ['y'],
            tasks: [
              { id: 't1', title: 'Analyze', roleId: 'analyst' },
              { id: 't2', title: 'Scout', roleId: 'scout' },
            ],
            roleAssignments: [
              { roleId: 'orchestrator', name: 'Host', assignment: 'Coordinate.' },
              { roleId: 'analyst', name: 'Analyst', assignment: 'Analyze.' },
              { roleId: 'scout', name: 'Scout', assignment: 'Scout.' },
            ],
            executionOrder: ['Analyze', 'Scout'],
            createdAt: '2026-06-08T00:00:00.000Z',
            updatedAt: '2026-06-08T00:00:00.000Z',
          },
        },
      },
      { provider: 'openai', id: 'gpt-5' }
    )!

    // Owner removes "scout" on the approval card, keeping only "analyst".
    const approved = approveBiyanTeamsPlan(config, { keepRoleIds: ['analyst'] })

    expect(approved.workflowControl).toBe('user_spec')
    expect(approved.roles.find((role) => role.id === 'analyst')?.enabled).toBe(
      true
    )
    expect(approved.roles.find((role) => role.id === 'scout')?.enabled).toBe(
      false
    )
    expect(
      approved.runtime.approvedPlan?.roleAssignments.map((r) => r.roleId)
    ).not.toContain('scout')

    // Approving without edits leaves the team unlocked and intact.
    const approvedAsIs = approveBiyanTeamsPlan(config)
    expect(approvedAsIs.workflowControl).not.toBe('user_spec')
    expect(
      approvedAsIs.roles.find((role) => role.id === 'scout')?.enabled
    ).toBe(true)
  })

  it('does not add plan-suggested roles when the owner specified the team roles', () => {
    const base = createDefaultBiyanTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const ownerRoles = ['market', 'finance', 'product'].map((id, index) => ({
      ...base.roles[0],
      id,
      name: `${id} role`,
      label: id,
      description: `${id} work`,
      prompt: `Handle ${id} work.`,
      color: `bg-role-${index}`,
    }))
    const config = normalizeBiyanTeamsConfig(
      {
        ...base,
        workflowControl: 'user_spec',
        roles: [...base.roles, ...ownerRoles],
        channels: [
          {
            id: 'task',
            label: 'Task',
            description: 'Owner-scoped work.',
            roleIds: ['orchestrator', 'market', 'finance', 'product'],
          },
        ],
        runtime: {
          ...base.runtime,
          phase: 'awaiting_plan_approval',
          planDraft: {
            id: 'plan-1',
            version: 1,
            status: 'draft',
            goal: 'Research a market.',
            summary: 'Use the owner-selected four roles.',
            scope: ['Market'],
            acceptanceCriteria: ['No extra roles are created.'],
            tasks: [
              { id: 'task-1', title: 'Coordinate', roleId: 'orchestrator' },
              { id: 'task-2', title: 'Unexpected scan', roleId: 'analyst' },
            ],
            roleAssignments: [
              {
                roleId: 'orchestrator',
                name: 'Orchestrator',
                assignment: 'Coordinate.',
              },
              {
                roleId: 'market',
                name: 'Market role',
                assignment: 'Inspect market signals.',
              },
              {
                roleId: 'analyst',
                name: 'Analyst',
                assignment: 'Extra role suggested by the plan.',
              },
              {
                roleId: 'writer',
                name: 'Writer',
                assignment: 'Another extra role suggested by the plan.',
              },
            ],
            executionOrder: ['Coordinate', 'Unexpected scan'],
            createdAt: '2026-06-18T00:00:00.000Z',
            updatedAt: '2026-06-18T00:00:00.000Z',
          },
        },
      },
      { provider: 'openai', id: 'gpt-5' }
    )!

    const approved = approveBiyanTeamsPlan(config)

    expect(approved.roles.map((role) => role.id)).toEqual([
      'orchestrator',
      'market',
      'finance',
      'product',
    ])
    expect(approved.runtime.approvedRoleSnapshot.map((role) => role.id)).toEqual(
      ['orchestrator', 'market', 'finance', 'product']
    )
    expect(
      approved.channels.flatMap((channel) => channel.roleIds)
    ).not.toEqual(expect.arrayContaining(['analyst', 'writer']))
  })

  it('normalizes pending choice option ids and answered selections', () => {
    const config = normalizeBiyanTeamsConfig({
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
    const config = createDefaultBiyanTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const instructions = renderBiyanTeamsSystemInstructions(config)

    expect(instructions).toContain('Biyan Teams mode is active')
    expect(instructions).toContain('Task template: Code')
    expect(instructions).toContain('Act as the Coordinator')
    expect(instructions).toContain('suggest specific roles or channels')
    expect(instructions).toContain('Teams runtime scheduled role calls')
  })

  it('renders direct role chat instructions for the active role', () => {
    const config = {
      ...createDefaultBiyanTeamsConfig({
        provider: 'openai',
        id: 'gpt-5',
      }),
      roles: [DEFAULT_BIYAN_TEAMS_ROLES.find((role) => role.id === 'reviewer')!],
      activeRoleId: 'reviewer' as const,
      workspaceView: 'role-chat' as const,
    }

    const instructions = renderBiyanTeamsSystemInstructions(config)

    expect(instructions).toContain('Direct role chat')
    expect(instructions).toContain('Answer as Reviewer')
  })

  it('auto-locks a configured roster but leaves a bare group open (tri-state)', () => {
    const base = createDefaultBiyanTeamsConfig({ provider: 'openai', id: 'gpt-5' })

    // A fresh orchestrator-only group stays open so the Host can build a team.
    expect(isBiyanTeamsTeamLocked(base)).toBe(false)

    // Once the owner adds a specialist, the roster auto-locks by default.
    const withRoster = {
      ...base,
      roles: [
        ...base.roles,
        {
          id: 'analyst',
          name: 'Analyst',
          label: 'A',
          description: 'd',
          prompt: 'p',
          color: 'bg-violet-600',
          permission: 'tools' as const,
          enabled: true,
        },
      ],
    }
    expect(isBiyanTeamsTeamLocked(withRoster)).toBe(true)

    // Explicit owner choices override the auto behavior either way.
    expect(
      isBiyanTeamsTeamLocked({ ...withRoster, workflowControl: 'open' })
    ).toBe(false)
    expect(
      isBiyanTeamsTeamLocked({ ...base, workflowControl: 'user_spec' })
    ).toBe(true)
  })
})
