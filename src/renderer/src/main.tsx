import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { App } from './App'
import { SyncProvider } from './providers/SyncProvider'
import './styles.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Renderer root was not found')
}

const convexUrl = import.meta.env.VITE_CONVEX_URL
const app = convexUrl ? (
  <ConvexProvider client={new ConvexReactClient(convexUrl)}>
    <SyncProvider>
      <App />
    </SyncProvider>
  </ConvexProvider>
) : (
  <App />
)

createRoot(container).render(
  <StrictMode>
    {app}
  </StrictMode>
)
