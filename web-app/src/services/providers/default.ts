/**
 * Default Providers Service - Generic implementation with minimal returns
 */

import type { ProvidersService } from './types'
import type { ProviderModelDescriptor } from '@/lib/provider-models'
import type { ProviderBalanceStatus } from './types'

export class DefaultProvidersService implements ProvidersService {
  async getProviders(): Promise<ModelProvider[]> {
    return []
  }

  async fetchModelsFromProvider(
    provider: ModelProvider
  ): Promise<ProviderModelDescriptor[]> {
    void provider
    return []
  }

  async fetchProviderBalance(provider: ModelProvider): Promise<ProviderBalanceStatus> {
    return {
      state: 'unsupported',
      provider: provider.provider,
      reason: 'Automatic balance lookup is only available in the desktop provider service.',
    }
  }

  async updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void> {
    void providerName
    void settings
    // No-op - not implemented in default service
  }

  fetch(): typeof fetch {
    return fetch
  }
}
