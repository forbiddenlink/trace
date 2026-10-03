import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
  SandpackCodeEditor,
  UnstyledOpenInCodeSandboxButton,
  useSandpack,
} from '@codesandbox/sandpack-react';
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';
import { cn } from '../lib/utils';
import { imageToBase64 } from '../services/vision';
import { GALLERY_EXAMPLES } from '../data/gallery';
import { TraceLines } from './TraceLines';
import { AmbientTrace } from './AmbientTrace';
import {
  A11Y_ENTRY_SOURCE,
  A11Y_RUNNER_SOURCE,
  computeA11yScore,
  formatA11yViolations,
  parseA11yConsoleLog,
  scoreBand,
  type A11yViolation,
} from '../lib/preview/a11y';
import {
  friendlyError,
  getConfidenceDisplay,
  getGroundingMeta,
  type Grounding,
} from './ScreenshotStudio.logic';

interface Detection {
  label: string;
  componentName: string;
  variant?: string;
  confidence: number;
  /** [ymin, xmin, ymax, xmax] normalized 0-1000 (y first). Absent on older cached results. */
  box?: number[];
  grounding?: Grounding;
}

interface GenResult {
  detections: Detection[];
  jsx: string;
  componentsUsed: string[];
  notes: string;
  repairs?: number;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Progressive-enhancement wrapper: runs a state update inside a View Transition
 * (a smooth cross-fade of the source → output swap) where the browser supports
 * it, and falls back to a plain synchronous update otherwise. Reduced-motion is
 * honored by the UA; the transition is purely cosmetic.
 */
function withViewTransition(update: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => {
      ready?: Promise<unknown>;
      finished?: Promise<unknown>;
      updateCallbackDone?: Promise<unknown>;
    };
  };
  // A hidden tab aborts the transition with InvalidStateError, so skip it.
  if (typeof doc.startViewTransition === 'function' && document.visibilityState === 'visible') {
    const transition = doc.startViewTransition(update);
    // Aborted transitions reject these promises; the cosmetic fade is not worth an unhandled rejection.
    const noop = (): void => {};
    transition?.ready?.catch(noop);
    transition?.finished?.catch(noop);
    transition?.updateCallbackDone?.catch(noop);
  } else {
    update();
  }
}

/** A tiny inline placeholder so the empty state's "try a sample" is self-contained. */
const SAMPLE_DATA_URL =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
      <rect width="640" height="400" fill="#F4F1EA"/>
      <rect x="40" y="40" width="560" height="120" rx="4" fill="#FBFAF5" stroke="#1F2933" stroke-opacity="0.12"/>
      <text x="64" y="84" font-family="sans-serif" font-size="22" fill="#1F2933">Welcome back</text>
      <text x="64" y="116" font-family="sans-serif" font-size="14" fill="#1F2933" opacity="0.7">Sign in to continue</text>
      <rect x="40" y="190" width="560" height="44" rx="3" fill="#fff" stroke="#1F2933" stroke-opacity="0.22"/>
      <text x="56" y="218" font-family="sans-serif" font-size="13" fill="#1F2933" opacity="0.55">Email</text>
      <rect x="40" y="250" width="560" height="44" rx="3" fill="#fff" stroke="#1F2933" stroke-opacity="0.22"/>
      <text x="56" y="278" font-family="sans-serif" font-size="13" fill="#1F2933" opacity="0.55">Password</text>
      <rect x="40" y="320" width="180" height="44" rx="3" fill="#C5482E"/>
      <text x="92" y="348" font-family="sans-serif" font-size="14" fill="#fff">Sign in</text>
      <rect x="236" y="320" width="140" height="44" rx="3" fill="#fff" stroke="#C5482E"/>
      <text x="272" y="348" font-family="sans-serif" font-size="14" fill="#C5482E">Cancel</text>
    </svg>`,
  );

/** Fetch an image URL (e.g. a gallery example PNG) and convert it to a base64 data URL. */
async function fetchImageAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load example image (${res.status})`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Rasterize an SVG data URL to a PNG data URL via an offscreen canvas. The live
 * sample is authored as an SVG (self-contained, no asset to ship), but the
 * generation API only accepts raster types (PNG/JPEG/WebP/GIF) — so "Try a live
 * sample" must hand it a PNG. Returns a `data:image/png` URL the pipeline accepts.
 */
async function svgDataUrlToPng(svgDataUrl: string, width: number, height: number): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not render the sample image.'));
    img.src = svgDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not render the sample image.');
  // Flat parchment ground so any transparent SVG regions become opaque pixels.
  ctx.fillStyle = '#F4F1EA';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

/**
 * Confidence as a fine measured tick-scale (a surveyor's gauge), not a full-width
 * progress bar. 20 hairline ticks; the filled ticks read like a precision dial.
 * The numeric value stays in mono (raw data per the type rules).
 */
export function ConfidenceBar({ value }: { value: number }) {
  const TICKS = 20;
  const { pct, filled } = getConfidenceDisplay(value, TICKS);
  return (
    <div className="flex items-center gap-2.5" aria-label={`Confidence ${pct} percent`}>
      <div className="flex flex-1 items-end gap-px h-3.5" aria-hidden="true">
        {Array.from({ length: TICKS }).map((_, i) => {
          const on = i < filled;
          // Every 5th tick is a taller major gradation.
          const major = i % 5 === 0;
          return (
            <span
              key={i}
              className={cn(
                'flex-1 rounded-[0.5px] transition-colors',
                on ? 'bg-compass' : 'bg-line-soft',
                major ? 'h-full' : 'h-2',
              )}
            />
          );
        })}
      </div>
      <span className="text-[11px] font-mono tabular-nums text-graphite w-9 text-right">{pct}%</span>
    </div>
  );
}

/**
 * Honest mapping band for a detection: grounded / inferred / guessed. A tiny
 * mono chip in the inspector — guessed reads as the loudest (vermilion) so
 * uncertainty is visible, not hidden.
 */
export function GroundingTag({ grounding }: { grounding: Grounding }) {
  const { styles, title } = getGroundingMeta(grounding);
  return (
    <span
      className={cn(
        'flex-shrink-0 rounded-sm border-hair px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
        styles,
      )}
      title={title}
    >
      {grounding}
    </span>
  );
}

/**
 * Invisible child of SandpackProvider that listens for Sandpack compile/runtime errors
 * and surfaces an "Ask Trace to fix it" affordance that triggers a targeted repair.
 */
function SandpackErrorWatcher({
  onFix,
  isFixing,
}: {
  onFix: (errorMessage: string) => void;
  isFixing: boolean;
}) {
  const { listen } = useSandpack();
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = listen((msg) => {
      // Sandpack emits action:'show-error' (compile/transform) and
      // type:'action' with action:'show-error', plus 'console' error events.
      if (msg.type === 'action' && msg.action === 'show-error') {
        const message = [msg.title, msg.message].filter(Boolean).join(': ');
        setRuntimeError(message || 'The generated code threw a runtime error.');
      } else if (msg.type === 'success' || msg.type === 'start') {
        // A successful (re)compile clears the prior error banner.
        setRuntimeError(null);
      }
    });
    return unsubscribe;
  }, [listen]);

  if (!runtimeError) return null;

  return (
    <div
      className="flex flex-col gap-2 border-t-hair border-compass/40 bg-compass/[0.06] px-4 py-3"
      role="alert"
    >
      <span className="annotate text-compass">preview error</span>
      <p className="text-xs font-mono text-graphite line-clamp-3 whitespace-pre-wrap">{runtimeError}</p>
      <button
        type="button"
        disabled={isFixing}
        onClick={() => onFix(runtimeError)}
        className="self-start px-3 py-1.5 rounded bg-compass text-white text-xs font-display font-semibold hover:bg-compass-dark focus:outline-none focus:ring-2 focus:ring-compass/40 disabled:opacity-60"
      >
        {isFixing ? 'Tracing the fix…' : 'Ask Trace to fix it'}
      </button>
    </div>
  );
}

/** Accessibility check state: what the in-iframe axe runner reported (or didn't). */
type A11yState =
  | { phase: 'pending' }
  | { phase: 'unavailable' }
  | { phase: 'ready'; score: number; violations: A11yViolation[] };

/**
 * Accessibility score badge + collapsible violations list + "Fix accessibility" action.
 * Listens for `trace-a11y` postMessages from the Sandpack iframe (keyed to the current
 * jsx so a re-render re-runs the check and the score visibly re-computes).
 */
