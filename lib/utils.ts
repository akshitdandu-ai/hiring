import crypto from 'crypto'
import { toZonedTime, formatInTimeZone } from 'date-fns-tz'

const IST = 'Asia/Kolkata'

export function nowIST(): Date {
  return toZonedTime(new Date(), IST)
}

export function getWeekKeyIST(date: Date = nowIST()): string {
  const zonedDate = toZonedTime(date, IST)
  const year = zonedDate.getFullYear()

  // ISO week number: Monday is day 1
  const jan1 = new Date(year, 0, 1)
  const jan1Day = toZonedTime(jan1, IST).getDay()
  const daysToMonday = (8 - jan1Day) % 7
  const firstMonday = new Date(jan1)
  firstMonday.setDate(1 + daysToMonday)

  const diffTime = zonedDate.getTime() - toZonedTime(firstMonday, IST).getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  const weekNum = Math.floor(diffDays / 7) + 1

  return `${year}-W${String(weekNum).padStart(2, '0')}`
}

export function formatIST(date: Date, format: string = 'yyyy-MM-dd HH:mm:ss'): string {
  return formatInTimeZone(date, IST, format)
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

export function normalizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr)

    // Remove tracking params
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'fbclid', 'gclid']
    paramsToRemove.forEach((param) => url.searchParams.delete(param))

    // Normalize hostname
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')

    // Remove fragment
    url.hash = ''

    // Remove trailing slash
    let normalized = url.toString()
    const slashCount = (normalized.match(/\//g) || []).length
    if (normalized.endsWith('/') && slashCount > 2) {
      normalized = normalized.slice(0, -1)
    }

    return normalized
  } catch {
    return urlStr.toLowerCase()
  }
}

export function normalizeTitle(title: string): string {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are', 'was', 'be', 'by', 'from', 'with',
  ])

  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !stopwords.has(word))
    .join(' ')
}

// Jaccard similarity between two sets of tokens
export function tokenSetJaccard(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1)
  const set2 = new Set(tokens2)
  const union = new Set([...set1, ...set2])
  const intersection = new Set([...set1].filter((x) => set2.has(x)))

  return union.size === 0 ? 0 : intersection.size / union.size
}

export function titleSimilarity(title1: string, title2: string): number {
  const norm1 = normalizeTitle(title1).split(/\s+/)
  const norm2 = normalizeTitle(title2).split(/\s+/)
  return tokenSetJaccard(norm1, norm2)
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.code && `code ${e.code}`, e.details, e.hint].filter(Boolean)
    if (parts.length > 0) return parts.join(' | ')
    try {
      return JSON.stringify(err)
    } catch {
      return 'Unknown error'
    }
  }
  return String(err)
}
