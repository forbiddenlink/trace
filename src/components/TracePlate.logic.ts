import type { GalleryExample } from '../data/gallery';

/** One labelled detection on the plate: a box on the screenshot, tied to a line of generated code. */
export interface PlateMark {
  tag: string;
  componentName: string;
  /** [ymin, xmin, ymax, xmax], normalized 0-1000 (same convention as the cached detections). */
  box: [number, number, number, number];
  /** Zero-based line in the example's JSX where this detection is rendered, or -1 when not found. */
  codeLine: number;
}

/**
 * Tie the n-th detection of a component to the n-th `<Name` usage inside the
 * generated `export default` body. Returns -1 when the JSX has no such usage.
 */
export function findUsageLine(jsx: string, componentName: string, nth: number): number {
  const lines = jsx.split('\n');
  const start = Math.max(
    0,
    lines.findIndex((l) => l.startsWith('export default')),
  );
  const openTag = new RegExp(`<${componentName}(\\s|>|/|$)`);
  let seen = 0;
  for (let i = start; i < lines.length; i++) {
    if (openTag.test(lines[i])) {
      if (seen === nth) return i;
      seen++;
    }
  }
  return -1;
}

/** Build marks from detection indices of a cached example. Unlocatable detections are dropped. */
export function buildMarks(example: GalleryExample, detectionIndices: number[]): PlateMark[] {
  const { detections, jsx } = example.result;
  const marks: PlateMark[] = [];
  for (const idx of detectionIndices) {
    const d = detections[idx];
    if (!d?.box || d.box.length !== 4) continue;
    const nth = detections.slice(0, idx).filter((x) => x.componentName === d.componentName).length;
    const codeLine = findUsageLine(jsx, d.componentName, nth);
    if (codeLine < 0) continue;
    marks.push({
      tag: String.fromCharCode(65 + marks.length),
      componentName: d.componentName,
      box: d.box as [number, number, number, number],
      codeLine,
    });
  }
  return marks;
}

export interface CodeRow {
  /** Zero-based JSX line, or null for an elision row. */
  line: number | null;
  text: string;
}

/**
 * Collapse the JSX to the rows worth showing: for each mark, its opening line and
 * up to `context` following lines, plus the lines before the first mark. Gaps
 * become a single elision row so the excerpt stays short but every row is real code.
 */
export function buildCodeRows(jsx: string, marks: PlateMark[], head: number, context: number): CodeRow[] {
  const lines = jsx.split('\n');
  const keep = new Set<number>();
  const firstLine = Math.min(...marks.map((m) => m.codeLine));
  for (let i = Math.max(0, firstLine - head); i <= firstLine; i++) keep.add(i);
  for (const m of marks) {
    for (let i = m.codeLine; i <= m.codeLine + context && i < lines.length; i++) keep.add(i);
  }
  const rows: CodeRow[] = [];
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1 && prev !== -2) rows.push({ line: null, text: '...' });
    rows.push({ line: i, text: lines[i] });
    prev = i;
  }
  return rows;
}
