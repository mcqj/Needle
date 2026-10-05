import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('adds music and opens its detail view', async ({ page }) => {
  await page.getByRole('button', { name: 'Add your first listen' }).click();
  await page.getByLabel('Music URL').fill('https://youtu.be/abc123');
  await page.getByLabel('Title').fill('Midnight Test Pressing');
  await page.getByLabel('Artist').fill('The Fixtures');
  await page.getByLabel('Category').fill('Late night');
  await page.getByLabel('Review (optional)').fill('A slow burn with a brilliant final minute.');
  await page.getByRole('button', { name: 'Add to ledger' }).click();

  await expect(page.getByRole('heading', { name: 'Midnight Test Pressing' })).toBeVisible();
  await page.getByRole('link', { name: 'View Midnight Test Pressing by The Fixtures' }).click();

  await expect(page.getByRole('heading', { name: 'Midnight Test Pressing' })).toBeVisible();
  await expect(page.getByText('A slow burn with a brilliant final minute.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Listen on YouTube' })).toBeVisible();
});

test('keeps the entry workflow usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add music' }).click();
  await expect(page.getByRole('heading', { name: 'Add to your ledger', exact: true })).toBeVisible();
  await expect(page.getByLabel('Music URL')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to ledger' })).toBeVisible();
});

test('switches to dark mode and remembers the preference', async ({ page }) => {
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark');
});

test('provides a useful recovery page for unknown routes', async ({ page }) => {
  await page.goto('/music-that-is-not-here');

  await expect(page.getByRole('heading', { name: 'That route missed the groove.' })).toBeVisible();
  await expect(page.getByText('Your saved music is still where you left it.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to the ledger' }).click();
  await expect(page.getByRole('heading', { name: 'Listening ledger' })).toBeVisible();
});

test('keeps retrying a flaky artwork URL instead of reporting it broken', async ({ page }) => {
  test.setTimeout(60_000);

  // A refused image is often temporary, so the app tries again on a backoff
  // rather than declaring the artwork missing. It asks for it more than once,
  // bypassing any refusal the browser cached.
  const attempts = [];
  await page.route('**/flaky-artwork.example/**', (route) => {
    attempts.push(route.request().url());
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' });
  });

  await page.evaluate(() => {
    localStorage.setItem('needle-library', JSON.stringify([{
      id: 'flaky-art',
      url: 'https://example.com/a',
      title: 'Flaky Artwork Song',
      artist: 'Nobody',
      category: 'Unsorted',
      rating: 0,
      review: '',
      imageUrl: 'https://flaky-artwork.example/cover.jpg',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }]));
  });
  await page.reload();

  // Nothing is announced as broken while the attempts are still running.
  await expect(page.getByRole('heading', { name: 'Flaky Artwork Song' })).toBeVisible();
  await expect(page.getByText('No artwork')).toHaveCount(0);

  // The first automatic retry comes due after about two seconds.
  await expect.poll(() => attempts.length, { timeout: 15_000 }).toBeGreaterThan(1);
  expect(attempts[1]).toContain('needle-retry=1');
});

test('falls back gracefully when a saved artwork URL stops working', async ({ page }) => {
  // The retries deliberately run their full course first (see RETRY_DELAYS_MS),
  // so this test outlasts the default timeout.
  test.setTimeout(150_000);

  // A host that does not resolve: every attempt fails at once, so the tile
  // appears only after the last retry.
  await page.evaluate(() => {
    localStorage.setItem('needle-library', JSON.stringify([{
      id: 'broken-art',
      url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      title: 'Deleted Video Song',
      artist: 'Nobody',
      category: 'Unsorted',
      rating: 0,
      review: '',
      imageUrl: 'https://no-such-artwork-host.invalid/cover.jpg',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }]));
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Deleted Video Song' })).toBeVisible();
  await expect(page.getByText('No artwork')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.track-row img')).toHaveCount(0);

  // And the entry stays editable, so the URL can be replaced. The detail page
  // runs its own retry cycle, which has to finish before it offers the button.
  await page.getByRole('link', { name: 'View Deleted Video Song by Nobody' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Try loading the artwork/ }))
    .toBeVisible({ timeout: 120_000 });
});

