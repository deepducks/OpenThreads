/**
 * In-process metrics registry for OpenThreads.
 *
 * Tracks Prometheus-compatible counters and gauges. Values are exposed via
 * GET /api/metrics in the Prometheus text exposition format.
 *
 * All counters and gauges are process-local. In a multi-instance deployment,
 * aggregate across instances using a Prometheus scrape job.
 */

type MetricType = 'counter' | 'gauge';

interface MetricDescriptor {
  name: string;
  help: string;
  type: MetricType;
}

interface LabelSet {
  [label: string]: string;
}

interface Sample {
  labels: LabelSet;
  value: number;
}

class Metric {
  private samples = new Map<string, Sample>();

  constructor(readonly descriptor: MetricDescriptor) {}

  private key(labels: LabelSet): string {
    return JSON.stringify(Object.fromEntries(Object.entries(labels).sort()));
  }

  inc(labels: LabelSet = {}, amount = 1): void {
    const k = this.key(labels);
    const existing = this.samples.get(k);
    if (existing) {
      existing.value += amount;
    } else {
      this.samples.set(k, { labels, value: amount });
    }
  }

  set(labels: LabelSet = {}, value: number): void {
    const k = this.key(labels);
    this.samples.set(k, { labels, value });
  }

  get(labels: LabelSet = {}): number {
    return this.samples.get(this.key(labels))?.value ?? 0;
  }

  render(): string {
    const { name, help, type } = this.descriptor;
    const lines: string[] = [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} ${type}`,
    ];
    for (const { labels, value } of this.samples.values()) {
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
        .join(',');
      lines.push(labelStr ? `${name}{${labelStr}} ${value}` : `${name} ${value}`);
    }
    return lines.join('\n');
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

class MetricsRegistry {
  private metrics = new Map<string, Metric>();

  private register(descriptor: MetricDescriptor): Metric {
    if (!this.metrics.has(descriptor.name)) {
      this.metrics.set(descriptor.name, new Metric(descriptor));
    }
    return this.metrics.get(descriptor.name)!;
  }

  counter(name: string, help: string): Metric {
    return this.register({ name, help, type: 'counter' });
  }

  gauge(name: string, help: string): Metric {
    return this.register({ name, help, type: 'gauge' });
  }

  render(): string {
    return [...this.metrics.values()].map((m) => m.render()).join('\n\n') + '\n';
  }
}

export const registry = new MetricsRegistry();

// ─── Metric definitions ───────────────────────────────────────────────────────

/** Total inbound webhook events received, labelled by channel. */
export const messagesInTotal = registry.counter(
  'openthreads_messages_in_total',
  'Total number of inbound messages received from channels.',
);

/** Total outbound messages sent to recipients, labelled by channel and status. */
export const messagesOutTotal = registry.counter(
  'openthreads_messages_out_total',
  'Total number of outbound messages sent to recipients.',
);

/** Total A2H intents processed, labelled by intent type and method (1-4). */
export const a2hIntentsTotal = registry.counter(
  'openthreads_a2h_intents_total',
  'Total number of A2H intents processed by the Reply Engine.',
);

/** Number of currently active (open, not-yet-resolved) threads. */
export const activeThreadsGauge = registry.gauge(
  'openthreads_active_threads',
  'Number of active (open) threads.',
);

/** HTTP request duration histogram approximation (p50/p95 via labelled gauges). */
export const httpRequestDurationMs = registry.counter(
  'openthreads_http_requests_total',
  'Total HTTP requests served, labelled by method, path, and status_class.',
);

/** Recipient fanout latency total (for computing average). */
export const fanoutDurationMsTotal = registry.counter(
  'openthreads_fanout_duration_ms_total',
  'Cumulative fanout latency in milliseconds (divide by fanout_count for average).',
);

/** Total successful fanout deliveries. */
export const fanoutTotal = registry.counter(
  'openthreads_fanout_total',
  'Total recipient fanout attempts, labelled by status (success|error).',
);
