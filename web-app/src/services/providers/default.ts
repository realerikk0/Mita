/**
 * Default Providers Service - Generic implementation with minimal returns
 */

import type { ProvidersService } from './types'
import type { ProviderModelDescriptor } from '@/lib/provider-models'

export class DefaultProvidersService implements ProvidersService {
  async getProviders(): Promise<ModelProvider[]> {
    return []
  }

  async fetchModelsFromProvider(
    provider: ModelProvider
  ): Promise<ProviderModelDescriptor[]> {
    console.log('fetchModelsFromProvider called with provider:', provider)
    return []
  }

  async updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void> {
    console.log('updateSettings called:', { providerName, settings })
    // No-op - not implemented in default service
  }

  fetch(): typeof fetch {
    return fetch
  }
}
