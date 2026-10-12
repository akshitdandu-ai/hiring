import { z } from 'zod'

const envSchema = z.object({
  APP_BASE_URL: z.string().url().optional().default('http://localhost:3000'),
  ADMIN_PASSWORD: z.string().default('admin'),
  SESSION_SECRET: z.string().min(32).optional().default('0'.repeat(32)),
  CRON_SECRET: z.string().min(32).optional().default('0'.repeat(32)),
  ADMIN_EMAIL: z.string().email().optional().default('admin@example.com'),

  SUPABASE_URL: z.string().url().optional().default('https://example.supabase.co'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),

  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().optional().default('gemini-2.0-flash'),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(''),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional().default(''),

  GMAIL_USER: z.string().optional().default(''),
  GMAIL_APP_PASSWORD: z.string().optional().default(''),
  NEWSLETTER_FROM_NAME: z.string().default('The Dispatch'),
  GMAIL_DAILY_SEND_CAP: z.coerce.number().int().default(450),

  GNEWS_API_KEY: z.string().optional().default(''),

  NODE_ENV: z.enum(['development', 'production']).default('production'),
})

export type Env = z.infer<typeof envSchema>

let validatedEnv: Env | null = null

export function getEnv(): Env {
  if (validatedEnv) return validatedEnv

  try {
    validatedEnv = envSchema.parse({
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    })
    return validatedEnv
  } catch (error) {
    // During build, some env vars might not be set, that's ok
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return {} as Env
    }

    if (error instanceof z.ZodError) {
      const missing = error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('\n  ')
      throw new Error(
        `Invalid environment variables:\n  ${missing}\n\nCheck .env.example for required variables.`
      )
    }
    throw error
  }
}

let envInstance: Env | null = null

export function getEnvInstance(): Env {
  if (!envInstance) {
    envInstance = getEnv()
  }
  return envInstance
}

// Lazy-loaded env - only validates on first property access
export const env = new Proxy({} as any, {
  get: (_, prop) => getEnvInstance()[prop as keyof Env],
}) as Env
