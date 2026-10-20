# LordDcBot kostenlos hosten OHNE Kreditkarte (Render + MongoDB Atlas + UptimeRobot)

Diese Variante braucht keine Kreditkarte, keine Girocard, keine Kontoverifizierung
per Zahlungsmittel – nur eine E-Mail-Adresse. Drei kostenlose Dienste spielen zusammen:

- **Render** – hostet den Bot-Prozess (Web Service, $0/Monat)
- **MongoDB Atlas** – speichert die Nutzer-Zuordnungen dauerhaft (Free Tier, 512 MB)
- **UptimeRobot** – pingt den Server alle 5 Minuten an, damit Render ihn nicht
  wegen Inaktivität schlafen legt

---

## 1. MongoDB Atlas einrichten (kostenlose Datenbank)

1. Registrieren auf https://www.mongodb.com/cloud/atlas/register (nur E-Mail nötig).
2. **Create a deployment** → Tarif **M0 Free** auswählen → Cloud-Anbieter/Region
   egal (z. B. AWS, Frankfurt) → **Create**.
3. Bei "Security Quickstart":
   - **Username/Password** anlegen (merken, kommt in die Connection-URI).
   - Bei "Where would you like to connect from" → **Add My Current IP Address**,
     danach zusätzlich **Add a Different IP Address** → `0.0.0.0/0` eintragen
     (nötig, weil Render mit wechselnden IPs verbindet). Kommentar z. B.
     "Render – alle IPs".
4. Nach Erstellung: **Database → Connect → Drivers** → Node.js auswählen. Du
   bekommst einen Connection-String wie:
   ```
   mongodb+srv://NUTZER:PASSWORT@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Passwort dort einsetzen (Sonderzeichen ggf. URL-encoden). Diesen String
   brauchst du gleich als `MONGODB_URI`.

## 2. Projekt zu GitHub hochladen

Render deployed am einfachsten aus einem GitHub-Repository.

1. Neues (privates) Repository auf https://github.com/new anlegen, z. B. `lorddcbot`.
2. Lokal im Projektordner:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/DEIN_NUTZERNAME/lorddcbot.git
   git push -u origin main
   ```
   (`.env` wird dank `.gitignore` **nicht** mit hochgeladen – gut so, da sensible Daten drin stehen.)

## 3. Render-Account erstellen und Service anlegen

1. Registrieren auf https://render.com (per GitHub-Login geht am schnellsten,
   keine Zahlungsmethode nötig für den Free-Plan).
2. **New → Web Service** → das eben erstellte GitHub-Repo auswählen.
3. Einstellungen:
   - **Name**: `lorddcbot`
   - **Region**: Frankfurt (oder was am nächsten liegt)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node src/index.js`
   - **Instance Type**: **Free**
4. Unter **Environment** → **Add Environment Variable** alle Werte aus deiner
   `.env`-Datei einzeln eintragen (DISCORD_TOKEN, DISCORD_CLIENT_ID, ...,
   MONGODB_URI). `PORT` musst du **nicht** setzen, Render setzt das automatisch.
5. `PUBLIC_URL` auf die URL setzen, die dir Render oben anzeigt, z. B.
   `https://lorddcbot.onrender.com` (bekommst du erst nach dem ersten Deploy
   final bestätigt – ggf. danach in den Environment Variables nachtragen und
   neu deployen).
6. **Create Web Service** klicken. Render baut und startet den Bot automatisch.
   Unter "Logs" siehst du live, ob er erfolgreich startet.

## 4. Twitch-Einstellungen auf die Render-URL umstellen

- **Twitch Developer Console** → OAuth Redirect URLs, genau diese zwei:
  - `https://lorddcbot.onrender.com/auth/twitch/callback`
  - `https://lorddcbot.onrender.com/admin/login/callback`

## 5. Einmal im Admin-Panel anmelden (Broadcaster verbinden)

`https://lorddcbot.onrender.com/admin` aufrufen und mit dem Twitch-Konto
`Lord0099882` einloggen. Dieser Login ist gleichzeitig die Broadcaster-
Autorisierung: Der Bot speichert dabei die Twitch-Berechtigungen (Follower,
Abos, Moderatoren lesen) in MongoDB Atlas und erneuert sie automatisch.
Ohne diesen Login funktionieren die Follower-/Abo-/Mod-Abfragen nicht.

## 6. UptimeRobot einrichten (verhindert das Einschlafen)

1. Kostenloses Konto auf https://uptimerobot.com (keine Kreditkarte nötig).
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - URL: `https://lorddcbot.onrender.com/` (die Startseite des Servers)
   - Monitoring Interval: **5 Minuten**
3. Speichern. Ab jetzt bekommt dein Service alle 5 Minuten eine Anfrage und
   hat damit nie 15 Minuten Ruhe – Render legt ihn dadurch nicht schlafen.

---

## Wichtige Hinweise

- **Deploys:** Jeder `git push` auf `main` löst automatisch ein neues Deployment
  bei Render aus.
- **Logs ansehen:** im Render-Dashboard unter "Logs" (Live-Ansicht).
- **Grenzen des Free-Plans:** 750 Laufzeit-Stunden/Monat – reicht für **einen**
  durchgehend laufenden Service (ca. 720–744 Stunden/Monat). Falls du weitere
  Render-Free-Services parallel laufen lässt, kann das Kontingent knapp werden.
- **MongoDB Free Tier** ist dauerhaft kostenlos (kein Ablaufdatum), aber auf
  512 MB begrenzt – für Nutzer-Zuordnungen reicht das für viele Tausend Einträge.
- Diese Kombination ist etwas weniger robust als eine echte VM (z. B. minimal
  längere Reaktionszeit direkt nach einem Render-Neustart), funktioniert aber
  in der Praxis zuverlässig für einen Community-Bot dieser Größe.
