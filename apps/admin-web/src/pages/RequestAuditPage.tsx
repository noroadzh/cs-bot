import { Alert, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { currentSurface } from '../surface.js';

interface AuditRow {
  id: number;
  username: string;
  roleCode: string;
  method: string;
  path: string;
  status: number;
  costMs: number;
  clientIp: string;
  createdAt: string;
}

export function RequestAuditPage() {
  const surface = currentSurface();
  const path = surface === 'platform' ? '/platform/audit-logs' : '/admin/audit-logs';
  const [items, setItems] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<{ rows: AuditRow[] }>(path)
      .then((body) => {
        setItems(body.rows ?? []);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [path]);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          { title: '时间', dataIndex: 'createdAt' },
          { title: '用户', dataIndex: 'username' },
          { title: '角色', dataIndex: 'roleCode' },
          { title: '方法', dataIndex: 'method' },
          { title: '路径', dataIndex: 'path' },
          { title: '状态', dataIndex: 'status' },
          { title: '耗时ms', dataIndex: 'costMs' },
          { title: 'IP', dataIndex: 'clientIp' },
        ]}
      />
    </Space>
  );
}
