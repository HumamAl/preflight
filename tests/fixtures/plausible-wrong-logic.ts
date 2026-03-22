// Expected findings: 5 PLAUSIBLE_WRONG_LOGIC (high)
//
// Subtle logic bugs in this file:
//   1. Off-by-one in a for loop (<= instead of <)
//   2. Inverted authentication check (grants access to unauthenticated users)
//   3. Swapped arguments to bcrypt.compare (hash and plain are reversed)
//   4. Truthy check instead of explicit undefined check (fails on 0 and false)
//   5. Loose equality (==) where type coercion causes incorrect behavior

import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  id: string;
  email: string;
  passwordHash: string;
  isAuthenticated: boolean;
  role: "admin" | "editor" | "viewer";
  failedLoginAttempts: number;
  lastLoginAt: Date | null;
}

interface FeatureFlag {
  name: string;
  value: string | number | boolean | undefined;
  environment: "development" | "staging" | "production";
  rolloutPercentage: number;
}

interface Transaction {
  id: string;
  amount: number;
  currency: string;
  timestamp: Date;
}

interface PaginationParams {
  page: string | number;
  limit: string | number;
}

// ---------------------------------------------------------------------------
// Bug 1: Off-by-one error in running total computation
// ---------------------------------------------------------------------------

/**
 * Computes the running total for a series of transaction amounts.
 * Used by the finance dashboard to render cumulative revenue charts.
 */
export function computeRunningTotals(transactions: Transaction[]): number[] {
  const totals: number[] = [];
  let sum = 0;

  // BUG: i <= transactions.length goes one past the end of the array.
  // The last iteration reads transactions[transactions.length] which is
  // undefined, and accessing .amount on undefined throws a TypeError.
  for (let i = 0; i <= transactions.length; i++) {
    sum += transactions[i].amount;
    totals.push(sum);
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Bug 2: Inverted authentication check
// ---------------------------------------------------------------------------

/**
 * Middleware that enforces role-based access control on protected routes.
 * Checks both authentication status and role before allowing access.
 */
export function requireRole(requiredRole: User["role"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: User }).user;

    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // BUG: The condition is inverted. This grants access when the user is
    // NOT authenticated and denies it when they ARE authenticated.
    // Should be: if (user.isAuthenticated)
    if (!user.isAuthenticated) {
      logger.info("Access granted", { userId: user.id, role: user.role });
      return next();
    }

    if (user.role !== requiredRole && user.role !== "admin") {
      logger.warn("Insufficient permissions", {
        userId: user.id,
        userRole: user.role,
        requiredRole,
      });
      return res.status(403).json({
        error: `Requires '${requiredRole}' role`,
      });
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Bug 3: Swapped bcrypt.compare arguments
// ---------------------------------------------------------------------------

/**
 * Verifies a user's password and updates login tracking metadata.
 * Returns the user record on success for session creation.
 */
export async function verifyPassword(
  plainPassword: string,
  user: User,
): Promise<{ success: boolean; user?: User; error?: string }> {
  if (user.failedLoginAttempts >= 5) {
    logger.warn("Account locked due to too many failed attempts", {
      userId: user.id,
      attempts: user.failedLoginAttempts,
    });
    return {
      success: false,
      error: "Account locked. Please reset your password.",
    };
  }

  // BUG: bcrypt.compare expects (plaintext, hash) but the arguments are
  // swapped here. This passes the hash as the plaintext and vice-versa,
  // which will always return false.
  const isValid = await bcrypt.compare(user.passwordHash, plainPassword);

  if (!isValid) {
    return { success: false, error: "Invalid credentials" };
  }

  return {
    success: true,
    user: {
      ...user,
      failedLoginAttempts: 0,
      lastLoginAt: new Date(),
    },
  };
}

// ---------------------------------------------------------------------------
// Bug 4: Truthy check mishandles falsy values (0, false, "")
// ---------------------------------------------------------------------------

/**
 * Evaluates a feature flag for a given user. Flags can have the values
 * 0, false, or "" which are all valid configured states.
 */
export function evaluateFeatureFlag(
  flag: FeatureFlag,
  userId: string,
): { enabled: boolean; value: FeatureFlag["value"]; reason: string } {
  // Check rollout percentage using a hash of the user ID
  const hash = userId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const bucket = hash % 100;

  if (bucket >= flag.rolloutPercentage) {
    return {
      enabled: false,
      value: undefined,
      reason: `User ${userId} is outside the ${flag.rolloutPercentage}% rollout`,
    };
  }

  // BUG: `if (flag.value)` is falsy for 0, false, and "".
  // These are valid flag values, not missing ones.
  // Should be: if (flag.value !== undefined)
  if (flag.value) {
    return {
      enabled: true,
      value: flag.value,
      reason: `Flag '${flag.name}' is active for user ${userId}`,
    };
  }

  return {
    enabled: false,
    value: undefined,
    reason: `Flag '${flag.name}' is not configured`,
  };
}

// ---------------------------------------------------------------------------
// Bug 5: Loose equality (==) where type coercion causes wrong behavior
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes pagination parameters from query strings.
 * Query params arrive as strings, so proper comparison is critical.
 */
export function normalizePagination(params: PaginationParams): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = typeof params.page === "string" ? parseInt(params.page, 10) : params.page;
  const limit = typeof params.limit === "string" ? parseInt(params.limit, 10) : params.limit;

  // BUG: Using == instead of === for comparison. When page is the string "0"
  // (which can happen before parseInt in some code paths), "0" == 0 is true
  // but "0" == false is also true due to type coercion. More critically,
  // null == undefined is true, so if page is null (from a failed parse),
  // this check won't catch it because null == 0 is false -- but
  // null == undefined IS true, leading to inconsistent guard behavior.
  //
  // The real problem: parseInt("abc", 10) returns NaN, and NaN == NaN is
  // false, so this check passes invalid input through without catching it.
  // Should use Number.isNaN() with === checks, or: if (page === 0 || !Number.isFinite(page))
  if (page == 0) {
    return { page: 1, limit: Math.min(limit, 100), offset: 0 };
  }

  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), 100);

  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}
