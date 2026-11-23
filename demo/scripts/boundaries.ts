import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compose } from './environment.ts';

const ownership = [
  { service: 'payments-api', database: 'payments-db', forbidden: ['accounts-db', 'banks-db'], http: ['http://accounts-service:3011/health'] },
  { service: 'payments-worker', database: 'payments-db', forbidden: ['accounts-db', 'banks-db'], http: ['http://accounts-service:3011/health', 'http://bank-simulator:3012/health'] },
  { service: 'accounts-service', database: 'accounts-db', forbidden: ['payments-db', 'banks-db', 'rabbitmq'], http: [] },
  { service: 'bank-simulator', database: 'banks-db', forbidden: ['payments-db', 'accounts-db', 'rabbitmq'], http: [] },
];
const checks = [];
for (const item of ownership) {
  const probe = `
    import { lookup } from 'node:dns/promises';
    import assert from 'node:assert/strict';
    const input=JSON.parse(process.argv[1]);
    await lookup(input.database);
    for (const name of input.forbidden) await assert.rejects(lookup(name), {code:'ENOTFOUND'});
    for (const url of input.http) assert.equal((await fetch(url,{signal:AbortSignal.timeout(4000)})).status,200);
    const dbs=Object.entries(process.env).filter(([key]) => /_DB$/.test(key)).map(([,uri])=>new URL(uri).hostname);
    assert.deepEqual(dbs,[input.database]);
    console.log(JSON.stringify({service:input.service,ownDatabase:input.database,unresolvable:input.forbidden,httpHealthy:input.http}));
  `;
  checks.push(JSON.parse(compose('exec', '-T', item.service, 'node', '--input-type=module', '-e', probe, JSON.stringify(item))));
}
assert.equal(checks.length,4);
const dest = fileURLToPath(new URL('../evidence/boundaries/', import.meta.url));
await mkdir(dest, { recursive: true });
await writeFile(dest + 'checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + '\n');
console.log('All four processes reached their own database and could not resolve the other domains’ storage.');
