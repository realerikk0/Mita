import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { ModelCapabilities } from '@/types/models'
import { DefaultStoryboardGenerationService } from '../default'

class LocalHttpStoryboardGenerationService extends DefaultStoryboardGenerationService {
  protected fetch(): typeof globalThis.fetch {
    return ((input, init) => {
      const { signal: _signal, ...requestInit } = init || {}
      return globalThis.fetch(input, requestInit)
    }) as typeof globalThis.fetch
  }
}

const model = {
  id: 'gpt-5-mini',
  capabilities: [ModelCapabilities.COMPLETION],
} as Model

describe('Storyboard local streaming chain', () => {
  let server: Server | undefined

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve()
        return
      }
      server.close((error) => (error ? reject(error) : resolve()))
    })
    server = undefined
  })

  it('keeps the request alive with pings and assembles split model output', async () => {
    let requestBody = ''
    let pingHeader = ''
    const content = JSON.stringify({
      shots: [
        {
          title: 'Arrival',
          camera: 'Wide establishing shot',
          prompt: 'A traveler arrives at a luminous station.',
          duration: 5,
        },
      ],
      storyboardPrompt: 'One cinematic storyboard panel.',
    })
    const splitAt = Math.floor(content.length / 2)

    server = createServer((request, response) => {
      pingHeader = String(request.headers['x-oneapi-stream-ping'] || '')
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        requestBody += chunk
      })
      request.on('end', () => {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        response.flushHeaders()
        response.write(': PING\n\n')
        setTimeout(() => {
          response.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: content.slice(0, splitAt) } }],
            })}\n\n`
          )
        }, 20)
        setTimeout(() => {
          response.write(': PING\r\n\r\n')
          response.write(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: { content: content.slice(splitAt) },
                  finish_reason: 'stop',
                },
              ],
            })}\r\n\r\n`
          )
          response.end('data: [DONE]\n\n')
        }, 40)
      })
    })

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const provider = {
      provider: 'biyuan',
      base_url: `http://127.0.0.1:${address.port}/v1`,
      api_key: 'test-key',
      models: [],
      settings: [],
    } as unknown as ModelProvider

    const service = new LocalHttpStoryboardGenerationService()
    const result = await service.breakdownStoryboard({
      provider,
      model,
      story: 'A traveler reaches a station.',
      style: 'Cinematic',
      aspect: '16:9',
      shotCount: 1,
      template: 'board',
      systemPrompt: 'Keep the traveler consistent.',
      durationPerShot: 5,
    })

    expect(pingHeader).toBe('true')
    expect(JSON.parse(requestBody).stream).toBe(true)
    expect(result.storyboardPrompt).toBe('One cinematic storyboard panel.')
    expect(result.shots[0]?.prompt).toBe(
      'A traveler arrives at a luminous station.'
    )
  })
})
