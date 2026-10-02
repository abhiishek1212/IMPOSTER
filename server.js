// Who's the Impostor? — authoritative game server (Node + Express + Socket.io)
// All secrets (impostor identity, words, individual votes) live here and are only
// ever sent to the one player who is allowed to see them.
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST_CODE = process.env.HOST_CODE || "owl-7731"; // open the site with ?host=<code> to become host
const PLAYERS = (process.env.PLAYERS || "Mayra,Abhishek,Eduardo,Justin,Jason,Jaime,Luis,Anna,Brian").split(",").map(s => s.trim()).filter(Boolean);
const ROUNDS = Number(process.env.ROUNDS || 3);
const CLUE_SECONDS = Number(process.env.CLUE_SECONDS || 120);
const DISCUSS_SECONDS = Number(process.env.DISCUSS_SECONDS || 120);
const MIN_PLAYERS = 3;
const PAIRS = require("./words");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true, phase: G.phase, players: Object.keys(G.players).length }));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const rnd = n => crypto.randomInt(0, n);
const now = () => Date.now();
const code = () => crypto.randomBytes(3).toString("hex").toUpperCase();

/* ---------------- game state (single room) ---------------- */
let G;
function freshGame(keepPlayers) {
  const players = keepPlayers ? Object.fromEntries(Object.entries(keepPlayers).map(([id, p]) => [id, { ...p, ready: false, voted: false }])) : {};
  G = {
    gameId: code(), phase: "lobby", round: 0, voteAttempt: 1,
    players,                 // id -> {id, name, connected, ready, voted}
    roster: [],              // ids locked in when the game starts
    scores: {}, pastImpostors: [], usedPairs: G ? G.usedPairs : [],
    secret: null,            // {impostor, common:{e,w}, imp:{e,w}}  (server-only)
    votes: {},               // voterId -> targetId                  (server-only)
    voteCandidates: null, result: null,
    phaseStartedAt: now(), phaseSeconds: null,
  };
}
freshGame();

/* ---------------- views ---------------- */
function publicState() {
  const showResult = ["reveal", "scores", "final"].includes(G.phase);
  return {
    gameId: G.gameId, phase: G.phase, round: G.round, rounds: ROUNDS, voteAttempt: G.voteAttempt,
    names: PLAYERS, minPlayers: MIN_PLAYERS,
    players: Object.values(G.players).map(p => ({ id: p.id, name: p.name, connected: p.connected, ready: !!p.ready, voted: !!p.voted })),
    roster: G.roster, scores: G.scores, voteCandidates: G.voteCandidates,
    voteCount: Object.keys(G.votes).length,
    result: showResult ? G.result : null,
    phaseStartedAt: G.phaseStartedAt, phaseSeconds: G.phaseSeconds,
  };
}
function secretFor(id) {
  if (!G.secret || !G.roster.includes(id)) return null;
  const isImp = G.secret.impostor === id;
  return { role: isImp ? "imp" : "crew", ...(isImp ? G.secret.imp : G.secret.common), round: G.round, gameId: G.gameId };
}
function broadcast() {
  const st = publicState();
  for (const [sid, s] of io.of("/").sockets) s.emit("state", st);
}
function sendSecret(id) { for (const s of socketsOf(id)) s.emit("secret", secretFor(id)); }
function sendAllSecrets() { for (const id of G.roster) sendSecret(id); }
function socketsOf(pid) { return [...io.of("/").sockets.values()].filter(s => s.data.pid === pid); }

/* ---------------- game actions ---------------- */
function setPhase(phase, seconds) { G.phase = phase; G.phaseStartedAt = now(); G.phaseSeconds = seconds || null; }

