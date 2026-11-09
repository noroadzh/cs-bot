import { Alert, Button, Form, Input, Select, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { currentSurface } from '../surface.js';

interface UserRow {
  id: string;
  username: string;
  roleCode: string;
  enabled: boolean;
  createdAt: string;
}

export function UsersPage() {
  const surface = currentSurface();
  const base = surface === 'platform' ? '/platform/users' : '/admin/users';
  const [items, setItems] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const body = await api<{ rows: UserRow[] }>(base);
      setItems(body.rows ?? []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [base]);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error ? <Alert type="error" message={error} /> : null}
      <Form
        layout="inline"
        onFinish={async (values) => {
          await api(base, {
            method: 'POST',
            body: JSON.stringify({
              username: values.username,
              password: values.password,
              roleCode: values.roleCode,
            }),
          });
          await reload();
        }}
      >
        <Form.Item name="username" rules={[{ required: true }]}>
          <Input placeholder="用户名" aria-label="用户名" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, min: 8 }]}>
          <Input.Password placeholder="密码" aria-label="密码" />
        </Form.Item>
        <Form.Item name="roleCode" initialValue="operator">
          <Select
            aria-label="角色"
            style={{ width: 120 }}
            options={[
              { value: 'admin', label: 'admin' },
              { value: 'operator', label: 'operator' },
            ]}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          创建用户
        </Button>
      </Form>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '角色', dataIndex: 'roleCode' },
          { title: '启用', dataIndex: 'enabled', render: (v: boolean) => (v ? '是' : '否') },
          { title: '创建时间', dataIndex: 'createdAt' },
          {
            title: '操作',
            render: (_, row) =>
              row.enabled ? (
                <Button
                  size="small"
                  onClick={async () => {
                    await api(`${base}/${row.id}/disable`, { method: 'POST' });
                    await reload();
                  }}
                >
                  禁用
                </Button>
              ) : null,
          },
        ]}
      />
    </Space>
  );
}
