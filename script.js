"use strict";

// One adventure engine. Chapters change the scenery, map and letter fragments,
// never the controls or rules. All personal content is kept in data.json.
const $ = (s, root = document) => root.querySelector(s);
const KEY = "nastya-letter-adventure-v2";
const main = $("#main");
const modal = $("#modal");
let data,
  state,
  activeTab = "adventure",
  audio,
  toastTimer,
  hintCell = -1;
let suppressClickUntil = 0;
const freshState = () => ({
  version: 2,
  started: false,
  chapter: 0,
  completed: 0,
  journeys: {},
  sound: false,
  souvenirs: [],
});
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const current = () => data.chapters[state.chapter];
const tile = (chapter, pos) => chapter.grid[Math.floor(pos / 7)]?.[pos % 7];
const neighbors = (pos) =>
  [
    pos % 7 > 0 ? pos - 1 : -1,
    pos % 7 < 6 ? pos + 1 : -1,
    pos >= 7 ? pos - 7 : -1,
    pos < 42 ? pos + 7 : -1,
  ].filter((x) => x >= 0);
const passable = (chapter, pos, phase) =>
  tile(chapter, pos) !== "#" &&
  (tile(chapter, pos) !== "s" || phase === "sun") &&
  (tile(chapter, pos) !== "m" || phase === "moon");