function startGame() {
  const ids = Object.keys(G.players);
  if (ids.length < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players.`;
  G.roster = ids; G.scores = Object.fromEntries(ids.map(id => [id, 0])); G.pastImpostors = []; G.round = 0;
  dealRound(1);
}
function dealRound(round) {
  const ids = G.roster;
  let pool = ids.filter(id => !G.pastImpostors.includes(id)); if (!pool.length) pool = ids;
  const impostor = pool[rnd(pool.length)];
  const used = new Set(G.usedPairs); let pi, tries = 0;
  do { pi = rnd(PAIRS.length); tries++; } while (used.has(pi) && tries < 80);
  const [ce, cw, ie, iw] = PAIRS[pi];
  const flip = rnd(2) === 1;
  G.secret = { impostor, common: flip ? { e: ie, w: iw } : { e: ce, w: cw }, imp: flip ? { e: ce, w: cw } : { e: ie, w: iw } };
  G.usedPairs = [...used, pi].slice(-PAIRS.length + 1);
  G.round = round; G.voteAttempt = 1; G.votes = {}; G.voteCandidates = null; G.result = null;
  for (const p of Object.values(G.players)) { p.ready = false; p.voted = false; }
  setPhase("roles");
}
function allReady() { return G.roster.length && G.roster.every(id => G.players[id]?.ready); }
function allVoted() { return G.roster.length && G.roster.every(id => G.votes[id]); }

function reveal(force) {
  if (!force && !allVoted()) return;
  const ids = G.roster, S = G.secret;
  const tally = Object.fromEntries(ids.map(id => [id, 0]));
  for (const t of Object.values(G.votes)) if (tally[t] !== undefined) tally[t]++;
  const max = Math.max(...Object.values(tally));
  const top = ids.filter(id => tally[id] === max && max > 0);
  const tie = top.length !== 1;
  let caught = false, suspected = null, escaped = false;
  const scores = { ...G.scores }, deltas = {};
  if (!tie) {
    suspected = top[0]; caught = suspected === S.impostor;
    if (caught) { for (const [v, t] of Object.entries(G.votes)) if (t === S.impostor) { scores[v] += 2; deltas[v] = 2; } }
    else { scores[S.impostor] += 5; deltas[S.impostor] = 5; }
  } else if (G.voteAttempt >= 2 || max === 0) { escaped = true; scores[S.impostor] += 5; deltas[S.impostor] = 5; }
  const realTie = tie && !escaped;
  G.result = { impostor: realTie ? null : S.impostor, common: realTie ? null : S.common, imp: realTie ? null : S.imp,
    tally, suspected, caught, tie: realTie, escaped, tiedIds: realTie ? top : [], deltas, votes: realTie ? {} : { ...G.votes } };
  if (!realTie) { G.scores = scores; if (!G.pastImpostors.includes(S.impostor)) G.pastImpostors.push(S.impostor); }
  setPhase("reveal");
}
function startVoting(candidates, attempt) {
  G.votes = {}; for (const p of Object.values(G.players)) p.voted = false;
  G.voteCandidates = candidates || null; G.voteAttempt = attempt || 1;
  setPhase("voting");
}
function nextRound() { if (G.round >= ROUNDS) setPhase("final"); else dealRound(G.round + 1); }

/* ---------------- sockets ---------------- */
io.on("connection", socket => {
  socket.on("hello", ({ pid, hostCode } = {}, ack) => {
    if (typeof pid !== "string" || pid.length < 8 || pid.length > 64) pid = crypto.randomBytes(12).toString("hex");
    socket.data.pid = pid;
    socket.data.isHost = typeof hostCode === "string" && hostCode === HOST_CODE;
    const p = G.players[pid]; if (p) { p.connected = true; }
    if (typeof ack === "function") ack({ pid, isHost: socket.data.isHost });
    socket.emit("state", publicState());
    socket.emit("secret", secretFor(pid));
    broadcast();
  });

  const player = () => G.players[socket.data.pid];
  const fail = (ack, msg) => { if (typeof ack === "function") ack({ error: msg }); };
  const ok = (ack) => { if (typeof ack === "function") ack({ ok: true }); };

  socket.on("join", ({ name } = {}, ack) => {
    if (G.phase !== "lobby") return fail(ack, "The game already started. You'll be dealt in next game.");
    name = String(name || "").trim().slice(0, 24); if (!name) return fail(ack, "Pick a name.");
    const dup = Object.values(G.players).find(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== socket.data.pid);
    if (dup) return fail(ack, "That name is already taken.");
    G.players[socket.data.pid] = { id: socket.data.pid, name, connected: true, ready: false, voted: false };
    ok(ack); broadcast();
  });

  socket.on("ready", (_, ack) => {
    const p = player(); if (!p || G.phase !== "roles" || !G.roster.includes(p.id)) return fail(ack, "Not now.");
    p.ready = true; ok(ack);
    if (allReady()) setPhase("clues", CLUE_SECONDS);
    broadcast();
  });

  socket.on("vote", ({ target } = {}, ack) => {
    const p = player(); if (!p || G.phase !== "voting" || !G.roster.includes(p.id)) return fail(ack, "Voting isn't open.");
    if (G.votes[p.id]) return fail(ack, "You already voted.");
    if (target === p.id) return fail(ack, "You can't vote for yourself.");
    const allowed = (G.voteCandidates || G.roster).filter(id => id !== p.id);
    if (!allowed.includes(target)) return fail(ack, "That's not a valid choice.");
    G.votes[p.id] = target; p.voted = true; ok(ack);
    if (allVoted()) reveal(false);
    broadcast();
  });

  socket.on("host", ({ action, arg } = {}, ack) => {
    if (!socket.data.isHost) return fail(ack, "Host only.");
    let err = null;
    switch (action) {
      case "newGame": freshGame(G.players); break;
      case "start": err = startGame(); break;
      case "clues": setPhase("clues", CLUE_SECONDS); break;
      case "discussion": setPhase("discussion", DISCUSS_SECONDS); break;
      case "voting": startVoting(null, 1); break;
      case "forceReveal": if (G.phase === "voting") reveal(true); break;
      case "scores": if (G.phase === "reveal" && G.result && !G.result.tie) setPhase("scores"); break;
      case "revote": if (G.phase === "reveal" && G.result?.tie) startVoting(G.result.tiedIds, G.voteAttempt + 1); break;
      case "next": if (G.phase === "scores") nextRound(); break;
      case "redeal": if (["roles", "clues", "discussion", "voting"].includes(G.phase)) dealRound(G.round); break;
      case "kick": if (G.phase === "lobby" && typeof arg === "string") { delete G.players[arg]; } break;
      case "playAgain": freshGame(G.players); break;
      default: err = "Unknown action.";
    }
    if (err) return fail(ack, err);
    ok(ack); broadcast(); sendAllSecrets();
  });

  socket.on("disconnect", () => {
    const p = player(); if (!p) return;
    if (!socketsOf(p.id).length) { p.connected = false; broadcast(); }
  });
});

server.listen(PORT, () => {
  console.log(`Who's the Impostor? listening on http://localhost:${PORT}`);
  console.log(`Host link: http://localhost:${PORT}/?host=${HOST_CODE}`);
});
