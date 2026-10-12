import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { supabase } from '@/lib/db'
import { answerCallbackQuery, editTelegramMessage, sendTelegramMessage } from '@/lib/telegram'
import { getWeekKeyIST } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const secretToken = req.headers.get('x-telegram-bot-api-secret-token')

  if (secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const update = await req.json()

    // Handle messages
    if (update.message) {
      const chatId = update.message.chat.id
      const text = update.message.text

      // Only accept from admin
      if (chatId !== parseInt(env.TELEGRAM_ADMIN_CHAT_ID)) {
        return NextResponse.json({ ok: true })
      }

      if (text === '/start') {
        await sendTelegramMessage(
          `👋 Welcome! Your chat ID is <code>${chatId}</code>. Set TELEGRAM_ADMIN_CHAT_ID to this value.`,
          undefined,
          String(chatId)
        )
      } else if (text === '/status') {
        // Get current issue status
        const weekKey = getWeekKeyIST()
        const { data: issue } = await supabase
          .from('issues')
          .select('status, week_key')
          .eq('week_key', weekKey)
          .single()

        if (issue) {
          const { data: items } = await supabase
            .from('issue_items')
            .select('approved')
            .eq('issue_id', issue.id)
            .eq('role', 'pick')

          const approved = items?.filter((i: any) => i.approved).length || 0
          const total = items?.length || 0

          await sendTelegramMessage(
            `📊 <b>This week's issue (${issue.week_key})</b>\nStatus: <b>${issue.status}</b>\nApproved: ${approved}/${total} stories`,
            undefined,
            String(chatId)
          )
        } else {
          await sendTelegramMessage('No issue this week yet', undefined, String(chatId))
        }
      } else if (text === '/help') {
        await sendTelegramMessage(
          `<b>The Dispatch Admin</b>\n\n/status - Current issue status\n/draft - Re-send draft\n/help - This help\n\nUse buttons to approve, swap, edit, or confirm stories.`,
          undefined,
          String(chatId)
        )
      } else if (text === '/draft') {
        // Resend current draft
        const weekKey = getWeekKeyIST()
        const { data: issue } = await supabase
          .from('issues')
          .select('id, status, subject, topics')
          .eq('week_key', weekKey)
          .single()

        if (issue && (issue.status === 'in_review' || issue.status === 'draft')) {
          await sendDraftToTelegram(issue.id, String(chatId))
        } else {
          await sendTelegramMessage('No draft to resend', undefined, String(chatId))
        }
      } else if (text?.startsWith('/cancel')) {
        // Cancel edit mode
        await supabase.from('bot_state').delete().eq('chat_id', chatId)
        await sendTelegramMessage('✓ Edit cancelled', undefined, String(chatId))
      } else {
        // Check if awaiting text input (edit commentary)
        const { data: state } = await supabase.from('bot_state').select('awaiting, payload').eq('chat_id', chatId).single()

        if (state?.awaiting === 'edit_commentary' && state.payload?.item_id) {
          const itemId = state.payload.item_id
          const newCommentary = text || ''

          if (newCommentary.length < 10) {
            await sendTelegramMessage('Commentary too short (min 10 chars)', undefined, String(chatId))
            return NextResponse.json({ ok: true })
          }

          // Update commentary
          await supabase
            .from('issue_items')
            .update({ commentary: newCommentary, edited: true, approved: true })
            .eq('id', itemId)

          // Clear state
          await supabase.from('bot_state').delete().eq('chat_id', chatId)

          await sendTelegramMessage(`✓ Commentary updated:\n\n${newCommentary}`, undefined, String(chatId))
        }
      }

      return NextResponse.json({ ok: true })
    }

    // Handle callback queries
    if (update.callback_query) {
      const queryId = update.callback_query.id
      const chatId = update.callback_query.from.id
      const data = update.callback_query.data

      // Only accept from admin
      if (chatId !== parseInt(env.TELEGRAM_ADMIN_CHAT_ID)) {
        await answerCallbackQuery(queryId, 'Not authorized', true)
        return NextResponse.json({ ok: true })
      }

      if (data === 'draft_resend') {
        // Resend draft
        await answerCallbackQuery(queryId)
        const weekKey = getWeekKeyIST()
        const { data: issue } = await supabase.from('issues').select('id').eq('week_key', weekKey).single()
        if (issue) {
          await sendDraftToTelegram(issue.id, String(chatId))
        }
      } else if (data.startsWith('ap:')) {
        // Approve item
        const itemId = data.slice(3)
        await supabase.from('issue_items').update({ approved: true }).eq('id', itemId)
        await answerCallbackQuery(queryId, '✅ Approved')
      } else if (data.startsWith('sw:')) {
        // Swap item with highest-ranked unused backup
        const itemId = data.slice(3)
        const { data: item } = await supabase.from('issue_items').select('issue_id, role, topic').eq('id', itemId).single()

        if (item && item.role === 'pick') {
          const { data: backups } = await supabase
            .from('issue_items')
            .select('id, article_id, topic, commentary, rank')
            .eq('issue_id', item.issue_id)
            .eq('role', 'backup')
            .order('rank', { ascending: true })

          if (backups && backups.length > 0) {
            const swapWith = backups[0]

            // Swap roles
            await supabase.from('issue_items').update({ role: 'removed' }).eq('id', itemId)
            await supabase.from('issue_items').update({ role: 'pick' }).eq('id', swapWith.id)

            await answerCallbackQuery(queryId, '🔄 Swapped')
          } else {
            await answerCallbackQuery(queryId, 'No backups available', true)
          }
        }
      } else if (data.startsWith('ed:')) {
        // Edit commentary - set awaiting state
        const itemId = data.slice(3)
        await supabase
          .from('bot_state')
          .upsert([{ chat_id: chatId, awaiting: 'edit_commentary', payload: { item_id: itemId } }], { onConflict: 'chat_id' })
        await answerCallbackQuery(queryId)
        await sendTelegramMessage('📝 Send new commentary (or /cancel to abort)', undefined, String(chatId))
      } else if (data === 'confirm') {
        // Two-step confirm
        await answerCallbackQuery(queryId)
        const weekKey = getWeekKeyIST()
        const { data: issue } = await supabase.from('issues').select('id, status').eq('week_key', weekKey).single()

        if (issue?.status === 'in_review') {
          await sendTelegramMessage(
            '✅ <b>Confirm final draft?</b>\n\nAfter confirmation, emails will send Thu 08:00 IST.',
            [
              { text: '✅ Yes, confirm', callback_data: 'confirm_yes' },
              { text: '❌ Cancel', callback_data: 'confirm_no' },
            ],
            String(chatId)
          )
        }
      } else if (data === 'confirm_yes') {
        // Mark as confirmed
        const weekKey = getWeekKeyIST()
        const { error } = await supabase
          .from('issues')
          .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
          .eq('week_key', weekKey)

        if (error) {
          await answerCallbackQuery(queryId, 'Error confirming', true)
        } else {
          await answerCallbackQuery(queryId, '🚀 Confirmed! Newsletter will send Thu 08:00 IST')
          await sendTelegramMessage('✅ <b>Newsletter confirmed!</b>\n\nWill send to all subscribers Thursday morning.', undefined, String(chatId))
        }
      } else if (data === 'confirm_no') {
        await answerCallbackQuery(queryId, '❌ Cancelled')
      }

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}

async function sendDraftToTelegram(issueId: string, chatId: string) {
  try {
    const { data: issue } = await supabase
      .from('issues')
      .select('id, subject, intro, topics')
      .eq('id', issueId)
      .single()

    const { data: items } = await supabase
      .from('issue_items')
      .select('id, role, topic, article_id, why_selected, commentary, approved, telegram_message_id')
      .eq('issue_id', issueId)
      .order('position')

    if (!issue || !items) return

    // Header message
    const picks = items.filter((i: any) => i.role === 'pick')
    const approved = picks.filter((p: any) => p.approved).length
    const headerText = `<b>📰 The Dispatch - ${issue.topics?.join(', ') || 'This week'}</b>\n\n<b>${issue.subject}</b>\n${issue.intro}\n\n${approved}/${picks.length} approved • Ready to <b>confirm</b> ✓`

    const headerMsg = await sendTelegramMessage(headerText, [{ text: '📧 Preview email', callback_data: 'draft_preview' }], chatId)

    // One message per pick with buttons
    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i]
      const { data: article } = await supabase.from('articles').select('title, source_name').eq('id', pick.article_id).single()

      const pickText = `<b>#${i + 1} · ${pick.topic}</b>\n\n<b>${article?.title || 'Unknown'}</b>\nSource: ${article?.source_name || 'Unknown'}\n\n${pick.commentary || ''}`

      const buttons = [
        { text: pick.approved ? '✅ Approved' : '✅ Approve', callback_data: `ap:${pick.id}` },
        { text: '🔄 Swap', callback_data: `sw:${pick.id}` },
        { text: '✏️ Edit', callback_data: `ed:${pick.id}` },
      ]

      await sendTelegramMessage(pickText, buttons, chatId)
    }

    // Footer with confirm button
    await sendTelegramMessage(
      `<b>Ready?</b>\n\n✓ All stories reviewed\n✓ ${approved} stories approved\n\nTap <b>Confirm</b> to schedule sending for Thu 08:00 IST.`,
      [
        { text: '🚀 Confirm final draft', callback_data: 'confirm' },
        { text: '📖 Resend draft', callback_data: 'draft_resend' },
      ],
      chatId
    )
  } catch (error) {
    console.error('Error sending draft to Telegram:', error)
  }
}
