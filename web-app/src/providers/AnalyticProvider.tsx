import posthog from 'posthog-js'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useAnalytic } from '@/hooks/useAnalytic'
import {
  registerBiyanAnalyticsSuperProperties,
  sanitizeAnalyticsProperties,
  setBiyanAnalyticsConsent,
  trackBiyanEvent,
} from '@/lib/analytics'

export function AnalyticProvider() {
  const { productAnalytic } = useAnalytic()
  const serviceHub = useServiceHub()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const initializedRef = useRef(false)
  const launchedRef = useRef(false)

  useEffect(() => {
    if (!POSTHOG_KEY || !POSTHOG_HOST) {
      console.warn(
        'PostHog not initialized: Missing POSTHOG_KEY or POSTHOG_HOST environment variables'
      )
      return
    }

    if (!initializedRef.current) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        autocapture: {
          dom_event_allowlist: ['click', 'change', 'submit'],
          element_allowlist: ['a', 'button', 'input', 'select', 'textarea', 'label'],
          css_selector_allowlist: [
            '[data-analytics]',
            '[data-testid]',
            '[aria-label]',
            'button',
            'a',
            '[role="button"]',
          ],
          element_attribute_ignorelist: [
            'aria-label',
            'data-value',
            'placeholder',
            'title',
            'value',
          ],
          capture_copied_text: false,
        },
        capture_pageview: false,
        capture_pageleave: false,
        capture_heatmaps: true,
        disable_session_recording: true,
        enable_heatmaps: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
        mask_personal_data_properties: true,
        person_profiles: 'always',
        persistence: 'localStorage',
        opt_out_capturing_by_default: true,
        rageclick: true,

        sanitize_properties: (properties) =>
          sanitizeAnalyticsProperties(properties),
      })
      initializedRef.current = true
    }

    if (productAnalytic) {
      // Attempt to restore distinct Id from app global settings
      serviceHub
        .analytic()
        .getAppDistinctId()
        .then((id) => {
          if (id) posthog.identify(id)
        })
        .finally(() => {
          setBiyanAnalyticsConsent(true)
          registerBiyanAnalyticsSuperProperties({
            app_version: VERSION,
            platform: 'desktop',
          })
          serviceHub.analytic().updateDistinctId(posthog.get_distinct_id())
          if (!launchedRef.current) {
            launchedRef.current = true
            trackBiyanEvent('app_launched')
          }
        })
    } else {
      setBiyanAnalyticsConsent(false)
      launchedRef.current = false
    }
  }, [productAnalytic, serviceHub])

  useEffect(() => {
    if (!productAnalytic) return
    trackBiyanEvent('screen_viewed', {
      screen: pathname,
    })
  }, [pathname, productAnalytic])

  useEffect(() => {
    if (!productAnalytic || typeof document === 'undefined') return

    const trackBackground = () => {
      if (document.visibilityState === 'hidden') {
        trackBiyanEvent('app_backgrounded')
      }
    }

    document.addEventListener('visibilitychange', trackBackground)
    window.addEventListener('pagehide', trackBackground)
    return () => {
      document.removeEventListener('visibilitychange', trackBackground)
      window.removeEventListener('pagehide', trackBackground)
    }
  }, [productAnalytic])

  // This component doesn't render anything
  return null
}
