import { Alert, Button, Descriptions, Space } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface LicenseView {
  valid?: boolean;
  reason?: string;
  mock?: boolean;
  fingerprint?: string;
  daysLeft?: number;
  maxChats?: number;
  currentUsage?: { messagesReceived?: number; assetsSent?: number };
}

export function LicensePage() {
  const [data, setData] = useState<LicenseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const body = await api<LicenseView>('/admin/license');
    setData(body);
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : '加载失败'));
  }, []);

  async function reload() {
    setError(null);
    try {
      await api('/admin/license/reload', { method: 'POST' });
      setNotice('授权已重新加载');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重载失败');
    }
  }

  return (
    <Space direction="vertical">
      {error ? <Alert type="error" message={error} /> : null}
      {notice ? <Alert type="success" message={notice} /> : null}
      <Descriptions bordered column={1} title="授权状态">
        <Descriptions.Item label="有效">{data?.valid ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="原因">{data?.reason ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="模拟验签">{data?.mock ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="指纹">{data?.fingerprint ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="剩余天数">{data?.daysLeft ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="群上限">{data?.maxChats ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="已收消息">{data?.currentUsage?.messagesReceived ?? 0}</Descriptions.Item>
        <Descriptions.Item label="已发素材">{data?.currentUsage?.assetsSent ?? 0}</Descriptions.Item>
      </Descriptions>
      <Button type="primary" onClick={() => void reload()}>热加载授权</Button>
    </Space>
  );
}
