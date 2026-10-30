import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { authHeader, clearCredentials, encodeBasic, saveCredentials } from './auth.js';

describe('console auth', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores credentials and sends a Basic header', async () => {
    saveCredentials('ops', 'secret');
    expect(authHeader()).toBe(`Basic ${encodeBasic('ops', 'secret')}`);
    const seen: Array<string | null> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('Authorization'));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    await api('/admin/license');
    expect(seen[0]).toBe(authHeader());
    clearCredentials();
    expect(authHeader()).toBeNull();
  });
});
