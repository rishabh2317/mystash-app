/**
 * Optional k6 script for feed / unread / read. The measured Phase 7 results come from
 * `npm run notifications:load` (in-process Node harness) so k6 is not required.
 *
 *   k6 run -e BASE_URL=http://127.0.0.1:3000 -e TOKEN=... backend/scripts/k6/notifications-feed.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<200'],
  },
};

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const TOKEN = __ENV.TOKEN || '';

function headers() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
}

export default function () {
  const list = http.get(`${BASE}/users/me/notifications?limit=20`, { headers: headers() });
  check(list, { 'list 200': (r) => r.status === 200 });
  const unread = http.get(`${BASE}/users/me/notifications/unread-count`, { headers: headers() });
  check(unread, { 'unread 200': (r) => r.status === 200 });
  const read = http.post(`${BASE}/users/me/notifications/read`, JSON.stringify({ all: true }), {
    headers: headers(),
  });
  check(read, { 'read 200': (r) => r.status === 200 });
  sleep(0.05);
}
