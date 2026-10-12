import { supabase } from '../db'
import { env } from '../env'
import { sha256, errorMessage, normalizeUrl, normalizeTitle, titleSimilarity, getWeekKeyIST, nowIST } from '../utils'
import Parser from 'rss-parser'

interface IngestResult {
  fetched: number
  inserted: number
  duplicates: number
  excluded: number
  errors: Record<string, string>
}

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [['content:encoded', 'fullContent']],
  },
})

async function fetchRSSFeed(url: string): Promise<{ items: any[]; error?: string }> {
  try {
    const feed = await parser.parseURL(url)

    const items = feed.items.map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate && !isNaN(new Date(item.pubDate).getTime()) ? new Date(item.pubDate) : new Date(),
      summary: (item.contentSnippet || item.description || item.fullContent || '').slice(0, 600).replace(/<[^>]+>/g, ''),
      source: feed.title || 'Unknown',
    }))

    return items.length > 0 ? { items } : { items, error: 'Feed loaded but contained no items' }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`Error fetching ${url}:`, error)
    return { items: [], error }
  }
}

async function getLastSentIssues() {
  const { data, error } = await supabase
    .from('issues')
    .select('id, created_at')
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(4)

  if (error) {
    console.error('Error fetching last issues:', error)
    return []
  }
  return data
}

async function getExcludedArticles() {
  const lastIssues = await getLastSentIssues()
  if (lastIssues.length === 0) return []

  const { data: items, error } = await supabase
    .from('issue_items')
    .select('article_id')
    .in('issue_id', lastIssues.map((i: any) => i.id))
    .eq('role', 'pick')

  if (error) {
    console.error('Error fetching excluded articles:', error)
    return []
  }

  return items.map((i: any) => i.article_id)
}

