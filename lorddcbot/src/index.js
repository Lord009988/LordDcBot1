const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const axios = require('axios');
const cron = require('node-cron');
const config = require('./config');
const db = require('./db');
const twitch = require('./twitch');
const roles = require('./roles');
const { createServer } = require('./server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

// ---------- Hilfsfunktionen ----------
function buildEmbed(title, description, color = 0x9146ff) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

// Schickt eine DM an einen Nutzer. Respektiert standardmäßig die Stummschaltung (/mutebot),
// außer respectMute:false wird übergeben (für Bann-/Sicherheits-relevante Nachrichten).
// Bei fehlgeschlagener Zustellung (z. B. Nutzer hat den Bot blockiert) wird das in #logs protokolliert.
async function sendDM(discordId, embed, { respectMute = true, label = 'Nachricht' } = {}) {
  if (respectMute) {
    const entry = await db.getUser(discordId);
    if (entry?.muted) return;
  }
  try {
    const user = await client.users.fetch(discordId);
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Konnte DM nicht senden an ${discordId}:`, err.message);
    try {
      const logChannel = await client.channels.fetch(config.discord.logChannelId);
      await logChannel.send(`⚠️ ${label} konnte nicht an <@${discordId}> (${discordId}) zugestellt werden.`);
    } catch (logErr) {
      console.error('Konnte auch nicht ins Log-Channel schreiben:', logErr.message);
    }
  }
}

// Schickt nachträglich noch eine Nachricht zu einer bereits beantworteten Interaction
// (z. B. nachdem der Nutzer den Twitch-Login im Browser abgeschlossen hat).
// Funktioniert bis zu 15 Minuten nach der ursprünglichen Interaction.
async function sendFollowup(interactionToken, payload) {
  if (!interactionToken) return;
  try {
    await axios.post(
      `https://discord.com/api/v10/webhooks/${config.discord.clientId}/${interactionToken}`,
      { ...payload, flags: MessageFlags.Ephemeral }
    );
  } catch (err) {
    console.error(
      'Konnte Discord-Followup nicht senden (Interaction evtl. abgelaufen):',
      err.response?.data || err.message
    );
  }
}

// Findet einen Discord- ODER Twitch-Account über Name/ID/Mention - unabhängig davon, ob
// schon eine Verknüpfung existiert (für Bann/Entbann im Admin-Panel). Gibt { type, id, displayName } zurück.
async function resolveIdentity(guild, rawQuery) {
  const query = rawQuery.trim();
  const mentionMatch = query.match(/^<@!?(\d+)>$/);
  const looksLikeDiscordId = /^\d{15,20}$/.test(query);

  if (mentionMatch || looksLikeDiscordId) {
    const discordId = mentionMatch ? mentionMatch[1] : query;
    const member = await guild.members.fetch(discordId).catch(() => null);
    return { type: 'discord', id: discordId, displayName: member ? member.user.tag : discordId };
  }

  // Namens-/Nickname-Suche unter aktuellen Server-Mitgliedern
  try {
    const found = await guild.members.fetch({ query, limit: 1 });
    const member = found.first();
    if (member) return { type: 'discord', id: member.id, displayName: member.user.tag };
  } catch {
    // keine Treffer unter Discord-Mitgliedern - als Twitch-Identifier weiterprobieren
  }

  const twitchUser = /^\d+$/.test(query)
    ? await twitch.getUserById(query)
    : await twitch.getUserByLogin(query.toLowerCase());
  if (twitchUser) {
    return { type: 'twitch', id: twitchUser.id, displayName: twitchUser.display_name };
  }

  return null;
}

function statusText(status) {
  const flags = [];
  if (status?.follower) flags.push('Follower');
  if (status?.subscriber) flags.push('Abonnent');
  if (status?.moderator) flags.push('Moderator');
  return flags.length ? flags.join(', ') : 'weder Follower, Abonnent noch Moderator';
}

