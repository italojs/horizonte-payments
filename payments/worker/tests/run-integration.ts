import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

// Colima exposes a macOS socket to the client and a Linux socket to Ryuk.
if (
  process.platform === 'darwin' &&
  process.env.DOCKER_HOST?.startsWith('unix://') &&
  process.env.DOCKER_HOST.includes('/.colima/')
) {
  process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= '/var/run/docker.sock';
}

// Both fixtures are isolated from the application's Compose services and volumes.
const database = await new PostgreSqlContainer('postgres:18').start();
let rabbit: StartedTestContainer | undefined;
try {
  const password = randomUUID();
  rabbit = await new GenericContainer('rabbitmq:4.4-management')
    .withEnvironment({
      RABBITMQ_DEFAULT_USER: 'integration',
      RABBITMQ_DEFAULT_PASS: password,
      RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '+S 2:2',
    })
    .withExposedPorts(5672)
    .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
    .start();
  const amqpUrl = new URL('amqp://integration@localhost');
  amqpUrl.password = password;
  amqpUrl.hostname = rabbit.getHost();
  amqpUrl.port = String(rabbit.getMappedPort(5672));
  const child = spawn('pnpm', ['exec', 'vitest', 'run', 'worker/tests/integration'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PAYMENTS_TEST_DB: database.getConnectionUri(),
      AMQP_TEST_URL: amqpUrl.href,
    },
  });
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  try {
    await rabbit?.stop();
  } finally {
    await database.stop();
  }
}
