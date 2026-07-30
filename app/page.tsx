import { redirect } from 'next/navigation'
import { DEFAULT_SIGNED_IN_ROUTE } from '@/core/auth/route-policy'

/**
 * The root has nothing of its own to show. Sending it to the dashboard lets the
 * middleware make the one decision that matters — signed in or not — in a single
 * place rather than duplicating the judgement here.
 */
export default function RootPage() {
  redirect(DEFAULT_SIGNED_IN_ROUTE)
}
