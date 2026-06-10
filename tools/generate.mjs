// Search Party puzzle generator.
// Packs 4 words (lengths 3,4,5,6) as orthogonal self-avoiding paths that
// exactly tile an 18-cell grid mask, then verifies the tiling is the ONLY
// way to partition the grid into 4 dictionary words.
//
// Usage: node tools/generate.mjs [count] [seed]   (defaults: 90, 7)
// Writes ../puzzles.js

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WORDS3, WORDS4, WORDS5, WORDS6 } from "./words.mjs";

const COUNT = parseInt(process.argv[2] ?? "90", 10);
const SEED = parseInt(process.argv[3] ?? "7", 10);

// ---------- word lists (sanitize: exact length, a-z, dedupe) ----------
function clean(list, len) {
  const out = new Set();
  for (const w of list) {
    const s = w.toLowerCase();
    if (s.length === len && /^[a-z]+$/.test(s)) out.add(s);
  }
  return [...out];
}
const POOL = { 3: clean(WORDS3, 3), 4: clean(WORDS4, 4), 5: clean(WORDS5, 5), 6: clean(WORDS6, 6) };
const DICT = { 3: new Set(POOL[3]), 4: new Set(POOL[4]), 5: new Set(POOL[5]), 6: new Set(POOL[6]) };

// ---------- rng ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const shuffled = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ---------- grid shapes (18 open cells each; '#' = blocked) ----------
const SHAPES = [
  ["......", "......", "......"],                      // 3x6
  ["#....", ".....", ".....", "....#"],                // 4x5, opposite corners
  ["....#", ".....", ".....", "#...."],                // 4x5, other corners
  [".....", "..#..", "..#..", "....."],                // 4x5, center column gap
  ["#...", "....", "....", "....", "...#"],            // 5x4, opposite corners
  ["...#", "....", "....", "....", "#..."],            // 5x4, other corners
];

function shapeInfo(shape) {
  const rows = shape.length, cols = shape[0].length;
  const blocked = [];
  const open = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      (shape[r][c] === "#" ? blocked : open).push(r * cols + c);
  const nbrs = new Map();
  for (const i of open) {
    const r = Math.floor(i / cols), c = i % cols;
    const list = [];
    if (r > 0 && shape[r - 1][c] !== "#") list.push(i - cols);
    if (r < rows - 1 && shape[r + 1][c] !== "#") list.push(i + cols);
    if (c > 0 && shape[r][c - 1] !== "#") list.push(i - 1);
    if (c < cols - 1 && shape[r][c + 1] !== "#") list.push(i + 1);
    nbrs.set(i, list);
  }
  return { rows, cols, blocked, open, nbrs };
}

// subset sums of remaining word lengths — used to prune dead regions
function subsetSums(lengths) {
  let sums = new Set([0]);
  for (const L of lengths) {
    const next = new Set(sums);
    for (const s of sums) next.add(s + L);
    sums = next;
  }
  return sums;
}

