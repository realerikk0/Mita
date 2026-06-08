/**
 * Providers Service Types
 */

import type { ProviderModelDescriptor } from '@/lib/provider-models'

export interface ProvidersService {
  getProviders(): Promise<ModelProvider[]>
  fetchModelsFromProvider(
    provider: ModelProvider
  ): Promise<ProviderModelDescriptor[]>
  updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void>
  fetch(): typeof fetch
}
