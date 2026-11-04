import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { InstanceFingerprintController } from '../src/internal/instance-fingerprint.controller.js';

jest.mock('../src/license/host-fingerprint.js', () => ({
  getHostFingerprint: jest.fn(),
}));

import { getHostFingerprint } from '../src/license/host-fingerprint.js';

const mockFp = getHostFingerprint as jest.MockedFunction<typeof getHostFingerprint>;

describe('GET /internal/instance/fingerprint', () => {
  beforeEach(() => {
    mockFp.mockReset();
  });

  it('returns fingerprint when native succeeds', () => {
    mockFp.mockReturnValue('a'.repeat(64));
    const ctrl = new InstanceFingerprintController();
    expect(ctrl.fingerprint()).toEqual({ fingerprint: 'a'.repeat(64) });
  });

  it('native unavailable → 503', () => {
    mockFp.mockReturnValue(null);
    const ctrl = new InstanceFingerprintController();
    expect(() => ctrl.fingerprint()).toThrow(HttpException);
    try {
      ctrl.fingerprint();
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(503);
      expect((e as HttpException).getResponse()).toMatchObject({
        errCode: 'INSTANCE_FINGERPRINT_UNAVAILABLE',
      });
    }
  });
});
