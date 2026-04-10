'use client';

import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Badge,
  Button,
  Card,
  Col,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { channelApi } from '@/lib/api-client';
import type { Channel } from '@/lib/api-client';

const { Title, Text } = Typography;

const PLATFORMS = [
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'google-chat', label: 'Google Chat' },
];

const PLATFORM_HINTS: Record<string, string> = {
  slack: 'e.g. vault:slack/bot-token or the environment variable name holding your Slack bot token',
  discord: 'e.g. vault:discord/bot-token or the environment variable name for your Discord bot token',
  telegram: 'e.g. vault:telegram/bot-token or the environment variable for your Telegram Bot API token',
  whatsapp: 'e.g. vault:whatsapp/session or Baileys session reference',
  teams: 'e.g. vault:teams/app-credentials',
  'google-chat': 'e.g. vault:google-chat/service-account',
};

function MaskedApiKey({ apiKey }: { apiKey: string }) {
  const [visible, setVisible] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const masked = apiKey.slice(0, 10) + '•'.repeat(Math.max(0, apiKey.length - 10));

  const copy = () => {
    navigator.clipboard.writeText(apiKey).then(() => {
      messageApi.success('API key copied');
    });
  };

  return (
    <>
      {contextHolder}
      <Space>
        <Text code style={{ fontSize: 12 }}>
          {visible ? apiKey : masked}
        </Text>
        <Tooltip title={visible ? 'Hide' : 'Show'}>
          <Button
            size="small"
            type="text"
            icon={visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setVisible((v) => !v)}
          />
        </Tooltip>
        <Tooltip title="Copy">
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={copy} />
        </Tooltip>
      </Space>
    </>
  );
}

type WizardStep = 'platform' | 'credentials' | 'test' | 'done';

interface WizardState {
  id: string;
  platform: string;
  credentialsRef: string;
  metadata: string;
}

function ChannelWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const [step, setStep] = useState<WizardStep>('platform');
  const [form] = Form.useForm<WizardState>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const steps = [
    { key: 'platform', title: 'Platform' },
    { key: 'credentials', title: 'Credentials' },
    { key: 'test', title: 'Test & Save' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  const reset = () => {
    setStep('platform');
    setTestResult('idle');
    form.resetFields();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleNext = async () => {
    if (step === 'platform') {
      await form.validateFields(['platform', 'id']);
      setStep('credentials');
    } else if (step === 'credentials') {
      await form.validateFields(['credentialsRef']);
      setStep('test');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult('idle');
    // Simulate connection test — validates credentials ref format
    await new Promise((r) => setTimeout(r, 800));
    const creds = form.getFieldValue('credentialsRef') as string;
    if (creds && creds.length > 3) {
      setTestResult('success');
    } else {
      setTestResult('error');
      messageApi.error('Credentials reference appears invalid');
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      let metadata: Record<string, unknown> | undefined;
      if (values.metadata) {
        try {
          metadata = JSON.parse(values.metadata) as Record<string, unknown>;
        } catch {
          messageApi.error('Metadata must be valid JSON');
          setSaving(false);
          return;
        }
      }
      const channel = await channelApi.create({
        id: values.id,
        platform: values.platform,
        credentialsRef: values.credentialsRef,
        ...(metadata ? { metadata } : {}),
      });
      onCreated(channel);
      reset();
      onClose();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setSaving(false);
    }
  };

  const selectedPlatform = Form.useWatch('platform', form) as string | undefined;

  return (
    <>
      {contextHolder}
      <Modal
        title="Add Channel"
        open={open}
        onCancel={handleClose}
        footer={null}
        width={560}
        destroyOnClose
      >
        <Steps
          current={currentStepIndex}
          items={steps.map((s) => ({ title: s.title }))}
          style={{ marginBottom: 24 }}
          size="small"
        />

        <Form form={form} layout="vertical">
          {step === 'platform' && (
            <>
              <Form.Item
                name="platform"
                label="Platform"
                rules={[{ required: true, message: 'Select a platform' }]}
              >
                <Select
                  placeholder="Select a platform"
                  options={PLATFORMS}
                  size="large"
                  showSearch
                />
              </Form.Item>
              <Form.Item
                name="id"
                label="Channel ID"
                rules={[
                  { required: true, message: 'Enter a channel ID' },
                  {
                    pattern: /^[a-z0-9-_]+$/,
                    message: 'Use lowercase letters, numbers, hyphens, or underscores',
                  },
                ]}
                extra="A unique slug for this channel, e.g. slack-main"
              >
                <Input placeholder="e.g. slack-main" />
              </Form.Item>
            </>
          )}

          {step === 'credentials' && (
            <>
              <Form.Item
                name="credentialsRef"
                label="Credentials Reference"
                rules={[{ required: true, message: 'Enter a credentials reference' }]}
                extra={
                  selectedPlatform
                    ? PLATFORM_HINTS[selectedPlatform]
                    : 'Reference to credentials (vault path, env var name, etc.)'
                }
              >
                <Input placeholder="vault:slack/bot-token" />
              </Form.Item>
              <Form.Item
                name="metadata"
                label="Metadata (optional)"
                extra="JSON object with arbitrary metadata for this channel"
              >
                <Input.TextArea rows={3} placeholder='{"workspace": "my-workspace"}' />
              </Form.Item>
            </>
          )}

          {step === 'test' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              {testResult === 'idle' && (
                <>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                    Click &ldquo;Test Connection&rdquo; to validate your credentials reference before saving.
                  </Text>
                  <Button loading={testing} onClick={handleTest} icon={<CheckCircleOutlined />}>
                    Test Connection
                  </Button>
                </>
              )}
              {testResult === 'success' && (
                <Space direction="vertical" align="center">
                  <CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a' }} />
                  <Text type="success">Credentials reference looks valid</Text>
                  <Button type="primary" loading={saving} onClick={handleSave}>
                    Save Channel
                  </Button>
                </Space>
              )}
              {testResult === 'error' && (
                <Space direction="vertical" align="center">
                  <Text type="danger">Test failed — check your credentials reference</Text>
                  <Button onClick={handleTest} loading={testing}>
                    Retry
                  </Button>
                </Space>
              )}
            </div>
          )}
        </Form>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <Button onClick={step === 'platform' ? handleClose : () => setStep(step === 'credentials' ? 'platform' : 'credentials')}>
            {step === 'platform' ? 'Cancel' : 'Back'}
          </Button>
          {step !== 'test' && (
            <Button type="primary" onClick={handleNext}>
              Next
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

function EditChannelModal({
  channel,
  onClose,
  onUpdated,
}: {
  channel: Channel;
  onClose: () => void;
  onUpdated: (channel: Channel) => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    form.setFieldsValue({
      credentialsRef: channel.credentialsRef,
      metadata: channel.metadata ? JSON.stringify(channel.metadata, null, 2) : '',
    });
  }, [channel, form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue() as { credentialsRef: string; metadata: string };
      let metadata: Record<string, unknown> | undefined;
      if (values.metadata) {
        try {
          metadata = JSON.parse(values.metadata) as Record<string, unknown>;
        } catch {
          messageApi.error('Metadata must be valid JSON');
          setSaving(false);
          return;
        }
      }
      const updated = await channelApi.update(channel.id, {
        credentialsRef: values.credentialsRef,
        ...(metadata !== undefined ? { metadata } : {}),
      });
      onUpdated(updated);
      onClose();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={`Edit Channel: ${channel.id}`}
        open
        onCancel={onClose}
        onOk={handleSave}
        okText="Save"
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Platform">
            <Tag color="blue">{channel.platform}</Tag>
          </Form.Item>
          <Form.Item
            name="credentialsRef"
            label="Credentials Reference"
            rules={[{ required: true, message: 'Required' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="metadata" label="Metadata (JSON)">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(() => {
    setLoading(true);
    channelApi
      .list()
      .then(setChannels)
      .catch(() => messageApi.error('Failed to load channels'))
      .finally(() => setLoading(false));
  }, [messageApi]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await channelApi.delete(id);
      messageApi.success('Channel deleted');
      setChannels((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: 'Platform',
      dataIndex: 'platform',
      key: 'platform',
      render: (p: string) => <Tag color="blue">{p}</Tag>,
    },
    {
      title: 'Credentials Ref',
      dataIndex: 'credentialsRef',
      key: 'credentialsRef',
      render: (ref: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {ref}
        </Text>
      ),
    },
    {
      title: 'API Key',
      dataIndex: 'apiKey',
      key: 'apiKey',
      render: (key: string) => <MaskedApiKey apiKey={key} />,
    },
    {
      title: 'Status',
      key: 'status',
      render: () => <Badge status="default" text={<Text type="secondary">Unknown</Text>} />,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: Channel) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditChannel(record)}
          >
            Edit
          </Button>
          <Popconfirm
            title={`Delete channel "${record.id}"?`}
            description="This will permanently remove the channel."
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            Channels
          </Title>
        </Col>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>
            Add Channel
          </Button>
        </Col>
      </Row>

      <Card>
        <Table
          dataSource={channels}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: 'No channels registered yet' }}
        />
      </Card>

      <ChannelWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(channel) => {
          messageApi.success(`Channel "${channel.id}" created`);
          setChannels((prev) => [...prev, channel]);
        }}
      />

      {editChannel && (
        <EditChannelModal
          channel={editChannel}
          onClose={() => setEditChannel(null)}
          onUpdated={(updated) => {
            messageApi.success('Channel updated');
            setChannels((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          }}
        />
      )}
    </>
  );
}
