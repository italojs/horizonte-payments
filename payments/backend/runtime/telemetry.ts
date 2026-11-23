import { trace, context, propagation, SpanStatusCode, metrics } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api';
import type { Attributes } from '@opentelemetry/api';
export { trace, context, propagation };
export const tracer = trace.getTracer('horizonte-payments', '1.0');
export const meter = metrics.getMeter('horizonte-payments');
const operations = meter.createCounter('payments.operations', {
  description: 'Completed domain operations',
});
const logger = logs.getLogger('horizonte-payments');
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes: Attributes = {},
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    let result = 'ok';
    try {
      return await fn();
    } catch (error) {
      result = 'error';
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      operations.add(1, { operation: name, result });
      const safe =
        typeof attributes['payment.id'] === 'string'
          ? { 'payment.id': attributes['payment.id'] }
          : {};
      logger.emit({
        body: name,
        severityNumber: result === 'ok' ? SeverityNumber.INFO : SeverityNumber.ERROR,
        attributes: { operation: name, result, ...safe },
      });
      span.end();
    }
  });
}
