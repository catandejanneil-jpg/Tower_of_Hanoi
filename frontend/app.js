// ===================== Settings =====================
const API = "http://localhost:8000";            // Prolog server address
const PEGS = ["left", "middle", "right"];
const CENTER = { left: 16.667, middle: 50, right: 83.333 }; // peg x position (%)
const DISK_HEIGHT = 26;   // vertical space for one disk (px)
const BASE_HEIGHT = 18;   // height of the wooden base (px)
const LIFT = 292;         // height where disks travel (above the rods)

// ===================== Page elements =====================
const board      = document.getElementById("board");
const selectEl   = document.getElementById("disk-select");
const movesEl    = document.getElementById("moves");
const minEl      = document.getElementById("min");
const messageEl  = document.getElementById("message");
const statusEl   = document.getElementById("server-status");
const winEl      = document.getElementById("win");
const winTextEl  = document.getElementById("win-text");
const resetBtn   = document.getElementById("reset-btn");
const hintBtn    = document.getElementById("hint-btn");
const demoBtn    = document.getElementById("demo-btn");
const howBtn     = document.getElementById("how-btn");
const againBtn   = document.getElementById("again-btn");
const howDialog  = document.getElementById("how");

// ===================== Game state =====================
let n = 3;                       // number of disks
let pegs = { left: [], middle: [], right: [] }; // each array: bottom -> top
let diskEls = {};                // disk size -> its HTML element
let moves = 0;
let playerMoves = [];                // the player's moves so far
let selected = null;             // peg name when a disk is picked up (click mode)
let busy = false;                // true while an animation is running
let won = false;
let demoRunning = false;
let demoCancel = false;
let stepMs = 350;                // time of one animation step
const solutionCache = {};        // n -> list of moves from Prolog

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NORMAL_MS = reduceMotion ? 60 : 350;

// ===================== Small helpers =====================
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const topDisk = (peg) => pegs[peg][pegs[peg].length - 1];   // top disk size or undefined

function say(text, kind) {
  messageEl.textContent = text;
  messageEl.className = kind || "";
}

function updateStats() {
  movesEl.textContent = "Moves: " + moves;
  minEl.textContent = "Minimum: " + (2 ** n - 1);
}

function setSpeed(ms) {
  stepMs = ms;
  board.style.setProperty("--t", ms + "ms");
}

// Which peg is at this x position? (board is split in 3 equal columns)
function pegAt(clientX) {
  const rect = board.getBoundingClientRect();
  const fraction = (clientX - rect.left) / rect.width;
  return PEGS[Math.min(2, Math.max(0, Math.floor(fraction * 3)))];
}

// ===================== Drawing =====================
function place(size, peg, level) {
  const el = diskEls[size];
  el.style.left = CENTER[peg] + "%";
  el.style.bottom = BASE_HEIGHT + level * DISK_HEIGHT + "px";
}

function refreshDraggable() {
  for (const size in diskEls) {
    const isTop = PEGS.some((p) => topDisk(p) === Number(size));
    diskEls[size].draggable = isTop && !busy && !won && !demoRunning;
  }
}

function resetGame() {
  Object.values(diskEls).forEach((el) => el.remove());
  diskEls = {};
  pegs = { left: [], middle: [], right: [] };
  moves = 0; playerMoves = []; selected = null; won = false;
  winEl.hidden = true;
  PEGS.forEach((p) => document.querySelector(`.rod[data-peg="${p}"]`).classList.remove("selected", "hint"));
  setSpeed(NORMAL_MS);

  for (let size = n; size >= 1; size--) {
    pegs.left.push(size);
    const el = document.createElement("div");
    el.className = "disk";
    el.textContent = size;
    el.style.width = 10 + size * 2.5 + "%";           // bigger number = wider disk
    el.style.background = `hsl(${size * 40}, 70%, 60%)`;
    el.addEventListener("dragstart", (e) => onDragStart(e, size));
    board.appendChild(el);
    diskEls[size] = el;
    place(size, "left", pegs.left.length - 1);
  }
  refreshDraggable();
  updateStats();
  say("Click a peg to pick up its top disk, then click another peg. You can also drag a disk.");
  checkServer();
}

