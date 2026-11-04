import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BillingPage } from './BillingPage.js';

describe('BillingPage mock pay', () => {
  it('simulate-pay polls until paid', async () => {
    let status = 'created';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/self-serve/orders') && init?.method === 'POST' && !url.includes('/pay')) {
        return new Response(
          JSON.stringify({
            id: 'ord-1',
            tenantId: 't1',
            days: 30,
            amountCents: 9900,
            channel: 'mock',
            status: 'created',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/pay') && init?.method === 'POST') {
        status = 'paid';
        return new Response(
          JSON.stringify({
            id: 'ord-1',
            tenantId: 't1',
            days: 30,
            amountCents: 9900,
            channel: 'mock',
            status: 'paid',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/self-serve/orders/ord-1')) {
        return new Response(
          JSON.stringify({
            id: 'ord-1',
            tenantId: 't1',
            days: 30,
            amountCents: 9900,
            channel: 'mock',
            status,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>,
    );
    const tenantInput = document.getElementById('billing-tenant-id') as HTMLInputElement;
    expect(tenantInput).toBeTruthy();
    fireEvent.change(tenantInput, { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: '创建订单' }));
    await screen.findByText(/ord-1/);
    fireEvent.click(screen.getByRole('button', { name: '模拟支付' }));
    await waitFor(() => expect(screen.getByText(/paid/)).toBeTruthy());
  });
});
