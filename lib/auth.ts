import { cookies } from 'next/headers'
import crypto from 'crypto'

const COOKIE_NAME = 'admin-session'

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function signToken(token: string): string {
  const secret = process.env.SESSION_SECRET || ''
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

export async function createSession(password: string): Promise<string | null> {
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim()
  const trimmedPassword = password.trim()

  // Simple comparison first
  if (trimmedPassword === adminPassword) {
    const token = generateToken()
    const signature = signToken(token)
    const sessionValue = `${token}.${signature}`

    const cookieStore = await cookies()
    cookieStore.set(COOKIE_NAME, sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
    })

    return sessionValue
  }

  return null
}

export async function verifySession(): Promise<boolean> {
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get(COOKIE_NAME)?.value

  if (!sessionValue) return false

  const [token, signature] = sessionValue.split('.')
  const expectedSignature = signToken(token)

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}