// ===================== Moving a disk (the animation) =====================
// 3 steps: lift up -> slide sideways -> drop down. CSS transitions do the smooth part.
async function animateMove(from, to) {
  const size = pegs[from].pop();
  const el = diskEls[size];
  el.style.zIndex = 5;

  el.style.bottom = LIFT + "px";                    // 1) lift
  await wait(stepMs + 20);
  el.style.left = CENTER[to] + "%";                 // 2) slide
  await wait(stepMs + 20);
  pegs[to].push(size);
  el.style.bottom = BASE_HEIGHT + (pegs[to].length - 1) * DISK_HEIGHT + "px"; // 3) drop
  await wait(stepMs + 20);

  el.style.zIndex = "";
}

// ===================== Rules + player moves =====================
function restore(peg) {          // put a lifted disk back down
  if (topDisk(peg)) place(topDisk(peg), peg, pegs[peg].length - 1);
}

function unmarkRods() {
  document.querySelectorAll(".rod").forEach((r) => r.classList.remove("selected"));
}

function clearSelection() {
  if (selected) restore(selected);
  selected = null;
  unmarkRods();
}

async function attemptMove(from, to) {
  unmarkRods();
  const size = topDisk(from);
  if (!size) { say("That peg is empty.", "bad"); return; }

  if (from === to) { restore(from); return; }          // same peg: just put it back

  const under = topDisk(to);
  if (under && under < size) {                         // RULE: no larger on smaller
    restore(from);
    const el = diskEls[size];
    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 400);
    say(`Not allowed: disk ${size} is bigger than disk ${under}. A larger disk can't go on a smaller one.`, "bad");
    return;
  }

  busy = true; refreshDraggable();
  await animateMove(from, to);
  moves++;
  playerMoves.push({ from, to });
  busy = false;
  refreshDraggable();
  updateStats();

  if (pegs.right.length === n) {
    showWin();
  } else {
    say(`Moved disk ${size} to the ${to} peg.`);
  }
}

function showWin() {
  won = true;
  refreshDraggable();
  const min = 2 ** n - 1;
  winTextEl.textContent = moves === min
    ? `Perfect! You used the minimum of ${min} moves.`
    : `You solved it in ${moves} moves. The minimum is ${min}.`;
  winEl.hidden = false;
  say("You won!", "ok");
}

// Click mode: the first click picks up, the second click drops.
board.addEventListener("click", (e) => {
  if (busy || won || demoRunning) return;
  const peg = pegAt(e.clientX);

  if (selected === null) {
    if (!topDisk(peg)) { say("That peg is empty. Pick a peg that has a disk.", "bad"); return; }
    selected = peg;
    diskEls[topDisk(peg)].style.bottom = LIFT + "px";       // lift the top disk
    document.querySelector(`.rod[data-peg="${peg}"]`).classList.add("selected");
    say(`Picked up disk ${topDisk(peg)}. Now click the peg where it should go.`);
  } else if (selected === peg) {
    clearSelection();
    say("Put the disk back.");
  } else {
    const from = selected;
    selected = null;
    attemptMove(from, peg);
  }
});

// Drag and drop mode
function onDragStart(e, size) {
  if (busy || won || demoRunning) { e.preventDefault(); return; }
  clearSelection();
  const from = PEGS.find((p) => topDisk(p) === size);
  if (!from) {
    e.preventDefault();
    say("Only the top disk of a peg can be moved.", "bad");
    return;
  }
  e.dataTransfer.setData("text/plain", from);
  e.dataTransfer.effectAllowed = "move";
}
board.addEventListener("dragover", (e) => e.preventDefault());
board.addEventListener("drop", (e) => {
  e.preventDefault();
  if (busy || won || demoRunning) return;
  const from = e.dataTransfer.getData("text/plain");
  if (PEGS.includes(from)) attemptMove(from, pegAt(e.clientX));
});

