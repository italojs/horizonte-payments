import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const grafana = process.env.GRAFANA_URL ?? 'http://localhost:3000';
const paymentId = process.argv[2] ?? process.env.PAYMENT_ID;
if (!paymentId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(paymentId)) {
  throw new Error('Usage: node scripts/telemetry.ts <confirmed-demo-payment-uuid>');
}
const out = fileURLToPath(new URL('../evidence/telemetry/', import.meta.url));
const services = ['payments-api', 'payments-worker', 'accounts-service', 'bank-simulator'];
const metricQuery = '{__name__=~"(accounts|banks|payments)[._]operations(_total)?"}';
const traceQuery = '{ span.payment.id = "' + paymentId + '" }';

type Attribute = { key: string; value: { stringValue?: string } };
type Span = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: Attribute[];
};
type Batch = { resource: { attributes: Attribute[] }; scopeSpans: { spans: Span[] }[] };
type Trace = { batches?: Batch[]; resourceSpans?: Batch[] };
type Metric = { metric: Record<string, string>; value: [number, string] };
type LogStream = { values: [string, string, Record<string, string>?][]; stream: Record<string, string> };

function attr(attributes: Attribute[] | undefined, key: string) {
  return attributes?.find((a) => a.key === key)?.value.stringValue;
}
function asHex(value = '') {
  return !value || /^[0-9a-f]{16}$/i.test(value) ? value : Buffer.from(value, 'base64').toString('hex');
}
async function query<T>(uid: string, path: string, params: Record<string, string> = {}) {
  const url = new URL('/api/datasources/proxy/uid/' + uid + path, grafana);
  url.search = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(uid + ' returned HTTP ' + res.status);
  return (await res.json()) as T;
}
async function eventually<T>(check: () => Promise<T | undefined>, label: string) {
  const deadline = Date.now() + 150000;
  let detail = 'no samples';
  do {
    try {
      const value = await check();
      if (value !== undefined) return value;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    await delay(2000);
  } while (Date.now() < deadline);
  throw new Error(label + ' (' + detail + ')');
}
function domainSpan(name: string) {
  return /^(payment\.|accounts\.|bank\.|saga\.|rabbitmq (consume|publish) )/.test(name);
}
async function findTrace() {
  const result = await query<{ traces: { traceID: string }[] }>('tempo', '/api/search', {
    q: traceQuery,
    limit: '30',
  });
  for (const hit of result.traces ?? []) {
    // Tempo search can omit a leading zero. Loki stores the W3C 32-digit form.
    if (!/^[0-9a-f]{1,32}$/i.test(hit.traceID)) continue;
    const traceID = hit.traceID.padStart(32, '0').toLowerCase();
    const trace = await query<Trace>('tempo', '/api/traces/' + traceID);
    const spans = (trace.batches ?? trace.resourceSpans ?? []).flatMap((batch) => {
      const service = attr(batch.resource.attributes, 'service.name') ?? '';
      return batch.scopeSpans.flatMap((scope) =>
        scope.spans.map((span) => ({
          id: asHex(span.spanId),
          parent: asHex(span.parentSpanId),
          service,
          name: span.name,
          operationPaymentId: attr(span.attributes, 'payment.id'),
          queue: attr(span.attributes, 'messaging.destination.name'),
          startNs: BigInt(span.startTimeUnixNano),
          endNs: BigInt(span.endTimeUnixNano),
        })),
      );
    });
    const present = new Set(spans.map((s) => s.service));
    if (!services.every((s) => present.has(s))) continue;
    const capture = spans.find(
      (s) =>
        s.service === 'accounts-service' &&
        s.name === 'accounts.capture' &&
        s.operationPaymentId === paymentId,
    );
    if (!capture) continue;
    const byId = new Map(spans.map((s) => [s.id, s]));
    const ancestry = new Set<string>();
    let current: (typeof spans)[number] | undefined = capture;
    while (current && !ancestry.has(current.id)) {
      ancestry.add(current.id);
      current = byId.get(current.parent);
    }
    const ancestors = spans.filter((s) => ancestry.has(s.id));
    if (
      !ancestors.some((s) => s.service === 'payments-api') ||
      !ancestors.some((s) => s.service === 'payments-worker')
    )
      continue;
    const accepted = ancestors.some(
      (s) =>
        s.service === 'payments-api' &&
        s.name === 'payment.accept' &&
        s.operationPaymentId === paymentId,
    );
    const bank = spans.find(
      (s) =>
        s.service === 'bank-simulator' && s.name === 'bank.submit' && s.operationPaymentId === paymentId,
    );
    if (
      !accepted ||
      !bank ||
      !spans.some((s) => s.name.startsWith('rabbitmq publish ')) ||
      !spans.some((s) => s.name.startsWith('rabbitmq consume '))
    )
      continue;
    const startNs = spans.reduce((t, s) => (s.startNs < t ? s.startNs : t), spans[0].startNs);
    const endNs = spans.reduce((t, s) => (s.endNs > t ? s.endNs : t), spans[0].endNs);
    return {
      traceId: traceID,
      startedAt: new Date(Number(startNs / 1000000n)).toISOString(),
      durationMs: Number(endNs - startNs) / 1e6,
      services: Object.fromEntries(
        services.map((s) => [s, spans.filter((span) => span.service === s).length]),
      ),
      captureAncestors: [...new Set(ancestors.map((s) => s.service))],
      domainSpans: spans
        .filter((s) => domainSpan(s.name))
        .sort((a, b) => Number(a.startNs - b.startNs))
        .map((s) => ({
          service: s.service,
          operation: s.name,
          spanId: s.id,
          parentSpanId: s.parent || null,
          queue: s.queue,
          offsetMs: Number(s.startNs - startNs) / 1e6,
          durationMs: Number(s.endNs - s.startNs) / 1e6,
        })),
    };
  }
}
async function findMetrics() {
  const result = await query<{ data: { result: Metric[] } }>('prometheus', '/api/v1/query', {
    query: metricQuery,
  });
  const rows = result.data.result.filter(
    ({ value, metric }) => Number(value[1]) > 0 && metric.operation && metric.result === 'ok',
  );
  if (
    !rows.some((s) => s.metric.operation === 'accounts.capture') ||
    !rows.some((s) => s.metric.operation === 'bank.submit')
  )
    return;
  return rows
    .map(({ metric, value }) => ({
      name: metric.__name__,
      service: metric.job ?? metric.service_name,
      operation: metric.operation,
      result: metric.result,
      total: Number(value[1]),
      sampleAt: new Date(value[0] * 1000).toISOString(),
    }))
    .sort((a, b) => a.operation.localeCompare(b.operation));
}
async function findLogs(traceId: string) {
  const logQuery =
    '{service_name=~"payments-api|payments-worker|accounts-service|bank-simulator"} | trace_id="' +
    traceId +
    '"';
  const result = await query<{ data: { result: LogStream[] } }>('loki', '/loki/api/v1/query_range', {
    query: logQuery,
    limit: '1000',
    since: '1h',
  });
  return {
    query: logQuery,
    correlatedRecords: result.data.result.reduce((n, s) => n + s.values.length, 0),
    services: [...new Set(result.data.result.map((s) => s.stream.service_name).filter(Boolean))].sort(),
  };
}
const domainMetricsQuery =
  'sum by (operation) ({__name__=~"(payments|banks|accounts)_operations_total",operation=~"accounts.capture|bank.submit|payment.accept",result="ok"})';
function exploreUrl(uid: string, fields: Record<string, unknown>) {
  const url = new URL('/explore', grafana);
  url.searchParams.set('schemaVersion', '1');
  url.searchParams.set(
    'panes',
    JSON.stringify({
      a: {
        datasource: uid,
        queries: [{ refId: 'A', datasource: { type: uid, uid }, ...fields }],
        range: { from: 'now-1h', to: 'now' },
      },
    }),
  );
  return url.toString();
}
async function record(file: string, scenario: (page: Page) => Promise<string[]>) {
  const tmp = await mkdtemp(join(tmpdir(), 'horizonte-grafana-'));
  const chromePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath =
    chromePath ??
    (existsSync(chromium.executablePath()) ? undefined : existsSync(macChrome) ? macChrome : undefined);
  const browser = await chromium.launch({ executablePath });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      recordVideo: { dir: tmp, size: { width: 1440, height: 1000 } },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const assertions = await scenario(page);
    await context.close();
    const input = await page.video()!.path();
    const output = join(out, file);
    execFileSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      output,
    ]);
    const media = await readFile(output);
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=codec_name,width,height,r_frame_rate:format=duration',
          '-of',
          'json',
          output,
        ],
        { encoding: 'utf8' },
      ),
    );
    const durationSeconds = Number(probe.format.duration);
    if (!media.length || durationSeconds < 3 || probe.streams[0]?.codec_name !== 'h264')
      throw new Error('Incomplete Grafana recording');
    return {
      file,
      assertions,
      bytes: media.length,
      sha256: createHash('sha256').update(media).digest('hex'),
      durationSeconds,
      codec: probe.streams[0].codec_name,
      width: probe.streams[0].width,
      height: probe.streams[0].height,
      frameRate: probe.streams[0].r_frame_rate,
    };
  } finally {
    await browser.close();
    await rm(tmp, { recursive: true, force: true });
  }
}
async function show(page: Page, text: string, exact = false) {
  const item = page.getByText(text, { exact }).last();
  await item.waitFor({ state: 'visible' });
  await item.scrollIntoViewIfNeeded();
  await item.hover();
  await delay(1500);
}

