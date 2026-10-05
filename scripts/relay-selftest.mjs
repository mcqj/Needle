// Proves the whole 1-z-2 loop against the relay's built-in echo, with nothing
// else consuming the inbox. Run it after changing anything about the
// integration:
//
//   node scripts/relay-selftest.mjs
//
// It exercises connectivity, credentials, publish, the contact flow, send,
// receive and provenance. It never throws; a failed step is reported in the
// checklist and the exit code is 1.
import { readFileSync } from 'node:fs';
import { RelayClient } from '../relay-client.js';

const HANDLE = 'jmq';
const RELAY_URL = 'https://relay.1-z-2.com';
const IDENTITY = new URL('../.relay-jmq.json', import.meta.url);

// Make sure the identity is in the store the SDK reads, without ever printing
// or shipping the key material.
async function ensureIdentity() {
  try {
    const credentials = JSON.parse(readFileSync(IDENTITY, 'utf8'));
    await RelayClient.importCredentials({ handle: credentials.handle || HANDLE, credentials });
    return true;
  } catch (error) {
    console.error(`Could not read the identity file at ${IDENTITY.pathname}: ${error.message}`);
    return false;
  }
}

if (!(await ensureIdentity())) {
  console.error('Place the handle\'s .relay-jmq.json beside package.json, then run this again.');
  process.exit(1);
}

console.log(`Running the 1-z-2 self-test for @${HANDLE} against ${RELAY_URL}\n`);

const relay = await RelayClient.connect({ handle: HANDLE, relayUrl: RELAY_URL });
const result = await relay.selfTest();

for (const step of result.steps) {
  console.log(`${step.ok ? 'PASS' : 'FAIL'}  ${step.step}${step.detail ? ` — ${step.detail}` : ''}`);
}

console.log(`\n${result.ok ? 'Self-test passed.' : 'Self-test FAILED.'}`);
process.exit(result.ok ? 0 : 1);
