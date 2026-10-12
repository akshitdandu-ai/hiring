'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function HomePage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      })

      const data = await res.json()

      if (res.ok) {
        setSuccess(true)
        setMessage(data.message)
        setEmail('')
        setName('')
      } else {
        setMessage(data.message || 'Subscription failed')
      }
    } catch (err) {
      setMessage('Error subscribing')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dispatch-50 via-white to-dispatch-100">
      <div className="max-w-4xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-dispatch-900 mb-4">The Dispatch</h1>
          <p className="text-xl text-slate-600">
            Weekly newsletter on the Indian startup ecosystem
          </p>
        </div>

        {/* Signup Form */}
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto mb-16">
          <h2 className="text-2xl font-bold mb-6">Subscribe</h2>
          {!success ? (
            <form onSubmit={handleSubscribe} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-dispatch-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Name (optional)</label>
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-dispatch-500 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-dispatch-600 text-white font-bold py-2 rounded-lg hover:bg-dispatch-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Subscribing...' : 'Subscribe'}
              </button>
            </form>
          ) : (
            <div className="text-center">
              <div className="text-4xl mb-3">✓</div>
              <p className="text-slate-600 font-medium">{message}</p>
            </div>
          )}

          {message && !success && (
            <p className="text-red-600 text-sm mt-4 text-center">{message}</p>
          )}
        </div>

        {/* About */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-16">
          <h2 className="text-2xl font-bold mb-4">What is The Dispatch?</h2>
          <p className="text-slate-600 mb-4">
            A weekly newsletter curated by Shreya for founders, operators, and VCs building India's startup ecosystem.
          </p>
          <p className="text-slate-600">
            We surface counterintuitive stories, under-reported trends, and structural shifts—delivered in plain English with editorial commentary on what matters.
          </p>
        </div>

        {/* Admin Link */}
        <div className="text-center">
          <Link
            href="/admin"
            className="text-dispatch-600 hover:text-dispatch-700 font-medium"
          >
            Admin Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