// every connected component of `free` must have a size reachable by the
// remaining lengths, and component sizes together must partition them
function regionsOk(free, nbrs, lengths) {
  const sums = subsetSums(lengths);
  const seen = new Set();
  for (const start of free) {
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      size++;
      for (const n of nbrs.get(cur)) {
        if (free.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    if (!sums.has(size)) return false;
  }
  return true;
}

// ---------- placement: tile the mask with the 4 word paths ----------
function placeWords(info, words) {
  // words sorted longest-first; returns [{word, path}] or null
  const free = new Set(info.open);
  const placed = [];

  function placeFrom(word, idx, cell, path) {
    path.push(cell);
    free.delete(cell);
    if (idx === word.length - 1) {
      const rest = words.slice(placed.length + 1).map((w) => w.length);
      if (regionsOk(free, info.nbrs, rest)) {
        placed.push({ word, path: path.slice() });
        if (placeNext()) return true;
        placed.pop();
      }
    } else {
      for (const n of shuffled(info.nbrs.get(cell))) {
        if (free.has(n) && placeFrom(word, idx + 1, n, path)) return true;
      }
    }
    path.pop();
    free.add(cell);
    return false;
  }

  function placeNext() {
    if (placed.length === words.length) return true;
    const word = words[placed.length];
    for (const start of shuffled([...free])) {
      if (placeFrom(word, 0, start, [])) return true;
    }
    return false;
  }

  return placeNext() ? placed : null;
}

// ---------- uniqueness: count distinct tilings into 4 dictionary words ----------
function countSolutions(info, letters, limit = 2) {
  const solutions = new Set();
  const free = new Set(info.open);

  // enumerate simple paths of length L through anchor cell (anchor at any position)
  function pathsThrough(anchor, L, emit) {
    // left arm grows from anchor (reversed prefix), right arm is the suffix
    function growRight(leftArm, rightArm) {
      if (leftArm.length + 1 + rightArm.length === L) {
        emit([...leftArm].reverse().concat([anchor], rightArm));
        return;
      }
      const tip = rightArm.length ? rightArm[rightArm.length - 1] : anchor;
      for (const n of info.nbrs.get(tip)) {
        if (free.has(n) && n !== anchor && !leftArm.includes(n) && !rightArm.includes(n)) {
          rightArm.push(n);
          growRight(leftArm, rightArm);
          rightArm.pop();
        }
      }
    }
    function growLeft(leftArm, targetLeft) {
      if (leftArm.length === targetLeft) {
        growRight(leftArm, []);
        return;
      }
      const tip = leftArm.length ? leftArm[leftArm.length - 1] : anchor;
      for (const n of info.nbrs.get(tip)) {
        if (free.has(n) && n !== anchor && !leftArm.includes(n)) {
          leftArm.push(n);
          growLeft(leftArm, targetLeft);
          leftArm.pop();
        }
      }
    }
    for (let leftLen = 0; leftLen < L; leftLen++) growLeft([], leftLen);
  }

  function solve(remaining, chosen) {
    if (solutions.size >= limit) return;
    if (remaining.length === 0) {
      // canonical form: orientation-insensitive paths, sorted
      const canon = chosen
        .map((p) => {
          const f = p.join(",");
          const b = p.slice().reverse().join(",");
          return f < b ? f : b;
        })
        .sort()
        .join("|");
      solutions.add(canon);
      return;
    }
    const anchor = Math.min(...free);
    const tried = new Set();
    for (const L of new Set(remaining)) {
      pathsThrough(anchor, L, (path) => {
        if (solutions.size >= limit) return;
        // reverse orientation is covered when pathsThrough emits the
        // reversed cell sequence, so only the forward spelling is checked
        const spelled = path.map((i) => letters[i]).join("");
        if (!DICT[L].has(spelled)) return;
        const key = path.join(",");
        if (tried.has(key)) return;
        tried.add(key);
        for (const c of path) free.delete(c);
        const idx = remaining.indexOf(L);
        const rest = remaining.slice(0, idx).concat(remaining.slice(idx + 1));
        if (regionsOk(free, info.nbrs, rest)) {
          chosen.push(path);
          solve(rest, chosen);
          chosen.pop();
        }
        for (const c of path) free.add(c);
      });
      if (solutions.size >= limit) return;
    }
  }

  solve([6, 5, 4, 3], []);
  return solutions.size;
}

// ---------- main loop ----------
const puzzles = [];
const usedWords = new Set();
let attempts = 0, ambiguous = 0;
const started = Date.now();

while (puzzles.length < COUNT) {
  attempts++;
  if (attempts > COUNT * 600) {
    console.error("Too many attempts; giving up.");
    process.exit(1);
  }
  const shape = SHAPES[puzzles.length % SHAPES.length];
  const info = shapeInfo(shape);
  const words = [6, 5, 4, 3].map((L) => pick(POOL[L].filter((w) => !usedWords.has(w))));
  if (words.some((w) => !w)) { console.error("Word pool exhausted"); process.exit(1); }

  const placed = placeWords(info, words);
  if (!placed) continue;

  const total = info.rows * info.cols;
  const letters = new Array(total).fill(null);
  for (const { word, path } of placed)
    path.forEach((cell, i) => (letters[cell] = word[i]));

  // sanity: exact tiling
  const covered = placed.flatMap((p) => p.path);
  if (covered.length !== 18 || new Set(covered).size !== 18) continue;

  if (countSolutions(info, letters) !== 1) { ambiguous++; continue; }

  for (const w of words) usedWords.add(w);
  puzzles.push({
    rows: info.rows,
    cols: info.cols,
    blocked: info.blocked,
    grid: letters.map((ch) => ch ?? ".").join(""),
    words: placed
      .slice()
      .sort((a, b) => a.word.length - b.word.length)
      .map(({ word, path }) => ({ word, path })),
  });
}

const out = `// Generated by tools/generate.mjs — do not edit by hand.
const PUZZLES = ${JSON.stringify(puzzles)};
`;
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "..", "puzzles.js"), out);

console.log(
  `Generated ${puzzles.length} puzzles in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
  `(${attempts} attempts, ${ambiguous} rejected as ambiguous).`
);
