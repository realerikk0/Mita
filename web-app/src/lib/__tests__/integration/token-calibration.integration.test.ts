//
// 2.1 integration: confirm the provider returns a real input-token count and
// that feeding it into the calibration store moves the per-model estimate
// toward the true chars-per-token ratio. Skipped unless creds are present.
//
import { describe, it, expect, beforeEach } from 'vitest'
import { streamText } from 'ai'
import { DEFAULT_CHARS_PER_TOKEN } from '../../context-manager'
import { useTokenCalibration } from '@/stores/token-calibration-store'
import {
  hasOpenAICompatIntegration,
  openaiCompatCreds,
  makeOpenAICompatModel,
} from './integration-helpers'

const runIf = hasOpenAICompatIntegration() ? describe : describe.skip

runIf('2.1 token calibration (live provider)', () => {
  beforeEach(() => {
    useTokenCalibration.setState({ factors: {} })
  })

  it('records a real input-token count and calibrates toward reality', async () => {
    const system =
      'You are a precise assistant. ' + 'Answer concisely. '.repeat(120)
    const userText = 'Reply with exactly the word: OK'
    const inputChars = system.length + userText.length

    const result = streamText({
      model: makeOpenAICompatModel(),
      system,
      messages: [{ role: 'user', content: userText }],
    })
    // Drain the stream, then read the resolved usage.
    for await (const _ of result.textStream) void _
    const usage = await result.usage
    const inputTokens = usage?.inputTokens ?? 0

    // The provider must report a usable input-token count.
    expect(inputTokens).toBeGreaterThan(50)

    const realRatio = inputChars / inputTokens
    // Sanity: real chars/token for English prose sits well inside the band.
    expect(realRatio).toBeGreaterThan(2)
    expect(realRatio).toBeLessThan(6)

    const modelId = openaiCompatCreds().model
    const before = useTokenCalibration.getState().getCharsPerToken(modelId)
    expect(before).toBe(DEFAULT_CHARS_PER_TOKEN)

    useTokenCalibration.getState().recordSample(modelId, inputChars, inputTokens)
    const after = useTokenCalibration.getState().getCharsPerToken(modelId)

    // The estimate moved off the default, toward the observed ratio.
    expect(after).not.toBe(before)
    expect(Math.abs(after - realRatio)).toBeLessThan(Math.abs(before - realRatio))
  }, 60_000)
})
