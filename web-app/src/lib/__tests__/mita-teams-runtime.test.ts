import { describe, expect, it } from 'vitest'

import { useModelProvider } from '@/hooks/useModelProvider'
import {
  runMitaTeamsPrivateRoleChat,
  runMitaTeamsRuntime,
} from '@/lib/mita-teams-runtime'
import { ProviderQuotaError } from '@/lib/provider-quota-error'
import {
  approveMitaTeamsPlan,
  createDefaultMitaTeamsConfig,
  markMitaTeamsRoleUserEdit,
  normalizeMitaTeamsConfig,
  requestMitaTeamsPlanRevision,
  type MitaTeamsConfig,
} from '@/types/mita-teams'

function approveRuntimeForExecution(config: MitaTeamsConfig): MitaTeamsConfig {
  if (config.runtime.approvedPlan) return config

  return approveMitaTeamsPlan({
    ...config,
    runtime: {
      ...config.runtime,
      phase: 'awaiting_plan_approval',
      planDraft: {
        id: 'test-plan',
        version: 1,
        status: 'draft',
        goal: 'Approved test plan',
        summary: 'Approved test plan for execution-stage runtime tests.',
        scope: ['Exercise execution-stage behavior.'],
        acceptanceCriteria: ['Runtime may execute role calls.'],
        tasks: [
          {
            id: 'test-task',
            title: 'Run approved test task',
            roleId: 'orchestrator',
          },
        ],
        roleAssignments: config.roles.map((role) => ({
          roleId: role.id,
          name: role.name,
          assignment: role.description,
          model: role.modelId
            ? `${role.provider ?? 'provider'}/${role.modelId}`
            : undefined,
        })),
        executionOrder: ['Run approved test task'],
        createdAt: '2026-06-08T00:00:00.000Z',
        updatedAt: '2026-06-08T00:00:00.000Z',
      },
    },
  })
}

