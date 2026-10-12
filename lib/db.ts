import { createClient } from '@supabase/supabase-js'
import { getEnv } from './env'

let supabaseInstance: any = null

// Initialize Supabase client (server-side only, uses service role key)
function initSupabase() {
  if (supabaseInstance) return supabaseInstance

  try {
    const env = getEnv()
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
