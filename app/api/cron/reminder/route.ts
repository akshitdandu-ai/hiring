import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runReminder } from '@/lib/jobs/reminder'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')

  if (!verifyCronSecret(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runReminder()
    return NextResponse.json({ success: result.ok, data: result })
  } catch (error) {
    console.error('Reminder error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
