import { Alert, Button, Input, Space, Table } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../../api.js';

interface Item {
  id: string;
  question: string;
  answerRedacted: string;
  reviewStatus: string;
}

interface Unpaired {
  id: string;
  content: string;
  sender_id: string;
}

const STATUSES = ['pending', 'approved', 'modified', 'rejected', 'needs-fix'];

export function ImportDetailPage() {
  const { id = '' } = useParams();
  const [items, setItems] = useState<Item[]>([]);
  const [unpaired, setUnpaired] = useState<Unpaired[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [serviceId, setServiceId] = useState('');

  async function load() {
    const [page, pool] = await Promise.all([
      api<{ items: Item[] }>(`/admin/import-jobs/${id}/items`),
      api<{ rows: Unpaired[] }>(`/admin/import-jobs/${id}/unpaired`),
    ]);
    setItems(page.items ?? []);
    setUnpaired(pool.rows ?? []);
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : '加载失败'));
  }, [id]);

  async function run(path: string, body?: unknown) {
    setError(null);
    try {
      await api(path, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) });
      setNotice('已提交');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败');
    }
  }

  async function review(itemId: string, reviewStatus: string) {
    setError(null);
    try {
      await api(`/admin/import-jobs/${id}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewStatus }),
      });
      setNotice('审核已保存');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '审核失败');
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      {notice ? <Alert type="success" message={notice} /> : null}
      <Space wrap>
        <Button onClick={() => void run(`/admin/import-jobs/${id}/parse`)}>解析</Button>
        <Button onClick={() => void run(`/admin/import-jobs/${id}/approve-all`)}>批量通过</Button>
        <Button onClick={() => void run(`/admin/import-jobs/${id}/confirm`, { decisions: [] })}>确认入库</Button>
        <Button onClick={() => void run(`/admin/import-jobs/${id}/retry`)}>重试失败</Button>
        <Button danger onClick={() => void run(`/admin/import-jobs/${id}/rollback`)}>回滚</Button>
      </Space>
      <Table
        rowKey="id"
        dataSource={items}
        locale={{ emptyText: '没有待审条目' }}
        columns={[
          { title: '问题', dataIndex: 'question' },
          { title: '答案', dataIndex: 'answerRedacted' },
          { title: '状态', dataIndex: 'reviewStatus' },
          {
            title: '审核',
            render: (_v, row: Item) => (
              <select
                aria-label={`审核 ${row.question}`}
                value={row.reviewStatus}
                onChange={(event) => void review(row.id, event.target.value)}
              >
                {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            ),
          },
        ]}
      />
      <Table
        rowKey="id"
        dataSource={unpaired}
        locale={{ emptyText: '没有未配对消息' }}
        columns={[
          { title: '编号', dataIndex: 'id' },
          { title: '发送方', dataIndex: 'sender_id' },
          { title: '内容', dataIndex: 'content' },
        ]}
      />
      <Space>
        <Input aria-label="客户消息" placeholder="客户消息 id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
        <Input aria-label="客服消息" placeholder="客服消息 id" value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
        <Button
          onClick={() => void run(`/admin/import-jobs/${id}/unpaired/pair`, {
            customerMessageId: customerId,
            serviceMessageId: serviceId,
          })}
        >
          补配
        </Button>
      </Space>
    </Space>
  );
}
