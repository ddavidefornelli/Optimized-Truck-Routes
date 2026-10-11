/* @refresh reload */
import { lazy, Suspense } from 'solid-js'
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
import { language } from './lib/i18n'

const Simulation = lazy(() => import('./features/simulation/Simulation'))

const root = document.getElementById('root')

render(() => window.location.pathname.replace(/\/$/, '') === '/cool-simulation'
  ? <Suspense fallback={<p role="status">{language() === 'fi' ? 'Ladataan simulaattoria…' : 'Loading simulator…'}</p>}><Simulation /></Suspense>
  : <App />, root!)
