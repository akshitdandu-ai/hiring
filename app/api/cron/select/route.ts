import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runSelection } from '@/lib/jobs/select'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')

  if (!verifyCronSecret(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { force } = await req.json().catch(() => ({}))

  try {
    const result = await runSelection(force || false)
    return NextResponse.json({ success: result.ok, data: result })
  } catch (error) {
    console.error('Selection error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
