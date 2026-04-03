import { Context, Next } from 'hono';
import { Env } from '../db';

function safeTokenCompare(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = c.env.ATLAS_API_TOKEN;
  const authHeader = c.req.header('authorization');

  if (token && authHeader) {
    const expected = `Bearer ${token}`;
    if (safeTokenCompare(authHeader, expected)) {
      return next();
    }
  }

  return c.json({ error: 'Unauthorized' }, 401);
}
