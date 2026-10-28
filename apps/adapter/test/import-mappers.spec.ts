import { describe, it, expect } from '@jest/globals';
import { aggregateStatus } from '../src/import/import-mappers.js';

describe('aggregateStatus', () => {
  it('modified items count as importable', () => {
    expect(
      aggregateStatus({ pending: 0, approved: 0, modified: 2, rejected: 1, 'needs-fix': 0 }),
    ).toBe('partial');
  });

  it('all modified yields approved', () => {
    expect(
      aggregateStatus({ pending: 0, approved: 0, modified: 2, rejected: 0, 'needs-fix': 0 }),
    ).toBe('approved');
  });
});
