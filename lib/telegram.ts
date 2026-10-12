import { env } from './env'

interface InlineButton {
  text: string
  callback_data: string
}

interface SendOptions {
  parseMode?: 'HTML' | 'Markdown'
  replyMarkup?: {
    inline_keyboard: Array<Array<InlineButton>>
  }
}

export async function sendTelegramMessage(
  text: string,
  buttons?: InlineButton[],
  chatId: string = env.TELEGRAM_ADMIN_CHAT_ID
): Promise<any> {
  if (!chatId) {
    throw new Error('TELEGRAM_ADMIN_CHAT_ID not set')
  }

  const options: SendOptions = {
    parseMode: 'HTML',
  }

  if (buttons && buttons.length > 0) {
    options.replyMarkup = {
      inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.callback_data }))],
    }
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...options,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.statusText}`)
  }

  const data = await response.json()
  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description}`)
  }

  return data.result
}

export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  buttons?: InlineButton[]
): Promise<any> {
  const options: SendOptions = {
    parseMode: 'HTML',
  }

  if (buttons && buttons.length > 0) {
    options.replyMarkup = {
      inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.callback_data }))],
    }
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.statusText}`)
  }

  const data = await response.json()
  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description}`)
  }

  return data.result
}

export async function answerCallbackQuery(queryId: string, text?: string, showAlert = false): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: queryId,
      text,
      show_alert: showAlert,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.statusText}`)
  }
}

export async function setWebhook(url: string): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
    }),
  })

  const data = await response.json()
  if (!data.ok) {
    throw new Error(`Failed to set webhook: ${data.description}`)
  }

  return data
}

export async function getWebhookInfo(): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {
    method: 'GET',
  })

  const data = await response.json()
  if (!data.ok) {
    throw new Error(`Failed to get webhook info: ${data.description}`)
  }

  return data.result
}
