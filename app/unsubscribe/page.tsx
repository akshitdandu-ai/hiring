import { Suspense } from 'react'
import { supabase } from '@/lib/db'

async function UnsubscribeContent({ token }: { token: string }) {
  try {
    const { data: subscriber, error } = await supabase
      .from('subscribers')
      .select('id, email, status')
      .eq('unsubscribe_token', token)
      .single()

    if (error || !subscriber) {
      return (
        <div className="bg-blue-50 p-6 rounded-lg">
          <p className="text-slate-600">Token not found or already unsubscribed.</p>
        </div>
      )
    }

    if (subscriber.status === 'unsubscribed') {
      return (
        <div className="bg-green-50 p-6 rounded-lg">
          <h2 className="text-lg font-bold mb-2">Already Unsubscribed</h2>
          <p className="text-slate-600">{subscriber.email} is already removed from our list.</p>
        </div>
      )
    }

    // Mark as unsubscribed
    await supabase
      .from('subscribers')
      .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
      .eq('id', subscriber.id)

    return (
      <div className="bg-green-50 p-6 rounded-lg">
        <h2 className="text-lg font-bold mb-2">✓ Unsubscribed</h2>
        <p className="text-slate-600 mb-4">{subscriber.email} has been removed from The Dispatch mailing list.</p>
        <p className="text-slate-500 text-sm">We're sorry to see you go. You won't receive any more emails from us.</p>
      </div>
    )
  } catch (err) {
    return (
      <div className="bg-red-50 p-6 rounded-lg">
        <p className="text-red-800">Error processing unsubscribe request. Please try again later.</p>
      </div>
    )
  }
}

export default async function UnsubscribePage(props: any) {
  const searchParams = await props.searchParams
  const token = searchParams.token || ''

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold mb-6">The Dispatch</h1>

        <Suspense fallback={<p>Processing...</p>}>
          <UnsubscribeContent token={token} />
        </Suspense>

        <div className="mt-6 text-center">
          <a href="/" className="text-dispatch-600 hover:text-dispatch-700 font-medium">
            ← Back to home
          </a>
        </div>
      </div>
    </div>
  )
}
