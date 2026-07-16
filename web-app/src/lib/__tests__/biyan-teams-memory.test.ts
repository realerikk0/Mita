import { describe, expect, it } from 'vitest'

import { answerBiyanTeamsChoice } from '@/lib/biyan-teams-memory'
import { createDefaultBiyanTeamsRuntime } from '@/types/biyan-teams'

describe('biyan teams memory', () => {
  it('does not answer a choice with an unknown option id', () => {
    const runtime = {
      ...createDefaultBiyanTeamsRuntime(),
      userChoiceRequest: {
        id: 'choice-1',
        question: 'Pick a path.',
        options: [{ id: 'small', label: 'Small beta' }],
        status: 'pending' as const,
        createdAt: '2026-05-29T00:00:00.000Z',
      },
    }

    const result = answerBiyanTeamsChoice(runtime, 'missing')

    expect(result.userChoiceRequest?.status).toBe('pending')
    expect(result.userChoiceRequest?.selectedOptionId).toBeUndefined()
    expect(result.teamEvents).toEqual([])
  })
})