await mkdir(out, { recursive: true });
const [trace, metrics] = await Promise.all([
  eventually(findTrace, 'No complete four-service trace'),
  eventually(findMetrics, 'No exported domain counters'),
]);
const logs = await eventually(async () => {
  const observed = await findLogs(trace.traceId);
  return observed.correlatedRecords && services.every((service) => observed.services.includes(service))
    ? observed
    : undefined;
}, 'No correlated application logs from all four services');
const traceUrl = exploreUrl('tempo', { queryType: 'traceql', query: trace.traceId });
const traceRecording = await record('grafana-trace.mp4', async (page) => {
  await page.goto(traceUrl, { waitUntil: 'domcontentloaded' });
  await show(page, 'Service & Operation', true);
  await show(page, 'payment.accept');
  await show(page, 'rabbitmq consume payments.create');
  await show(page, 'bank.submit');
  await show(page, 'accounts.capture');
  return [
    'The Grafana trace waterfall rendered',
    'API acceptance, RabbitMQ consumption, bank submission and account capture were visible',
  ];
});
const metricsUrl = exploreUrl('prometheus', {
  editorMode: 'code',
  expr: domainMetricsQuery,
  instant: true,
  range: false,
  format: 'table',
});
const logsUrl = exploreUrl('loki', { editorMode: 'code', expr: logs.query, queryType: 'range' });
const operationsRecording = await record('grafana-metrics-logs.mp4', async (page) => {
  await page.goto(metricsUrl, { waitUntil: 'domcontentloaded' });
  for (const operation of ['payment.accept', 'bank.submit', 'accounts.capture'])
    await show(page, '{operation="' + operation + '"}', true);
  await page.goto(logsUrl, { waitUntil: 'domcontentloaded' });
  await show(page, 'accounts.capture', true);
  await show(page, 'bank.submit', true);
  return [
    'Prometheus returned API, bank and accounts counters',
    'Loki displayed account capture and bank submission for this trace',
  ];
});
const videos = [traceRecording, operationsRecording];
// Store portable Explore paths as well as the URLs used during the recording.
const explorePath = (link: string) => {
  const url = new URL(link);
  return url.pathname + url.search;
};
const manifest = {
  capturedAt: new Date().toISOString(),
  paymentId,
  traceQuery,
  trace,
  metricQuery,
  metrics,
  logs,
  videos,
  explore: { trace: traceUrl, metrics: metricsUrl, logs: logsUrl },
  explorePaths: { trace: explorePath(traceUrl), metrics: explorePath(metricsUrl), logs: explorePath(logsUrl) },
  domainMetricsQuery,
};
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({
    paymentId,
    traceId: trace.traceId,
    services: trace.services,
    metrics: metrics.length,
    logs: logs.correlatedRecords,
    videos,
  }),
);
