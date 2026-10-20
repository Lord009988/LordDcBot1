require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  return v;
}

module.exports = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    commandChannelId: required('COMMAND_CHANNEL_ID'),
    resultChannelId: required('RESULT_CHANNEL_ID'),
    supportChannelId: required('SUPPORT_CHANNEL_ID'),
    logChannelId: required('LOG_CHANNEL_ID'),
  },
  roles: {
    follower: process.env.ROLE_FOLLOWER || 'Twitch Follower',
    exFollower: process.env.ROLE_EX_FOLLOWER || 'Ehemaliger Twitch Follower',
    subscriber: process.env.ROLE_SUBSCRIBER || 'Twitch Abonnent',
    exSubscriber: process.env.ROLE_EX_SUBSCRIBER || 'Ehemaliger Twitch Abonnent',
    moderator: process.env.ROLE_MODERATOR || 'Twitch Moderator',
    adminRoles: (process.env.ADMIN_ROLES || 'Eigentümer,Administrator,Sapphire')
      .split(',')
      .map((r) => r.trim()),
  },
  twitch: {
    clientId: required('TWITCH_CLIENT_ID'),
    clientSecret: required('TWITCH_CLIENT_SECRET'),
    // Der Broadcaster ist dauerhaft fest - nur dieses Konto darf sich im Admin-Panel anmelden
    broadcasterLogin: 'Lord0099882',
  },
  server: {
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
    port: parseInt(process.env.PORT || '3000', 10),
  },
  mongodb: {
    uri: required('MONGODB_URI'),
  },
};
