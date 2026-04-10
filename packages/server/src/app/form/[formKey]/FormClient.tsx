'use client';

/**
 * FormClient — interactive A2H form UI (Ant Design 5).
 *
 * Renders the appropriate form for each A2H intent type:
 *   AUTHORIZE  → context display + approve/deny buttons
 *   COLLECT    → labeled inputs (text, select, radio, checkbox) based on field schema
 *   Batch      → all intents on a single page, single submit
 *
 * Handles four display states: idle (form), loading (submitting), success, expired/error.
 */

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Form,
  Input,
  Radio,
  Result,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

// ─── Field definition (from COLLECT context) ──────────────────────────────────

interface CollectField {
  name: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox';
  label?: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface A2HIntentData {
  intent: string;
  context?: Record<string, unknown>;
  description?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FormClientProps {
  formKey: string;
  intents: A2HIntentData[];
  isBatch: boolean;
  status: 'pending' | 'submitted' | 'expired';
  expiresAt: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FormClient({ formKey, intents, isBatch, status: initialStatus, expiresAt }: FormClientProps) {
  const [form] = Form.useForm();
  const [uiState, setUiState] = useState<'idle' | 'loading' | 'success' | 'error'>(
    initialStatus === 'submitted' ? 'success' : initialStatus === 'expired' ? 'error' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string>('');

  const expiry = new Date(expiresAt);
  const isExpired = initialStatus === 'expired';

  // ── Submit handler ─────────────────────────────────────────────────────────

  async function handleSubmit(values: Record<string, unknown>) {
    setUiState('loading');
    setErrorMessage('');

    try {
      // Build the response payload.
      // For batch forms, `values` is a flat map keyed as `${intentIndex}_${fieldName}`.
      // For single forms, `values` contains the intent's fields directly.
      const responses = isBatch
        ? buildBatchResponses(values, intents)
        : [buildSingleResponse(values, intents[0])];

      const res = await fetch(`/api/form/${formKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses }),
      });

      if (res.ok) {
        setUiState('success');
      } else {
        const body = await res.json().catch(() => ({}));
        setErrorMessage((body as { error?: string }).error ?? `Server error (${res.status})`);
        setUiState('error');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error. Please try again.');
      setUiState('error');
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (isExpired) {
    return (
      <PageShell>
        <Result
          status="warning"
          icon={<ClockCircleOutlined />}
          title="This form has expired"
          subTitle={`The form link expired on ${expiry.toLocaleString()}. Please ask the system to send a new request.`}
        />
      </PageShell>
    );
  }

  if (uiState === 'success') {
    return (
      <PageShell>
        <Result
          status="success"
          icon={<CheckCircleOutlined />}
          title="Response submitted"
          subTitle="Your response has been recorded and sent back to the system."
        />
      </PageShell>
    );
  }

  if (uiState === 'error' && initialStatus === 'submitted') {
    return (
      <PageShell>
        <Result
          status="info"
          icon={<CheckCircleOutlined />}
          title="Already submitted"
          subTitle="This form has already been completed."
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Expiry notice */}
      <Alert
        type="info"
        icon={<ClockCircleOutlined />}
        message={`This form expires on ${expiry.toLocaleString()}`}
        showIcon
        style={{ marginBottom: 24 }}
      />

      {/* Error banner (submission errors) */}
      {uiState === 'error' && errorMessage && (
        <Alert
          type="error"
          icon={<CloseCircleOutlined />}
          message="Submission failed"
          description={errorMessage}
          showIcon
          closable
          onClose={() => { setUiState('idle'); setErrorMessage(''); }}
          style={{ marginBottom: 24 }}
        />
      )}

      <Spin spinning={uiState === 'loading'} tip="Submitting…">
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          scrollToFirstError
        >
          {intents.map((intent, idx) => (
            <IntentFormSection
              key={idx}
              intent={intent}
              intentIndex={idx}
              isBatch={isBatch}
            />
          ))}

          <Divider />

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={uiState === 'loading'}
            >
              Submit
            </Button>
          </Form.Item>
        </Form>
      </Spin>
    </PageShell>
  );
}

// ─── Page shell ───────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f5f5',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 680 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={3} style={{ margin: 0 }}>
            OpenThreads
          </Title>
          <Text type="secondary">Human-in-the-Loop Response</Text>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Intent section ───────────────────────────────────────────────────────────

interface IntentSectionProps {
  intent: A2HIntentData;
  intentIndex: number;
  isBatch: boolean;
}

function IntentFormSection({ intent, intentIndex, isBatch }: IntentSectionProps) {
  const prefix = isBatch ? `${intentIndex}_` : '';

  if (intent.intent === 'AUTHORIZE') {
    return <AuthorizeSection intent={intent} prefix={prefix} isBatch={isBatch} />;
  }

  if (intent.intent === 'COLLECT') {
    return <CollectSection intent={intent} prefix={prefix} isBatch={isBatch} intentIndex={intentIndex} />;
  }

  // ESCALATE or other intents — show a read-only notice.
  return (
    <Card style={{ marginBottom: 24 }}>
      <Space>
        <ExclamationCircleOutlined style={{ color: '#faad14' }} />
        <Text>
          {intent.description ?? `Intent: ${intent.intent}`}
        </Text>
      </Space>
    </Card>
  );
}

// ─── AUTHORIZE section ────────────────────────────────────────────────────────

interface AuthorizeSectionProps {
  intent: A2HIntentData;
  prefix: string;
  isBatch: boolean;
}

function AuthorizeSection({ intent, prefix, isBatch }: AuthorizeSectionProps) {
  const ctx = intent.context ?? {};
  const action = (ctx.action as string) ?? '';
  const details = (ctx.details as string) ?? '';
  const evidence = (ctx.evidence as string) ?? '';
  const requestedBy = (ctx.requestedBy as string) ?? '';

  return (
    <Card
      title={
        <Space>
          <Tag color="orange">AUTHORIZE</Tag>
          <span>{intent.description ?? action ?? 'Authorization Request'}</span>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      {/* Context display */}
      <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
        {action && <Descriptions.Item label="Action">{action}</Descriptions.Item>}
        {details && <Descriptions.Item label="Details">{details}</Descriptions.Item>}
        {evidence && <Descriptions.Item label="Evidence">{evidence}</Descriptions.Item>}
        {requestedBy && <Descriptions.Item label="Requested by">{requestedBy}</Descriptions.Item>}
      </Descriptions>

      {/* Approve / Deny radio */}
      <Form.Item
        name={`${prefix}decision`}
        label="Decision"
        rules={[{ required: true, message: 'Please select approve or deny' }]}
      >
        <Radio.Group>
          <Space direction="vertical">
            <Radio value="approve">
              <Space>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                <Text>Approve</Text>
              </Space>
            </Radio>
            <Radio value="deny">
              <Space>
                <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                <Text>Deny</Text>
              </Space>
            </Radio>
          </Space>
        </Radio.Group>
      </Form.Item>

      {/* Optional comment */}
      <Form.Item name={`${prefix}comment`} label="Comment (optional)">
        <Input.TextArea
          rows={3}
          placeholder="Add a note explaining your decision…"
          maxLength={1000}
          showCount
        />
      </Form.Item>
    </Card>
  );
}

// ─── COLLECT section ──────────────────────────────────────────────────────────

interface CollectSectionProps {
  intent: A2HIntentData;
  prefix: string;
  isBatch: boolean;
  intentIndex: number;
}

function CollectSection({ intent, prefix, isBatch, intentIndex }: CollectSectionProps) {
  const ctx = intent.context ?? {};
  const question = (ctx.question as string) ?? intent.description ?? '';
  const rawFields = ctx.fields as CollectField[] | undefined;
  const fields: CollectField[] = Array.isArray(rawFields) ? rawFields : [];

  const sectionTitle = isBatch
    ? `Question ${intentIndex + 1}${question ? `: ${question}` : ''}`
    : (question || 'Collect Information');

  return (
    <Card
      title={
        <Space>
          <Tag color="blue">COLLECT</Tag>
          <span>{sectionTitle}</span>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      {fields.length === 0 ? (
        // Free-text question with no defined fields.
        <Form.Item
          name={`${prefix}answer`}
          label={question || 'Your answer'}
          rules={[{ required: true, message: 'Please provide an answer' }]}
        >
          <Input.TextArea rows={3} placeholder="Type your answer here…" />
        </Form.Item>
      ) : (
        fields.map((field) => (
          <CollectFieldInput key={field.name} field={field} prefix={prefix} />
        ))
      )}
    </Card>
  );
}

// ─── Individual collect field ─────────────────────────────────────────────────

function CollectFieldInput({ field, prefix }: { field: CollectField; prefix: string }) {
  const fieldName = `${prefix}${field.name}`;
  const label = field.label ?? field.name;
  const required = field.required ?? false;
  const rules = required ? [{ required: true, message: `${label} is required` }] : [];

  if (field.type === 'select') {
    return (
      <Form.Item name={fieldName} label={label} rules={rules}>
        <Select
          placeholder={field.placeholder ?? `Select ${label.toLowerCase()}…`}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
        />
      </Form.Item>
    );
  }

  if (field.type === 'multiselect') {
    return (
      <Form.Item name={fieldName} label={label} rules={rules}>
        <Select
          mode="multiple"
          placeholder={field.placeholder ?? `Select ${label.toLowerCase()}…`}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
        />
      </Form.Item>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <Form.Item name={fieldName} label={label} rules={rules}>
        <Checkbox.Group
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        />
      </Form.Item>
    );
  }

  if (field.type === 'textarea') {
    return (
      <Form.Item name={fieldName} label={label} rules={rules}>
        <Input.TextArea
          rows={4}
          placeholder={field.placeholder ?? `Enter ${label.toLowerCase()}…`}
          maxLength={5000}
          showCount
        />
      </Form.Item>
    );
  }

  if (field.type === 'number') {
    return (
      <Form.Item name={fieldName} label={label} rules={rules}>
        <Input type="number" placeholder={field.placeholder ?? `Enter ${label.toLowerCase()}…`} />
      </Form.Item>
    );
  }

  if (field.type === 'date') {
    return (
      <Form.Item name={fieldName} label={label} rules={rules}>
        <Input type="date" placeholder={field.placeholder} />
      </Form.Item>
    );
  }

  // Default: text input.
  return (
    <Form.Item name={fieldName} label={label} rules={rules}>
      <Input placeholder={field.placeholder ?? `Enter ${label.toLowerCase()}…`} />
    </Form.Item>
  );
}

// ─── Response builders ────────────────────────────────────────────────────────

function buildSingleResponse(
  values: Record<string, unknown>,
  intent: A2HIntentData,
): Record<string, unknown> {
  if (intent.intent === 'AUTHORIZE') {
    return {
      intent: 'AUTHORIZE',
      response: values['decision'] === 'approve',
      comment: values['comment'] ?? undefined,
      respondedAt: new Date().toISOString(),
    };
  }

  if (intent.intent === 'COLLECT') {
    const ctx = intent.context ?? {};
    const rawFields = ctx.fields as CollectField[] | undefined;
    const fields: CollectField[] = Array.isArray(rawFields) ? rawFields : [];

    if (fields.length === 0) {
      return {
        intent: 'COLLECT',
        response: { answer: values['answer'] },
        respondedAt: new Date().toISOString(),
      };
    }

    const response: Record<string, unknown> = {};
    for (const field of fields) {
      response[field.name] = values[field.name];
    }

    return { intent: 'COLLECT', response, respondedAt: new Date().toISOString() };
  }

  return { intent: intent.intent, response: values, respondedAt: new Date().toISOString() };
}

function buildBatchResponses(
  values: Record<string, unknown>,
  intents: A2HIntentData[],
): Record<string, unknown>[] {
  return intents.map((intent, idx) => {
    const prefix = `${idx}_`;
    // Extract only keys belonging to this intent's prefix.
    const intentValues: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith(prefix)) {
        intentValues[key.slice(prefix.length)] = value;
      }
    }
    return buildSingleResponse(intentValues, intent);
  });
}
