import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { supabase } from '@/lib/db'
import { answerCallbackQuery, editTelegramMessage, sendTelegramMessage } from '@/lib/telegram'

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
        const { data: issue } = await supabase
          .from('issues')
          .select('status, topic')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (issue) {
          await sendTelegramMessage(
            `📊 Current issue status: <b>${issue.status}</b>`,
            undefined,
            String(chatId)
          )
        } else {
          await sendTelegramMessage('No issue yet', undefined, String(chatId))
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

        // TODO: Re-send draft UI
        await sendTelegramMessage('Re-sending draft... (not yet implemented)', undefined, String(chatId))
      } else if (data.startsWith('ap:')) {
        // Approve item
        const itemId = data.slice(3)

        await supabase.from('issue_items').update({ approved: true }).eq('id', itemId)

        await answerCallbackQuery(queryId, '✅ Approved')
      } else if (data.startsWith('sw:')) {
        // Swap item
        const itemId = data.slice(3)

        // Find backup and swap
        const { data: item } = await supabase.from('issue_items').select('issue_id, article_id').eq('id', itemId).single()

        if (item) {
          const { data: backup } = await supabase
            .from('issue_items')
            .select('id, article_id')
            .eq('issue_id', item.issue_id)
            .eq('role', 'backup')
            .limit(1)
            .single()

          if (backup) {
            // Mark old as removed, update new to pick
            await supabase.from('issue_items').update({ role: 'removed' }).eq('id', itemId)

            await supabase
              .from('issue_items')
              .update({ role: 'pick', position: 0, approved: false })
              .eq('id', backup.id)

            await answerCallbackQuery(queryId, '🔄 Swapped')
          } else {
            await answerCallbackQuery(queryId, 'No backups available', true)
          }
        }
      }

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
