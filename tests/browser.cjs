"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data.json")));
const URL = process.env.TEST_URL || "http://127.0.0.1:8000";
const KEY = "nastya-letter-adventure-v2";
function route(c, start, phase, target) {
  const queue = [{ pos: start, phase, actions: [] }],
    seen = new Set([`${start}:${phase}`]);
  for (const node of queue) {
    if (node.pos === target) return node.actions;
    const x = node.pos % 7,
      y = Math.floor(node.pos / 7);
    const next = [
      {
        pos: node.pos,
        phase: node.phase === "sun" ? "moon" : "sun",
        action: "phase",
      },
    ];
    for (const [xx, yy] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (xx < 0 || xx > 6 || yy < 0 || yy > 6) continue;
      const t = c.grid[yy][xx],
        pos = yy * 7 + xx;
      if (
        t === "#" ||
        (t === "s" && node.phase !== "sun") ||
        (t === "m" && node.phase !== "moon")
      )
        continue;
      next.push({ pos, phase: node.phase, action: pos });
    }
    for (const n of next) {
      const k = `${n.pos}:${n.phase}`;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ ...n, actions: [...node.actions, n.action] });
    }
  }
  throw Error("Unreachable target");
}
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const get = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  await page.goto(URL);
  await page.waitForSelector("#start");
  await page.screenshot({ path: "/tmp/adventure-home.png", fullPage: true });
  await page.locator("#start").click();
  await page.waitForSelector("#board");
  assert.equal(await page.locator(".cell").count(), 49);
  const initial = await get();
  const far = data.chapters[0].exit;
  await page.locator(`[data-cell="${far}"]`).click();
  assert.equal((await get()).journeys.beauty.pos, 0, "no teleporting by click");
  await page.locator("#hint").click();
  assert.ok(
    (await page.locator(".hinted").count()) ||
      (await page.locator("#dialogue-text").textContent()).includes("свет"),
  );
  await page.screenshot({ path: "/tmp/adventure-game.png", fullPage: true });
  for (const [i, c] of data.chapters.entries()) {
    for (const target of [
      c.cache,
      ...c.stars.map((s) => s.at),
      c.key,
      c.exit,
    ]) {
      let state = await get();
      if (state.completed > i) break;
      const p = state.journeys[c.id];
      const actions = route(c, p.pos, p.phase, target);
      for (const action of actions) {
        if (action === "phase") await page.locator("#phase").click();
        else await page.locator(`[data-cell="${action}"]`).click();
      }
      if (i === 0 && target === c.cache) {
        const before = await get();
        await page.reload();
        await page.waitForSelector("#board");
        assert.deepEqual(
          (await get()).journeys.beauty,
          before.journeys.beauty,
          "partial resume",
        );
      }
    }
    assert.equal((await get()).completed, i + 1, `chapter ${i + 1} completion`);
    assert.equal((await get()).journeys[c.id].collected.length, 3);
    assert.equal((await get()).journeys[c.id].cache, true);
    await page.waitForSelector("#continue");
    await page.locator("#continue").click();
  }
  await page.waitForSelector(".finale");
  assert.equal(
    await page.locator(".finale h1").textContent(),
    data.finale.title,
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".finale img")].every(
      (i) => i.complete && i.naturalWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/adventure-finale.png", fullPage: true });
  await page.locator("#final-album").click();
  assert.equal(await page.locator(".album-card:not(.locked)").count(), 6);
  assert.equal(await page.locator(".secret-note").count(), 6);
  await page.locator('[data-tab="letter"]').first().click();
  assert.equal(await page.locator(".finale").count(), 1);
  await page.reload();
  await page.waitForSelector("#continue");
  assert.equal((await get()).completed, 6);
  await page.locator("#sound").click();
  assert.equal(
    await page.locator("#sound").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#settings").click();
  await page.locator("#reset").click();
  await page.locator("#cancel-reset").click();
  assert.equal((await get()).completed, 6);
  await page.locator("#settings").click();
  await page.locator("#reset").click();
  await page.locator("#confirm-reset").click();
  assert.equal((await get()).completed, 0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: "/tmp/adventure-mobile-home.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile home overflow",
  );
  await page.locator("#start").click();
  await page.screenshot({
    path: "/tmp/adventure-mobile-game.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile game overflow",
  );
  const c = data.chapters[0],
    p = (await get()).journeys[c.id];
  const first = route(c, p.pos, p.phase, c.stars[0].at)[0];
  await page.locator("#board").focus();
  if (first === "phase") {
    await page.keyboard.press("Space");
    assert.equal((await get()).journeys[c.id].phase, "sun");
  } else {
    const key = first === 1 ? "ArrowRight" : first === 7 ? "ArrowDown" : null;
    assert.ok(key);
    await page.keyboard.press(key);
    assert.equal((await get()).journeys[c.id].pos, first);
  }
  await page.locator('.mobile-nav [data-tab="route"]').click();
  assert.equal(await page.locator(".route-stop").count(), 6);
  assert.equal(await page.locator(".route-stop.locked").count(), 5);
  await page.locator('.mobile-nav [data-tab="album"]').click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile album overflow",
  );
  await page.locator('.mobile-nav [data-tab="letter"]').click();
  assert.equal(await page.locator(".unwritten").count(), 6);
  assert.equal(await page.locator(".finale").count(), 0, "final locked");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('.mobile-nav [data-tab="adventure"]').click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "320px overflow",
  );
  // A successfully installed service worker must restore the app offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector("#board");
  assert.equal(await page.locator(".cell").count(), 49, "offline restore");
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  const errorContext = await browser.newContext({ serviceWorkers: "block" });
  const errorPage = await errorContext.newPage();
  await errorPage.route("**/data.json", (r) => r.abort());
  await errorPage.goto(URL);
  await errorPage.waitForSelector("#retry");
  assert.ok(await errorPage.locator(".error-state").count());
  await errorContext.close();
  const storageContext = await browser.newContext({ serviceWorkers: "block" });
  await storageContext.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  const storagePage = await storageContext.newPage();
  await storagePage.goto(URL);
  await storagePage.waitForSelector("#start");
  assert.ok(
    (await storagePage.locator("#save-status").textContent()).includes(
      "не разрешил",
    ),
  );
  await storagePage.locator("#start").click();
  await storagePage.waitForSelector("#board");
  await storageContext.close();
  await page.evaluate((key) => localStorage.setItem(key, "invalid"), KEY);
  await page.reload();
  await page.waitForSelector("#start");
  assert.equal((await get()).completed, 0, "bad save recovery");
  console.log(
    "PASS: all six chapters via the one movement engine, secrets, final gate, album, light changes, keyboard, resume, reset/cancel, sound, 320/375px layouts, offline, blocked storage and network errors. No page errors.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
