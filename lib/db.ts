import { createClient } from '@supabase/supabase-js'
import { env } from './env'

// Initialize Supabase client (server-side only, uses service role key)
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

export type Database = Awaited<ReturnType<typeof supabase.from('articles').select('*', { count: 'exact' })>>['data']
