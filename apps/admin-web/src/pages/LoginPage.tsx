import { Alert, Button, Card, Form, Input } from 'antd';
import { useState } from 'react';
import { api, ApiError } from '../api.js';
import { saveCredentials } from '../auth.js';
import { currentSurface } from '../surface.js';

export function LoginPage({ onReady }: { onReady: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const surface = currentSurface();

  async function submit(values: { user: string; password: string }) {
    setPending(true);
    setError(null);
    saveCredentials(values.user, values.password);
    try {
      const probe = surface === 'platform' ? '/platform/tenants?limit=1' : '/admin/license';
      await api(probe);
      onReady();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '登录失败';
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title={surface === 'platform' ? 'SaaS 控制台' : '租户运营台'} style={{ maxWidth: 420, margin: '48px auto' }}>
      {error ? <Alert type="error" message={error} style={{ marginBottom: 16 }} /> : null}
      <Form layout="vertical" onFinish={submit}>
        <Form.Item name="user" label="账号" rules={[{ required: true, message: '请填写账号' }]}>
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" label="口令" rules={[{ required: true, message: '请填写口令' }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={pending} block>
          登录
        </Button>
      </Form>
    </Card>
  );
}
