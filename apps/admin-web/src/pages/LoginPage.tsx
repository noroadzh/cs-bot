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

  const title = surface === 'platform' ? 'SaaS 控制台' : '租户运营台';

  return (
    <div className="login-screen">
      <div className="login-panel">
        <p className="login-kicker">微信群智能客服</p>
        <h1>{title}</h1>
        <Card>
          {error ? <Alert type="error" message={error} style={{ marginBottom: 16 }} /> : null}
          <Form layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item name="user" label="账号" rules={[{ required: true, message: '请填写账号' }]}>
              <Input autoComplete="username" size="large" />
            </Form.Item>
            <Form.Item name="password" label="口令" rules={[{ required: true, message: '请填写口令' }]}>
              <Input.Password autoComplete="current-password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={pending} block size="large">
              登录
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
