import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { 
  COOKIE_NAME, 
  verifySignedSession, 
  signSession, 
  createSession, 
  getOrCreatePendingSession,
  getSession,
  findApprovedSessionByIp,
  GateSession 
} from './store.js';
import { renderWaitingRoom } from './waitingRoom.js';

const BOT_USER_AGENTS = [
  'whatsapp',
  'telegrambot',
  'twitterbot',
  'facebookexternalhit',
  'discordbot',
  'slackbot',
  'skypeuripreview',
  'linkedinbot',
  'applebot',
];

function isBotCrawler(userAgent?: string): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot));
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawVal] = part.trim().split('=');
    if (rawKey) {
      list[rawKey.trim()] = decodeURIComponent(rawVal.join('='));
    }
  }
  return list;
}

export function getClientIp(req: Request): string {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return cleanIp(cfConnectingIp.trim());
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0].trim();
    if (first) return cleanIp(first);
  }
  return cleanIp(req.socket.remoteAddress || '127.0.0.1');
}

function cleanIp(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  if (ip === '::1') {
    return '127.0.0.1';
  }
  return ip;
}

function proxyRequest(req: Request, res: Response, targetUrl: string) {
  const parsedTarget = new URL(targetUrl);
  const targetHost = parsedTarget.hostname;
  const targetPort = parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80);

  const headers = { ...req.headers };
  delete headers['connection'];
  delete headers['keep-alive'];
  delete headers['transfer-encoding'];

  headers.host = `${targetHost}:${targetPort}`;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.protocol || 'http';
  headers['x-forwarded-for'] = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  const options: http.RequestOptions = {
    hostname: targetHost,
    port: Number(targetPort),
    path: req.originalUrl || req.url,
    method: req.method,
    headers: headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[GateProxy] Upstream proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Bad Gateway: Upstream server unavailable', details: err.message });
    }
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }

  res.on('close', () => {
    if (!res.writableEnded) {
      proxyReq.destroy();
    }
  });
}

/**
 * Creates the Gate Interception Proxy app
 */
export function createProxyApp(targetUrl: string): express.Express {
  const app = express();

  // Ignore static browser icon & metadata requests
  app.use((req: Request, res: Response, next: NextFunction) => {
    const p = req.path.toLowerCase();
    if (
      p === '/favicon.ico' || 
      p.startsWith('/apple-touch-icon') || 
      p === '/robots.txt' || 
      p === '/site.webmanifest'
    ) {
      return res.status(204).end();
    }
    next();
  });

  // Respond to link-preview crawler bots (WhatsApp, Telegram, etc.) without creating pending sessions
  app.use((req: Request, res: Response, next: NextFunction) => {
    const ua = req.headers['user-agent'];
    if (isBotCrawler(ua)) {
      return res.status(200).send(`<!DOCTYPE html><html><head>
        <title>TeleBhaja OTT Platform</title>
        <meta property="og:title" content="TeleBhaja OTT Platform" />
        <meta property="og:description" content="Personal OTT Streaming Gate" />
      </head><body>TeleBhaja Gatekeeper</body></html>`);
    }
    next();
  });

  // Helper middleware to extract or establish visitor session
  const sessionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const tokenParam = (req.query.gate_token as string) || (req.headers['x-gate-token'] as string);
    const rawCookie = cookies[COOKIE_NAME] || tokenParam;
    let session: GateSession | undefined;

    if (rawCookie) {
      const sessionId = verifySignedSession(rawCookie);
      if (sessionId) {
        session = getSession(sessionId);
      }
    }

    // Media stream authentication fallback for native players:
    // Mobile platforms (especially iOS Safari AVPlayer / AppleCoreMedia) request
    // media streams (/api/stream/*) via a background system daemon that omits browser cookies.
    // If no cookie was attached, check if the client IP currently has an active approved session.
    const isMediaRequest = req.path.startsWith('/api/stream');
    if (!session && isMediaRequest) {
      const clientIp = getClientIp(req);
      const ipApproved = findApprovedSessionByIp(clientIp);
      if (ipApproved) {
        session = ipApproved;
      }
    }

    // Attach to request
    (req as any).gateSession = session;
    next();
  };

  app.use(sessionMiddleware);

  // Health check for proxy
  app.get('/api/gate/health', (req: Request, res: Response) => {
    res.json({
      ok: true,
      proxy: true,
      targetUrl,
      session: (req as any).gateSession ? {
        sessionId: (req as any).gateSession.sessionId,
        status: (req as any).gateSession.status
      } : null,
    });
  });

  // Waiting room endpoint
  app.get('/waiting-room', async (req: Request, res: Response) => {
    let session: GateSession | undefined = (req as any).gateSession;

    if (!session) {
      const clientIp = getClientIp(req);
      const userAgent = req.headers['user-agent'] || 'Unknown Device';
      session = await getOrCreatePendingSession(clientIp, userAgent);
      const signed = signSession(session.sessionId);
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${signed}; Path=/; SameSite=Lax; Max-Age=86400`);
      (req as any).gateSession = session;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderWaitingRoom(session));
  });

  // Polling endpoint for waiting room
  app.get('/api/check-status', (req: Request, res: Response) => {
    const session: GateSession | undefined = (req as any).gateSession;
    if (!session) {
      return res.json({ ok: false, status: 'UNKNOWN' });
    }
    res.json({
      ok: true,
      status: session.status,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt ?? null,
    });
  });

  // Catch-all interception middleware
  app.use(async (req: Request, res: Response) => {
    let session: GateSession | undefined = (req as any).gateSession;

    // If no session exists, get or create pending session, set cookie, and redirect to waiting room
    if (!session) {
      const clientIp = getClientIp(req);
      const userAgent = req.headers['user-agent'] || 'Unknown Device';
      session = await getOrCreatePendingSession(clientIp, userAgent);
      const signed = signSession(session.sessionId);
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${signed}; Path=/; SameSite=Lax; Max-Age=86400`);
      return res.redirect(302, '/waiting-room');
    }

    // Check status
    if (session.status === 'APPROVED') {
      // Verified and approved: transparently forward to target
      return proxyRequest(req, res, targetUrl);
    }

    // Pending, Denied, or Revoked: redirect to waiting room
    return res.redirect(302, '/waiting-room');
  });

  return app;
}

/**
 * Start Gate Interception Proxy server
 */
export function startProxyGate(port: number, targetUrl: string): {
  server: http.Server;
  close: () => Promise<void>;
} {
  const app = createProxyApp(targetUrl);
  const server = http.createServer(app);

  server.listen(port, '0.0.0.0', () => {
    console.log(`[GateProxy] Public Interception Proxy listening at http://0.0.0.0:${port} -> ${targetUrl}`);
  });

  return {
    server,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
