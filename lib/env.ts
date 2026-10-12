import { z } from 'zod'

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  ADMIN_PASSWORD: z.string(),
  SESSION_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  GEMINI_API_KEY: z.string(),
  GEMINI_MODEL: z.string(),

  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_WEBHOOK_SECRET: z.string(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional().default(''),

  GMAIL_USER: z.string().email(),
  GMAIL_APP_PASSWORD: z.string(),
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
    validatedEnv = envSchema.parse(process.env)
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
