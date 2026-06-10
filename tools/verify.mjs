// Independent sanity check of puzzles.js: structure, adjacency, exact tiling,
// dictionary membership, no repeated words across the batch.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WORDS3, WORDS4, WORDS5, WORDS6 } from "./words.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "puzzles.js"), "utf8");
const PUZZLES = JSON.parse(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));

const DICT = {
  3: new Set(WORDS3), 4: new Set(WORDS4), 5: new Set(WORDS5), 6: new Set(WORDS6),
};

let errors = 0;
const seen = new Set();
const fail = (i, msg) => { console.error(`Puzzle ${i}: ${msg}`); errors++; };

PUZZLES.forEach((p, i) => {
  const { rows, cols, blocked, grid, words } = p;
  if (grid.length !== rows * cols) fail(i, "grid length mismatch");
  const lengths = words.map((w) => w.word.length).sort().join(",");
  if (lengths !== "3,4,5,6") fail(i, `word lengths ${lengths}`);
  const used = new Set();
  for (const { word, path } of words) {
    if (!DICT[word.length].has(word)) fail(i, `'${word}' not in dictionary`);
    if (seen.has(word)) fail(i, `'${word}' repeated across batch`);
    seen.add(word);
    if (path.length !== word.length) fail(i, `'${word}' path length mismatch`);
    path.forEach((cell, k) => {
      if (grid[cell] !== word[k]) fail(i, `'${word}' letter mismatch at ${cell}`);
      if (blocked.includes(cell)) fail(i, `'${word}' uses blocked cell`);
      if (used.has(cell)) fail(i, `cell ${cell} used twice`);
      used.add(cell);
      if (k > 0) {
        const a = path[k - 1], b = cell;
        const ar = Math.floor(a / cols), ac = a % cols, br = Math.floor(b / cols), bc = b % cols;
        if (Math.abs(ar - br) + Math.abs(ac - bc) !== 1) fail(i, `'${word}' non-adjacent step`);
      }
    });
  }
  if (used.size !== 18) fail(i, `tiles covered ${used.size} != 18`);
  if (used.size + blocked.length !== rows * cols) fail(i, "coverage + blocked != grid");
});

console.log(errors === 0 ? `OK: ${PUZZLES.length} puzzles all valid.` : `${errors} errors.`);
process.exit(errors ? 1 : 0);
