import { describe, expect, it } from 'vitest'

import { runMitaTeamsRuntime } from '@/lib/mita-teams-runtime'
import { createDefaultMitaTeamsConfig } from '@/types/mita-teams'

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
                group: 1,
              },
              {
                roleId: 'release-reviewer',
                channelId: 'release-review',
                instruction: 'Review the plan.',
                group: 2,
              },
            ],
          })
        }

        return JSON.stringify({
          action: 'stop',
          reason: 'Enough role evidence was gathered.',
          finalResponse: 'Final checklist is ready.',
        })
      },
      generateRoleText: async ({ role }) =>
        `Fact: ${role.name} confirmed one constraint.\nDecision: Keep the checklist scoped.\nOpen question: Should the owner approve release timing?`,
    })

    expect(result.status).toBe('completed')
    expect(result.finalResponse).toBe('Final checklist is ready.')
    expect(updates.length).toBeGreaterThan(1)
    expect(result.config.roles.map((role) => role.id)).toEqual([
      'orchestrator',
      'release-researcher',
      'release-reviewer',
    ])
    expect(result.config.channels.find((channel) => channel.id === 'release-research')?.roleIds).toEqual([
      'release-researcher',
    ])
    expect(
      result.config.runtime.roleStates['release-researcher']?.memory.version
    ).toBe(1)
    expect(
      result.config.runtime.roleStates['release-reviewer']?.stream[0]
        ?.channelId
    ).toBe('release-review')
    expect(result.config.runtime.projectMemory.version).toBeGreaterThan(0)
    expect(result.config.runtime.projectMemory.facts.join('\n')).toContain(
      'confirmed one constraint'
    )
  })

  it('does not fallback into default worker calls when orchestrator JSON is invalid', async () => {
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

    expect(result.status).toBe('completed')
    expect(roleCallCount).toBe(0)
    expect(Object.keys(result.config.runtime.roleStates)).toEqual([
      'orchestrator',
    ])
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
