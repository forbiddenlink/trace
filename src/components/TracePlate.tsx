import { GALLERY_EXAMPLES } from '../data/gallery';
import { buildCodeRows, buildMarks, type PlateMark } from './TracePlate.logic';

/**
 * Signature object: a drafting "before / after" plate built from one of the repo's
 * own cached examples (no network call, no key). Left, a wireframe of the source
 * screenshot drawn from the cached detection boxes. Right, the generated JSX the
 * pipeline produced for it. Thin trace lines tie each labelled detection to the
 * exact line of code that renders it. Geometry is fixed (row height, panel height)
 * so there is no layout shift and the lines need no DOM measurement.
 */
const EXAMPLE_ID = 'login-form';
const DETECTIONS = [0, 4, 7, 8, 9];
const ROW = 20;
const PAD = 14;
const SRC_W = 928;
const SRC_H = 1120;

function Reg({ x, y }: { x: number; y: number }) {
  return (
    <g stroke="var(--accent-blueprint)" strokeWidth="1" fill="none">
      <circle cx={x} cy={y} r="5" />
      <path d={`M${x - 9} ${y}H${x + 9}M${x} ${y - 9}V${y + 9}`} />
    </g>
  );
}

export function TracePlate({ className = '' }: { className?: string }) {
  const example = GALLERY_EXAMPLES.find((e) => e.id === EXAMPLE_ID);
  if (!example) return null;

  const marks = buildMarks(example, DETECTIONS);
  const rows = buildCodeRows(example.result.jsx, marks, 2, 2);
  const H = PAD * 2 + rows.length * ROW;
  const W = Math.round((H * SRC_W) / SRC_H);
  const rowOf = (line: number) => rows.findIndex((r) => r.line === line);
  const rowY = (line: number) => PAD + rowOf(line) * ROW + ROW / 2;
  const sx = (n: number) => (n / 1000) * W;
  const sy = (n: number) => (n / 1000) * H;
  const markByLine = new Map<number, PlateMark>(marks.map((m) => [m.codeLine, m]));
  const anchorY = (m: PlateMark) =>
    m.componentName === 'Card' ? sy(m.box[0]) + 14 : (sy(m.box[0]) + sy(m.box[2])) / 2;
  const markedBoxes = new Set(marks.map((m) => m.box.join()));

  return (
    <figure className={`m-0 ${className}`} data-testid="trace-plate">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <span className="annotate text-ocean">plate 01 · before</span>
        <span className="annotate hidden sm:inline">cached example · no api call</span>
        <span className="annotate hidden text-ocean lg:inline">after · generated component</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_minmax(72px,1fr)_minmax(0,1.5fr)] lg:gap-0">
        {/* BEFORE: wireframe of the source screenshot, from the cached detection boxes. */}
        <div
          className="draft-plate border-hair border-line-strong mx-auto w-full max-w-[371px] lg:mx-0"
          style={{ aspectRatio: `${SRC_W} / ${SRC_H}`, width: `min(100%, ${W}px)` }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-full w-full"
            role="img"
            aria-label={`Wireframe of the ${example.title} screenshot with ${marks.length} labelled detections: ${marks
              .map((m) => `${m.tag} ${m.componentName}`)
              .join(', ')}.`}
          >
            <Reg x={12} y={12} />
            <Reg x={W - 12} y={12} />
            <Reg x={12} y={H - 12} />
            <Reg x={W - 12} y={H - 12} />
            {/* ruler ticks along the top edge */}
            <g stroke="var(--line-strong)" strokeWidth="1">
              {Array.from({ length: 19 }, (_, i) => (
                <path key={i} d={`M${((i + 1) * W) / 20} 0v${i % 5 === 4 ? 8 : 4}`} />
              ))}
            </g>
            {example.result.detections.map((d, i) => {
              if (!d.box) return null;
              const [y0, x0, y1, x1] = d.box;
              const marked = markedBoxes.has(d.box.join());
              if (d.componentName === 'Text') {
                const y = (sy(y0) + sy(y1)) / 2;
                return (
                  <path
                    key={i}
                    d={`M${sx(x0)} ${y}H${sx(x1)}`}
                    stroke="var(--text-muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity="0.55"
                  />
                );
              }
              return (
                <rect
                  key={i}
                  x={sx(x0)}
                  y={sy(y0)}
                  width={sx(x1) - sx(x0)}
                  height={sy(y1) - sy(y0)}
                  rx="2"
                  fill={marked && d.componentName !== 'Card' ? 'rgba(10,107,140,0.12)' : 'none'}
                  stroke={marked ? 'var(--accent-primary)' : 'var(--line-strong)'}
                  strokeWidth={marked ? 1.5 : 1}
                  strokeDasharray={d.componentName === 'Card' ? '0' : marked ? '0' : '3 3'}
                />
              );
            })}
            {marks.map((m) => {
              const y = anchorY(m);
              return (
                <g key={m.tag}>
                  <path
                    className="hidden lg:inline"
                    d={`M${sx(m.box[3])} ${y}H${W}`}
                    stroke="var(--accent-primary)"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  <circle cx={sx(m.box[1])} cy={sy(m.box[0])} r="8" fill="var(--accent-primary)" />
                  <text
                    x={sx(m.box[1])}
                    y={sy(m.box[0]) + 3.5}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="'JetBrains Mono', monospace"
                    fill="#fff"
                  >
                    {m.tag}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* TRACE LINES: wireframe detection -> generated line of code. Desktop only; stacked layouts use the A-E tags. */}
        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          className="plate-lines pointer-events-none hidden w-full lg:block"
          style={{ height: H }}
          aria-hidden="true"
        >
          {marks.map((m) => {
            const yl = anchorY(m);
            const yr = rowY(m.codeLine);
            return (
              <path
                key={m.tag}
                d={`M0 ${yl} C50 ${yl}, 50 ${yr}, 100 ${yr}`}
                fill="none"
                stroke="var(--accent-primary)"
                strokeWidth="1.25"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* AFTER: the generated JSX, only the lines that matter plus elisions. */}
        <span className="annotate text-ocean lg:hidden">after · generated component</span>
        <pre
          tabIndex={0}
          aria-label={`Generated component code for the ${example.title} example`}
          className="m-0 overflow-x-auto font-mono text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-compass"
          style={{ background: 'var(--code-bg)', color: '#D5EAF5', padding: `${PAD}px 0`, lineHeight: `${ROW}px` }}
        >
          <code className="block min-w-max">
            {rows.map((r, i) => {
              const mark = r.line === null ? undefined : markByLine.get(r.line);
              return (
                <span key={i} className="flex" style={{ height: ROW }}>
                  <span
                    className="inline-block w-8 shrink-0 pr-2 text-right tabular-nums"
                    style={{ color: '#8FB0C6' }}
                    aria-hidden="true"
                  >
                    {r.line === null ? '' : r.line + 1}
                  </span>
                  <span className="inline-flex w-6 shrink-0 items-center justify-center" aria-hidden="true">
                    {mark && (
                      <span
                        className="grid h-4 w-4 place-items-center rounded-full text-[10px] font-semibold"
                        style={{ background: '#7FD6F2', color: '#06202E' }}
                      >
                        {mark.tag}
                      </span>
                    )}
                  </span>
                  <span style={r.line === null ? { color: '#8FB0C6' } : mark ? { color: '#fff' } : undefined}>
                    {r.line === null ? '  ...' : r.text}
                  </span>
                  <span className="pr-4" />
                </span>
              );
            })}
          </code>
        </pre>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
        <span>
          {marks.map((m) => `${m.tag} ${m.componentName}`).join(' · ')}
        </span>
        <span>screenshot → detection → component</span>
      </figcaption>
    </figure>
  );
}
