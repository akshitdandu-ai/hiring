import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runBounces } from '@/lib/jobs/bounces'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')

  if (!verifyCronSecret(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runBounces()
    return NextResponse.json({ success: result.ok, data: result })
  } catch (error) {
    console.error('Bounces error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
