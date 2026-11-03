import { Alert, Button, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface MissItem {
  id?: number;
  question: string;
  chatId: string;
  score: number;
  mediaType: string;
  status: number | string;
  createdAt: string;
  userId: string;
}

export function MissPage() {
  const [items, setItems] = useState<MissItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const body = await api<{ total: number; items: MissItem[] }>('/admin/miss-records');
      setItems(body.items ?? []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function download() {
    const blob = await api<Blob>('/admin/miss-records?format=xlsx');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'miss-records.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function setStatus(id: number | undefined, status: 1 | 2) {
    if (id == null) return;
    await api(`/admin/miss/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await reload();
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      <Button onClick={() => void download()}>导出 xlsx</Button>
      <Table
        rowKey={(row) => `${row.id ?? ''}-${row.createdAt}-${row.chatId}-${row.question}`}
        loading={loading}
        dataSource={items}
        locale={{ emptyText: '没有未命中记录' }}
        columns={[
          { title: '问题', dataIndex: 'question' },
          { title: '群', dataIndex: 'chatId' },
          { title: '分数', dataIndex: 'score' },
          { title: '类型', dataIndex: 'mediaType' },
          { title: '状态', dataIndex: 'status' },
          { title: '时间', dataIndex: 'createdAt' },
          { title: '用户', dataIndex: 'userId' },
          {
            title: '操作',
            render: (_: unknown, row: MissItem) => (
              <Space>
                <Button size="small" onClick={() => void setStatus(row.id, 1)}>已补录</Button>
                <Button size="small" onClick={() => void setStatus(row.id, 2)}>忽略</Button>
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
