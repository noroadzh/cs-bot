import { Alert, Button, Form, Input, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface Collections {
  datasetIds: string[];
  collections: Array<{ datasetId: string; count: number }>;
}

export function KnowledgePage() {
  const [cols, setCols] = useState<Collections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    try {
      setCols(await api<Collections>('/admin/knowledge/collections'));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function ingest(values: { question: string; answer: string; missId?: string }) {
    setMsg(null);
    try {
      await api('/admin/knowledge/ingest', {
        method: 'POST',
        body: JSON.stringify({
          question: values.question,
          answer: values.answer,
          missId: values.missId ? Number(values.missId) : undefined,
        }),
      });
      setMsg('已写入 FastGPT');
      await reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '补录失败');
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      {msg ? <Alert type="success" message={msg} /> : null}
      <Table
        rowKey="datasetId"
        dataSource={cols?.collections ?? []}
        columns={[
          { title: '数据集', dataIndex: 'datasetId' },
          { title: '文档数', dataIndex: 'count' },
        ]}
        pagination={false}
      />
      <Form layout="vertical" onFinish={(v) => void ingest(v)}>
        <Form.Item name="question" label="问题" rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="answer" label="答案" rules={[{ required: true }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="missId" label="关联未命中 ID（可选）">
          <Input />
        </Form.Item>
        <Button type="primary" htmlType="submit">一键补录</Button>
      </Form>
    </Space>
  );
}
