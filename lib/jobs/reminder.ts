import { supabase } from '../db'
import { nowIST, errorMessage, getWeekKeyIST } from '../utils'
import { sendTelegramMessage } from '../telegram'

export async function runReminder(): Promise<{ ok: boolean; message: string }> {
  const jobStarted = nowIST()

  try {
    const weekKey = getWeekKeyIST()

    // Get this week's issue
    const { data: issue } = await supabase
      .from('issues')
      .select('id, status, reminder_sent_at')
      .eq('week_key', weekKey)
      .single()

    if (!issue) {
      return { ok: true, message: 'No issue this week, skipping reminder' }
    }

    // If already confirmed or sent, no reminder needed
    if (issue.status === 'confirmed' || issue.status === 'sent') {
      return { ok: true, message: 'Issue already confirmed/sent' }
    }

    // If draft or in_review and no reminder sent yet
    if ((issue.status === 'draft' || issue.status === 'in_review') && !issue.reminder_sent_at) {
      const message = `⏰ The Dispatch for this week isn't confirmed yet. Nothing will be sent until you confirm.`

      try {
        await sendTelegramMessage(message, [
          {
            text: '📝 Re-send draft',
            callback_data: 'draft_resend',
          },
        ])

        // Mark reminder sent
        await supabase.from('issues').update({ reminder_sent_at: nowIST().toISOString() }).eq('id', issue.id)

        return { ok: true, message: 'Reminder sent' }
      } catch (err) {
        const error = errorMessage(err)
        return { ok: false, message: `Failed to send reminder: ${error}` }
      }
    }

    return { ok: true, message: 'No reminder needed' }
  } catch (err) {
    const error = errorMessage(err)
    console.error('Reminder error:', error)
    return { ok: false, message: error }
  } finally {
    await supabase.from('run_logs').insert({
      job: 'reminder',
      ok: true,
      started_at: jobStarted.toISOString(),
      finished_at: nowIST().toISOString(),
    })
  }
}
