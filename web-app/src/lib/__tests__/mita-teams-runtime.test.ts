import { describe, expect, it } from 'vitest'

import { runMitaTeamsRuntime } from '@/lib/mita-teams-runtime'
import { ProviderQuotaError } from '@/lib/provider-quota-error'
import {
  createDefaultMitaTeamsConfig,
  normalizeMitaTeamsConfig,
} from '@/types/mita-teams'

describe('mita teams runtime', () => {
  it('configures a minimal team, runs channel-scoped role calls, and merges memory', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'jingxing',
      id: 'gpt-5',
    })
    const updates: Array<typeof config> = []
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config,
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

  it('repairs invalid orchestrator JSON once before continuing', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let decisionCalls = 0

    const result = await runMitaTeamsRuntime({
      config,
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
      config,
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
      'Mita Teams 运行失败：Mita Teams runtime failed'
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
      config,
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
      config,
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

  it('aggregates orchestrator and role token usage across a run', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config,
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
      config,
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
      config,
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
      config,
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
      config,
      userText: 'Do something ambiguous.',
      generateDecisionText: async () => 'not json',
      generateRoleText: async () => {
        roleCallCount += 1
        return 'Should not run.'
      },
    })

    expect(result.status).toBe('waiting-for-user')
    expect(roleCallCount).toBe(0)
    expect(Object.keys(result.config.runtime.roleStates)).toEqual([
      'orchestrator',
    ])
    expect(result.config.runtime.userChoiceRequest?.options).toHaveLength(2)
  })

  it('filters role calls that ask for permissions the role does not have', async () => {
    const config = createDefaultMitaTeamsConfig({
      provider: 'openai',
      id: 'gpt-5',
    })
    let roleCallCount = 0
    let decisionCount = 0

    const result = await runMitaTeamsRuntime({
      config,
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
      config,
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
          question: 'Which launch scope should Mita Teams use?',
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
})
