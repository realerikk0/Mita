import { createFileRoute, redirect } from '@tanstack/react-router'

/** Legacy local-model catalog ingress. Biyan configures remote providers only. */
export const Route = createFileRoute('/hub/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/providers' })
  },
})
