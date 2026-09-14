import { StrictMode, Suspense, lazy, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './fonts.css'
import './styles.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Renderer root was not found')
}

const apiUrl = import.meta.env.VITE_LEDGE_API_URL

// The cloud provider tree is only mounted when a `VITE_LEDGE_API_URL`
// is configured at build time. We split the implementation into its own
// chunk (loaded by Vite's dynamic import) so the main renderer bundle
// stays free of the cloud-sync runtime for the common, local-only
// configuration. Users who opt into cloud sync pay the chunk-load cost
// exactly once, on the first cold start, and nothing on subsequent
// launches because the chunk is cached in the renderer's module map.
const CloudApp = lazy(async (): Promise<{ default: () => ReactElement }> => {
  const [{ SyncProvider }, { TeamsProvider }, { TeamShelfSyncProvider }] = await Promise.all([
    import('./providers/SyncProvider'),
    import('./providers/TeamsProvider'),
    import('./providers/TeamShelfSyncProvider'),
  ])
  if (!apiUrl) {
    // Belt-and-braces: apiUrl is gated at the call site, but the
    // dynamic import path is still reachable if Vite ever inlines
    // the env var differently. Render the local App so we never
    // crash if the URL is missing at runtime.
    return { default: () => <App /> }
  }
  const CloudAppImpl = () => (
    <ErrorBoundary>
      <SyncProvider>
        <TeamsProvider>
          <TeamShelfSyncProvider>
            <App />
          </TeamShelfSyncProvider>
        </TeamsProvider>
      </SyncProvider>
    </ErrorBoundary>
  )
  return { default: CloudAppImpl }
})

const app = apiUrl ? (
  <Suspense fallback={<App />}>
    <CloudApp />
  </Suspense>
) : (
  <App />
)

createRoot(container).render(
  <StrictMode>
    {app}
  </StrictMode>
)
