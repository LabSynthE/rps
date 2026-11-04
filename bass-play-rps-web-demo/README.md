# BASS Plays: Rock, Paper, Scissors — Local Demo

A small Node.js + Express + Socket.IO prototype for three screens on one local network.

## What it does

- `/player1` — Northern Entrance: one tap records one anonymous choice.
- `/player2` — Eastern Entrance: one tap records one anonymous choice.
- `/display` — Central screen: live participation counts, latest match, choice distributions, recent matches.
- `/admin` — Admin page: start a new session, export CSV, clear all history.
- Northern and Eastern choices are matched FIFO: oldest waiting Northern choice pairs with oldest waiting Eastern choice.
- Passersby do not wait for an opponent. Their screen confirms the choice and resets.
- Every server startup automatically creates a new session. Previous sessions and their data remain in `data/*.json`.
- Unmatched choices from an old session are not carried into the new session.

## Requirements

- Node.js 18 or newer recommended.
- Three computers connected to the same Wi-Fi/LAN.
- The Windows server computer must allow inbound TCP connections on port 3000.

## Run on the Windows server

1. Install Node.js from https://nodejs.org/
2. Extract this project folder.
3. Open PowerShell in the `bass-rps-demo` folder.
4. Run:

   ```powershell
   npm install
   npm start
   ```

5. Find the server computer's LAN IPv4 address:

   ```powershell
   ipconfig
   ```

   Look for the IPv4 address of the active Wi-Fi or Ethernet adapter, for example `192.168.1.105`.

6. Open Windows Defender Firewall and allow Node.js (or TCP port 3000) on the Private network profile. Do not expose this demo port to public networks.

## Open the three screens

Replace `192.168.1.105` with the actual Windows server IP.

- On the server computer: `http://localhost:3000/player1`
- On the other entrance computer: `http://192.168.1.105:3000/player2`
- On the central display computer: `http://192.168.1.105:3000/display`
- Admin dashboard: `http://192.168.1.105:3000/admin`

The client computers can be Windows or macOS; a modern browser is sufficient.

## Data files

The server creates these local files automatically:

- `data/sessions.json` — session start/end information.
- `data/choices.json` — one record per button press.
- `data/matches.json` — one record per matched pair.

The server writes updates to these files as participation happens. Writes are serialized and each file is replaced atomically.

**Back up the `data` folder** before making changes or clearing history.

## Session behavior

- Starting/restarting the Node server ends the previous active session and creates a new session.
- Starting a new session from `/admin` also creates a new session immediately.
- The old session's records remain in JSON files.
- The new session starts with empty queues and zero current-session statistics.
- `CLEAR ALL HISTORY` permanently deletes all saved history and starts a fresh session.

## Important installation notes

- This is a prototype for a trusted local network, not a hardened public-facing service.
- The Admin page has no password. Keep the installation LAN private and do not expose port 3000 to the internet.
- Some campus Wi-Fi networks isolate connected devices. If devices cannot reach the server, use a dedicated Wi-Fi router/access point.
- Keep the Windows server computer awake and prevent it from sleeping during the installation.
- If the server computer shuts down, connected screens will temporarily lose connection. Restarting the server creates a new session by design.
- The current implementation matches one Northern choice with one Eastern choice, in FIFO order, as soon as both queues have an item.
- The player screen acknowledges the local submission; the public display announces the match. It does not try to identify or contact individual participants.

## Arduino later

The current player pages send button selections through Socket.IO. In a hardware version, Arduino input can be read by a small serial-input process on the server computer and passed into the same `submitChoice(location, choice)` logic. The queue, matching, statistics, and display code can remain the same.
