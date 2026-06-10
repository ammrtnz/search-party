/* Search Party — game logic. Vanilla JS, no build step. */
(() => {
  "use strict";

  const STORE_KEY = "search-party-v1";
  const WORD_EMOJI = ["🟦", "🟧", "🟩", "🟪"]; // by word index (3,4,5,6 letters)

  const $ = (id) => document.getElementById(id);
  const screens = { levels: $("screen-levels"), game: $("screen-game") };

  // ---------- progress ----------
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { solved: {} }; }
    catch { return { solved: {} }; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch {}
  }
  let progress = loadProgress();

  // ---------- state ----------
  let level = -1;          // 0-based puzzle index
  let puzzle = null;
  let solvedWords = [];    // word indices found
  let lockedCells = {};    // cellIdx -> word index
  let path = [];           // current trace (cell indices)
  let hints = [0, 0, 0, 0];
  let startTime = 0;
  let finished = false;

  // ---------- routing ----------
  function go(hash) { location.hash = hash; }
  window.addEventListener("hashchange", route);
  function route() {
    const m = location.hash.match(/^#l(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= PUZZLES.length) { openLevel(n - 1); return; }
    }
    showLevels();
  }

  // ---------- level select ----------
  function showLevels() {
    screens.game.hidden = true;
    $("overlay").hidden = true;
    screens.levels.hidden = false;
    $("btn-home").hidden = true;
    $("level-tag").hidden = true;

    const grid = $("level-grid");
    grid.innerHTML = "";
    let nextUnsolved = -1;
    for (let i = 0; i < PUZZLES.length; i++) {
      if (nextUnsolved === -1 && !progress.solved[i]) nextUnsolved = i;
    }
    for (let i = 0; i < PUZZLES.length; i++) {
      const b = document.createElement("button");
      b.className = "level-btn" + (progress.solved[i] ? " solved" : "") + (i === nextUnsolved ? " next" : "");
      b.textContent = i + 1;
      b.addEventListener("click", () => go(`#l${i + 1}`));
      grid.appendChild(b);
    }
  }

  // ---------- game setup ----------
  function openLevel(idx) {
    level = idx;
    puzzle = PUZZLES[idx];
    solvedWords = [];
    lockedCells = {};
    path = [];
    hints = [0, 0, 0, 0];
    finished = false;
    startTime = Date.now();

    screens.levels.hidden = true;
    $("overlay").hidden = true;
    screens.game.hidden = false;
    $("btn-home").hidden = false;
    $("level-tag").hidden = false;
    $("level-tag").textContent = `#${idx + 1}`;
    $("msg").textContent = "";

    renderBoard();
    renderSlots();
  }

  function renderBoard() {
    const board = $("board");
    board.innerHTML = "";
    board.style.gridTemplateColumns = `repeat(${puzzle.cols}, var(--tile-size, 58px))`;
    for (let i = 0; i < puzzle.rows * puzzle.cols; i++) {
      const t = document.createElement("div");
      t.className = "tile";
      t.dataset.idx = i;
      if (puzzle.blocked.includes(i)) t.classList.add("blocked");
      else t.textContent = puzzle.grid[i];
      board.appendChild(t);
    }
    refreshTiles();
  }

  function renderSlots() {
    const slots = $("slots");
    slots.innerHTML = "";
    puzzle.words.forEach((w, wi) => {
      const row = document.createElement("div");
      row.className = `slot-row w${wi}` + (solvedWords.includes(wi) ? " done" : "");
      row.dataset.word = wi;
      for (let k = 0; k < w.word.length; k++) {
        const c = document.createElement("div");
        c.className = "slot-cell";
        if (solvedWords.includes(wi)) c.textContent = w.word[k];
        else if (k < hints[wi]) { c.textContent = w.word[k]; c.classList.add("revealed"); }
        row.appendChild(c);
      }
      slots.appendChild(row);
    });
  }

  function refreshTiles() {
    const tiles = $("board").children;
    for (const t of tiles) {
      const i = +t.dataset.idx;
      t.classList.toggle("tracing", path.includes(i));
      t.classList.remove("locked", "w0", "w1", "w2", "w3", "hinted");
      t.removeAttribute("data-hint");
      if (i in lockedCells) t.classList.add("locked", `w${lockedCells[i]}`);
    }
    // hint markers: dashed outline + position number on revealed-but-unsolved tiles
    puzzle.words.forEach((w, wi) => {
      if (solvedWords.includes(wi)) return;
      for (let k = 0; k < hints[wi]; k++) {
        const t = tiles[w.path[k]];
        t.classList.add("hinted");
        t.setAttribute("data-hint", `${w.word.length}·${k + 1}`);
      }
    });
  }

  // ---------- tracing ----------
  const board = $("board");
  let pointerActive = false;
  let movedToOtherTile = false;
  let downTile = -1;

  function tileFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tile = el && el.closest ? el.closest(".tile") : null;
    if (!tile || tile.classList.contains("blocked")) return -1;
    return +tile.dataset.idx;
  }
  const isFree = (i) => i >= 0 && !(i in lockedCells);
  function adjacent(a, b) {
    const ar = Math.floor(a / puzzle.cols), ac = a % puzzle.cols;
    const br = Math.floor(b / puzzle.cols), bc = b % puzzle.cols;
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
  }

  function extend(i) {
    if (!isFree(i) || finished) return;
    const pos = path.indexOf(i);
    if (pos !== -1) {
      // moving back onto an earlier tile retracts the trace to it
      if (pos < path.length - 1) { path = path.slice(0, pos + 1); refreshTiles(); }
      return;
    }
    if (path.length === 0 || adjacent(path[path.length - 1], i)) {
      path.push(i);
      refreshTiles();
      if (!checkAutoSolve()) {
        // no possible word left at this length: reject immediately
        const lens = puzzle.words
          .filter((_, wi) => !solvedWords.includes(wi))
          .map((w) => w.word.length);
        if (path.length >= Math.max(...lens)) rejectTrace(true);
      }
    }
  }

  function checkAutoSolve() {
    for (let wi = 0; wi < puzzle.words.length; wi++) {
      if (solvedWords.includes(wi)) continue;
      const p = puzzle.words[wi].path;
      if (p.length !== path.length) continue;
      const fwd = p.every((c, k) => c === path[k]);
      const rev = p.every((c, k) => c === path[path.length - 1 - k]);
      if (fwd || rev) { lockWord(wi); return true; }
    }
    return false;
  }

  function lockWord(wi) {
    solvedWords.push(wi);
    for (const c of puzzle.words[wi].path) lockedCells[c] = wi;
    path = [];
    renderSlots();
    refreshTiles();
    $("msg").textContent = "";
    if (solvedWords.length === puzzle.words.length) win();
  }

  board.addEventListener("pointerdown", (e) => {
    if (finished) return;
    e.preventDefault();
    pointerActive = true;
    movedToOtherTile = false;
    downTile = tileFromEvent(e);
    if (downTile === -1) return;
    if (path.length && isFree(downTile) && !path.includes(downTile) &&
        !adjacent(path[path.length - 1], downTile)) {
      path = []; // starting somewhere unreachable begins a new trace
    }
    extend(downTile);
  });

  board.addEventListener("pointermove", (e) => {
    if (!pointerActive || finished) return;
    const i = tileFromEvent(e);
    if (i !== -1 && i !== downTile) movedToOtherTile = true;
    if (i !== -1) extend(i);
  });

  window.addEventListener("pointerup", () => {
    if (!pointerActive) return;
    pointerActive = false;
    if (finished || path.length === 0) return;
    // a drag across tiles submits; a single tap keeps building
    if (movedToOtherTile && !checkAutoSolve()) rejectTrace(true);
  });

  function rejectTrace(fullLength) {
    if (!fullLength) return; // shorter than any remaining word: keep building
    const b = $("board");
    b.classList.remove("shake");
    void b.offsetWidth; // restart animation
    b.classList.add("shake");
    $("msg").textContent = "Not quite — try another path";
    path = [];
    refreshTiles();
  }

  // ---------- controls ----------
  $("btn-undo").addEventListener("click", () => {
    path.pop();
    refreshTiles();
  });
  $("btn-clear").addEventListener("click", () => {
    path = [];
    $("msg").textContent = "";
    refreshTiles();
  });
  $("btn-hint").addEventListener("click", () => {
    if (finished) return;
    // reveal the next letter of the shortest unsolved word
    const wi = puzzle.words.findIndex((w, k) => !solvedWords.includes(k));
    if (wi === -1) return;
    hints[wi] = Math.min(hints[wi] + 1, puzzle.words[wi].word.length);
    if (hints[wi] === puzzle.words[wi].word.length) {
      lockWord(wi);
    } else {
      renderSlots();
      refreshTiles();
    }
  });
  $("btn-home").addEventListener("click", () => go("#levels"));
  $("btn-levels").addEventListener("click", () => go("#levels"));
  $("btn-next").addEventListener("click", () => {
    const n = level + 1 < PUZZLES.length ? level + 2 : 1;
    $("overlay").hidden = true;
    go(`#l${n}`);
  });

  // ---------- win ----------
  function totalHints() { return hints.reduce((a, b) => a + b, 0); }
  function fmtTime(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function emojiMap() {
    const cellWord = {};
    puzzle.words.forEach((w, wi) => w.path.forEach((c) => (cellWord[c] = wi)));
    let out = "";
    for (let r = 0; r < puzzle.rows; r++) {
      for (let c = 0; c < puzzle.cols; c++) {
        const i = r * puzzle.cols + c;
        out += puzzle.blocked.includes(i) ? "⬛" : WORD_EMOJI[cellWord[i]];
      }
      out += "\n";
    }
    return out.trimEnd();
  }

  let lastRun = null;

  function win() {
    finished = true;
    const elapsed = Date.now() - startTime;
    const h = totalHints();
    lastRun = { time: elapsed, hints: h };
    const prev = progress.solved[level];
    if (!prev || elapsed < prev.time) progress.solved[level] = { time: elapsed, hints: h };
    saveProgress();

    $("win-stats").textContent = `⏱ ${fmtTime(elapsed)} · 💡 ${h} hint${h === 1 ? "" : "s"}`;
    $("win-emoji").textContent = emojiMap();
    $("overlay").hidden = false;
    confetti();
  }

  function shareText() {
    const url = location.origin + location.pathname + `#l${level + 1}`;
    const st = lastRun || progress.solved[level];
    return `Search Party #${level + 1} 🔎\n⏱ ${fmtTime(st.time)} · 💡 ${st.hints} hints\n${emojiMap()}\n${url}`;
  }

  $("btn-share").addEventListener("click", async () => {
    const text = shareText();
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        $("btn-share").textContent = "Copied!";
        setTimeout(() => ($("btn-share").textContent = "Share"), 1500);
      }
    } catch {}
  });

  function confetti() {
    const colors = ["--w0", "--w1", "--w2", "--w3", "--accent"];
    const cs = getComputedStyle(document.documentElement);
    for (let i = 0; i < 80; i++) {
      const d = document.createElement("div");
      d.className = "confetti";
      d.style.left = Math.random() * 100 + "vw";
      d.style.background = cs.getPropertyValue(colors[i % colors.length]);
      d.style.animationDuration = 1.2 + Math.random() * 1.6 + "s";
      d.style.animationDelay = Math.random() * 0.4 + "s";
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 3500);
    }
  }

  // ---------- boot ----------
  route();
})();
