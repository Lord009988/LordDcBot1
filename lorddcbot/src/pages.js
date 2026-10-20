// Gemeinsame, minimalistische Seiten-Vorlage für alle HTML-Antworten des Auth-Servers.
// tone bestimmt Farbe/Icon: 'success' | 'error' | 'warning' | 'info'

const TONE_STYLES = {
  success: { color: '#57F287', icon: '✅' },
  error: { color: '#ED4245', icon: '❌' },
  warning: { color: '#FEE75C', icon: '⚠️' },
  info: { color: '#9146FF', icon: 'ℹ️' },
};

function renderPage({ title, heading, message, tone = 'info' }) {
  const { color, icon } = TONE_STYLES[tone] || TONE_STYLES.info;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at top, #1b1830 0%, #0e0d17 65%);
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #e6e6ec;
    padding: 24px;
  }
  .card {
    background: #17151f;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    max-width: 440px;
    width: 100%;
    padding: 36px 32px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.45);
  }
  .icon { font-size: 44px; line-height: 1; margin-bottom: 16px; }
  .brand {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #8b87a3;
    margin-bottom: 14px;
  }
  .accent-bar {
    height: 4px;
    width: 56px;
    margin: 0 auto 22px;
    border-radius: 4px;
    background: ${color};
  }
  h1 { font-size: 21px; margin: 0 0 12px; color: #fff; }
  p { font-size: 15px; line-height: 1.6; color: #b9b6c9; margin: 0; }
  p + p { margin-top: 10px; }
  ul { text-align: left; color: #b9b6c9; font-size: 14px; line-height: 1.6; }
  a { color: #9146FF; }
  code {
    background: rgba(255,255,255,0.06);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">LordDcBot</div>
    <div class="icon">${icon}</div>
    <div class="accent-bar"></div>
    <h1>${heading}</h1>
    <div>${message}</div>
  </div>
</body>
</html>`;
}

const NAV_ITEMS = [
  { key: 'overview', label: 'Übersicht', href: '/admin' },
  { key: 'users', label: 'Nutzer', href: '/admin/users' },
  { key: 'bans', label: 'Bans', href: '/admin/bans' },
  { key: 'logs', label: 'Logs', href: '/admin/logs' },
];

function renderDashboard({ title, activeNav, body, flash, twitchLogin, csrfToken }) {
  const nav = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.href}" class="nav-link${item.key === activeNav ? ' active' : ''}">${item.label}</a>`
  ).join('');

  const flashHtml = flash
    ? `<div class="flash flash-${flash.tone || 'info'}">${flash.message}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — LordDcBot Kontrollzentrum</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: radial-gradient(circle at top, #1b1830 0%, #0e0d17 65%);
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #e6e6ec;
    min-height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 28px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-wrap: wrap;
    gap: 12px;
  }
  .brand-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .brand { font-weight: 700; letter-spacing: 0.04em; color: #fff; font-size: 16px; }
  nav { display: flex; gap: 4px; flex-wrap: wrap; }
  .nav-link {
    color: #b9b6c9;
    text-decoration: none;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
  }
  .nav-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .nav-link.active { background: #9146FF; color: #fff; }
  .who { font-size: 13px; color: #8b87a3; }
  .logout-btn {
    background: none; border: 1px solid rgba(255,255,255,0.15); color: #b9b6c9;
    padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px;
  }
  main { max-width: 980px; margin: 0 auto; padding: 28px; }
  h1 { font-size: 22px; margin: 0 0 20px; color: #fff; }
  h2 { font-size: 16px; margin: 28px 0 12px; color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  @media (max-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  .stat-card {
    background: #17151f;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 18px;
  }
  .stat-card .value { font-size: 26px; font-weight: 700; color: #fff; }
  .stat-card .label { font-size: 13px; color: #8b87a3; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  th { color: #8b87a3; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  tr:hover td { background: rgba(255,255,255,0.03); }
  .btn {
    display: inline-block;
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .btn-primary { background: #9146FF; color: #fff; }
  .btn-danger { background: #ED4245; color: #fff; }
  .btn-secondary { background: rgba(255,255,255,0.08); color: #e6e6ec; }
  .btn-success { background: #57F287; color: #0e0d17; }
  input[type="text"] {
    background: #0e0d17;
    border: 1px solid rgba(255,255,255,0.15);
    color: #e6e6ec;
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 14px;
  }
  .card {
    background: #17151f;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .flash { padding: 12px 16px; border-radius: 8px; margin-bottom: 18px; font-size: 14px; }
  .flash-success { background: rgba(87,242,135,0.12); color: #57F287; }
  .flash-error { background: rgba(237,66,69,0.12); color: #ED4245; }
  .flash-warning { background: rgba(254,231,92,0.12); color: #FEE75C; }
  .flash-info { background: rgba(145,70,255,0.12); color: #b98bff; }
  .log-box {
    background: #0e0d17;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 14px 16px;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 13px;
    max-height: 520px;
    overflow-y: auto;
  }
  .log-line { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); color: #cfcbe0; }
  .log-line:last-child { border-bottom: none; }
  .log-time { color: #8b87a3; }
  .log-actor { color: #b98bff; }
  .log-action { color: #fff; font-weight: 600; }
  .log-details { color: #8b87a3; }
  form.inline { display: inline; }
  .muted { color: #8b87a3; font-size: 13px; }
</style>
</head>
<body>
  <header>
    <div class="brand-row">
      <div class="brand">LordDcBot Kontrollzentrum</div>
      <nav>${nav}</nav>
    </div>
    <div class="brand-row">
      ${twitchLogin ? `<span class="who">Angemeldet als <strong>${twitchLogin}</strong></span>` : ''}
      ${
        twitchLogin
          ? `<form method="POST" action="/admin/logout" class="inline"><input type="hidden" name="_csrf" value="${csrfToken ?? ''}"><button class="logout-btn" type="submit">Abmelden</button></form>`
          : ''
      }
    </div>
  </header>
  <main>
    <h1>${title}</h1>
    ${flashHtml}
    ${body}
  </main>
</body>
</html>`;
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

// entries: Array aus { at, actor, action, details } - neueste zuerst
function renderActivityLog(entries) {
  if (!entries.length) {
    return '<p class="muted">Keine Aktivitäten in den letzten 24 Stunden.</p>';
  }
  const lines = entries
    .map((e) => {
      const time = new Date(e.at).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Berlin',
      });
      const detailsHtml = e.details ? ` <span class="log-details">[${e.details}]</span>` : '';
      return `<div class="log-line"><span class="log-time">${time}</span> — <span class="log-actor">${e.actor}</span> → <span class="log-action">${e.action}</span>${detailsHtml}</div>`;
    })
    .join('');
  return `<div class="log-box">${lines}</div>`;
}

module.exports = { renderPage, renderDashboard, statCard, renderActivityLog };
