import { describe, expect, it, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { sanitizeUserLogText, writeUserLog } from '../user-log'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
}))

describe('user-log helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  it('redacts secrets, credentialed URLs, and home paths from free text', () => {
    const result = sanitizeUserLogText(
      'Authorization: Bearer sk-secret api_key=abc123 url https://user:pass@example.com/api?token=abc#frag path /Users/owner/private.txt C:\\Users\\owner\\secret.txt'
    )

    expect(result).not.toContain('sk-secret')
    expect(result).not.toContain('abc123')
    expect(result).not.toContain('user:pass')
    expect(result).not.toContain('token=abc')
    expect(result).not.toContain('/Users/owner')
    expect(result).not.toContain('C:\\Users\\owner')
    expect(result).toContain('https://example.com/api?[redacted]#[redacted]')
  })

  it('sanitizes payloads before invoking the Tauri command', async () => {
    await writeUserLog({
      level: 'error',
      target: 'test',
      event: 'request.failed',
      message: 'Bearer sk-secret request failed',
      context: {
        url: 'https://user:pass@example.com/api?token=abc',
        filename: '/Users/owner/private.txt',
      },
      error: new Error('api_key=abc123'),
    })

    const payload = vi.mocked(invoke).mock.calls[0]?.[1] as {
      entry: Record<string, unknown>
    }
    const serialized = JSON.stringify(payload.entry)

    expect(invoke).toHaveBeenCalledWith('write_user_log', {
      entry: expect.any(Object),
    })
    expect(serialized).not.toContain('sk-secret')
    expect(serialized).not.toContain('abc123')
    expect(serialized).not.toContain('user:pass')
    expect(serialized).not.toContain('token=abc')
    expect(serialized).not.toContain('/Users/owner')
  })
})
