import { buildServer } from '../.vercel-output/api-server.mjs';

async function main() {
  const { app, db } = await buildServer({ dbPath: ':memory:' });

  // Login
  let res = await app.inject({
    method: 'POST',
    url: '/v1/auth/session',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ user_id: 'USR-001' })
  });
  const session = JSON.parse(res.body);
  const apiKey = session.api_key;
  console.log('Login OK, key:', apiKey.substring(0, 25));

  // Test /v1/me
  res = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { 'authorization': 'Bearer ' + apiKey }
  });
  console.log('/v1/me:', res.statusCode, res.body.substring(0, 200));

  // Test pipeline
  res = await app.inject({
    method: 'POST',
    url: '/v1/runs',
    headers: { 'authorization': 'Bearer ' + apiKey, 'content-type': 'application/json' },
    payload: JSON.stringify({ text: 'Kirim email ke Budi besok jam 9 pagi' })
  });
  console.log('/v1/runs:', res.statusCode, res.body.substring(0, 300));

  // Test audit verify
  res = await app.inject({
    method: 'GET',
    url: '/v1/audit/verify',
    headers: { 'authorization': 'Bearer ' + apiKey }
  });
  console.log('/v1/audit/verify:', res.statusCode, res.body);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