function A11yScore({
  jsx,
  onFix,
  isFixing,
}: {
  jsx: string;
  onFix: (violations: A11yViolation[]) => void;
  isFixing: boolean;
}) {
  const { listen } = useSandpack();
  const [state, setState] = useState<A11yState>({ phase: 'pending' });
  const [expanded, setExpanded] = useState(false);

  // New jsx → reset and start waiting for a fresh result. Done during render via
  // previous-prop tracking (React's documented pattern) rather than in an effect,
  // so the reset lands before paint without a cascading-render warning.
  const [prevJsx, setPrevJsx] = useState(jsx);
  if (prevJsx !== jsx) {
    setPrevJsx(jsx);
    setState({ phase: 'pending' });
    setExpanded(false);
  }

  useEffect(() => {
    let settled = false;

    // The in-iframe runner reports via console.log; Sandpack relays iframe console
    // to the parent through its client protocol (a raw postMessage from the sandboxed
    // preview iframe does not reach this window).
    const unsubscribe = listen((msg) => {
      if (msg.type !== 'console' || !('log' in msg)) return;
      const logs = (msg as { log?: Array<{ data?: unknown[] }> }).log;
      if (!Array.isArray(logs)) return;
      for (const entry of logs) {
        const parsed = parseA11yConsoleLog(entry?.data);
        if (!parsed) continue;
        settled = true;
        if (parsed.kind === 'result') {
          setState({
            phase: 'ready',
            score: computeA11yScore(parsed.violations),
            violations: parsed.violations,
          });
        } else {
          setState({ phase: 'unavailable' });
        }
      }
    });

    // If nothing arrives, axe failed to load/run — don't hang. The in-iframe runner
    // injects axe from a CDN and polls up to ~10s for it, plus the post-mount delay and
    // a one-shot retry, so give it 15s before declaring the check unavailable. Keyed to
    // `jsx`, so this timer resets on every new generation.
    const timeout = window.setTimeout(() => {
      if (!settled) setState({ phase: 'unavailable' });
    }, 15000);

    return () => {
      unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [listen, jsx]);

  if (state.phase === 'pending') {
    return (
      <div
        className="flex items-center gap-2.5 border-t-hair border-line-default bg-warm-white px-4 py-3 text-small text-muted"
        data-testid="a11y-panel"
      >
        <div className="w-3.5 h-3.5 border-2 border-ocean border-t-transparent rounded-full animate-spin" />
        Running accessibility check
      </div>
    );
  }

  if (state.phase === 'unavailable') {
    return (
      <div
        className="border-t-hair border-line-default bg-warm-white px-4 py-3 text-small text-muted"
        data-testid="a11y-panel"
        role="status"
      >
        Accessibility check unavailable.
      </div>
    );
  }

  const { score, violations } = state;
  const band = scoreBand(score);
  const scoreColor =
    band === 'good' ? 'text-terrain' : band === 'mid' ? 'text-gold' : 'text-compass';
  const ruleColor =
    band === 'good' ? 'bg-terrain' : band === 'mid' ? 'bg-gold' : 'bg-compass';

  return (
    <div className="border-t-hair border-line-default bg-warm-white px-4 py-3" data-testid="a11y-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3.5">
          {/* Measured numeric readout: big graphite figure on a colored gradation rule. */}
          <div
            className="relative flex items-baseline gap-0.5 pl-3"
            aria-label={`Accessibility score ${score} out of 100`}
          >
            <span className={cn('absolute left-0 top-0 bottom-0 w-0.5 rounded-full', ruleColor)} />
            <CountUp
              value={score}
              className={cn('font-display text-2xl font-bold leading-none', scoreColor)}
            />
            <span className="font-mono text-[11px] text-muted">/100</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="annotate">accessibility</span>
            <span
              className="text-[11px] text-muted"
              title="Automated check via axe-core. Catches roughly half of WCAG issues, not a certification."
            >
              axe-core automated check{' '}
              <abbr title="axe-core catches ~57% of WCAG issues automatically. This is a directional signal, not a WCAG certification.">
                ⓘ
              </abbr>
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={violations.length === 0 || isFixing}
          onClick={() => onFix(violations)}
          className="px-3 py-1.5 rounded border-hair border-ocean/50 bg-ocean text-white text-xs font-display font-semibold hover:bg-ocean-dark focus:outline-none focus:ring-2 focus:ring-ocean/40 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isFixing ? 'Fixing…' : 'Fix accessibility'}
        </button>
      </div>

      {violations.length > 0 ? (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted hover:text-ink underline underline-offset-2"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : 'Show'} {violations.length} violation
            {violations.length === 1 ? '' : 's'}
          </button>
          {expanded && (
            <ul className="mt-2 flex flex-col">
              {violations.map((v, i) => (
                <li
                  key={`${v.id}-${i}`}
                  className="border-t-hair border-line-soft py-2.5 first:border-t-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-mono text-ink">{v.id}</span>
                    {v.impact && (
                      <span
                        className={cn(
                          'annotate px-1.5 py-0.5 rounded-sm',
                          v.impact === 'critical' || v.impact === 'serious'
                            ? 'bg-compass/12 text-compass'
                            : 'bg-gold/15 text-gold',
                        )}
                      >
                        {v.impact}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-graphite mt-1">{v.help}</p>
                  <p className="text-[11px] text-muted mt-0.5 font-mono tabular-nums">
                    {v.nodeCount} node{v.nodeCount === 1 ? '' : 's'} affected
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-terrain">No automated accessibility violations found.</p>
      )}
    </div>
  );
}

/** Persisted Sandpack/editor theme choice. */
const THEME_STORAGE_KEY = 'trace-studio-theme';

function useStudioTheme(): [boolean, () => void] {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  });
  // Persist as a post-commit side effect keyed on the committed value. Writing inside
  // the setDark updater is unsafe: StrictMode double-invokes updaters, so a single
  // toggle wrote twice (the second pass reading the already-flipped `prev`) and left
  // localStorage on the wrong value even though the visible state was correct.
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
    } catch {
      // localStorage may be unavailable (private mode); fail silently.
    }
  }, [dark]);
  const toggle = useCallback(() => setDark((prev) => !prev), []);
  return [dark, toggle];
}

/** Copy the generated code to the clipboard with a transient confirmation. */
function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [code]);
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="px-3 py-1.5 rounded border-hair border-line-strong text-ink text-xs font-display font-semibold hover:bg-ink/5 focus:outline-none focus:ring-2 focus:ring-compass/40"
      aria-live="polite"
    >
      {copied ? 'Copied!' : 'Copy code'}
    </button>
  );
}

/**
 * Zero-library count-up numeral. Drives the CSS `@property --n` animation by
 * setting `--n-target`, so the digits tick 0 → value on mount with the reveal
 * curve. Falls back to the static number where `@property` is unsupported (the
 * `<span>` text is the accessible value; the animated glyphs are decorative).
 * Reduced-motion users get the final number immediately (see index.css).
 */
function CountUp({
  value,
  className,
  duration = 900,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  // Remount on value change so the keyframe restarts from 0.
  return (
    <span
      key={value}
      className={cn('count-up tabular-nums', className)}
      style={
        {
          '--n-target': value,
          animationDuration: `${duration}ms`,
        } as React.CSSProperties
      }
      // The visible glyphs are CSS-generated; expose the real value to AT.
      aria-label={String(value)}
      role="img"
    />
  );
}

/**
 * Technical dimension line (├────┤): a horizontal hairline with end ticks and a
 * centered mono label, reading like a schematic measurement. Used to annotate the
 * SOURCE screenshot + PREVIEW frame widths. Decorative — `aria-hidden`.
 */
function DimensionLine({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center select-none', className)} aria-hidden="true">
      <div className="dimension-line w-full">
        <span className="dimension-label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
          {label}
        </span>
      </div>
    </div>
  );
}

/** The four narrated stages of a generation, in order. */
const PLOTTER_STEPS = [
  { key: 'detecting', label: 'DETECTING', until: 0.15 },
  { key: 'grounding', label: 'GROUNDING', until: 0.3 },
  { key: 'drafting', label: 'DRAFTING', until: 0.75 },
  { key: 'a11y', label: 'CHECKING A11Y', until: 1 },
] as const;

/**
 * The "plotter" generation panel shown while a trace is in flight. The backend
 * call is a single async request (not streamed), so the four stages advance on
 * TIMED ESTIMATES — honest about being estimated, never a fake percentage. The
 * ACTIVE step shows a 1px vermilion pen sweeping left → right across a hairline
 * track (a pen plotter laying ink); completed steps show a filled vermilion tick.
 * When the result arrives the parent unmounts this (status flips to 'ready').
 */
function PlotterSequence() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    // Estimated cadence over ~38s: detect ~15%, ground ~30%, draft ~75%, then
    // settle on the a11y stage until the real result snaps us out.
    const EST_TOTAL_MS = 38000;
    const timers = PLOTTER_STEPS.slice(0, -1).map((step, i) =>
      window.setTimeout(() => setActiveIdx(i + 1), step.until * EST_TOTAL_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div
      className="px-5 py-6"
      role="status"
      aria-live="polite"
      aria-label={`Tracing screenshot, step ${activeIdx + 1} of ${PLOTTER_STEPS.length}: ${PLOTTER_STEPS[activeIdx].label}`}
    >
      <div className="flex items-baseline justify-between mb-4">
        <span className="annotate text-ocean">plotter · tracing</span>
        <span className="annotate text-muted normal-case tracking-normal">estimated</span>
      </div>
      <ol className="flex flex-col gap-3.5">
        {PLOTTER_STEPS.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <li key={step.key} className="flex items-center gap-3">
              {/* Status glyph: filled vermilion tick when done, hollow when pending. */}
              <span className="flex-shrink-0 w-3.5 h-3.5 grid place-items-center">
                {done ? (
                  <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 text-compass" aria-hidden="true">
                    <path
                      d="M3 7.5l2.5 2.5L11 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      active ? 'bg-compass' : 'bg-line-default',
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  'annotate w-32 flex-shrink-0',
                  done ? 'text-graphite' : active ? 'text-ink' : 'text-muted/60',
                )}
              >
                {step.label}
              </span>
              {/* Hairline track. The active step animates a vermilion pen across it,
                  trailing ink fill. Done steps show a fully-inked track. */}
              <span className="relative flex-1 h-px bg-line-default overflow-visible">
                {done && <span className="absolute inset-0 bg-compass/40" />}
                {active && (
                  <>
                    <span className="plotter-ink absolute inset-0 bg-compass/30" />
                    <span className="plotter-head absolute -top-1.5 left-0 w-px h-[calc(100%+0.75rem)] bg-compass" />
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Track the cursor across a plate for the `.spotlight` glow: write the pointer's
 * offset into --mx/--my CSS vars the ::before radial-gradient reads. Cheap, no
 * state, no re-render. Attach as onMouseMove to any element carrying `.spotlight`.
 */
function spotlightMove(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

/**
 * CAD-style crosshair + live coordinate readout for the drafting frames. `pos` is
 * the cursor offset (display px) within the relative parent; null hides it. The
 * host frame sets `cursor: none` while hovering so this hairline reticle stands in
 * for the pointer, reinforcing the "drafting instrument" read. Decorative +
 * non-interactive (pointer-events-none) so it never blocks drawing or dragging.
 */
function DraftingCrosshair({
  pos,
  label,
}: {
  pos: { x: number; y: number } | null;
  label?: string;
}) {
  if (!pos) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      aria-hidden="true"
    >
      <span className="absolute inset-y-0 w-px bg-compass/60" style={{ left: pos.x }} />
      <span className="absolute inset-x-0 h-px bg-compass/60" style={{ top: pos.y }} />
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-compass"
        style={{ left: pos.x, top: pos.y }}
      />
      <span
        className="absolute translate-x-2 translate-y-2 whitespace-nowrap bg-compass px-1 py-0.5 font-mono text-[9px] leading-none tabular-nums text-white"
        style={{ left: pos.x, top: pos.y }}
      >
        {label ?? `${Math.round(pos.x)}, ${Math.round(pos.y)}`}
      </span>
    </div>
  );
}

/**
 * A schematic ruler tick-strip flanking the compare frame (inline SVG). Ticks
 * repeat every 8px with a longer tick every 40px, drawn in graphite so it reads
 * like the edge of a scale rule. Resolution-independent via a userSpaceOnUse
 * pattern; decorative.
 */
function CompareRuler({ orient }: { orient: 'h' | 'v' }) {
  const uid = useId().replace(/[:]/g, '');
  const id = `ruler-${orient}-${uid}`;
  const horizontal = orient === 'h';
  return (
    <svg
      className={cn('block bg-warm-white', horizontal ? 'h-4 w-full' : 'h-full w-4')}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={id}
          width={horizontal ? 40 : 16}
          height={horizontal ? 16 : 40}
          patternUnits="userSpaceOnUse"
        >
          {[0, 8, 16, 24, 32].map((n) =>
            horizontal ? (
              <line
                key={n}
                x1={n + 0.5}
                x2={n + 0.5}
                y1={n === 0 ? 4 : 10}
                y2={16}
                stroke="rgba(31,41,51,0.28)"
                strokeWidth={1}
              />
            ) : (
              <line
                key={n}
                y1={n + 0.5}
                y2={n + 0.5}
                x1={n === 0 ? 4 : 10}
                x2={16}
                stroke="rgba(31,41,51,0.28)"
                strokeWidth={1}
              />
            ),
          )}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * The compare divider handle: a vermilion hairline with a circular grip that
 * carries a soft vermilion glow and springs on hover / drag (motion).
 * Spring + glow are gated behind prefers-reduced-motion.
 */
function CompareHandle() {
  const reduced = useReducedMotion();
  return (
    <div className="relative flex h-full flex-col items-center justify-center" style={{ cursor: 'ew-resize' }}>
      <div className="absolute inset-y-0 w-px bg-compass/70" />
      <motion.div
        className="relative grid h-9 w-9 place-items-center rounded-full border border-compass bg-warm-white"
        style={{ boxShadow: '0 0 0 3px rgba(197,72,46,0.15), 0 2px 6px rgba(31,41,51,0.15)' }}
        whileHover={reduced ? undefined : { scale: 1.14 }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={reduced ? undefined : { type: 'spring', stiffness: 420, damping: 22 }}
      >
        <span className="select-none font-mono text-[11px] leading-none tracking-tighter text-compass">
          ‹›
        </span>
      </motion.div>
    </div>
  );
}

/**
 * Screenshot-vs-render proof. The input screenshot on one side, the live Sandpack
 * preview on the other, behind a draggable divider. The preview is the actual
 * rendered component (not a static snapshot), so the comparison stays live.
 * Flanked by schematic ruler tick-strips; a CAD crosshair + coordinate readout
 * tracks the cursor over the frame.
 */
function CompareView({ imageUrl, preview }: { imageUrl: string; preview: React.ReactNode }) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const onMove = (e: React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="grid grid-cols-[1rem_1fr] grid-rows-[1rem_1fr] bg-warm-white">
      <div className="border-hair border-line-soft bg-warm-white" />
      <CompareRuler orient="h" />
      <CompareRuler orient="v" />
      <div
        ref={frameRef}
        className="relative h-[480px] w-full overflow-hidden"
        style={{ cursor: 'none' }}
        onPointerMove={onMove}
        onPointerLeave={() => setCursor(null)}
      >
        <ReactCompareSlider
          className="h-full w-full bg-warm-white"
          handle={<CompareHandle />}
          itemOne={
            <ReactCompareSliderImage
              src={imageUrl}
              alt="Original screenshot"
              style={{ objectFit: 'contain', background: '#F4F1EA' }}
            />
          }
          itemTwo={<div className="h-full w-full bg-white">{preview}</div>}
        />
        <DraftingCrosshair pos={cursor} />
      </div>
    </div>
  );
}

/**
 * The empty-state hero. Recomposed from "dropzone + 3 bordered cards + 2×2 grid"
 * into an editorial composition: an oversized asymmetric headline, the dropzone
 * as a precision capture plate, an ambient looping demonstration of a real trace,
 * editorial step numerals (01/02/03) over hairlines (not boxes), and the gallery
 * as annotated drafting specimen plates. One clear focal point: the capture plate
 * paired with the live demo. Generous negative space; varied scale + weight.
 */
function EmptyState({
  isDragging,
  error,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onChooseFile,
  onTrySample,
  onFile,
  onLoadExample,
}: {
  isDragging: boolean;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onChooseFile: () => void;
  onTrySample: () => void;
  onFile: (file: File) => void;
  onLoadExample: (example: (typeof GALLERY_EXAMPLES)[number]) => void;
}) {
  return (
    <div className="pb-10">
      {/* ── HERO ─────────────────────────────────────────────────────────
          Asymmetric two-column: editorial headline + capture instrument on the
          left, the live ambient trace demonstration on the right. */}
      <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14 pt-2 md:pt-8">
        {/* Left: the pitch + the capture plate. */}
        <div className="flex flex-col">
          <span className="annotate text-ocean">studio · screenshot to component</span>
          {/* Oversized display headline with real typographic hierarchy: the verb
              "Trace" carries the most weight; the object reads lighter + larger. */}
          <h1 className="mt-4 font-display text-ink leading-[0.98] tracking-[-0.03em]">
            <span className="block text-[clamp(2.6rem,6vw,4.25rem)] font-bold">Trace</span>
            <span className="block text-[clamp(2.6rem,6vw,4.25rem)] font-light text-graphite">
              any screenshot
            </span>
            <span className="block text-[clamp(2.6rem,6vw,4.25rem)] font-bold">
              into <span className="text-compass">live React.</span>
            </span>
          </h1>
          <p className="mt-6 max-w-md text-body text-graphite leading-relaxed">
            Drop a UI screenshot. Trace detects each element, maps it to your
            design-system catalog, and renders a real, editable component you can
            ship.
          </p>

          {/* The capture plate: a precision instrument, the visual star of the
              left column. Reticle corners + a measurement annotation. */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onMouseMove={spotlightMove}
            className={cn(
              'spotlight reticle pad-margin draft-plate mt-8 border-hair px-7 py-9 transition-colors',
              isDragging ? 'border-compass bg-compass/[0.05]' : 'border-line-strong',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="annotate text-ocean">capture plate</span>
              <span className="annotate text-muted normal-case tracking-normal">
                png · paste · drop
              </span>
            </div>
            <p className="mt-4 font-display text-2xl font-semibold text-ink leading-tight">
              {isDragging ? 'Release to trace it' : 'Drop a screenshot here'}
            </p>
            <p className="mt-1.5 text-small text-muted">
              Paste from your clipboard with Cmd or Ctrl plus V, or pick a file.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onChooseFile}
                className="px-5 py-2.5 rounded bg-compass text-white text-sm font-display font-semibold hover:bg-compass-dark focus:outline-none focus:ring-2 focus:ring-compass/40"
              >
                Choose file
              </button>
              <button
                type="button"
                onClick={onTrySample}
                className="px-5 py-2.5 rounded border-hair border-line-strong text-ink text-sm font-display font-semibold hover:bg-ink/5 focus:outline-none focus:ring-2 focus:ring-compass/40"
              >
                Try a live sample
              </button>
            </div>
            {/* Instant path: cached results, no key and no wait. Surfaced here in the
                first viewport so the fastest way to see Trace is one click away (the
                full specimen gallery still lives further down). */}
            {GALLERY_EXAMPLES.length > 0 && (
              <div className="mt-5">
                <span className="annotate text-muted normal-case tracking-normal">
                  or load an instant result, no wait:
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GALLERY_EXAMPLES.slice(0, 4).map((ex) => (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => onLoadExample(ex)}
                      className="rounded-full border-hair border-line-default px-3 py-1.5 text-xs font-display text-ink transition-colors hover:border-compass hover:text-compass focus:outline-none focus:ring-2 focus:ring-compass/40"
                    >
                      {ex.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Measurement annotation: reads like a schematic dimension on the plate. */}
            <DimensionLine label="capture · ≤ 4 MB · PNG / JPG" className="mt-7" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
              }}
            />
            {error && (
              <p className="mt-4 text-sm text-compass" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Right (lg) / below the plate (md): the ambient demonstration — show,
            don't tell. A faint sample is scanned by a reticle, trace-lines draw to
            detection labels, then loops. The demo is the identity-defining element,
            so it stays visible at tablet (stacked below the plate) rather than being
            hidden — which previously left a barren void to the right at ~768px. */}
        <div className="relative block">
          <span className="annotate text-ocean">live · what trace does</span>
          <div className="reticle draft-plate mt-3 border-hair border-line-default p-4">
            <AmbientTrace className="mx-auto aspect-[4/3] w-full max-w-md lg:max-w-none" />
          </div>
          <p className="mt-3 text-right text-[11px] text-muted font-mono">
            screenshot → detection → component
          </p>
        </div>
      </div>

      {/* ── HOW IT READS — editorial numerals over hairlines, not boxes ─────── */}
      <div className="mt-16 md:mt-24 border-t-hair border-line-strong pt-8">
        <span className="annotate text-ocean">the method</span>
        <div className="mt-5 grid gap-px sm:grid-cols-3 sm:divide-x sm:divide-line-soft">
          {[
            ['01', 'Capture', 'Trace any interface screenshot. Paste, drop, or upload.'],
            ['02', 'Detect', 'Each element is mapped to a catalog component, with a confidence reading and an honest grounding tag.'],
            ['03', 'Render', 'A real, editable React component renders live in a sandbox, scored for accessibility.'],
          ].map(([n, title, desc], i) => (
            <div key={n} className={cn('flex flex-col', i > 0 && 'sm:pl-6', 'pt-6 sm:pt-0')}>
              {/* Oversized outline index numeral — the editorial anchor. */}
              <span
                className="font-display text-[3.25rem] leading-none font-bold text-transparent"
                style={{ WebkitTextStroke: '1px rgba(197,72,46,0.55)' }}
                aria-hidden="true"
              >
                {n}
              </span>
              <p className="mt-3 font-display text-lg font-semibold text-ink">{title}</p>
              <p className="mt-1.5 max-w-xs text-small text-graphite leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── GALLERY — drafting specimen plates, annotated + asymmetric ──────── */}
      {GALLERY_EXAMPLES.length > 0 && (
        <div className="mt-16 md:mt-24 border-t-hair border-line-strong pt-8">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <span className="annotate text-ocean">specimen gallery</span>
              <p className="mt-1.5 font-display text-h2 text-ink">Traced, ready to inspect</p>
            </div>
            <span className="hidden sm:inline text-[11px] text-muted font-mono">
              pre-traced · no upload or key
            </span>
          </div>
          {/* Asymmetric composition: one large featured plate, then a row of the
              remaining specimens — a composed specimen sheet, not a uniform 2×2 grid. */}
          {(() => {
            const [featured, ...rest] = GALLERY_EXAMPLES;
            const plate = (
              example: (typeof GALLERY_EXAMPLES)[number],
              i: number,
              opts: { featured?: boolean },
            ) => (
              <button
                type="button"
                onClick={() => onLoadExample(example)}
                onMouseMove={spotlightMove}
                className="spotlight group reticle flex h-full w-full flex-col gap-2.5 border-hair border-line-default bg-warm-white p-3 text-left transition-colors hover:border-compass focus:outline-none focus:ring-2 focus:ring-compass/40"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] tabular-nums text-compass">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="annotate text-muted normal-case tracking-normal">
                    {opts.featured ? 'featured specimen' : 'specimen'}
                  </span>
                </div>
                <img
                  src={example.thumbnail}
                  alt={`${example.title} example`}
                  loading="lazy"
                  className={cn(
                    // object-contain (not cover) so a portrait specimen is never cropped
                    // mid-glyph at the frame's bottom edge (e.g. the Pricing card's "$29"
                    // was clipped to "$2"). The whole specimen reads, letterboxed on the
                    // warm-white plate ground.
                    'w-full border-hair border-line-soft bg-white object-contain object-top transition-transform group-hover:scale-[1.01]',
                    opts.featured ? 'h-52 md:h-64' : 'h-36',
                  )}
                />
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-sm font-display font-semibold text-ink group-hover:text-compass">
                    {example.title}
                  </span>
                  <span className="font-mono text-[10px] text-muted opacity-0 transition-opacity group-hover:opacity-100">
                    open →
                  </span>
                </div>
              </button>
            );
            return (
              <div className="mt-6 flex flex-col gap-4">
                {featured && (
                  <div className="md:max-w-[60%]">{plate(featured, 0, { featured: true })}</div>
                )}
                {rest.length > 0 && (
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {rest.map((example, idx) => (
                      <li key={example.id}>{plate(example, idx + 1, {})}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/**
 * True at xl+ (>=1280px), where the workspace is a three-column
 * source | preview | inspector layout. The trace lines wire those three columns
 * together and only make geometric sense side-by-side; below xl the layout stacks
 * and the lines would cut across content, so we don't draw them there. Seeded from
 * the current match so the effect never setStates synchronously.
 */
function useThreeColumnLayout(): boolean {
  const query = '(min-width: 1280px)';
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return wide;
}

export function ScreenshotStudio() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const isThreeColumn = useThreeColumnLayout();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GenResult | null>(null);
  const [code, setCode] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  // Feature 1 — refine-with-a-prompt: the current instruction text and how many
  // sequential refines have been applied to this result (drift guard).
  const [refineInstruction, setRefineInstruction] = useState('');
  const [refineCount, setRefineCount] = useState(0);
  const refineInputRef = useRef<HTMLTextAreaElement>(null);
  // Feature 3 — draw-to-instruct: whether the annotate canvas is active over the
  // source frame, and a ref to the source <img> so we can size/composite it.
  const [annotating, setAnnotating] = useState(false);
  const sourceImgRef = useRef<HTMLImageElement>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hasStrokes, setHasStrokes] = useState(false);
  // CAD crosshair readout over the annotation canvas: cursor offset (display px)
  // plus a natural-resolution coordinate label. Null when the pointer is off it.
  const [annotCursor, setAnnotCursor] = useState<{ x: number; y: number; label: string } | null>(
    null,
  );
  const [rightView, setRightView] = useState<'preview' | 'code' | 'compare'>('preview');
  const [dark, toggleDark] = useStudioTheme();
  const [hoveredDetectionId, setHoveredDetectionId] = useState<string | null>(null);
  // Natural pixel dimensions of the loaded source image, for the schematic
  // dimension-line annotation under the SOURCE frame.
  const [sourceDims, setSourceDims] = useState<{ w: number; h: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Trace-line plumbing: the workspace is the SVG coord space; box/row refs are the
  // line endpoints; previewRef is where lines terminate.
  const workspaceRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const boxRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const rowRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  const generate = useCallback(
    async (
      dataUrl: string,
      repair?: {
        previousJsx: string;
        errorMessage: string;
        repairReason?: 'compile' | 'a11y' | 'refine';
      },
      // A fresh generation can opt into non-destructive failure handling: the prior
      // result/image stay on screen through loading + on error (matching the repair
      // path), and the destructive swap to the new image only commits on success.
      // Used by re-trace-with-notes so a transient failure never wipes the rendered
      // component AND the user's drawn annotations.
      options?: { nonDestructive?: boolean; onSuccess?: () => void },
    ) => {
      // A repair runs on top of an existing result: keep the prior result/code on
      // screen (non-destructive) so a transient failure never wipes the user's work.
      const isRepair = Boolean(repair);
      const nonDestructive = isRepair || Boolean(options?.nonDestructive);
      setStatus('loading');
      setError(null);
      if (!nonDestructive) {
        setResult(null);
        setImageUrl(dataUrl);
        // A fresh generation resets the refine chain + its drift counter.
        setRefineCount(0);
      }
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl: dataUrl, ...repair }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: '' }));
          // Never surface raw backend strings; map to friendly copy by status.
          throw new Error(friendlyError(res.status, typeof body?.error === 'string' ? body.error : ''));
        }
        const data: GenResult = await res.json();
        // Cross-fade the loading plotter → result frames where supported.
        withViewTransition(() => {
          // A non-destructive FRESH generation (re-trace) defers the destructive
          // resets to here so they only land once the new result is in hand.
          if (!isRepair && nonDestructive) {
            setImageUrl(dataUrl);
            setRefineCount(0);
          }
          setResult(data);
          setCode(data.jsx);
          setStatus('ready');
        });
        options?.onSuccess?.();
      } catch (err) {
        // Friendly copy only. If a result already exists, keep it visible and show a
        // dismissible banner instead of dumping the user back to the empty dropzone.
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Something went wrong while tracing this screenshot. Please try again.';
        setError(message);
        setStatus('error');
      }
    },
    [],
  );

  /**
   * Load a pre-baked gallery example straight into the result view — no upload,
   * no network, no API key. The cached result was produced once by the real
   * pipeline at author time (see scripts/build-gallery.mjs).
   */
  const loadExample = useCallback((example: (typeof GALLERY_EXAMPLES)[number]) => {
    setError(null);
    // Show the thumbnail immediately for a snappy load.
    setImageUrl(example.thumbnail);
    setResult({
      detections: example.result.detections,
      jsx: example.result.jsx,
      componentsUsed: example.result.componentsUsed,
      notes: example.result.notes,
      repairs: example.result.repairs,
    });
    setCode(example.result.jsx);
    setRightView('preview');
    setStatus('ready');
    setRefineCount(0);
    setRefineInstruction('');
    // Convert the example PNG to a base64 data URL so "Fix accessibility" and runtime
    // auto-fix can POST it to /api/generate (which rejects non-`data:` URLs). The cached
    // result is still shown instantly above; this just upgrades imageUrl in the background.
    void fetchImageAsDataUrl(example.thumbnail)
      .then((dataUrl) => setImageUrl(dataUrl))
      .catch(() => {
        // Leave the thumbnail path in place; repair will surface a friendly error if used.
      });
  }, []);

  /** Runtime repair: re-POST the current image + broken jsx + the Sandpack error. */
  const handleAutoFix = useCallback(
    async (errorMessage: string) => {
      if (!imageUrl || !code) return;
      setIsFixing(true);
      try {
        await generate(imageUrl, { previousJsx: code, errorMessage });
      } finally {
        setIsFixing(false);
      }
    },
    [imageUrl, code, generate],
  );

  /** Accessibility repair: re-ask the model to fix the reported a11y violations. */
  const handleFixA11y = useCallback(
    async (violations: A11yViolation[]) => {
      if (!imageUrl || !code || violations.length === 0) return;
      setIsFixing(true);
      try {
        await generate(imageUrl, {
          previousJsx: code,
          errorMessage: formatA11yViolations(violations),
          repairReason: 'a11y',
        });
      } finally {
        setIsFixing(false);
      }
    },
    [imageUrl, code, generate],
  );

  /**
   * Feature 1 — refine with a prompt: re-prompt the model to APPLY a user change
   * request to the current component (repairReason 'refine'). Non-destructive: the
   * prior result stays on screen on error (shared `generate` repair path). Bumps the
   * drift counter so the UI can nudge "start fresh" after a long edit chain.
   */
  const handleRefine = useCallback(
    async (rawInstruction: string) => {
      const instruction = rawInstruction.trim();
      if (!imageUrl || !code || !instruction) return;
      setIsFixing(true);
      try {
        await generate(imageUrl, {
          previousJsx: code,
          errorMessage: instruction,
          repairReason: 'refine',
        });
        setRefineCount((n) => n + 1);
        setRefineInstruction('');
      } finally {
        setIsFixing(false);
      }
    },
    [imageUrl, code, generate],
  );

  /**
   * Feature 2 — confidence-graded refine target: pre-fill the refine input with a
   * change request aimed at a single low-confidence detection, then focus it so the
   * user confirms/edits before submitting (fuses detection + uncertainty + refine).
   */
  const requestRefineForDetection = useCallback((d: Detection) => {
    setRefineInstruction(
      `Improve the ${d.label}. It was a low-confidence ${d.grounding ?? 'guess'}.`,
    );
    // Focus on the next frame so the textarea is mounted/visible first.
    requestAnimationFrame(() => {
      const el = refineInputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, []);

  /**
   * Feature 3 — draw-to-instruct: free-draw in vermilion on a transparent canvas
   * sized to the displayed source image. Pointer events cover mouse + touch + pen.
   * Strokes are kept purely on the canvas; they are only baked into pixels when the
   * user re-traces (composited over the original image).
   */
  const setupCanvas = useCallback(() => {
    const canvas = annotationCanvasRef.current;
    const img = sourceImgRef.current;
    if (!canvas || !img) return;
    // Match the canvas backing store to the DISPLAYED image size so a stroke lands
    // where the pointer is. Compositing later rescales to natural resolution.
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#C5482E';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, []);

  // Size the canvas when annotate turns on (and on resize while active).
  useEffect(() => {
    if (!annotating) return;
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, [annotating, setupCanvas]);

  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pt = pointFromEvent(e);
    if (!pt) return;
    drawing.current = true;
    lastPoint.current = pt;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // Track the crosshair position (display px within the canvas) + a
  // natural-resolution coordinate label for the readout.
  const trackCrosshair = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const nat = sourceImgRef.current;
    const scale = nat?.naturalWidth ? nat.naturalWidth / rect.width : 1;
    setAnnotCursor({ x, y, label: `${Math.round(x * scale)}, ${Math.round(y * scale)}` });
  };

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    trackCrosshair(e);
    if (!drawing.current) return;
    const ctx = annotationCanvasRef.current?.getContext('2d');
    const pt = pointFromEvent(e);
    if (!ctx || !pt || !lastPoint.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPoint.current = pt;
    if (!hasStrokes) setHasStrokes(true);
  };

  const onCanvasPointerUp = () => {
    drawing.current = false;
    lastPoint.current = null;
  };

  const onCanvasPointerLeave = () => {
    onCanvasPointerUp();
    setAnnotCursor(null);
  };

  const clearAnnotations = useCallback(() => {
    const canvas = annotationCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
  }, []);

  /**
   * Composite the original source image + the annotation strokes into one PNG data
   * URL (image first, marks on top), then run a FRESH generation on it. The base
   * prompt instructs the model to treat red/vermilion marks as instructions.
   */
  const handleRetraceWithNotes = useCallback(async () => {
    const img = sourceImgRef.current;
    const strokeCanvas = annotationCanvasRef.current;
    if (!img || !strokeCanvas || !img.naturalWidth) return;
    const out = document.createElement('canvas');
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, out.width, out.height);
    // The stroke canvas is sized to the DISPLAYED image; rescale to natural pixels.
    ctx.drawImage(strokeCanvas, 0, 0, strokeCanvas.width, strokeCanvas.height, 0, 0, out.width, out.height);
    const composited = out.toDataURL('image/png');
    // Non-destructive: keep the prior result + the drawn annotations on screen while
    // tracing and on failure (friendly error banner instead of the empty dropzone).
    // Only on success do we leave annotate mode and clear the strokes.
    await generate(composited, undefined, {
      nonDestructive: true,
      onSuccess: () => {
        setAnnotating(false);
        clearAnnotations();
      },
    });
  }, [generate, clearAnnotations]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Please provide an image file.');
        setStatus('error');
        return;
      }
      const dataUrl = await imageToBase64(file);
      await generate(dataUrl);
    },
    [generate],
  );

  /**
   * "Try a live sample": rasterize the bundled SVG sample to a PNG the API accepts,
   * then run it through the real generation pipeline. Any failure (rasterize error,
   * quota, etc.) routes through the same friendly-error banner as a normal upload —
   * never a silent no-op.
   */
  const handleTrySample = useCallback(async () => {
    try {
      const png = await svgDataUrlToPng(SAMPLE_DATA_URL, 640, 400);
      await generate(png);
    } catch {
      setError('Could not load the live sample. Please try uploading a screenshot instead.');
      setStatus('error');
    }
  }, [generate]);

  // Paste-from-clipboard support.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            void handleFile(file);
            e.preventDefault();
          }
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const reset = () => {
    setStatus('idle');
    setError(null);
    setImageUrl(null);
    setResult(null);
    setCode('');
    setSourceDims(null);
    setRefineInstruction('');
    setRefineCount(0);
    setAnnotating(false);
    setHasStrokes(false);
  };

  // Keep the workspace mounted whenever there is work to preserve: while loading,
  // when ready, or when an error occurred but we still have a generated result on
  // screen. Only an error with NO prior result falls back to the empty dropzone.
  const hasResult = result !== null && code !== '';
  const showWorkspace = status === 'loading' || status === 'ready' || (status === 'error' && hasResult);

  // Stable id per detection (index-keyed: detections never reorder within a result).
  const detectionId = (i: number) => `det-${i}`;
  // Only detections that carry a normalized box can be wired/boxed. Cached gallery
  // results made before the box field exist degrade gracefully (no overlay/lines).
  const boxedDetections = (result?.detections ?? [])
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => Array.isArray(d.box) && d.box.length === 4);
  const tracedIds = boxedDetections.map(({ i }) => detectionId(i));
  const guessedIds = new Set(
    boxedDetections.filter(({ d }) => d.grounding === 'guessed').map(({ i }) => detectionId(i)),
  );
  // Re-measure the trace lines whenever the result identity, view, or theme changes.
  const layoutKey = `${imageUrl ?? ''}:${tracedIds.length}:${rightView}:${dark}:${status}`;

  return (
    <div className="h-full overflow-y-auto bg-parchment">
      <div className="max-w-[88rem] mx-auto px-5 py-6 md:px-8 md:py-8">
        {showWorkspace && (
          <header className="mb-7 flex items-end justify-between gap-4 border-b-hair border-line-strong pb-5">
            <div className="max-w-2xl">
              <span className="annotate text-ocean">studio</span>
              <h1 className="font-display text-h1 text-ink mt-1.5">Trace a screenshot</h1>
              <p className="text-small text-graphite mt-2 leading-relaxed">
                Paste, drop, or upload a UI screenshot. Trace recreates it as a live, editable React
                component grounded in the design-system catalog.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleDark}
              aria-pressed={dark}
              title="Toggle editor theme"
              className="flex-shrink-0 px-3 py-1.5 rounded border-hair border-line-strong text-ink text-xs font-display font-semibold hover:bg-ink/5 focus:outline-none focus:ring-2 focus:ring-compass/40"
            >
              {dark ? '☀ Light editor' : '☾ Dark editor'}
            </button>
          </header>
        )}

        {!showWorkspace && (
          <EmptyState
            isDragging={isDragging}
            error={status === 'error' ? error : null}
            fileInputRef={fileInputRef}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onChooseFile={() => fileInputRef.current?.click()}
            onTrySample={() => void handleTrySample()}
            onFile={(file) => void handleFile(file)}
            onLoadExample={loadExample}
          />
        )}

        {showWorkspace && status === 'error' && error && (
          <div
            className="mb-5 flex items-start justify-between gap-3 border-hair border-compass/40 border-l-2 border-l-compass bg-compass/[0.05] px-4 py-3"
            role="alert"
          >
            <div>
              <span className="annotate text-compass">trace failed</span>
              <p className="text-sm text-graphite mt-1">{error}</p>
              <p className="text-xs text-muted mt-1">Your generated component is still here. Try again when ready.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStatus('ready');
              }}
              className="flex-shrink-0 text-xs text-muted hover:text-ink underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-compass/40 rounded"
            >
              Dismiss
            </button>
          </div>
        )}

        {showWorkspace && (
          <div
            ref={workspaceRef}
            className="relative grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]"
          >
            {/* Signature interaction: construction lines wiring source box → detection
                row → live preview. Only renders for boxed detections (graceful degrade)
                and only at xl+, where the three columns sit side by side; below that the
                layout stacks and the lines would cut across content. */}
            {result && status === 'ready' && tracedIds.length > 0 && isThreeColumn && (
              <TraceLines
                detectionIds={tracedIds}
                guessedIds={guessedIds}
                containerRef={workspaceRef}
                boxRefs={boxRefs}
                rowRefs={rowRefs}
                previewRef={previewRef}
                hoveredId={hoveredDetectionId}
                layoutKey={layoutKey}
              />
            )}
            {/* ZONE 1 · SOURCE — the input screenshot in a construction-grid frame. */}
            <aside className="flex flex-col" aria-label="Source screenshot">
              <div className="flex items-center justify-between mb-2">
                <span className="annotate text-ocean">source</span>
                <div className="flex items-center gap-3">
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setAnnotating((v) => {
                          if (v) clearAnnotations();
                          return !v;
                        });
                      }}
                      aria-pressed={annotating}
                      // Hidden on small screens — drawing is a fiddly desktop affordance.
                      className={cn(
                        'hidden sm:inline annotate hover:text-ink',
                        annotating ? 'text-compass' : 'text-muted',
                      )}
                    >
                      {annotating ? '✓ annotating' : '✎ annotate'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="annotate text-muted hover:text-ink"
                  >
                    + new
                  </button>
                </div>
              </div>
              <div
                className={cn(
                  'reticle draft-plate border-hair border-line-default p-3',
                  status === 'ready' && 'reticle-lock',
                )}
              >
                {imageUrl ? (
                  <div className="relative bg-white border-hair border-line-soft">
                    <img
                      ref={sourceImgRef}
                      src={imageUrl}
                      alt="Uploaded screenshot"
                      className="w-full object-contain"
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth && img.naturalHeight) {
                          setSourceDims({ w: img.naturalWidth, h: img.naturalHeight });
                        }
                        if (annotating) setupCanvas();
                      }}
                    />
                    {/* Feature 3 — annotation canvas overlay. Sized to the displayed
                        image; vermilion free-draw. Only mounted while annotating. */}
                    {annotating && (
                      <>
                        <canvas
                          ref={annotationCanvasRef}
                          onPointerDown={onCanvasPointerDown}
                          onPointerMove={onCanvasPointerMove}
                          onPointerEnter={trackCrosshair}
                          onPointerUp={onCanvasPointerUp}
                          onPointerLeave={onCanvasPointerLeave}
                          className="absolute inset-0 z-10 h-full w-full touch-none"
                          style={{ touchAction: 'none', cursor: 'none' }}
                        />
                        <DraftingCrosshair pos={annotCursor} label={annotCursor?.label} />
                      </>
                    )}
                    {/* Bounding boxes — positioned in PERCENT so they scale with the image.
                        Gemini boxes are [ymin, xmin, ymax, xmax] normalized 0-1000.
                        Hidden while annotating so they don't fight the draw layer. */}
                    {status === 'ready' && !annotating &&
                      boxedDetections.map(({ d, i }) => {
                        const id = detectionId(i);
                        const [ymin, xmin, ymax, xmax] = d.box as number[];
                        const active = hoveredDetectionId === null || hoveredDetectionId === id;
                        const guessed = d.grounding === 'guessed';
                        return (
                          <div
                            key={id}
                            ref={(el) => {
                              boxRefs.current.set(id, el);
                            }}
                            className={cn(
                              'absolute transition-all duration-200',
                              guessed ? 'border-dashed' : 'border-solid',
                              active
                                ? 'border-compass ring-1 ring-compass/40'
                                : 'border-compass/30',
                            )}
                            data-testid="trace-bounding-box"
                            style={{
                              left: `${xmin / 10}%`,
                              top: `${ymin / 10}%`,
                              width: `${(xmax - xmin) / 10}%`,
                              height: `${(ymax - ymin) / 10}%`,
                              borderWidth: 1,
                              opacity: active ? 1 : 0.45,
                            }}
                          >
                            {/* Index chip at the box top-left. Sits flush INSIDE the
                                box corner (no negative overhang) so on a shrunken
                                small-screen source it never bleeds onto a neighbouring
                                detection row. */}
                            <span
                              className={cn(
                                'absolute top-0 left-0 px-0.5 font-mono text-[8px] leading-[1.3] tabular-nums text-white sm:px-1 sm:text-[9px] sm:leading-[1.4]',
                                guessed ? 'bg-compass/70' : 'bg-compass',
                              )}
                            >
                              {String(i + 1).padStart(2, '0')}
                            </span>
                          </div>
                        );
                      })}
                    {/* Schematic width dimension line: ├──── 640 × 400 px ────┤ */}
                    {sourceDims && (
                      <DimensionLine
                        label={`${sourceDims.w} × ${sourceDims.h} px`}
                        className="mt-2 px-1"
                      />
                    )}
                  </div>
                ) : (
                  <div className="h-32 grid place-items-center text-small text-muted">
                    No source loaded
                  </div>
                )}
              </div>
              {/* Feature 3 — annotate controls: hint + clear + re-trace with notes. */}
              {annotating && (
                <div className="mt-3 flex flex-col gap-2 border-hair border-compass/40 bg-compass/[0.04] px-3 py-2.5">
                  <p className="text-[11px] text-graphite leading-relaxed">
                    Draw notes or arrows. Anything you draw is treated as an instruction,
                    not part of the UI.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isFixing || status === 'loading' || !hasStrokes}
                      onClick={() => void handleRetraceWithNotes()}
                      className="px-3 py-1.5 rounded bg-compass text-white text-xs font-display font-semibold hover:bg-compass-dark focus:outline-none focus:ring-2 focus:ring-compass/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {status === 'loading' ? 'Tracing…' : 'Re-trace with notes'}
                    </button>
                    <button
                      type="button"
                      disabled={!hasStrokes}
                      onClick={clearAnnotations}
                      className="px-3 py-1.5 rounded border-hair border-line-strong text-ink text-xs font-display font-semibold hover:bg-ink/5 focus:outline-none focus:ring-2 focus:ring-compass/40 disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              {status === 'loading' && (
                <div className="mt-3 flex items-center gap-2.5 text-graphite text-small">
                  <div className="w-4 h-4 border-2 border-compass border-t-transparent rounded-full animate-spin" />
                  Detecting components
                </div>
              )}
            </aside>

            {/* ZONE 2 · PREVIEW — the live render, the hero (lg: spans both cols). */}
            <section
              ref={previewRef}
              className="order-first lg:order-none lg:col-span-2 xl:col-span-1 flex flex-col"
            >
              <div className="mb-2 flex items-center gap-3">
                <span className="annotate text-ocean inline-block flex-shrink-0">preview · live render</span>
                {status === 'ready' && code && (
                  <DimensionLine label="viewport · 100%" className="flex-1" />
                )}
              </div>
              <div
                className={cn(
                  'reticle border border-line-strong overflow-hidden min-h-[480px] bg-warm-white shadow-md',
                  status === 'ready' && code && 'reticle-lock',
                )}
                style={{ viewTransitionName: 'trace-preview-frame' }}
              >
              {status === 'loading' && !code && (
                <div className="flex items-center justify-center min-h-[480px]">
                  <div className="w-full max-w-md">
                    <PlotterSequence />
                  </div>
                </div>
              )}
              {code && (
                <SandpackProvider
                  // Remount on every new generation/fix/refine. The in-iframe axe
                  // runner only executes when the entry mounts; a hot-update of
                  // /App.tsx would re-render the preview but never re-run the check,
                  // leaving the score stuck. Keying on the code forces a fresh iframe
                  // so the accessibility score actually re-computes after a fix.
                  key={code}
                  template="react-ts"
                  theme={dark ? 'dark' : 'light'}
                  files={{
                    '/App.tsx': { code },
                    // The a11y runner as a real preview file. Imported from the entry below
                    // (a side-effect import) so it executes inside the rendered iframe.
                    '/a11y.ts': { code: A11Y_RUNNER_SOURCE, hidden: true },
                    // Custom entry: renders App AND imports the runner. Overriding /index.tsx
                    // is what makes the runner execute (Sandpack's react-ts entry is /index.tsx).
                    // Custom entry also injects the Tailwind Play CDN <script> into the
                    // iframe <head> at runtime (see A11Y_ENTRY_SOURCE). The Play CDN is a
                    // <script>, not a stylesheet, so `externalResources` (which injects bare
                    // URLs as <link> tags) left utility classes inert — hence no Tailwind here.
                    '/index.tsx': { code: A11Y_ENTRY_SOURCE, hidden: true },
                  }}
                  customSetup={{ dependencies: { 'lucide-react': 'latest' } }}
                >
                  {/* Toolbar: view toggle + export actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b-hair border-line-default bg-warm-white px-4 py-2">
                    <div
                      className="inline-flex rounded-sm border-hair border-line-default p-0.5"
                      role="group"
                      aria-label="Preview view"
                    >
                      {(['preview', 'code', 'compare'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setRightView(mode)}
                          aria-pressed={rightView === mode}
                          className={cn(
                            'px-3 py-1 rounded-[2px] text-xs font-display font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-compass/40',
                            rightView === mode
                              ? 'bg-compass text-white'
                              : 'text-graphite hover:bg-ink/5',
                          )}
                        >
                          {mode === 'preview' ? 'Preview' : mode === 'code' ? 'Code' : 'Compare'}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <CopyCodeButton code={code} />
                      <UnstyledOpenInCodeSandboxButton className="px-3 py-1.5 rounded border-hair border-line-strong text-ink text-xs font-display font-semibold hover:bg-ink/5 focus:outline-none focus:ring-2 focus:ring-compass/40">
                        Open in CodeSandbox
                      </UnstyledOpenInCodeSandboxButton>
                    </div>
                  </div>

                  {rightView === 'compare' && imageUrl ? (
                    <>
                      <CompareView
                        imageUrl={imageUrl}
                        preview={<SandpackPreview showSandpackErrorOverlay style={{ height: 480 }} />}
                      />
                      <p className="border-t-hair border-line-default bg-warm-white px-4 py-2 text-center text-xs text-muted">
                        Drag the divider. Original screenshot on the left, live render on the right.
                      </p>
                    </>
                  ) : (
                    // Preview and Code are switchable full-width tabs so each gets its
                    // own legible width (the editor was previously crammed beside the
                    // preview in a narrow column, showing ~1 line). Both panes stay
                    // mounted and are toggled via `display` so the running iframe — and
                    // the a11y runner + error watcher it hosts — is never torn down on
                    // a tab switch; only one is visible at a time.
                    <SandpackLayout style={{ flexDirection: 'column' }}>
                      <div
                        style={{ display: rightView === 'preview' ? 'block' : 'none', width: '100%' }}
                      >
                        <SandpackPreview showSandpackErrorOverlay style={{ height: 480 }} />
                      </div>
                      <div
                        style={{ display: rightView === 'code' ? 'block' : 'none', width: '100%' }}
                      >
                        <SandpackCodeEditor showLineNumbers style={{ height: 480 }} />
                      </div>
                    </SandpackLayout>
                  )}
                  <A11yScore jsx={code} onFix={handleFixA11y} isFixing={isFixing} />
                  <SandpackErrorWatcher onFix={handleAutoFix} isFixing={isFixing} />
                </SandpackProvider>
              )}
              </div>
            </section>

            {/* ZONE 3 · INSPECTOR — what the AI sees: detections, catalog, notes. */}
            <aside className="flex flex-col" aria-label="Inspector: what the AI sees">
              <span className="annotate text-ocean mb-2 inline-block">inspector · what the ai sees</span>
              <div className="border-hair border-line-default bg-warm-white">
                {status === 'loading' && !result && (
                  <div className="flex items-center gap-2.5 px-4 py-4 text-graphite text-small">
                    <div className="w-4 h-4 border-2 border-compass border-t-transparent rounded-full animate-spin" />
                    Reading the screenshot
                  </div>
                )}

                {result && (
                  <>
                    {/* Detected-component tally, counting up on reveal. A measured
                        readout: big figure on a vermilion gradation rule. */}
                    <div className="relative flex items-baseline gap-2 px-4 py-3.5 border-b-hair border-line-default">
                      <span className="absolute left-0 top-3.5 bottom-3.5 w-0.5 rounded-full bg-compass" />
                      <CountUp
                        value={result.detections.length}
                        className="font-display text-2xl font-bold leading-none text-ink"
                      />
                      <span className="annotate normal-case tracking-normal text-muted">
                        component{result.detections.length === 1 ? '' : 's'} detected
                      </span>
                    </div>
                    {/* Trust readout: how much of the trace is grounded in the real
                        catalog vs inferred vs guessed. Makes the inspector read like an
                        audit, and is honest about where the model was unsure. */}
                    {(() => {
                      const total = result.detections.length;
                      const grounded = result.detections.filter((d) => d.grounding === 'grounded').length;
                      const inferred = result.detections.filter((d) => d.grounding === 'inferred').length;
                      const guessed = result.detections.filter((d) => d.grounding === 'guessed').length;
                      const pct = total ? Math.round((grounded / total) * 100) : 0;
                      return (
                        <div
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 border-b-hair border-line-default font-mono text-[11px]"
                          aria-label={`Grounding: ${pct} percent grounded, ${inferred} inferred, ${guessed} guessed`}
                        >
                          <span className="uppercase tracking-wide text-muted">grounding</span>
                          <span className="font-semibold text-terrain">{pct}% grounded</span>
                          <span className="text-line-strong" aria-hidden="true">·</span>
                          <span className="text-graphite">
                            {grounded} grounded · {inferred} inferred · {guessed} guessed
                          </span>
                        </div>
                      );
                    })()}
                    <ul className="flex flex-col">
                      {result.detections.map((d, i) => {
                        const id = detectionId(i);
                        const traced = Array.isArray(d.box) && d.box.length === 4;
                        const active = hoveredDetectionId === id;
                        const dimmed = hoveredDetectionId !== null && !active;
                        return (
                          <li
                            key={`${d.label}-${i}`}
                            ref={(el) => {
                              rowRefs.current.set(id, el);
                            }}
                            tabIndex={traced ? 0 : undefined}
                            onMouseEnter={() => traced && setHoveredDetectionId(id)}
                            onMouseLeave={() =>
                              setHoveredDetectionId((cur) => (cur === id ? null : cur))
                            }
                            onFocus={() => traced && setHoveredDetectionId(id)}
                            onBlur={() =>
                              setHoveredDetectionId((cur) => (cur === id ? null : cur))
                            }
                            className={cn(
                              'px-4 py-3 border-t-hair border-line-soft first:border-t-0 transition-colors',
                              traced && 'cursor-pointer focus:outline-none',
                              active && 'bg-compass/[0.06] ring-1 ring-inset ring-compass/40',
                              dimmed && 'opacity-50',
                            )}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-sm text-ink font-medium">
                                {traced && (
                                  <span className="font-mono text-[10px] tabular-nums text-compass">
                                    {String(i + 1).padStart(2, '0')}
                                  </span>
                                )}
                                {d.label}
                              </span>
                              <span className="text-[11px] font-mono text-compass text-right">
                                {d.componentName}
                                {d.variant ? ` · ${d.variant}` : ''}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2.5">
                              <div className="flex-1">
                                <ConfidenceBar value={d.confidence} />
                              </div>
                              {d.grounding && <GroundingTag grounding={d.grounding} />}
                            </div>
                            {/* Feature 2 — confidence-graded refine: low-confidence
                                detections get a one-click fix that pre-fills the refine
                                input. Fuses detection + uncertainty + refine. */}
                            {(d.grounding === 'guessed' || d.grounding === 'inferred') && (
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <span className="annotate normal-case tracking-normal text-muted">
                                  {d.grounding === 'guessed'
                                    ? "Trace wasn't sure"
                                    : 'some uncertainty'}
                                </span>
                                <button
                                  type="button"
                                  disabled={isFixing}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestRefineForDetection(d);
                                  }}
                                  className="font-mono text-[10px] text-compass underline underline-offset-2 hover:text-compass-dark focus:outline-none focus:ring-2 focus:ring-compass/40 rounded disabled:opacity-50"
                                >
                                  refine →
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                      {result.detections.length === 0 && (
                        <li className="px-4 py-3 text-small text-muted">No components detected.</li>
                      )}
                    </ul>

                    {/* Feature 1 — refine with a prompt. Describe a change; Trace
                        re-prompts the model to apply it, non-destructively. */}
                    {status !== 'loading' && (
                      <div className="px-4 py-3.5 border-t-hair border-line-default flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="annotate text-ocean">refine</span>
                          {refineCount > 0 && (
                            <span className="font-mono text-[10px] tabular-nums text-muted">
                              {refineCount} edit{refineCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <textarea
                          ref={refineInputRef}
                          value={refineInstruction}
                          onChange={(e) => setRefineInstruction(e.target.value)}
                          onKeyDown={(e) => {
                            // Cmd/Ctrl+Enter submits; plain Enter keeps a newline.
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                              e.preventDefault();
                              if (!isFixing) void handleRefine(refineInstruction);
                            }
                          }}
                          rows={2}
                          disabled={isFixing}
                          placeholder="Describe a change, e.g. make the primary button green and stack the form on mobile"
                          className="w-full resize-y rounded border-hair border-line-strong bg-warm-white px-2.5 py-2 text-xs text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-compass/40 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          disabled={isFixing || !refineInstruction.trim()}
                          onClick={() => void handleRefine(refineInstruction)}
                          className="self-start px-3 py-1.5 rounded bg-compass text-white text-xs font-display font-semibold hover:bg-compass-dark focus:outline-none focus:ring-2 focus:ring-compass/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isFixing ? 'Refining…' : 'Refine'}
                        </button>
                        {refineCount >= 5 && (
                          <p className="text-[11px] text-graphite leading-relaxed">
                            Edits can drift over a long chain.{' '}
                            <button
                              type="button"
                              onClick={reset}
                              className="text-compass underline underline-offset-2 hover:text-compass-dark"
                            >
                              Start fresh?
                            </button>
                          </p>
                        )}
                      </div>
                    )}

                    {result.componentsUsed.length > 0 && (
                      <div className="px-4 py-3 border-t-hair border-line-default">
                        <p className="annotate mb-2">catalog</p>
                        <div className="flex flex-wrap gap-1.5">
                          {result.componentsUsed.map((c) => (
                            <span
                              key={c}
                              className="px-2 py-0.5 rounded-sm border-hair border-ocean/30 bg-ocean/[0.06] text-ocean text-[11px] font-mono"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {(result.repairs || result.notes) && (
                      <div className="px-4 py-3 border-t-hair border-line-default flex flex-col gap-1.5">
                        {result.repairs ? (
                          <p className="text-[11px] text-muted font-mono tabular-nums">
                            auto-repaired {result.repairs} time{result.repairs === 1 ? '' : 's'} before compiling
                          </p>
                        ) : null}
                        {result.notes && (
                          <p className="text-xs text-graphite leading-relaxed">{result.notes}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
