import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runSend } from '@/lib/jobs/send'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')

  if (!verifyCronSecret(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runSend()
    return NextResponse.json({ success: result.ok, data: result })
  } catch (error) {
    console.error('Send error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
