import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy local-model detail ingress. Biyan configures remote providers only. */
export const Route = createFileRoute('/hub/$modelId')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/providers' })
  },
})
