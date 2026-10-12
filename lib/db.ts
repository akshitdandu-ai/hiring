import { createClient } from '@supabase/supabase-js'
import { getEnv } from './env'

let supabaseInstance: any = null

// Initialize Supabase client (server-side only, uses service role key)
function initSupabase() {
  if (supabaseInstance) return supabaseInstance

  try {
    const env = getEnv()

    // Validate credentials are not empty
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('Supabase credentials not configured - database operations will fail')
      // Return mock client that throws helpful errors
      return new Proxy({} as any, {
        get: () => () => {
          throw new Error('Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.')
        }
      })
    }

    supabaseInstance = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  } catch (err) {
    // During build, this might fail, but that's ok
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return null
    }
    throw err
  }

  return supabaseInstance
}

export const supabase = initSupabase() || ({} as any)