export async function runIngest(): Promise<IngestResult> {
  const result: IngestResult = {
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    excluded: 0,
    errors: {},
  }

  const startTime = Date.now()
  const jobStarted = nowIST()

  try {
    // Get all active sources
    const { data: sources, error: sourcesError } = await supabase.from('sources').select('*').eq('active', true)

    if (sourcesError) throw sourcesError
    if (!sources || sources.length === 0) {
      throw new Error('No active sources found')
    }

    console.log(`📡 Fetching from ${sources.length} sources...`)

    // Fetch in parallel with concurrency limit
    const concurrencyLimit = 3
    const items: any[] = []

    for (let i = 0; i < sources.length; i += concurrencyLimit) {
      const batch = sources.slice(i, i + concurrencyLimit)
      const batchResults = await Promise.all(batch.map((source: any) => fetchRSSFeed(source.url_or_query)))

      for (let index = 0; index < batchResults.length; index++) {
        const { items: batchItems, error: feedError } = batchResults[index]
        const source = batch[index]
        result.fetched += batchItems.length

        await supabase
          .from('sources')
          .update({
            last_fetched_at: new Date().toISOString(),
            last_ok: !feedError,
            last_error: feedError || null,
            items_last_run: batchItems.length,
          })
          .eq('id', source.id)

        if (feedError) {
          result.errors[source.name] = feedError
          continue
        }

        items.push(
          ...batchItems.map((item: any) => ({
            ...item,
            sourceId: source.id,
            sourceName: source.name,
          }))
        )
      }
    }

    console.log(`✓ Fetched ${result.fetched} articles\n`)

    // Get excluded articles from last 4 sent issues (with their URL hashes)
    const excludedArticleIds = await getExcludedArticles()

    // Fetch excluded articles' details to match by URL and title
    const { data: excludedArticles } = excludedArticleIds.length > 0
      ? await supabase
          .from('articles')
          .select('id, url_hash, title')
          .in('id', excludedArticleIds)
      : { data: [] }

    // Get similar articles from last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const { data: recentArticles } = await supabase
      .from('articles')
      .select('id, url_hash, title, url')
      .gte('fetched_at', sevenDaysAgo.toISOString())

    // Process and insert articles
    const weekKey = getWeekKeyIST()
    let processedCount = 0

    const allHashes = items.map((item: any) => sha256(normalizeUrl(item.link)))
    const existingHashes = new Set<string>()
    for (let i = 0; i < allHashes.length; i += 200) {
      const { data: found } = await supabase
        .from('articles')
        .select('url_hash')
        .in('url_hash', allHashes.slice(i, i + 200))
      found?.forEach((r: any) => existingHashes.add(r.url_hash))
    }

    for (const item of items) {
      if (!item.link || !item.title) continue

      const normalizedUrl = normalizeUrl(item.link)
      const urlHash = sha256(normalizedUrl)

      if (existingHashes.has(urlHash)) {
        result.duplicates++
        continue
      }

      // Check for title similarity duplicates
      let isDuplicate = false
      if (recentArticles) {
        for (const recent of recentArticles) {
          if (titleSimilarity(item.title, recent.title) >= 0.8) {
            isDuplicate = true
            break
          }
        }
      }

      if (isDuplicate) {
        result.duplicates++
        continue
      }

      // Check if excluded (by URL hash or title similarity to excluded articles)
      let isExcluded = false
      if (excludedArticles && excludedArticles.length > 0) {
        for (const excluded of excludedArticles) {
          if (excluded.url_hash === urlHash || titleSimilarity(item.title, excluded.title) >= 0.8) {
            isExcluded = true
            result.excluded++
            break
          }
        }
      }

      // Infer topic (cheap keyword classifier)
      const titleLower = item.title.toLowerCase()
      let topic = 'Other'
      const topicMap: Record<string, string> = {
        funding: 'Funding & VC',
        seed: 'Funding & VC',
        'series a': 'Funding & VC',
        'series b': 'Funding & VC',
        investment: 'Funding & VC',
        fintech: 'Fintech',
        'digital payment': 'Fintech',
        policy: 'Policy & Regulation',
        regulation: 'Policy & Regulation',
        sebi: 'Policy & Regulation',
        layoff: 'Layoffs & Talent',
        hiring: 'Layoffs & Talent',
        'd2c': 'D2C & Consumer',
        'direct-to-consumer': 'D2C & Consumer',
        saas: 'SaaS & Enterprise',
        enterprise: 'SaaS & Enterprise',
        ai: 'AI & Deeptech',
        deeptech: 'AI & Deeptech',
        ipo: 'IPOs & Exits',
        exit: 'IPOs & Exits',
        acquisition: 'IPOs & Exits',
        ev: 'Mobility & EV',
        mobility: 'Mobility & EV',
        health: 'Healthtech',
        medical: 'Healthtech',
        edtech: 'Edtech',
        education: 'Edtech',
      }

      for (const [keyword, topicName] of Object.entries(topicMap)) {
        if (titleLower.includes(keyword)) {
          topic = topicName
          break
        }
      }

      // Insert article
      const { error: insertError } = await supabase.from('articles').insert({
        url: normalizedUrl,
        url_hash: urlHash,
        title: item.title,
        title_norm: normalizeTitle(item.title),
        source_name: item.sourceName,
        source_id: item.sourceId,
        summary: item.summary,
        published_at: item.pubDate.toISOString(),
        topic,
        week_key: weekKey,
        status: isExcluded ? 'excluded' : 'new',
      })

      if (!insertError) {
        existingHashes.add(urlHash)
        result.inserted++
      } else {
        console.error('Insert error:', insertError)
      }

      processedCount++
    }

    console.log(`✓ Inserted ${result.inserted} new articles\n`)
    console.log(`📊 Summary:`)
    console.log(`   - Fetched: ${result.fetched}`)
    console.log(`   - Inserted: ${result.inserted}`)
    console.log(`   - Duplicates: ${result.duplicates}`)
    console.log(`   - Excluded (from last 4): ${result.excluded}\n`)

    // Log run
    await supabase.from('run_logs').insert({
      job: 'ingest',
      ok: true,
      details: result,
      started_at: jobStarted.toISOString(),
      finished_at: nowIST().toISOString(),
    })
  } catch (err) {
    const error = errorMessage(err)
    console.error('❌ Ingest failed:', error)

    await supabase.from('run_logs').insert({
      job: 'ingest',
      ok: false,
      details: { error },
      started_at: jobStarted.toISOString(),
      finished_at: nowIST().toISOString(),
    })

    throw err
  }

  return result
}
