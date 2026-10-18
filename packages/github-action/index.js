'use strict';

// Zero dependencies on purpose: the action runs straight from the repository, no build step.
const fs = require('node:fs');

const input = (name) => (process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function fail(message) {
  console.log(`::error::${message}`);
  process.exitCode = 1;
}

async function run() {
  const apiKey = input('api-key');
  if (!apiKey) return fail('api-key is required');
  console.log(`::add-mask::${apiKey}`);

  const to = input('to').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (to.length === 0) return fail('to is required');

  const body = { to: to.length === 1 ? to[0] : to };
  const fields = { from: 'from', fromName: 'from-name', subject: 'subject', html: 'html', text: 'text', templateId: 'template-id', replyTo: 'reply-to' };
  for (const [key, name] of Object.entries(fields)) if (input(name)) body[key] = input(name);
  if (!body.html && !body.text && !body.templateId) return fail('Provide html, text or template-id');
  if (input('variables')) {
    try {
      body.variables = JSON.parse(input('variables'));
    } catch {
      return fail('variables must be a JSON object');
    }
  }

  // A re-run of the same job must not mail everyone twice.
  const runKey = process.env.GITHUB_RUN_ID ? `gh-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-${process.env.GITHUB_JOB ?? ''}` : '';
  const idempotencyKey = input('idempotency-key') || runKey;

  const url = `${(input('api-url') || 'https://api.volanea.com').replace(/\/+$/, '')}/v1/send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'volanea-github-action/1.0',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return fail(`Volanea answered ${res.status}: ${json.error ?? 'request failed'}`);

  const messages = json.data?.messages ?? [];
  const ids = messages.map((m) => m.id).filter(Boolean);
  for (const m of messages) console.log(m.id ? `queued ${m.id} → ${m.to}` : `skipped ${m.to}: ${m.skipped}`);
  if (ids.length === 0) return fail('Every recipient was skipped (suppressed, unsubscribed or over a limit).');
  setOutput('email-id', ids[0]);
  setOutput('email-ids', JSON.stringify(ids));
}

run().catch((err) => fail(err.message));
