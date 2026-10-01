import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Top-level guard: never a white screen — render the failure on black. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('Uncaught UI error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{ backgroundColor: '#000000', color: '#e7e9ea', minHeight: '100vh' }}
          className="flex flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <p className="text-[31px] font-extrabold">Something went wrong</p>
          <p className="max-w-[480px] text-[15px] text-[#71767b]">
            Twitter hit an unexpected error instead of loading.
          </p>
          <pre className="max-w-[640px] overflow-auto rounded-xl border border-[#2f3336] p-4 text-left text-[13px] text-[#f4212e]">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-[#1d9bf0] px-6 py-2 font-bold text-white transition hover:bg-[#1a8cd8]"
          >
            Reload Twitter
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
