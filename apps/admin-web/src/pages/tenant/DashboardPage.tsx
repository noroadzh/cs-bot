import { Alert, Card, Col, Row, Statistic, Table } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface Overview {
  messages: number;
  hits: number;
  refusals: number;
  hitRate: number;
  refusalRate: number;
  topMiss: Array<{ question: string; score: number; chatId: string; status: number }>;
}

export function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>('/admin/stats/overview?period=daily')
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : '加载失败'));
  }, []);

  return (
    <div>
      {error ? <Alert type="error" message={error} /> : null}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="消息量" value={data?.messages ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="命中" value={data?.hits ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="命中率" value={((data?.hitRate ?? 0) * 100).toFixed(1)} suffix="%" /></Card></Col>
        <Col span={6}><Card><Statistic title="拒答率" value={((data?.refusalRate ?? 0) * 100).toFixed(1)} suffix="%" /></Card></Col>
      </Row>
      <Table
        rowKey={(r) => `${r.chatId}-${r.question}`}
        dataSource={data?.topMiss ?? []}
        columns={[
          { title: '未命中 TOP', dataIndex: 'question' },
          { title: '群', dataIndex: 'chatId' },
          { title: '分', dataIndex: 'score' },
          { title: '状态', dataIndex: 'status' },
        ]}
        pagination={false}
      />
    </div>
  );
}
