const LEGACY_PROVIDER_IMPORT_PROTOCOL = 'mita:'

export function isAcceptedProviderImportProtocol(protocol: string): boolean {
  return protocol === 'biyan:' || protocol === LEGACY_PROVIDER_IMPORT_PROTOCOL
}
