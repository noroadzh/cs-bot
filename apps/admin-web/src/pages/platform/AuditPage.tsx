import { Alert, Button, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface AuditRow {
  id: string;
  tenantId: string | null;
  action: string;
  actor: string;
  createdAt: string;
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ rows: AuditRow[] }>('/platform/audit-log')
      .then((body) => setRows(body.rows ?? []))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  async function verify() {
    setError(null);
    try {
      const result = await api<{ valid: boolean }>('/platform/audit-log/verify');
      setNotice(result.valid ? '审计链完整' : '审计链不完整');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '校验失败');
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      {notice ? <Alert type={notice.includes('不') ? 'error' : 'success'} message={notice} /> : null}
      <Button onClick={() => void verify()}>校验审计链</Button>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        locale={{ emptyText: '没有审计记录' }}
        columns={[
          { title: '动作', dataIndex: 'action' },
          { title: '操作者', dataIndex: 'actor' },
          { title: '租户', dataIndex: 'tenantId' },
          { title: '时间', dataIndex: 'createdAt' },
        ]}
      />
    </Space>
  );
}
