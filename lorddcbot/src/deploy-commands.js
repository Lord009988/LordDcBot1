const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

const commands = [
  new SlashCommandBuilder()
    .setName('authtwitchuser')
    .setDescription('Verknüpfe dein Twitch-Konto mit deinem Discord-Konto'),
  new SlashCommandBuilder()
    .setName('deleteauth')
    .setDescription('Lösche deine Twitch-Verknüpfung und alle zugehörigen Rollen'),
  new SlashCommandBuilder()
    .setName('mutebot')
    .setDescription('Schaltet Status-/Rollen-Benachrichtigungen des Bots per DM stumm'),
  new SlashCommandBuilder()
    .setName('unmutebot')
    .setDescription('Schaltet Status-/Rollen-Benachrichtigungen des Bots per DM wieder ein'),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discord.token);

(async () => {
  try {
    console.log('Registriere Slash-Commands...');
    // Ersetzt die komplette Befehlsliste des Servers - entfernte Befehle verschwinden dadurch aus Discord
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commands }
    );
    console.log('Slash-Commands erfolgreich registriert.');
  } catch (err) {
    console.error(err);
  }
})();
