(() => {
  const socket = io();
  const $ = id => document.getElementById(id);

  function renderDeviceMonitor(monitor) {
    if (!monitor) return;
    for (const [station, label] of [["A", "a"], ["B", "b"]]) {
      const device = monitor.stations?.[station];
      if (!device) continue;
      const badge = $("device-" + label + "-status");
      const detail = $("device-" + label + "-last");
      badge.className = "device-badge " + device.status;
      const ip = device.info?.ip || device.info?.remoteIp;
      const extra = ip ? ` · IP ${ip}` : "";
      if (device.status === "recent") {
        badge.textContent = "RECENTLY SEEN";
        detail.textContent = `Last successful input: ${new Date(device.lastSeen).toLocaleString()} · ${Math.max(0, Math.floor(device.ageMs / 1000))}s ago${extra}`;
      } else if (device.status === "stale") {
        badge.textContent = "NO RECENT SIGNAL";
        detail.textContent = `Last successful input: ${new Date(device.lastSeen).toLocaleString()}${extra}`;
      } else {
        badge.textContent = "NEVER CONNECTED";
        detail.textContent = "No Arduino data received yet.";
      }
    }

    const rows = monitor.recentInputs || [];
    $("arduino-log").innerHTML = rows.length ? rows.map(item => `
      <tr>
        <td>${new Date(item.receivedAt).toLocaleTimeString()}</td>
        <td>${item.station}</td>
        <td>${item.location === "northern" ? "Northern" : "Eastern"}</td>
        <td>${item.choice.toUpperCase()}</td>
        <td>${item.matched ? "MATCHED" : "QUEUED"}</td>
      </tr>`).join("") : '<tr><td colspan="5" class="notice">No Arduino inputs received yet.</td></tr>';
  }

  function render(state) {
    if (!state) return;
    renderDeviceMonitor(state.deviceMonitor);
    const s = state.stats;
    $("session-info").textContent = state.session
      ? `${state.session.sessionId.toUpperCase()} · STARTED ${new Date(state.session.startTime).toLocaleString()}`
      : "No active session";
    $("participants").textContent = s.totalParticipants;
    $("matches").textContent = s.totalMatches;
    $("n-wins").textContent = s.northern.wins;
    $("e-wins").textContent = s.eastern.wins;
    $("draws").textContent = s.totalDraws;
    $("queued").textContent = state.queues.northern + state.queues.eastern;
    $("n-queue").textContent = state.queues.northern;
    $("e-queue").textContent = state.queues.eastern;
    $("history").innerHTML = state.latestMatches.length ? state.latestMatches.map(m => `
      <div class="history-item">
        <span>N: ${m.northernChoice.toUpperCase()}</span>
        <span>E: ${m.easternChoice.toUpperCase()}</span>
        <strong>${m.winner === "draw" ? "DRAW" : `${m.winner.toUpperCase()} WINS`}</strong>
      </div>`).join("") : '<div class="notice">No matches yet.</div>';
  }

  async function post(url) {
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) throw new Error("Request failed");
    return response.json();
  }

  $("new-session").addEventListener("click", async () => {
    if (!confirm("Start a new session? Current unmatched choices will no longer be matched. Historical records will be kept.")) return;
    try { render((await post("/api/admin/new-session")).state); }
    catch (e) { alert(e.message); }
  });

  $("clear-all").addEventListener("click", async () => {
    if (!confirm("Permanently delete ALL sessions, choices, and matches? This cannot be undone.")) return;
    if (!confirm("Final confirmation: delete all historical data?")) return;
    try { render((await post("/api/admin/clear-all")).state); }
    catch (e) { alert(e.message); }
  });

  socket.on("state:update", render);
  socket.on("session:new", render);
  socket.on("device:activity", renderDeviceMonitor);
  fetch("/api/state").then(r => r.json()).then(render).catch(console.error);
})();
