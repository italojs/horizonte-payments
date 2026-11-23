import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-undici': { enabled: false },
        '@opentelemetry/instrumentation-amqplib': { enabled: false },
        '@opentelemetry/instrumentation-pg': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => req.url === '/health',
        },
      }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
