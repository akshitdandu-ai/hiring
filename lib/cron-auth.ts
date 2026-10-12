import { env } from './env'

export function verifyCronSecret(authHeader: string | null | undefined): boolean {
  if (!authHeader) return false
  const [scheme, token] = authHeader.split(' ')
  return scheme === 'Bearer' && token === env.CRON_SECRET
}