// ===================== Talking to the Prolog backend =====================
async function getSolution(count) {
  if (solutionCache[count]) return solutionCache[count];
  try {
    const response = await fetch(`${API}/solve?disks=${count}`);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();            // { disks, total, moves: [{from,to}, ...] }
    solutionCache[count] = data.moves;
    return data.moves;
  } catch (error) {
    return null;                                    // server is not running
  }
}

async function checkServer() {
  const solution = await getSolution(n);
  if (solution) {
    statusEl.textContent = `Prolog server: online (the solution for ${n} disks has ${solution.length} moves)`;
    statusEl.className = "status ok";
  } else {
    statusEl.textContent = "Prolog server: offline. Start it with: swipl server.pl (hints and demo need it).";
    statusEl.className = "status bad";
  }
}

// ===================== Hint =====================
async function showHint() {
  if (busy || won || demoRunning) return;
  const solution = await getSolution(n);
  if (!solution) { say("The hint needs the Prolog server. Start it and try again.", "bad"); return; }

  // The hint works while your moves match the best solution so far.
  const onBestPath = playerMoves.every((m, i) => m.from === solution[i].from && m.to === solution[i].to);
  if (!onBestPath) {
    say("You have left the best path, so I can't give a hint from here. Press Reset to start again.", "bad");
    return;
  }
  const next = solution[playerMoves.length];
  say(`Hint: move the top disk from the ${next.from} peg to the ${next.to} peg.`, "ok");
  const fromRod = document.querySelector(`.rod[data-peg="${next.from}"]`);
  const toRod = document.querySelector(`.rod[data-peg="${next.to}"]`);
  fromRod.classList.add("hint"); toRod.classList.add("hint");
  setTimeout(() => { fromRod.classList.remove("hint"); toRod.classList.remove("hint"); }, 2500);
}

// ===================== Demo (plays the Prolog solution) =====================
function lockControls(locked) {
  selectEl.disabled = locked;
  resetBtn.disabled = locked;
  hintBtn.disabled = locked;
  howBtn.disabled = locked;
}

async function runDemo(count) {
  if (demoRunning) { demoCancel = true; return; }     // button works as "Stop demo"
  if (busy) return;

  if (count) { n = count; selectEl.value = count; }
  resetGame();
  const solution = await getSolution(n);
  if (!solution) { say("The demo needs the Prolog server. Start it and try again.", "bad"); return; }

  demoRunning = true; demoCancel = false;
  busy = true;
  demoBtn.textContent = "Stop demo";
  lockControls(true);
  refreshDraggable();
  setSpeed(n > 5 ? 120 : 280);
  say("Demo: watch how the Prolog solution moves the disks.");

  for (const m of solution) {
    if (demoCancel) break;
    await animateMove(m.from, m.to);
    moves++;
    updateStats();
  }

  const finished = !demoCancel;
  demoRunning = false; busy = false;
  demoBtn.textContent = "Watch demo";
  lockControls(false);
  if (finished) {
    refreshDraggable();
    say(`Demo finished in ${solution.length} moves, the minimum. Press Reset to try it yourself.`, "ok");
    setSpeed(NORMAL_MS);
  } else {
    resetGame();
  }
}

// ===================== Buttons =====================
selectEl.addEventListener("change", () => {
  if (busy) { selectEl.value = n; return; }
  n = Number(selectEl.value);
  resetGame();
});
resetBtn.addEventListener("click", () => { if (!busy) resetGame(); });
hintBtn.addEventListener("click", showHint);
demoBtn.addEventListener("click", () => runDemo());
againBtn.addEventListener("click", (e) => { e.stopPropagation(); resetGame(); });

howBtn.addEventListener("click", () => howDialog.showModal());
document.getElementById("close-how-btn").addEventListener("click", () => howDialog.close());
document.getElementById("try-demo-btn").addEventListener("click", () => {
  howDialog.close();
  runDemo(3);
});

// ===================== Start =====================
selectEl.value = n;   // make the selector match the game (browsers can remember old values)
resetGame();