const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data");

const FILES = {
  sessions: path.join(DATA_DIR, "sessions.json"),
  choices: path.join(DATA_DIR, "choices.json"),
  matches: path.join(DATA_DIR, "matches.json")
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// Log every API call so you can see in the console whether the ESP32 reaches the server at all.
app.use("/api", (req, _res, next) => {
  if (req.method === "POST") {
    const ip = (req.ip || "").replace("::ffff:", "");
    console.log(`[HTTP] ${req.method} ${req.originalUrl} from ${ip} body=${JSON.stringify(req.body)}`);
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of Object.values(FILES)) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "[]\n", "utf8");
    }
  }
}

function readJson(key) {
  try {
    return JSON.parse(fs.readFileSync(FILES[key], "utf8"));
  } catch (error) {
    console.error(`Could not read ${key}.json:`, error.message);
    throw new Error(`Data file ${key}.json is invalid. Back it up and repair the JSON before restarting.`);
  }
}

// Atomic replacement prevents a partially-written JSON file if the process is interrupted.
function writeJson(key, value) {
  const target = FILES[key];
  const temporary = `${target}.${process.pid}.tmp`;
  const text = JSON.stringify(value, null, 2) + "\n";
  fs.writeFileSync(temporary, text, "utf8");
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    // On Windows, rename can fail with EPERM/EBUSY when antivirus, OneDrive or an
    // editor has the file open. Fall back to a direct write instead of failing.
    console.warn(`rename ${key}.json failed (${error.code}); writing directly`);
    fs.writeFileSync(target, text, "utf8");
    try { fs.unlinkSync(temporary); } catch (_) {}
  }
}

ensureDataFiles();

let sessions = readJson("sessions");
let choices = readJson("choices");
let matches = readJson("matches");

let currentSession = null;
let northernQueue = [];
let easternQueue = [];
let writeChain = Promise.resolve();

// Device telemetry: updated on every /api/press (and /api/heartbeat, if a future
// firmware sends one). A station with no contact for 30 s is shown as stale.
const DEVICE_STALE_AFTER_MS = 30_000;
const deviceLastSeen = { A: null, B: null };
const deviceInfo = { A: null, B: null };

function markDeviceSeen(station, req, extra = {}) {
  const now = new Date().toISOString();
  deviceLastSeen[station] = now;
  deviceInfo[station] = {
    ...(deviceInfo[station] || {}),
    ...extra,
    remoteIp: (req.ip || "").replace("::ffff:", "")
  };
  return now;
}
const recentArduinoInputs = [];
const MAX_ARDUINO_INPUTS = 30;

