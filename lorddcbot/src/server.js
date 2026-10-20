const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const config = require('./config');
const twitch = require('./twitch');
const { renderPage } = require('./pages');
const { createAdminRouter } = require('./admin');

const pendingStates = new Map(); // state -> { discordId, interactionToken, createdAt }

function signState(discordId, interactionToken) {
  const raw = `${discordId}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  pendingStates.set(raw, { discordId, interactionToken, createdAt: Date.now() });
  // States nach 10 Minuten verwerfen
  setTimeout(() => pendingStates.delete(raw), 10 * 60 * 1000);
  return raw;
}

function buildUserAuthUrl(discordId, interactionToken) {
  const state = signState(discordId, interactionToken);
  const redirectUri = `${config.server.publicUrl}/auth/twitch/callback`;
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', config.twitch.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ''); // keine Extra-Scopes nötig, nur Identität
  url.searchParams.set('state', state);
  return url.toString();
}

function createServer({
  onUserAuthenticated,
  client,
  roles,
  sendDM,
  buildEmbed,
  recheckAllUsers,
  resolveIdentity,
  statusText,
}) {
  const app = express();
  app.use(cookieParser());

  app.use(
    '/admin',
    createAdminRouter({ client, roles, sendDM, buildEmbed, recheckAllUsers, resolveIdentity, statusText })
  );

  // Nutzer-Login (Link wird über /authtwitchuser generiert)
  app.get('/auth/twitch', (req, res) => {
    const { discordId, interactionToken } = req.query;
    if (!discordId) {
      return res.status(400).send(
        renderPage({
          title: 'Fehlerhafter Link',
          heading: 'Ungültiger Link',
          message: 'Diesem Link fehlen nötige Angaben. Bitte starte den Vorgang über <code>/authtwitchuser</code> in Discord neu.',
          tone: 'error',
        })
      );
    }
    res.redirect(buildUserAuthUrl(discordId, interactionToken));
  });

  app.get('/auth/twitch/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error || !code || !state) {
      return res.status(400).send(
        renderPage({
          title: 'Abgebrochen',
          heading: 'Autorisierung abgebrochen',
          message: 'Die Anmeldung wurde abgebrochen oder ist fehlgeschlagen. Du kannst dieses Fenster schließen.',
          tone: 'error',
        })
      );
    }
    const pending = pendingStates.get(state);
    if (!pending) {
      return res.status(400).send(
        renderPage({
          title: 'Abgelaufen',
          heading: 'Vorgang abgelaufen',
          message: 'Dieser Login-Versuch ist ungültig oder abgelaufen. Bitte führe <code>/authtwitchuser</code> erneut aus.',
          tone: 'error',
        })
      );
    }
    pendingStates.delete(state);

    try {
      const redirectUri = `${config.server.publicUrl}/auth/twitch/callback`;
      const tokenData = await twitch.exchangeCodeForToken(code, redirectUri);
      const twitchUser = await twitch.getUserInfo(tokenData.access_token);

      await onUserAuthenticated({
        discordId: pending.discordId,
        interactionToken: pending.interactionToken,
        twitchId: twitchUser.id,
        twitchLogin: twitchUser.login,
        twitchDisplayName: twitchUser.display_name,
      });

      res.send(
        renderPage({
          title: 'Erfolgreich verbunden',
          heading: 'Erfolgreich verbunden!',
          message: `Dein Twitch-Konto <strong>${twitchUser.display_name}</strong> wurde mit Discord verknüpft. Du kannst dieses Fenster jetzt schließen und zu Discord zurückkehren.`,
          tone: 'success',
        })
      );
    } catch (err) {
      console.error('User-Auth Fehler:', err.response?.data || err.message);
      res.status(500).send(
        renderPage({
          title: 'Fehler',
          heading: 'Es ist ein Fehler aufgetreten',
          message: 'Bitte sieh im Server-Log nach den Details.',
          tone: 'error',
        })
      );
    }
  });

  app.get('/', (req, res) =>
    res.send(
      renderPage({
        title: 'LordDcBot',
        heading: 'Auth-Server läuft',
        message: 'Dieser Server nimmt nur Twitch-Login-Weiterleitungen für LordDcBot entgegen.',
        tone: 'success',
      })
    )
  );

  // Debug-Handler: zeigt bei falscher Route sofort, welcher Pfad erwartet wurde
  app.use((req, res) => {
    console.log(`Unbekannte Anfrage empfangen: ${req.method} ${req.originalUrl}`);
    res.status(404).send(
      renderPage({
        title: '404',
        heading: `Route nicht gefunden: ${req.originalUrl}`,
        message: `Das deutet auf ein falsch eingetragenes Redirect-URL in der Twitch Developer Console hin. Erwartete Redirect-URLs sind exakt:
          <ul>
            <li>${config.server.publicUrl}/auth/twitch/callback</li>
            <li>${config.server.publicUrl}/admin/login/callback</li>
          </ul>`,
        tone: 'warning',
      })
    );
  });

  app.listen(config.server.port, () => {
    console.log(`Auth-Server läuft auf Port ${config.server.port}`);
    console.log(`Öffentlich erreichbar unter: ${config.server.publicUrl}`);
    console.log(`Admin-Kontrollzentrum: ${config.server.publicUrl}/admin`);
    console.log(`Erwartete Redirect-URLs bei Twitch:`);
    console.log(`  - ${config.server.publicUrl}/auth/twitch/callback`);
    console.log(`  - ${config.server.publicUrl}/admin/login/callback`);
  });

  return { buildUserAuthUrl };
}

module.exports = { createServer, buildUserAuthUrl };
