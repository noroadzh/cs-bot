import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerTenant, SelfServeError } from '../../selfServeApi.js';

export function RegisterPage() {
  const navigate = useNavigate();
  const [errCode, setErrCode] = useState<string>();
  const [loading, setLoading] = useState(false);

  return (
    <Card style={{ maxWidth: 520 }}>
      {errCode ? (
        <Alert type="error" message={`注册失败 (${errCode})`} style={{ marginBottom: 16 }} />
      ) : null}
      <Form
        layout="vertical"
        onFinish={async (values) => {
          setLoading(true);
          setErrCode(undefined);
          try {
            const res = await registerTenant({
              name: values.name,
              email: values.email,
              plan: values.plan || 'standard',
            });
            navigate('/billing', { state: { tenantId: res.tenantId } });
          } catch (e) {
            setErrCode(e instanceof SelfServeError ? e.errCode : 'UNKNOWN');
          } finally {
            setLoading(false);
          }
        }}
      >
        <Form.Item label="租户名称" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="联系邮箱" name="email" rules={[{ required: true, type: 'email' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="套餐" name="plan" initialValue="standard">
          <Input />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          注册并前往续费
        </Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
        已有租户？<Link to="/billing">直接续费</Link>
      </Typography.Paragraph>
    </Card>
  );
}
