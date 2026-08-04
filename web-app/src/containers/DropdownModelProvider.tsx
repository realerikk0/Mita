import { useEffect, useState, useRef, useMemo, useCallback, memo } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  cn,
  getModelDisplayName,
  getModelLogoProvider,
  getProviderTitle,
} from '@/lib/utils'
import { highlightFzfMatch } from '@/utils/highlight'
import Capabilities from './Capabilities'
import { IconSettings, IconX } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { Fzf } from 'fzf'
import { localStorageKey } from '@/constants/localStorage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import { getModelToStart } from '@/utils/getModelToStart'
import { ChevronsUpDown } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { isModelChatSelectable } from '@/lib/provider-models'
import { getChatModelFamilySortRank } from '@/lib/chat-model-sort'
import {
  getVisibleModelProviders,
  isVisibleModelProvider,
} from '@/constants/visible-model-providers'
import {
  configuredChatModels,
  isRemoteProviderEndpoint,
  RETIRED_LOCAL_PROVIDER_IDS,
} from '@/lib/configured-model-providers'

type DropdownModelProviderProps = {
  model?: ThreadModel
  useLastUsedModel?: boolean
  restrictToVisibleProviders?: boolean
}

interface SearchableModel {
  provider: ModelProvider
  model: Model
  searchStr: string
  value: string
  highlightedId?: string
}

function compareSearchableModelsByFamily(
  a: SearchableModel,
  b: SearchableModel
): number {
  return (
    getChatModelFamilySortRank(a.provider.provider, a.model.id) -
    getChatModelFamilySortRank(b.provider.provider, b.model.id)
  )
}

// Helper functions for localStorage
const setLastUsedModel = (provider: string, model: string) => {
  try {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider, model })
    )
  } catch (error) {
    console.debug('Failed to set last used model in localStorage:', error)
  }
}