function getDeviceMonitor() {
  const now = Date.now();
  const device = station => {
    const lastSeen = deviceLastSeen[station];
    const ageMs = lastSeen ? now - new Date(lastSeen).getTime() : null;
    return {
      station,
      location: station === "A" ? "northern" : "eastern",
      lastSeen,
      ageMs,
      info: deviceInfo[station],
      status: !lastSeen ? "never" : ageMs <= DEVICE_STALE_AFTER_MS ? "recent" : "stale"
    };
  };
  return {
    staleAfterMs: DEVICE_STALE_AFTER_MS,
    stations: { A: device("A"), B: device("B") },
    recentInputs: recentArduinoInputs
  };
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function persistAll() {
  // Serialize writes so near-simultaneous inputs cannot overwrite one another.
  // A failed write is logged but never rejects, otherwise every later press would fail too.
  writeChain = writeChain
    .then(() => {
      writeJson("sessions", sessions);
      writeJson("choices", choices);
      writeJson("matches", matches);
    })
    .catch(error => console.error("Could not save data files:", error.message));
  return writeChain;
}

function createSession(reason = "server_start") {
  const now = new Date().toISOString();

  if (currentSession) {
    currentSession.endTime = now;
    currentSession.status = "ended";
    currentSession.endReason = reason;
  }

  currentSession = {
    sessionId: makeId("session"),
    startTime: now,
    endTime: null,
    status: "active",
    startReason: reason
  };

  sessions.push(currentSession);
  northernQueue = [];
  easternQueue = [];
  persistAll();

  console.log(`Started ${currentSession.sessionId}`);
  return currentSession;
}

// Every server process startup begins a fresh session; historical records remain.
const previouslyActive = sessions.find(s => s.status === "active");
if (previouslyActive) {
  previouslyActive.status = "ended";
  previouslyActive.endTime = new Date().toISOString();
  previouslyActive.endReason = "server_restart";
}
createSession("server_start");

function getSessionChoices() {
  return choices.filter(c => c.sessionId === currentSession.sessionId);
}

function getSessionMatches() {
  return matches.filter(m => m.sessionId === currentSession.sessionId);
}

function getStats() {
  const sessionChoices = getSessionChoices();
  const sessionMatches = getSessionMatches();

  const stats = {
    northern: { participants: 0, rock: 0, paper: 0, scissors: 0, wins: 0, losses: 0, draws: 0 },
    eastern: { participants: 0, rock: 0, paper: 0, scissors: 0, wins: 0, losses: 0, draws: 0 },
    totalParticipants: sessionChoices.length,
    totalMatches: sessionMatches.length,
    totalWins: 0,
    totalDraws: 0
  };

  for (const choice of sessionChoices) {
    const side = stats[choice.location];
    if (side) {
      side.participants += 1;
      side[choice.choice] += 1;
    }
  }

  for (const match of sessionMatches) {
    if (match.winner === "draw") {
      stats.northern.draws += 1;
      stats.eastern.draws += 1;
      stats.totalDraws += 1;
    } else if (match.winner === "northern") {
      stats.northern.wins += 1;
      stats.eastern.losses += 1;
      stats.totalWins += 1;
    } else if (match.winner === "eastern") {
      stats.eastern.wins += 1;
      stats.northern.losses += 1;
      stats.totalWins += 1;
    }
  }

  return stats;
}

function getSnapshot() {
  return {
    session: currentSession,
    stats: getStats(),
    queues: {
      northern: northernQueue.length,
      eastern: easternQueue.length
    },
    latestMatches: getSessionMatches().slice(-10).reverse(),
    deviceMonitor: getDeviceMonitor()
  };
}

function determineWinner(northern, eastern) {
  if (northern === eastern) return "draw";
  const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
  return beats[northern] === eastern ? "northern" : "eastern";
}

async function submitChoice(location, choice) {
  if (!currentSession || currentSession.status !== "active") {
    throw new Error("There is no active session.");
  }
  if (!["northern", "eastern"].includes(location)) {
    throw new Error("Unknown location.");
  }
  if (!["rock", "paper", "scissors"].includes(choice)) {
    throw new Error("Invalid choice.");
  }

  const record = {
    choiceId: makeId(location === "northern" ? "N" : "E"),
    sessionId: currentSession.sessionId,
    location,
    choice,
    timestamp: new Date().toISOString(),
    matched: false,
    matchId: null
  };

  choices.push(record);
  const queue = location === "northern" ? northernQueue : easternQueue;
  queue.push(record);

  let newMatch = null;
  const otherQueue = location === "northern" ? easternQueue : northernQueue;

  if (queue.length > 0 && otherQueue.length > 0) {
    const northernChoice = northernQueue.shift();
    const easternChoice = easternQueue.shift();
    const winner = determineWinner(northernChoice.choice, easternChoice.choice);

    newMatch = {
      matchId: makeId("match"),
      sessionId: currentSession.sessionId,
      northernChoiceId: northernChoice.choiceId,
      easternChoiceId: easternChoice.choiceId,
      northernChoice: northernChoice.choice,
      easternChoice: easternChoice.choice,
      winner,
      timestamp: new Date().toISOString()
    };

    northernChoice.matched = true;
    northernChoice.matchId = newMatch.matchId;
    easternChoice.matched = true;
    easternChoice.matchId = newMatch.matchId;
    matches.push(newMatch);
  }

  await persistAll();

  // The player display only confirms the input. The passerby does not wait for a match.
  io.to(location).emit("choice:accepted", {
    location,
    choice,
    timestamp: record.timestamp
  });

  if (newMatch) {
    io.emit("match:new", newMatch);
  }
  io.emit("state:update", getSnapshot());

  return {
    accepted: true,
    matched: Boolean(newMatch),
    status: newMatch ? "matched" : "queued",
    choiceId: record.choiceId,
    match: newMatch
  };
}

app.get("/", (_req, res) => res.redirect("/display"));
app.get("/player1", (_req, res) => res.sendFile(path.join(__dirname, "public", "player1.html")));
app.get("/player2", (_req, res) => res.sendFile(path.join(__dirname, "public", "player2.html")));
app.get("/display", (_req, res) => res.sendFile(path.join(__dirname, "public", "display.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/state", (_req, res) => res.json(getSnapshot()));

// Device diagnostics endpoint for quick checks from a browser or PowerShell.
app.get("/api/device/status", (_req, res) => res.json(getDeviceMonitor()));

// ESP32-C3 station endpoint. One HTTP POST is sent for each physical button press.
app.post("/api/press", async (req, res) => {
  const station = String(req.body?.station || "").toUpperCase();
  const location = station === "A" ? "northern" : station === "B" ? "eastern" : null;
  const choice = String(req.body?.choice || "").toLowerCase();

  if (!location) {
    return res.status(400).json({ success: false, error: "station must be A or B" });
  }
  if (!["rock", "paper", "scissors"].includes(choice)) {
    return res.status(400).json({ success: false, error: "choice must be rock, paper, or scissors" });
  }

  // The board reached us, so it is online even if the choice itself is rejected.
  const receivedAt = markDeviceSeen(station, req);

  try {
    const result = await submitChoice(location, choice);
    recentArduinoInputs.unshift({
      station,
      location,
      choice,
      receivedAt,
      status: result.status,
      choiceId: result.choiceId,
      matched: result.matched
    });
    if (recentArduinoInputs.length > MAX_ARDUINO_INPUTS) recentArduinoInputs.length = MAX_ARDUINO_INPUTS;
    io.emit("device:activity", getDeviceMonitor());
    console.log(`[ARDUINO] Station ${station} (${location}) -> ${choice} | ${result.status}`);
    return res.status(200).json({
      success: true,
      station,
      location,
      choice,
      status: result.status,
      choiceId: result.choiceId,
      match: result.match,
      message: result.matched ? "Choice matched successfully" : "Choice queued; waiting for the other station"
    });
  } catch (error) {
    console.error(`[ARDUINO] Station ${station} press rejected:`, error.message);
    io.emit("device:activity", getDeviceMonitor());
    return res.status(400).json({ success: false, error: error.message });
  }
});

// Optional heartbeat for a future firmware version.
app.post("/api/heartbeat", (req, res) => {
  const station = String(req.body?.station || "").toUpperCase();
  if (station !== "A" && station !== "B") {
    return res.status(400).json({ success: false, error: "station must be A or B" });
  }
  const isFirst = !deviceLastSeen[station];
  markDeviceSeen(station, req, {
    ip: req.body?.ip || null,
    rssi: Number.isFinite(Number(req.body?.rssi)) ? Number(req.body.rssi) : null,
    uptimeMs: Number(req.body?.uptimeMs) || null
  });
  if (isFirst) console.log(`[ARDUINO] Station ${station} connected from ${deviceInfo[station].remoteIp}`);
  io.emit("device:activity", getDeviceMonitor());
  res.json({ success: true, station, serverTime: new Date().toISOString() });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "BASS Plays API", sessionId: currentSession?.sessionId || null });
});

app.get("/api/export/choices.csv", (_req, res) => {
  const rows = getSessionChoices();
  const header = "choiceId,sessionId,location,choice,timestamp,matched,matchId";
  const lines = rows.map(r => [
    r.choiceId, r.sessionId, r.location, r.choice, r.timestamp, r.matched, r.matchId || ""
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=bass-choices-current-session.csv");
  res.send([header, ...lines].join("\n"));
});

app.get("/api/export/matches.csv", (_req, res) => {
  const rows = getSessionMatches();
  const header = "matchId,sessionId,northernChoice,easternChoice,winner,timestamp";
  const lines = rows.map(r => [
    r.matchId, r.sessionId, r.northernChoice, r.easternChoice, r.winner, r.timestamp
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=bass-matches-current-session.csv");
  res.send([header, ...lines].join("\n"));
});

app.post("/api/admin/new-session", async (_req, res) => {
  createSession("admin_restart");
  await persistAll();
  io.emit("session:new", getSnapshot());
  io.emit("state:update", getSnapshot());
  res.json({ ok: true, state: getSnapshot() });
});

app.post("/api/admin/clear-all", async (_req, res) => {
  sessions = [];
  choices = [];
  matches = [];
  northernQueue = [];
  easternQueue = [];
  currentSession = null;
  createSession("admin_clear_all");
  await persistAll();
  io.emit("session:new", getSnapshot());
  io.emit("state:update", getSnapshot());
  res.json({ ok: true, state: getSnapshot() });
});

// Bad JSON from a board -> clear JSON error instead of an HTML page.
app.use((error, req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    console.error(`[HTTP] Invalid JSON on ${req.originalUrl}:`, error.body);
    return res.status(400).json({ success: false, error: "invalid JSON body" });
  }
  next(error);
});

io.on("connection", socket => {
  socket.emit("state:update", getSnapshot());

  socket.on("join:location", location => {
    if (location === "northern" || location === "eastern") {
      socket.join(location);
    }
  });

  socket.on("choice:submit", async (payload, acknowledge) => {
    try {
      const result = await submitChoice(payload?.location, payload?.choice);
      socket.emit("choice:response", result);
      if (typeof acknowledge === "function") acknowledge(result);
    } catch (error) {
      const failure = { error: error.message };
      socket.emit("choice:error", { message: error.message });
      if (typeof acknowledge === "function") acknowledge(failure);
    }
  });
});

// Refresh the admin status so "recently seen" automatically becomes stale
// after 30 seconds even when no new button events arrive.
setInterval(() => io.emit("device:activity", getDeviceMonitor()), 5_000);

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("BASS Plays: Rock, Paper, Scissors");
  console.log(`Server listening on http://localhost:${PORT}`);
  const lanIps = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === "IPv4" && !i.internal)
    .map(i => i.address);
  if (lanIps.length === 0) console.log("No LAN IPv4 address found. Is this computer on WiFi/Ethernet?");
  for (const ip of lanIps) {
    console.log(`LAN access:  http://${ip}:${PORT}   <- put ${ip} in SERVER_HOST in the .ino`);
  }
  console.log(`Arduino API: POST /api/press`);
  console.log(`Device status: http://localhost:${PORT}/api/device/status`);
  console.log("");
});