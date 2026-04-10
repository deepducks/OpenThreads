'use client';

import {
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { channelApi, recipientApi, routeApi } from '@/lib/api-client';
import type { Channel, Recipient, Route, RouteCriteria, CreateRouteInput } from '@/lib/api-client';

const { Title, Text } = Typography;

// Lazy-load the ReactFlow editor to avoid SSR issues
const RouteFlowCanvas = dynamic(() => import('./RouteFlowCanvas'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
        border: '1px solid #e8e8e8',
        borderRadius: 8,
      }}
    >
      <Text type="secondary">Loading route editor…</Text>
    </div>
  ),
});

const CRITERIA_LABELS: Record<keyof RouteCriteria, string> = {
  channelId: 'Channel',
  groupId: 'Group',
  isDm: 'Direct Message',
  nativeThreadId: 'Native Thread',
  isMention: 'Mention',
  senderId: 'Sender',
  contentPattern: 'Content Pattern (regex)',
};

function criteriaToTags(criteria: RouteCriteria): string[] {
  const tags: string[] = [];
  if (criteria.channelId) tags.push(`channel:${criteria.channelId}`);
  if (criteria.groupId) tags.push(`group:${criteria.groupId}`);
  if (criteria.isDm) tags.push('DM');
  if (criteria.isMention) tags.push('mention');
  if (criteria.senderId) tags.push(`sender:${criteria.senderId}`);
  if (criteria.contentPattern) tags.push(`pattern:${criteria.contentPattern}`);
  if (tags.length === 0) tags.push('any');
  return tags;
}

function RouteForm({
  initial,
  channels,
  recipients,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Route>;
  channels: Channel[];
  recipients: Recipient[];
  onSave: (values: CreateRouteInput) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (initial) {
      form.setFieldsValue({
        id: initial.id,
        priority: initial.priority ?? 10,
        recipientId: initial.recipientId,
        enabled: initial.enabled ?? true,
        channelId: initial.criteria?.channelId,
        groupId: initial.criteria?.groupId,
        isDm: initial.criteria?.isDm,
        isMention: initial.criteria?.isMention,
        senderId: initial.criteria?.senderId,
        contentPattern: initial.criteria?.contentPattern,
        nativeThreadId: initial.criteria?.nativeThreadId,
      });
    } else {
      form.setFieldsValue({ priority: 10, enabled: true });
    }
  }, [initial, form]);

  const handleFinish = (values: Record<string, unknown>) => {
    const criteria: RouteCriteria = {};
    if (values.channelId) criteria.channelId = values.channelId as string;
    if (values.groupId) criteria.groupId = values.groupId as string;
    if (values.isDm) criteria.isDm = true;
    if (values.isMention) criteria.isMention = true;
    if (values.senderId) criteria.senderId = values.senderId as string;
    if (values.contentPattern) criteria.contentPattern = values.contentPattern as string;
    if (values.nativeThreadId) criteria.nativeThreadId = values.nativeThreadId as string;

    onSave({
      id: values.id as string,
      recipientId: values.recipientId as string,
      priority: values.priority as number,
      enabled: (values.enabled as boolean) ?? true,
      criteria,
    });
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish}>
      <Form.Item
        name="id"
        label="Route ID"
        rules={[{ required: true, message: 'Required' }]}
        extra="Unique slug for this route"
      >
        <Input placeholder="e.g. slack-to-my-agent" disabled={!!initial?.id} />
      </Form.Item>

      <Form.Item
        name="priority"
        label="Priority"
        rules={[{ required: true, message: 'Required' }]}
        extra="Lower number = higher priority"
      >
        <InputNumber min={0} max={9999} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item
        name="recipientId"
        label="Recipient"
        rules={[{ required: true, message: 'Select a recipient' }]}
      >
        <Select
          placeholder="Select recipient"
          options={recipients.map((r) => ({ value: r.id, label: r.id }))}
        />
      </Form.Item>

      <Form.Item name="enabled" valuePropName="checked">
        <Checkbox>Enabled</Checkbox>
      </Form.Item>

      <Divider />
      <Text strong>Criteria (all provided fields must match)</Text>

      <Form.Item name="channelId" label={CRITERIA_LABELS.channelId} style={{ marginTop: 12 }}>
        <Select
          allowClear
          placeholder="Any channel"
          options={channels.map((c) => ({ value: c.id, label: `${c.id} (${c.platform})` }))}
        />
      </Form.Item>

      <Form.Item name="groupId" label={CRITERIA_LABELS.groupId}>
        <Input placeholder="Any group" allowClear />
      </Form.Item>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="isDm" valuePropName="checked">
            <Checkbox>{CRITERIA_LABELS.isDm}</Checkbox>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="isMention" valuePropName="checked">
            <Checkbox>{CRITERIA_LABELS.isMention}</Checkbox>
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="senderId" label={CRITERIA_LABELS.senderId}>
        <Input placeholder="Any sender" allowClear />
      </Form.Item>

      <Form.Item
        name="contentPattern"
        label={CRITERIA_LABELS.contentPattern}
        extra="JavaScript regex, e.g. ^deploy"
      >
        <Input placeholder="Any content" allowClear />
      </Form.Item>

      <Form.Item name="nativeThreadId" label={CRITERIA_LABELS.nativeThreadId}>
        <Input placeholder="Any thread" allowClear />
      </Form.Item>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          {initial?.id ? 'Update Route' : 'Create Route'}
        </Button>
      </div>
    </Form>
  );
}

