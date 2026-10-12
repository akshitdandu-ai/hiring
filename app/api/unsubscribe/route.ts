import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/unsubscribe', req.url))
  }

  try {
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('id')
      .eq('unsubscribe_token', token)
      .single()

    if (subscriber) {
      await supabase
        .from('subscribers')
        .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
        .eq('id', subscriber.id)

      return NextResponse.redirect(new URL(`/unsubscribe?token=${token}`, req.url))
    }

    return NextResponse.redirect(new URL(`/unsubscribe?token=${token}`, req.url))
  } catch (err) {
    return NextResponse.redirect(new URL(`/unsubscribe?token=${token}`, req.url))
  }
}

// RFC 8058 one-click via POST
export async function POST(req: NextRequest) {
  const body = await req.text()

  // RFC 8058: List-Unsubscribe=One-Click sends List-Unsubscribe-Post: List-Unsubscribe=One-Click
  // Email client will POST to the mailto: URL, we don't process that

  return NextResponse.json({ ok: true })
}
