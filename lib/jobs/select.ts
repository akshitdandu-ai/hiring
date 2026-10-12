import { supabase } from '../db'
import { nowIST, getWeekKeyIST } from '../utils'
import { selectArticles, generateCommentary, generateSubjectAndIntro } from '../gemini'

interface SelectionResult {
  ok: boolean
  message: string
  picks?: number
  backups?: number
  theme?: string
}

async function validateAndRepair(
  picks: Array<{ id: string; topic: string }>,
  backups: Array<{ id: string; topic: string }>,
  candidates: Array<{ id: string; topic: string }>,
  maxPicks = 10,
  minPicks = 8,
  minTopics = 3
): Promise<{ picks: typeof picks; backups: typeof backups }> {
  // Validate picks
  if (picks.length < minPicks) {
    // Fill from backups
    const available = backups.filter((b) => !picks.some((p) => p.id === b.id))
    const toAdd = available.slice(0, minPicks - picks.length)
    picks.push(...toAdd)
    backups = backups.filter((b) => !toAdd.some((t) => t.id === b.id))
  }

  if (picks.length > maxPicks) {
    picks = picks.slice(0, maxPicks)
  }

  // Validate topics
  const topicsSet = new Set(picks.map((p) => p.topic))
  if (topicsSet.size < minTopics) {
    // Add from backups to cover more topics
    const missingTopics = minTopics - topicsSet.size
    const available = backups.filter((b) => !topicsSet.has(b.topic))
    for (let i = 0; i < missingTopics && available.length > 0; i++) {
      const item = available.shift()
      if (item) {
        picks.push(item)
        topicsSet.add(item.topic)
      }
    }
  }

  // Ensure 5 backups
  if (backups.length < 5) {
    const available = candidates.filter((c) => !picks.some((p) => p.id === c.id) && !backups.some((b) => b.id === c.id))
    backups.push(...available.slice(0, 5 - backups.length))
  }

  if (backups.length > 5) {
    backups = backups.slice(0, 5)
  }

  return { picks, backups }
}