function TestRoutePanel({
  open,
  channels,
  onClose,
  onResult,
}: {
  open: boolean;
  channels: Channel[];
  onClose: () => void;
  onResult: (matchingIds: string[]) => void;
}) {
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const handleTest = async () => {
    setTesting(true);
    try {
      const values = form.getFieldsValue() as Record<string, unknown>;
      const criteria: Partial<RouteCriteria> = {};
      if (values.channelId) criteria.channelId = values.channelId as string;
      if (values.isDm) criteria.isDm = true;
      if (values.isMention) criteria.isMention = true;
      if (values.senderId) criteria.senderId = values.senderId as string;

      const result = await routeApi.test(criteria);
      onResult(result.matchingRouteIds);
      if (result.matchingRouteIds.length === 0) {
        messageApi.info('No routes matched this message');
      } else {
        messageApi.success(`${result.matchingRouteIds.length} route(s) matched — highlighted in canvas`);
      }
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Drawer
        title="Test Route Matching"
        open={open}
        onClose={onClose}
        width={400}
        extra={
          <Button type="primary" loading={testing} onClick={handleTest} icon={<ExperimentOutlined />}>
            Run Test
          </Button>
        }
      >
        <Alert
          type="info"
          message="Simulate an inbound message to see which routes would match."
          style={{ marginBottom: 16 }}
          showIcon
        />
        <Form form={form} layout="vertical">
          <Form.Item name="channelId" label="From Channel">
            <Select
              allowClear
              placeholder="Any channel"
              options={channels.map((c) => ({ value: c.id, label: `${c.id} (${c.platform})` }))}
            />
          </Form.Item>
          <Form.Item name="isDm" valuePropName="checked">
            <Checkbox>Is Direct Message</Checkbox>
          </Form.Item>
          <Form.Item name="isMention" valuePropName="checked">
            <Checkbox>Is Mention</Checkbox>
          </Form.Item>
          <Form.Item name="senderId" label="Sender ID">
            <Input placeholder="Any sender" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<Route | null>(null);
  const [saving, setSaving] = useState(false);
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [highlightedRouteIds, setHighlightedRouteIds] = useState<string[]>([]);
  const [newRouteDefaults, setNewRouteDefaults] = useState<Partial<Route>>({});
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([routeApi.list(), channelApi.list(), recipientApi.list()])
      .then(([r, c, rec]) => {
        setRoutes(r);
        setChannels(c);
        setRecipients(rec);
      })
      .catch(() => messageApi.error('Failed to load data'))
      .finally(() => setLoading(false));
  }, [messageApi]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreateDrawer = (defaults?: Partial<Route>) => {
    setEditRoute(null);
    setNewRouteDefaults(defaults ?? {});
    setDrawerOpen(true);
  };

  const openEditDrawer = (route: Route) => {
    setEditRoute(route);
    setNewRouteDefaults({});
    setDrawerOpen(true);
  };

  const handleSave = async (values: CreateRouteInput) => {
    setSaving(true);
    try {
      if (editRoute) {
        const updated = await routeApi.update(editRoute.id, {
          criteria: values.criteria,
          recipientId: values.recipientId,
          priority: values.priority,
          enabled: values.enabled,
        });
        setRoutes((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        messageApi.success('Route updated');
      } else {
        const created = await routeApi.create(values);
        setRoutes((prev) => [...prev, created].sort((a, b) => a.priority - b.priority));
        messageApi.success('Route created');
      }
      setDrawerOpen(false);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await routeApi.delete(id);
      setRoutes((prev) => prev.filter((r) => r.id !== id));
      messageApi.success('Route deleted');
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <>
      {contextHolder}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            Routes
          </Title>
        </Col>
        <Col>
          <Space>
            <Button
              icon={<ExperimentOutlined />}
              onClick={() => setTestPanelOpen(true)}
            >
              Test Route
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openCreateDrawer()}
            >
              New Route
            </Button>
          </Space>
        </Col>
      </Row>

      {/* ReactFlow Canvas */}
      <Card
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 0, overflow: 'hidden', borderRadius: 8 } }}
        loading={loading}
      >
        <RouteFlowCanvas
          routes={routes}
          channels={channels}
          recipients={recipients}
          highlightedRouteIds={highlightedRouteIds}
          onEditRoute={openEditDrawer}
          onCreateRoute={(defaults) => openCreateDrawer(defaults)}
          onDeleteRoute={handleDelete}
        />
      </Card>

      {/* Route List (priority-ordered) */}
      <Card title="Route Priority Order" loading={loading}>
        {routes.length === 0 ? (
          <Text type="secondary">No routes defined. Create one using &ldquo;New Route&rdquo;.</Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {routes.map((route, index) => (
              <Card
                key={route.id}
                size="small"
                style={{
                  borderLeft: `4px solid ${highlightedRouteIds.includes(route.id) ? '#52c41a' : '#1677ff'}`,
                  background: highlightedRouteIds.includes(route.id) ? '#f6ffed' : undefined,
                }}
              >
                <Row justify="space-between" align="middle">
                  <Col>
                    <Space>
                      <Badge
                        count={index + 1}
                        style={{ backgroundColor: '#1677ff' }}
                        title={`Priority ${route.priority}`}
                      />
                      <Text code>{route.id}</Text>
                      {!route.enabled && <Tag color="default">Disabled</Tag>}
                      {criteriaToTags(route.criteria).map((tag) => (
                        <Tag key={tag} color="default">
                          {tag}
                        </Tag>
                      ))}
                      <Text type="secondary">→</Text>
                      <Tag color="green">{route.recipientId}</Tag>
                    </Space>
                  </Col>
                  <Col>
                    <Space>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEditDrawer(route)}
                      />
                      <Popconfirm
                        title={`Delete route "${route.id}"?`}
                        onConfirm={() => handleDelete(route.id)}
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  </Col>
                </Row>
              </Card>
            ))}
          </Space>
        )}
      </Card>

      {/* Create/Edit Drawer */}
      <Drawer
        title={editRoute ? `Edit Route: ${editRoute.id}` : 'New Route'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        destroyOnClose
      >
        <RouteForm
          initial={editRoute ?? newRouteDefaults}
          channels={channels}
          recipients={recipients}
          onSave={handleSave}
          onCancel={() => setDrawerOpen(false)}
          saving={saving}
        />
      </Drawer>

      {/* Test Route Panel */}
      <TestRoutePanel
        open={testPanelOpen}
        channels={channels}
        onClose={() => {
          setTestPanelOpen(false);
          setHighlightedRouteIds([]);
        }}
        onResult={setHighlightedRouteIds}
      />
    </>
  );
}
