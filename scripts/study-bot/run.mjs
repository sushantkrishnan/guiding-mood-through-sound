#!/usr/bin/env node
/**
 * Synthetic participants for the study harness: drives real sessions in a
 * headless browser, with random answers, and saves the logs they download.
 * The point is to test the whole pipeline (harness → logs → analysis)
 * before a real participant sits down. The answers mean nothing.
 *
 *   pnpm build && pnpm preview            # in one terminal
 *   node scripts/study-bot/run.mjs        # in another
 *   python3 scripts/analysis/analyse.py .cache/bot-logs
 *
 * Environment:
 *   BASE_URL      site to test            (http://localhost:4321/)
 *   PARTICIPANTS  how many                (4)
 *   MINUTES       listening per session   (0.5)
 *   CONDITIONS    comma-separated labels  (Guided,Direct target)
 *   OUT           where logs are saved    (.cache/bot-logs)
 *   CHROME_PATH   a Chrome/Chromium binary; otherwise installed Google Chrome
 *   SEED          random seed             (1)
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321/';
const PARTICIPANTS = Number(process.env.PARTICIPANTS ?? 4);
const MINUTES = process.env.MINUTES ?? '0.5';
const CONDITIONS = (process.env.CONDITIONS ?? 'Guided,Direct target')
  .split(',')
  .map(s => s.trim());
const OUT = resolve(process.env.OUT ?? '.cache/bot-logs');

let seed = Number(process.env.SEED ?? 1);
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
const clamp = n => Math.min(9, Math.max(1, Math.round(n)));

async function launch() {
  const args = ['--autoplay-policy=no-user-gesture-required'];

  if (process.env.CHROME_PATH)
    return chromium.launch({ args, executablePath: process.env.CHROME_PATH });

  try {
    return await chromium.launch({ args, channel: 'chrome' });
  } catch {
    return chromium.launch({ args });
  }
}

async function participant(browser, number) {
  const id = `BOT${String(number).padStart(2, '0')}`;
  // one context per participant: their sessions share its IndexedDB, as
  // they would share a lab machine's browser
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const cell = (p, a) =>
    page.getByLabel(
      new RegExp(`^Pleasantness ${clamp(p)} of 9, arousal ${clamp(a)} of 9`),
    );
  const saved = [];

  try {
    for (let session = 1; session <= CONDITIONS.length; session++) {
      saved.push(await runSession(page, id, session, cell));
    }
  } catch (error) {
    const shot = join(OUT, `error-${id}.png`);
    await page.screenshot({ fullPage: true, path: shot });
    console.error(`${id} failed; screenshot at ${shot}`);
    throw error;
  } finally {
    await context.close();
  }

  return saved;
}

async function runSession(page, id, session, cell) {
  {
    await page.goto(`${BASE}?study`, { waitUntil: 'networkidle' });
    await page.getByLabel('Participant ID').fill(id);
    await page.getByLabel('Session', { exact: true }).fill(String(session));

    for (const box of await page
      .locator('fieldset')
      .first()
      .getByRole('checkbox')
      .all()) {
      const label =
        (await box.evaluate(el => el.parentElement.textContent)) ?? '';
      const wanted = CONDITIONS.some(c => label.startsWith(c));
      if ((await box.isChecked()) !== wanted) await box.click();
    }

    await page.getByLabel('Listening time (min)').fill(MINUTES);
    await page.getByLabel('Listen before rating (s)').fill('1');
    await page
      .getByRole('button', { name: 'Start participant session' })
      .click();

    // tense start, calm target: the task the study is built around
    const pre = [between(1, 4), between(6, 9)];
    await page.getByRole('button', { name: 'Begin' }).click();
    await cell(...pre).click();
    await page.getByRole('button', { name: 'Next' }).click();

    if (await page.getByText('How would you like to feel?').isVisible())
      await cell(between(6, 9), between(1, 4)).click();
    await page.getByRole('button', { name: 'Start listening' }).click();

    const unguided = page.getByText('You choose the sounds this time');
    const guided = page.getByText('Just listen.');
    await Promise.race([
      unguided.waitFor({ timeout: 60_000 }),
      guided.waitFor({ timeout: 60_000 }),
    ]);

    if (await unguided.isVisible()) {
      for (const name of ['Light Rain', 'Waves', 'Campfire']) {
        if (random() < 0.7)
          await page.getByLabel(`${name} sound`, { exact: true }).click();
      }
    }

    // answer check-ins until listening ends
    const over = page.getByText('The listening part is over.');
    let step = 0;
    while (!(await over.isVisible())) {
      const probe = page.getByRole('dialog');
      if (await probe.isVisible()) {
        step++;
        await probe
          .getByLabel(
            new RegExp(
              `^Pleasantness ${clamp(pre[0] + step * 1.5 + random() * 2 - 1)} of 9, arousal ${clamp(pre[1] - step * 1.5 + random() * 2 - 1)} of 9`,
            ),
          )
          .click();
        await probe.getByRole('button', { name: 'Continue listening' }).click();
      }
      await page.waitForTimeout(250);
    }

    await cell(between(5, 8), between(2, 5)).click();
    await page.getByRole('button', { name: 'Next' }).click();

    const plots = page.locator('[class*="curvePlot"]');
    if (await plots.count()) {
      for (let k = 0; k < 2; k++) {
        const box = await plots.nth(k).boundingBox();
        let y = box.y + box.height * (k === 0 ? 0.7 : 0.2);
        await page.mouse.move(box.x + 1, y);
        await page.mouse.down();
        for (let s = 1; s <= 12; s++) {
          y += (k === 0 ? -1 : 1) * box.height * 0.04 + (random() - 0.5) * 12;
          await page.mouse.move(box.x + (box.width * s) / 12 - 1, y);
        }
        await page.mouse.up();
      }
      await page.getByRole('button', { name: 'Next' }).click();
    }

    for (const name of [
      'pleasantness',
      'coherence',
      'monotony',
      'effectiveness',
      'direction',
    ]) {
      await page
        .locator(`input[name="${name}"][value="${between(2, 7)}"]`)
        .check({ force: true });
    }
    const wrong = random() < 0.2;
    await page.getByLabel(wrong ? 'Yes' : 'No', { exact: true }).check();
    if (wrong)
      await page
        .getByPlaceholder('What did you hear, and roughly when?')
        .fill('A sound came in suddenly near the end.');

    const preference = page.locator('input[name="preferredSession"]');
    if (await preference.count())
      await preference.nth(between(0, (await preference.count()) - 1)).check();

    const download = page.waitForEvent('download', { timeout: 300_000 });
    await page.getByRole('button', { name: 'Submit' }).click();

    if (
      await page
        .getByText('One last part')
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    ) {
      await page.getByRole('button', { name: 'Start' }).click();
      for (;;) {
        await page.getByText(/^Sound \d+ of \d+$/).waitFor({ timeout: 60_000 });
        await cell(between(3, 8), between(2, 7)).click();
        const next = page.getByRole('button', { name: /Next sound|Finish/ });
        await page.waitForFunction(() =>
          [...document.querySelectorAll('button')].some(
            b => /Next sound|Finish/.test(b.textContent ?? '') && !b.disabled,
          ),
        );
        const label = await next.textContent();
        await next.click();
        if (label?.includes('Finish')) break;
      }
    }

    const file = await download;
    const path = join(OUT, file.suggestedFilename());
    await file.saveAs(path);
    console.log(`${id} session ${session} → ${path}`);

    return path;
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await launch();

try {
  const numbers = Array.from({ length: PARTICIPANTS }, (_, i) => i + 1);
  await Promise.all(numbers.map(n => participant(browser, n)));
} finally {
  await browser.close();
}
