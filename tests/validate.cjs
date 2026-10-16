"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "data.json"), "utf8"));
assert.equal(data.version, 2);
assert.equal(data.chapters.length, 6);
assert.equal(new Set(data.chapters.map((c) => c.id)).size, 6);
for (const c of data.chapters) {
  assert.equal(c.grid.length, 7);
  c.grid.forEach((row) => assert.match(row, /^[#.sm]{7}$/));
  assert.equal(c.stars.length, 3);
  const objects = [
    c.start,
    c.exit,
    c.key,
    c.cache,
    ...c.stars.map((s) => s.at),
  ];
  assert.equal(
    new Set(objects).size,
    objects.length,
    `${c.id}: overlapping objects`,
  );
  objects.forEach((v) => {
    assert.ok(v >= 0 && v < 49);
    assert.equal(c.grid[Math.floor(v / 7)][v % 7], ".");
  });
  assert.ok(
    c.stars.every((s) => typeof s.text === "string" && s.text.length > 0),
  );
  assert.ok(fs.existsSync(path.join(root, c.photo)));
  // Explore the real state space: position, light, collected sparks, key, optional cache.
  const initial = [c.start, 0, 0, 0, 0],
    queue = [initial],
    seen = new Set([initial.join(",")]);
  let solved = false;
  for (let k = 0; k < queue.length; k++) {
    const [pos, phase, mask, key, cache] = queue[k];
    if (pos === c.exit && mask === 7 && key && cache) {
      solved = true;
      break;
    }
    const x = pos % 7,
      y = Math.floor(pos / 7);
    const next = [[pos, 1 - phase, mask, key, cache]];
    for (const [xx, yy] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (xx < 0 || xx >= 7 || yy < 0 || yy >= 7) continue;
      const tile = c.grid[yy][xx],
        target = yy * 7 + xx;
      if (
        tile === "#" ||
        (tile === "s" && phase !== 1) ||
        (tile === "m" && phase !== 0)
      )
        continue;
      const spark = c.stars.findIndex((s) => s.at === target);
      next.push([
        target,
        phase,
        spark < 0 ? mask : mask | (1 << spark),
        key || target === c.key ? 1 : 0,
        cache || target === c.cache ? 1 : 0,
      ]);
    }
    for (const s of next) {
      const id = s.join(",");
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(s);
      }
    }
  }
  assert.ok(solved, `${c.id}: all collectibles and exit must be reachable`);
  console.log(
    `PASS ${c.id}: solvable with all sparks, key, secret and light bridges`,
  );
}
Object.values(data.characters).forEach((src) =>
  assert.ok(fs.existsSync(path.join(root, src)), src),
);
console.log("PASS content, asset references and all six adventure scenarios");
