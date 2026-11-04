import { Alert, Button, Form, Input, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface Cluster {
  key: string;
  questions: string[];
  suggestedAnswer?: string;
  risk: 'low' | 'high';
  status?: string;
}

interface AuditRow {
  id?: number;
  action: string;
  clusterKey?: string;
  question?: string;
  answer?: string;
  risk?: string;
  createdAt?: string;
  at?: string;
}

export function LearningPage() {
  const [auto, setAuto] = useState(false);
  const [queue, setQueue] = useState<Cluster[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [st, q, a] = await Promise.all([
        api<{ autoLearningEnabled: boolean }>('/admin/learning/status'),
        api<{ items: Cluster[] }>('/admin/learning/queue'),
        api<{ items: AuditRow[] }>('/admin/learning/audit?limit=50'),
      ]);
      setAuto(st.autoLearningEnabled);
      setQueue(q.items ?? []);
      setAudit(a.items ?? []);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runCluster() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ clusters: Cluster[]; ingested: number; queued: number }>(
        '/admin/learning/cluster',
        { method: 'POST', body: JSON.stringify({ days: 7 }) },
      );
      setMsg(`聚类完成：入库 ${res.ingested}，排队 ${res.queued}`);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '聚类失败');
    } finally {
      setBusy(false);
    }
  }

  async function approve(row: Cluster, answer: string) {
    setMsg(null);
    try {
      await api('/admin/learning/approve', {
        method: 'POST',
        body: JSON.stringify({ key: row.key, answer }),
      });
      setMsg(`已审核入库：${row.key}`);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '审核失败');
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error ? <Alert type="error" message={error} /> : null}
      {msg ? <Alert type="success" message={msg} /> : null}
      <Space>
        <Tag color={auto ? 'green' : 'default'}>
          自动学习：{auto ? '开' : '关（默认）'}
        </Tag>
        <Button type="primary" loading={busy} onClick={() => void runCluster()}>
          聚类近期未命中
        </Button>
        <Button onClick={() => void reload()}>刷新</Button>
      </Space>

      <Table
        rowKey="key"
        title={() => '审核队列（含建议答案）'}
        dataSource={queue}
        pagination={false}
        columns={[
          { title: '簇', dataIndex: 'key', width: 100 },
          {
            title: '风险',
            dataIndex: 'risk',
            width: 80,
            render: (r: string) => (
              <Tag color={r === 'high' ? 'red' : 'blue'}>{r}</Tag>
            ),
          },
          {
            title: '样例问题',
            dataIndex: 'questions',
            render: (qs: string[]) => qs?.[0] ?? '',
          },
          {
            title: '建议答案',
            dataIndex: 'suggestedAnswer',
            render: (_: string, row: Cluster) => (
              <Form
                layout="inline"
                initialValues={{ answer: row.suggestedAnswer }}
                onFinish={(v) => void approve(row, v.answer)}
              >
                <Form.Item name="answer" rules={[{ required: true }]} style={{ minWidth: 280 }}>
                  <Input.TextArea rows={2} />
                </Form.Item>
                <Button type="primary" htmlType="submit" size="small">
                  审核入库
                </Button>
              </Form>
            ),
          },
        ]}
      />

      <Table
        rowKey={(r) => String(r.id ?? `${r.at}-${r.clusterKey}-${r.action}`)}
        title={() => '学习审计'}
        dataSource={audit}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '动作', dataIndex: 'action', width: 120 },
          { title: '簇', dataIndex: 'clusterKey', width: 100 },
          { title: '问题', dataIndex: 'question' },
          { title: '风险', dataIndex: 'risk', width: 80 },
          {
            title: '时间',
            dataIndex: 'createdAt',
            width: 200,
            render: (v: string, r: AuditRow) => v ?? r.at ?? '',
          },
        ]}
      />
    </Space>
  );
}
