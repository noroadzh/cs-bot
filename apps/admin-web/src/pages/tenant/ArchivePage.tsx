import { Alert, Button, Space, Table, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface JobRow {
  id: string;
  count: number;
  createdAt: string;
}

interface PullState {
  enabled: boolean;
  cursor: string;
  inFlight: boolean;
  lastPullAt?: string;
  lastError?: string;
}

export function ArchivePage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [state, setState] = useState<PullState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [j, s] = await Promise.all([
        api<{ items: JobRow[] }>('/admin/archive/jobs'),
        api<PullState>('/admin/archive/pull-state'),
      ]);
      setJobs(j.items ?? []);
      setState(s);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function triggerPull() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ errCode?: string; jobId?: string; count?: number }>(
        '/admin/archive/pull',
        { method: 'POST', body: '{}' },
      );
      if (res.errCode) setMsg(`拉取：${res.errCode}`);
      else setMsg(`已入队 job=${res.jobId ?? '-'} count=${res.count ?? 0}`);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '拉取失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <h2>会话存档</h2>
      {error && <Alert type="error" message={error} showIcon />}
      {msg && <Alert type="info" message={msg} showIcon />}
      {state && (
        <Typography.Paragraph>
          拉取：{state.enabled ? '已启用' : '未启用'} · cursor={state.cursor || '—'} · 上次=
          {state.lastPullAt || '—'}
          {state.lastError ? ` · 错误=${state.lastError}` : ''}
        </Typography.Paragraph>
      )}
      <Space>
        <Button type="primary" loading={busy} onClick={() => void triggerPull()}>
          触发拉取
        </Button>
        <Button onClick={() => void reload()}>刷新</Button>
      </Space>
      <Table
        rowKey="id"
        dataSource={jobs}
        columns={[
          { title: 'Job', dataIndex: 'id' },
          { title: '条数', dataIndex: 'count', width: 100 },
          { title: '时间', dataIndex: 'createdAt' },
        ]}
        pagination={false}
      />
    </Space>
  );
}
