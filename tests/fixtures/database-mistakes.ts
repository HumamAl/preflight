// Expected findings: 4 DATABASE_MISTAKES (high/critical)
//
// Database anti-patterns in this file:
//   1. N+1 query pattern (loop with individual DB queries)
//   2. SQL injection via template literal interpolation
//   3. Missing transaction for multi-step DB operations
//   4. Prisma findFirst without orderBy (non-deterministic result)
//
// NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Database clients
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
  ],
});

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error("Unexpected database pool error", { error: err.message });
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

interface OrderWithDetails {
  id: string;
  customerEmail: string;
  status: string;
  items: (OrderItem & { productName: string; productImageUrl: string })[];
  total: number;
  createdAt: Date;
}

interface TeamMember {
  userId: string;
  teamId: string;
  role: "owner" | "admin" | "member";
  joinedAt: Date;
}

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

// ---------------------------------------------------------------------------
// Bug 1: N+1 query pattern -- individual DB query inside a loop
// ---------------------------------------------------------------------------

/**
 * Fetches all orders for a customer, including full product details for every
 * line item. Used to render the "Order History" page.
 */
export async function getOrderHistory(customerId: string): Promise<OrderWithDetails[]> {
  // First query: get all orders for this customer
  const orders = await prisma.order.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const ordersWithDetails: OrderWithDetails[] = [];

  // BUG: N+1 query pattern. For each order, we run a query to get its items,
  // and then for EACH item, we run another query to get the product details.
  // With 50 orders averaging 3 items each, that is 50 + 150 = 200 extra
  // queries when a single query with includes/joins would suffice.
  //
  // Fix: Use Prisma includes to fetch everything in one query:
  //   const orders = await prisma.order.findMany({
  //     where: { customerId },
  //     orderBy: { createdAt: "desc" },
  //     take: 50,
  //     include: {
  //       items: {
  //         include: { product: { select: { name: true, imageUrl: true } } }
  //       }
  //     }
  //   });
  for (const order of orders) {
    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
    });

    const itemsWithProducts = [];
    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { name: true, imageUrl: true },
      });

      itemsWithProducts.push({
        ...item,
        productName: product?.name ?? "Unknown Product",
        productImageUrl: product?.imageUrl ?? "/placeholder.png",
      });
    }

    ordersWithDetails.push({
      id: order.id,
      customerEmail: order.customerEmail,
      status: order.status,
      items: itemsWithProducts,
      total: itemsWithProducts.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      ),
      createdAt: order.createdAt,
    });
  }

  return ordersWithDetails;
}

// ---------------------------------------------------------------------------
// Bug 2: SQL injection via template literal interpolation
// ---------------------------------------------------------------------------

/**
 * Searches the activity log for audit trail entries. Supports filtering by
 * user, action type, and date range. Powers the admin "Audit Log" page.
 */
