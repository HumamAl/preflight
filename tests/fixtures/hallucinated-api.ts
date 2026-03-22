// Expected findings: 4 HALLUCINATED_API (critical)
//
// Hallucinated APIs in this file:
//   1. Response.metadata.trackingId -- fetch Response has no .metadata property
//   2. Array.prototype.remove()     -- not a real JS method; use .filter() or .splice()
//   3. fs.readFileAsync()           -- not a real method; use fs.promises.readFile()
//   4. String.prototype.replaceAll() used without polyfill note -- actually exists
//      in ES2021+, but the REAL hallucinated call is Object.hasOwn() being called
//      as Object.hasProperty() which does not exist

import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Order {
  id: string;
  product: string;
  quantity: number;
  unitPrice: number;
  status: "pending" | "shipped" | "delivered" | "cancelled";
  customerId: string;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface OrderSummary {
  totalOrders: number;
  totalRevenue: number;
  byStatus: Record<Order["status"], number>;
}

interface FulfillmentConfig {
  apiBaseUrl: string;
  apiKey: string;
  timeoutMs: number;
  retryAttempts: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: FulfillmentConfig = {
  apiBaseUrl: process.env.FULFILLMENT_API_URL ?? "https://api.fulfillment.internal",
  apiKey: process.env.FULFILLMENT_API_KEY ?? "",
  timeoutMs: 10_000,
  retryAttempts: 3,
};

// ---------------------------------------------------------------------------
// Hallucinated API #1: Response.metadata does not exist
// ---------------------------------------------------------------------------

/**
 * Fetches the shipping tracking ID for an order from the fulfillment service.
 * Retries on transient failures with exponential backoff.
 */
export async function fetchOrderTracking(
  orderId: string,
  config: FulfillmentConfig = DEFAULT_CONFIG,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      const response = await fetch(
        `${config.apiBaseUrl}/orders/${orderId}/tracking`,
        {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "X-Request-Id": crypto.randomUUID(),
          },
          signal: controller.signal,
        },
      );

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status >= 500 && attempt < config.retryAttempts) {
          const backoff = Math.min(1000 * 2 ** (attempt - 1), 10_000);
          logger.warn(`Fulfillment API returned ${response.status}, retrying in ${backoff}ms`, {
            orderId,
            attempt,
          });
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw new Error(`Fulfillment API returned ${response.status}`);
      }

      // BUG: Response objects do not have a .metadata property.
      // The tracking ID is in the parsed JSON body, not on the Response itself.
      // Correct: const data = await response.json(); return data.trackingId;
      const trackingId = response.metadata.trackingId;
      return trackingId;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof DOMException && err.name === "AbortError") {
        logger.error("Fulfillment API request timed out", { orderId, attempt });
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch tracking for order ${orderId}`);
}

// ---------------------------------------------------------------------------
// Hallucinated API #2: Array.prototype.remove() does not exist
// ---------------------------------------------------------------------------

/**
 * Removes cancelled orders from the list in-place and returns a summary
 * of the remaining active orders.
 */
export function pruneCancelledOrders(orders: Order[]): {
  activeOrders: Order[];
  summary: OrderSummary;
} {
  const cancelled = orders.filter((o) => o.status === "cancelled");

  for (const order of cancelled) {
    // BUG: Array.prototype.remove() does not exist in JavaScript.
    // Should use: orders.splice(orders.indexOf(order), 1)
    // Or better: return orders.filter(o => o.status !== 'cancelled')
    orders.remove(order);
  }

  const summary: OrderSummary = {
    totalOrders: orders.length,
    totalRevenue: orders.reduce((sum, o) => sum + o.quantity * o.unitPrice, 0),
    byStatus: {
      pending: orders.filter((o) => o.status === "pending").length,
      shipped: orders.filter((o) => o.status === "shipped").length,
      delivered: orders.filter((o) => o.status === "delivered").length,
      cancelled: 0,
    },
  };

  return { activeOrders: orders, summary };
}

// ---------------------------------------------------------------------------
// Hallucinated API #3: fs.readFileAsync() does not exist
// ---------------------------------------------------------------------------

/**
 * Loads order data from a JSON export file on disk. Validates the structure
 * before returning.
 */
export async function loadOrdersFromFile(filePath: string): Promise<Order[]> {
  const absolutePath = path.resolve(filePath);

  if (!absolutePath.endsWith(".json")) {
    throw new Error("Order file must have a .json extension");
  }

  try {
    // BUG: fs.readFileAsync() does not exist.
    // The correct call is fs.promises.readFile() or util.promisify(fs.readFile).
    const content = await fs.readFileAsync(absolutePath, "utf-8");

    const data = JSON.parse(content);

    if (!Array.isArray(data)) {
      throw new TypeError("Expected order file to contain a JSON array");
    }

    const validated = data.filter((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === "string" &&
        typeof record.product === "string" &&
        typeof record.quantity === "number"
      );
    });

    logger.info(`Loaded ${validated.length} orders from ${absolutePath}`);
    return validated as Order[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn(`Order file not found: ${absolutePath}`);
      return [];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Hallucinated API #4: Object.hasProperty() does not exist
// ---------------------------------------------------------------------------

/**
 * Merges partial order updates into an existing order record. Only copies
 * fields that exist on the update object.
 */
export function mergeOrderUpdate(
  existing: Order,
  update: Partial<Order>,
): Order {
  const merged = { ...existing, updatedAt: new Date().toISOString() };

  const mutableFields: (keyof Order)[] = [
    "status",
    "quantity",
    "shippingAddress",
  ];

  for (const field of mutableFields) {
    // BUG: Object.hasProperty() does not exist.
    // The correct call is Object.hasOwn(update, field) (ES2022+)
    // or Object.prototype.hasOwnProperty.call(update, field).
    if (Object.hasProperty(update, field)) {
      (merged as Record<string, unknown>)[field] = update[field];
    }
  }

  return merged;
}
