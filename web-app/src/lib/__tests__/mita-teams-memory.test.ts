import { describe, expect, it } from 'vitest'

import { answerMitaTeamsChoice } from '@/lib/mita-teams-memory'
import { createDefaultMitaTeamsRuntime } from '@/types/mita-teams'

describe('mita teams memory', () => {
  it('does not answer a choice with an unknown option id', () => {
    const runtime = {
      ...createDefaultMitaTeamsRuntime(),
      userChoiceRequest: {
        id: 'choice-1',
        question: 'Pick a path.',
        options: [{ id: 'small', label: 'Small beta' }],
        status: 'pending' as const,
        createdAt: '2026-05-29T00:00:00.000Z',
      },
    }

    const result = answerMitaTeamsChoice(runtime, 'missing')

    expect(result.userChoiceRequest?.status).toBe('pending')
    expect(result.userChoiceRequest?.selectedOptionId).toBeUndefined()
    expect(result.teamEvents).toEqual([])
  })
})
