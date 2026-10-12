import { createClient } from '@supabase/supabase-js'
import { env } from '../lib/env'
import { readFileSync } from 'fs'
import { join } from 'path'

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const DEFAULT_STYLE_GUIDE = `**Who reads The Dispatch**
Founders, operators, and venture capitalists building or investing in India's startup ecosystem. They're busy but intellectually curious, and they care about what's real vs. hype.

**What I select for**
- Counterintuitive stories that connect two trends or reveal what others miss
- Under-reported facts—numbers that matter, policy shifts, structural changes
- Substance over noise: skip vanity funding announcements unless the investor or amount signals something
- Story, not just news: a regulatory change only matters if we explain why

**Voice**
- Sharp, skeptical but fair, data-first
- Plain English, no jargon, no hype words ("game-changer", "revolutionize", "disrupt", "exciting")
- Indian context—we understand the specifics of operating here
- Occasional dry wit; never cynical

**Structure of commentary**
Line 1: What actually matters (the substance)
Line 2: The non-obvious implication (why this shifts the game)
Optional line 3: What to watch (the leading indicator of impact)

**Example commentaries**
1. "SEBI tightened FPI rules, cutting some flows by 50%. Indian equities haven't decoupled from global volatility—this makes contagion from a US correction likelier. Watch: rupee weakness in Q4."
2. "DeepSeek's 5B params run on $600K compute—half what we thought necessary. This speeds up AI commodity pricing. Your edge isn't the model anymore; it's the moat around data + execution."
3. "Bengaluru tech layoffs hit 15% of headcount this month; same pattern we saw in Gurgaon in Feb. Talent supply is finally catching up to demand—better for founders, harder on employees."`

const RSS_SOURCES = [
  { name: 'Inc42', type: 'rss', url: 'https://inc42.com/feed/' },
  { name: 'YourStory', type: 'rss', url: 'https://yourstory.com/feed' },
  { name: 'Entrackr', type: 'rss', url: 'https://entrackr.com/feed/' },
  { name: 'ET Tech', type: 'rss', url: 'https://tech.economictimes.indiatimes.com/rss' },
  { name: 'ET Startups', type: 'rss', url: 'https://startups.economictimes.indiatimes.com/rss' },
  { name: 'Mint Tech', type: 'rss', url: 'https://www.livemint.com/rss/tech.xml' },
  { name: 'Google News - Funding', type: 'google_news', url: 'https://news.google.com/rss/search?q=Indian+startup+funding&hl=en-IN&gl=IN&ceid=IN:en' },
  { name: 'Google News - Layoffs', type: 'google_news', url: 'https://news.google.com/rss/search?q=startup+layoffs+India&hl=en-IN&gl=IN&ceid=IN:en' },
  { name: 'Google News - Regulation', type: 'google_news', url: 'https://news.google.com/rss/search?q=SEBI+RBI+startup+regulation&hl=en-IN&gl=IN&ceid=IN:en' },
  { name: 'Google News - IPO', type: 'google_news', url: 'https://news.google.com/rss/search?q=India+startup+IPO&hl=en-IN&gl=IN&ceid=IN:en' },
]

async function seed() {
  console.log('🌱 Seeding database...\n')

  try {
    // Read and execute migration
    console.log('📦 Running migrations...')
    const migrationSQL = readFileSync(join(process.cwd(), 'supabase/migrations/001_init.sql'), 'utf-8')
    const statements = migrationSQL.split(';').filter((s) => s.trim())

    for (const statement of statements) {
      if (statement.trim()) {
        await supabase.rpc('exec_sql', { sql: statement }).catch(() => {
          // Ignore errors for idempotent operations
        })
      }
    }
    console.log('✓ Migrations complete\n')

    // Insert sources
    console.log('🔗 Seeding RSS sources...')
    for (const source of RSS_SOURCES) {
      const { error } = await supabase.from('sources').upsert([source], { onConflict: 'name' })
      if (error && !error.message.includes('duplicate')) {
        console.error(`✗ Error inserting ${source.name}:`, error)
      } else {
        console.log(`✓ ${source.name}`)
      }
    }
    console.log()

    // Insert style guide
    console.log('📝 Seeding style guide...')
    const { error: sgError } = await supabase.from('style_guide').upsert([{ id: 1, content: DEFAULT_STYLE_GUIDE }], { onConflict: 'id' })
    if (sgError) {
      console.error('✗ Error seeding style guide:', sgError)
    } else {
      console.log('✓ Style guide seeded\n')
    }

    // Add admin email as test subscriber
    console.log('👤 Seeding test subscriber...')
    const unsubToken = Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join('')
    const { error: subError } = await supabase.from('subscribers').upsert(
      [
        {
          email: env.ADMIN_EMAIL.toLowerCase(),
          name: 'Test Subscriber',
          status: 'active',
          source: 'admin',
          unsubscribe_token: unsubToken,
        },
      ],
      { onConflict: 'email' }
    )
    if (subError) {
      console.error('✗ Error seeding subscriber:', subError)
    } else {
      console.log(`✓ Admin email (${env.ADMIN_EMAIL}) added as test subscriber\n`)
    }

    console.log('✅ Seed complete!\n')
  } catch (err) {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  }
}

seed()
