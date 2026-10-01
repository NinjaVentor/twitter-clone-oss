import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/common/ErrorBoundary.tsx'
import { initTheme } from './store/theme.ts'

try {
  initTheme()
} catch (err) {
  console.error('Theme init failed, continuing with defaults.', err)
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML =
    '<p style="color:#e7e9ea;background:#000;min-height:100vh;display:flex;align-items:center;justify-content:center">Twitter failed to start: missing #root element.</p>'
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