async function processAuthenticatedUser({
  discordId,
  interactionToken,
  twitchId,
  twitchLogin,
  twitchDisplayName,
}) {
  const guild = await client.guilds.fetch(config.discord.guildId);
  const member = await guild.members.fetch(discordId);

  // Schutz: Ist der Discord-Nutzer gebannt? (Sollte durch den Command-Check schon abgefangen sein,
  // aber falls der Vorgang mitten im Flow gebannt wurde, hier nochmal absichern)
  const discordBan = await db.getBan('discord', discordId);
  if (discordBan) {
    console.log(`[Auth] Abgelehnt (gebannt): Discord ${discordId} versuchte zu verknüpfen.`);
    const embed = buildEmbed(
      'Gebannt',
      `Du bist von der Authentifizierung gebannt. Grund: **${discordBan.reason}**\n\nFalls du damit nicht einverstanden bist, melde dich bitte in <#${config.discord.supportChannelId}>.`,
      0xff4444
    );
    await sendFollowup(interactionToken, { embeds: [embed.toJSON()] });
    return;
  }

  // Schutz: Ist dieses Twitch-Konto gebannt?
  const twitchBan = await db.getBan('twitch', twitchId);
  if (twitchBan) {
    console.log(`[Auth] Abgelehnt (gebannt): Twitch ${twitchDisplayName} (${twitchId}) ist gebannt.`);
    const embed = buildEmbed(
      'Twitch-Konto gebannt',
      `Dieses Twitch-Konto ist von der Verknüpfung mit **Lord0099882 Club** gebannt. Grund: **${twitchBan.reason}**\n\nFalls du damit nicht einverstanden bist, melde dich bitte in <#${config.discord.supportChannelId}>.`,
      0xff4444
    );
    await sendFollowup(interactionToken, { embeds: [embed.toJSON()] });
    return;
  }

  // Schutz: Ist dieses Twitch-Konto bereits mit einem ANDEREN Discord-Konto verknüpft?
  const twitchOwner = await db.findUserByTwitchId(twitchId);
  if (twitchOwner && twitchOwner._id !== discordId) {
    console.log(
      `[Auth] Abgelehnt: Twitch ${twitchDisplayName} (${twitchId}) ist bereits mit Discord ${twitchOwner._id} verknüpft (Versuch von ${discordId}).`
    );
    const embed = buildEmbed(
      'Konto bereits verknüpft',
      `Dieses Twitch-Konto ist bereits mit einem anderen Discord-Konto verknüpft. Falls es sich um dein eigenes (anderes) Konto handelt: Melde dich dort an und lösche die Verknüpfung mit \`/deleteauth\` – anschließend kannst du es hier erneut versuchen.\n\nFalls du auf das andere Konto keinen Zugriff mehr hast, eröffne bitte ein Ticket in <#${config.discord.supportChannelId}> und schildere dein Anliegen. Bitte hab etwas Geduld – unser Team kann nicht immer sofort helfen.\n\nAlternativ kannst du dich auch an den offiziellen Discord-Support wenden: https://support.discord.com/hc/requests/new`,
      0xff4444
    );
    await sendFollowup(interactionToken, { embeds: [embed.toJSON()] });
    return;
  }

  const previousEntry = await db.getUser(discordId);
  const previousStatus = previousEntry ? previousEntry.status : null;

  const status = await twitch.getFullStatus(twitchId);

  await roles.syncRoles(guild, member, status, previousStatus);
  await roles.addAuthenticatedRole(guild, member);

  const resultChannel = await client.channels.fetch(config.discord.resultChannelId);
  const sentMessage = await resultChannel.send(
    `Discord: ${member.user.username} [${discordId}] | Twitch: ${twitchDisplayName} [${twitchId}]`
  );

  await db.setUser(discordId, {
    discordUsername: member.user.username,
    twitchId,
    twitchLogin,
    twitchDisplayName,
    status,
    resultMessageId: sentMessage.id,
    lastCheckedAt: Date.now(),
  });

  console.log(
    `[Auth] Verknüpft: Discord ${member.user.tag} (${discordId}) <-> Twitch ${twitchDisplayName} (${twitchId})`
  );

  const embed = buildEmbed(
    'Erfolgreich verbunden!',
    `Dein Twitch-Konto **${twitchDisplayName}** wurde erfolgreich mit deinem Discord-Konto verknüpft.`,
    0x57f287
  );
  await sendFollowup(interactionToken, { embeds: [embed.toJSON()] });

  // DM 1: Bitte den Bot nicht blockieren
  await sendDM(
    discordId,
    buildEmbed(
      'Bitte nicht blockieren',
      'Bitte blockier diesen Bot nicht. Dieser Bot gibt dir nützliche Informationen über **Lord0099882 Club** und deiner Twitch-Verknüpfung. Diese Nachrichten können mit `/mutebot` ausgeschaltet werden.',
      0x9146ff
    ),
    { label: 'Hinweis-DM' }
  );

  // DM 2: Rollen-/Status-Info
  await sendDM(
    discordId,
    buildEmbed(
      'Twitch-Verknüpfung abgeschlossen',
      `Dein Twitch-Konto **${twitchDisplayName}** wurde verknüpft.\n\nDu bist aktuell: **${statusText(status)}**`,
      0x57f287
    ),
    { label: 'Status-DM' }
  );
}

