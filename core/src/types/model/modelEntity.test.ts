import { test, expect } from 'vitest'
import { ModelInfo } from '../model'

test('preserves historical model references stored with threads', () => {
  const model: ModelInfo = {
    id: 'model1',
    settings: { ctx_len: 100, ngl: 50, embedding: true },
    parameters: { temperature: 0.5, token_limit: 100, top_k: 10 },
    engine: 'anthropic',
  }

  expect(model.id).toBe('model1')
  expect(model.settings).toEqual({ ctx_len: 100, ngl: 50, embedding: true })
  expect(model.parameters).toEqual({
    temperature: 0.5,
    token_limit: 100,
    top_k: 10,
  })
  expect(model.engine).toBe('anthropic')
})