function progress(chapter = current()) {
  return (state.journeys[chapter.id] ||= {
    pos: chapter.start,
    collected: [],
    key: false,
    cache: false,
    phase: "moon",
    moves: 0,
  });
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    $("#save-status").textContent = data.ui.storageError;
  }
}
function load() {
  state = freshState();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved?.version === 2) {
      state.started = saved.started === true;
      state.completed = Number.isInteger(saved.completed)
        ? Math.max(0, Math.min(6, saved.completed))
        : 0;
      state.chapter = Number.isInteger(saved.chapter)
        ? Math.max(0, Math.min(5, state.completed, saved.chapter))
        : 0;
      state.sound = saved.sound === true;
      state.souvenirs = Array.isArray(saved.souvenirs)
        ? saved.souvenirs.filter((id) => data.chapters.some((c) => c.id === id))
        : [];
      for (const c of data.chapters) {
        const p = saved.journeys?.[c.id];
        if (!p || typeof p !== "object") continue;
        state.journeys[c.id] = {
          pos:
            Number.isInteger(p.pos) &&
            p.pos >= 0 &&
            p.pos < 49 &&
            tile(c, p.pos) !== "#"
              ? p.pos
              : c.start,
          collected: [
            ...new Set(Array.isArray(p.collected) ? p.collected : []),
          ].filter((v) => c.stars.some((s) => s.at === v)),
          key: p.key === true,
          cache: p.cache === true,
          phase: p.phase === "sun" ? "sun" : "moon",
          moves: Number.isInteger(p.moves) && p.moves >= 0 ? p.moves : 0,
        };
      }
    } else {
      // Preserve keepsakes from both earlier site versions without skipping the new story.
      for (const key of ["nastya-universe-v1", "nastya_universe_v1"]) {
        try {
          const old = JSON.parse(localStorage.getItem(key) || "null");
          const ids = old?.completed || old?.done;
          if (Array.isArray(ids))
            state.souvenirs.push(
              ...ids.filter((id) => data.chapters.some((c) => c.id === id)),
            );
        } catch {
          /* A damaged old save must not block play. */
        }
      }
      state.souvenirs = [...new Set(state.souvenirs)];
    }
  } catch {
    /* A blocked or invalid storage falls back to an in-memory adventure. */
  }
}
function notify(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function tone(success = true) {
  if (!state.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume().catch(() => {});
    [0, 0.13, 0.26].forEach((delay, i) => {
      const oscillator = audio.createOscillator(),
        gain = audio.createGain(),
        t = audio.currentTime + delay;
      oscillator.type = "sine";
      oscillator.frequency.value = (success ? 440 : 220) * [1, 1.25, 1.5][i];
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.035, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(t);
      oscillator.stop(t + 0.4);
    });
  } catch {
    notify("Звук недоступен в этом браузере. Путешествие продолжается.");
  }
}
function burst() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < 16; i++) {
    const e = document.createElement("span");
    e.className = "particle";
    e.textContent = i % 2 ? "♡" : "✦";
    e.style.left = `${20 + Math.random() * 60}%`;
    e.style.top = `${40 + Math.random() * 40}%`;
    e.style.animationDelay = `${Math.random() * 0.3}s`;
    document.body.append(e);
    setTimeout(() => e.remove(), 2700);
  }
}
function updateShell() {
  document.querySelectorAll("[data-tab]").forEach((b) => {
    if (b.dataset.tab === activeTab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("#album-count").textContent = Object.values(state.journeys).reduce(
    (n, p) => n + p.collected.length,
    0,
  );
  $("#letter-count").textContent = `${state.completed}/6`;
  $("#sound").setAttribute("aria-pressed", String(state.sound));
  $("#sound").setAttribute(
    "aria-label",
    state.sound ? "Выключить звук" : "Включить звук",
  );
}
function navigate(tab, focus = true) {
  activeTab = tab;
  hintCell = -1;
  updateShell();
  ({
    adventure: renderAdventure,
    route: renderRoute,
    album: renderAlbum,
    letter: renderLetter,
  })[tab]();
  if (focus) {
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}
const heading = (eyebrow, title, subtitle) =>
  `<div class="page-heading"><span class="eyebrow">${esc(eyebrow)}</span><h1>${title}</h1><p>${esc(subtitle)}</p></div>`;
function renderAdventure() {
  if (!state.started) {
    renderWelcome();
    return;
  }
  if (state.chapter < state.completed) {
    renderChapterEnd();
    return;
  }
  const c = current(),
    p = progress();
  save();
  main.innerHTML = `<div class="chapter-header"><div><span class="eyebrow">ПИСЬМО ЧЕРЕЗ ВСЕЛЕННУЮ · ГЛАВА ${state.chapter + 1} / 6</span><h1>${esc(c.title)}</h1></div><span class="chapter-theme">${esc(c.theme)}</span></div>
  <div class="game-layout"><section class="game-stage" style="--chapter-color:${c.color}" aria-label="Звёздные дорожки"><div class="stage-top"><span class="stage-label">✦ НАША МАЛЕНЬКАЯ ВСЕЛЕННАЯ</span><span id="move-count"></span></div><div class="board-wrap"><div class="board-orbit" aria-hidden="true"></div><div class="board" id="board" role="group" aria-label="Карта. Стрелки или WASD — шаг, пробел — сменить свет." tabindex="0"></div></div><div class="stage-bottom"><span>♡ Настя <small>и один важный кот</small></span><button id="phase" class="phase-button"></button></div></section>
  <aside class="quest-panel"><div class="quest-heading"><span class="eyebrow">ТВОЯ ИСТОРИЯ</span><span>✉</span></div><h2>Собери страницу письма</h2><p>Искры хранят слова Саши. Ключ откроет портал в следующую главу.</p><div class="quest-list"><div><span>✦ Три искры</span><b id="spark-count"></b></div><div><span>⚿ Ключ от портала</span><b id="key-count"></b></div><div><span>♡ Тайник для любопытных</span><b id="cache-count"></b></div></div><div class="dialogue"><img src="${data.characters.sasha}" alt="Саша"><div><strong>Саша <span>тебе</span></strong><p id="dialogue-text" role="status" aria-live="polite">${esc(c.intro)}</p></div></div><button id="hint" class="cat-hint"><img src="${data.characters.cat}" alt="">Кот, покажи дорогу <span>→</span></button><div class="game-controls"><div class="dpad" aria-label="Управление движением"><button data-dir="up" aria-label="Шаг вверх">↑</button><button data-dir="left" aria-label="Шаг влево">←</button><button data-dir="down" aria-label="Шаг вниз">↓</button><button data-dir="right" aria-label="Шаг вправо">→</button></div><small>Соседняя клетка, свайп<br>или стрелки на клавиатуре</small></div></aside></div><div class="legend"><span><i class="legend-star">✦</i> Искра письма</span><span>⚿ Ключ</span><span>◎ Портал</span><span>☀ / ☾ Мосты меняются со светом</span></div><div class="journey-strip">${data.chapters.map((x, i) => `<span class="${i === state.chapter ? "current" : i < state.completed ? "done" : ""}"><i>${i < state.completed ? "✓" : String(i + 1).padStart(2, "0")}</i>${esc(x.theme)}</span>`).join("")}</div>`;
  renderBoard();
  $("#phase").onclick = togglePhase;
  $("#hint").onclick = showHint;
  document
    .querySelectorAll("[data-dir]")
    .forEach((b) => (b.onclick = () => direction(b.dataset.dir)));
  const board = $("#board");
  let pointer;
  board.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") pointer = { x: e.clientX, y: e.clientY };
  });
  board.addEventListener("pointercancel", () => (pointer = null));
  board.addEventListener("pointerup", (e) => {
    if (!pointer) return;
    const dx = e.clientX - pointer.x,
      dy = e.clientY - pointer.y;
    pointer = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    suppressClickUntil = Date.now() + 400;
    direction(
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up",
    );
  });
}
function renderWelcome() {
  main.innerHTML = `<section class="welcome"><div class="welcome-copy"><span class="eyebrow"><i class="tiny-star">✦</i> ОДНО ПРИКЛЮЧЕНИЕ. ТОЛЬКО ДЛЯ ТЕБЯ.</span><h1>Ты — моя<br><em>вселенная.</em></h1><p>Настя, мне хотелось подарить тебе целый мир.<br>Поэтому я спрятал в нём письмо — о тебе, о нас<br class="desktop-br"> и обо всём, что делает меня счастливым.</p><button id="start" class="primary">Отправиться за письмом <span>→</span></button><div class="welcome-meta"><span>✧ Шесть глав одной истории</span><span>♡ В своём темпе</span></div></div><div class="welcome-art"><img src="${data.characters.couple}" alt="Сказочные Настя, Саша и их серый кот"><span class="art-caption">Моя любимая команда ♡</span><div class="floating-note">Для тебя, Настя.<br><em>С обожанием, Саша</em></div></div></section><section class="intro-cards"><article><span>01 / ИССЛЕДУЙ</span><h3>Следуй за звёздами</h3><p>Проведи Настю по дорожкам вместе с котом. Управление одинаковое всю историю.</p></article><article><span>02 / ОТКРЫВАЙ</span><h3>Собирай маленькие чудеса</h3><p>Меняй свет, находи искры и ключи. Каждая находка — ещё одна причина обожать тебя.</p></article><article><span>03 / СОХРАНЯЙ</span><h3>Пусть это останется с нами</h3><p>Слова и воспоминания попадут в альбом. А в конце тебя ждёт кое-что особенное.</p></article></section><div class="welcome-bottom"><img src="${data.characters.cat}" alt="Серый кот"><p>«Я уже проверил маршрут. Порталы безопасны.<br>На всякий случай возьми с собой обнимашки». <span>— твой кот-проводник</span></p></div>`;
  $("#start").onclick = () => {
    state.started = true;
    save();
    tone();
    navigate("adventure");
    if (state.souvenirs.length) notify(data.ui.legacy);
  };
}
function renderBoard() {
  const c = current(),
    p = progress(),
    board = $("#board");
  if (!board) return;
  board.dataset.phase = p.phase;
  board.innerHTML = Array.from({ length: 49 }, (_, i) => {
    const kind = tile(c, i),
      isPlayer = p.pos === i,
      star = c.stars.find((s) => s.at === i && !p.collected.includes(i));
    const isExit = i === c.exit,
      isKey = i === c.key && !p.key,
      cache = i === c.cache && !p.cache;
    let symbol = kind === "s" ? "☀" : kind === "m" ? "☾" : "",
      label = kind === "#" ? "Пустота" : "Дорожка";
    if (star) {
      symbol = "✦";
      label = "Искра письма";
    } else if (isKey) {
      symbol = "⚿";
      label = "Ключ";
    } else if (cache) {
      symbol = "♡";
      label = "Тайник";
    } else if (isExit) {
      symbol = "◎";
      label = "Портал";
    }
    if (kind === "s") label = "Солнечный мост";
    if (kind === "m") label = "Лунный мост";
    const blocked = !passable(c, i, p.phase),
      adjacent = neighbors(p.pos).includes(i);
    return `<button tabindex="-1" data-cell="${i}" class="cell ${kind === "#" ? "void" : "path"} ${isPlayer ? "player" : ""} ${star ? "spark" : ""} ${isExit ? "portal" : ""} ${isKey ? "key" : ""} ${cache ? "cache" : ""} ${blocked ? "blocked" : ""} ${adjacent && !blocked ? "adjacent" : ""} ${hintCell === i ? "hinted" : ""}" aria-label="${isPlayer ? "Настя здесь. " : ""}${label}, строка ${Math.floor(i / 7) + 1}, столбец ${(i % 7) + 1}" ${kind === "#" ? "disabled" : ""}>${isPlayer ? `<img src="${data.characters.nastya}" alt=""><span class="player-cat">♡</span>` : `<span>${symbol}</span>`}</button>`;
  }).join("");
  board.querySelectorAll("[data-cell]").forEach(
    (b) =>
      (b.onclick = () => {
        if (Date.now() < suppressClickUntil) return;
        move(Number(b.dataset.cell));
        board.focus({ preventScroll: true });
      }),
  );
  $("#move-count").textContent = `${p.moves} шагов`;
  $("#spark-count").textContent = `${p.collected.length} / 3`;
  $("#key-count").textContent = p.key ? "Найден ✓" : "Найти";
  $("#cache-count").textContent = p.cache ? "Открыт ✓" : "Необязательно";
  $("#phase").innerHTML =
    `${p.phase === "sun" ? "☀" : "☾"} <span>${p.phase === "sun" ? "Солнечный свет" : "Лунный свет"}</span> ⇄`;
  $("#phase").setAttribute(
    "aria-label",
    p.phase === "sun" ? "Включить лунный свет" : "Включить солнечный свет",
  );
}
function say(text) {
  const target = $("#dialogue-text");
  if (target) target.textContent = text;
}
function direction(dir) {
  const p = progress(),
    pos = p.pos;
  const target = { up: pos - 7, down: pos + 7, left: pos - 1, right: pos + 1 }[
    dir
  ];
  if (!neighbors(pos).includes(target)) {
    say(data.ui.wall);
    return;
  }
  move(target);
}
function togglePhase() {
  if (state.chapter < state.completed) return;
  const p = progress();
  p.phase = p.phase === "sun" ? "moon" : "sun";
  hintCell = -1;
  save();
  renderBoard();
  say(
    p.phase === "sun"
      ? "Солнце зажигает золотые мосты. Лунные дорожки отдыхают."
      : "Луна зажигает серебряные мосты. Солнечные дорожки отдыхают.",
  );
}
function move(target) {
  if (
    activeTab !== "adventure" ||
    !state.started ||
    state.chapter < state.completed
  )
    return;
  const c = current(),
    p = progress();
  if (target === p.pos) return;
  if (!neighbors(p.pos).includes(target)) {
    say(data.ui.far);
    return;
  }
  if (!passable(c, target, p.phase)) {
    say(
      tile(c, target) === "s"
        ? data.ui.sun
        : tile(c, target) === "m"
          ? data.ui.moon
          : data.ui.wall,
    );
    return;
  }
  p.pos = target;
  p.moves++;
  hintCell = -1;
  const star = c.stars.find((s) => s.at === target);
  if (star && !p.collected.includes(target)) {
    p.collected.push(target);
    say(star.text);
    tone();
    notify(`Искра письма · ${p.collected.length} / 3`);
  }
  if (target === c.key && !p.key) {
    p.key = true;
    say(data.ui.key);
    tone();
  }
  if (target === c.cache && !p.cache) {
    p.cache = true;
    say(c.secret);
    notify("Секретная записка добавлена в альбом ♡");
    tone();
  }
  save();
  updateShell();
  if (target === c.exit) {
    if (p.collected.length === 3 && p.key) {
      state.completed = state.chapter + 1;
      save();
      tone();
      burst();
      renderChapterEnd();
      main.focus({ preventScroll: true });
      return;
    }
    say(data.ui.portal);
  }
  renderBoard();
}
// Breadth-first search over position + light phase gives a useful next step,
// not a free completion. It works for every chapter and never modifies progress.
function hintPath(c, p) {
  const targets = c.stars
    .filter((s) => !p.collected.includes(s.at))
    .map((s) => s.at);
  if (!p.key) targets.push(c.key);
  if (!targets.length) targets.push(c.exit);
  const queue = [{ pos: p.pos, phase: p.phase, steps: [] }],
    seen = new Set([`${p.pos}:${p.phase}`]);
  for (let k = 0; k < queue.length; k++) {
    const node = queue[k];
    if (targets.includes(node.pos)) return node.steps;
    const next = neighbors(node.pos)
      .filter((v) => passable(c, v, node.phase))
      .map((pos) => ({ pos, phase: node.phase, action: pos }));
    next.push({
      pos: node.pos,
      phase: node.phase === "sun" ? "moon" : "sun",
      action: "phase",
    });
    for (const n of next) {
      const key = `${n.pos}:${n.phase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({
        pos: n.pos,
        phase: n.phase,
        steps: [...node.steps, n.action],
      });
    }
  }
  return [];
}
function showHint() {
  const path = hintPath(current(), progress());
  if (path[0] === "phase") {
    say(
      "Кот смотрит на небо: сначала смени солнечный свет на лунный или наоборот кнопкой под картой.",
    );
    $("#phase").focus();
  } else if (Number.isInteger(path[0])) {
    hintCell = path[0];
    renderBoard();
    say(data.ui.hint);
  } else say(data.ui.portal);
}
function renderChapterEnd() {
  const c = current(),
    last = state.completed === 6;
  main.innerHTML = `<section class="chapter-end"><span class="eyebrow">СТРАНИЦА ${state.chapter + 1} ИЗ 6 · НАЙДЕНА</span><div class="end-symbol">✉</div><h1>${last ? "Все дороги привели к тебе." : "Ещё немного ближе."}</h1><p>${esc(c.ending)}</p><div class="achievement">✧ ${esc(c.achievement)}</div><button id="continue" class="primary">${last ? "Прочитать письмо Саши" : "Продолжить нашу историю"} <span>→</span></button><button id="end-album" class="text-button">Сохранённые чудеса — в альбоме</button><div class="letter-progress">${data.chapters.map((_, i) => `<span class="${i < state.completed ? "lit" : ""}">✦</span>`).join("")}</div></section>`;
  updateShell();
  $("#continue").onclick = () => {
    if (last) navigate("letter");
    else {
      state.chapter++;
      save();
      navigate("adventure");
    }
  };
  $("#end-album").onclick = () => navigate("album");
}
function renderRoute() {
  main.innerHTML =
    heading(
      "ОДИН ПУТЬ · ШЕСТЬ ГЛАВ",
      "Наш маршрут <em>к друг другу.</em>",
      "Мы идём по порядку. Каждая глава продолжает одно письмо и одну историю.",
    ) +
    `<div class="route-list">${data.chapters.map((c, i) => `<article class="route-stop ${i < state.completed ? "complete" : i === state.chapter ? "active" : "locked"}"><div class="route-number">${i < state.completed ? "✓" : `0${i + 1}`}</div><div><span class="eyebrow">${esc(c.theme)}</span><h2>${esc(c.title)}</h2><p>${i < state.completed ? esc(c.fragment) : i === state.chapter ? "Эта дорожка ждёт тебя. Кот уже на старте." : "Откроется, когда закончится предыдущая глава."}</p></div><span class="route-state">${i < state.completed ? "Пройдено" : i === state.chapter ? "Ты здесь" : "Позже"}</span></article>`).join("")}</div><button id="route-continue" class="primary">${state.completed === 6 ? "К нашему письму" : "Продолжить приключение"} →</button>`;
  $("#route-continue").onclick = () =>
    navigate(state.completed === 6 ? "letter" : "adventure");
}
function renderAlbum() {
  const found = data.chapters.flatMap((c) =>
    c.stars.filter((s) => progress(c).collected.includes(s.at)),
  );
  main.innerHTML =
    heading(
      "КОЛЛЕКЦИЯ НАШИХ МАЛЕНЬКИХ ЧУДЕС",
      "То, что хочется <em>сберечь.</em>",
      `${found.length} из 18 искр письма. Все найденные слова, фотографии и секреты остаются здесь.`,
    ) +
    `<div class="album-grid">${data.chapters
      .map((c, i) => {
        const p = progress(c),
          unlocked = p.collected.length > 0 || i < state.completed;
        return `<article class="album-card ${unlocked ? "" : "locked"}">${unlocked ? `<img src="${c.photo}" alt="${esc(c.theme)}" loading="lazy">` : '<div class="album-placeholder">✧<span>Будущее воспоминание</span></div>'}<div class="album-copy"><span class="eyebrow">ГЛАВА ${i + 1} · ${esc(c.theme)}</span><h2>${unlocked ? esc(c.achievement) : "Здесь появится наше чудо"}</h2>${c.stars
          .filter((s) => p.collected.includes(s.at))
          .map((s) => `<p>✦ ${esc(s.text)}</p>`)
          .join(
            "",
          )}${p.cache ? `<p class="secret-note">♡ ${esc(c.secret)}</p>` : ""}${!unlocked ? "<p>Найди первую искру в этой главе.</p>" : ""}</div></article>`;
      })
      .join(
        "",
      )}</div>${state.souvenirs.length ? `<section class="souvenirs"><h2>С прежних звёздных дорожек</h2><p>Достижения из прошлого путешествия тоже с нами.</p>${state.souvenirs.map((id) => `<span class="achievement">✧ ${esc(data.chapters.find((c) => c.id === id).achievement)}</span>`).join("")}</section>` : ""}`;
}
function renderLetter() {
  if (state.completed < 6) {
    main.innerHTML =
      heading(
        "САША ПИШЕТ…",
        "Самое важное — <em>между строк.</em>",
        "Письмо собирается вместе с нашим путешествием. Его последняя строчка пока хранит секрет.",
      ) +
      `<section class="letter-paper"><div class="letter-address">Моей Насте ♡</div>${data.chapters.map((c, i) => (i < state.completed ? `<p>${esc(c.fragment)}</p>` : `<div class="unwritten"><span>Страница ${i + 1}</span><i></i><i></i></div>`)).join("")}<div class="letter-signature">Твой Саша</div></section><button id="letter-back" class="primary">Найти следующую страницу →</button>`;
    $("#letter-back").onclick = () => navigate("adventure");
    return;
  }
  main.innerHTML = `<section class="finale"><span class="eyebrow">ШЕСТЬ ГЛАВ · ОДНО БОЛЬШОЕ ЧУВСТВО</span><div class="final-art"><img class="meet nastya" src="${data.characters.nastya}" alt="Настя"><img class="meet sasha" src="${data.characters.sasha}" alt="Саша"><img class="together" src="${data.characters.final}" alt="Настя и Саша вместе"><span class="final-heart">♡</span></div><h1>${esc(data.finale.title)}</h1><p class="final-intro">${esc(data.finale.text)}</p><div class="final-fragments">${data.chapters.map((c) => `<p>${esc(c.fragment)}</p>`).join("")}</div><div class="galaxy">${data.finale.galaxy.map((t) => `<span>✦ ${esc(t)}</span>`).join("")}</div><div class="final-signature">${esc(data.finale.signature)}</div><img class="final-cat" src="${data.characters.cat}" alt="Наш серый кот тоже рядом"><p class="cat-signature">Кот подтверждает: всё написанное — чистая правда.</p><button id="final-album" class="primary">Открыть наш альбом ♡</button></section>`;
  $("#final-album").onclick = () => navigate("album");
  burst();
  tone();
}
function settings() {
  $("#modal-content").innerHTML =
    `<span class="eyebrow">ТВОЁ ПРОСТРАНСТВО</span><h2 id="modal-title">Пусть будет удобно.</h2><p>Прогресс сохраняется в этом браузере. Звук включается кнопкой ♫ вверху. Анимации учитывают настройки уменьшения движения на устройстве.</p><div class="settings-help"><h3>Как путешествовать</h3><p>Шагай на соседнюю клетку, используй стрелки, WASD или свайпы. ☀ / ☾ меняет мосты. Собери три искры и ключ, затем войди в портал. Тайник с сердечком — необязательный сюрприз. Кот подскажет следующий шаг.</p></div><button id="reset" class="danger-button">Начать новое путешествие</button>`;
  modal.showModal();
  $("#reset").onclick = () => {
    $("#modal-content").innerHTML =
      `<h2 id="modal-title">Снова к первой звезде?</h2><p>Все страницы, искры и достижения этого путешествия будут сброшены. Само письмо никуда не исчезнет — его можно будет найти ещё раз.</p><div class="modal-actions"><button id="cancel-reset" class="primary">Оставить как есть</button><button id="confirm-reset" class="danger-button">Начать заново</button></div>`;
    $("#cancel-reset").onclick = () => modal.close();
    $("#confirm-reset").onclick = () => {
      const sound = state.sound;
      state = freshState();
      state.sound = sound;
      save();
      modal.close();
      navigate("adventure");
      notify("Кот готов к новому путешествию ♡");
    };
  };
}
async function init() {
  try {
    const response = await fetch("./data.json");
    if (!response.ok) throw new Error(`Content HTTP ${response.status}`);
    data = await response.json();
    if (
      data.version !== 2 ||
      data.chapters.length !== 6 ||
      data.chapters.some(
        (c) => c.grid.length !== 7 || c.grid.some((r) => r.length !== 7),
      )
    )
      throw new Error("Invalid adventure data");
    load();
    save();
    navigate("adventure", false);
    document
      .querySelectorAll("[data-tab]")
      .forEach((b) => (b.onclick = () => navigate(b.dataset.tab)));
    $("#sound").onclick = () => {
      state.sound = !state.sound;
      save();
      updateShell();
      tone();
      notify(state.sound ? "Звуки звёзд включены" : "Путешествуем в тишине");
    };
    $("#settings").onclick = settings;
    document.addEventListener("keydown", (e) => {
      if (
        activeTab !== "adventure" ||
        !state.started ||
        state.chapter < state.completed ||
        modal.open ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      )
        return;
      const keys = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        a: "left",
        s: "down",
        d: "right",
        ц: "up",
        ф: "left",
        ы: "down",
        в: "right",
      };
      const dir = keys[e.key] || keys[e.key.toLowerCase()];
      if (dir) {
        e.preventDefault();
        direction(dir);
      }
      if (
        e.code === "Space" &&
        (e.target === $("#board") ||
          e.target === main ||
          e.target === document.body)
      ) {
        e.preventDefault();
        togglePhase();
      }
    });
    // Static assets are cached after a successful online visit. Update on next visit.
    if ("serviceWorker" in navigator && location.protocol !== "file:")
      navigator.serviceWorker.register("./sw.js").catch(() => {});
  } catch (error) {
    main.innerHTML = `<section class="error-state"><span>✧</span><h1>Звёзды пока не зажглись</h1><p>Не удалось загрузить историю. Проверь подключение и попробуй ещё раз.</p><button class="primary" id="retry">Попробовать снова</button></section>`;
    $("#retry").onclick = () => location.reload();
    console.error(error);
  }
}
$("#close-modal").onclick = () => modal.close();
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      modal.close();
  }
});
init();