export async function runSelection(force = false): Promise<SelectionResult> {
  const jobStarted = nowIST()

  try {
    const weekKey = getWeekKeyIST()

    // Check if issue already exists
    const { data: existingIssue } = await supabase.from('issues').select('id, status').eq('week_key', weekKey).single()

    if (existingIssue && !force) {
      return {
        ok: false,
        message: `Issue for week ${weekKey} already exists with status ${existingIssue.status}. Use force=true to regenerate.`,
      }
    }

    if (existingIssue && existingIssue.status !== 'draft' && existingIssue.status !== 'in_review' && !force) {
      return {
        ok: false,
        message: `Cannot regenerate issue with status ${existingIssue.status}`,
      }
    }

    console.log(`📝 Running selection for week ${weekKey}...`)

    // Get candidates
    let { data: candidates } = await supabase
      .from('articles')
      .select('id, title, source_name, published_at, topic, summary')
      .eq('week_key', weekKey)
      .in('status', ['new', 'duplicate'])
      .order('published_at', { ascending: false })

    if (!candidates) candidates = []

    if (candidates.length < 25) {
      console.log(`⚠️  Only ${candidates.length} articles this week. Falling back to last 7 days...`)

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const { data: fallbackCandidates } = await supabase
        .from('articles')
        .select('id, title, source_name, published_at, topic, summary')
        .gte('fetched_at', sevenDaysAgo.toISOString())
        .in('status', ['new', 'duplicate'])
        .order('published_at', { ascending: false })
        .limit(150)

      if (!fallbackCandidates || fallbackCandidates.length === 0) {
        throw new Error('No candidates found')
      }

      candidates.push(...fallbackCandidates)
    }

    console.log(`✓ Found ${candidates.length} candidate articles`)

    // Get last 4 sent issues' headlines
    const { data: lastIssues } = await supabase
      .from('issues')
      .select('id')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(4)

    let lastHeadlines: string[] = []
    if (lastIssues && lastIssues.length > 0) {
      const { data: lastItems } = await supabase
        .from('issue_items')
        .select('article_id')
        .in('issue_id', lastIssues.map((i: any) => i.id))
        .eq('role', 'pick')

      if (lastItems) {
        const { data: articles } = await supabase
          .from('articles')
          .select('title')
          .in(
            'id',
            lastItems.map((i: any) => i.article_id)
          )

        lastHeadlines = articles?.map((a: any) => a.title) || []
      }
    }

    // Get style guide
    const { data: styleGuideData } = await supabase.from('style_guide').select('content').eq('id', 1).single()

    const styleGuide = styleGuideData?.content || ''

    // Run Gemini selection
    console.log(`🤖 Running Gemini selection pass...`)

    const selection = await selectArticles(
      candidates.map((c: any) => ({
        id: c.id,
        title: c.title,
        source: c.source_name || 'Unknown',
        published_at: c.published_at,
        topic: c.topic || 'Other',
        summary: c.summary || '',
      })),
      lastHeadlines,
      styleGuide
    )

    // Validate and repair
    let { picks, backups } = await validateAndRepair(
      selection.picks.map((p: any) => ({ id: p.article_id, topic: p.topic })),
      selection.backups.map((b: any) => ({ id: b.article_id, topic: b.topic })),
      candidates.map((c: any) => ({ id: c.id, topic: c.topic || 'Other' }))
    )

    console.log(`✓ Selection: ${picks.length} picks, ${backups.length} backups`)

    // Generate commentary for picks + backups
    console.log(`📄 Generating commentary...`)

    const itemsToComment = [...picks, ...backups]
    const articleDetails = candidates.filter((c: any) => itemsToComment.some((i: any) => i.id === c.id))

    const commentary = await generateCommentary(
      articleDetails.map((a: any) => ({
        id: a.id,
        title: a.title,
        source: a.source_name || 'Unknown',
        summary: a.summary || '',
      })),
      styleGuide
    )

    const commentaryMap = new Map(commentary.map((c) => [c.article_id, c.commentary]))

    // Generate subject and intro
    console.log(`✨ Generating subject and intro...`)

    const { subject, intro } = await generateSubjectAndIntro(selection.issue_theme, styleGuide)

    // Create or update issue
    let issueId = existingIssue?.id

    if (!issueId) {
      const { data: newIssue, error } = await supabase
        .from('issues')
        .insert({
          week_key: weekKey,
          status: 'draft',
          subject,
          intro,
          topics: Array.from(new Set([...picks, ...backups].map((p) => p.topic))),
          selection_notes: { method: 'gemini', fallback_to_7days: candidates.length < 25 },
        })
        .select('id')
        .single()

      if (error) throw error
      issueId = newIssue.id
    } else {
      await supabase
        .from('issues')
        .update({
          subject,
          intro,
          topics: Array.from(new Set([...picks, ...backups].map((p) => p.topic))),
        })
        .eq('id', issueId)
    }

    // Create issue items (picks and backups)
    const itemsToInsert = [
      ...picks.map((p, i) => ({
        issue_id: issueId,
        article_id: p.id,
        role: 'pick' as const,
        position: i,
        topic: p.topic,
        why_selected: selection.picks[picks.indexOf(p)]?.why_selected || '',
        commentary: commentaryMap.get(p.id) || '',
        approved: false,
      })),
      ...backups.map((b, i) => ({
        issue_id: issueId,
        article_id: b.id,
        role: 'backup' as const,
        rank: i + 1,
        topic: b.topic,
        why_selected: selection.backups[i]?.why_selected || '',
        commentary: commentaryMap.get(b.id) || '',
      })),
    ]

    // Delete existing items if regenerating
    if (existingIssue) {
      await supabase.from('issue_items').delete().eq('issue_id', issueId)
    }

    const { error: itemsError } = await supabase.from('issue_items').insert(itemsToInsert)

    if (itemsError) throw itemsError

    console.log(`✓ Created ${picks.length + backups.length} issue items\n`)

    // Log run
    await supabase.from('run_logs').insert({
      job: 'select',
      ok: true,
      details: { picks: picks.length, backups: backups.length, theme: selection.issue_theme },
      started_at: jobStarted.toISOString(),
      finished_at: nowIST().toISOString(),
    })

    return {
      ok: true,
      message: `Selection complete for ${weekKey}`,
      picks: picks.length,
      backups: backups.length,
      theme: selection.issue_theme,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('❌ Selection failed:', error)

    await supabase.from('run_logs').insert({
      job: 'select',
      ok: false,
      details: { error },
      started_at: jobStarted.toISOString(),
      finished_at: nowIST().toISOString(),
    })

    return {
      ok: false,
      message: error,
    }
  }
}
