import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db'
import { z } from 'zod'
import crypto from 'crypto'

const subscribeSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().optional().default(''),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, name } = subscribeSchema.parse(body)

    // Check if already exists
    const { data: existing } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('email', email)
      .single()

    if (existing) {
      if (existing.status === 'unsubscribed') {
        // Re-activate
        const newToken = crypto.randomBytes(32).toString('hex')
        await supabase
          .from('subscribers')
          .update({
            status: 'active',
            name,
            unsubscribe_token: newToken,
            unsubscribed_at: null,
          })
          .eq('id', existing.id)

        return NextResponse.json({
          success: true,
          message: 'Welcome back! You\'ve been re-subscribed.',
        })
      }

      return NextResponse.json({
        success: false,
        message: 'This email is already subscribed.',
        status: 400,
      })
    }

    // Insert new subscriber
    const unsubToken = crypto.randomBytes(32).toString('hex')
    const { error } = await supabase.from('subscribers').insert({
      email,
      name,
      status: 'active',
      source: 'signup',
      unsubscribe_token: unsubToken,
    })

    if (error) {
      return NextResponse.json(
        { success: false, message: 'Failed to subscribe' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Welcome to The Dispatch! Check your inbox for the next newsletter.',
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: 'Invalid input', errors: err.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
