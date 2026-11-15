import { describe, expect, it } from 'vitest';
import { SANDPACK_DEPENDENCIES } from './sandpack-dependencies';

describe('SANDPACK_DEPENDENCIES', () => {
  it('pins every dependency to an exact version', () => {
    for (const [name, version] of Object.entries(SANDPACK_DEPENDENCIES)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
