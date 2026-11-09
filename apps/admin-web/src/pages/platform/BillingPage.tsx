import { Alert, Button, Card, Form, Input, InputNumber, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  createBillingOrder,
  getBillingOrder,
  mockPayOrder,
  SelfServeError,
  type SelfServeOrder,
} from '../../selfServeApi.js';

export function BillingPage() {
  const location = useLocation();
  const initialTenant = (location.state as { tenantId?: string } | null)?.tenantId ?? '';
  const [tenantId, setTenantId] = useState(initialTenant);
  const [order, setOrder] = useState<SelfServeOrder>();
  const [errCode, setErrCode] = useState<string>();
  const [polling, setPolling] = useState(false);
  const [days, setDays] = useState(30);
  const [amountCents, setAmountCents] = useState(9900);

  useEffect(() => {
    if (!order || order.status === 'paid' || !polling) return;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await getBillingOrder(order.id);
        setOrder(fresh);
        if (fresh.status === 'paid') setPolling(false);
      } catch {
        /* ignore transient poll errors */
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [order, polling]);

  return (
    <Card style={{ maxWidth: 640 }}>
      {errCode ? (
        <Alert type="error" message={`操作失败 (${errCode})`} style={{ marginBottom: 16 }} />
      ) : null}
      <Form layout="vertical">
        <Form.Item label="租户 ID" htmlFor="billing-tenant-id">
          <Input
            id="billing-tenant-id"
            aria-label="租户 ID"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
        </Form.Item>
        <Form.Item label="续费天数">
          <InputNumber min={1} value={days} onChange={(v) => setDays(Number(v ?? 30))} />
        </Form.Item>
        <Form.Item label="金额（分）">
          <InputNumber min={1} value={amountCents} onChange={(v) => setAmountCents(Number(v ?? 9900))} />
        </Form.Item>
        <Space>
          <Button
            type="primary"
            onClick={async () => {
              setErrCode(undefined);
              try {
                const created = await createBillingOrder({
                  tenantId,
                  days,
                  amountCents,
                });
                setOrder(created);
                setPolling(created.channel !== 'mock' || created.status !== 'paid');
              } catch (e) {
                setErrCode(e instanceof SelfServeError ? e.errCode : 'UNKNOWN');
              }
            }}
          >
            创建订单
          </Button>
          {order?.channel === 'mock' && order.status === 'created' ? (
            <Button
              onClick={async () => {
                setErrCode(undefined);
                try {
                  const paid = await mockPayOrder(order.id);
                  setOrder(paid);
                  setPolling(false);
                } catch (e) {
                  setErrCode(e instanceof SelfServeError ? e.errCode : 'UNKNOWN');
                }
              }}
            >
              模拟支付
            </Button>
          ) : null}
        </Space>
      </Form>
      {order ? (
        <Alert
          style={{ marginTop: 16 }}
          type={order.status === 'paid' ? 'success' : 'info'}
          message={`订单 ${order.id} · ${order.channel} · ${order.status}`}
          description={
            order.prepay ? (
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(order.prepay.payload, null, 2)}</pre>
            ) : (
              'mock 通道可点击「模拟支付」；真实通道请完成支付后自动轮询状态。'
            )
          }
        />
      ) : null}
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
        <Link to="/register">注册新租户</Link>
      </Typography.Paragraph>
    </Card>
  );
}
