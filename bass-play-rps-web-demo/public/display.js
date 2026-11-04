(() => {
  const socket = io();
  const $ = id => document.getElementById(id);
  const labels = { rock: "ROCK ✊", paper: "PAPER ✋", scissors: "SCISSORS ✌" };

  function renderBars(containerId, side) {
    const total = side.participants || 0;
    $(containerId).innerHTML = ["rock", "paper", "scissors"].map(choice => {
      const count = side[choice] || 0;
      const percent = total ? Math.round(count / total * 100) : 0;
      return `<div class="bar-row">
        <strong>${choice.toUpperCase()}</strong>
        <div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div>
        <span>${percent}%</span>
      </div>`;
    }).join("");
  }

  function renderMatch(match) {
    if (!match) {
      $("latest-match").innerHTML = "WAITING FOR THE FIRST MATCH…";
      return;
    }
    const winnerText = match.winner === "draw"
      ? "IT'S A DRAW"
      : `${match.winner.toUpperCase()} WINS`;
    $("latest-match").innerHTML = `
      <div class="matchup">
        <div class="match-side"><small>NORTHERN</small><div class="match-choice">${labels[match.northernChoice]}</div></div>
        <div class="vs">VS</div>
        <div class="match-side"><small>EASTERN</small><div class="match-choice">${labels[match.easternChoice]}</div></div>
      </div>
      <div class="winner">${winnerText}</div>
      <div class="notice" style="text-align:center">${new Date(match.timestamp).toLocaleString()}</div>`;
  }

  function renderHistory(matches) {
    $("match-history").innerHTML = matches.length ? matches.map(match => `
      <div class="history-item">
        <span>N: ${labels[match.northernChoice]}</span>
        <span>E: ${labels[match.easternChoice]}</span>
        <strong>${match.winner === "draw" ? "DRAW" : `${match.winner.toUpperCase()} WINS`}</strong>
      </div>`).join("") : '<div class="notice">No matches yet.</div>';
  }

  function render(state) {
    if (!state) return;
    const { session, stats, queues } = state;
    $("session-id").textContent = session ? session.sessionId.toUpperCase() : "NO SESSION";
    $("session-start").textContent = session ? `STARTED ${new Date(session.startTime).toLocaleString()}` : "";
    $("total-participants").textContent = stats.totalParticipants;
    $("total-matches").textContent = stats.totalMatches;
    $("northern-participants").textContent = stats.northern.participants;
    $("eastern-participants").textContent = stats.eastern.participants;
    $("northern-wins").textContent = stats.northern.wins;
    $("eastern-wins").textContent = stats.eastern.wins;
    $("draws").textContent = stats.totalDraws;
    $("unmatched").textContent = queues.northern + queues.eastern;
    renderBars("northern-bars", stats.northern);
    renderBars("eastern-bars", stats.eastern);
    renderMatch(state.latestMatches[0]);
    renderHistory(state.latestMatches);
  }

  socket.on("state:update", render);
  socket.on("session:new", render);
  socket.on("match:new", () => {
    // The complete snapshot arrives immediately after the match event.
  });
  fetch("/api/state").then(r => r.json()).then(render).catch(console.error);
})();
