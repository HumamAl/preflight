// Expected findings: 5 ASYNC_MISTAKES (high)
//
// Async/await bugs in this file:
//   1. await inside forEach (never works -- forEach ignores returned promises)
//   2. Missing await on async function call (result used as Promise object)
//   3. Sequential awaits that should be Promise.all (performance bug)
//   4. async function in useEffect without cleanup/cancellation
//   5. Fire-and-forget promise without error handling (floating promise)
//
// NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

import React, { useEffect, useState } from "react";
import type { Request, Response } from "express";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "member" | "viewer";
  lastSyncedAt: string | null;
}

interface Notification {
  id: string;
  userId: string;
  channel: "email" | "sms" | "push";
  subject: string;
  body: string;
  sentAt: string | null;
}

interface SyncResult {
  userId: string;
  status: "synced" | "failed";
  recordsUpdated: number;
  error?: string;
}

interface DashboardData {
  stats: { totalUsers: number; activeToday: number };
  recentActivity: { action: string; timestamp: string }[];
  announcements: { title: string; body: string }[];
}

// ---------------------------------------------------------------------------
// Helpers (these would be defined elsewhere in a real app)
// ---------------------------------------------------------------------------

declare function fetchUserFromCRM(userId: string): Promise<User>;
declare function updateLocalUserRecord(user: User): Promise<SyncResult>;
declare function sendEmail(to: string, subject: string, body: string): Promise<void>;
declare function sendSMS(phone: string, body: string): Promise<void>;
declare function sendPushNotification(userId: string, payload: object): Promise<void>;
declare function fetchDashboardStats(): Promise<DashboardData["stats"]>;
declare function fetchRecentActivity(): Promise<DashboardData["recentActivity"]>;
declare function fetchAnnouncements(): Promise<DashboardData["announcements"]>;
declare function lookupPhoneNumber(userId: string): Promise<string>;
declare function validateUserAccess(userId: string): Promise<boolean>;
declare function recordAuditEvent(event: object): Promise<void>;

// ---------------------------------------------------------------------------
// Bug 1: await inside forEach -- forEach ignores the returned promise
// ---------------------------------------------------------------------------

/**
 * Syncs a batch of users from the external CRM into our local database.
 * Called by a nightly cron job to keep user profiles up to date.
 */
