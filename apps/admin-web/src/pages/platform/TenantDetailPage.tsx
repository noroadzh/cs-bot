import { Alert, Button, Descriptions, Form, Input, Modal, Space } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, requireReason } from '../../api.js';

interface Detail {
  tenant: { id: string; name: string; status: string; plan?: string; contact?: string | null; host?: string | null };
  quota: { maxChats?: number; maxApiCalls?: number; maxStorageMb?: number } | null;
  usageToday: { chatCount?: number; apiCallCount?: number };
}

const ACTIONS = [
  ['provision', '开通'],
  ['suspend', '暂停'],
  ['resume', '恢复'],
  ['restart', '重启'],
] as const;

export function TenantDetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [token, setToken] = useState('');

  async function load() {
    setDetail(await api<Detail>(`/platform/tenants/${id}`));
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : '加载失败'));
  }, [id]);

  async function post(path: string, extra: Record<string, unknown> = {}) {
    setError(null);
    try {
      const body = { ...extra, reason: requireReason(reason) };
      const result = await api<Record<string, unknown>>(path, { method: 'POST', body: JSON.stringify(body) });
      if (typeof result?.confirmToken === 'string') setToken(result.confirmToken);
      setNotice('已提交');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败');
    }
  }

  function confirmPost(title: string, path: string, extra: Record<string, unknown> = {}) {
    Modal.confirm({ title, onOk: () => post(path, extra) });
  }

  const tenant = detail?.tenant;

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      {notice ? <Alert type="success" message={notice} /> : null}
      {token ? <Alert type="warning" message={`一次性注销令牌：${token}`} /> : null}
      <Descriptions bordered column={1} title={tenant?.name ?? '租户'}>
        <Descriptions.Item label="状态">{tenant?.status ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="档位">{tenant?.plan ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="联系人">{tenant?.contact ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="主机">{tenant?.host ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="今日消息">{detail?.usageToday?.apiCallCount ?? 0}</Descriptions.Item>
        <Descriptions.Item label="群上限">{detail?.quota?.maxChats ?? '—'}</Descriptions.Item>
      </Descriptions>
      <Input aria-label="原因" placeholder="原因" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Space wrap>
        {ACTIONS.map(([action, label]) => (
          <Button key={action} onClick={() => void post(`/platform/tenants/${id}/${action}`)}>{label}</Button>
        ))}
        <Button danger onClick={() => confirmPost('终止租户', `/platform/tenants/${id}/terminate`)}>终止</Button>
        <Button onClick={() => confirmPost('导出并签发注销令牌', `/platform/tenants/${id}/export`)}>导出</Button>
        <Button onClick={() => void post(`/platform/tenants/${id}/credentials/handoff`)}>密钥交接</Button>
      </Space>
      <Form
        layout="inline"
        onFinish={(values: { days?: string }) => void post(`/platform/tenants/${id}/renew`, { days: Number(values.days) })}
      >
        <Form.Item name="days" rules={[{ required: true, message: '请填写天数' }]}>
          <Input aria-label="续期天数" placeholder="续期天数" />
        </Form.Item>
        <Button htmlType="submit">续期</Button>
      </Form>
      <Form
        layout="inline"
        onFinish={(values: { maxChats?: string }) => {
          try {
            const body = JSON.stringify({ maxChats: Number(values.maxChats), reason: requireReason(reason) });
            void api(`/platform/tenants/${id}/quota`, { method: 'PATCH', body })
              .then(() => setNotice('配额已更新'))
              .catch((err: unknown) => setError(err instanceof ApiError ? err.message : '配额失败'));
          } catch (err) {
            setError(err instanceof ApiError ? err.message : '配额失败');
          }
        }}
      >
        <Form.Item name="maxChats">
          <Input aria-label="群上限" placeholder="群上限" />
        </Form.Item>
        <Button htmlType="submit">更新配额</Button>
      </Form>
      <DestroyForm tenantId={id} reason={reason} onDone={() => void load().then(() => setNotice('注销已提交'))} />
      <SecretsForm tenantId={id} reason={reason} onError={setError} onOk={() => setNotice('密钥已写入')} />
      <ShellForm onDone={(ms) => void post(`/platform/tenants/${id}/shell-access`, { durationMs: ms })} />
    </Space>
  );
}

function DestroyForm({ tenantId, reason, onDone }: { tenantId: string; reason: string; onDone: () => void }) {
  return (
    <Form
      layout="inline"
      onFinish={(values: { a: string; b: string; confirmToken: string }) => {
        Modal.confirm({
          title: '注销租户',
          content: '需要两名不同审批人和导出时签发的一次性令牌。',
          onOk: async () => {
            await api(`/platform/tenants/${tenantId}/destroy`, {
              method: 'POST',
              body: JSON.stringify({
                reason: requireReason(reason),
                approvals: [values.a, values.b],
                confirmToken: values.confirmToken,
              }),
            });
            onDone();
          },
        });
      }}
    >
      <Form.Item name="a" rules={[{ required: true }]}><Input aria-label="审批人一" placeholder="审批人一" /></Form.Item>
      <Form.Item name="b" rules={[{ required: true }]}><Input aria-label="审批人二" placeholder="审批人二" /></Form.Item>
      <Form.Item name="confirmToken" rules={[{ required: true }]}><Input aria-label="注销令牌" placeholder="confirmToken" /></Form.Item>
      <Button danger htmlType="submit">注销</Button>
    </Form>
  );
}

function SecretsForm({
  tenantId,
  reason,
  onError,
  onOk,
}: {
  tenantId: string;
  reason: string;
  onError: (message: string) => void;
  onOk: () => void;
}) {
  return (
    <Form
      layout="inline"
      onFinish={(values: { WECHAT_AGENT_SECRET?: string }) => {
        Modal.confirm({
          title: '写入密钥',
          onOk: async () => {
            try {
              await api(`/platform/tenants/${tenantId}/secrets`, {
                method: 'PUT',
                body: JSON.stringify({ ...values, reason: requireReason(reason) }),
              });
              onOk();
            } catch (err) {
              onError(err instanceof ApiError ? err.message : '写入失败');
            }
          },
        });
      }}
    >
      <Form.Item name="WECHAT_AGENT_SECRET">
        <Input.Password aria-label="企微 Secret" placeholder="企微 Secret" />
      </Form.Item>
      <Button htmlType="submit">写入密钥</Button>
    </Form>
  );
}

function ShellForm({ onDone }: { onDone: (ms: number) => void }) {
  return (
    <Form layout="inline" onFinish={(values: { durationMs: string }) => onDone(Number(values.durationMs))}>
      <Form.Item name="durationMs" rules={[{ required: true, message: '请填写时长' }]}>
        <Input aria-label="跳板时长" placeholder="跳板审计时长（毫秒）" />
      </Form.Item>
      <Button htmlType="submit">记录跳板审计</Button>
    </Form>
  );
}
