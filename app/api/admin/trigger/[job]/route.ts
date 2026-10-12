import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'
import { errorMessage } from '@/lib/utils'
import { runIngest } from '@/lib/jobs/ingest'
import { runSelection } from '@/lib/jobs/select'
import { runReminder } from '@/lib/jobs/reminder'
import { runSend } from '@/lib/jobs/send'

export const maxDuration = 300

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

    const ok = result?.ok !== false
    const failedFeeds = result?.errors ? Object.keys(result.errors) : []
    const summary =
      result?.message ||
      (typeof result?.inserted === 'number'
        ? `Ingest done: fetched ${result.fetched}, new ${result.inserted}, duplicates ${result.duplicates}` +
          (failedFeeds.length ? `. ${failedFeeds.length} feed(s) failed: ${failedFeeds.join(', ')}` : '')
        : result
          ? JSON.stringify(result)
          : 'Job completed')
    return NextResponse.json(
      { success: ok, data: result, message: ok ? summary : `Job failed: ${summary}` },
      { status: ok ? 200 : 422 }
    )
  } catch (error) {
    console.error('Job error:', error)
    return NextResponse.json(
      {
        error: errorMessage(error),
        message: `Job failed: ${errorMessage(error)}`,
      },
      { status: 500 }
    )
  }
}