export async function syncUsersFromCRM(userIds: string[]): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  // BUG: forEach does not await async callbacks. It fires every iteration
  // immediately and returns void. The function returns `results` before any
  // of the sync operations complete, so the caller always gets an empty array.
  // Fix: use a for...of loop, or await Promise.all(userIds.map(...))
  userIds.forEach(async (userId) => {
    try {
      const crmUser = await fetchUserFromCRM(userId);
      const syncResult = await updateLocalUserRecord(crmUser);
      results.push(syncResult);

      logger.info("User synced from CRM", {
        userId,
        recordsUpdated: syncResult.recordsUpdated,
      });
    } catch (err) {
      results.push({
        userId,
        status: "failed",
        recordsUpdated: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // This runs immediately, before any sync operations finish.
  logger.info(`CRM sync complete: ${results.length} users processed`);
  return results;
}

// ---------------------------------------------------------------------------
// Bug 2: Missing await on async function call -- result used as Promise
// ---------------------------------------------------------------------------

/**
 * Dispatches a notification to the appropriate channel. Looks up the user's
 * phone number for SMS delivery and validates access before sending.
 */
export async function dispatchNotification(notification: Notification): Promise<{
  delivered: boolean;
  channel: string;
  error?: string;
}> {
  // BUG: validateUserAccess is async but called without await. `hasAccess` is
  // a Promise object, which is always truthy. The access check never actually
  // blocks unauthorized users.
  // Fix: const hasAccess = await validateUserAccess(notification.userId);
  const hasAccess = validateUserAccess(notification.userId);

  if (!hasAccess) {
    // This branch is never reached because a Promise is truthy.
    return { delivered: false, channel: notification.channel, error: "Access denied" };
  }

  try {
    switch (notification.channel) {
      case "email":
        await sendEmail(notification.userId, notification.subject, notification.body);
        break;
      case "sms": {
        const phone = await lookupPhoneNumber(notification.userId);
        await sendSMS(phone, notification.body);
        break;
      }
      case "push":
        await sendPushNotification(notification.userId, {
          title: notification.subject,
          body: notification.body,
        });
        break;
    }

    return { delivered: true, channel: notification.channel };
  } catch (err) {
    logger.error("Notification dispatch failed", {
      notificationId: notification.id,
      channel: notification.channel,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return {
      delivered: false,
      channel: notification.channel,
      error: err instanceof Error ? err.message : "Delivery failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Bug 3: Sequential awaits that should be Promise.all -- performance bug
// ---------------------------------------------------------------------------

/**
 * Loads all data needed to render the admin dashboard. Each data source is
 * independent, but they are fetched one at a time.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const startTime = Date.now();

  // BUG: These three fetches are completely independent -- none of them uses
  // the result of another. Running them sequentially means the total latency
  // is the SUM of all three requests instead of the MAX.
  // If each takes 200ms, sequential = 600ms, parallel = ~200ms.
  // Fix:
  //   const [stats, recentActivity, announcements] = await Promise.all([
  //     fetchDashboardStats(),
  //     fetchRecentActivity(),
  //     fetchAnnouncements(),
  //   ]);
  const stats = await fetchDashboardStats();
  const recentActivity = await fetchRecentActivity();
  const announcements = await fetchAnnouncements();

  const elapsed = Date.now() - startTime;
  logger.info("Dashboard data loaded", { elapsedMs: elapsed });

  return { stats, recentActivity, announcements };
}

// ---------------------------------------------------------------------------
// Bug 4: async function in useEffect without cleanup/cancellation
// ---------------------------------------------------------------------------

interface UserProfileProps {
  userId: string;
}

/**
 * Displays a user's profile with data fetched from the API. Used on the
 * /users/:id page.
 */
export function UserProfile({ userId }: UserProfileProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // BUG: Passing an async function directly to useEffect is wrong.
  // useEffect expects its callback to return void or a cleanup function.
  // An async function returns a Promise, which useEffect silently ignores --
  // meaning there is no cleanup and no cancellation.
  //
  // If userId changes rapidly (e.g., navigating between profiles), multiple
  // fetches race against each other. A slow response for a previous userId
  // can overwrite the data for the current userId.
  //
  // Fix: Use a non-async wrapper with an AbortController:
  //   useEffect(() => {
  //     const controller = new AbortController();
  //     async function loadUser() {
  //       try {
  //         const data = await fetchUserFromCRM(userId);
  //         if (!controller.signal.aborted) setUser(data);
  //       } catch (e) {
  //         if (!controller.signal.aborted) setError("Failed to load");
  //       } finally {
  //         if (!controller.signal.aborted) setLoading(false);
  //       }
  //     }
  //     loadUser();
  //     return () => controller.abort();
  //   }, [userId]);
  useEffect(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchUserFromCRM(userId);
      setUser(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load user profile");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  if (loading) {
    return React.createElement("div", { className: "loading-spinner" }, "Loading...");
  }

  if (error) {
    return React.createElement("div", { className: "error-message" }, error);
  }

  if (!user) {
    return React.createElement("div", { className: "not-found" }, "User not found");
  }

  return React.createElement("div", { className: "user-profile" }, [
    React.createElement("h1", { key: "name" }, user.displayName),
    React.createElement("p", { key: "email" }, user.email),
    React.createElement("span", { key: "role", className: "role-badge" }, user.role),
    user.lastSyncedAt
      ? React.createElement("time", { key: "sync", dateTime: user.lastSyncedAt },
          `Last synced: ${new Date(user.lastSyncedAt).toLocaleDateString()}`)
      : null,
  ]);
}

// ---------------------------------------------------------------------------
// Bug 5: Fire-and-forget promise without error handling (floating promise)
// ---------------------------------------------------------------------------

/**
 * Handles incoming webhook events from a payment provider. Processes the
 * event and records an audit trail.
 */
export async function handlePaymentWebhook(req: Request, res: Response) {
  const event = req.body;

  if (!event?.type || !event?.data) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  try {
    switch (event.type) {
      case "payment.succeeded":
        logger.info("Payment succeeded", { paymentId: event.data.id });
        // Process the successful payment...
        break;

      case "payment.failed":
        logger.warn("Payment failed", {
          paymentId: event.data.id,
          reason: event.data.failureReason,
        });
        break;

      case "refund.created":
        logger.info("Refund created", { refundId: event.data.id });
        break;

      default:
        logger.debug("Unhandled webhook event type", { type: event.type });
    }

    // BUG: recordAuditEvent is async but is called without await and without
    // a .catch() handler. This is a "floating promise." If the audit write
    // fails, the rejection is unhandled -- in Node.js this triggers an
    // UnhandledPromiseRejection warning (or crash in newer Node versions).
    //
    // Additionally, the response is sent before the audit event is persisted,
    // which means the audit trail has no delivery guarantee.
    //
    // Fix: Either await it (if audit must succeed before responding):
    //   await recordAuditEvent({ ... });
    // Or add a .catch() if fire-and-forget is intentional:
    //   recordAuditEvent({ ... }).catch(err => logger.error("Audit failed", { err }));
    recordAuditEvent({
      type: "webhook_received",
      eventType: event.type,
      eventId: event.data.id,
      timestamp: new Date().toISOString(),
      source: req.headers["x-webhook-source"] ?? "unknown",
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error("Webhook processing failed", {
      error: err instanceof Error ? err.message : "Unknown error",
      eventType: event.type,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}
