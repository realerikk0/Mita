/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateSystemUsage: vi.fn(),
  getSystemUsage: vi.fn(),
  hardwareData: {
    cpu: { name: 'Intel i9', arch: 'x86_64', core_count: 16 },
    total_memory: 32768,
    gpus: [
      {
        uuid: 'gpu-0',
        name: 'RTX 4090',
        vendor: 'NVIDIA',
        total_memory: 24576,
      },
    ],
  },
  systemUsage: {
    cpu: 42.5,
    used_memory: 16384,
    gpus: [{ uuid: 'gpu-0', used_memory: 4096, total_memory: 24576 }],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/system-monitor' }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useHardware', () => ({
  useHardware: () => ({
    hardwareData: h.hardwareData,
    systemUsage: h.systemUsage,
    updateSystemUsage: h.updateSystemUsage,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    hardware: () => ({ getSystemUsage: h.getSystemUsage }),
  }),
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress" data-value={value} />
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconDeviceDesktopAnalytics: () => <span data-testid="icon" />,
}))

vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb}MB`,
}))

vi.mock('@/utils/number', () => ({
  toNumber: (value: number) => value,
}))

import { Route } from '../system-monitor'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('SystemMonitor route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getSystemUsage.mockResolvedValue(h.systemUsage)
  })

  afterEach(() => vi.useRealTimers())

  it('shows generic CPU, memory, and GPU telemetry', () => {
    renderComponent()

    expect(screen.getByText('Intel i9')).toBeVisible()
    expect(screen.getByText('42.50%')).toBeVisible()
    expect(screen.getByText('50.00%')).toBeVisible()
    expect(screen.getByText('RTX 4090')).toBeVisible()
    expect(screen.getByText('NVIDIA')).toBeVisible()
    expect(screen.getByText('4096MB')).toBeVisible()
  })

  it('polls generic system usage without consulting a model runtime', async () => {
    vi.useFakeTimers()
    renderComponent()

    await vi.advanceTimersByTimeAsync(5100)

    expect(h.getSystemUsage).toHaveBeenCalled()
    expect(h.updateSystemUsage).toHaveBeenCalledWith(h.systemUsage)
  })
})