const DropdownModelProvider = memo(function DropdownModelProvider({
  model,
  useLastUsedModel = false,
  restrictToVisibleProviders = false,
}: DropdownModelProviderProps) {
  const {
    providers,
    selectModelProvider,
    selectedProvider,
    selectedModel,
  } = useModelProvider()
  const { updateCurrentThreadModel } = useThreads()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { favoriteModels } = useFavoriteModel()
  const displayedProviders = useMemo(
    () => {
      const remoteProviders = providers.filter(
        (provider) =>
          !RETIRED_LOCAL_PROVIDER_IDS.has(provider.provider.toLowerCase())
      )
      return restrictToVisibleProviders
        ? getVisibleModelProviders(remoteProviders)
        : remoteProviders
    },
    [providers, restrictToVisibleProviders]
  )

  // Search state
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Helper function to check if a model exists in providers
  const checkModelExists = useCallback(
    (providerName: string, modelId: string) => {
      const provider = displayedProviders.find(
        (p) => p.provider === providerName && p.active
      )
      if (!provider) return undefined

      return configuredChatModels(provider).find(
        (candidate) => candidate.id === modelId
      )
    },
    [displayedProviders]
  )

  // Initialize model provider - avoid race conditions with manual selections
  useEffect(() => {
    const selectFallbackModel = () => {
      const resolved = getModelToStart({
        selectedModel,
        selectedProvider,
        getProviderByName: (providerName) =>
          displayedProviders.find(
            (candidate) => candidate.provider === providerName
          ),
        providers: displayedProviders,
      })

      if (!resolved) {
        selectModelProvider('', '')
        return
      }

      selectModelProvider(resolved.provider.provider, resolved.model)
      setLastUsedModel(resolved.provider.provider, resolved.model)
    }

    const initializeModel = () => {
      // Auto select model when existing thread is passed
      if (model) {
        if (checkModelExists(model.provider, model.id)) {
          selectModelProvider(model.provider, model.id)
        } else {
          selectFallbackModel()
        }
      } else if (useLastUsedModel) {
        selectFallbackModel()
      }
    }

    initializeModel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    model,
    useLastUsedModel,
    selectModelProvider,
    updateCurrentThreadModel,
    displayedProviders,
    checkModelExists,
    // selectedModel and selectedProvider intentionally excluded to prevent race conditions
  ])

  useEffect(() => {
    if (
      restrictToVisibleProviders &&
      selectedProvider &&
      !isVisibleModelProvider(selectedProvider)
    ) {
      selectModelProvider('', '')
    }
  }, [restrictToVisibleProviders, selectedProvider, selectModelProvider])

  const selectedChatModel =
    selectedProvider && selectedModel
      ? checkModelExists(selectedProvider, selectedModel.id)
      : undefined
  const displayModel = selectedChatModel
    ? getModelDisplayName(selectedChatModel)
    : t('common:selectAModel')

  // Reset search value when dropdown closes
  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open) {
      requestAnimationFrame(() => setSearchValue(''))
    } else {
      // Focus search input when opening
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [])

  // Clear search and focus input
  const onClearSearch = useCallback(() => {
    setSearchValue('')
    searchInputRef.current?.focus()
  }, [])

  // Create searchable items from all models
  const searchableItems = useMemo(() => {
    const items: SearchableModel[] = []

    displayedProviders.forEach((provider) => {
      if (!provider.active) return
      if (!isRemoteProviderEndpoint(provider)) return
      provider.models.forEach((modelItem) => {
        // Skip embedding models - they can't be used for chat
        if (!isModelChatSelectable(modelItem)) return

        // Skip predefined remote providers until credentials are configured.
        // For custom providers, allow if they have at least one model loaded
        const isPredefined = predefinedProviders.some((e) =>
          e.provider.includes(provider.provider)
        )
        if (
          provider &&
          !providerHasRemoteApiKeys(provider) &&
          (isPredefined || provider.models.length === 0)
        )
          return

        const capabilities = modelItem.capabilities || []
        const capabilitiesString = capabilities.join(' ')
        const providerTitle = getProviderTitle(provider.provider)

        // Create search string with model id, provider, and capabilities
        const searchStr =
          `${modelItem.id} ${providerTitle} ${provider.provider} ${capabilitiesString}`.toLowerCase()

        items.push({
          provider,
          model: modelItem,
          searchStr,
          value: `${provider.provider}:${modelItem.id}`,
        })
      })
    })

    return items.sort(compareSearchableModelsByFamily)
  }, [displayedProviders])

  // Create Fzf instance for fuzzy search
  const fzfInstance = useMemo(() => {
    return new Fzf(searchableItems, {
      selector: (item) =>
        `${getModelDisplayName(item.model)} ${item.model.id}`.toLowerCase(),
    })
  }, [searchableItems])

  // Get favorite models that are currently available
  const favoriteItems = useMemo(() => {
    return searchableItems
      .filter((item) => favoriteModels.some((fav) => fav.id === item.model.id))
      .sort(compareSearchableModelsByFamily)
  }, [searchableItems, favoriteModels])

  // Filter models based on search value
  const filteredItems = useMemo(() => {
    if (!searchValue) return searchableItems

    return fzfInstance.find(searchValue.toLowerCase()).map((result) => {
      const item = result.item
      const positions = Array.from(result.positions) || []
      const highlightedId = highlightFzfMatch(
        item.model.id,
        positions,
        'text-accent'
      )

      return {
        ...item,
        highlightedId,
      }
    })
  }, [searchableItems, searchValue, fzfInstance])

  // Group filtered items by provider, excluding favorites when not searching
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchableModel[]> = {}

    if (!searchValue || restrictToVisibleProviders) {
      // When not searching, show all active providers (even without models)
      // Sort configured remote providers first, then the remaining providers.
      const activeProviders = displayedProviders.filter(
        (p) => p.active
      )

      if (!restrictToVisibleProviders) {
        activeProviders.sort((a, b) => {
          // Custom providers without API key but with models should be treated like "have API key"
          const aIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(a.provider)
          )
          const bIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(b.provider)
          )
          const aHasApiKeyOrCustomModel =
            providerHasRemoteApiKeys(a) ||
            (!aIsPredefined && a.models.length > 0)
          const bHasApiKeyOrCustomModel =
            providerHasRemoteApiKeys(b) ||
            (!bIsPredefined && b.models.length > 0)
          const familyRankDiff =
            getChatModelFamilySortRank(a.provider) -
            getChatModelFamilySortRank(b.provider)
          if (familyRankDiff !== 0) return familyRankDiff

          // Providers with API keys or custom with models filled second
          if (aHasApiKeyOrCustomModel && !bHasApiKeyOrCustomModel) return -1
          if (!aHasApiKeyOrCustomModel && bHasApiKeyOrCustomModel) return 1

          // Sort remaining by provider name
          return a.provider.localeCompare(b.provider)
        })
      }

      activeProviders.forEach((provider) => {
        groups[provider.provider] = []
      })
    }

    // Add the filtered items to their respective groups
    filteredItems.forEach((item) => {
      const providerKey = item.provider.provider
      if (!groups[providerKey]) {
        groups[providerKey] = []
      }

      // When not searching, exclude favorite models from regular provider sections
      const isFavorite = favoriteModels.some((fav) => fav.id === item.model.id)
      if (!searchValue && isFavorite) return // Skip adding this item to regular provider section

      groups[providerKey].push(item)
    })

    Object.values(groups).forEach((models) => {
      models.sort(compareSearchableModelsByFamily)
    })

    if (searchValue && restrictToVisibleProviders) {
      Object.keys(groups).forEach((providerKey) => {
        if (groups[providerKey].length === 0) delete groups[providerKey]
      })
    }

    return groups
  }, [
    displayedProviders,
    favoriteModels,
    filteredItems,
    restrictToVisibleProviders,
    searchValue,
  ])

  const handleSelect = useCallback(
    async (searchableModel: SearchableModel) => {
      setSearchValue('')
      setOpen(false)

      selectModelProvider(
        searchableModel.provider.provider,
        searchableModel.model.id
      )
      updateCurrentThreadModel({
        id: searchableModel.model.id,
        provider: searchableModel.provider.provider,
      })

      // Store the selected model as last used
      setLastUsedModel(
        searchableModel.provider.provider,
        searchableModel.model.id
      )

    },
    [selectModelProvider, updateCurrentThreadModel]
  )

  const provider = selectedChatModel
    ? displayedProviders.find(
        (candidate) => candidate.provider === selectedProvider
      )
    : undefined

  if (!displayedProviders.length) return null

  const selectedModelLogoProvider =
    provider && selectedChatModel?.id
      ? {
          provider: getModelLogoProvider(
            selectedChatModel.id,
            provider.provider
          ),
        }
      : provider

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div className="border relative z-20 px-4 py-1.5 flex items-center gap-1.5 rounded-full">
          <button
            type="button"
            className="font-medium cursor-pointer flex items-center gap-1.5 relative z-20 min-w-0"
          >
            {selectedModelLogoProvider && (
              <div className="shrink-0">
                <ProvidersAvatar provider={selectedModelLogoProvider} />
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'text-foreground truncate leading-normal',
                    !selectedChatModel?.id && 'text-muted-foreground'
                  )}
                >
                  {displayModel}
                </span>
              </TooltipTrigger>
              <TooltipContent>{displayModel}</TooltipContent>
            </Tooltip>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </PopoverTrigger>

      <PopoverContent
        className={cn(
          // Use auto width to fit long model names; keep a sensible minimum.
          'w-auto min-w-70 max-w-[90vw] p-0 backdrop-blur-2xl bg-background/95 border',
          searchValue.length === 0 && 'h-80'
        )}
        align="start"
        // sideOffset={16}
        // alignOffset={-10}
        side="bottom"
        avoidCollisions={searchValue.length === 0 ? true : false}
      >
        <div className="flex flex-col size-full">
          {/* Search input */}
          <div className="relative p-2 border-b">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('common:searchModels')}
              className="text-sm font-normal outline-0"
            />
            {searchValue.length > 0 && (
              <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
                <IconX
                  size={16}
                  className="text-muted-foreground cursor-pointer"
                  onClick={onClearSearch}
                />
              </div>
            )}
          </div>

          {/* Model list */}
          <div className="max-h-80 overflow-y-auto">
            {Object.keys(groupedItems).length === 0 && searchValue ? (
              <div className="py-3 px-4 text-sm ">
                {t('common:noModelsFoundFor', { searchValue })}
              </div>
            ) : (
              <div className="py-1">
                {/* Favorites section - only show when not searching */}
                {!searchValue && favoriteItems.length > 0 && (
                  <div className="bg-secondary/30 rounded-sm m-2 py-1">
                    {/* Favorites header */}
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        {t('common:favorites')}
                      </span>
                    </div>

                    {/* Favorite models */}
                    {favoriteItems.map((searchableModel) => {
                      const isSelected =
                        selectedModel?.id === searchableModel.model.id &&
                        selectedProvider === searchableModel.provider.provider
                      const capabilities =
                        searchableModel.model.capabilities || []

                      return (
                        <div
                          key={`fav-${searchableModel.value}`}
                          onClick={() => handleSelect(searchableModel)}
                          className={cn(
                            'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                            'hover:bg-secondary/40',
                            // Selected state needs stronger contrast than the surrounding secondary tint.
                            isSelected &&
                              'bg-primary/15 hover:bg-primary/15 ring-1 ring-primary/40'
                          )}
                        >
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <div className="shrink-0 -ml-1">
                              <ProvidersAvatar
                                provider={{
                                  provider: getModelLogoProvider(
                                    searchableModel.model.id,
                                    searchableModel.provider.provider
                                  ),
                                }}
                              />
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm truncate">
                                  {getModelDisplayName(searchableModel.model)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {searchableModel.model.id}
                              </TooltipContent>
                            </Tooltip>
                            <div className="flex-1"></div>
                            {capabilities.length > 0 && (
                              <div className="shrink-0 -mr-1.5">
                                <Capabilities capabilities={capabilities} />
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Divider between favorites and regular providers */}
                {favoriteItems.length > 0 && (
                  <div className="border-b mx-2"></div>
                )}

                {/* Regular provider sections */}
                {Object.entries(groupedItems).map(([providerKey, models]) => {
                  const providerInfo = displayedProviders.find(
                    (p) => p.provider === providerKey
                  )

                  if (!providerInfo) return null

                  return (
                    <div
                      key={providerKey}
                      className="bg-secondary/30 first:mt-0 rounded-sm my-1.5 mx-1.5 first:mb-0 py-1"
                    >
                      {/* Provider header */}
                      <div className="flex items-center justify-between px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <ProvidersAvatar provider={providerInfo} />
                          <span className="capitalize text-sm font-medium text-muted-foreground">
                            {getProviderTitle(providerInfo.provider)}
                          </span>
                        </div>

                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded-sm bg-secondary-foreground/8 transition-all duration-200 ease-in-out"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate({
                              to: route.settings.providers,
                              params: { providerName: providerInfo.provider },
                            })
                            setOpen(false)
                          }}
                        >
                          <IconSettings
                            size={16}
                            className="text-muted-foreground"
                          />
                        </div>
                      </div>

                      {/* Models for this provider */}
                      {models.length === 0 ? (
                        // Show message when provider has no available models
                        <></>
                      ) : (
                        models.map((searchableModel) => {
                          const isSelected =
                            selectedModel?.id === searchableModel.model.id &&
                            selectedProvider ===
                              searchableModel.provider.provider
                          const capabilities =
                            searchableModel.model.capabilities || []

                          return (
                            <div
                              key={searchableModel.value}
                              onClick={() => handleSelect(searchableModel)}
                              className={cn(
                                'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                                'hover:bg-secondary/40',
                                isSelected &&
                                  'bg-primary/15 hover:bg-primary/15 ring-1 ring-primary/40'
                              )}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div className="shrink-0">
                                  <ProvidersAvatar
                                    provider={{
                                      provider: getModelLogoProvider(
                                        searchableModel.model.id,
                                        searchableModel.provider.provider
                                      ),
                                    }}
                                  />
                                </div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-sm truncate">
                                      {getModelDisplayName(
                                        searchableModel.model
                                      )}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {searchableModel.model.id}
                                  </TooltipContent>
                                </Tooltip>
                                <div className="flex-1"></div>
                                {capabilities.length > 0 && (
                                  <div className="shrink-0 -mr-1.5">
                                    <Capabilities capabilities={capabilities} />
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
})

export default DropdownModelProvider
