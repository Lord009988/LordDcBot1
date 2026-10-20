const { MongoClient } = require('mongodb');
const config = require('./config');

let client;
let db;

async function connect() {
  if (db) return db;
  client = new MongoClient(config.mongodb.uri);
  await client.connect();
  db = client.db('lorddcbot');
  // TTL-Indizes: Sessions verfallen automatisch (expiresAt), Aktivitäts-Log nach 3 Tagen
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('activityLog').createIndex({ at: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });
  console.log('Mit MongoDB verbunden.');
  return db;
}

module.exports = {
  connect,

  async getBroadcasterTokens() {
    const database = await connect();
    const doc = await database.collection('broadcaster').findOne({ _id: 'singleton' });
    return doc || null;
  },

  async setBroadcasterTokens(tokens) {
    const database = await connect();
    await database
      .collection('broadcaster')
      .updateOne({ _id: 'singleton' }, { $set: tokens }, { upsert: true });
  },

  async getUser(discordId) {
    const database = await connect();
    const doc = await database.collection('users').findOne({ _id: discordId });
    return doc || null;
  },

  async getAllUsers() {
    const database = await connect();
    const docs = await database.collection('users').find({}).toArray();
    const result = {};
    for (const doc of docs) result[doc._id] = doc;
    return result;
  },

  async setUser(discordId, userData) {
    const database = await connect();
    await database
      .collection('users')
      .updateOne({ _id: discordId }, { $set: userData }, { upsert: true });
  },

  async deleteUser(discordId) {
    const database = await connect();
    await database.collection('users').deleteOne({ _id: discordId });
  },

  async findUserByTwitchId(twitchId) {
    const database = await connect();
    const doc = await database.collection('users').findOne({ twitchId });
    return doc || null;
  },

  // ---------- Bans (type: 'discord' | 'twitch', identifier: discordId bzw. numerische Twitch-ID) ----------
  async addBan({ type, identifier, reason, bannedBy, affectedDiscordId = null }) {
    const database = await connect();
    await database.collection('bans').updateOne(
      { _id: `${type}:${identifier}` },
      { $set: { type, identifier, reason, bannedBy, affectedDiscordId, bannedAt: Date.now() } },
      { upsert: true }
    );
  },

  async getBan(type, identifier) {
    const database = await connect();
    const doc = await database.collection('bans').findOne({ _id: `${type}:${identifier}` });
    return doc || null;
  },

  async removeBan(type, identifier) {
    const database = await connect();
    await database.collection('bans').deleteOne({ _id: `${type}:${identifier}` });
  },

  async getAllBans() {
    const database = await connect();
    return database.collection('bans').find({}).toArray();
  },

  // ---------- Admin-Panel: Sessions ----------
  async createSession(session) {
    const database = await connect();
    await database.collection('sessions').insertOne(session);
  },

  async getSession(sessionId) {
    const database = await connect();
    const doc = await database.collection('sessions').findOne({ _id: sessionId });
    if (doc && doc.expiresAt.getTime() < Date.now()) {
      await database.collection('sessions').deleteOne({ _id: sessionId });
      return null;
    }
    return doc || null;
  },

  async deleteSession(sessionId) {
    const database = await connect();
    await database.collection('sessions').deleteOne({ _id: sessionId });
  },

  // ---------- Admin-Panel: Aktivitäts-Log (wer hat wann was gemacht) ----------
  async logActivity({ actor, action, details = '' }) {
    const database = await connect();
    await database.collection('activityLog').insertOne({ actor, action, details, at: new Date() });
  },

  async getActivityLast24h() {
    const database = await connect();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return database
      .collection('activityLog')
      .find({ at: { $gte: since } })
      .sort({ at: -1 })
      .toArray();
  },
};
