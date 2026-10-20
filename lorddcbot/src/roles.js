const config = require('./config');

function findRole(guild, name) {
  return guild.roles.cache.find((r) => r.name === name);
}

/**
 * Gleicht die Rollen eines Mitglieds mit dem aktuellen Twitch-Status ab.
 * status: { follower: bool, subscriber: bool, moderator: bool }
 * previousStatus: der zuletzt gespeicherte Status (für "Ehemaliger ..."-Logik), oder null beim ersten Mal
 */
async function syncRoles(guild, member, status, previousStatus) {
  const r = config.roles;
  const roleFollower = findRole(guild, r.follower);
  const roleExFollower = findRole(guild, r.exFollower);
  const roleSubscriber = findRole(guild, r.subscriber);
  const roleExSubscriber = findRole(guild, r.exSubscriber);
  const roleModerator = findRole(guild, r.moderator);

  const missing = [];
  [
    [roleFollower, r.follower],
    [roleExFollower, r.exFollower],
    [roleSubscriber, r.subscriber],
    [roleExSubscriber, r.exSubscriber],
    [roleModerator, r.moderator],
  ].forEach(([role, name]) => {
    if (!role) missing.push(name);
  });
  if (missing.length) {
    throw new Error(
      `Folgende Rollen existieren nicht auf dem Server, bitte anlegen: ${missing.join(', ')}`
    );
  }

  const toAdd = [];
  const toRemove = [];

  // Follower
  if (status.follower) {
    toAdd.push(roleFollower);
    toRemove.push(roleExFollower);
  } else {
    toRemove.push(roleFollower);
    const wasFollower = previousStatus ? previousStatus.follower : false;
    if (wasFollower) toAdd.push(roleExFollower);
  }

  // Subscriber
  if (status.subscriber) {
    toAdd.push(roleSubscriber);
    toRemove.push(roleExSubscriber);
  } else {
    toRemove.push(roleSubscriber);
    const wasSubscriber = previousStatus ? previousStatus.subscriber : false;
    if (wasSubscriber) toAdd.push(roleExSubscriber);
  }

  // Moderator (keine "Ehemaliger"-Variante - wird nur entfernt)
  if (status.moderator) {
    toAdd.push(roleModerator);
  } else {
    toRemove.push(roleModerator);
  }

  const uniqueAdd = [...new Set(toAdd)].filter((role) => !member.roles.cache.has(role.id));
  const uniqueRemove = [...new Set(toRemove)].filter((role) => member.roles.cache.has(role.id));

  if (uniqueAdd.length) await member.roles.add(uniqueAdd);
  if (uniqueRemove.length) await member.roles.remove(uniqueRemove);

  const changed = uniqueAdd.length > 0 || uniqueRemove.length > 0;
  const addNames = uniqueAdd.map((r) => r.name);
  const removeNames = uniqueRemove.map((r) => r.name);
  if (changed) {
    console.log(
      `[Rollen] ${member.user.tag} (${member.id}): +[${addNames.join(', ') || '-'}] -[${removeNames.join(', ') || '-'}]`
    );
  }
  return { changed, added: addNames, removed: removeNames };
}

function hasAdminRole(member) {
  return config.roles.adminRoles.some((roleName) =>
    member.roles.cache.some((r) => r.name === roleName)
  );
}

async function addAuthenticatedRole(guild, member) {
  const role = findRole(guild, 'Authentifiziert');
  if (!role) {
    throw new Error('Rolle "Authentifiziert" existiert nicht auf dem Server. Bitte anlegen.');
  }
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role);
  }
}

// Entfernt ALLE Rollen, die der Bot vergibt (für /deleteauth)
async function removeAllRoles(guild, member) {
  const r = config.roles;
  const names = [r.follower, r.exFollower, r.subscriber, r.exSubscriber, r.moderator, 'Authentifiziert'];
  const rolesToRemove = names
    .map((name) => findRole(guild, name))
    .filter((role) => role && member.roles.cache.has(role.id));

  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove);
    console.log(
      `[Rollen] ${member.user.tag} (${member.id}): Verknüpfung gelöscht, entfernt: ${rolesToRemove
        .map((r) => r.name)
        .join(', ')}`
    );
  }
}

module.exports = { syncRoles, hasAdminRole, findRole, addAuthenticatedRole, removeAllRoles };
