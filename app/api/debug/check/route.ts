import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'

export async function GET() {
  try {
    const env = getEnv()

    const checks = {
      supabase: {
        url_set: !!(env.SUPABASE_URL && env.SUPABASE_URL !== 'https://example.supabase.co'),
        key_set: !!(env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY.length > 10),
        status: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY?.length > 10 ? '✓' : '✗'
      },
      gemini: {
        key_set: !!(env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 10),
        model: env.GEMINI_MODEL,
        status: env.GEMINI_API_KEY?.length > 10 ? '✓' : '✗'
      },
      gmail: {
        user_set: !!(env.GMAIL_USER && env.GMAIL_USER.length > 0),
        password_set: !!(env.GMAIL_APP_PASSWORD && env.GMAIL_APP_PASSWORD.length > 0),
        status: env.GMAIL_USER && env.GMAIL_APP_PASSWORD ? '✓' : '✗'
      },
      telegram: {
        bot_token_set: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN.length > 10),
        admin_chat_id_set: !!(env.TELEGRAM_ADMIN_CHAT_ID && env.TELEGRAM_ADMIN_CHAT_ID.length > 0),
        status: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID ? '✓' : '✗'
      },
      secrets: {
        session_secret_valid: !!(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32),
        cron_secret_valid: !!(env.CRON_SECRET && env.CRON_SECRET.length >= 32),
      },
      app: {
        base_url: env.APP_BASE_URL,
        admin_password_set: !!(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length > 0),
      }
    }

    return NextResponse.json({
      message: 'Configuration Check',
      timestamp: new Date().toISOString(),
      ...checks,
      all_required_set: checks.supabase.status === '✓' &&
                       checks.gemini.status === '✓' &&
                       checks.gmail.status === '✓' &&
                       checks.telegram.status === '✓'
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Error checking configuration'
    }, { status: 500 })
  }
}
