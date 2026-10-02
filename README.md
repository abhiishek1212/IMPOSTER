# 🕵️ Who's the Impostor? — WGU PA Team

A realtime multiplayer party game for a remote team on a Microsoft Teams call.
Everyone opens one link, picks their name, and plays from their own laptop while
talking in Teams. The server holds every secret (who the impostor is, the words,
the votes), so nothing leaks through the browser.

## How a game runs

1. Host opens the site with the host link (see below) and shares the normal link in Teams.
2. Everyone opens the link, picks their name. Host clicks **Start game** at 9 / 9.
3. Each player sees a secret word. One player (the impostor) sees a related but different word. Everyone taps **I'm ready**.
4. **Clue round** (2 min): one word each, out loud in Teams.
5. **Discussion** (2 min): argue about who's lying. Host clicks **Start voting**.
6. Everyone votes. The reveal fires automatically when the last vote lands.
7. Host clicks **Show results** → vote bars + leaderboard → **Next round**. Three rounds, then the finale.

Scoring: catch the impostor → +2 to every player who voted for them. Impostor
survives → +5 to the impostor. A tie triggers a tiebreak vote; a second tie means
the impostor escapes.

## Deploy on Render (free)

1. Push this folder to a GitHub repo (private is fine).
2. On render.com: **New → Blueprint**, pick the repo. Render reads `render.yaml`.
3. It asks for one value, **HOST_CODE**. Type any secret word, e.g. `owl-7731`. Only people who know it can host.
4. Click **Apply**. First deploy takes 2–3 minutes. You get a URL like `https://whos-the-impostor.onrender.com`.

Manual alternative (New → Web Service): Runtime **Node**, Build `npm install`,
Start `npm start`, Instance type **Free**, add env var `HOST_CODE`.

### Links

| Who | Link |
| --- | --- |
| Players | `https://<your-app>.onrender.com/` |
| Host (you) | `https://<your-app>.onrender.com/?host=<HOST_CODE>` |

Open the host link once; the code is remembered in your browser and removed from
the address bar so it isn't visible when you share your screen.

### Free-tier notes

- The service sleeps after ~15 min idle and takes 30–60 s to wake. Open the link 5 minutes before the meeting.
- Game state lives in memory. A redeploy or restart resets the game, so don't push changes mid-game.

## Run locally

```bash
npm install
npm start          # http://localhost:3000  (host link printed in the console)
```

## Customize

| Setting | Where | Default |
| --- | --- | --- |
| Player names | env `PLAYERS` (comma-separated) | Mayra, Abhishek, Eduardo, Justin, Jason, Jaime, Luis, Anna, Brian |
| Rounds | env `ROUNDS` | 3 |
| Clue / discussion timers | env `CLUE_SECONDS`, `DISCUSS_SECONDS` | 120 / 120 |
| Word pairs | `words.js` | 48 pairs |
| Host code | env `HOST_CODE` | `owl-7731` |

Anyone can also join with a name that isn't on the list (there's a text box), so a
surprise guest doesn't need a redeploy.

## Files

- `server.js` — Express + Socket.io, all game logic and secrets
- `words.js` — word pairs
- `public/index.html`, `public/style.css` — the game UI
- `render.yaml` — one-click Render Blueprint
