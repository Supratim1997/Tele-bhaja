import express, { Request, Response } from 'express';
import http from 'http';
import { listSessions, approveSession, denySession, revokeSession, pruneExpiredSessions } from './store.js';
import { config } from '../config.js';

export function createAdminApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Dashboard API
  app.get('/api/sessions', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const data = listSessions();
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...data,
    });
  });

  app.post('/api/approve', async (req: Request, res: Response) => {
    const { sessionId, durationHours } = req.body;
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'Missing sessionId' });
    }
    const hours = typeof durationHours === 'number' && durationHours > 0 
      ? durationHours 
      : config.gate.defaultDurationHours;

    const session = await approveSession(sessionId, hours);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }
    res.json({ ok: true, session });
  });

  app.post('/api/deny', async (req: Request, res: Response) => {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'Missing sessionId' });
    }
    const session = await denySession(sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }
    res.json({ ok: true, session });
  });

  app.post('/api/revoke', async (req: Request, res: Response) => {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'Missing sessionId' });
    }
    const session = await revokeSession(sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }
    res.json({ ok: true, session });
  });

  app.post('/api/prune', async (_req: Request, res: Response) => {
    const count = await pruneExpiredSessions();
    res.json({ ok: true, pruned: count });
  });

  // Admin UI
  app.get(['/', '/admin'], (_req: Request, res: Response) => {
    res.send(renderAdminDashboard());
  });

  return app;
}

/**
 * Start dual-listener for Admin Portal:
 * Strictly binds to 127.0.0.1 and Tailscale IP. NEVER 0.0.0.0.
 */
