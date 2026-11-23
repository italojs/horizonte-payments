import { setTimeout as wait } from 'node:timers/promises';
import { compose, origin, requireTestEnvironment } from './environment.ts';

const [domain, action, value, option] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const modes = ['normal', 'offline', 'pending', 'lose-response', 'reject'];
const owners = {
  bank: 'bank-simulator',
  accounts: 'accounts-service',
  payment: 'payments-worker',
} as const;

// Even with an API stopped, an owner can inspect its own committed ledger using its release image.
function operator(owner: keyof typeof owners, ...args: string[]) {
  const service = owners[owner];
  const running = compose('ps', '--status', 'running', '-q', service);
  const invocation = running ? ['exec', '-T'] : ['run', '--rm', '--no-deps', '-T'];
  return compose(...invocation, service, 'node', 'backend/scripts/operator.ts', ...args);
}

async function resetFixtures() {
  requireTestEnvironment();
  compose('stop', '-t', '3', 'payments-api', 'payments-worker');
  try {
    for (const queue of ['create', 'process', 'retry', 'cancel', 'dlq']) {
      compose('exec', '-T', 'rabbitmq', 'rabbitmqctl', 'delete_queue', 'payments.' + queue);
    }
    compose('exec', '-T', 'rabbitmq', 'rabbitmqctl', 'import_definitions', '/etc/rabbitmq/bootstrap.json');
    for (const owner of ['payment', 'accounts', 'bank'] as const) operator(owner, 'reset', '--test');
  } finally {
    compose('start', 'payments-worker', 'payments-api');
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(new URL('/api/account', origin), { signal: AbortSignal.timeout(1500) })).ok) {
        console.log('Disposable test accounts and queues are ready.');
        return;
      }
    } catch { /* The HTTP process may still be binding its port. */ }
    await wait(250);
  }
  throw Error('Payments did not become available after the test reset.');
}

async function main() {
  if (domain === 'reset' && action === '--test') return resetFixtures();
  if (domain === 'bank' && action === 'mode' && modes.includes(value)) {
    console.log(operator('bank', 'mode', value));
    return;
  }
  if ((domain === 'bank' || domain === 'payment' || domain === 'accounts') &&
      action === 'inspect' && uuid.test(value)) {
    do {
      console.log(operator(domain, 'inspect', value));
      if (domain === 'payment') console.log(operator('accounts', 'inspect', value));
      if (option !== '--watch') break;
      await wait(1500);
    } while (true);
    return;
  }
  if (domain === 'payment' && action === 'routes' && uuid.test(value)) {
    console.log(operator('payment', 'routes', value));
    return;
  }
  if (domain === 'breaker') {
    do {
      console.log(operator('payment', 'breaker'));
      if (action !== '--watch') break;
      await wait(1000);
    } while (true);
    return;
  }
  if (domain === 'queues') {
    console.log(compose('exec', '-T', 'rabbitmq', 'rabbitmqctl', 'list_queues', 'name', 'type', 'messages_ready', 'messages_unacknowledged'));
    return;
  }
  if (domain === 'worker') {
    const command = ['exec', '-T', 'payments-worker', 'node', 'worker/src/index.ts'];
    if (action === 'failpoint' && ['after-provider', 'after-commit'].includes(value) && (!option || uuid.test(option))) {
      console.log(compose(...command, action, value, option ?? '*', '120'));
      return;
    }
    if (action === 'redrive' && uuid.test(value)) {
      console.log(compose(...command, action, value));
      return;
    }
  }
  throw Error('Commands: bank mode normal|offline|pending|lose-response|reject, bank|accounts|payment inspect UUID [--watch], payment routes UUID, breaker [--watch], queues, worker failpoint after-commit|after-provider [UUID], worker redrive UUID, reset --test.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
