import { Alert, Button, Form, InputNumber, Space, Table } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface QualityAlert {
  rule: string;
  detail: string;
}

interface Inspection {
  id: string | number;
  sensitiveHits: number;
  refusals: number;
  total: number;
  p95LatencyMs: number;
  alerts: QualityAlert[];
  windowLabel: string;
  createdAt: string;
}

export function QualityPage() {
  const [items, setItems] = useState<Inspection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ items: Inspection[] }>('/admin/archive/quality-inspections?limit=50');
      setItems(res.items ?? []);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onSubmit(values: {
    sensitiveHits: number;
    refusals: number;
    total: number;
    p95LatencyMs: number;
  }) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ inspectionId: string | number; alerts: QualityAlert[] }>(
        '/admin/archive/quality-check',
        { method: 'POST', body: JSON.stringify(values) },
      );
      setMsg(
        `已提交 #${res.inspectionId}` +
          (res.alerts?.length ? `，告警 ${res.alerts.map((a) => a.rule).join(',')}` : '，无告警'),
      );
      await reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <h2>在线质检</h2>
      {error && <Alert type="error" message={error} showIcon />}
      {msg && <Alert type="success" message={msg} showIcon />}
      <Form
        layout="inline"
        onFinish={onSubmit}
        initialValues={{ sensitiveHits: 0, refusals: 0, total: 10, p95LatencyMs: 1000 }}
      >
        <Form.Item name="sensitiveHits" label="敏感命中" rules={[{ required: true }]}>
          <InputNumber min={0} />
        </Form.Item>
        <Form.Item name="refusals" label="拒答" rules={[{ required: true }]}>
          <InputNumber min={0} />
        </Form.Item>
        <Form.Item name="total" label="总量" rules={[{ required: true }]}>
          <InputNumber min={1} />
        </Form.Item>
        <Form.Item name="p95LatencyMs" label="p95ms" rules={[{ required: true }]}>
          <InputNumber min={0} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          提交采样
        </Button>
        <Button onClick={() => void reload()}>刷新</Button>
      </Form>
      <Table
        rowKey={(r) => String(r.id)}
        dataSource={items}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 80 },
          { title: '敏感', dataIndex: 'sensitiveHits', width: 80 },
          { title: '拒答', dataIndex: 'refusals', width: 80 },
          { title: '总量', dataIndex: 'total', width: 80 },
          { title: 'p95', dataIndex: 'p95LatencyMs', width: 100 },
          {
            title: '告警',
            dataIndex: 'alerts',
            render: (alerts: QualityAlert[]) =>
              alerts?.length ? alerts.map((a) => `${a.rule}(${a.detail})`).join('; ') : '—',
          },
          { title: '时间', dataIndex: 'createdAt' },
        ]}
        pagination={false}
      />
    </Space>
  );
}
