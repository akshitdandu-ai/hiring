import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'

export async function GET(req: NextRequest) {
  try {
    const adminPassword = env.ADMIN_PASSWORD
    return NextResponse.json({
      adminPasswordLength: adminPassword.length,
      adminPasswordChars: adminPassword.split('').map((c) => c.charCodeAt(0)),
      adminPasswordTrimmed: adminPassword.trim(),
      adminPasswordTrimmedLength: adminPassword.trim().length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error loading env' },
      { status: 500 }
    )
  }
}
