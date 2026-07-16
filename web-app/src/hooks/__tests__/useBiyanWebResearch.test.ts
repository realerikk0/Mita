import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { BIYAN_WEB_RESEARCH_MCP_NAME } from '@/constants/mcp'

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

describe('useBiyanWebResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMcpServers = {}
    mockActivateMCPServer.mockResolvedValue(undefined)
    mockDeactivateMCPServer.mockResolvedValue(undefined)
    mockSyncServers.mockResolvedValue(undefined)
  })

  it('returns initial state when no config exists', async () => {
    const { useBiyanWebResearch } = await import('../useBiyanWebResearch')
    const { result } = renderHook(() => useBiyanWebResearch())

    expect(result.current.hasConfig).toBe(false)
    expect(result.current.isActive).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })

  it('activates Biyan Web Research', async () => {
    const config = { command: 'biyan-web-research', args: [], env: {}, active: false }
    mockMcpServers = {
      [BIYAN_WEB_RESEARCH_MCP_NAME]: config,
    }

    const { useBiyanWebResearch } = await import('../useBiyanWebResearch')
    const { result } = renderHook(() => useBiyanWebResearch())

    await act(async () => {
      await result.current.setActive(true)
    })

    expect(mockActivateMCPServer).toHaveBeenCalledWith(
      BIYAN_WEB_RESEARCH_MCP_NAME,
      expect.objectContaining({ active: true })
    )
    expect(mockEditServer).toHaveBeenCalledWith(
      BIYAN_WEB_RESEARCH_MCP_NAME,
      expect.objectContaining({ active: true })
    )
  })

  it('deactivates Biyan Web Research', async () => {
    const config = { command: 'biyan-web-research', args: [], env: {}, active: true }
    mockMcpServers = {
      [BIYAN_WEB_RESEARCH_MCP_NAME]: config,
    }

    const { useBiyanWebResearch } = await import('../useBiyanWebResearch')
    const { result } = renderHook(() => useBiyanWebResearch())

    await act(async () => {
      await result.current.setActive(false)
    })

    expect(mockDeactivateMCPServer).toHaveBeenCalledWith(BIYAN_WEB_RESEARCH_MCP_NAME)
    expect(mockEditServer).toHaveBeenCalledWith(
      BIYAN_WEB_RESEARCH_MCP_NAME,
      expect.objectContaining({ active: false })
    )
  })

  it('returns false and shows an error when config is missing', async () => {
    const { toast } = await import('sonner')
    const { useBiyanWebResearch } = await import('../useBiyanWebResearch')
    const { result } = renderHook(() => useBiyanWebResearch())

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
