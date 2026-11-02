import os from 'os';
import { config } from '../config.js';
import { initGateStore, pruneExpiredSessions } from './store.js';
import { startAdminPortal } from './adminPortal.js';
import { startProxyGate } from './proxy.js';

export function detectTailscaleIp(): string | undefined {
  if (config.gate.tailscaleIp) {
    return config.gate.tailscaleIp;
  }

  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        if (name.toLowerCase().includes('tailscale') || a.address.startsWith('100.')) {
          return a.address;
        }
      }
    }
  }
  return undefined;
}

export interface GateSystemHandle {
  tailscaleIp?: string;
  adminPort: number;
  proxyPort: number;
  targetUrl: string;
  stop: () => Promise<void>;
}

export async function startGateSystem(): Promise<GateSystemHandle> {
  // 1. Initialize DB table & cache
  await initGateStore();

  const tailscaleIp = detectTailscaleIp();
  const adminPort = config.gate.adminPort;
  const proxyPort = config.gate.proxyPort;
  const targetUrl = config.gate.targetUrl;

  // 2. Start Private Admin Portal strictly on 127.0.0.1 and Tailscale IP
  const adminHandle = startAdminPortal(adminPort, tailscaleIp);

  // 3. Start Public Gate Proxy
  const proxyHandle = startProxyGate(proxyPort, targetUrl);

  // 4. Prune interval every 30 minutes
  const pruneInterval = setInterval(() => {
    pruneExpiredSessions().catch(() => {});
  }, 30 * 60 * 1000);

  return {
    tailscaleIp,
    adminPort,
    proxyPort,
    targetUrl,
    stop: async () => {
      clearInterval(pruneInterval);
      await Promise.all([adminHandle.close(), proxyHandle.close()]);
    },
  };
}

