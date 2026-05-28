import { describe, expect, it } from 'vitest'

import { runMitaTeamsRuntime } from '@/lib/mita-teams-runtime'
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
            { id: 'small', label: 'Small beta' },
            { id: 'full', label: 'Full launch' },
          ],
        }),
      generateRoleText: async () => 'unused',
    })

    expect(result.status).toBe('waiting-for-user')
    expect(result.config.runtime.userChoiceRequest?.status).toBe('pending')
    expect(result.config.runtime.userChoiceRequest?.options).toHaveLength(2)
    expect(result.choiceRequestId).toBeTruthy()
  })
})
