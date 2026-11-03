import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';

// Studio is the whole product: paste a screenshot, get a real React component.
// Lazy-loaded so the Sandpack runtime stays out of the initial bundle.
const ScreenshotStudio = lazy(() => import('./components/ScreenshotStudio').then(m => ({ default: m.ScreenshotStudio })));

function App() {
  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen h-[100dvh] bg-parchment">
        {/* Skip link: first focusable element, jumps past the chrome to the studio. */}
        <a
          href="#studio"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-warm-white focus:px-3 focus:py-1.5 focus:text-small focus:font-display focus:text-ink focus:ring-2 focus:ring-compass/40"
        >
          Skip to studio
        </a>

        {/* Top bar: wordmark, hairline-ruled. */}
        <header className="flex items-center gap-6 px-5 h-14 border-b-hair border-line-strong bg-warm-white flex-shrink-0">
          <TraceWordmark />
          <span className="ml-auto annotate hidden md:inline">screenshot to component</span>
        </header>

        {/* View */}
        <main id="studio" className="flex-1 min-h-0">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full bg-parchment">
              <div className="text-center">
                <div className="w-10 h-10 mx-auto mb-4 border-2 border-compass border-t-transparent rounded-full animate-spin"></div>
                <p className="annotate">loading trace</p>
              </div>
            </div>
          }>
            <ScreenshotStudio />
          </Suspense>
        </main>
      </div>
    </ErrorBoundary>
  );
}

/**
 * Trace wordmark + logomark. The mark is a "trace" glyph: a dot (origin) that
 * draws out into a construction line and lands on a reticle (target) — origin →
 * trace → resolved component. Drawn as inline SVG so it scales crisply.
 */
function TraceWordmark() {
  return (
    <div className="flex items-center gap-2.5 select-none" aria-label="Trace">
      <svg
        width="30"
        height="20"
        viewBox="0 0 30 20"
        fill="none"
        aria-hidden="true"
        className="flex-shrink-0"
      >
        {/* origin dot */}
        <circle cx="3" cy="10" r="2.5" fill="#0A6B8C" />
        {/* trace / construction line */}
        <line x1="6" y1="10" x2="21" y2="10" stroke="#163A5F" strokeWidth="1" strokeDasharray="2 2" />
        {/* reticle target */}
        <circle cx="24" cy="10" r="4.5" stroke="#0C1F30" strokeWidth="1" fill="none" />
        <line x1="24" y1="3.5" x2="24" y2="6.5" stroke="#0C1F30" strokeWidth="1" />
        <line x1="24" y1="13.5" x2="24" y2="16.5" stroke="#0C1F30" strokeWidth="1" />
        <line x1="17.5" y1="10" x2="20" y2="10" stroke="#0C1F30" strokeWidth="1" />
        <line x1="28" y1="10" x2="30" y2="10" stroke="#0C1F30" strokeWidth="1" />
      </svg>
      <span className="font-display text-base font-bold tracking-tight text-ink lowercase">
        trace
      </span>
    </div>
  );
}

export default App;