export function startAdminPortal(port: number, tailscaleIp?: string): {
  servers: http.Server[];
  close: () => Promise<void>;
} {
  const app = createAdminApp();
  const servers: http.Server[] = [];

  // 1. Loopback binding
  const localServer = http.createServer(app);
  localServer.listen(port, '127.0.0.1', () => {
    console.log(`[AdminGate] Private Admin Portal listening locally at http://127.0.0.1:${port}`);
  });
  servers.push(localServer);

  // 2. Tailscale interface binding (if available)
  if (tailscaleIp && tailscaleIp !== '127.0.0.1') {
    try {
      const tailscaleServer = http.createServer(app);
      tailscaleServer.listen(port, tailscaleIp, () => {
        console.log(`[AdminGate] Private Admin Portal bound to Tailscale mesh at http://${tailscaleIp}:${port}`);
      });
      tailscaleServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRNOTAVAIL') {
          console.warn(`[AdminGate] Tailscale IP ${tailscaleIp} is not available on this interface yet.`);
        } else {
          console.error(`[AdminGate] Tailscale bind error:`, err.message);
        }
      });
      servers.push(tailscaleServer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AdminGate] Could not bind to Tailscale IP ${tailscaleIp}: ${msg}`);
    }
  }

  return {
    servers,
    close: async () => {
      await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    },
  };
}

function renderAdminDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TeleBhaja Gatekeeper - Admin Portal</title>
  <style>
    :root {
      --bg: #090c15;
      --card-bg: #111827;
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #f59e0b;
      --success: #10b981;
      --danger: #ef4444;
      --info: #3b82f6;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 1.5rem 1rem;
    }

    .wrapper {
      max-width: 1024px;
      margin: 0 auto;
    }

    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--card-border);
    }

    .brand-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.4rem;
      font-weight: 800;
    }

    .vpn-badge {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.3rem 0.75rem;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }

    .vpn-badge::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .stat-val {
      font-size: 2rem;
      font-weight: 800;
      line-height: 1;
    }

    .stat-val.pending { color: var(--primary); }
    .stat-val.approved { color: var(--success); }
    .stat-val.history { color: var(--text-muted); }

    .section-title {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .section-badge {
      font-size: 0.8rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }

    .panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.25rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }

    .empty-state {
      text-align: center;
      padding: 2.5rem 1rem;
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .request-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .request-item {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      transition: border-color 0.2s;
    }

    .request-item:hover {
      border-color: rgba(255, 255, 255, 0.2);
    }

    .request-meta {
      flex: 1 1 300px;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .meta-top {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .client-ip {
      font-family: ui-monospace, monospace;
      font-size: 0.95rem;
      font-weight: 700;
      color: #fff;
    }

    .client-time {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .user-agent {
      font-size: 0.8rem;
      color: #9ca3af;
      word-break: break-all;
    }

    .request-actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }

    .duration-select {
      background: #1f2937;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 0.45rem 0.75rem;
      border-radius: 6px;
      font-size: 0.825rem;
      cursor: pointer;
    }

    .btn {
      padding: 0.45rem 0.9rem;
      border-radius: 6px;
      font-size: 0.825rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      transition: filter 0.15s, transform 0.1s;
    }

    .btn:active { transform: scale(0.98); }
    .btn-approve {
      background: #10b981;
      color: #064e3b;
      font-weight: 700;
    }
    .btn-approve:hover { filter: brightness(1.15); }

    .btn-deny {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }
    .btn-deny:hover { background: rgba(239, 68, 68, 0.25); }

    .btn-revoke {
      background: #ef4444;
      color: #fff;
    }
    .btn-revoke:hover { filter: brightness(1.15); }

    .btn-prune {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: var(--text-muted);
    }
    .btn-prune:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }

    .countdown {
      font-family: ui-monospace, monospace;
      font-size: 0.8rem;
      color: #34d399;
      background: rgba(16, 185, 129, 0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .table-container {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      text-align: left;
    }

    th {
      padding: 0.75rem 0.5rem;
      color: var(--text-muted);
      border-bottom: 1px solid var(--card-border);
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    td {
      padding: 0.75rem 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }

    .badge-status {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .badge-status.approved { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .badge-status.denied { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .badge-status.revoked { background: rgba(156, 163, 175, 0.15); color: #9ca3af; }

    #toast {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      background: #1f2937;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 0.85rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
    }
  </style>
</head>
<body>

  <div class="wrapper">
    <header>
      <div>
        <div class="brand-title">
          <span>🎬 TeleBhaja Gatekeeper</span>
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.2rem;">
          Two-Tier Reverse Proxy Interception & Remote Approval Engine
        </p>
      </div>
      <div>
        <span class="vpn-badge">Tailscale / Localhost Only</span>
      </div>
    </header>

    <!-- Stat counters -->
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Pending Requests</span>
        <span class="stat-val pending" id="statPending">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Active Approved</span>
        <span class="stat-val approved" id="statApproved">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Past History</span>
        <span class="stat-val history" id="statHistory">0</span>
      </div>
    </div>

    <!-- Pending Requests Panel -->
    <div class="panel">
      <div class="section-title">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span>Active Pending Requests</span>
          <span class="section-badge" id="pendingCountBadge">0 waiting</span>
        </div>
        <button class="btn btn-prune" onclick="loadSessions()" style="font-size: 0.8rem; padding: 0.3rem 0.7rem;">🔄 Refresh</button>
      </div>
      <div id="pendingContainer">
        <div class="empty-state">No pending visitor requests.</div>
      </div>
    </div>

    <!-- Active Approved Sessions -->
    <div class="panel">
      <div class="section-title">
        <span>Active Approved Sessions</span>
        <span class="section-badge" id="approvedCountBadge">0 active</span>
      </div>
      <div id="approvedContainer">
        <div class="empty-state">No currently active approved sessions.</div>
      </div>
    </div>

    <!-- Session History Panel -->
    <div class="panel">
      <div class="section-title">
        <span>Session History</span>
        <button class="btn btn-prune" onclick="pruneHistory()">Clean Expired</button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>IP Address</th>
              <th>Device / Agent</th>
              <th>Created</th>
              <th>Approved / Expired</th>
            </tr>
          </thead>
          <tbody id="historyTbody">
            <tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No history records.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    let pollTimer = null;

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 2500);
    }

    function timeAgo(isoDate) {
      if (!isoDate) return '';
      const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
      if (diff < 60) return diff + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function timeRemaining(isoExpires) {
      if (!isoExpires) return '';
      const diff = Math.floor((new Date(isoExpires).getTime() - Date.now()) / 1000);
      if (diff <= 0) return 'Expired';
      const hours = Math.floor(diff / 3600);
      const mins = Math.floor((diff % 3600) / 60);
      const secs = diff % 60;
      if (hours > 0) return hours + 'h ' + mins + 'm remaining';
      return mins + 'm ' + secs + 's remaining';
    }

    function parseDevice(ua) {
      if (!ua) return 'Unknown Device';
      if (ua.includes('iPhone')) return '📱 iPhone / Safari';
      if (ua.includes('iPad')) return '📱 iPad';
      if (ua.includes('Android')) return '📱 Android Device';
      if (ua.includes('Macintosh')) return '💻 Mac / Safari';
      if (ua.includes('Windows')) return '💻 Windows PC';
      if (ua.includes('Linux')) return '💻 Linux';
      return ua.slice(0, 30);
    }

    async function loadSessions() {
      try {
        const res = await fetch('/api/sessions?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();

        // Stats
        document.getElementById('statPending').textContent = data.pending.length;
        document.getElementById('statApproved').textContent = data.approved.length;
        document.getElementById('statHistory').textContent = data.history.length;
        document.getElementById('pendingCountBadge').textContent = data.pending.length + ' waiting';
        document.getElementById('approvedCountBadge').textContent = data.approved.length + ' active';

        renderPending(data.pending);
        renderApproved(data.approved);
        renderHistory(data.history);
      } catch (err) {
        console.error('Failed to load sessions', err);
      }
    }

    function renderPending(list) {
      var container = document.getElementById('pendingContainer');
      if (!list || list.length === 0) {
        container.innerHTML = '<div class="empty-state">No pending visitor requests.</div>';
        return;
      }

      var html = '<div class="request-list">';
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var shortId = item.sessionId.length > 16 ? item.sessionId.slice(0, 10) + '...' + item.sessionId.slice(-4) : item.sessionId;
        html += '<div class="request-item">' +
          '<div class="request-meta">' +
            '<div class="meta-top">' +
              '<span class="client-ip">' + escapeHtml(item.clientIp) + '</span>' +
              '<span style="font-family: monospace; font-size: 0.75rem; background: rgba(255,255,255,0.06); padding: 0.15rem 0.4rem; border-radius: 4px; color: #fbbf24;" title="' + item.sessionId + '">' + shortId + '</span>' +
              '<span class="client-time">Requested ' + timeAgo(item.createdAt) + '</span>' +
            '</div>' +
            '<div class="user-agent">' + parseDevice(item.userAgent) + ' &bull; ' + escapeHtml(item.userAgent.slice(0, 48)) + '</div>' +
          '</div>' +
          '<div class="request-actions">' +
            '<select class="duration-select" id="duration_' + item.sessionId + '">' +
              '<option value="1">1 Hour</option>' +
              '<option value="4" selected>4 Hours (Default)</option>' +
              '<option value="12">12 Hours</option>' +
              '<option value="24">24 Hours</option>' +
            '</select>' +
            '<button class="btn btn-approve" data-id="' + item.sessionId + '" onclick="approve(this.dataset.id)">✓ Approve</button>' +
            '<button class="btn btn-deny" data-id="' + item.sessionId + '" onclick="deny(this.dataset.id)">✕ Deny</button>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
      container.innerHTML = html;
    }

    function renderApproved(list) {
      var container = document.getElementById('approvedContainer');
      if (!list || list.length === 0) {
        container.innerHTML = '<div class="empty-state">No currently active approved sessions.</div>';
        return;
      }

      var html = '<div class="request-list">';
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        html += '<div class="request-item">' +
          '<div class="request-meta">' +
            '<div class="meta-top">' +
              '<span class="client-ip">' + escapeHtml(item.clientIp) + '</span>' +
              '<span class="countdown">' + timeRemaining(item.expiresAt) + '</span>' +
            '</div>' +
            '<div class="user-agent">' + parseDevice(item.userAgent) + ' &bull; Approved ' + timeAgo(item.approvedAt) + '</div>' +
          '</div>' +
          '<div class="request-actions">' +
            '<button class="btn btn-revoke" data-id="' + item.sessionId + '" onclick="revoke(this.dataset.id)">Revoke Access</button>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
      container.innerHTML = html;
    }

    function renderHistory(list) {
      var tbody = document.getElementById('historyTbody');
      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No history records.</td></tr>';
        return;
      }

      var html = '';
      var maxItems = Math.min(list.length, 30);
      for (var i = 0; i < maxItems; i++) {
        var item = list[i];
        html += '<tr>' +
          '<td><span class="badge-status ' + item.status.toLowerCase() + '">' + item.status + '</span></td>' +
          '<td style="font-family: monospace;">' + escapeHtml(item.clientIp) + '</td>' +
          '<td>' + parseDevice(item.userAgent) + '</td>' +
          '<td>' + timeAgo(item.createdAt) + '</td>' +
          '<td>' + (item.expiresAt ? timeAgo(item.expiresAt) : '-') + '</td>' +
        '</tr>';
      }
      tbody.innerHTML = html;
    }

    async function approve(sessionId) {
      const sel = document.getElementById('duration_' + sessionId);
      const hours = sel ? parseInt(sel.value, 10) : 4;
      try {
        const res = await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, durationHours: hours })
        });
        if (res.ok) {
          showToast('Session Approved for ' + hours + ' hours!');
          loadSessions();
        }
      } catch (err) {
        showToast('Approve failed');
      }
    }

    async function deny(sessionId) {
      try {
        const res = await fetch('/api/deny', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        if (res.ok) {
          showToast('Session Denied');
          loadSessions();
        }
      } catch (err) {
        showToast('Deny failed');
      }
    }

    async function revoke(sessionId) {
      try {
        const res = await fetch('/api/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        if (res.ok) {
          showToast('Session Access Revoked');
          loadSessions();
        }
      } catch (err) {
        showToast('Revoke failed');
      }
    }

    async function pruneHistory() {
      try {
        const res = await fetch('/api/prune', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          showToast('Pruned ' + data.pruned + ' old sessions');
          loadSessions();
        }
      } catch (err) {
        showToast('Prune failed');
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Auto-refresh every 4 seconds
    loadSessions();
    pollTimer = setInterval(loadSessions, 4000);
  </script>
</body>
</html>`;
}
