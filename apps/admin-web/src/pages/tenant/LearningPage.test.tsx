import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { LearningPage } from './LearningPage.js';

describe('learning review page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('shows queue suggestions and audit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/admin/learning/status')) {
          return new Response(JSON.stringify({ autoLearningEnabled: false }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/admin/learning/queue')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  key: '怎么退',
                  questions: ['怎么退款'],
                  suggestedAnswer: '【建议草稿】针对「怎么退款」请补充标准答复后入库。',
                  risk: 'high',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/admin/learning/audit')) {
          return new Response(
            JSON.stringify({
              items: [{ action: 'auto-learn', clusterKey: 'k1', question: 'q', createdAt: '2026-11-03T00:00:00.000Z' }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
    render(<LearningPage />);
    expect(await screen.findByText('怎么退款')).toBeTruthy();
    expect(screen.getByText('auto-learn')).toBeTruthy();
  });
});
