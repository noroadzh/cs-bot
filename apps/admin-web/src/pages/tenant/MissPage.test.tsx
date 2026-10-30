import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { MissPage } from './MissPage.js';

describe('miss list', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('shows miss records from the admin API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      total: 1,
      items: [{
        question: '怎么退款',
        chatId: 'chat-1',
        score: 0.2,
        mediaType: 'text',
        status: 'open',
        createdAt: '2026-10-30T00:00:00.000Z',
        userId: 'u***',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<MissPage />);
    expect(await screen.findByText('怎么退款')).toBeTruthy();
  });
});
