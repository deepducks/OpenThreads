'use client';

import { ArrowLeftOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import {
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Row,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { threadApi } from '@/lib/api-client';
import type { Thread, Turn } from '@/lib/api-client';

const { Title, Text } = Typography;

function MessageView({ message }: { message: Record<string, unknown> }) {
  const isA2H = 'intent' in message;

  if (isA2H) {
    const intent = message.intent as string;
    const context = message.context as Record<string, unknown> | undefined;
    return (
      <div
        style={{
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 4,
        }}
      >
        <Space>
          <Badge color="gold" />
          <Text strong style={{ fontSize: 12 }}>
            A2H Intent:
          </Text>
          <Tag color="gold">{intent}</Tag>
        </Space>
        {context && (
          <pre
            style={{
              fontSize: 11,
              marginTop: 4,
              marginBottom: 0,
              background: '#fff',
              padding: 6,
              borderRadius: 4,
            }}
          >
            {JSON.stringify(context, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  const text = message.text as string | undefined;
  return (
    <div
      style={{
        background: '#f0f5ff',
        borderRadius: 6,
        padding: '8px 12px',
        marginBottom: 4,
        fontSize: 13,
      }}
    >
      {text ?? JSON.stringify(message)}
    </div>
  );
}

function TurnCard({ turn }: { turn: Turn }) {
  const isInbound = turn.direction === 'inbound';
  const messages = Array.isArray(turn.message) ? turn.message : [turn.message];

  return (
    <Card
      size="small"
      style={{
        borderLeft: `4px solid ${isInbound ? '#1677ff' : '#52c41a'}`,
        marginBottom: 0,
      }}
    >
      <Row justify="space-between" align="top">
        <Col>
          <Space>
            <Tag color={isInbound ? 'blue' : 'green'}>
              {isInbound ? '\u2190 inbound' : '\u2192 outbound'}
            </Tag>
            <Text code style={{ fontSize: 11 }}>
              {turn.turnId}
            </Text>
          </Space>
        </Col>
        <Col>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {new Date(turn.timestamp).toLocaleString()}
          </Text>
        </Col>
      </Row>

      <div style={{ marginTop: 8 }}>
        {messages.map((msg, i) => (
          <MessageView key={i} message={msg as Record<string, unknown>} />
        ))}
      </div>

      <Collapse
        ghost
        size="small"
        style={{ marginTop: 4 }}
        items={[
          {
            key: 'raw',
            label: (
              <Text type="secondary" style={{ fontSize: 11 }}>
                Raw envelope
              </Text>
            ),
            children: (
              <pre
                style={{
                  fontSize: 11,
                  background: '#f5f5f5',
                  padding: 8,
                  borderRadius: 4,
                  overflow: 'auto',
                  maxHeight: 200,
                }}
              >
                {JSON.stringify(turn, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </Card>
  );
}

export default function ThreadDetailPage() {
  const router = useRouter();
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;

  const [thread, setThread] = useState<Thread | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!threadId) return;
    setLoading(true);
    Promise.all([threadApi.get(threadId), threadApi.turns(threadId)])
      .then(([t, fetchedTurns]) => {
        setThread(t);
        setTurns(fetchedTurns);
      })
      .catch(() => {
        setThread(null);
        setTurns([]);
      })
      .finally(() => setLoading(false));
  }, [threadId]);

  const toggleExpand = (turnId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push('/dashboard/threads')}
        >
          Back to Threads
        </Button>
        <Card style={{ marginTop: 16 }}>
          <Text type="secondary">Thread not found.</Text>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Row align="middle" gutter={12} style={{ marginBottom: 16 }}>
        <Col>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push('/dashboard/threads')}
          >
            Back
          </Button>
        </Col>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            Thread Detail
          </Title>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="Thread ID">
            <Text code style={{ fontSize: 12 }}>
              {thread.threadId}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Channel">
            <Tag color="blue">{thread.channelId}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Target">
            <Text code style={{ fontSize: 12 }}>
              {thread.targetId}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Native Thread">
            {thread.nativeThreadId ? (
              <Text code style={{ fontSize: 12 }}>
                {thread.nativeThreadId}
              </Text>
            ) : (
              <Text type="secondary">virtual</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {new Date(thread.createdAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="Turns">
            <Badge count={turns.length} showZero style={{ backgroundColor: '#1677ff' }} />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Title level={4}>
        Turn Log{' '}
        <Text type="secondary" style={{ fontWeight: 400, fontSize: 14 }}>
          ({turns.length} turns, chronological)
        </Text>
      </Title>

      {turns.length === 0 ? (
        <Card>
          <Text type="secondary">No turns recorded for this thread.</Text>
        </Card>
      ) : (
        <Timeline
          mode="left"
          items={turns.map((turn) => ({
            key: turn.turnId,
            color: turn.direction === 'inbound' ? 'blue' : 'green',
            label: (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {new Date(turn.timestamp).toLocaleTimeString()}
              </Text>
            ),
            children: (
              <div style={{ marginBottom: 8 }}>
                <div
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleExpand(turn.turnId)}
                >
                  <Space>
                    <Tag color={turn.direction === 'inbound' ? 'blue' : 'green'}>
                      {turn.direction === 'inbound' ? '\u2190 inbound' : '\u2192 outbound'}
                    </Tag>
                    <Text code style={{ fontSize: 11 }}>
                      {turn.turnId}
                    </Text>
                    {expanded.has(turn.turnId) ? (
                      <UpOutlined style={{ fontSize: 10 }} />
                    ) : (
                      <DownOutlined style={{ fontSize: 10 }} />
                    )}
                  </Space>
                </div>
                {expanded.has(turn.turnId) && (
                  <div style={{ marginTop: 8 }}>
                    <TurnCard turn={turn} />
                  </div>
                )}
                {!expanded.has(turn.turnId) && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: '#666',
                      maxWidth: 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {(() => {
                      const msgs = Array.isArray(turn.message)
                        ? turn.message
                        : [turn.message];
                      const first = msgs[0] as Record<string, unknown>;
                      if ('intent' in first) return `[A2H: ${first.intent as string}]`;
                      return (first.text as string) ?? JSON.stringify(first).slice(0, 80);
                    })()}
                  </div>
                )}
              </div>
            ),
          }))}
        />
      )}
    </>
  );
}