describe('mita teams runtime', () => {
  it('configures a minimal team, runs channel-scoped role calls, and merges memory', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'jingxing',
      id: 'gpt-5',
    })
    const updates: Array<typeof config> = []
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Design a safer release checklist.',
      onConfigChange: (next) => updates.push(next),
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'configure_team',
            mode: 'hybrid',
            reason: 'Create the smallest team for release planning.',
            roles: [
              {
                id: 'release-researcher',
                name: 'Release Researcher',
                label: 'Research',
                description: 'Find release constraints.',
                prompt: 'Find release facts and constraints.',
                permission: 'read',
              },
              {
                id: 'release-reviewer',
                name: 'Release Reviewer',
                label: 'Review',
                description: 'Review release risk.',
                prompt: 'Find release risks and missing checks.',
                permission: 'read',
              },
            ],
            channels: [
              {
                id: 'release-research',
                label: 'Release Research',
                description: 'Research release facts.',
                roleIds: ['release-researcher'],
              },
              {
                id: 'release-review',
                label: 'Release Review',
                description: 'Review release risks.',
                roleIds: ['release-reviewer'],
              },
            ],
            calls: [
              {
                roleId: 'release-researcher',
                channelId: 'release-research',
                instruction: 'Find facts and constraints.',
                requiredPermission: 'read',
                group: 1,
              },
              {
                roleId: 'release-reviewer',
                channelId: 'release-review',
                instruction: 'Review the plan.',
                requiredPermission: 'read',
                group: 2,
              },
            ],
            updates: {
              tasks: [
                {
                  title: 'Collect release facts',
                  status: 'researching',
                  roleId: 'release-researcher',
                  channelId: 'release-research',
                },
              ],
              artifacts: [
                {
                  type: 'decision',
                  title: 'Release scope',
                  summary: 'Keep the checklist scoped to the current release.',
                },
              ],
            },
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Enough role evidence was gathered.',
          finalResponse: 'Final checklist is ready.',
          updates: {
            artifacts: [
              {
                type: 'final_draft',
                title: 'Final checklist',
                summary: 'The final release checklist is ready.',
                content: 'Final checklist is ready.',
              },
            ],
          },
        })
      },
      generateRoleText: async ({ role }) =>
        `Fact: ${role.name} confirmed one constraint.\nDecision: Keep the checklist scoped.\nRisk: Release timing still needs owner approval.\nTest result: Checklist reviewed for scope.`,
    })

    expect(result.status).toBe('completed')
    expect(result.finalResponse).toBe('Final checklist is ready.')
    expect(updates.length).toBeGreaterThan(1)
    expect(result.config.roles.map((role) => role.id)).toEqual([
      'orchestrator',
      'release-researcher',
      'release-reviewer',
    ])
    expect(
      result.config.channels.find(
        (channel) => channel.id === 'release-research'
      )?.roleIds
    ).toEqual(['release-researcher'])
    expect(
      result.config.runtime.roleStates['release-researcher']?.memory.version
    ).toBe(1)
    expect(
      result.config.runtime.roleStates['release-reviewer']?.stream[0]?.channelId
    ).toBe('release-review')
    expect(result.config.runtime.projectMemory.version).toBeGreaterThan(0)
    expect(result.config.runtime.projectMemory.facts.join('\n')).toContain(
      'confirmed one constraint'
    )
    expect(result.config.runtime.tasks[0]).toMatchObject({
      title: 'Collect release facts',
      status: 'researching',
    })
    expect(
      result.config.runtime.artifacts.map((artifact) => artifact.type)
    ).toEqual(
      expect.arrayContaining(['decision', 'risk', 'test_result', 'final_draft'])
    )
  })

  it('stores direct role chat as private role stream instead of team events', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const role = config.roles[0]
    let capturedPrompt = ''
    const updates: Array<typeof config> = []

    const result = await runMitaTeamsPrivateRoleChat({
      config,
      roleId: role.id,
      userText: 'Private question for this role.',
      onConfigChange: (next) => updates.push(next),
      generateRoleText: async ({ prompt, onDelta }) => {
        capturedPrompt = prompt
        onDelta?.('Private ')
        onDelta?.('role')
        return 'Private role answer.'
      },
    })

    const stream = result.config.runtime.roleStates[role.id]?.stream ?? []
    expect(result.status).toBe('completed')
    expect(capturedPrompt).toContain('private Biyan Teams role chat')
    expect(capturedPrompt).toContain(
      'separate from channel-hosted team discussion'
    )
    expect(stream).toHaveLength(2)
    expect(stream.map((message) => message.content)).toEqual([
      'Private question for this role.',
      'Private role answer.',
    ])
    expect(
      updates.some((update) =>
        update.runtime.roleStates[role.id]?.stream.some(
          (message) =>
            message.role === 'assistant' && message.content === 'Private'
        )
      )
    ).toBe(true)
    expect(
      updates.some((update) =>
        update.runtime.roleStates[role.id]?.stream.some(
          (message) =>
            message.role === 'assistant' && message.content === 'Private role'
        )
      )
    ).toBe(true)
    expect(stream.every((message) => message.channelId === undefined)).toBe(true)
    expect(result.config.runtime.teamEvents).toHaveLength(0)
    expect(result.config.runtime.roleStates[role.id]?.memory.version).toBe(0)
  })

  it('streams channel role output into the active assistant turn', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-5',
    }
    const base = createDefaultMitaTeamsConfig(model)
    const role = {
      id: 'streaming-worker',
      name: 'Streaming Worker',
      label: 'Worker',
      description: 'Streams role output.',
      prompt: 'Answer as a streaming worker.',
      color: 'bg-blue-500',
      permission: 'read' as const,
      enabled: true,
      provider: model.provider,
      modelId: model.id,
    }
    const config = normalizeMitaTeamsConfig(
      {
        ...base,
        roles: [...base.roles, role],
        channels: base.channels.map((channel) =>
          channel.id === 'task'
            ? { ...channel, roleIds: [...channel.roleIds, role.id] }
            : channel
        ),
      },
      model
    )
    const updates: Array<typeof config> = []
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Ask the role for a short answer.',
      onConfigChange: (next) => updates.push(next),
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'call_roles',
            mode: 'relay',
            reason: 'Need one role answer.',
            calls: [
              {
                roleId: role.id,
                channelId: 'task',
                instruction: 'Answer briefly.',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Role output streamed.',
          finalResponse: 'Done.',
        })
      },
      generateRoleText: async ({ onDelta }) => {
        onDelta?.('Hel')
        onDelta?.('lo')
        return 'Hello'
      },
    })

    const stream = result.config.runtime.roleStates[role.id]?.stream ?? []
    const assistantMessages = stream.filter(
      (message) => message.role === 'assistant'
    )

    expect(result.status).toBe('completed')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]?.content).toBe('Hello')
    expect(
      updates.some((update) =>
        update.runtime.roleStates[role.id]?.stream.some(
          (message) => message.role === 'assistant' && message.content === 'Hel'
        )
      )
    ).toBe(true)
    expect(
      updates.some((update) =>
        update.runtime.roleStates[role.id]?.stream.some(
          (message) =>
            message.role === 'assistant' && message.content === 'Hello'
        )
      )
    ).toBe(true)
  })

  it('moves team role calls out of the current task delivery channel', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-5',
    }
    const config = createDefaultMitaTeamsConfig(model)
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Ask a worker to draft and review a response.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'configure_team',
            reason: 'Create a worker, but mistakenly put the worker in task.',
            roles: [
              {
                id: 'worker',
                name: 'Worker',
                label: 'Work',
                description: 'Drafts internal work.',
                prompt: 'Draft internal work.',
                permission: 'read',
              },
            ],
            channels: [
              {
                id: 'task',
                label: 'Current task',
                description: 'Delivery room.',
                roleIds: ['orchestrator', 'worker'],
              },
            ],
            calls: [
              {
                roleId: 'worker',
                channelId: 'task',
                instruction: 'Discuss the draft internally.',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Done.',
          finalResponse: 'Final answer.',
        })
      },
      generateRoleText: async () => 'Worker channel output.',
    })

    const taskChannel = result.config.channels.find(
      (channel) => channel.id === 'task'
    )
    const discussionChannel = result.config.channels.find(
      (channel) => channel.id === 'discussion'
    )
    const workerStream =
      result.config.runtime.roleStates.worker?.stream ?? []

    expect(taskChannel?.roleIds).toEqual(['orchestrator'])
    expect(discussionChannel?.roleIds).toContain('worker')
    expect(
      workerStream.every((message) => message.channelId === 'discussion')
    ).toBe(true)
  })

  it('surfaces empty channel role output as a direct role failure', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-5',
    }
    const base = createDefaultMitaTeamsConfig(model)
    const role = {
      id: 'empty-worker',
      name: 'Empty Worker',
      label: 'Worker',
      description: 'Returns no role output.',
      prompt: 'Answer as an empty worker.',
      color: 'bg-blue-500',
      permission: 'read' as const,
      enabled: true,
      provider: model.provider,
      modelId: model.id,
    }
    const config = normalizeMitaTeamsConfig(
      {
        ...base,
        roles: [...base.roles, role],
        channels: base.channels.map((channel) =>
          channel.id === 'task'
            ? { ...channel, roleIds: [...channel.roleIds, role.id] }
            : channel
        ),
      },
      model
    )
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Ask the role for an answer.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'call_roles',
            mode: 'relay',
            reason: 'Need one role answer.',
            calls: [
              {
                roleId: role.id,
                channelId: 'task',
                instruction: 'Answer briefly.',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Failure surfaced.',
          finalResponse: 'Done.',
        })
      },
      generateRoleText: async () => '',
    })

    const stream = result.config.runtime.roleStates[role.id]?.stream ?? []
    const assistantMessage = stream.find(
      (message) => message.role === 'assistant'
    )

    expect(result.status).toBe('completed')
    expect(assistantMessage?.content).toContain(
      'Biyan Teams 角色运行失败：No output generated by Empty Worker.'
    )
    expect(assistantMessage?.content).not.toContain('Check the stream for errors')
    expect(result.config.runtime.roleStates[role.id]?.lastError).toBe(
      'No output generated by Empty Worker.'
    )
  })

  it('rewrites generic stream no-output errors with the failing role name', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-5',
    }
    const base = createDefaultMitaTeamsConfig(model)
    const role = {
      id: 'generic-empty-worker',
      name: 'Generic Empty Worker',
      label: 'Worker',
      description: 'Throws a generic no-output error.',
      prompt: 'Answer as a worker.',
      color: 'bg-blue-500',
      permission: 'read' as const,
      enabled: true,
      provider: model.provider,
      modelId: model.id,
    }
    const config = normalizeMitaTeamsConfig(
      {
        ...base,
        roles: [...base.roles, role],
        channels: base.channels.map((channel) =>
          channel.id === 'task'
            ? { ...channel, roleIds: [...channel.roleIds, role.id] }
            : channel
        ),
      },
      model
    )
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Ask the role for an answer.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'call_roles',
            mode: 'relay',
            reason: 'Need one role answer.',
            calls: [
              {
                roleId: role.id,
                channelId: 'task',
                instruction: 'Answer briefly.',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Failure surfaced.',
          finalResponse: 'Done.',
        })
      },
      generateRoleText: async () => {
        throw new Error('No output generated. Check the stream for errors.')
      },
    })

    const stream = result.config.runtime.roleStates[role.id]?.stream ?? []
    const assistantMessage = stream.find(
      (message) => message.role === 'assistant'
    )

    expect(result.status).toBe('completed')
    expect(assistantMessage?.content).toContain(
      'Biyan Teams 角色运行失败：No output generated by Generic Empty Worker.'
    )
    expect(assistantMessage?.content).not.toContain('Check the stream for errors')
    expect(result.config.runtime.roleStates[role.id]?.lastError).toBe(
      'No output generated by Generic Empty Worker.'
    )
  })

  it('guides the orchestrator with available models and assigns role-specific fallbacks', async () => {
    const previousModelState = useModelProvider.getState()
    useModelProvider.setState({
      providers: [
        {
          active: true,
          provider: 'openai',
          api_key: 'sk-openai',
          settings: [],
          models: [{ id: 'gpt-5', displayName: 'GPT-5' }],
        },
        {
          active: true,
          provider: 'anthropic',
          api_key: 'sk-anthropic',
          settings: [],
          models: [{ id: 'claude-opus-4-7', displayName: 'Claude Opus' }],
        },
        {
          active: true,
          provider: 'gemini',
          api_key: 'sk-gemini',
          settings: [],
          models: [{ id: 'gemini-3.5-pro', displayName: 'Gemini Pro' }],
        },
        {
          active: true,
          provider: 'xai',
          api_key: 'sk-xai',
          settings: [],
          models: [{ id: 'grok-4', displayName: 'Grok 4' }],
        },
      ],
      selectedProvider: 'openai',
      selectedModel: { id: 'gpt-5', displayName: 'GPT-5' },
    })

    try {
      const config = createDefaultMitaTeamsConfig({
        provider: 'openai',
        id: 'gpt-5',
      })
      let decisionCount = 0
      let capturedPrompt = ''

      const result = await runMitaTeamsRuntime({
        config: approveRuntimeForExecution(config),
        userText:
          'Create a team for coding, complex research, UI design, and fact checking.',
        generateDecisionText: async ({ prompt }) => {
          decisionCount += 1
          capturedPrompt = prompt
          if (decisionCount > 1) {
            return JSON.stringify({
              action: 'stop',
              reason: 'Model assignment checked.',
              finalResponse: 'Done.',
            })
          }

          return JSON.stringify({
            action: 'configure_team',
            reason: 'Create specialist roles without explicit models.',
            roles: [
              {
                id: 'builder',
                name: 'Builder',
                label: 'Build',
                description: 'Implement code changes and debug issues.',
                prompt: 'Write and debug implementation work.',
                permission: 'write',
              },
              {
                id: 'research-architect',
                name: 'Research Architect',
                label: 'Research',
                description: 'Research complex tradeoffs and architecture.',
                prompt: 'Analyze hard tradeoffs and propose a plan.',
                permission: 'read',
              },
              {
                id: 'ux-designer',
                name: 'UX Designer',
                label: 'UX',
                description: 'Design UI and interaction details.',
                prompt: 'Improve UI and UX decisions.',
                permission: 'read',
              },
              {
                id: 'fact-checker',
                name: 'Fact Checker',
                label: 'Truth',
                description: 'Verify facts and separate signal from noise.',
                prompt: 'Check facts and call out uncertainty.',
                permission: 'read',
              },
            ],
            channels: [
              {
                id: 'task',
                label: 'Current task',
                description: 'Main room.',
                roleIds: [
                  'orchestrator',
                  'builder',
                  'research-architect',
                  'ux-designer',
                  'fact-checker',
                ],
              },
            ],
            calls: [],
          })
        },
        generateRoleText: async () => 'unused',
      })

      expect(capturedPrompt).toContain('Model assignment guide:')
      expect(capturedPrompt).toContain('Relay operating contract:')
      expect(capturedPrompt).toContain(
        'Treat relay as staged handoff, not repeated generation by one role.'
      )
      expect(capturedPrompt).toContain('{provider:"openai", modelId:"gpt-5"')
      expect(capturedPrompt).toContain(
        '{provider:"anthropic", modelId:"claude-opus-4-7"'
      )
      expect(capturedPrompt).toContain(
        '{provider:"gemini", modelId:"gemini-3.5-pro"'
      )
      expect(capturedPrompt).toContain('{provider:"xai", modelId:"grok-4"')
      expect(result.config.roles.find((role) => role.id === 'builder')).toMatchObject(
        {
          provider: 'openai',
          modelId: 'gpt-5',
        }
      )
      expect(
        result.config.roles.find((role) => role.id === 'research-architect')
      ).toMatchObject({
        provider: 'anthropic',
        modelId: 'claude-opus-4-7',
      })
      expect(
        result.config.roles.find((role) => role.id === 'ux-designer')
      ).toMatchObject({
        provider: 'gemini',
        modelId: 'gemini-3.5-pro',
      })
      expect(
        result.config.roles.find((role) => role.id === 'fact-checker')
      ).toMatchObject({
        provider: 'xai',
        modelId: 'grok-4',
      })
    } finally {
      useModelProvider.setState({
        providers: previousModelState.providers,
        selectedProvider: previousModelState.selectedProvider,
        selectedModel: previousModelState.selectedModel,
        deletedModels: previousModelState.deletedModels,
      })
    }
  })

  it('uses a market research playbook with language guidance for sector outlook requests', async () => {
    const previousModelState = useModelProvider.getState()
    useModelProvider.setState({
      providers: [
        {
          active: true,
          provider: 'anthropic',
          api_key: 'sk-anthropic',
          settings: [],
          models: [{ id: 'claude-opus-4-7', displayName: 'Claude Opus' }],
        },
        {
          active: true,
          provider: 'gemini',
          api_key: 'sk-gemini',
          settings: [],
          models: [{ id: 'gemini-3.5-pro', displayName: 'Gemini Pro' }],
        },
        {
          active: true,
          provider: 'xai',
          api_key: 'sk-xai',
          settings: [],
          models: [{ id: 'grok-4', displayName: 'Grok 4' }],
        },
      ],
      selectedProvider: 'anthropic',
      selectedModel: { id: 'claude-opus-4-7', displayName: 'Claude Opus' },
    })

    try {
      const config = createDefaultMitaTeamsConfig({
        provider: 'anthropic',
        id: 'claude-opus-4-7',
      })
      let capturedDecisionPrompt = ''
      const rolePrompts: string[] = []

      const result = await runMitaTeamsRuntime({
        config: approveRuntimeForExecution(config),
        userText: '帮我研究美股明日什么板块会涨',
        threadTitle: 'Biyan Teams',
        generateDecisionText: async ({ prompt }) => {
          capturedDecisionPrompt = prompt
          return JSON.stringify({
            action: 'stop',
            reason: 'Try to stop early.',
            finalResponse: 'Done too early.',
          })
        },
        generateRoleText: async ({ role, prompt }) => {
          rolePrompts.push(prompt)
          return `${role.name} completed its playbook step.`
        },
      })

      expect(capturedDecisionPrompt).toContain('Scenario playbook: Market research')
      expect(capturedDecisionPrompt).toContain('Data Scout -> Market Analyst -> Skeptic Reviewer')
      expect(capturedDecisionPrompt).toContain('User query language: Chinese')
      expect(capturedDecisionPrompt).toContain('App language:')
      expect(result.config.taskTemplateId).toBe('research')
      expect(result.config.mode).toBe('relay')
      expect(result.config.roles.map((role) => role.id)).toEqual(
        expect.arrayContaining(['data_scout', 'market_analyst', 'skeptic'])
      )
      expect(
        result.config.runtime.roleStates.data_scout?.stream.some(
          (message) => message.role === 'assistant'
        )
      ).toBe(true)
      expect(
        result.config.runtime.roleStates.market_analyst?.stream.some(
          (message) => message.role === 'assistant'
        )
      ).toBe(true)
      expect(
        result.config.runtime.roleStates.skeptic?.stream.some(
          (message) => message.role === 'assistant'
        )
      ).toBe(true)
      expect(rolePrompts.join('\n')).toContain('User query language: Chinese')
    } finally {
      useModelProvider.setState({
        providers: previousModelState.providers,
        selectedProvider: previousModelState.selectedProvider,
        selectedModel: previousModelState.selectedModel,
        deletedModels: previousModelState.deletedModels,
      })
    }
  })

  it('requests native web search for ticker investment research role calls', async () => {
    const previousModelState = useModelProvider.getState()
    useModelProvider.setState({
      providers: [
        {
          active: true,
          provider: 'jingxing',
          api_key: 'sk-jingxing',
          settings: [],
          models: [
            { id: 'claude-opus-4-7', displayName: 'Claude Opus' },
            { id: 'grok-4.3', displayName: 'Grok 4.3' },
            {
              id: 'gemini-3.1-pro-preview',
              displayName: 'Gemini 3.1 Pro Preview',
            },
          ],
        },
      ],
      selectedProvider: 'jingxing',
      selectedModel: {
        id: 'claude-opus-4-7',
        displayName: 'Claude Opus',
      },
    })

    try {
      const config = createDefaultMitaTeamsConfig({
        provider: 'jingxing',
        id: 'claude-opus-4-7',
      })
      const roleCalls: Array<{
        roleId: string
        modelId?: string
        prompt: string
        webSearch?: {
          enabled: boolean
          reason: string
          depth?: string
          blockedReason?: string
        }
      }> = []

      const result = await runMitaTeamsRuntime({
        config: approveRuntimeForExecution(config),
        userText: '帮我研究 $MRVL 投资价值',
        generateDecisionText: async () =>
          JSON.stringify({
            action: 'stop',
            reason: 'Try to stop before the market playbook completes.',
            finalResponse: 'Done too early.',
          }),
        generateRoleText: async (input) => {
          const webSearch = (
            input as typeof input & {
              webSearch?: {
                enabled: boolean
                reason: string
                depth?: string
                blockedReason?: string
              }
            }
          ).webSearch
          roleCalls.push({
            roleId: input.role.id,
            modelId: input.model?.id,
            prompt: input.prompt,
            webSearch,
          })
          return `${input.role.name} checked live sources.`
        },
      })

      expect(result.config.scenarioId).toBe('market_research')
      expect(roleCalls.map((call) => call.roleId)).toEqual([
        'data_scout',
        'market_analyst',
        'skeptic',
      ])
      expect(roleCalls.every((call) => call.webSearch?.enabled)).toBe(true)
      expect(roleCalls.every((call) => call.webSearch?.depth === 'high')).toBe(
        true
      )
      expect(roleCalls.map((call) => call.webSearch?.reason).join('\n')).toContain(
        'current market or investment data'
      )
      expect(
        roleCalls.find((call) => call.roleId === 'data_scout')?.modelId
      ).toBe('grok-4.3')
      expect(roleCalls.map((call) => call.prompt).join('\n')).toContain(
        'Return a compact research packet'
      )
    } finally {
      useModelProvider.setState({
        providers: previousModelState.providers,
        selectedProvider: previousModelState.selectedProvider,
        selectedModel: previousModelState.selectedModel,
        deletedModels: previousModelState.deletedModels,
      })
    }
  })

  it('does not inject fake live-search guidance for unsupported assigned models', async () => {
    const previousModelState = useModelProvider.getState()
    useModelProvider.setState({
      providers: [
        {
          active: true,
          provider: 'jingxing',
          api_key: 'sk-jingxing',
          settings: [],
          models: [{ id: 'basic-chat-model', displayName: 'Basic Chat' }],
        },
      ],
      selectedProvider: 'jingxing',
      selectedModel: {
        id: 'basic-chat-model',
        displayName: 'Basic Chat',
      },
    })

    try {
      const config = createDefaultMitaTeamsConfig({
        provider: 'jingxing',
        id: 'basic-chat-model',
      })
      const roleCalls: Array<{
        prompt: string
        webSearch?: { enabled: boolean; blockedReason?: string }
      }> = []

      await runMitaTeamsRuntime({
        config: approveRuntimeForExecution(config),
        userText: '帮我研究 $MRVL 投资价值',
        generateDecisionText: async () =>
          JSON.stringify({
            action: 'stop',
            reason: 'Try to stop before the market playbook completes.',
            finalResponse: 'Done too early.',
          }),
        generateRoleText: async (input) => {
          roleCalls.push({
            prompt: input.prompt,
            webSearch: input.webSearch,
          })
          return 'Missing live inputs: assigned model has no native search.'
        },
      })

      expect(roleCalls.length).toBeGreaterThan(0)
      expect(roleCalls.every((call) => call.webSearch?.enabled === false)).toBe(
        true
      )
      expect(roleCalls[0]?.webSearch).toMatchObject({
        enabled: false,
        blockedReason:
          'Assigned model does not support native web search for this role call.',
      })
      expect(roleCalls[0]?.prompt).toContain(
        'Native web search is not available for this role call'
      )
      expect(roleCalls[0]?.prompt).toContain('Gaps for next role:')
      expect(roleCalls[0]?.prompt).not.toContain(
        'Native web search is enabled for this role call'
      )
    } finally {
      useModelProvider.setState({
        providers: previousModelState.providers,
        selectedProvider: previousModelState.selectedProvider,
        selectedModel: previousModelState.selectedModel,
        deletedModels: previousModelState.deletedModels,
      })
    }
  })

  it('repairs invalid orchestrator JSON once before continuing', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let decisionCalls = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Summarize the plan.',
      generateDecisionText: async () => {
        decisionCalls += 1
        if (decisionCalls === 1) return 'not json'
        return JSON.stringify({
          action: 'stop',
          reason: 'Repaired JSON.',
          finalResponse: 'Recovered decision.',
        })
      },
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('completed')
    expect(result.finalResponse).toBe('Recovered decision.')
    expect(decisionCalls).toBe(2)
    expect(
      result.config.runtime.teamEvents.some(
        (event) => event.type === 'json_repair_requested'
      )
    ).toBe(true)
  })

  it('surfaces non-Error runtime failures instead of the generic fallback', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'jingxing',
      id: 'gemini-3.5-flash',
    })

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Start a team run.',
      generateDecisionText: async () => {
        throw {
          error: {
            message: 'Provider request timed out',
            code: 'upstream_timeout',
          },
          status: 504,
          statusText: 'Gateway Timeout',
        }
      },
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('failed')
    expect(result.finalResponse).toContain('Provider request timed out')
    expect(result.finalResponse).toContain('status=504')
    expect(result.finalResponse).not.toBe(
      'Biyan Teams 运行失败：Biyan Teams runtime failed'
    )
    expect(result.config.runtime.run?.error).toContain(
      'Provider request timed out'
    )
  })

  it('keeps provider quota details visible in runtime failures', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'jingxing',
      id: 'gemini-3.5-flash',
    })

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Start a team run.',
      generateDecisionText: async () => {
        throw new ProviderQuotaError({
          message: '该令牌额度已用尽，请充值后继续使用。',
          status: 403,
          code: 'pre_consume_token_quota_failed',
          providerName: 'jingxing',
          rechargeUrl: 'https://api.jingxing.uk/console/topup',
        })
      },
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('failed')
    expect(result.finalResponse).toContain('该令牌额度已用尽')
    expect(result.finalResponse).toContain('provider=jingxing')
    expect(result.finalResponse).toContain(
      'https://api.jingxing.uk/console/topup'
    )
  })

  it('advances rounds for non-calling decisions so orchestration cannot spin forever', async () => {
    const config = {
      ...createDefaultMitaTeamsConfig({
        provider: 'openai',
        id: 'gpt-5',
      }),
      roundLimit: 2,
    }
    let decisionCalls = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Keep configuring only.',
      generateDecisionText: async () => {
        decisionCalls += 1
        return JSON.stringify({
          action: 'configure_team',
          reason: 'Create or refresh a planning role without calling it yet.',
          roles: [
            {
              id: 'planner',
              name: 'Planner',
              label: 'Plan',
              description: 'Plans the work.',
              prompt: 'Plan only.',
              permission: 'read',
            },
          ],
          channels: [
            {
              id: 'planning',
              label: 'Planning',
              description: 'Planning room.',
              roleIds: ['planner'],
            },
          ],
          calls: [],
        })
      },
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('completed')
    expect(decisionCalls).toBe(2)
    expect(result.config.runtime.run?.currentRound).toBe(2)
    expect(result.config.roles.some((role) => role.id === 'planner')).toBe(
      true
    )
  })

  it('reuses existing roles and channels when a follow-up repeats configure_team', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let firstDecisionCount = 0

    const firstRun = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: '研究 MRVL 的投资价值。',
      generateDecisionText: async () => {
        firstDecisionCount += 1
        if (firstDecisionCount === 1) {
          return JSON.stringify({
            action: 'configure_team',
            mode: 'serial',
            reason: 'Create the analyst role and research channel.',
            roles: [
              {
                id: 'analyst',
                name: 'Market Analyst',
                label: 'Analyst',
                description: 'Analyzes investment evidence.',
                prompt: 'Use the established investment research framework.',
                permission: 'read',
              },
            ],
            channels: [
              {
                id: 'research',
                label: 'Research',
                description: 'Research room.',
                roleIds: ['analyst'],
              },
            ],
            calls: [
              {
                roleId: 'analyst',
                channelId: 'research',
                instruction: 'Prepare the first pass.',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'First pass is ready.',
          finalResponse: 'First pass ready.',
        })
      },
      generateRoleText: async () => 'Fact: MRVL needs updated validation.',
    })
    const configuredEventCount = firstRun.config.runtime.teamEvents.filter(
      (event) => event.type === 'team_configured'
    ).length
    let followUpDecisionCount = 0
    let capturedPrompt = ''

    const followUp = await runMitaTeamsRuntime({
      config: firstRun.config,
      userText: '继续补充风险审查。',
      generateDecisionText: async ({ prompt }) => {
        followUpDecisionCount += 1
        capturedPrompt = prompt
        if (followUpDecisionCount === 1) {
          return JSON.stringify({
            action: 'configure_team',
            mode: 'serial',
            reason: 'Rebuild the same team for the follow-up.',
            roles: [
              {
                id: 'analyst',
                name: 'Market Analyst',
                label: 'Analyst',
                description: 'Replacement description.',
                prompt: 'Replacement prompt that should not overwrite memory.',
                permission: 'read',
              },
            ],
            channels: [
              {
                id: 'research',
                label: 'Research',
                description: 'Replacement room description.',
                roleIds: ['analyst'],
              },
            ],
            calls: [
              {
                roleId: 'analyst',
                channelId: 'research',
                instruction: 'Reuse the existing analyst for risk review.',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Follow-up is complete.',
          finalResponse: 'Follow-up ready.',
        })
      },
      generateRoleText: async () => 'Risk: Customer concentration still matters.',
    })

    expect(capturedPrompt).toContain('prefer reusing the configured team')
    expect(followUp.status).toBe('completed')
    expect(
      followUp.config.roles.find((role) => role.id === 'analyst')?.prompt
    ).toBe('Use the established investment research framework.')
    expect(
      followUp.config.runtime.teamEvents.filter(
        (event) => event.type === 'team_configured'
      )
    ).toHaveLength(configuredEventCount)
    expect(
      followUp.config.runtime.teamEvents.some(
        (event) => event.title === 'Orchestrator chose call_roles'
      )
    ).toBe(true)

    let noOpDecisionCount = 0
    const noOpFollowUp = await runMitaTeamsRuntime({
      config: followUp.config,
      userText: '继续。',
      generateDecisionText: async () => {
        noOpDecisionCount += 1
        if (noOpDecisionCount === 1) {
          return JSON.stringify({
            action: 'configure_team',
            reason: 'Repeat the same configuration without a call.',
            roles: [
              {
                id: 'analyst',
                name: 'Market Analyst',
                label: 'Analyst',
                description: 'Another replacement description.',
                prompt: 'Another replacement prompt.',
                permission: 'read',
              },
            ],
            channels: [
              {
                id: 'research',
                label: 'Research',
                description: 'Another replacement room.',
                roleIds: ['analyst'],
              },
            ],
            calls: [],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'No-op follow-up is complete.',
          finalResponse: 'No-op follow-up ready.',
        })
      },
      generateRoleText: async () => 'unused',
    })

    expect(
      noOpFollowUp.config.runtime.teamEvents.filter(
        (event) => event.type === 'team_configured'
      )
    ).toHaveLength(configuredEventCount)
  })

  it('keeps markdown-defined workflows under owner control instead of injecting fallback roles', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let decisionCount = 0
    let capturedPrompt = ''
    const calledRoles: string[] = []

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: `# 人生决策听证会

## 二、配置
- **模式**：圆桌
- **轮次**：5 轮
- **频道名**：#人生听证会

### 角色卡（按发言顺序）

#### 1️⃣ 案情侦察员 · \`grok-4-1-fast-reasoning\`
\`\`\`
你是听证会的案情侦察员。只做事实清单。
\`\`\`

#### 2️⃣ 机会律师 · \`grok-4.3\`
\`\`\`
你是改变方辩护律师。
\`\`\`

#### 3️⃣ 大法官 · \`claude-opus-4-8\`
\`\`\`
你是主审大法官，在所有人发言结束后宣判。
\`\`\`

## 为什么不用美股调研
美股调研容易触发财务合规风险，这个 demo 不使用 Market Research 团队。`,
      generateDecisionText: async ({ prompt }) => {
        decisionCount += 1
        capturedPrompt = prompt
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'configure_team',
            mode: 'serial',
            reason: 'Configure hearing roles, but accidentally add market fallback.',
            roles: [
              {
                id: 'data_scout',
                name: 'Data Scout',
                label: 'Data',
                description: 'Collects market data.',
                prompt: 'Collect market data.',
                permission: 'read',
              },
              {
                id: 'case_scout',
                name: '案情侦察员助手',
                label: '侦察',
                description: '把处境拆成事实清单。',
                prompt: '你是听证会的案情侦察员。只做事实清单。',
                permission: 'read',
                modelId: 'wrong-model',
              },
              {
                id: 'judge',
                name: '大法官',
                label: '法官',
                description: '最终宣判。',
                prompt: '你是主审大法官，在所有人发言结束后宣判。',
                permission: 'read',
              },
            ],
            channels: [
              {
                id: 'research',
                label: 'Market Research',
                description: 'Fallback market room.',
                roleIds: ['data_scout'],
              },
              {
                id: 'hearing',
                label: '人生听证会',
                description: '用户文档定义的听证会频道。',
                roleIds: ['case_scout', 'judge', 'data_scout'],
              },
            ],
            calls: [
              {
                roleId: 'data_scout',
                channelId: 'research',
                instruction: 'Run market research.',
              },
              {
                roleId: 'case_scout',
                channelId: 'hearing',
                instruction: '列事实清单。',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Workflow run is complete.',
          finalResponse: '听证会完成。',
        })
      },
      generateRoleText: async ({ role }) => {
        calledRoles.push(role.id)
        return `Fact: ${role.name} completed its document-defined task.`
      },
    })

    expect(capturedPrompt).toContain('owner supplied an explicit workflow')
    expect(result.config.workflowControl).toBe('user_spec')
    expect(result.config.scenarioId).toBeUndefined()
    expect(result.config.roles.map((role) => role.id)).not.toContain(
      'data_scout'
    )
    expect(result.config.roles.map((role) => role.name)).toEqual(
      expect.arrayContaining(['案情侦察员助手', '大法官'])
    )
    expect(
      result.config.channels.some((channel) => channel.id === 'research')
    ).toBe(false)
    expect(
      result.config.channels.find((channel) => channel.id === 'hearing')?.roleIds
    ).toEqual(['case_scout', 'judge'])
    expect(calledRoles).toEqual(['case_scout'])
  })

  it('aggregates orchestrator and role token usage across a run', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Plan and review usage.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return {
            text: JSON.stringify({
              action: 'configure_team',
              mode: 'serial',
              reason: 'Create reviewer and call it.',
              roles: [
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  label: 'Review',
                  description: 'Reviews the plan.',
                  prompt: 'Review carefully.',
                  permission: 'read',
                },
              ],
              channels: [
                {
                  id: 'review',
                  label: 'Review',
                  description: 'Review room.',
                  roleIds: ['reviewer'],
                },
              ],
              calls: [
                {
                  roleId: 'reviewer',
                  channelId: 'review',
                  instruction: 'Review the plan.',
                },
              ],
            }),
            usage: {
              promptTokens: 10,
              completionTokens: 2,
              totalTokens: 12,
            },
          }
        }

        return {
          text: JSON.stringify({
            action: 'stop',
            reason: 'Usage verified.',
            finalResponse: 'Done.',
          }),
          usage: {
            promptTokens: 3,
            completionTokens: 1,
            totalTokens: 4,
          },
        }
      },
      generateRoleText: async () => ({
        text: 'Decision: Reviewed.',
        usage: {
          inputTokens: 4,
          outputTokens: 6,
          totalTokens: 10,
        },
      }),
    })

    expect(result.status).toBe('completed')
    expect(result.config.runtime.run?.usage).toMatchObject({
      promptTokens: 17,
      completionTokens: 9,
      totalTokens: 26,
    })
  })

  it('merges role updates to existing task board items', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-5',
    }
    const base = createDefaultMitaTeamsConfig(model)
    const now = '2026-05-29T00:00:00.000Z'
    const config = normalizeMitaTeamsConfig(
      {
        ...base,
        roles: [
          ...base.roles,
          {
            id: 'builder',
            name: 'Builder',
            label: 'Build',
            description: 'Updates tasks.',
            prompt: 'Update task status.',
            color: 'bg-emerald-600',
            permission: 'read',
            enabled: true,
            provider: model.provider,
            modelId: model.id,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Current task',
            description: 'Main room.',
            roleIds: ['orchestrator', 'builder'],
          },
        ],
        runtime: {
          ...base.runtime,
          tasks: [
            {
              id: 'review-launch-plan',
              title: 'Review launch plan',
              status: 'todo',
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      },
      model
    )!
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Finish the task.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount > 1) {
          return JSON.stringify({
            action: 'stop',
            reason: 'Task update merged.',
            finalResponse: 'Done.',
          })
        }

        return JSON.stringify({
          action: 'call_roles',
          mode: 'parallel',
          reason: 'Ask builder to update the board.',
          calls: [
            {
              roleId: 'builder',
              channelId: 'task',
              instruction: 'Mark the task done.',
            },
          ],
        })
      },
      generateRoleText: async () => 'Task [done]: Review launch plan',
    })

    expect(result.status).toBe('completed')
    expect(result.config.runtime.tasks).toContainEqual(
      expect.objectContaining({
        id: 'review-launch-plan',
        status: 'done',
      })
    )
  })

  it('clears a stale pending choice when a new owner message starts a run', async () => {
    const base = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const config = {
      ...base,
      runtime: {
        ...base.runtime,
        userChoiceRequest: {
          id: 'choice-1',
          question: 'Pick scope.',
          options: [{ id: 'small', label: 'Small beta' }],
          status: 'pending' as const,
          createdAt: '2026-05-29T00:00:00.000Z',
        },
      },
    }

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Actually, continue with the smallest scope.',
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'stop',
          reason: 'Freeform owner response handled.',
          finalResponse: 'Continuing without stale choice.',
        }),
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('completed')
    expect(result.config.runtime.userChoiceRequest).toBeUndefined()
  })

  it('treats abort during role generation as stopped instead of failed', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-5',
    }
    const base = createDefaultMitaTeamsConfig(model)
    const config = normalizeMitaTeamsConfig(
      {
        ...base,
        roles: [
          ...base.roles,
          {
            id: 'builder',
            name: 'Builder',
            label: 'Build',
            description: 'Builds work.',
            prompt: 'Build carefully.',
            color: 'bg-emerald-600',
            permission: 'read',
            enabled: true,
            provider: model.provider,
            modelId: model.id,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Current task',
            description: 'Main room.',
            roleIds: ['orchestrator', 'builder'],
          },
        ],
      },
      model
    )!
    const controller = new AbortController()

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Start then abort.',
      abortSignal: controller.signal,
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'call_roles',
          mode: 'parallel',
          reason: 'Call builder.',
          calls: [
            {
              roleId: 'builder',
              channelId: 'task',
              instruction: 'Work until aborted.',
            },
          ],
        }),
      generateRoleText: async () => {
        controller.abort()
        throw new Error('aborted')
      },
    })

    expect(result.status).toBe('stopped')
    expect(result.config.runtime.run?.status).toBe('stopped')
    expect(result.config.runtime.run?.error).toBeUndefined()
    expect(
      result.config.runtime.teamEvents.some(
        (event) => event.type === 'run_failed'
      )
    ).toBe(false)
  })

  it('does not fallback into default worker calls when orchestrator JSON cannot be repaired', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let roleCallCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Do something ambiguous.',
      generateDecisionText: async () => 'not json',
      generateRoleText: async () => {
        roleCallCount += 1
        return 'Should not run.'
      },
    })

    expect(result.status).toBe('failed')
    expect(roleCallCount).toBe(0)
    expect(Object.keys(result.config.runtime.roleStates)).toEqual([
      'orchestrator',
    ])
    expect(result.config.runtime.userChoiceRequest).toBeUndefined()
  })

  it('filters role calls that ask for permissions the role does not have', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let roleCallCount = 0
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: 'Implement a tiny fix.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount > 1) {
          return JSON.stringify({
            action: 'stop',
            reason: 'Permission filtering verified.',
            finalResponse: 'Only the write role ran.',
          })
        }

        return JSON.stringify({
          action: 'configure_team',
          mode: 'parallel',
          reason: 'Need one writer and one reader.',
          roles: [
            {
              id: 'builder',
              name: 'Builder',
              label: 'Build',
              description: 'Writes changes.',
              prompt: 'Draft the implementation.',
              permission: 'write',
            },
            {
              id: 'reader',
              name: 'Reader',
              label: 'Read',
              description: 'Reads only.',
              prompt: 'Review context.',
              permission: 'read',
            },
          ],
          channels: [
            {
              id: 'build',
              label: 'Build',
              description: 'Build work.',
              roleIds: ['builder', 'reader'],
            },
          ],
          calls: [
            {
              roleId: 'builder',
              channelId: 'build',
              instruction: 'Draft a write-capable change.',
              requiredPermission: 'write',
            },
            {
              roleId: 'reader',
              channelId: 'build',
              instruction: 'Pretend to write.',
              requiredPermission: 'write',
            },
          ],
        })
      },
      generateRoleText: async ({ role }) => {
        roleCallCount += 1
        return `Decision: ${role.name} handled the allowed call.`
      },
    })

    expect(result.status).toBe('completed')
    expect(roleCallCount).toBe(1)
    expect(result.config.runtime.roleStates.builder?.memory.version).toBe(1)
    expect(result.config.runtime.roleStates.reader?.memory.version).toBe(0)
  })

  it('honors owner requests to only call a mentioned role', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-5',
    }
    const base = createDefaultMitaTeamsConfig(model)
    const config = normalizeMitaTeamsConfig(
      {
        ...base,
        roles: [
          ...base.roles,
          {
            id: 'reader',
            name: 'Reader',
            label: 'Read',
            description: 'Reads context.',
            prompt: 'Read and summarize.',
            color: 'bg-sky-600',
            permission: 'read',
            enabled: true,
          },
          {
            id: 'builder',
            name: 'Builder',
            label: 'Build',
            description: 'Builds changes.',
            prompt: 'Draft implementation.',
            color: 'bg-emerald-600',
            permission: 'write',
            enabled: true,
          },
        ],
        channels: [
          {
            id: 'task',
            label: 'Current task',
            description: 'Main room.',
            roleIds: ['orchestrator', 'reader', 'builder'],
          },
        ],
      },
      model
    )!
    let decisionCount = 0
    const calledRoles: string[] = []

    const result = await runMitaTeamsRuntime({
      config: approveRuntimeForExecution(config),
      userText: '只让 @reader 看一下这个方案。',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount > 1) {
          return JSON.stringify({
            action: 'stop',
            reason: 'Mentioned role finished.',
            finalResponse: 'Reader only.',
          })
        }

        return JSON.stringify({
          action: 'call_roles',
          mode: 'parallel',
          reason: 'Ask both roles, but owner constrained this run.',
          calls: [
            {
              roleId: 'reader',
              channelId: 'task',
              instruction: 'Read only.',
            },
            {
              roleId: 'builder',
              channelId: 'task',
              instruction: 'Build anyway.',
            },
          ],
        })
      },
      generateRoleText: async ({ role }) => {
        calledRoles.push(role.id)
        return `Decision: ${role.name} responded.`
      },
    })

    expect(result.status).toBe('completed')
    expect(calledRoles).toEqual(['reader'])
    expect(result.config.runtime.roleStates.reader?.memory.version).toBe(1)
    expect(result.config.runtime.roleStates.builder?.memory.version).toBe(0)
  })

  it('returns a single-choice request when the orchestrator asks the owner', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })

    const result = await runMitaTeamsRuntime({
      config,
      userText: 'Choose launch scope.',
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'ask_user',
          reason: 'Scope affects the next plan.',
          question: 'Which launch scope should Biyan Teams use?',
          options: [
            { id: 'Small Beta', label: 'Small beta' },
            { id: 'Small Beta', label: 'Full launch' },
          ],
        }),
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('waiting-for-user')
    expect(result.config.runtime.userChoiceRequest?.status).toBe('pending')
    expect(result.config.runtime.userChoiceRequest?.options).toHaveLength(2)
    expect(
      result.config.runtime.userChoiceRequest?.options.map(
        (option) => option.id
      )
    ).toEqual(['small-beta', 'small-beta-2'])
    expect(result.choiceRequestId).toBeTruthy()
  })

  it('proposes a plan draft and waits for owner approval before role execution', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const roleCalls: string[] = []

    const result = await runMitaTeamsRuntime({
      config,
      userText: 'Build a safer billing export flow.',
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'propose_plan',
          reason: 'Owner should approve the execution plan first.',
          plan: {
            goal: 'Build a safer billing export flow.',
            summary: 'Clarify export boundaries, implement the flow, and verify it.',
            scope: ['Inspect current export code', 'Add focused tests'],
            acceptanceCriteria: ['Owner can approve before execution starts'],
            tasks: [
              {
                title: 'Inspect export flow',
                roleId: 'orchestrator',
                description: 'Find the current implementation boundary.',
              },
            ],
            roleAssignments: [
              {
                roleId: 'orchestrator',
                name: 'Orchestrator',
                assignment: 'Own plan and final synthesis.',
              },
            ],
            executionOrder: ['Inspect export flow'],
          },
        }),
      generateRoleText: async ({ role }) => {
        roleCalls.push(role.id)
        return 'unused'
      },
    })

    expect(result.status).toBe('waiting-for-user')
    expect(roleCalls).toEqual([])
    expect(result.config.runtime.phase).toBe('awaiting_plan_approval')
    expect(result.config.runtime.planDraft).toMatchObject({
      goal: 'Build a safer billing export flow.',
      status: 'draft',
    })
    expect(result.config.runtime.userChoiceRequest).toMatchObject({
      kind: 'plan_approval',
      status: 'pending',
    })
  })

  it('converts premature execution decisions into a plan approval request', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let roleCallCount = 0

    const result = await runMitaTeamsRuntime({
      config,
      userText: 'Draft a short launch checklist.',
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'call_roles',
          mode: 'serial',
          reason: 'The orchestrator tried to execute too early.',
          calls: [
            {
              roleId: 'orchestrator',
              channelId: 'task',
              instruction: 'Draft the launch checklist.',
            },
          ],
        }),
      generateRoleText: async () => {
        roleCallCount += 1
        return 'Should not run before approval.'
      },
    })

    expect(result.status).toBe('waiting-for-user')
    expect(roleCallCount).toBe(0)
    expect(result.config.runtime.phase).toBe('awaiting_plan_approval')
    expect(result.config.runtime.planDraft).toMatchObject({
      goal: 'Draft a short launch checklist.',
      tasks: [
        expect.objectContaining({
          title: 'Draft the launch checklist.',
          roleId: 'orchestrator',
        }),
      ],
    })
    expect(result.config.runtime.userChoiceRequest).toMatchObject({
      kind: 'plan_approval',
      status: 'pending',
    })
  })

  it('executes role calls only after the plan has been approved', async () => {
    const base = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const planned = await runMitaTeamsRuntime({
      config: base,
      userText: 'Prepare a launch checklist.',
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'propose_plan',
          reason: 'Plan first.',
          plan: {
            goal: 'Prepare a launch checklist.',
            summary: 'Inspect, build, and review.',
            scope: ['Release checklist'],
            acceptanceCriteria: ['Checklist reviewed'],
            tasks: [{ title: 'Review launch checks', roleId: 'orchestrator' }],
            roleAssignments: [
              {
                roleId: 'orchestrator',
                name: 'Orchestrator',
                assignment: 'Coordinate execution.',
              },
            ],
            executionOrder: ['Review launch checks'],
          },
        }),
      generateRoleText: async () => 'unused',
    })
    const approved = approveMitaTeamsPlan(planned.config)
    const calledRoles: string[] = []
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config: approved,
      userText: 'Plan approved. Continue.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'call_roles',
            mode: 'serial',
            reason: 'Approved plan can now execute.',
            calls: [
              {
                roleId: 'orchestrator',
                channelId: 'task',
                instruction: 'Start the approved checklist.',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Approved work is complete.',
          finalResponse: 'Checklist ready.',
        })
      },
      generateRoleText: async ({ role }) => {
        calledRoles.push(role.id)
        return 'Decision: Approved plan executed.'
      },
    })

    expect(approved.runtime.approvedPlan?.goal).toBe('Prepare a launch checklist.')
    expect(result.status).toBe('completed')
    expect(calledRoles).toEqual(['orchestrator'])
    expect(result.config.runtime.phase).toBe('completed')
  })

  it('materializes approved plan role assignments before execution starts', async () => {
    const base = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const planned = normalizeMitaTeamsConfig(
      {
        ...base,
        runtime: {
          ...base.runtime,
          phase: 'awaiting_plan_approval',
          planDraft: {
            id: 'plan-1',
            version: 1,
            status: 'draft',
            goal: 'Design mita.md generation.',
            summary: 'Create roles from the approved plan.',
            scope: ['Schema', 'Generator'],
            acceptanceCriteria: ['The builder role executes.'],
            tasks: [
              {
                id: 'task-1',
                title: 'Draft generator pseudocode',
                roleId: 'mita_builder',
              },
            ],
            roleAssignments: [
              {
                roleId: 'mita_builder',
                name: 'Mita Builder',
                assignment: 'Turn the approved mita.md plan into generator logic.',
                model: 'openai/gpt-5',
                prompt: 'You build concrete mita.md generator logic.',
              },
            ],
            executionOrder: ['Draft generator pseudocode'],
            createdAt: '2026-06-08T00:00:00.000Z',
            updatedAt: '2026-06-08T00:00:00.000Z',
          },
        },
      },
      { provider: 'openai', id: 'gpt-5' }
    )!
    const approved = approveMitaTeamsPlan(planned)
    const calledRoles: string[] = []
    let decisionCount = 0

    expect(approved.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mita_builder',
          name: 'Mita Builder',
          prompt: 'You build concrete mita.md generator logic.',
          provider: 'openai',
          modelId: 'gpt-5',
          enabled: true,
        }),
      ])
    )
    expect(approved.runtime.approvedRoleSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mita_builder',
          name: 'Mita Builder',
        }),
      ])
    )

    const result = await runMitaTeamsRuntime({
      config: approved,
      userText: 'Approved Biyan Teams plan. Continue.',
      generateDecisionText: async () => {
        decisionCount += 1
        if (decisionCount === 1) {
          return JSON.stringify({
            action: 'call_roles',
            mode: 'serial',
            reason: 'Execute the materialized builder role.',
            calls: [
              {
                roleId: 'mita_builder',
                channelId: 'build',
                instruction: 'Draft the generator pseudocode.',
                requiredPermission: 'read',
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Builder finished.',
          finalResponse: 'Generator pseudocode ready.',
        })
      },
      generateRoleText: async ({ role }) => {
        calledRoles.push(role.id)
        return 'Builder output.'
      },
    })

    expect(result.status).toBe('completed')
    expect(calledRoles).toEqual(['mita_builder'])
  })

  it('rejects owner questions after a plan has already been approved', async () => {
    const base = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const approved = approveMitaTeamsPlan(
      normalizeMitaTeamsConfig(
        {
          ...base,
          runtime: {
            ...base.runtime,
            phase: 'awaiting_plan_approval',
            planDraft: {
              id: 'plan-1',
              version: 1,
              status: 'draft',
              goal: 'Research memory policy.',
              summary: 'Ask blocking questions before approval.',
              scope: ['Memory policy'],
              acceptanceCriteria: ['No post-approval owner question.'],
              tasks: [
                {
                  id: 'task-1',
                  title: 'Execute approved memory policy research',
                  roleId: 'orchestrator',
                },
              ],
              roleAssignments: [
                {
                  roleId: 'orchestrator',
                  name: 'Orchestrator',
                  assignment: 'Coordinate.',
                },
              ],
              executionOrder: ['Execute approved memory policy research'],
              createdAt: '2026-06-08T00:00:00.000Z',
              updatedAt: '2026-06-08T00:00:00.000Z',
            },
          },
        },
        { provider: 'openai', id: 'gpt-5' }
      )!
    )

    const result = await runMitaTeamsRuntime({
      config: approved,
      userText: 'Approved Biyan Teams plan. Continue.',
      generateDecisionText: async () =>
        JSON.stringify({
          action: 'ask_user',
          reason: 'This should have been asked before approval.',
          question: 'Enable auto memory?',
          options: [{ id: 'yes', label: 'Yes' }],
        }),
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('failed')
    expect(result.config.runtime.userChoiceRequest).toBeUndefined()
    expect(result.config.runtime.run?.error).toContain(
      'cannot ask the owner after plan approval'
    )
  })

  it('asks whether to keep role edits before applying a plan revision', () => {
    const base = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    const planned = normalizeMitaTeamsConfig(
      {
        ...base,
        runtime: {
          ...base.runtime,
          phase: 'awaiting_plan_approval',
          planDraft: {
            id: 'plan-1',
            version: 1,
            status: 'draft',
            goal: 'Draft launch plan.',
            summary: 'Draft first.',
            scope: ['Launch'],
            acceptanceCriteria: ['Approved'],
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
      },
      { provider: 'openai', id: 'gpt-5' }
    )!
    const edited = markMitaTeamsRoleUserEdit(planned, 'orchestrator', [
      'prompt',
      'modelId',
    ])

    const revised = requestMitaTeamsPlanRevision(
      edited,
      'Add a reviewer before execution.'
    )

    expect(revised.runtime.phase).toBe('awaiting_role_edit_confirmation')
    expect(revised.runtime.pendingPlanRevision).toBe(
      'Add a reviewer before execution.'
    )
    expect(revised.runtime.userChoiceRequest).toMatchObject({
      kind: 'keep_role_edits',
      status: 'pending',
    })
    expect(
      revised.runtime.userChoiceRequest?.options.map((option) => option.id)
    ).toEqual(['keep', 'discard'])
  })
})
