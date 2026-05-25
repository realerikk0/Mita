import { Button } from '@/components/ui/button'
import { useAnalytic } from '@/hooks/useAnalytic'
import { IconFileTextShield } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { setMitaAnalyticsConsent } from '@/lib/analytics'

export function PromptAnalytic() {
  const { t } = useTranslation()
  const { setProductAnalyticPrompt, setProductAnalytic } = useAnalytic()

  const handleProductAnalytics = (isAllowed: boolean) => {
    setMitaAnalyticsConsent(isAllowed)
    setProductAnalytic(isAllowed)
    setProductAnalyticPrompt(false)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 p-4 shadow-lg bg-background w-4/5 md:w-100 border rounded-lg">
      <div className="flex items-center gap-2">
        <IconFileTextShield className="text-muted-foreground" />
        <h2 className="font-medium">
          {t('helpUsImproveMita')}
        </h2>
      </div>
      <p className="mt-2 text-xs text-muted-foreground leading-normal">
        {t('helpUsImproveMitaDescription')}
      </p>
      <p className="mt-2 text-sm">
        {t('helpUsImproveMitaQuestion')}
      </p>
      <div className="mt-4 flex justify-end space-x-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleProductAnalytics(false)}
        >
          {t('deny')}
        </Button>
        <Button
          size="sm"
          onClick={() => handleProductAnalytics(true)}
        >
          {t('allow')}
        </Button>
      </div>
    </div>
  )
}
