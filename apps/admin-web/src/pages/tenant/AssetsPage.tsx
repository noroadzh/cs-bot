import { Alert, Button, Form, Input, Modal, Space, Table, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.js';

interface Asset {
  id: string;
  name: string;
  type: string;
  url: string | null;
  size: number | null;
}

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const body = await api<{ assets: Asset[] }>('/admin/assets');
      setAssets(body.assets ?? []);
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
    await api('/admin/assets', { method: 'POST', body: form });
    await load();
  }

  async function fromLink(values: { url: string; name: string }) {
    await api('/admin/assets', { method: 'POST', body: JSON.stringify(values) });
    await load();
  }

  function remove(id: string) {
    Modal.confirm({
      title: '删除素材',
      content: '删除后文件会从素材目录清掉。',
      onOk: async () => {
        await api(`/admin/assets/${id}`, { method: 'DELETE' });
        await load();
      },
    });
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error ? <Alert type="error" message={error} /> : null}
      <Upload beforeUpload={(file) => { void upload(file); return false; }} showUploadList={false}>
        <Button>上传文件</Button>
      </Upload>
      <Form layout="inline" onFinish={(values) => void fromLink(values)}>
        <Form.Item name="name" rules={[{ required: true, message: '请填写名称' }]}>
          <Input placeholder="名称" />
        </Form.Item>
        <Form.Item name="url" rules={[{ required: true, message: '请填写链接' }]}>
          <Input placeholder="链接" />
        </Form.Item>
        <Button htmlType="submit">添加链接</Button>
      </Form>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={assets}
        locale={{ emptyText: '没有素材' }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '类型', dataIndex: 'type' },
          { title: '大小', dataIndex: 'size' },
          {
            title: '操作',
            render: (_v, row: Asset) => <Button danger onClick={() => remove(row.id)}>删除</Button>,
          },
        ]}
      />
    </Space>
  );
}
