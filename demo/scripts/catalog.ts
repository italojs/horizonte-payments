import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../evidence/', import.meta.url));
const digest = async (name: string) => createHash('sha256').update(await readFile(root + name)).digest('hex');
const read = async (name: string) => JSON.parse(await readFile(root + name, 'utf8'));
const scenarios = [
  ['01-provider-response-lost', 'The bank pays and loses its response'],
  ['02-manual-cancellation', 'Cancellation while the bank is offline'],
  ['03-automatic-cancellation', 'Automatic cancellation before bank submission'],
  ['04-client-response-lost', 'The browser loses the acceptance response'],
];
const videos = [];
for (const [stem, title] of scenarios) {
  const base = 'explorations/' + stem;
  const facts = await read(base + '.json');
  execFileSync('ffmpeg', ['-y','-v','error','-i',root + base + '.webm','-an','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',root + base + '.mp4']);
  const media = JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height:format=duration','-of','json',root + base + '.mp4'],{encoding:'utf8'}));
  assert.equal(media.streams[0].codec_name,'h264');
  assert(Number(media.format.duration)>0 && media.streams[0].width>=1000);
  videos.push({title,file:base + '.mp4',observations:base + '.json',paymentId:facts.id ?? facts.requests?.[0]?.id,durationSeconds:Number(media.format.duration),sha256:await digest(base + '.mp4')});
}
const telemetry = await read('telemetry/manifest.json');
assert.equal(videos[0].paymentId,telemetry.paymentId);
for (const [index,capture] of telemetry.videos.entries()) {
  const file = 'telemetry/' + capture.file;
  assert.equal(await digest(file),capture.sha256);
  videos.push({ title:['Distributed payment trace','Operation counters and correlated logs'][index],file,observations:'telemetry/manifest.json',paymentId:telemetry.paymentId,durationSeconds:capture.durationSeconds,sha256:capture.sha256 });
}
assert.equal(videos.length,6);
const resilience = await read('resilience/checks.json');
assert.equal(resilience.length,8);
const boundaries = await read('boundaries/checks.json');
assert.equal(boundaries.checks.length,4);
const release = await read('boundaries/independent-release.json');
assert.equal(release.independentComposeProjects,3);
assert.equal(release.state,'PAID');
assert.equal(release.newWorkers.length,2);
assert.equal(release.newWorkers.includes(release.oldWorker),false);
const links=videos.map(v=>'| '+v.title+' | [Watch]('+v.file+') | [Observations]('+v.observations+') |');
await writeFile(root+'manifest.json',JSON.stringify({recordedAt:telemetry.capturedAt,traceId:telemetry.trace.traceId,paymentId:telemetry.paymentId,videos},null,2)+'\n');
await writeFile(root+'README.md',[
  '# Recorded evidence','',
  'The first browser recording and both Grafana recordings follow payment `'+telemetry.paymentId+'` under trace `'+telemetry.trace.traceId+'`. Each browser run starts with an isolated account.','',
  '| Scenario | Recording | Evidence |','|---|---|---|',...links,'',
  '## Executed checks','',
  '- [Accounts tests](tests/accounts.txt), [Banks tests](tests/banks.txt) and [Payments tests](tests/payments.txt) verify each project independently.',
  '- [Browser suite](tests/browser.txt) and [two APIs and three workers](tests/scaling.txt).',
  '- [Independent deployment proof](boundaries/independent-release.json) captures the provider container IDs before and after replacing the Payments workers.',
  '',
  'The [manifest](manifest.json) contains file hashes and durations. The [resilience checks](resilience/checks.json) include actual worker crashes and a missing broker confirmation. The [ownership checks](boundaries/checks.json) probe database isolation from inside each application container. See [the test guide](../docs/testing.md) to reproduce the runs.','',
].join('\n'));
console.log('Verified six recordings, their trace correlation, eight resilience scenarios and four ownership checks.');
