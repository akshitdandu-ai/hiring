import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { runIngest } from '@/lib/jobs/ingest'
import { runSelection } from '@/lib/jobs/select'
import { runReminder } from '@/lib/jobs/reminder'
import { runSend } from '@/lib/jobs/send'

export async function POST(req: NextRequest, context: any) {
  const isAuthenticated = await verifySession()

  if (!isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { job } = await context.params

  try {
    let result: any

    switch (job) {
      case 'ingest':
        result = await runIngest()
        break
      case 'select':
        result = await runSelection()
        break
      case 'remind':
        result = await runReminder()
        break
      case 'send':
        result = await runSend()
        break
      default:
        return NextResponse.json({ error: 'Unknown job' }, { status: 400 })
    }

    return NextResponse.json({ success: true, data: result, message: result.message || 'Job completed' })
  } catch (error) {
    console.error('Job error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error', message: 'Job failed' },
      { status: 500 }
    )
  }
}
