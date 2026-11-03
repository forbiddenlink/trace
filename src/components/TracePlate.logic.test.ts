import { describe, expect, it } from 'vitest';
import { GALLERY_EXAMPLES } from '../data/gallery';
import { buildCodeRows, buildMarks, findUsageLine } from './TracePlate.logic';

const login = GALLERY_EXAMPLES.find((e) => e.id === 'login-form')!;

describe('TracePlate logic', () => {
  it('finds the n-th usage inside the export default body, not the helper definitions', () => {
    const jsx = 'const Card = () => <div/>;\nexport default function App() {\n  return <Card a>\n<Card b/>;\n}';
    expect(findUsageLine(jsx, 'Card', 0)).toBe(2);
    expect(findUsageLine(jsx, 'Card', 1)).toBe(3);
    expect(findUsageLine(jsx, 'Card', 2)).toBe(-1);
  });

  it('ties the cached login-form detections to real code lines', () => {
    const marks = buildMarks(login, [0, 4, 7, 8, 9]);
    expect(marks.map((m) => m.componentName)).toEqual(['Card', 'Input', 'Input', 'Checkbox', 'Button']);
    expect(marks.map((m) => m.tag)).toEqual(['A', 'B', 'C', 'D', 'E']);
    const lines = login.result.jsx.split('\n');
    for (const m of marks) expect(lines[m.codeLine]).toContain(`<${m.componentName}`);
    // The second Input is the password field, the second Button usage is "Sign in".
    expect(lines[marks[2].codeLine + 1]).toContain('password');
    expect(lines[marks[4].codeLine + 1]).toContain('Sign in');
  });

  it('emits strictly ordered rows with elisions between gaps', () => {
    const marks = buildMarks(login, [0, 4, 7, 8, 9]);
    const rows = buildCodeRows(login.result.jsx, marks, 2, 2);
    const nums = rows.filter((r) => r.line !== null).map((r) => r.line as number);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    expect(rows.some((r) => r.line === null)).toBe(true);
    for (const m of marks) expect(nums).toContain(m.codeLine);
  });
});
