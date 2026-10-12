'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        setAuthenticated(true)
        setPassword('')
      } else {
        setMessage('Incorrect password')
      }
    } catch (err) {
      setMessage('Error logging in')
    } finally {
      setLoading(false)
    }
  }

  const triggerJob = async (job: string) => {
    try {
      const res = await fetch(`/api/admin/trigger/${job}`, {
        method: 'POST',
      })
      const data = await res.json()
      setMessage(data.message || 'Job triggered')
    } catch (err) {
      setMessage('Error triggering job')
    }
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-sm w-full">
          <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-dispatch-600 text-white font-bold py-2 rounded-lg hover:bg-dispatch-700 disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          {message && <p className="text-red-600 mt-4">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Admin Dashboard</h1>

        <div className="space-y-6">
          {/* Manual Triggers */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Manual Triggers</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => triggerJob('ingest')}
                className="bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
              >
                Run Ingest Now
              </button>
              <button
                onClick={() => triggerJob('select')}
                className="bg-green-600 text-white py-2 rounded-lg hover:bg-green-700"
              >
                Run Selection Now
              </button>
              <button
                onClick={() => triggerJob('remind')}
                className="bg-yellow-600 text-white py-2 rounded-lg hover:bg-yellow-700"
              >
                Send Reminder Now
              </button>
              <button
                onClick={() => triggerJob('send')}
                className="bg-red-600 text-white py-2 rounded-lg hover:bg-red-700"
              >
                Send Newsletter
              </button>
            </div>
          </div>

          {message && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg">
              {message}
            </div>
          )}

          {/* Status */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">System Status</h2>
            <p className="text-slate-600">
              Dashboard features (live feed, subscribers management, etc.) coming soon.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <Link href="/" className="text-dispatch-600 hover:text-dispatch-700">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
