import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModelCapabilities: vi.fn().mockReturnValue(['image_generation']),
  updateProvider: vi.fn(),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({ updateProvider: mocks.updateProvider }),
}))

vi.mock('@/hooks/useProviderModels', () => ({
  useProviderModels: () => ({
    models: [],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/models', () => ({
  getModelCapabilities: mocks.getModelCapabilities,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/containers/ModelCombobox', () => ({
  ModelCombobox: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('gpt-image-2')}>
      Choose model
    </button>
  ),
}))

import { DialogAddModel } from '../AddModel'

describe('DialogAddModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the provider base URL when inferring a manually added model', () => {
    render(
      <DialogAddModel
        provider={
          {
            provider: 'openai-compatible',
            base_url: 'https://api.biyuan.ai/v1',
            models: [],
            active: true,
          } as ModelProvider
        }
        trigger={<button type="button">Open</button>}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'providers:addModel.addModel' })
    )

    expect(mocks.getModelCapabilities).toHaveBeenCalledWith(
      'openai-compatible',
      'gpt-image-2',
      'https://api.biyuan.ai/v1'
    )
    expect(mocks.updateProvider).toHaveBeenCalledWith(
      'openai-compatible',
      expect.objectContaining({
        models: [
          expect.objectContaining({
            id: 'gpt-image-2',
            capabilities: ['image_generation'],
          }),
        ],
      })
    )
  })
})
