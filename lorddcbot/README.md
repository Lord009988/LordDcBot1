# LordDcBot

Discord-Bot für den **Lord0099882 Club**: Nutzer verknüpfen ihr Twitch-Konto mit Discord und bekommen automatisch Rollen (Follower, Abonnent, Moderator, Authentifiziert). Verwaltet wird alles über eine **Admin-Webseite**.

Der Bot läuft kostenlos auf Render (siehe `DEPLOYMENT_RENDER.md`). Alle Daten liegen in MongoDB Atlas.

---

## Discord-Befehle (für alle Nutzer)

Alle vier funktionieren nur im Command-Channel (`COMMAND_CHANNEL_ID`).

| Befehl | Was er macht |
|---|---|
| `/authtwitchuser` | Twitch-Konto verknüpfen (Login per Button) |
| `/deleteauth` | eigene Verknüpfung löschen (mit Bestätigung) |
| `/mutebot` | Status-/Rollen-DMs ausschalten (mit Bestätigung) |
| `/unmutebot` | Status-/Rollen-DMs wieder einschalten |

Weitere Funktionen des Bots:
- Nach der Verknüpfung postet der Bot im Ergebnis-Channel `Discord: Name [ID] | Twitch: Name [ID]` und vergibt die passenden Rollen.
- Jeden Tag um **18:00 Uhr (deutsche Zeit)** sowie bei jedem Start prüft der Bot alle Verknüpfungen neu und passt die Rollen an (inkl. "Ehemaliger Follower/Abonnent"). Bei Änderungen bekommt der Nutzer eine DM.
- Im Command- und im Support-Channel werden Nachrichten von normalen Nutzern automatisch gelöscht (Ausnahme: Bots und die Rollen aus `ADMIN_ROLES`).
- Gebannte Discord- oder Twitch-Konten können sich nicht verknüpfen. Ein Twitch-Konto lässt sich nur mit einem Discord-Konto verknüpfen.
- Kann eine DM nicht zugestellt werden (z. B. Bot blockiert), steht das im Log-Channel.

---

## Admin-Webseite

Erreichbar unter `<PUBLIC_URL>/admin`.

**Login:** Nur mit dem Twitch-Konto **Lord0099882**. Der Login ist gleichzeitig die Broadcaster-Autorisierung, der Bot holt sich dabei die Berechtigungen für die Follower-/Abo-/Mod-Abfragen. Das Konto ist fest eingestellt und kann nicht geändert werden. Sessions laufen nach 12 Stunden ab, alle Formulare sind per CSRF-Token geschützt.

| Tab | Funktionen |
|---|---|
| **Übersicht** | Anzahl pro Rolle, verknüpfte und gebannte Konten, Broadcaster |
| **Nutzer** | Suche und Liste aller Verknüpfungen, Verknüpfung eines Nutzers löschen (inkl. DM) |
| **Bans** | Liste aller Bans, neuen Bann anlegen (Discord- oder Twitch-Konto), Entbannen (inkl. DM) |
| **Logs** | Aktivität der letzten 24 Stunden (Befehle, Bestätigungen, Website-Aktionen), Recheck sofort auslösen |

---

## Umgebungsvariablen

Siehe `.env.example`. Wichtig:

| Variable | Bedeutung |
|---|---|
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` | Zugangsdaten des Discord-Bots und Server-ID |
| `COMMAND_CHANNEL_ID` | Channel für die Nutzer-Befehle |
| `RESULT_CHANNEL_ID` | Channel für die Zeile `Discord: ... \| Twitch: ...` |
| `SUPPORT_CHANNEL_ID` | Support-Channel (Ticket-Tool-Knopf) |
| `LOG_CHANNEL_ID` | Channel für Zustellungsfehler von DMs |
| `ROLE_*`, `ADMIN_ROLES` | Rollennamen (müssen exakt so auf dem Server existieren) |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch-App aus der Developer Console |
| `PUBLIC_URL` | öffentliche Adresse des Bots (ohne `/` am Ende) |
| `MONGODB_URI` | Verbindung zu MongoDB Atlas |

Die Rolle **Authentifiziert** muss ebenfalls auf dem Server existieren (Name ist fest).

---

## Twitch-App (Developer Console)

Unter **OAuth Redirect URLs** genau diese zwei Adressen eintragen:
- `<PUBLIC_URL>/auth/twitch/callback`
- `<PUBLIC_URL>/admin/login/callback`

---

## Befehle bei Discord registrieren

Nach Änderungen an den Befehlen einmal lokal ausführen (benötigt eine ausgefüllte `.env`):

```bash
npm install
npm run deploy-commands
```

Das ersetzt die komplette Befehlsliste des Servers, entfernte Befehle verschwinden dadurch aus Discord.

---

## Hinweise

- Die Bot-Rolle muss auf dem Server **über** allen Rollen stehen, die sie vergeben soll.
- Bot-Berechtigungen: Rollen verwalten, Nachrichten verwalten, Nachrichten senden, Nachrichtenverlauf lesen. Aktivierter Intent: **Server Members Intent**.
- Läuft der Free-Service bei Render, hält UptimeRobot ihn wach (siehe `DEPLOYMENT_RENDER.md`).
