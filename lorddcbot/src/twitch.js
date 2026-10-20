const axios = require('axios');
const config = require('./config');
const db = require('./db');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';

// ---------- OAuth: Code gegen Token tauschen (für Nutzer UND Broadcaster gleich) ----------
async function exchangeCodeForToken(code, redirectUri) {
  const res = await axios.post(TOKEN_URL, null, {
    params: {
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
  });
  return res.data; // { access_token, refresh_token, expires_in, ... }
}

async function refreshToken(refresh_token) {
  const res = await axios.post(TOKEN_URL, null, {
    params: {
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'refresh_token',
      refresh_token,
    },
  });
  return res.data;
}

// ---------- Nutzerinfo über eigenes Token abrufen ----------
async function getUserInfo(accessToken) {
  const res = await axios.get(`${HELIX}/users`, {
    headers: helixHeaders(accessToken),
  });
  return res.data.data[0]; // { id, login, display_name, ... }
}

function helixHeaders(accessToken) {
  return {
    'Client-Id': config.twitch.clientId,
    Authorization: `Bearer ${accessToken}`,
  };
}

let appTokenCache = null; // { access_token, expiresAt }

// App-Access-Token (Client-Credentials) - unabhängig vom Broadcaster, für reine Namens-/ID-Lookups
async function getAppAccessToken() {
  if (appTokenCache && Date.now() < appTokenCache.expiresAt - 60_000) {
    return appTokenCache.access_token;
  }
  const res = await axios.post(TOKEN_URL, null, {
    params: {
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'client_credentials',
    },
  });
  appTokenCache = {
    access_token: res.data.access_token,
    expiresAt: Date.now() + res.data.expires_in * 1000,
  };
  return appTokenCache.access_token;
}

async function getUserByLogin(login) {
  const token = await getAppAccessToken();
  const res = await axios.get(`${HELIX}/users`, {
    headers: helixHeaders(token),
    params: { login },
  });
  return res.data.data[0] || null;
}

async function getUserById(twitchId) {
  const token = await getAppAccessToken();
  const res = await axios.get(`${HELIX}/users`, {
    headers: helixHeaders(token),
    params: { id: twitchId },
  });
  return res.data.data[0] || null;
}

// ---------- Broadcaster-Token verwalten (mit Auto-Refresh) ----------
async function getValidBroadcasterToken() {
  const stored = await db.getBroadcasterTokens();
  if (!stored) {
    throw new Error(
      'Kein Broadcaster-Token gespeichert. Bitte einmal im Admin-Panel (/admin) mit dem Broadcaster-Konto anmelden.'
    );
  }
  // 60s Puffer vor Ablauf neu holen
  if (Date.now() >= stored.expiresAt - 60_000) {
    const refreshed = await refreshToken(stored.refresh_token);
    const updated = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
    };
    db.setBroadcasterTokens(updated);
    return updated.access_token;
  }
  return stored.access_token;
}

async function getBroadcasterId() {
  const stored = await db.getBroadcasterTokens();
  if (!stored || !stored.twitchId) {
    throw new Error(
      'Kein Broadcaster hinterlegt. Bitte einmal im Admin-Panel (/admin) mit dem Broadcaster-Konto anmelden.'
    );
  }
  return stored.twitchId;
}

// ---------- Status-Checks ----------
async function isFollower(twitchUserId) {
  const token = await getValidBroadcasterToken();
  const broadcasterId = await getBroadcasterId();
  const res = await axios.get(`${HELIX}/channels/followers`, {
    headers: helixHeaders(token),
    params: { broadcaster_id: broadcasterId, user_id: twitchUserId },
  });
  return res.data.data.length > 0;
}

async function isSubscriber(twitchUserId) {
  const token = await getValidBroadcasterToken();
  const broadcasterId = await getBroadcasterId();
  try {
    const res = await axios.get(`${HELIX}/subscriptions`, {
      headers: helixHeaders(token),
      params: { broadcaster_id: broadcasterId, user_id: twitchUserId },
    });
    return res.data.data.length > 0;
  } catch (err) {
    if (err.response && err.response.status === 404) return false; // nicht abonniert
    throw err;
  }
}

async function isModerator(twitchUserId) {
  const token = await getValidBroadcasterToken();
  const broadcasterId = await getBroadcasterId();
  const res = await axios.get(`${HELIX}/moderation/moderators`, {
    headers: helixHeaders(token),
    params: { broadcaster_id: broadcasterId, user_id: twitchUserId },
  });
  return res.data.data.length > 0;
}

async function getFullStatus(twitchUserId) {
  const [follower, subscriber, moderator] = await Promise.all([
    isFollower(twitchUserId),
    isSubscriber(twitchUserId),
    isModerator(twitchUserId),
  ]);
  return { follower, subscriber, moderator };
}

module.exports = {
  exchangeCodeForToken,
  refreshToken,
  getUserInfo,
  getValidBroadcasterToken,
  getBroadcasterId,
  getFullStatus,
  getAppAccessToken,
  getUserByLogin,
  getUserById,
};
