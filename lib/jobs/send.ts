import { supabase } from '../db'
import { nowIST, errorMessage, getWeekKeyIST } from '../utils'
import { sendTelegramMessage } from '../telegram'
import { sendEmails } from '../email'

export async function runSend(): Promise<{ ok: boolean; message: string; sent?: number }> {
  const jobStarted = nowIST()

  try {
    const weekKey = getWeekKeyIST()

    // Critical gate: only send if explicitly confirmed
    const { data: issue } = await supabase
      .from('issues')
      .select('id, status, confirmed_at, recipients_total, recipients_sent')
      .eq('week_key', weekKey)
      .single()

    if (!issue) {
      console.log('No issue this week')
      return { ok: true, message: 'No issue this week' }
    }

    // Only proceed if confirmed or already sending (resuming)
    if (issue.status !== 'confirmed' && issue.status !== 'sending') {
      console.log(`Issue status is ${issue.status}, not sending`)
      return { ok: false, message: `Issue status is ${issue.status}, refusing to send` }
    }

    // Transition to sending if not already (idempotent with conditional update)
    if (issue.status === 'confirmed') {
      const { error } = await supabase
        .from('issues')
        .update({ status: 'sending' })
        .eq('id', issue.id)
        .eq('status', 'confirmed')

      // Ignore "no rows updated" errors (from race condition)
      if (error && !error.message.includes('0 rows')) {
        throw error
      }
    }

    // Send emails
    console.log('📧 Sending emails...')
    const result = await sendEmails(issue.id)

    if (!result.ok) {
      return { ok: false, message: result.message }
    }

    // If done, mark issue as sent
    if (result.allSent) {
      const { data: updatedIssue } = await supabase
        .from('issues')
        .update({ status: 'sent', sent_at: nowIST().toISOString() })
        .eq('id', issue.id)
        .select('id')
        .single()

      if (updatedIssue) {
        // Notify Shreya
        try {
          await sendTelegramMessage(
            `✅ Newsletter sent! ${result.sent || 0} subscribers received the issue.`
          )
        } catch (err) {
          console.error('Failed to notify via Telegram:', err)
        }
      }
    }

    return { ok: true, message: result.message, sent: result.sent }
  } catch (err) {
    const error = errorMessage(err)
    console.error('Send error:', error)

    await supabase.from('run_logs').insert({
      job: 'send',
      ok: false,
      details: { error },
      started_at: jobStarted.toISOString(),
      finished_at: nowIST().toISOString(),
    })

    return { ok: false, message: error }
  }
}
