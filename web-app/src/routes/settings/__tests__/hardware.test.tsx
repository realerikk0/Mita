/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  setHardwareData: vi.fn(),
  updateSystemUsage: vi.fn(),
  getHardwareInfo: vi.fn(),
  getSystemUsage: vi.fn(),
  refreshHardwareInfo: vi.fn(),
  openSystemMonitorWindow: vi.fn(),
  hardwareData: {
    os_type: 'windows',
    os_name: 'Windows 11',
    cpu: { name: 'Intel i7', arch: 'x64', core_count: 8, extensions: ['SSE'] },
    total_memory: 16384,
    gpus: [
      {
        uuid: 'gpu0',
        name: 'RTX 3080',
        vendor: 'NVIDIA',
        total_memory: 10240,
      },
    ],
  },
  systemUsage: {
    cpu: 50,
    used_memory: 8192,
    total_memory: 16384,
    gpus: [],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => config,
}))

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/containers/Card', () => ({
  Card: ({ title, children }: any) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  CardItem: ({ title, description, actions }: any) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
      {actions}
    </div>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useHardware', () => ({
  useHardware: () => ({
    hardwareData: h.hardwareData,
    systemUsage: h.systemUsage,
    setHardwareData: h.setHardwareData,
    updateSystemUsage: h.updateSystemUsage,
    pollingPaused: true,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    hardware: () => ({
      getHardwareInfo: h.getHardwareInfo,
      getSystemUsage: h.getSystemUsage,
      refreshHardwareInfo: h.refreshHardwareInfo,
    }),
    window: () => ({ openSystemMonitorWindow: h.openSystemMonitorWindow }),
  }),
}))

vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb} MB`,
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/utils/number', () => ({ toNumber: (value: number) => value }))
vi.mock('@tabler/icons-react', () => ({
  IconDeviceDesktopAnalytics: () => <span data-testid="icon" />,
}))

Object.defineProperty(globalThis, 'IS_MACOS', {
  configurable: true,
  value: false,
})

import { Route } from '../hardware'

describe('Hardware Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getHardwareInfo.mockResolvedValue(h.hardwareData)
    h.getSystemUsage.mockResolvedValue(h.systemUsage)
    h.refreshHardwareInfo.mockResolvedValue(undefined)
  })

  it('renders generic hardware information including GPUs', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(await screen.findByText('settings:hardware.os')).toBeVisible()
    expect(screen.getByText('Intel i7')).toBeVisible()
    expect(screen.getByText('RTX 3080')).toBeVisible()
    expect(screen.getByText('NVIDIA')).toBeVisible()
    expect(screen.getByText('10240 MB')).toBeVisible()
  })
})
