import { describe, it, expect } from '@jest/globals';
import { shouldPauseImport } from '../src/import/import-memory.js';

const MB = 1024 * 1024;

describe('shouldPauseImport', () => {
  it('pauses when incremental working set exceeds 200MB', () => {
    expect(shouldPauseImport(500 * MB, 280 * MB, 1024)).toBe(true);
    expect(shouldPauseImport(450 * MB, 280 * MB, 1024)).toBe(false);
  });

  it('pauses when RSS exceeds 80% of the configured limit', () => {
    expect(shouldPauseImport(420 * MB, 400 * MB, 512)).toBe(true);
    expect(shouldPauseImport(400 * MB, 390 * MB, 512)).toBe(false);
  });
});