// ---------- Auth-Server starten ----------
createServer({
  onUserAuthenticated: processAuthenticatedUser,
  client,
  roles,
  sendDM,
  buildEmbed,
  recheckAllUsers,
  resolveIdentity,
  statusText,
});

// Formatiert die genutzten Optionen eines Slash-Commands für das Aktivitäts-Log
function formatCommandOptions(interaction) {
  const data = interaction.options?.data;
  if (!data || !data.length) return '';
  return data.map((opt) => `${opt.name}: ${opt.value}`).join(', ');
}

// ---------- Slash-Commands & Buttons ----------
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await db
      .logActivity({
        actor: interaction.user.tag,
        action: `/${interaction.commandName}`,
        details: formatCommandOptions(interaction),
      })
      .catch((err) => console.error('Konnte Aktivität nicht loggen:', err.message));
  }

  // /authtwitchuser
  if (interaction.isChatInputCommand() && interaction.commandName === 'authtwitchuser') {
    if (interaction.channelId !== config.discord.commandChannelId) {
      return interaction.reply({
        content: `Diesen Befehl kannst du nur in <#${config.discord.commandChannelId}> benutzen.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const existing = await db.getUser(interaction.user.id);
    if (existing) {
      const embed = buildEmbed(
        'Bereits verknüpft',
        'Du bist bereits mit einem Twitch-Konto verknüpft. Nutze den Befehl `/deleteauth`, um deine bestehende Verknüpfung zu löschen. Danach kannst du dich mit einem anderen Twitch-Konto neu verbinden.',
        0xffcc00
      );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const discordBan = await db.getBan('discord', interaction.user.id);
    if (discordBan) {
      const embed = buildEmbed(
        'Gebannt',
        `Du bist von der Authentifizierung gebannt. Grund: **${discordBan.reason}**\n\nFalls du damit nicht einverstanden bist, melde dich bitte in <#${config.discord.supportChannelId}>.`,
        0xff4444
      );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const authUrl = `${config.server.publicUrl}/auth/twitch?discordId=${interaction.user.id}&interactionToken=${encodeURIComponent(interaction.token)}`;

    const embed = buildEmbed(
      'Twitch-Konto verknüpfen',
      'Klicke auf den Button, um dich mit deinem Twitch-Konto zu authentifizieren.'
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Mit Twitch verbinden').setStyle(ButtonStyle.Link).setURL(authUrl)
    );

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }

  // /deleteauth
  if (interaction.isChatInputCommand() && interaction.commandName === 'deleteauth') {
    if (interaction.channelId !== config.discord.commandChannelId) {
      return interaction.reply({
        content: `Diesen Befehl kannst du nur in <#${config.discord.commandChannelId}> benutzen.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const existing = await db.getUser(interaction.user.id);
    if (!existing) {
      const embed = buildEmbed(
        'Keine Verknüpfung',
        'Du hast aktuell kein verknüpftes Twitch-Konto.',
        0xffcc00
      );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const embed = buildEmbed(
      'Verknüpfung löschen?',
      `Möchtest du deine Verknüpfung mit **${existing.twitchDisplayName}** wirklich löschen? Dabei werden alle Twitch-Rollen entfernt. Das kann nicht rückgängig gemacht werden.`,
      0xff4444
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`deleteauth_confirm_${interaction.user.id}`)
        .setLabel('Ja, wirklich löschen')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`deleteauth_cancel_${interaction.user.id}`)
        .setLabel('Abbrechen')
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }

  // /mutebot (im Command-Channel, einmalige Bestätigung)
  if (interaction.isChatInputCommand() && interaction.commandName === 'mutebot') {
    if (interaction.channelId !== config.discord.commandChannelId) {
      return interaction.reply({
        content: `Diesen Befehl kannst du nur in <#${config.discord.commandChannelId}> benutzen.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = buildEmbed(
      'Bot stummschalten?',
      'Du bekommst dann keine Status-/Rollen-Update-Nachrichten mehr per DM (Bann-Benachrichtigungen bleiben davon unberührt). Bereits gesendete Nachrichten werden dabei nicht zurückgeholt. Fortfahren?',
      0xffcc00
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mutebot_confirm_${interaction.user.id}`)
        .setLabel('Ja, stummschalten')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`mutebot_cancel_${interaction.user.id}`)
        .setLabel('Abbrechen')
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }

  // /unmutebot (im Command-Channel, keine Bestätigung nötig)
  if (interaction.isChatInputCommand() && interaction.commandName === 'unmutebot') {
    if (interaction.channelId !== config.discord.commandChannelId) {
      return interaction.reply({
        content: `Diesen Befehl kannst du nur in <#${config.discord.commandChannelId}> benutzen.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await db.setUser(interaction.user.id, { muted: false });
    const embed = buildEmbed(
      'Bot entstummt',
      'Du bekommst ab jetzt wieder Status-/Rollen-Update-Nachrichten per DM.',
      0x57f287
    );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.isButton() && interaction.customId.startsWith('deleteauth_')) {
    const [, action, ownerId] = interaction.customId.split('_');

    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: 'Das ist nicht deine Anfrage.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'cancel') {
      await db.logActivity({ actor: interaction.user.tag, action: '/deleteauth abgebrochen' });
      const embed = buildEmbed('Abgebrochen', 'Deine Verknüpfung wurde nicht verändert.', 0x808080);
      return interaction.update({ embeds: [embed], components: [] });
    }

    if (action === 'confirm') {
      await interaction.deferUpdate();

      const guild = await client.guilds.fetch(config.discord.guildId);
      const member = await guild.members.fetch(ownerId).catch(() => null);
      const existing = await db.getUser(ownerId);

      if (member) {
        await roles.removeAllRoles(guild, member);
      }

      if (existing && existing.resultMessageId) {
        try {
          const resultChannel = await client.channels.fetch(config.discord.resultChannelId);
          const oldMessage = await resultChannel.messages.fetch(existing.resultMessageId);
          await oldMessage.delete();
        } catch (err) {
          console.error('Konnte alte Ergebnis-Nachricht nicht löschen:', err.message);
        }
      }

      await db.deleteUser(ownerId);
      console.log(
        `[Deleteauth] ${member ? member.user.tag : ownerId} (${ownerId}) hat seine Verknüpfung gelöscht.`
      );
      await db.logActivity({ actor: interaction.user.tag, action: '/deleteauth bestätigt & ausgeführt' });

      const embed = buildEmbed(
        'Verknüpfung gelöscht',
        'Deine Twitch-Verknüpfung und alle zugehörigen Rollen wurden entfernt.',
        0x57f287
      );
      return interaction.editReply({ embeds: [embed], components: [] });
    }
  }

  // Buttons für /mutebot (1x Bestätigung)
  if (interaction.isButton() && interaction.customId.startsWith('mutebot_')) {
    const [, action, ownerId] = interaction.customId.split('_');

    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: 'Das ist nicht deine Anfrage.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'cancel') {
      await db.logActivity({ actor: interaction.user.tag, action: '/mutebot abgebrochen' });
      return interaction.update({
        embeds: [buildEmbed('Abgebrochen', 'Du bekommst weiterhin Status-/Rollen-Update-DMs.', 0x808080)],
        components: [],
      });
    }

    if (action === 'confirm') {
      await db.setUser(ownerId, { muted: true });
      await db.logActivity({ actor: interaction.user.tag, action: '/mutebot bestätigt & ausgeführt' });
      await interaction.update({
        embeds: [
          buildEmbed(
            'Stummgeschaltet',
            'Du bekommst keine weiteren Status-/Rollen-Update-DMs mehr, bis du `/unmutebot` ausführst.',
            0x57f287
          ),
        ],
        components: [],
      });
      // Letzte DM - muss respectMute:false sein, da "muted" gerade erst gesetzt wurde
      await sendDM(
        ownerId,
        buildEmbed(
          'Bot stummgeschaltet',
          'Du hast den Bot stummgeschaltet. Ab jetzt bekommst du keine weiteren Status-/Rollen-Update-Nachrichten mehr per DM, bis du `/unmutebot` ausführst. Bereits gesendete Nachrichten werden dabei nicht zurückgeholt.',
          0x9146ff
        ),
        { respectMute: false, label: 'Mute-Bestätigungs-DM' }
      );
    }
  }
});

// ---------- Nachrichten im Command- und Support-Channel löschen (außer Bot & Admin-Rollen) ----------
client.on('messageCreate', async (message) => {
  const monitoredChannels = [config.discord.commandChannelId, config.discord.supportChannelId];
  if (!monitoredChannels.includes(message.channelId)) return;
  if (message.author.bot) return;

  try {
    const member = message.member ?? (await message.guild.members.fetch(message.author.id));
    if (roles.hasAdminRole(member)) return;
    await message.delete();
  } catch (err) {
    console.error('Konnte Nachricht nicht löschen:', err.message);
  }
});

// ---------- Regelmäßiger Check aller gespeicherten Nutzer ----------
async function recheckAllUsers() {
  console.log('[Recheck] Start.');
  const users = await db.getAllUsers();
  const total = Object.keys(users).length;
  let changedCount = 0;

  for (const [discordId, entry] of Object.entries(users)) {
    try {
      const guild = await client.guilds.fetch(config.discord.guildId);
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue; // Nutzer nicht mehr auf dem Server

      const previousStatus = entry.status || null;
      const status = await twitch.getFullStatus(entry.twitchId);

      await db.setUser(discordId, { status, lastCheckedAt: Date.now() });
      const result = await roles.syncRoles(guild, member, status, previousStatus);
      await roles.addAuthenticatedRole(guild, member); // Punkt 3: "Authentifiziert" beim Recheck absichern

      if (result.changed) {
        changedCount++;
        const addedText = result.added.length ? `+ ${result.added.join(', +')}` : '';
        const removedText = result.removed.length ? `- ${result.removed.join(', -')}` : '';
        const changeText = [addedText, removedText].filter(Boolean).join('\n');
        await sendDM(
          discordId,
          buildEmbed(
            'Deine Rollen haben sich geändert',
            `Bei der regelmäßigen Überprüfung haben sich deine Rollen geändert:\n${changeText}\n\nDu bist jetzt: **${statusText(status)}**`,
            0x9146ff
          ),
          { label: 'Rollenänderungs-DM' }
        );
      }
    } catch (err) {
      console.error(`[Recheck] Fehler bei ${discordId}:`, err.message);
    }
  }
  console.log(`[Recheck] Ende. ${total} Nutzer geprüft, ${changedCount} mit Rollenänderung.`);
  return { total, changedCount };
}

client.once('clientReady', () => {
  console.log(`${client.user.tag} ist online.`);
  recheckAllUsers(); // einmal beim Start
  cron.schedule('0 18 * * *', recheckAllUsers, { timezone: 'Europe/Berlin' }); // täglich um 18:00 Uhr deutscher Zeit
});

client.login(config.discord.token);
