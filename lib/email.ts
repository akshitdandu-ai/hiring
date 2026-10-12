import nodemailer from 'nodemailer'
import { env } from './env'
import { supabase } from './db'
import { nowIST, formatIST } from './utils'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: env.GMAIL_USER,
    pass: env.GMAIL_APP_PASSWORD,
  },
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
  rateDelta: 1000,
  rateLimit: 5,
})

async function buildEmailHTML(
  issue: any,
  items: any[],
  unsubscribeLink: string
): Promise<{ html: string; text: string }> {
  const picks = items.filter((i) => i.role === 'pick')

  const itemsHTML = picks
    .map(
      (item, index) =>
        `<tr><td style="padding: 20px; border-bottom: 1px solid #e0e0e0;">
        <div style="display: flex; gap: 10px;">
          <div style="font-size: 12px; color: #666; font-weight: bold; min-width: 60px;">#${index + 1} · ${item.topic}</div>
          <div>
            <h3 style="margin: 0 0 5px 0; font-size: 16px;"><a href="${item.article_url}" style="color: #1f2937; text-decoration: none;">${item.article_title}</a></h3>
            <div style="color: #666; font-size: 13px; margin-bottom: 8px;">${item.article_source}</div>
            <div style="color: #374151; line-height: 1.5; font-size: 14px;">${item.commentary}</div>
          </div>
        </div>
      </td></tr>`
    )
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #374151; background: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; background: white;">
        <div style="padding: 30px; border-bottom: 3px solid #7d4dff;">
          <h1 style="margin: 0 0 10px 0; font-size: 24px; color: #1f2937;">The Dispatch</h1>
          <p style="margin: 0; color: #666; font-size: 14px;">Weekly newsletter on the Indian startup ecosystem</p>
        </div>

        <div style="padding: 30px;">
          <div style="color: #666; font-size: 12px; margin-bottom: 20px;">Week of ${formatIST(new Date())}</div>
          <h2 style="margin: 0 0 10px 0; font-size: 20px;">${issue.subject}</h2>
          <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">${issue.intro}</p>

          <table style="width: 100%; border-collapse: collapse;">
            ${itemsHTML}
          </table>
        </div>

        <div style="padding: 20px 30px; background: #f9fafb; border-top: 1px solid #e0e0e0; font-size: 13px; color: #666;">
          <p style="margin: 0 0 10px 0;">
            <a href="${env.APP_BASE_URL}" style="color: #7d4dff; text-decoration: none;">View in browser</a>
          </p>
          <p style="margin: 0 0 10px 0;">
            <a href="${unsubscribeLink}" style="color: #7d4dff; text-decoration: none;">Unsubscribe</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `

  const text = `
The Dispatch - Weekly newsletter on the Indian startup ecosystem

${issue.subject}

${issue.intro}

${picks.map((item, i) => `#${i + 1} · ${item.topic}\n${item.article_title}\nSource: ${item.article_source}\n${item.commentary}`).join('\n\n')}

View in browser: ${env.APP_BASE_URL}
Unsubscribe: ${unsubscribeLink}
  `

  return { html, text }
}

export async function sendEmails(
  issueId: string
): Promise<{ ok: boolean; message: string; sent?: number; allSent?: boolean }> {
  try {
    // Get issue and items
    const { data: issue } = await supabase
      .from('issues')
      .select('id, subject, intro')
      .eq('id', issueId)
      .single()

    if (!issue) {
      return { ok: false, message: 'Issue not found' }
    }

    const { data: items } = await supabase
      .from('issue_items')
      .select('id, article_id, role, topic, commentary')
      .eq('issue_id', issueId)

    if (!items) {
      return { ok: false, message: 'No items found' }
    }

    // Get article details
    const articleIds = items.map((i: any) => i.article_id)
    const { data: articles } = await supabase
      .from('articles')
      .select('id, title, url, source_name')
      .in('id', articleIds)

    const articleMap = new Map(articles?.map((a: any) => [a.id, a]) || [])

    // Enrich items with article data
    const enrichedItems = items.map((item: any) => {
      const article = articleMap.get(item.article_id) as any
      return {
        ...item,
        article_title: article?.title || '',
        article_url: article?.url || '',
        article_source: article?.source_name || '',
      }
    })

    // Get active subscribers
    const { data: subscribers } = await supabase
      .from('subscribers')
      .select('id, email, unsubscribe_token')
      .eq('status', 'active')

    if (!subscribers || subscribers.length === 0) {
      return { ok: true, message: 'No active subscribers', sent: 0, allSent: true }
    }

    // Check sent log for already sent
    const { data: sentLog } = await supabase
      .from('send_log')
      .select('subscriber_id')
      .eq('issue_id', issueId)
      .eq('status', 'sent')

    const sentIds = new Set(sentLog?.map((s: any) => s.subscriber_id) || [])

    // Filter to unsent
    const toSend = subscribers.filter((s: any) => !sentIds.has(s.id))

    console.log(`Sending to ${toSend.length} unsent subscribers`)

    let sent = 0
    const { html, text } = await buildEmailHTML(
      issue,
      enrichedItems,
      `${env.APP_BASE_URL}/unsubscribe?token=${subscribers[0]?.unsubscribe_token || ''}`
    )

    for (const subscriber of toSend) {
      try {
        const unsubscribeLink = `${env.APP_BASE_URL}/unsubscribe?token=${subscriber.unsubscribe_token}`

        const info = await transporter.sendMail({
          from: `${env.NEWSLETTER_FROM_NAME} <${env.GMAIL_USER}>`,
          to: subscriber.email,
          subject: issue.subject,
          html,
          text,
          headers: {
            'List-Unsubscribe': `<mailto:${env.GMAIL_USER}?subject=unsubscribe>, <${env.APP_BASE_URL}/api/unsubscribe?token=${subscriber.unsubscribe_token}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })

        await supabase.from('send_log').insert({
          issue_id: issueId,
          subscriber_id: subscriber.id,
          status: 'sent',
        })

        sent++
      } catch (err) {
        console.error(`Failed to send to ${subscriber.email}:`, err)

        await supabase.from('send_log').insert({
          issue_id: issueId,
          subscriber_id: subscriber.id,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Respect daily cap
      if (sent >= env.GMAIL_DAILY_SEND_CAP) {
        console.log(`Reached daily cap of ${env.GMAIL_DAILY_SEND_CAP}`)
        break
      }
    }

    const allSent = toSend.length - sent === 0

    return {
      ok: true,
      message: `Sent ${sent}/${toSend.length}`,
      sent,
      allSent,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('Email send error:', error)
    return { ok: false, message: error }
  }
}

export async function scanBounces(): Promise<{ ok: boolean; message: string }> {
  // This would require IMAP setup for production
  // For now, return a placeholder
  return { ok: true, message: 'Bounce scanning not yet implemented' }
}
