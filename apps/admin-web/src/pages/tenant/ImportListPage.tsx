import { Alert, Button, Space, Table, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api.js';

interface Job {
  id: string;
  name: string;
  status: string;
  sourceFilename?: string;
}

export function ImportListPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const body = await api<{ items: Job[] }>('/admin/import-jobs');
      setJobs(body.items ?? []);
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

  async function upload(file: File) {
    const form = new FormData();
    form.set('file', file);
    await api('/admin/import-jobs', { method: 'POST', body: form });
    await load();
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      <Upload beforeUpload={(file) => { void upload(file); return false; }} showUploadList={false}>
        <Button>上传导入文件</Button>
      </Upload>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={jobs}
        locale={{ emptyText: '没有导入任务' }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '状态', dataIndex: 'status' },
          {
            title: '操作',
            render: (_v, row: Job) => <Link to={`/import/${row.id}`}>审核</Link>,
          },
        ]}
      />
    </Space>
  );
}
