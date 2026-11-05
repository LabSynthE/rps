(() => {
  const location = document.body.dataset.location;
  const socket = io();
  const buttons = [...document.querySelectorAll(".choice-button")];
  const feedback = document.getElementById("feedback");
  let busy = false;
  let resetTimer = null;

  socket.on("connect", () => socket.emit("join:location", location));

  function showMessage(title, detail) {
    feedback.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
  }

  function reset() {
    busy = false;
    buttons.forEach(button => button.disabled = false);
    showMessage("MAKE YOUR CHOICE", "ONE PRESS RECORDS ONE PARTICIPATION");
  }

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      if (busy) return;
      busy = true;
      buttons.forEach(item => item.disabled = true);
      const choice = button.dataset.choice;
      showMessage(`YOU CHOSE ${choice.toUpperCase()}`, "RECORDING YOUR CHOICE…");
      socket.emit("choice:submit", { location, choice });
      clearTimeout(resetTimer);
      resetTimer = setTimeout(reset, 4500);
    });
  });

  socket.on("choice:accepted", data => {
    if (data.location !== location) return;
    showMessage(`YOU CHOSE ${data.choice.toUpperCase()}`, "YOUR CHOICE HAS BEEN RECORDED. THANK YOU!");
    clearTimeout(resetTimer);
    resetTimer = setTimeout(reset, 3000);
  });

  socket.on("choice:error", error => {
    showMessage("PLEASE TRY AGAIN", error.message || "Could not record your choice.");
    clearTimeout(resetTimer);
    resetTimer = setTimeout(reset, 2500);
  });

  socket.on("connect_error", () => showMessage("RECONNECTING…", "PLEASE WAIT A MOMENT."));
})();
