const express = require('express');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const twitch = require('./twitch');
const { renderPage, renderDashboard, statCard, renderActivityLog } = require('./pages');

const SESSION_COOKIE = 'lorddcbot_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 Stunden
const USERS_PAGE_SIZE = 20;
const BROADCASTER_SCOPES = 'moderator:read:followers channel:read:subscriptions moderation:read';

function flashFromQuery(req) {
  return req.query.flashMsg ? { message: req.query.flashMsg, tone: req.query.flashTone || 'info' } : null;
}

function redirectWithFlash(res, path, message, tone) {
  res.redirect(`${path}?flashMsg=${encodeURIComponent(message)}&flashTone=${tone}`);
}

// deps kommen aus index.js, da dort Discord-Client, Rollen-Logik usw. leben
function createAdminRouter({ client, roles, sendDM, buildEmbed, recheckAllUsers, resolveIdentity, statusText }) {
  const router = express.Router();
  const pendingAdminLogins = new Map(); // state -> { createdAt }

  router.use(express.urlencoded({ extended: true }));

  // Der Admin-Login ist gleichzeitig die Broadcaster-Autorisierung: Mit diesen Berechtigungen
  // kann der Bot Follower, Abonnenten und Moderatoren des Kanals abfragen.
  function buildTwitchLoginUrl() {
    const state = crypto.randomBytes(16).toString('hex');
    pendingAdminLogins.set(state, { createdAt: Date.now() });
    setTimeout(() => pendingAdminLogins.delete(state), 10 * 60 * 1000);

    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.searchParams.set('client_id', config.twitch.clientId);
    url.searchParams.set('redirect_uri', `${config.server.publicUrl}/admin/login/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', BROADCASTER_SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async function requireAdmin(req, res, next) {
    const sessionId = req.cookies?.[SESSION_COOKIE];
    if (!sessionId) return res.redirect('/admin/login');
    const session = await db.getSession(sessionId);
    if (!session) return res.redirect('/admin/login');
    req.adminSession = session;
    next();
  }

  function verifyCsrf(req, res, next) {
    if (req.adminSession && req.body._csrf && req.body._csrf === req.adminSession.csrfToken) {
      return next();
    }
    return res.status(403).send(
      renderPage({
        title: 'Sicherheitsfehler',
        heading: 'Ungültige Anfrage',
        message: 'Sicherheitsprüfung fehlgeschlagen. Bitte lade die Seite neu und versuche es erneut.',
        tone: 'error',
      })
    );
  }

  // ================= Login =================

  router.get('/login', (req, res) => {
    const url = buildTwitchLoginUrl();
    res.send(
      renderPage({
        title: 'Admin-Login',
        heading: 'Als Broadcaster einloggen',
        message:
          `Melde dich mit dem Twitch-Konto <strong>${config.twitch.broadcasterLogin}</strong> an, um das Kontrollzentrum zu nutzen.` +
          `<br><br><a href="${url}" class="btn btn-primary" style="background:#9146FF;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Mit Twitch einloggen</a>`,
        tone: 'info',
      })
    );
  });

  router.get('/login/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error || !code || !state || !pendingAdminLogins.has(state)) {
      return res.status(400).send(
        renderPage({
          title: 'Fehlgeschlagen',
          heading: 'Login fehlgeschlagen',
          message: 'Der Login-Versuch ist ungültig oder abgelaufen. Bitte erneut versuchen.',
          tone: 'error',
        })
      );
    }
    pendingAdminLogins.delete(state);

    try {
      const redirectUri = `${config.server.publicUrl}/admin/login/callback`;
      const tokenData = await twitch.exchangeCodeForToken(code, redirectUri);
      const twitchUser = await twitch.getUserInfo(tokenData.access_token);

      if (twitchUser.login.toLowerCase() !== config.twitch.broadcasterLogin.toLowerCase()) {
        return res.status(403).send(
          renderPage({
            title: 'Falsches Konto',
            heading: 'Falsches Twitch-Konto',
            message: `Nur das Konto <strong>${config.twitch.broadcasterLogin}</strong> darf sich einloggen.`,
            tone: 'error',
          })
        );
      }

      // Der Login ist zugleich die Broadcaster-Autorisierung: Token für die Twitch-Abfragen speichern
      await db.setBroadcasterTokens({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        login: twitchUser.login,
        twitchId: twitchUser.id,
        displayName: twitchUser.display_name,
      });

      const sessionId = crypto.randomBytes(32).toString('hex');
      const csrfToken = crypto.randomBytes(16).toString('hex');
      await db.createSession({
        _id: sessionId,
        twitchLogin: twitchUser.login,
        twitchId: twitchUser.id,
        csrfToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });

      res.cookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS,
      });
      await db.logActivity({
        actor: `web:${twitchUser.login}`,
        action: 'Admin-Login (Website)',
      });
      res.redirect('/admin');
    } catch (err) {
      console.error('Admin-Login Fehler:', err.response?.data || err.message);
      res.status(500).send(
        renderPage({
          title: 'Fehler',
          heading: 'Es ist ein Fehler aufgetreten',
          message: 'Bitte sieh im Server-Log nach.',
          tone: 'error',
        })
      );
    }
  });

  router.post('/logout', requireAdmin, verifyCsrf, async (req, res) => {
    await db.deleteSession(req.adminSession._id);
    res.clearCookie(SESSION_COOKIE);
    res.redirect('/admin/login');
  });

  // ================= Übersicht =================

  router.get('/', requireAdmin, async (req, res) => {
    const guild = await client.guilds.fetch(config.discord.guildId);
    const r = config.roles;
    const roleCount = (name) => roles.findRole(guild, name)?.members.size ?? 0;

    const totalLinked = Object.keys(await db.getAllUsers()).length;
    const totalBanned = (await db.getAllBans()).length;
    const broadcaster = await db.getBroadcasterTokens();

    // Feste Reihenfolge, 4 pro Reihe: Follower-Paar, Abonnenten-Paar / Moderator, Gebannt, Authentifiziert, Verknüpft
    const cards = [
      statCard('Follower', roleCount(r.follower)),
      statCard('Ehemalige Follower', roleCount(r.exFollower)),
      statCard('Abonnenten', roleCount(r.subscriber)),
      statCard('Ehemalige Abonnenten', roleCount(r.exSubscriber)),
      statCard('Moderatoren', roleCount(r.moderator)),
      statCard('Gebannt', totalBanned),
      statCard('Authentifiziert', roleCount('Authentifiziert')),
      statCard('Verknüpfte Nutzer', totalLinked),
    ].join('');

    const body = `
      <div class="grid">${cards}</div>
      <h2>Broadcaster</h2>
      <div class="card">
        <p>${
          broadcaster
            ? `<strong>${broadcaster.displayName ?? broadcaster.login}</strong>`
            : '<span class="muted">Kein Broadcaster hinterlegt.</span>'
        }</p>
      </div>
    `;
    res.send(
      renderDashboard({
        title: 'Übersicht',
        activeNav: 'overview',
        body,
        flash: flashFromQuery(req),
        twitchLogin: req.adminSession.twitchLogin,
        csrfToken: req.adminSession.csrfToken,
      })
    );
  });

  // ================= Logs =================

  router.get('/logs', requireAdmin, async (req, res) => {
    const entries = await db.getActivityLast24h();

    const body = `
      <form method="POST" action="/admin/recheck" style="margin-bottom:20px;">
        <input type="hidden" name="_csrf" value="${req.adminSession.csrfToken}">
        <button class="btn btn-primary" type="submit">Jetzt Recheck ausführen</button>
      </form>
      <h2>Aktivität der letzten 24 Stunden</h2>
      ${renderActivityLog(entries)}
    `;
    res.send(
      renderDashboard({
        title: 'Logs',
        activeNav: 'logs',
        body,
        flash: flashFromQuery(req),
        twitchLogin: req.adminSession.twitchLogin,
        csrfToken: req.adminSession.csrfToken,
      })
    );
  });

  router.post('/recheck', requireAdmin, verifyCsrf, async (req, res) => {
    const result = await recheckAllUsers();
    await db.logActivity({
      actor: `web:${req.adminSession.twitchLogin}`,
      action: 'Recheck (Website)',
      details: `${result.total} geprüft, ${result.changedCount} geändert`,
    });
    redirectWithFlash(res, '/admin/logs', `Recheck abgeschlossen: ${result.total} geprüft, ${result.changedCount} geändert.`, 'success');
  });

  // ================= Nutzer =================

  router.get('/users', requireAdmin, async (req, res) => {
    const search = (req.query.q || '').trim().toLowerCase();
    const page = parseInt(req.query.page || '0', 10);
    const usersObj = await db.getAllUsers();
    let entries = Object.values(usersObj);

    if (search) {
      entries = entries.filter(
        (e) =>
          (e.discordUsername || '').toLowerCase().includes(search) ||
          (e.twitchDisplayName || '').toLowerCase().includes(search) ||
          (e.twitchLogin || '').toLowerCase().includes(search) ||
          e._id.includes(search) ||
          (e.twitchId || '').includes(search)
      );
    }
    entries.sort((a, b) => (a.discordUsername || '').localeCompare(b.discordUsername || ''));

    const totalPages = Math.max(1, Math.ceil(entries.length / USERS_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const pageEntries = entries.slice(safePage * USERS_PAGE_SIZE, safePage * USERS_PAGE_SIZE + USERS_PAGE_SIZE);

    const rows = pageEntries
      .map(
        (e) => `
      <tr>
        <td>${e.discordUsername ?? 'unbekannt'}<br><span class="muted">${e._id}</span></td>
        <td>${e.twitchDisplayName ?? 'Unbekannt'}<br><span class="muted">${e.twitchId ?? '?'}</span></td>
        <td>${statusText(e.status)}</td>
        <td>
          <form method="POST" action="/admin/users/${e._id}/delete" class="inline">
            <input type="hidden" name="_csrf" value="${req.adminSession.csrfToken}">
            <button class="btn btn-danger" type="submit">Löschen</button>
          </form>
        </td>
      </tr>`
      )
      .join('');

    const body = `
      <form method="GET" action="/admin/users" style="margin-bottom:16px; display:flex; gap:8px;">
        <input type="text" name="q" placeholder="Suche nach Discord-/Twitch-Name..." value="${search}">
        <button class="btn btn-secondary" type="submit">Suchen</button>
      </form>
      <p class="muted">${entries.length} Ergebnis(se) — Seite ${safePage + 1} von ${totalPages}</p>
      <table>
        <tr><th>Discord</th><th>Twitch</th><th>Status</th><th></th></tr>
        ${rows || '<tr><td colspan="4" class="muted">Keine Nutzer gefunden.</td></tr>'}
      </table>
      <div style="margin-top:16px; display:flex; gap:8px;">
        ${safePage > 0 ? `<a class="btn btn-secondary" href="/admin/users?q=${encodeURIComponent(search)}&page=${safePage - 1}">◀ Zurück</a>` : ''}
        ${safePage < totalPages - 1 ? `<a class="btn btn-secondary" href="/admin/users?q=${encodeURIComponent(search)}&page=${safePage + 1}">Weiter ▶</a>` : ''}
      </div>
    `;
    res.send(
      renderDashboard({
        title: 'Nutzer',
        activeNav: 'users',
        body,
        flash: flashFromQuery(req),
        twitchLogin: req.adminSession.twitchLogin,
        csrfToken: req.adminSession.csrfToken,
      })
    );
  });

  router.post('/users/:id/delete', requireAdmin, verifyCsrf, async (req, res) => {
    const targetId = req.params.id;
    const guild = await client.guilds.fetch(config.discord.guildId);
    const member = await guild.members.fetch(targetId).catch(() => null);
    const existing = await db.getUser(targetId);

    if (!existing) {
      return redirectWithFlash(res, '/admin/users', 'Nutzer nicht gefunden.', 'warning');
    }

    if (member) await roles.removeAllRoles(guild, member);

    if (existing.resultMessageId) {
      try {
        const resultChannel = await client.channels.fetch(config.discord.resultChannelId);
        const oldMessage = await resultChannel.messages.fetch(existing.resultMessageId);
        await oldMessage.delete();
      } catch {
        // Nachricht existierte schon nicht mehr - ignorieren
      }
    }

    await db.deleteUser(targetId);
    console.log(
      `[Admin-Web] ${req.adminSession.twitchLogin} hat die Verknüpfung von ${
        member ? member.user.tag : targetId
      } (${targetId}) über die Website gelöscht.`
    );
    await db.logActivity({
      actor: `web:${req.adminSession.twitchLogin}`,
      action: 'Nutzer gelöscht (Website)',
      details: `${member ? member.user.tag : targetId} (${targetId})`,
    });

    await sendDM(
      targetId,
      buildEmbed(
        'Deine Twitch-Verknüpfung wurde entfernt',
        'Ein Eigentümer des Servers hat deine Twitch-Verknüpfung und alle zugehörigen Rollen über das Kontrollzentrum entfernt. Falls du möchtest, kannst du dich über `/authtwitchuser` erneut verknüpfen.',
        0xffcc00
      ),
      { respectMute: false, label: 'Admin-Web-Löschung-DM' }
    );

    redirectWithFlash(res, '/admin/users', `Verknüpfung von ${member ? member.user.tag : targetId} gelöscht.`, 'success');
  });

  // ================= Bans =================

  router.get('/bans', requireAdmin, async (req, res) => {
    const bans = await db.getAllBans();
    const rows = bans
      .map(
        (b) => `
      <tr>
        <td>${b.type === 'discord' ? 'Discord' : 'Twitch'}</td>
        <td>${b.identifier}</td>
        <td>${b.reason}</td>
        <td>
          <form method="POST" action="/admin/bans/${b.type}/${b.identifier}/remove" class="inline">
            <input type="hidden" name="_csrf" value="${req.adminSession.csrfToken}">
            <button class="btn btn-success" type="submit">Entbannen</button>
          </form>
        </td>
      </tr>`
      )
      .join('');

    const body = `
      <div class="card">
        <h2 style="margin-top:0;">Neuen Bann anlegen</h2>
        <form method="POST" action="/admin/bans/create">
          <input type="hidden" name="_csrf" value="${req.adminSession.csrfToken}">
          <p><input type="text" name="identifier" placeholder="Discord-/Twitch-Name oder ID" required style="width:100%;"></p>
          <p><input type="text" name="reason" placeholder="Grund" required style="width:100%;"></p>
          <button class="btn btn-danger" type="submit">Bannen</button>
        </form>
      </div>
      <table>
        <tr><th>Typ</th><th>Identifier</th><th>Grund</th><th></th></tr>
        ${rows || '<tr><td colspan="4" class="muted">Keine Bans vorhanden.</td></tr>'}
      </table>
    `;
    res.send(
      renderDashboard({
        title: 'Bans',
        activeNav: 'bans',
        body,
        flash: flashFromQuery(req),
        twitchLogin: req.adminSession.twitchLogin,
        csrfToken: req.adminSession.csrfToken,
      })
    );
  });

  router.post('/bans/create', requireAdmin, verifyCsrf, async (req, res) => {
    const { identifier: query, reason } = req.body;
    const guild = await client.guilds.fetch(config.discord.guildId);
    const identity = await resolveIdentity(guild, query);

    if (!identity) {
      return redirectWithFlash(res, '/admin/bans', `Konnte "${query}" weder als Discord- noch als Twitch-Konto auflösen.`, 'warning');
    }

    if (identity.type === 'discord') {
      await db.addBan({ type: 'discord', identifier: identity.id, reason, bannedBy: `web:${req.adminSession.twitchLogin}` });

      const existing = await db.getUser(identity.id);
      if (existing) {
        const member = await guild.members.fetch(identity.id).catch(() => null);
        if (member) await roles.removeAllRoles(guild, member);
        if (existing.resultMessageId) {
          try {
            const resultChannel = await client.channels.fetch(config.discord.resultChannelId);
            const oldMessage = await resultChannel.messages.fetch(existing.resultMessageId);
            await oldMessage.delete();
          } catch {
            // ignorieren
          }
        }
        await db.deleteUser(identity.id);
      }

      await sendDM(
        identity.id,
        buildEmbed(
          'Von der Authentifizierung gebannt',
          `Du wurdest von der Authentifizierung von **Lord0099882 Club** wegen **${reason}** gebannt. Falls du mit diesem Grund nicht einverstanden bist, melde dich bitte im Support-Channel.`,
          0xff4444
        ),
        { respectMute: false, label: 'Bann-DM' }
      );
    } else {
      const linkedEntry = await db.findUserByTwitchId(identity.id);
      let affectedDiscordId = null;
      if (linkedEntry) {
        affectedDiscordId = linkedEntry._id;
        const member = await guild.members.fetch(affectedDiscordId).catch(() => null);
        if (member) await roles.removeAllRoles(guild, member);
        if (linkedEntry.resultMessageId) {
          try {
            const resultChannel = await client.channels.fetch(config.discord.resultChannelId);
            const oldMessage = await resultChannel.messages.fetch(linkedEntry.resultMessageId);
            await oldMessage.delete();
          } catch {
            // ignorieren
          }
        }
        await db.deleteUser(affectedDiscordId);

        await sendDM(
          affectedDiscordId,
          buildEmbed(
            'Twitch-Konto gebannt',
            `Dein Twitch-Konto **${identity.displayName}** wurde von der Authentifizierung von **Lord0099882 Club** wegen **${reason}** gebannt.`,
            0xff4444
          ),
          { respectMute: false, label: 'Bann-DM' }
        );
      }

      await db.addBan({
        type: 'twitch',
        identifier: identity.id,
        reason,
        bannedBy: `web:${req.adminSession.twitchLogin}`,
        affectedDiscordId,
      });
    }

    console.log(
      `[Admin-Web] ${req.adminSession.twitchLogin} hat ${identity.type} ${identity.displayName} (${identity.id}) über die Website gebannt. Grund: ${reason}`
    );
    await db.logActivity({
      actor: `web:${req.adminSession.twitchLogin}`,
      action: 'Bann erstellt (Website)',
      details: `${identity.type}: ${identity.displayName} (${identity.id}) - Grund: ${reason}`,
    });
    redirectWithFlash(res, '/admin/bans', `${identity.displayName} wurde gebannt.`, 'success');
  });

  router.post('/bans/:type/:identifier/remove', requireAdmin, verifyCsrf, async (req, res) => {
    const { type, identifier } = req.params;
    const ban = await db.getBan(type, identifier);
    if (!ban) {
      return redirectWithFlash(res, '/admin/bans', 'Dieser Bann existiert nicht mehr.', 'warning');
    }

    await db.removeBan(type, identifier);
    console.log(`[Admin-Web] ${req.adminSession.twitchLogin} hat ${type}:${identifier} über die Website entbannt.`);
    await db.logActivity({
      actor: `web:${req.adminSession.twitchLogin}`,
      action: 'Entbannt (Website)',
      details: `${type}: ${identifier}`,
    });

    const notifyId = type === 'discord' ? identifier : ban.affectedDiscordId;
    if (notifyId) {
      await sendDM(
        notifyId,
        buildEmbed(
          'Entbannt',
          'Dein Konto wurde von der Authentifizierung von **Lord0099882 Club** entbannt. Du kannst dich jetzt erneut mit `/authtwitchuser` verknüpfen.',
          0x57f287
        ),
        { respectMute: false, label: 'Entbannt-DM' }
      );
    }

    redirectWithFlash(res, '/admin/bans', 'Konto entbannt.', 'success');
  });

  return router;
}

module.exports = { createAdminRouter };
