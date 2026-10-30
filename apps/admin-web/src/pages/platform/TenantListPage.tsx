import { Alert, Button, Form, Input, Select, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, requireReason } from '../../api.js';

interface Tenant {
  id: string;
  name: string;
  status: string;
  plan?: string;
  contact?: string | null;
}

export function TenantListPage() {
  const [rows, setRows] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const body = await api<{ rows: Tenant[] }>('/platform/tenants');
      setRows(body.rows ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(values: { name: string; contact?: string; plan?: string; reason: string }) {
    setError(null);
    try {
      const reason = requireReason(values.reason);
      await api('/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({ name: values.name, contact: values.contact, plan: values.plan, reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败');
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      <Form layout="inline" onFinish={(values) => void create(values)}>
        <Form.Item name="name" rules={[{ required: true, message: '请填写名称' }]}>
          <Input aria-label="租户名称" placeholder="名称" />
        </Form.Item>
        <Form.Item name="contact">
          <Input aria-label="联系人" placeholder="联系人" />
        </Form.Item>
        <Form.Item name="plan" initialValue="standard">
          <Select
            aria-label="档位"
            style={{ width: 120 }}
            options={[{ value: 'standard', label: 'standard' }, { value: 'enhanced', label: 'enhanced' }]}
          />
        </Form.Item>
        <Form.Item name="reason">
          <Input aria-label="原因" placeholder="原因" />
        </Form.Item>
        <Button type="primary" htmlType="submit">创建</Button>
      </Form>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        locale={{ emptyText: '没有租户' }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '状态', dataIndex: 'status' },
          { title: '档位', dataIndex: 'plan' },
          { title: '操作', render: (_v, row: Tenant) => <Link to={`/tenants/${row.id}`}>详情</Link> },
        ]}
      />
    </Space>
  );
}
