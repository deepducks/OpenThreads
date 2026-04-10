'use client';

import { SearchOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { channelApi, threadApi } from '@/lib/api-client';
import type { Channel, Thread } from '@/lib/api-client';

const { Title, Text } = Typography;

export default function ThreadsPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    channelApi.list().then(setChannels).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    threadApi
      .list({ channelId: channelFilter, search: search || undefined, limit: 100 })
      .then(setThreads)
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, [channelFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const columns = [
    {
      title: 'Thread ID',
      dataIndex: 'threadId',
      key: 'threadId',
      render: (id: string) => (
        <Button
          type="link"
          style={{ padding: 0, fontFamily: 'monospace', fontSize: 12 }}
          onClick={() => router.push(`/dashboard/threads/${id}`)}
        >
          {id}
        </Button>
      ),
    },
    {
      title: 'Channel',
      dataIndex: 'channelId',
      key: 'channelId',
      render: (id: string) => <Tag color="blue">{id}</Tag>,
    },
    {
      title: 'Target',
      dataIndex: 'targetId',
      key: 'targetId',
      render: (id: string) => <Text code style={{ fontSize: 12 }}>{id}</Text>,
    },
    {
      title: 'Native Thread',
      dataIndex: 'nativeThreadId',
      key: 'nativeThreadId',
      render: (id: string | null) =>
        id ? (
          <Text code style={{ fontSize: 12 }}>
            {id}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            virtual
          </Text>
        ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d: string | Date) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(d).toLocaleString()}
        </Text>
      ),
      sorter: (a: Thread, b: Thread) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '',
      key: 'action',
      width: 80,
      render: (_: unknown, record: Thread) => (
        <Button
          size="small"
          onClick={() => router.push(`/dashboard/threads/${record.threadId}`)}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            Threads
          </Title>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={8}>
            <Select
              allowClear
              placeholder="Filter by channel"
              style={{ width: '100%' }}
              value={channelFilter}
              onChange={setChannelFilter}
              options={channels.map((c) => ({
                value: c.id,
                label: `${c.id} (${c.platform})`,
              }))}
            />
          </Col>
          <Col xs={24} sm={12}>
            <Input
              placeholder="Search by thread ID, target, or channel"
              prefix={<SearchOutlined />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              onClear={() => {
                setSearchInput('');
                setSearch('');
              }}
            />
          </Col>
          <Col xs={24} sm={4}>
            <Space>
              <Button type="primary" onClick={handleSearch}>
                Search
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card>
        <Table
          dataSource={threads}
          columns={columns}
          rowKey="threadId"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (total) => `${total} threads` }}
          locale={{ emptyText: 'No threads found' }}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => router.push(`/dashboard/threads/${record.threadId}`),
          })}
        />
      </Card>
    </>
  );
}