export async function searchAuditLog(
  req: Request,
  res: Response,
) {
  const {
    userId,
    action,
    startDate,
    endDate,
    search,
    limit = "100",
    offset = "0",
  } = req.query as Record<string, string>;

  // BUG: Building SQL with template literal interpolation. Every query
  // parameter sourced from req.query is injected directly into the SQL
  // string, allowing SQL injection attacks. An attacker can pass:
  //   ?search=' OR 1=1; DROP TABLE audit_log; --
  //
  // Fix: Use parameterized queries:
  //   const params: unknown[] = [];
  //   let sql = 'SELECT * FROM audit_log WHERE 1=1';
  //   if (userId) { params.push(userId); sql += ` AND user_id = $${params.length}`; }
  //   ...
  let sql = `
    SELECT
      id,
      user_id,
      action,
      resource_type,
      resource_id,
      metadata,
      ip_address,
      created_at
    FROM audit_log
    WHERE 1=1
  `;

  if (userId) {
    sql += ` AND user_id = '${userId}'`;
  }

  if (action) {
    sql += ` AND action = '${action}'`;
  }

  if (startDate) {
    sql += ` AND created_at >= '${startDate}'`;
  }

  if (endDate) {
    sql += ` AND created_at <= '${endDate}'`;
  }

  if (search) {
    sql += ` AND (action ILIKE '%${search}%' OR metadata::text ILIKE '%${search}%')`;
  }

  sql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

  try {
    const result = await pool.query(sql);

    return res.json({
      entries: result.rows,
      count: result.rowCount,
      pagination: {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  } catch (err) {
    logger.error("Audit log search failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({ error: "Failed to search audit log" });
  }
}

// ---------------------------------------------------------------------------
// Bug 3: Missing transaction for multi-step DB operations
// ---------------------------------------------------------------------------

/**
 * Transfers a team member from one team to another. Updates the member's team
 * assignment, adjusts both teams' member counts, and logs the transfer in the
 * activity feed.
 */
export async function transferTeamMember(
  userId: string,
  fromTeamId: string,
  toTeamId: string,
  newRole: TeamMember["role"] = "member",
): Promise<{ success: boolean; error?: string }> {
  // BUG: Four related writes that MUST be atomic are executed independently.
  // If any step fails (network error, constraint violation, etc.), the
  // database is left in an inconsistent state. For example:
  //   - Step 1 succeeds (member removed from old team)
  //   - Step 2 fails (member not added to new team)
  //   - Result: the member belongs to NO team
  //
  // Fix: Wrap all operations in a Prisma interactive transaction:
  //   await prisma.$transaction(async (tx) => {
  //     await tx.teamMember.delete({ where: { ... } });
  //     await tx.teamMember.create({ data: { ... } });
  //     await tx.team.update({ where: { id: fromTeamId }, data: { memberCount: { decrement: 1 } } });
  //     await tx.team.update({ where: { id: toTeamId }, data: { memberCount: { increment: 1 } } });
  //   });
  try {
    // Step 1: Remove from old team
    await prisma.teamMember.delete({
      where: {
        userId_teamId: {
          userId,
          teamId: fromTeamId,
        },
      },
    });

    // Step 2: Add to new team
    await prisma.teamMember.create({
      data: {
        userId,
        teamId: toTeamId,
        role: newRole,
        joinedAt: new Date(),
      },
    });

    // Step 3: Decrement old team's member count
    await prisma.team.update({
      where: { id: fromTeamId },
      data: { memberCount: { decrement: 1 } },
    });

    // Step 4: Increment new team's member count
    await prisma.team.update({
      where: { id: toTeamId },
      data: { memberCount: { increment: 1 } },
    });

    logger.info("Team member transferred", {
      userId,
      fromTeamId,
      toTeamId,
      newRole,
    });

    return { success: true };
  } catch (err) {
    logger.error("Team member transfer failed", {
      error: err instanceof Error ? err.message : "Unknown error",
      userId,
      fromTeamId,
      toTeamId,
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Transfer failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Bug 4: Prisma findFirst without orderBy -- non-deterministic result
// ---------------------------------------------------------------------------

/**
 * Generates an invoice for a customer's most recent subscription billing
 * period. Finds the current active subscription, then creates an invoice
 * with the appropriate line items.
 */
export async function generateSubscriptionInvoice(
  customerId: string,
): Promise<{ invoiceId: string; total: number } | null> {
  // BUG: findFirst without orderBy returns a non-deterministic result.
  // If the customer has multiple active subscriptions (e.g., after a failed
  // cancellation, or during a plan change), this returns whichever one the
  // database engine finds first -- which can vary between query executions,
  // across replicas, or after a VACUUM.
  //
  // Fix: Add orderBy to make the selection deterministic:
  //   const subscription = await prisma.subscription.findFirst({
  //     where: { customerId, status: "active" },
  //     orderBy: { createdAt: "desc" },
  //   });
  // Or if there should be exactly one, use a unique constraint and findUnique.
  const subscription = await prisma.subscription.findFirst({
    where: {
      customerId,
      status: "active",
    },
  });

  if (!subscription) {
    logger.warn("No active subscription found for invoice generation", {
      customerId,
    });
    return null;
  }

  const plan = await prisma.plan.findUnique({
    where: { id: subscription.planId },
  });

  if (!plan) {
    logger.error("Subscription references non-existent plan", {
      customerId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
    });
    return null;
  }

  const lineItems: InvoiceLineItem[] = [
    {
      description: `${plan.name} - Monthly Subscription`,
      quantity: 1,
      unitPrice: plan.price,
      taxRate: 0.0,
    },
  ];

  // Add usage-based charges if applicable
  if (plan.hasUsageCharges) {
    const usage = await prisma.usageRecord.aggregate({
      where: {
        subscriptionId: subscription.id,
        billingPeriod: subscription.currentBillingPeriod,
      },
      _sum: { quantity: true },
    });

    const usageQuantity = usage._sum.quantity ?? 0;
    if (usageQuantity > plan.includedUnits) {
      const overageUnits = usageQuantity - plan.includedUnits;
      lineItems.push({
        description: `Usage overage (${overageUnits} units @ $${plan.overagePrice}/unit)`,
        quantity: overageUnits,
        unitPrice: plan.overagePrice,
        taxRate: 0.0,
      });
    }
  }

  const subtotal = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  const tax = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice * item.taxRate,
    0,
  );
  const total = subtotal + tax;

  const invoice = await prisma.invoice.create({
    data: {
      customerId,
      subscriptionId: subscription.id,
      lineItems: lineItems as unknown as object,
      subtotal,
      tax,
      total,
      status: "draft",
      issuedAt: new Date(),
    },
  });

  logger.info("Subscription invoice generated", {
    invoiceId: invoice.id,
    customerId,
    total,
  });

  return { invoiceId: invoice.id, total };
}
