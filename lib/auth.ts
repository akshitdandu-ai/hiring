import { cookies } from 'next/headers'
import crypto from 'crypto'
import { env } from './env'

const COOKIE_NAME = 'admin-session'

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function signToken(token: string): string {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

export async function createSession(password: string): Promise<string | null> {
  if (crypto.timingSafeEqual(Buffer.from(password), Buffer.from(env.ADMIN_PASSWORD))) {
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
