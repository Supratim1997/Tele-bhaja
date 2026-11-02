import { GateSession } from './store.js';

export function renderWaitingRoom(session: GateSession): string {
  const isPending = session.status === 'PENDING';
  const isApproved = session.status === 'APPROVED';
  const isDenied = session.status === 'DENIED';
  const isRevoked = session.status === 'REVOKED';

  const shortSessionId = session.sessionId.length > 16 
    ? `${session.sessionId.slice(0, 10)}...${session.sessionId.slice(-6)}` 
    : session.sessionId;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TeleBhaja - Access Gate</title>
  <style>
    :root {
      --bg: #090c15;
      --card-bg: rgba(17, 24, 39, 0.85);
      --border: rgba(255, 255, 255, 0.08);
      --primary: #f59e0b;
      --primary-glow: rgba(245, 158, 11, 0.25);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.25);
      --danger: #ef4444;
      --danger-glow: rgba(239, 68, 68, 0.25);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      background-image: 
        radial-gradient(circle at 50% 0%, rgba(245, 158, 11, 0.08) 0%, transparent 60%),
        radial-gradient(circle at 100% 100%, rgba(59, 130, 246, 0.05) 0%, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .container {
      width: 100%;
      max-width: 480px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 2.25rem 2rem;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .container::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #f59e0b, #ef4444, #8b5cf6, #3b82f6);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
      margin-bottom: 1.5rem;
      text-transform: uppercase;
    }

    .brand-badge {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      border-radius: 9999px;
      border: 1px solid rgba(245, 158, 11, 0.3);
      font-weight: 600;
      letter-spacing: 0.05em;
    }

    .pulse-wrapper {
      position: relative;
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pulse-ring {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--primary-glow);
      animation: pulse 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    .status-icon {
      position: relative;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(245, 158, 11, 0.2);
      border: 2px solid #f59e0b;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f59e0b;
      font-size: 1.75rem;
      transition: all 0.4s ease;
    }

    .status-icon.approved {
      background: rgba(16, 185, 129, 0.2);
      border-color: #10b981;
      color: #10b981;
    }

    .status-icon.denied {
      background: rgba(239, 68, 68, 0.2);
      border-color: #ef4444;
      color: #ef4444;
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(0.9);
        opacity: 0.4;
      }
      50% {
        transform: scale(1.3);
        opacity: 0.9;
      }
    }

    h1 {
      font-size: 1.45rem;
      font-weight: 700;
      margin-bottom: 0.6rem;
      color: #ffffff;
      letter-spacing: -0.01em;
    }

    p.subtitle {
      font-size: 0.925rem;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 1.75rem;
    }

    .details-box {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 1rem;
      text-align: left;
      margin-bottom: 1.5rem;
      font-size: 0.85rem;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.35rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }

    .detail-row:last-child {
      border-bottom: none;
    }

    .detail-label {
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .detail-val {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #e5e7eb;
      font-size: 0.8rem;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-badge {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .status-badge.pending {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .status-badge.approved {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .status-badge.denied {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .polling-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(245, 158, 11, 0.2);
      border-top-color: #f59e0b;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .action-btn {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.6rem 1.2rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: #fff;
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }

    .action-btn:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .footer {
      margin-top: 2rem;
      font-size: 0.75rem;
      color: #4b5563;
      text-align: center;
    }
  </style>
</head>
<body>

  <div class="brand">
    <span>🎬 TeleBhaja</span>
    <span class="brand-badge">Gate Interceptor</span>
  </div>

  <div class="container">
    <div class="pulse-wrapper" id="pulseWrapper">
      <div class="pulse-ring" id="pulseRing"></div>
      <div class="status-icon ${isApproved ? 'approved' : isDenied || isRevoked ? 'denied' : ''}" id="statusIcon">
        ${isApproved ? '✓' : isDenied || isRevoked ? '✕' : '⏳'}
      </div>
    </div>

    <h1 id="statusTitle">
      ${isApproved ? 'Access Approved' : isDenied ? 'Access Denied' : isRevoked ? 'Session Expired' : 'Pending Administrator Approval'}
    </h1>

    <p class="subtitle" id="statusSubtitle">
      ${isApproved 
        ? 'Your access was approved. Redirecting to TeleBhaja...' 
        : isDenied 
        ? 'The administrator has denied access for this request.' 
        : isRevoked 
        ? 'Your session has expired. You may request a new session.' 
        : 'Your connection request has been securely logged. Once approved by the administrator, you will be redirected automatically.'}
    </p>

    <div class="details-box">
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="status-badge ${session.status.toLowerCase()}" id="statusBadge">${session.status}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Session ID</span>
        <span class="detail-val" title="${session.sessionId}">${shortSessionId}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Client IP</span>
        <span class="detail-val">${session.clientIp || 'Unknown'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Device</span>
        <span class="detail-val" title="${session.userAgent}">${session.userAgent.slice(0, 32)}...</span>
      </div>
    </div>

    <div class="polling-indicator" id="pollIndicator">
      <div class="spinner"></div>
      <span id="pollText">Auto-polling every 3s...</span>
    </div>

    <div id="actionArea">
      ${isDenied || isRevoked ? `<button class="action-btn" onclick="requestNewSession()">Request New Session</button>` : ''}
    </div>
  </div>

  <div class="footer">
    TeleBhaja Security Gate &bull; Private Approval Tunnel
  </div>

  <script>
    const sessionId = ${JSON.stringify(session.sessionId)};
    let currentStatus = ${JSON.stringify(session.status)};
    let pollInterval = null;

    function requestNewSession() {
      // Clear gate cookie and reload
      document.cookie = "telebhaja_gate=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;";
      window.location.href = '/';
    }

    async function checkStatus() {
      try {
        const res = await fetch('/api/check-status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.status !== currentStatus) {
          currentStatus = data.status;
          updateUI(data.status);
        }

        if (data.status === 'APPROVED') {
          if (pollInterval) clearInterval(pollInterval);
          document.getElementById('pollText').textContent = 'Approved! Loading platform...';
          setTimeout(() => {
            window.location.href = '/';
          }, 800);
        } else if (data.status === 'DENIED' || data.status === 'REVOKED') {
          if (pollInterval) clearInterval(pollInterval);
        }
      } catch (err) {
        console.warn('[Gate] Poll error:', err);
      }
    }

    function updateUI(status) {
      const title = document.getElementById('statusTitle');
      const subtitle = document.getElementById('statusSubtitle');
      const icon = document.getElementById('statusIcon');
      const badge = document.getElementById('statusBadge');
      const pulseRing = document.getElementById('pulseRing');
      const pollIndicator = document.getElementById('pollIndicator');
      const actionArea = document.getElementById('actionArea');

      badge.textContent = status;
      badge.className = 'status-badge ' + status.toLowerCase();

      if (status === 'APPROVED') {
        title.textContent = 'Access Approved!';
        subtitle.textContent = 'You have been granted access. Launching TeleBhaja...';
        icon.className = 'status-icon approved';
        icon.innerHTML = '✓';
        pulseRing.style.background = 'rgba(16, 185, 129, 0.25)';
      } else if (status === 'DENIED') {
        title.textContent = 'Access Denied';
        subtitle.textContent = 'Your request has been declined by the administrator.';
        icon.className = 'status-icon denied';
        icon.innerHTML = '✕';
        pulseRing.style.display = 'none';
        pollIndicator.style.display = 'none';
        actionArea.innerHTML = '<button class="action-btn" onclick="requestNewSession()">Request New Session</button>';
      } else if (status === 'REVOKED') {
        title.textContent = 'Session Expired';
        subtitle.textContent = 'Your session duration has lapsed or was revoked.';
        icon.className = 'status-icon denied';
        icon.innerHTML = '✕';
        pulseRing.style.display = 'none';
        pollIndicator.style.display = 'none';
        actionArea.innerHTML = '<button class="action-btn" onclick="requestNewSession()">Request New Session</button>';
      }
    }

    // Begin polling if pending
    if (currentStatus === 'PENDING') {
      pollInterval = setInterval(checkStatus, 3000);
      // Run once immediately
      setTimeout(checkStatus, 1000);
    } else if (currentStatus === 'APPROVED') {
      setTimeout(() => { window.location.href = '/'; }, 1000);
    }
  </script>
</body>
</html>`;
}

