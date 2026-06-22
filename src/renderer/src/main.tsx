import { StrictMode, Suspense, lazy, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './fonts.css'
import './styles.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Renderer root was not found')
}

const convexUrl = import.meta.env.VITE_CONVEX_URL

// The Convex client + SyncProvider tree is only mounted when a
// `VITE_CONVEX_URL` is configured at build time. We split the
// implementation into its own chunk (loaded by Vite's dynamic
// import) so the main renderer bundle stays free of the Convex
// runtime for the common, local-only configuration. Users who opt
// into cloud sync pay the chunk-load cost exactly once, on the
// first cold start, and nothing on subsequent launches because the
// chunk is cached in the renderer's module map.
const ConvexApp = lazy(async (): Promise<{ default: () => ReactElement }> => {
  const [{ ConvexProvider, ConvexReactClient }, { SyncProvider }] = await Promise.all([
    import('convex/react'),
    import('./providers/SyncProvider'),
  ])
  if (!convexUrl) {
    // Belt-and-braces: convexUrl is gated at the call site, but the
    // dynamic import path is still reachable if Vite ever inlines
    // the env var differently. Render the local App so we never
    // crash if the URL is missing at runtime.
    return { default: () => <App /> }
  }
  const client = new ConvexReactClient(convexUrl)
  const ConvexAppImpl = () => (
    <ConvexProvider client={client}>
      <SyncProvider>
        <App />
      </SyncProvider>
    </ConvexProvider>
  )
  return { default: ConvexAppImpl }
})

const app = convexUrl ? (
  <Suspense fallback={<App />}>
    <ConvexApp />
  </Suspense>
) : (
  <App />
)

createRoot(container).render(
  <StrictMode>
    {app}
  </StrictMode>
)
