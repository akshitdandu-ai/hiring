import { supabase } from '@/lib/db'
import Link from 'next/link'

export default async function ArchivePage(props: any) {
  const { weekKey } = await props.params

  const { data: issue } = await supabase
    .from('issues')
    .select('id, week_key, subject, intro, status, sent_at, topics')
    .eq('week_key', weekKey)
    .eq('status', 'sent')
    .single()

  if (!issue) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">Issue Not Found</h1>
          <p className="text-slate-600 mb-6">The issue for week {weekKey} doesn't exist or hasn't been sent yet.</p>
          <Link href="/" className="text-dispatch-600 hover:text-dispatch-700 font-medium">
            ← Back to home
          </Link>
        </div>
      </div>
    )
  }

  const { data: items } = await supabase
    .from('issue_items')
    .select('id, article_id, role, topic, commentary')
    .eq('issue_id', issue.id)
    .eq('role', 'pick')
    .order('position')

  const articleIds = items?.map((i: any) => i.article_id) || []
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, url, source_name')
    .in('id', articleIds)

  const articleMap = new Map(articles?.map((a: any) => [a.id, a]) || [])

  const enrichedItems = (items || []).map((item: any) => {
    const article = articleMap.get(item.article_id) as any
    return {
      ...item,
      title: article?.title || '',
      url: article?.url || '',
      source: article?.source_name || '',
    }
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-dispatch-50 via-white to-dispatch-100 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-dispatch-900 mb-2">The Dispatch</h1>
          <p className="text-slate-600">Week {weekKey}</p>
        </div>

        {/* Issue Info */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold mb-2">{issue.subject}</h2>
          <p className="text-slate-600 mb-4">{issue.intro}</p>
          {issue.topics && issue.topics.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {issue.topics.map((topic: string) => (
                <span key={topic} className="bg-dispatch-100 text-dispatch-800 px-3 py-1 rounded-full text-sm">
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stories */}
        <div className="space-y-6">
          {enrichedItems.map((item: any, index: number) => (
            <div key={item.id} className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex gap-4">
                <div className="text-dispatch-600 font-bold text-lg min-w-12">#{ index + 1}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-dispatch-600 mb-2">{item.topic}</div>
                  <h3 className="text-xl font-bold mb-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-dispatch-600 transition-colors"
                    >
                      {item.title}
                    </a>
                  </h3>
                  <div className="text-sm text-slate-600 mb-3">{item.source}</div>
                  <p className="text-slate-700 leading-relaxed">{item.commentary}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center">
          <Link href="/" className="text-dispatch-600 hover:text-dispatch-700 font-medium">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}

export async function generateMetadata(props: any) {
  const { weekKey } = await props.params
  const { data: issue } = await supabase
    .from('issues')
    .select('subject')
    .eq('week_key', weekKey)
    .eq('status', 'sent')
    .single()

  return {
    title: issue?.subject || `The Dispatch - Week ${weekKey}`,
    description: 'Weekly newsletter on the Indian startup ecosystem',
  }
}
