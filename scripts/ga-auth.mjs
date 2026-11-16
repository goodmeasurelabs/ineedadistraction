// Google service-account auth for the GA4 scripts in this folder, with no
// dependencies: sign a JWT with the account's key and trade it for a token.
// Key file: GA_KEY_FILE, or ~/.config/gcloud/claude-analytics.json.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

export const PROPERTY = process.env.GA_PROPERTY ?? 'properties/529426996';

export async function accessToken(scope) {
  const key = JSON.parse(readFileSync(process.env.GA_KEY_FILE ?? `${homedir()}/.config/gcloud/claude-analytics.json`, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: key.client_email, scope, aud: key.token_uri, iat: now, exp: now + 600 })}`;
  const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`;
  const response = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await response.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function google(token, url, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${url}: ${data.error?.message ?? JSON.stringify(data)}`);
  return data;
}
