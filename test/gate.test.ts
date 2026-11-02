import http from 'http';
import express from 'express';
import { 
  signSession, 
  verifySignedSession, 
  initGateStore, 
  createSession, 
  getSession, 
  approveSession, 
  denySession, 
  revokeSession, 
  listSessions, 
  pruneExpiredSessions,
  COOKIE_NAME 
} from '../src/server/gate/store.js';
import { createAdminApp, startAdminPortal } from '../src/server/gate/adminPortal.js';
import { createProxyApp, startProxyGate, parseCookies } from '../src/server/gate/proxy.js';
import { getDb, initDb } from '../src/server/db/database.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${desc}`);
    failed++;
  }
}

async function request(options: http.RequestOptions, bodyData?: string): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

async function runGateTests() {
  console.log('\n🔒 Starting TeleBhaja Gatekeeper Architecture Integration Tests...\n');

  // 1. Database & Store Setup
  process.env.DB_PATH = './data/test_gate.db';
  await initDb();
  await initGateStore();

  console.log('1. Testing HMAC Cookie Signing & Constant-Time Verification:');
  const dummyId = 'gate_test_1234567890abcdef';
  const signed = signSession(dummyId);
  assert(signed.startsWith(dummyId + '.'), 'Signed cookie contains session ID and signature');
  
  const verifiedId = verifySignedSession(signed);
  assert(verifiedId === dummyId, 'Valid signed cookie verifies to original session ID');

  const tamperedSig = signed.slice(0, -4) + '0000';
  assert(verifySignedSession(tamperedSig) === null, 'Tampered signature is rejected');

  const tamperedPayload = 'gate_fake_' + signed.slice(10);
  assert(verifySignedSession(tamperedPayload) === null, 'Tampered session payload is rejected');

  assert(verifySignedSession('malformed') === null, 'Malformed cookie without dot separator is rejected');
  assert(verifySignedSession('') === null, 'Empty cookie is rejected');

  console.log('\n2. Testing Session Lifecycle in GateStore:');
  const session1 = await createSession('192.168.1.50', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
  assert(session1.status === 'PENDING', 'New visitor session status is PENDING');
  assert(session1.clientIp === '192.168.1.50', 'Session tracks client IP');
  assert(session1.userAgent.includes('iPhone'), 'Session tracks user agent');

  const fetched = getSession(session1.sessionId);
  assert(fetched?.sessionId === session1.sessionId, 'getSession retrieves cached session');

  const approved = await approveSession(session1.sessionId, 4);
  assert(approved?.status === 'APPROVED', 'approveSession updates status to APPROVED');
  assert(approved?.expiresAt !== undefined, 'Approved session sets expiresAt timestamp');

  const revoked = await revokeSession(session1.sessionId);
  assert(revoked?.status === 'REVOKED', 'revokeSession updates status to REVOKED');

  const session2 = await createSession('10.0.0.2', 'Android Browser');
  const denied = await denySession(session2.sessionId);
  assert(denied?.status === 'DENIED', 'denySession updates status to DENIED');

  const list = listSessions();
  assert(list.history.some(s => s.sessionId === session1.sessionId), 'Revoked session appears in history');
  assert(list.history.some(s => s.sessionId === session2.sessionId), 'Denied session appears in history');

  console.log('\n3. Testing End-to-End Interception Proxy and Waiting Room Flow:');
  // Setup Mock Target App (representing Main App on port 3999)
  const mockTargetApp = express();
  mockTargetApp.get('/api/target-test', (_req, res) => {
    res.json({ targetReached: true, secretContent: 'ott_library_data' });
  });
  const mockTargetServer = http.createServer(mockTargetApp);
  await new Promise<void>((resolve) => mockTargetServer.listen(3999, '127.0.0.1', () => resolve()));

  // Setup Proxy Gate on port 4001 pointing to mock target
  const proxyGate = startProxyGate(4001, 'http://127.0.0.1:3999');

  // Request to /api/target-test without cookie
  const unauthRes = await request({
    hostname: '127.0.0.1',
    port: 4001,
    path: '/api/target-test',
    method: 'GET',
  });

  assert(unauthRes.statusCode === 302, 'Unauthenticated visitor gets 302 redirected');
  assert(unauthRes.headers.location === '/waiting-room', 'Redirect destination is /waiting-room');
  assert(Boolean(unauthRes.headers['set-cookie']), 'Set-Cookie header is returned with signed session');

  const setCookieHeader = (unauthRes.headers['set-cookie'] || [])[0] || '';
  const parsedCookies = parseCookies(setCookieHeader);
  const gateCookieVal = parsedCookies[COOKIE_NAME];
  assert(Boolean(gateCookieVal), 'telebhaja_gate cookie is present in response');

  const interceptedSessionId = verifySignedSession(gateCookieVal);
  assert(Boolean(interceptedSessionId), 'Intercepted cookie carries valid signature');

  // Request to /waiting-room with the assigned cookie
  const waitingRoomRes = await request({
    hostname: '127.0.0.1',
    port: 4001,
    path: '/waiting-room',
    method: 'GET',
    headers: {
      Cookie: `${COOKIE_NAME}=${gateCookieVal}`,
    },
  });

  assert(waitingRoomRes.statusCode === 200, 'Waiting room serves HTTP 200');
  assert(waitingRoomRes.body.includes('Pending Administrator Approval'), 'Waiting room displays Pending text');
  assert(waitingRoomRes.body.includes('/api/check-status'), 'Waiting room includes auto-polling script');

  // Request to /api/check-status with the cookie
  const statusRes = await request({
    hostname: '127.0.0.1',
    port: 4001,
    path: '/api/check-status',
    method: 'GET',
    headers: {
      Cookie: `${COOKIE_NAME}=${gateCookieVal}`,
    },
  });

  assert(statusRes.statusCode === 200, '/api/check-status returns 200');
  const statusJson = JSON.parse(statusRes.body);
  assert(statusJson.status === 'PENDING', 'Initial check-status reports PENDING');

  console.log('\n4. Testing Private Admin Portal Remote Approval:');
  // Setup Admin Portal on port 8089 (strictly 127.0.0.1)
  const adminHandle = startAdminPortal(8089);

  // Admin checks sessions
  const adminSessionsRes = await request({
    hostname: '127.0.0.1',
    port: 8089,
    path: '/api/sessions',
    method: 'GET',
  });
  assert(adminSessionsRes.statusCode === 200, 'Admin portal /api/sessions returns 200');
  const adminSessionsData = JSON.parse(adminSessionsRes.body);
  const foundPending = adminSessionsData.pending.some((s: any) => s.sessionId === interceptedSessionId);
  assert(foundPending, 'Admin portal lists visitor in pending queue');

  // Admin approves visitor for 4 hours
  const approveRes = await request({
    hostname: '127.0.0.1',
    port: 8089,
    path: '/api/approve',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, JSON.stringify({ sessionId: interceptedSessionId, durationHours: 4 }));

  assert(approveRes.statusCode === 200, 'Admin approve endpoint returns 200');
  const approveData = JSON.parse(approveRes.body);
  assert(approveData.session.status === 'APPROVED', 'Admin approve updates status to APPROVED');

  // Polling /api/check-status now returns APPROVED
  const statusRes2 = await request({
    hostname: '127.0.0.1',
    port: 4001,
    path: '/api/check-status',
    method: 'GET',
    headers: {
      Cookie: `${COOKIE_NAME}=${gateCookieVal}`,
    },
  });
  const statusJson2 = JSON.parse(statusRes2.body);
  assert(statusJson2.status === 'APPROVED', 'Polling /api/check-status transitions to APPROVED');

  console.log('\n5. Testing Transparent Upstream Proxying with Approved Session:');
  const proxiedRes = await request({
    hostname: '127.0.0.1',
    port: 4001,
    path: '/api/target-test',
    method: 'GET',
    headers: {
      Cookie: `${COOKIE_NAME}=${gateCookieVal}`,
    },
  });

  assert(proxiedRes.statusCode === 200, 'Target endpoint through proxy returns HTTP 200');
  const proxiedJson = JSON.parse(proxiedRes.body);
  assert(proxiedJson.targetReached === true, 'Proxy forwarded request to target application');
  assert(proxiedJson.secretContent === 'ott_library_data', 'Target response data returned unaltered');

  console.log('\n6. Testing Instant Access Revocation:');
  const revokeRes = await request({
    hostname: '127.0.0.1',
    port: 8089,
    path: '/api/revoke',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, JSON.stringify({ sessionId: interceptedSessionId }));
  assert(revokeRes.statusCode === 200, 'Admin revoke returns 200');

  // Immediate subsequent request to proxy should be intercepted
  const blockedRes = await request({
    hostname: '127.0.0.1',
    port: 4001,
    path: '/api/target-test',
    method: 'GET',
    headers: {
      Cookie: `${COOKIE_NAME}=${gateCookieVal}`,
    },
  });
  assert(blockedRes.statusCode === 302, 'Revoked visitor is intercepted with 302 redirect');
  assert(blockedRes.headers.location === '/waiting-room', 'Revoked visitor redirected to /waiting-room');

  // Clean up test servers
  await proxyGate.close();
  await adminHandle.close();
  await new Promise<void>((resolve) => mockTargetServer.close(() => resolve()));

  console.log(`\n========================================`);
  console.log(`Gatekeeper Test Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runGateTests().catch((err) => {
  console.error('[Test Error]', err);
  process.exit(1);
});

