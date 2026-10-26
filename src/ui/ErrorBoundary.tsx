import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="mx-auto my-8 max-w-xl rounded-xl border border-red-300 bg-red-50 p-6 text-red-950">
          <p className="text-lg font-bold">Something went wrong on this screen</p>
          <p className="mt-1 text-sm">Your data is safe: nothing was sent anywhere. Reload the page and try again. If it keeps happening, try a smaller file or send the booking in the chat instead.</p>
          <button type="button" className="mt-3 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
