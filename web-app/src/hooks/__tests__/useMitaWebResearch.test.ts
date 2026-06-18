import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MITA_WEB_RESEARCH_MCP_NAME } from '@/constants/mcp'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockEditServer = vi.fn()
const mockSyncServers = vi.fn().mockResolvedValue(undefined)
const mockActivateMCPServer = vi.fn().mockResolvedValue(undefined)
const mockDeactivateMCPServer = vi.fn().mockResolvedValue(undefined)
let mockMcpServers: Record<string, any> = {}

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: () => ({
    mcpServers: mockMcpServers,
    editServer: mockEditServer,
    syncServers: mockSyncServers,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    mcp: () => ({
      activateMCPServer: mockActivateMCPServer,
      deactivateMCPServer: mockDeactivateMCPServer,
    }),
  }),
}))

describe('useMitaWebResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMcpServers = {}
    mockActivateMCPServer.mockResolvedValue(undefined)
    mockDeactivateMCPServer.mockResolvedValue(undefined)
    mockSyncServers.mockResolvedValue(undefined)
  })

  it('returns initial state when no config exists', async () => {
    const { useMitaWebResearch } = await import('../useMitaWebResearch')
    const { result } = renderHook(() => useMitaWebResearch())

    expect(result.current.hasConfig).toBe(false)
    expect(result.current.isActive).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })

  it('activates Biyan Web Research', async () => {
    const config = { command: 'mita-web-research', args: [], env: {}, active: false }
    mockMcpServers = {
      [MITA_WEB_RESEARCH_MCP_NAME]: config,
    }

    const { useMitaWebResearch } = await import('../useMitaWebResearch')
    const { result } = renderHook(() => useMitaWebResearch())

    await act(async () => {
      await result.current.setActive(true)
    })

    expect(mockActivateMCPServer).toHaveBeenCalledWith(
      MITA_WEB_RESEARCH_MCP_NAME,
      expect.objectContaining({ active: true })
    )
    expect(mockEditServer).toHaveBeenCalledWith(
      MITA_WEB_RESEARCH_MCP_NAME,
      expect.objectContaining({ active: true })
    )
  })

  it('deactivates Biyan Web Research', async () => {
    const config = { command: 'mita-web-research', args: [], env: {}, active: true }
    mockMcpServers = {
      [MITA_WEB_RESEARCH_MCP_NAME]: config,
    }

    const { useMitaWebResearch } = await import('../useMitaWebResearch')
    const { result } = renderHook(() => useMitaWebResearch())

    await act(async () => {
      await result.current.setActive(false)
    })

    expect(mockDeactivateMCPServer).toHaveBeenCalledWith(MITA_WEB_RESEARCH_MCP_NAME)
    expect(mockEditServer).toHaveBeenCalledWith(
      MITA_WEB_RESEARCH_MCP_NAME,
      expect.objectContaining({ active: false })
    )
  })

  it('returns false and shows an error when config is missing', async () => {
    const { toast } = await import('sonner')
    const { useMitaWebResearch } = await import('../useMitaWebResearch')
    const { result } = renderHook(() => useMitaWebResearch())

    let ok = true
    await act(async () => {
      ok = await result.current.setActive(true)
    })

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      'Biyan Web Research not found',
      expect.any(Object)
    )
  })
})
