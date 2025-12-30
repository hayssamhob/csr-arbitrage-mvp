/**
 * Supabase JWT Authentication Middleware
 * 
 * Verifies Supabase JWT tokens and extracts user_id for request scoping.
 * 
 * Environment variables:
 * - SUPABASE_JWT_SECRET: Supabase JWT secret for verification
 */

import { NextFunction, Request, Response } from 'express';
import * as jose from 'jose';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

/**
 * Middleware to verify Supabase JWT and extract user info
 * Adds userId and userEmail to the request object
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header',
    });
  }

  const token = authHeader.substring(7);

  if (!SUPABASE_JWT_SECRET) {
    console.error('SUPABASE_JWT_SECRET not configured');
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'Authentication not configured',
    });
  }

  try {
    // Supabase JWT secret is base64 encoded - decode it first
    const secretBytes = Buffer.from(SUPABASE_JWT_SECRET, "base64");
    const { payload } = await jose.jwtVerify(token, secretBytes);

    // Supabase JWT payload contains 'sub' (user_id) and 'email'
    req.userId = payload.sub as string;
    req.userEmail = payload.email as string;

    next();
  } catch (error: any) {
    if (error.code === 'ERR_JWT_EXPIRED') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Please sign in again',
      });
    }

    console.error('JWT verification failed:', error.message);
    return res.status(401).json({
      error: 'Invalid token',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional auth middleware - doesn't fail if no token provided
 * Useful for endpoints that work differently for authenticated users
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ') || !SUPABASE_JWT_SECRET) {
    return next();
  }

  const token = authHeader.substring(7);

  try {
    // Supabase JWT secret is base64 encoded - decode it first
    const secretBytes = Buffer.from(SUPABASE_JWT_SECRET, "base64");
    const { payload } = await jose.jwtVerify(token, secretBytes);

    req.userId = payload.sub as string;
    req.userEmail = payload.email as string;
  } catch {
    // Ignore errors for optional auth
  }

  next();
}
