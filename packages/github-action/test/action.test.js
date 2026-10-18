'use strict';

/**
 * Runs index.js the way the Actions runner does (INPUT_* env vars, GITHUB_OUTPUT file):
 *
 *   VOLANEA_API_URL=http://localhost:4197 VOLANEA_KEY=sk_… FROM=hi@your-verified.domain npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEY = process.env.VOLANEA_KEY;
const live = { skip: !KEY && 'set VOLANEA_KEY (and VOLANEA_API_URL) to run against an API' };

function runAction(inputs, extraEnv = {}) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gha-')), 'output');
  fs.writeFileSync(out, '');
  const env = { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...extraEnv };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [path.join(__dirname, '..', 'index.js')], { env, encoding: 'utf8' });
  } catch (err) {
    stdout = err.stdout;
    code = err.status;
  }
  // the runner treats a non-zero exitCode as failure; index.js sets it instead of throwing
  const outputs = Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { stdout, code, outputs };
}

const base = () => ({ 'api-key': KEY, 'api-url': process.env.VOLANEA_API_URL || 'https://api.volanea.com', from: process.env.FROM || 'hi@lab.test' });

test('missing inputs fail with a readable error and send nothing', () => {
  const r = runAction({ 'api-key': 'sk_x', to: 'a@example.com', 'api-url': 'http://127.0.0.1:9' });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /::error::Provide html, text or template-id/);
  assert.match(r.stdout, /::add-mask::sk_x/);
});

test('sends to several recipients and writes outputs', live, () => {
  const r = runAction({ ...base(), to: 'ci-a@example.com,\nci-b@example.com', subject: 'Release {{version}}', html: '<p>v{{version}} is out</p>', variables: '{"version":"1.4.0"}' });
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.outputs['email-id'], /^email-/);
  assert.equal(JSON.parse(r.outputs['email-ids']).length, 2);
});

test('a re-run of the same job does not send twice', live, () => {
  const env = { GITHUB_RUN_ID: String(Date.now()), GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'notify' };
  const first = runAction({ ...base(), to: 'ci-rerun@example.com', subject: 'Deploy done', text: 'ok' }, env);
  const again = runAction({ ...base(), to: 'ci-rerun@example.com', subject: 'Deploy done', text: 'ok' }, env);
  assert.equal(first.code, 0, first.stdout);
  assert.equal(again.outputs['email-id'], first.outputs['email-id']);
});

test('an API rejection fails the step with the reason', live, () => {
  const r = runAction({ ...base(), from: 'x@unverified.invalid', to: 'ci@example.com', subject: 's', text: 't' });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /::error::Volanea answered 4\d\d: .*not verified/);
});
