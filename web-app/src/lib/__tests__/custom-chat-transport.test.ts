import { describe, expect, it } from 'vitest'

import {
  getProtectedMaxOutputTokens,
  JINGXING_REMOTE_MIN_OUTPUT_TOKENS,
  normalizeToolInputSchema,
} from '../custom-chat-transport'

describe('normalizeToolInputSchema', () => {
  it('adds empty properties for object schemas without properties', () => {
    expect(normalizeToolInputSchema({ type: 'object' })).toEqual({
      type: 'object',
      properties: {},
    })
  })

  it('adds string type for description-only leaves', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          url: {
            description: 'Target URL',
          },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        url: {
          description: 'Target URL',
          type: 'string',
        },
      },
    })
  })

  it('normalizes nested object and array schemas recursively', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          filters: {
            type: 'object',
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          properties: {},
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {},
          },
        },
      },
    })
  })

  it('preserves already valid schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        payload: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
            },
          },
          required: ['id'],
        },
      },
    }

    expect(normalizeToolInputSchema(schema)).toEqual(schema)
  })

  it('patches only underspecified nodes in mixed schemas', () => {
    expect(
      normalizeToolInputSchema({
        type: 'object',
        properties: {
          count: {
            type: 'integer',
          },
          title: {
            description: 'A title',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata',
          },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        count: {
          type: 'integer',
        },
        title: {
          description: 'A title',
          type: 'string',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata',
          properties: {},
        },
      },
    })
  })

  it('normalizes combinator members recursively', () => {
    expect(
      normalizeToolInputSchema({
        anyOf: [
          {
            type: 'object',
          },
          {
            description: 'fallback string',
          },
        ],
        oneOf: [
          {
            type: 'object',
          },
        ],
        allOf: [
          {
            description: 'merged leaf',
          },
        ],
      })
    ).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: {},
        },
        {
          description: 'fallback string',
          type: 'string',
        },
      ],
      oneOf: [
        {
          type: 'object',
          properties: {},
        },
      ],
      allOf: [
        {
          description: 'merged leaf',
          type: 'string',
        },
      ],
    })
  })
})

describe('getProtectedMaxOutputTokens', () => {
  it('raises Jingxing remote output tokens below the shared floor', () => {
    expect(getProtectedMaxOutputTokens('gemini-3.5-flash', undefined)).toBe(
      JINGXING_REMOTE_MIN_OUTPUT_TOKENS
    )
    expect(getProtectedMaxOutputTokens('gemini-3.5-flash', 64)).toBe(
      JINGXING_REMOTE_MIN_OUTPUT_TOKENS
    )
    expect(getProtectedMaxOutputTokens('gemini-3.5-flash', 1024)).toBe(
      JINGXING_REMOTE_MIN_OUTPUT_TOKENS
    )
    expect(getProtectedMaxOutputTokens('gemini-3.5-flash', 2048)).toBe(
      JINGXING_REMOTE_MIN_OUTPUT_TOKENS
    )
    expect(getProtectedMaxOutputTokens('gemini-3-flash-preview', 64)).toBe(
      JINGXING_REMOTE_MIN_OUTPUT_TOKENS
    )
    expect(getProtectedMaxOutputTokens('gpt-5.4', 8192)).toBe(8192)
  })

  it('does not apply the Jingxing floor without a model id', () => {
    expect(getProtectedMaxOutputTokens(undefined, 64)).toBe(64)
    expect(getProtectedMaxOutputTokens(undefined, undefined)).toBeUndefined()
  })
})
