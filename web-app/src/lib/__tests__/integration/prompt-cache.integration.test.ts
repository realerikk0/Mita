//
// 2.3 integration: the Anthropic system-prefix cache. A stable system message
// tagged with cacheControl:ephemeral must be WRITTEN to cache on the first call
// and READ from cache on the second. Requires the Anthropic-native channel
// (createAnthropic) + a caching model (sonnet-4-6). Skipped unless creds present.
//
import { describe, it, expect } from 'vitest'
import { streamText, type ModelMessage } from 'ai'
import {
  hasAnthropicIntegration,
  makeAnthropicModel,
} from './integration-helpers'

const runIf = hasAnthropicIntegration() ? describe : describe.skip

// Unique per run so the first call always WRITES a fresh cache entry (the
// ephemeral cache otherwise survives ~5 min across runs). Must exceed the
// provider's ~1k-token minimum cacheable size.
const SYSTEM =
  `Session ${Date.now()}. You are a meticulous assistant. ` +
  'Follow instructions precisely and cite sources. '.repeat(220)

function startCall() {
  const messages: ModelMessage[] = [
    {
      role: 'system',
      content: SYSTEM,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    { role: 'user', content: 'Reply with exactly the word: OK' },
  ]
  return streamText({ model: makeAnthropicModel(), messages })
}

async function drainAndReadCache(result: ReturnType<typeof startCall>) {
  for await (const _ of result.textStream) void _
  const anthropic = (await result.providerMetadata)?.anthropic as
    | {
        cacheCreationInputTokens?: number
        usage?: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
        }
      }
    | undefined
  return {
    created:
      anthropic?.cacheCreationInputTokens ??
      anthropic?.usage?.cache_creation_input_tokens ??
      0,
    read: anthropic?.usage?.cache_read_input_tokens ?? 0,
  }
}

runIf('2.3 Anthropic system-prefix caching (live provider)', () => {
  it('writes the system cache, then reads it on a repeat call', async () => {
    const first = await drainAndReadCache(startCall())
    expect(first.created).toBeGreaterThan(0)

    // Let the server-side cache write settle before the repeat call.
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    const second = await drainAndReadCache(startCall())
    expect(second.read).toBeGreaterThan(0)
  }, 90_000)
})
