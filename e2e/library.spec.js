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
