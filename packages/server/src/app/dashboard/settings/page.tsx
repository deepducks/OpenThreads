'use client';

import { SaveOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Divider,
  Form,
  message,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { channelApi, settingsApi } from '@/lib/api-client';
import type { AppSettings, Channel, ChannelOverride } from '@/lib/api-client';

const { Title, Text } = Typography;

const TTL_PRESETS = [
  { value: 3600, label: '1 hour' },
  { value: 7200, label: '2 hours' },
  { value: 21600, label: '6 hours' },
  { value: 43200, label: '12 hours' },
  { value: 86400, label: '24 hours (default)' },
  { value: 172800, label: '48 hours' },
  { value: 604800, label: '7 days' },
];

function ttlLabel(seconds: number): string {
  const preset = TTL_PRESETS.find((p) => p.value === seconds);
  if (preset) return preset.label;
  if (seconds < 3600) return `${seconds}s`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function ChannelOverrideRow({
  channel,
  override,
  globalSettings,
  onChange,
}: {
  channel: Channel;
  override: ChannelOverride | undefined;
  globalSettings: AppSettings;
  onChange: (channelId: string, override: ChannelOverride | null) => void;
}) {
  const hasOverride = override !== undefined;
  const effectiveTtl = override?.tokenTtlSeconds ?? globalSettings.tokenTtlSeconds;
  const effectiveTrust = override?.trustLayerEnabled ?? globalSettings.trustLayerEnabled;

  return (
    <Card
      size="small"
      style={{
        marginBottom: 8,
        borderLeft: hasOverride ? '3px solid #1677ff' : undefined,
      }}
    >
      <Row align="middle" gutter={16}>
        <Col xs={6}>
          <Space>
            <Text code style={{ fontSize: 12 }}>
              {channel.id}
            </Text>
            <Tag color="blue" style={{ fontSize: 10 }}>
              {channel.platform}
            </Tag>
          </Space>
        </Col>
        <Col xs={5}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            TTL: {ttlLabel(effectiveTtl)}
          </Text>
          {override?.tokenTtlSeconds !== undefined && (
            <Tag color="purple" style={{ fontSize: 10, marginLeft: 4 }}>
              override
            </Tag>
          )}
        </Col>
        <Col xs={5}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Trust: {effectiveTrust ? 'on' : 'off'}
          </Text>
          {override?.trustLayerEnabled !== undefined && (
            <Tag color="purple" style={{ fontSize: 10, marginLeft: 4 }}>
              override
            </Tag>
          )}
        </Col>
        <Col xs={8}>
          <Space>
            <Button
              size="small"
              onClick={() => {
                const current = override ?? {};
                onChange(channel.id, {
                  ...current,
                  tokenTtlSeconds:
                    current.tokenTtlSeconds !== undefined
                      ? undefined
                      : globalSettings.tokenTtlSeconds,
                });
              }}
            >
              {override?.tokenTtlSeconds !== undefined ? 'Clear TTL' : 'Override TTL'}
            </Button>
            <Button
              size="small"
              onClick={() =>
                onChange(channel.id, {
                  ...override,
                  trustLayerEnabled: !effectiveTrust,
                })
              }
            >
              Toggle Trust
            </Button>
            {hasOverride && (
              <Button size="small" danger onClick={() => onChange(channel.id, null)}>
                Reset
              </Button>
            )}
          </Space>
        </Col>
      </Row>
      {override?.tokenTtlSeconds !== undefined && (
        <Row style={{ marginTop: 8 }}>
          <Col>
            <Space>
              <Text style={{ fontSize: 12 }}>Override TTL:</Text>
              <Select
                size="small"
                value={override.tokenTtlSeconds}
                options={TTL_PRESETS}
                onChange={(v) => onChange(channel.id, { ...override, tokenTtlSeconds: v })}
                style={{ width: 200 }}
              />
            </Space>
          </Col>
        </Row>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    Promise.all([settingsApi.get(), channelApi.list()])
      .then(([s, c]) => {
        setSettings(s);
        setChannels(c);
        form.setFieldsValue({
          tokenTtlSeconds: s.tokenTtlSeconds,
          trustLayerEnabled: s.trustLayerEnabled,
        });
      })
      .catch(() => messageApi.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, [form, messageApi]);

  const handleSaveGlobal = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue() as {
        tokenTtlSeconds: number;
        trustLayerEnabled: boolean;
      };
      const updated = await settingsApi.update({
        tokenTtlSeconds: values.tokenTtlSeconds,
        trustLayerEnabled: values.trustLayerEnabled,
      });
      setSettings(updated);
      messageApi.success('Settings saved');
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleChannelOverride = async (
    channelId: string,
    override: ChannelOverride | null,
  ) => {
    if (!settings) return;
    const next: Record<string, ChannelOverride> = { ...settings.perChannelOverrides };
    if (override === null) {
      delete next[channelId];
    } else {
      const clean: ChannelOverride = {};
      if (override.tokenTtlSeconds !== undefined)
        clean.tokenTtlSeconds = override.tokenTtlSeconds;
      if (override.trustLayerEnabled !== undefined)
        clean.trustLayerEnabled = override.trustLayerEnabled;
      next[channelId] = clean;
    }
    try {
      const updated = await settingsApi.update({ perChannelOverrides: next });
      setSettings(updated);
      messageApi.success('Per-channel override updated');
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  if (loading || !settings) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      {contextHolder}
      <Title level={3} style={{ marginTop: 0 }}>
        Settings
      </Title>

      {/* Global Configuration */}
      <Card title="Global Configuration" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Row gutter={24}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="tokenTtlSeconds"
                label="Default Reply Token TTL"
                extra="Duration ephemeral reply tokens remain valid. Recipients can use the replyTo URL within this window."
              >
                <Select options={TTL_PRESETS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="trustLayerEnabled"
                label="Trust Layer"
                valuePropName="checked"
                extra="When enabled, all A2H interactions require strong authentication (WebAuthn/OTP) and produce JWS-signed evidence."
              >
                <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSaveGlobal}
            >
              Save Global Settings
            </Button>
          </Form.Item>
        </Form>

        <Divider />

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Card size="small" style={{ background: '#f5f5f5' }}>
              <Text strong style={{ fontSize: 12 }}>
                Current effective settings
              </Text>
              <div style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12 }}>
                  Token TTL: <strong>{ttlLabel(settings.tokenTtlSeconds)}</strong>
                </Text>
                <br />
                <Text style={{ fontSize: 12 }}>
                  Trust Layer:{' '}
                  <Tag color={settings.trustLayerEnabled ? 'green' : 'default'}>
                    {settings.trustLayerEnabled ? 'Enabled' : 'Disabled'}
                  </Tag>
                </Text>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12}>
            <Card size="small" style={{ background: '#f5f5f5' }}>
              <Text strong style={{ fontSize: 12 }}>
                Environment variables
              </Text>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  <code>REPLY_TOKEN_TTL</code> — Token TTL (seconds, overrides DB setting)
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  <code>MANAGEMENT_API_KEY</code> — Management API authentication key
                </Text>
              </div>
            </Card>
          </Col>
        </Row>
      </Card>

      {/* Per-Channel Overrides */}
      <Card title="Per-Channel Overrides">
        {channels.length === 0 ? (
          <Text type="secondary">
            No channels registered. Add channels first to configure per-channel overrides.
          </Text>
        ) : (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              Override global settings for individual channels. Changes take effect immediately.
            </Text>
            {channels.map((channel) => (
              <ChannelOverrideRow
                key={channel.id}
                channel={channel}
                override={settings.perChannelOverrides[channel.id]}
                globalSettings={settings}
                onChange={handleChannelOverride}
              />
            ))}
          </>
        )}
      </Card>
    </>
  );
}
