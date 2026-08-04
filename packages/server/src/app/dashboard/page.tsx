'use client';

import { ApiOutlined, BranchesOutlined, MessageOutlined } from '@ant-design/icons';
import { Card, Col, Row, Statistic, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { channelApi, routeApi, threadApi } from '@/lib/api-client';

const { Title, Text } = Typography;

export default function DashboardOverview() {
  const [channelCount, setChannelCount] = useState<number | null>(null);
  const [routeCount, setRouteCount] = useState<number | null>(null);
  const [threadCount, setThreadCount] = useState<number | null>(null);

  useEffect(() => {
    channelApi.list().then((c) => setChannelCount(c.length)).catch(() => setChannelCount(0));
    routeApi.list().then((r) => setRouteCount(r.length)).catch(() => setRouteCount(0));
    threadApi
      .list({ limit: 1000 })
      .then((t) => setThreadCount(t.length))
      .catch(() => setThreadCount(0));
  }, []);

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        Overview
      </Title>
      <Text type="secondary">OpenThreads management dashboard</Text>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Channels"
              value={channelCount ?? '—'}
              loading={channelCount === null}
              prefix={<ApiOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Routes"
              value={routeCount ?? '—'}
              loading={routeCount === null}
              prefix={<BranchesOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Threads"
              value={threadCount ?? '—'}
              loading={threadCount === null}
              prefix={<MessageOutlined />}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
