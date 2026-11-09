import { describe, it, expect } from '@jest/globals';
import { hashPassword, verifyPassword } from '../src/admin/password-hasher.js';

describe('password-hasher', () => {
  it('hashes and verifies', async () => {
    const encoded = await hashPassword('correct-horse-battery');
    expect(encoded.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', encoded)).toBe(true);
    expect(await verifyPassword('wrong', encoded)).toBe(false);
  });
});
