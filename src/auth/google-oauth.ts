import { randomBytes } from 'crypto';

export class GoogleOAuthError extends Error {}

export function isGoogleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

export function callbackUrl(): string {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return process.env.GOOGLE_CALLBACK_URL;
  }
  return (
    (process.env.BACKEND_URL || 'http://localhost:5000') +
    '/api/auth/google/callback'
  );
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function newState(): string {
  return randomBytes(16).toString('hex');
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  id_token: string;
}> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: callbackUrl(),
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    throw new GoogleOAuthError(
      `Google token exchange failed (status ${res.status}): ${bodyText}`,
    );
  }
  return res.json();
}

export type GoogleProfile = {
  id: string;
  email: string;
  name: string;
  picture: string;
};

export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new GoogleOAuthError('Google profile fetch failed');
  const json = (await res.json()) as {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  return {
    id: String(json.id ?? ''),
    email: json.email ?? '',
    name: json.name ?? '',
    picture: json.picture ?? '',
  };
}
