import { createClient } from '@supabase/supabase-js'
import { getEnv } from './env'

let client: any = null

function decodeJwt(token: string): Record<string, any> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function configProblem(url: string, key: string): string | null {
  if (!url || url === 'https://example.supabase.co') {
    return 'SUPABASE_URL is not set on this deployment (or is still the placeholder). Set it to your project URL and redeploy.'
  }
  if (!key) {
    return 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Set it and redeploy.'
  }
  if (key.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY is a publishable (public) key. Use the secret / service_role key instead.'
  }
  const payload = decodeJwt(key)
  if (payload) {
    if (payload.role && payload.role !== 'service_role') {
      return `SUPABASE_SERVICE_ROLE_KEY has role "${payload.role}" (the public anon key). Use the service_role secret key instead.`
    }
    const host = (() => {
      try {
        return new URL(url).hostname.split('.')[0]
      } catch {
        return ''
      }
    })()
    if (payload.ref && host && payload.ref !== host) {
      return `SUPABASE_SERVICE_ROLE_KEY belongs to project "${payload.ref}" but SUPABASE_URL points to "${host}". They must be the same project.`
    }
  }
  return null
}

export function getSupabase(): any {
  if (client) return client
  const env = getEnv()
  const problem = configProblem(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  if (problem) throw new Error(problem)
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

export const supabase: any = new Proxy(
  {},
  {
    get: (_, prop) => {
      const c = getSupabase()
      const value = c[prop]
      return typeof value === 'function' ? value.bind(c) : value
    },
  }
)
