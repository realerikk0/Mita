import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock useMCPServers
const mockEditServer = vi.fn()
const mockSyncServers = vi.fn().mockResolvedValue(undefined)
const mockActivateMCPServer = vi.fn().mockResolvedValue(undefined)
const mockDeactivateMCPServer = vi.fn().mockResolvedValue(undefined)
const mockCheckSilenceBrowserExtensionConnected = vi.fn().mockResolvedValue(false)
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
      checkSilenceBrowserExtensionConnected:
        mockCheckSilenceBrowserExtensionConnected,
    }),
  }),
}))

// Mock the dialog type
vi.mock('@/containers/dialogs/SilenceBrowserExtensionDialog', () => ({}))

describe('useSilenceBrowserExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMcpServers = {}
    mockActivateMCPServer.mockResolvedValue(undefined)
    mockDeactivateMCPServer.mockResolvedValue(undefined)
    mockCheckSilenceBrowserExtensionConnected.mockResolvedValue(false)
  })

  it('should return correct initial state when no config exists', async () => {
    const { useSilenceBrowserExtension } = await import('../useSilenceBrowserExtension')
    const { result } = renderHook(() => useSilenceBrowserExtension())

    expect(result.current.hasConfig).toBe(false)
    expect(result.current.isActive).toBe(false)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.dialogOpen).toBe(false)
    expect(result.current.dialogState).toBe('closed')
    expect(typeof result.current.toggleBrowser).toBe('function')
    expect(typeof result.current.handleCancel).toBe('function')
    expect(typeof result.current.setDialogOpen).toBe('function')
  })

  it('should detect config when Silence Browser MCP exists', async () => {
    mockMcpServers = {
      'Silence Browser MCP': { command: 'node', args: [], env: {}, active: false },
    }

    const { useSilenceBrowserExtension } = await import('../useSilenceBrowserExtension')
    const { result } = renderHook(() => useSilenceBrowserExtension())

    expect(result.current.hasConfig).toBe(true)
    expect(result.current.isActive).toBe(false)
  })

  it('should detect legacy config when Jan Browser MCP exists', async () => {
    mockMcpServers = {
      'Jan Browser MCP': { command: 'node', args: [], env: {}, active: false },
    }

    const { useSilenceBrowserExtension } = await import('../useSilenceBrowserExtension')
    const { result } = renderHook(() => useSilenceBrowserExtension())

    expect(result.current.hasConfig).toBe(true)
    expect(result.current.isActive).toBe(false)
  })

  it('should detect active state', async () => {
    mockMcpServers = {
      'Silence Browser MCP': { command: 'node', args: [], env: {}, active: true },
    }

    const { useSilenceBrowserExtension } = await import('../useSilenceBrowserExtension')
    const { result } = renderHook(() => useSilenceBrowserExtension())

    expect(result.current.isActive).toBe(true)
  })

  it('should show error toast when toggling without config', async () => {
    const { toast } = await import('sonner')
    const { useSilenceBrowserExtension } = await import('../useSilenceBrowserExtension')
    const { result } = renderHook(() => useSilenceBrowserExtension())

    await act(async () => {
      await result.current.toggleBrowser()
    })

    expect(toast.error).toHaveBeenCalledWith('Silence Browser MCP not found', expect.any(Object))
  })

  it('should handle cancel', async () => {
    mockMcpServers = {
      'Silence Browser MCP': { command: 'node', args: [], env: {}, active: true },
    }

    const { useSilenceBrowserExtension } = await import('../useSilenceBrowserExtension')
    const { result } = renderHook(() => useSilenceBrowserExtension())

    await act(async () => {
      result.current.handleCancel()
      await Promise.resolve()
    })

    expect(result.current.dialogOpen).toBe(false)
    expect(result.current.dialogState).toBe('closed')
    expect(mockEditServer).toHaveBeenCalledWith('Silence Browser MCP', expect.objectContaining({ active: false }))
  })

  it('should allow setting dialog open state', async () => {
    const { useSilenceBrowserExtension } = await import('../useSilenceBrowserExtension')
    const { result } = renderHook(() => useSilenceBrowserExtension())

    act(() => {
      result.current.setDialogOpen(true)
    })

    expect(result.current.dialogOpen).toBe(true)
  })
})
