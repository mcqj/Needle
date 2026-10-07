import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * The identity file is a secret in the project directory. The dev server hands
 * it to the app on first run; a preview server has no such endpoint, so the
 * test seeds the same store the SDK would have written itself.
 */
const IDENTITY = new URL('../.relay-jmq.json', import.meta.url);
const credentials = existsSync(IDENTITY)
  ? JSON.parse(readFileSync(IDENTITY, 'utf8'))
  : null;

/**
 * The handle comes out of the identity file rather than being written here, so
 * this test follows the same rule as the app: nothing assumes who it is.
 */
const handle = credentials?.handle
  ?? IDENTITY.pathname.match(/\.relay-([a-z0-9-]+)\.json$/)?.[1]
  ?? null;

async function seedIdentity(page) {
  if (!credentials || !handle) return;
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [`relay:${handle}`, credentials]);
}

test.describe('listening circle', () => {
  test.beforeEach(async ({ page }) => {
    if (credentials) await seedIdentity(page);
    await page.goto('/friends');
  });

  test('opens the friends area with all five parts', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Listening circle' })).toBeVisible();
    for (const label of ['Sharing with', 'Shared with me', 'Conversation', 'Updates']) {
      await expect(page.getByRole('tab', { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Ask to connect' })).toBeVisible();
    await expect(page.getByRole('switch', { name: /friends of friends/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Import identity file/ })).toHaveCount(0);
  });

  test('reaches the relay and reports the connection', async ({ page }) => {
    test.skip(!credentials, 'no identity file in this checkout');
    await expect(page.getByText(`Connected as @${handle}`, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(new RegExp(`Connected as @${handle} · app`))).toBeVisible();
  });

  test('sends a listen without blocking the ledger', async ({ page }) => {
    test.skip(!credentials, 'no identity file in this checkout');
    await page.getByRole('link', { name: 'Ledger' }).click();
    await page.getByRole('button', { name: 'Add your first listen' }).click();
    await page.getByLabel('Music URL').fill('https://youtu.be/abc123');
    await page.getByLabel('Title').fill('Circle Test Pressing');
    await page.getByLabel('Artist').fill('The Fixtures');
    await page.getByRole('button', { name: 'Add to ledger' }).click();

    await page.getByRole('button', { name: 'Send', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Send this listen' })).toBeVisible();
    await page.getByLabel('Or type a handle').fill('@relay-echo');
    await page.getByRole('button', { name: 'Send', exact: true }).last().click();

    // The dialog closes straight away: sending never blocks the interface.
    await expect(page.getByRole('heading', { name: 'Send this listen' })).toHaveCount(0);
    // Progress shows on the item itself, and the ledger stays usable meanwhile.
    await expect(page.locator('.send-status')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /View Circle Test Pressing/ })).toBeVisible();
    // The relay's echo consents automatically, so this finishes on its own.
    await expect(page.locator('.send-status')).toContainText('Sent to @relay-echo', { timeout: 120_000 });
  });

  test('opens every section without breaking the app', async ({ page }) => {
    const sections = [
      ['sharing', /Ask someone to connect/],
      ['received', /Nothing shared with you yet|Shared with me/],
      ['conversation', /No one to talk to yet|Conversation lives in another app/],
      ['updates', /Nothing yet|Checking what your friends/],
    ];
    for (const [tab, expected] of sections) {
      // Section links are shareable, so each one is reached by URL here.
      await page.goto(`/friends?tab=${tab}`);
      await expect(page.locator('.friends-body')).toBeVisible();
      await expect(page.getByText('The needle slipped.')).toHaveCount(0);
      await expect(page.locator('.friends-body')).toContainText(expected, { timeout: 30_000 });
    }
  });

  test('keeps received listens out of the ledger', async ({ page }) => {
    await page.getByRole('tab', { name: /Shared with me/ }).click();
    await expect(page.getByRole('heading', { name: /Nothing shared with you yet/ })).toBeVisible();
    await page.getByRole('link', { name: 'Ledger' }).click();
    // Other people's listens must never touch the user's own count.
    await expect(page.locator('.collection-count strong')).toHaveText('00');
  });

  test('surfaces a received listen with its sender, and still keeps it separate', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('needle-received-listens', JSON.stringify([{
        id: 'e2e-received',
        from: 'sam',
        receivedAt: new Date().toISOString(),
        seen: false,
        provenance: { kind: 'plain', messageId: 'e2e-received' },
        track: { title: 'A Friend’s Record', artist: 'Someone Else', url: 'https://example.com/x' },
      }]));
    });
    await page.goto('/friends?tab=received');

    await expect(page.getByRole('heading', { name: 'A Friend’s Record' })).toBeVisible();
    await expect(page.getByText('from @sam')).toBeVisible();
    // Provenance: separated, attributed, and not yet part of the user's data.
    await expect(page.getByRole('button', { name: /Add to my ledger/ })).toBeVisible();

    // It survives a reload: the relay does not keep received copies for us.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'A Friend’s Record' })).toBeVisible();

    await page.getByRole('link', { name: 'Ledger' }).click();
    await expect(page.locator('.collection-count strong')).toHaveText('00');
  });

  test('adds a received listen to the ledger only when asked', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('needle-received-listens', JSON.stringify([{
        id: 'e2e-import',
        from: 'sam',
        receivedAt: new Date().toISOString(),
        seen: true,
        provenance: { kind: 'translated', messageId: 'e2e-import', badge: 'translated from "album-pick"', dropped: ['mood'], assumed: [] },
        track: { title: 'Imported Record', artist: 'Someone Else', url: 'https://example.com/y' },
      }]));
    });
    await page.goto('/friends?tab=received');
    await expect(page.getByText('translated from "album-pick"')).toBeVisible();

    await page.getByRole('button', { name: /Add to my ledger/ }).click();
    await expect(page.getByText(/In your ledger, marked as from @sam/)).toBeVisible();

    // Now, and only now, it counts as one of the user's own listens.
    await page.getByRole('link', { name: 'Ledger' }).click();
    await expect(page.locator('.collection-count strong')).toHaveText('01');
    await expect(page.getByText('from @sam')).toBeVisible();
  });

  test('answers "did they get it?" from the sent list, after a reload', async ({ page }) => {
    // A send finishes in the background, long after its card is gone, so the
    // outcome has to survive a reload to be worth anything.
    await page.evaluate(() => {
      window.localStorage.setItem('needle-sent-listens', JSON.stringify([{
        idempotencyKey: 'e2e-sent',
        handle: 'alpha01',
        sentAt: new Date().toISOString(),
        status: 'sent',
        arrivedAs: 'song-pick',
        track: { title: 'Sent And Delivered', artist: 'The Fixtures', url: 'https://example.com/z' },
      }]));
    });
    await page.goto('/friends?tab=received');
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible();
    await expect(page.getByText('Sent And Delivered')).toBeVisible();
    // The recipient app's own name for the item: proof the translation compiled.
    await expect(page.getByText('to @alpha01 · arrives as “song-pick”')).toBeVisible();
  });

  test('keeps the relay self-test’s traffic out of the inbox', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('needle-received-listens', JSON.stringify([{
        id: 'e2e-echo',
        from: 'relay-echo',
        receivedAt: new Date().toISOString(),
        unknownType: 'selftest-ping',
        payload: { ping: 'selftest-e2e' },
        provenance: {
          kind: 'untranslated',
          messageId: 'e2e-echo',
          note: 'not in any app’s shape',
          failure: 'no compiled transform',
          page: null,
        },
      }]));
    });
    await page.goto('/friends?tab=received');

    // Not presented as a person's message.
    await expect(page.getByText('Something Needle can’t read yet')).toHaveCount(0);
    await expect(page.getByText(/Nothing from a person yet/)).toBeVisible();

    // But not hidden either: it is folded away and named for what it is.
    await page.getByRole('button', { name: /Show 1 integration test message/ }).click();
    await expect(page.getByText(/"ping": "selftest-e2e"/)).toBeVisible();
  });
});
