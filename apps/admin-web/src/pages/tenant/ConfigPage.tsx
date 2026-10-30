import { Alert, Button, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface Row {
  key: string;
  present: boolean;
  masked?: string;
}

export function ConfigPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ config: Record<string, { present: boolean; masked?: string }> }>('/admin/config-check')
      .then((body) => {
        setRows(Object.entries(body.config ?? {}).map(([key, value]) => ({ key, ...value })));
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : '加载失败'));
  }, []);

  async function reload(path: string, ok: string) {
    setError(null);
    try {
      await api(path, { method: 'POST' });
      setNotice(ok);
    } catch (err) {
      setNotice(null);
      setError(err instanceof ApiError ? err.message : '重载失败');
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      {notice ? <Alert type="success" message={notice} /> : null}
      <Space>
        <Button onClick={() => void reload('/admin/keywords/reload', '关键词已重载')}>重载关键词</Button>
        <Button onClick={() => void reload('/admin/config/reload', '配置已重载')}>重载配置</Button>
      </Space>
      <Table
        rowKey="key"
        dataSource={rows}
        locale={{ emptyText: '没有配置项' }}
        columns={[
          { title: '配置', dataIndex: 'key' },
          { title: '已设置', dataIndex: 'present', render: (v: boolean) => (v ? '是' : '否') },
          { title: '掩码', dataIndex: 'masked', render: (v?: string) => v ?? '—' },
        ]}
      />
    </Space>
  );
}
