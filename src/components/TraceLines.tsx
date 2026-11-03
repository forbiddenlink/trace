/**
 * TraceLines — the signature interaction of Trace.
 *
 * One app-owned <svg> absolutely positioned over the Studio workspace. For each
 * detection it draws an orthogonal "construction line" (draftsman's elbow) wiring:
 *
 *   the bounding box on the SOURCE thumbnail
 *     → the matching detection ROW in the inspector
 *       → a node dot on the live PREVIEW pane's edge
 *
 * Endpoints are read once per layout change via getBoundingClientRect (relative to
 * the SVG container), recomputed on a ResizeObserver + a mount rAF — never per frame.
 * The draw-in is animated with motion (pathLength 0→1, staggered), honoring
 * prefers-reduced-motion. Hovering/focusing a detection dims the others.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';

/** A resolved set of endpoints for one detection's elbow path, in container coords. */
interface TracePath {
  id: string;
  /** Box center on the source thumbnail. */
  x1: number;
  y1: number;
  /** Detection row center in the inspector. */
  x2: number;
  y2: number;
  /** Node dot on the preview edge. */
  x3: number;
  y3: number;
  guessed: boolean;
}

export interface TraceLinesProps {
  /** Stable detection ids, in render order (used for stagger + hover keying). */
  detectionIds: string[];
  /** Per-id "guessed" flag → dashed/uncertain styling. */
  guessedIds: Set<string>;
  /** The element the SVG overlays (positions are computed relative to its rect). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Per-id bounding-box element on the source thumbnail. */
  boxRefs: React.RefObject<Map<string, HTMLElement | null>>;
  /** Per-id detection-row element in the inspector. */
  rowRefs: React.RefObject<Map<string, HTMLElement | null>>;
  /** The preview pane element (lines terminate at its left edge). */
  previewRef: React.RefObject<HTMLElement | null>;
  /** Currently hovered/focused detection id (null = none). */
  hoveredId: string | null;
  /** Re-measure trigger: bump when the underlying result/layout changes. */
  layoutKey: string | number;
}

/** True when the user asked for reduced motion. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Build the orthogonal elbow path string through the three anchor points.
 * Source → inspector row: horizontal-first elbow at a vertical mid-line.
 * Inspector row → preview node: horizontal-first elbow.
 * Pure right-angle segments read as drafting construction lines.
 *
 * `offset` nudges each line's vertical mid-lines by a few px per index so parallel
 * elbows don't stack onto the same column (which read as noise/clutter at wide
 * widths). The routing stays orthogonal — just fanned slightly apart.
 */
function elbowPath(p: TracePath, offset = 0): string {
  const mid1 = (p.x1 + p.x2) / 2 + offset;
  const mid2 = (p.x2 + p.x3) / 2 - offset;
  return [
    `M ${p.x1} ${p.y1}`,
    `H ${mid1}`,
    `V ${p.y2}`,
    `H ${p.x2}`,
    // second leg: row → preview node
    `M ${p.x2} ${p.y2}`,
    `H ${mid2}`,
    `V ${p.y3}`,
    `H ${p.x3}`,
  ].join(' ');
}

export function TraceLines({
  detectionIds,
  guessedIds,
  containerRef,
  boxRefs,
  rowRefs,
  previewRef,
  hoveredId,
  layoutKey,
}: TraceLinesProps) {
  const [paths, setPaths] = useState<TracePath[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /** Read every endpoint once, relative to the container rect. Never per-frame. */
    const measure = () => {
      const cr = container.getBoundingClientRect();
      if (cr.width === 0 || cr.height === 0) return;
      const preview = previewRef.current?.getBoundingClientRect();
      const next: TracePath[] = [];
      for (const id of detectionIds) {
        const boxEl = boxRefs.current.get(id);
        const rowEl = rowRefs.current.get(id);
        if (!boxEl || !rowEl) continue;
        const b = boxEl.getBoundingClientRect();
        const r = rowEl.getBoundingClientRect();
        // Source box: exit from its right edge, vertical center.
        const x1 = b.right - cr.left;
        const y1 = b.top + b.height / 2 - cr.top;
        // Inspector row: enter at its left edge, vertical center.
        const x2 = r.left - cr.left;
        const y2 = r.top + r.height / 2 - cr.top;
        // Preview node: terminate at the preview pane's left edge, aligned to the row.
        const x3 = preview ? preview.left - cr.left : x2;
        const y3 = preview
          ? Math.min(
              Math.max(y2, preview.top - cr.top + 8),
              preview.bottom - cr.top - 8,
            )
          : y2;
        next.push({ id, x1, y1, x2, y2, x3, y3, guessed: guessedIds.has(id) });
      }
      setSize({ w: cr.width, h: cr.height });
      setPaths(next);
    };

    const schedule = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    if (previewRef.current) ro.observe(previewRef.current);
    for (const id of detectionIds) {
      const el = rowRefs.current.get(id);
      if (el) ro.observe(el);
    }
    window.addEventListener('resize', schedule);
    // Re-measure after layout settles (fonts, Sandpack mount, image decode).
    const t = window.setTimeout(schedule, 350);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.clearTimeout(t);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // boxRefs/rowRefs/previewRef are stable refs; layoutKey forces a re-measure.
  }, [detectionIds, guessedIds, containerRef, boxRefs, rowRefs, previewRef, layoutKey]);

  if (paths.length === 0 || size.w === 0) return null;
  const reduced = prefersReducedMotion();

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="trace-lines"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      fill="none"
      aria-hidden="true"
    >
      <title>Trace construction lines</title>
      {paths.map((p, i) => {
        const isHovered = hoveredId === p.id;
        // Lines read as precise, not noisy: faint by default, full opacity only on
        // the hovered/focused line. With nothing hovered everything stays subdued so
        // overlapping elbows don't pile into clutter at wide widths.
        const baseOpacity = hoveredId === null ? 0.32 : isHovered ? 1 : 0.1;
        // Fan parallel elbows apart by index so their vertical mid-lines don't stack.
        const center = (paths.length - 1) / 2;
        const offset = (i - center) * 7;
        const d = elbowPath(p, offset);
        return (
          <g key={p.id} style={{ transition: 'opacity 0.2s ease' }} opacity={baseOpacity}>
            <motion.path
              d={d}
              stroke="#0A6B8C"
              strokeWidth={isHovered ? 1.4 : 0.85}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={p.guessed ? '3 3' : undefined}
              initial={reduced ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.6, ease: 'easeInOut', delay: i * 0.1 }
              }
            />
            {/* Travelling dash pulse — only on the hovered line, so it locates without
                adding ambient motion noise across every line at once. */}
            {!reduced && isHovered && (
              <motion.path
                d={d}
                stroke="#0A6B8C"
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeDasharray="2 64"
                initial={{ strokeDashoffset: 0, opacity: 0 }}
                animate={{ strokeDashoffset: -132, opacity: 0.7 }}
                transition={{
                  strokeDashoffset: {
                    duration: 2.4,
                    ease: 'linear',
                    repeat: Infinity,
                  },
                  opacity: { duration: 0.3 },
                }}
              />
            )}
            {/* Node dots: source exit, inspector entry, preview terminal. */}
            <circle cx={p.x1} cy={p.y1} r={isHovered ? 2.5 : 2} fill="#0A6B8C" />
            <circle cx={p.x2} cy={p.y2} r={2} fill="#163A5F" />
            <circle
              cx={p.x3}
              cy={p.y3}
              r={3}
              fill="#EAF3F9"
              stroke="#0A6B8C"
              strokeWidth={1.4}
            />
          </g>
        );
      })}
    </svg>
  );
}
