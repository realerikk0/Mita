import { notFound } from '@tanstack/react-router'

export const PREVIEW_ROUTE_PATHS = [
  '/loading-ribbon-demo',
  '/thinking-content-demo',
] as const

export const previewRoutePaths = new Set<string>(PREVIEW_ROUTE_PATHS)

export function blockPreviewRouteInProduction() {
  if (import.meta.env.PROD) {
    throw notFound()
  }
}
