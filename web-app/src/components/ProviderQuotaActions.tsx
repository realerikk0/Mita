import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { providerQuotaErrorFromUnknown } from '@/lib/provider-quota-error'
import type { ProviderQuotaErrorDetails } from '@/lib/provider-quota-error'
import { cn } from '@/lib/utils'
import { useServiceHub } from '@/hooks/useServiceHub'

type ProviderQuotaActionsProps = {
  error?: ProviderQuotaErrorDetails | Error | string | null
  className?: string
  showMessage?: boolean
  size?: 'sm' | 'default'
}

export function ProviderQuotaActions({
  error,
  className,
  showMessage = false,
  size = 'sm',
}: ProviderQuotaActionsProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const quotaError = providerQuotaErrorFromUnknown(error)

  if (!quotaError) return null

  const openUrl = (url?: string) => {
    if (!url) return
    void serviceHub.opener().openExternalUrl(url)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {showMessage && (
        <p className="text-xs leading-5 text-muted-foreground">
          {quotaError.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {quotaError.rechargeUrl ? (
          <Button
            type="button"
            variant="default"
            size={size}
            onClick={() => openUrl(quotaError.rechargeUrl)}
          >
            <ExternalLink className="size-4" />
            {t('common:providerQuota.recharge')}
          </Button>
        ) : null}
        {quotaError.tokenUrl ? (
          <Button
            type="button"
            variant="outline"
            size={size}
            onClick={() => openUrl(quotaError.tokenUrl)}
          >
            <ExternalLink className="size-4" />
            {t('common:providerQuota.manageTokens')}
          </Button>
        ) : null}
        {!quotaError.rechargeUrl && !quotaError.tokenUrl ? (
          <span className="text-xs text-muted-foreground">
            {t('common:providerQuota.linksUnavailable')}
          </span>
        ) : null}
      </div>
    </div>
  )
}

