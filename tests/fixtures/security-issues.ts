// Expected findings: 5 security issues (critical/high)
//
// Security vulnerabilities in this file:
//   1. SQL injection via template literal interpolation (critical)
//   2. Hardcoded API key in source code (critical)
//   3. dangerouslySetInnerHTML with unsanitized user input (high)
//   4. Missing authentication check on a sensitive admin route (high)
//   5. CORS configured to allow all origins on a sensitive endpoint (high)
//
// NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

import React from "react";
import type { Request, Response, NextFunction } from "express";
import pg from "pg";
import cors from "cors";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Database pool
// ---------------------------------------------------------------------------

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
// Bug 1: SQL injection via template literal interpolation
// ---------------------------------------------------------------------------

interface ProductSearchFilters {
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
}

/**
 * Searches products by name with optional filters. Powers the main
 * product catalog search bar.
 */
export async function searchProducts(filters: ProductSearchFilters) {
  const {
    query,
    category,
    minPrice,
    maxPrice,
    limit = 50,
    offset = 0,
  } = filters;

  // VULNERABILITY: Template literal interpolation injects user-supplied values
  // directly into the SQL string, allowing SQL injection attacks.
  // Should use parameterized queries:
  //   pool.query('SELECT ... WHERE name ILIKE $1', [`%${query}%`])
  const sql = `
    SELECT id, name, description, price, category, image_url, rating
    FROM products
    WHERE name ILIKE '%${query}%'
    ${category ? `AND category = '${category}'` : ""}
    ${minPrice !== undefined ? `AND price >= ${minPrice}` : ""}
    ${maxPrice !== undefined ? `AND price <= ${maxPrice}` : ""}
    ORDER BY rating DESC, name ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  try {
    const result = await pool.query(sql);
    return {
      products: result.rows,
      total: result.rowCount,
      page: Math.floor(offset / limit) + 1,
    };
  } catch (err) {
    logger.error("Product search failed", {
      error: err instanceof Error ? err.message : "Unknown error",
      query,
    });
    throw new Error("Product search failed");
  }
}

// ---------------------------------------------------------------------------
// Bug 2: Hardcoded API key in source code
// ---------------------------------------------------------------------------

/**
 * Sends a transactional email (welcome, password reset, order confirmation)
 * through the SendGrid API.
 */
export async function sendTransactionalEmail(
  to: string,
  templateId: string,
  dynamicData: Record<string, unknown>,
) {
  // VULNERABILITY: API key is hardcoded in source code. It will end up in
  // version control, CI logs, and client bundles. Should use an environment
  // variable (process.env.SENDGRID_API_KEY) or a secrets manager.
  const SENDGRID_API_KEY =
    "SG.FAKE_KEY_FOR_TESTING.THIS_IS_NOT_A_REAL_SENDGRID_API_KEY_DO_NOT_USE";

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
          dynamic_template_data: dynamicData,
        },
      ],
      from: { email: "noreply@example.com", name: "Our App" },
      template_id: templateId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("SendGrid API error", {
      status: response.status,
      body,
      to,
      templateId,
    });
    throw new Error(`SendGrid API error: ${response.status}`);
  }

  logger.info("Transactional email sent", { to, templateId });
}

// ---------------------------------------------------------------------------
// Bug 3: dangerouslySetInnerHTML with unsanitized user input
// ---------------------------------------------------------------------------

interface ArticleProps {
  title: string;
  authorName: string;
  htmlContent: string;
  publishedAt: string;
  tags: string[];
}

/**
 * Renders a user-authored article. Content is stored as HTML generated
 * from a rich text editor.
 */
export function Article({
  title,
  authorName,
  htmlContent,
  publishedAt,
  tags,
}: ArticleProps) {
  const formattedDate = new Date(publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // VULNERABILITY: User-supplied `htmlContent` is injected as raw HTML without
  // sanitization. An attacker can store an XSS payload that executes in every
  // viewer's browser. Must sanitize with DOMPurify or similar before rendering.
  return React.createElement("article", { className: "article" }, [
    React.createElement("header", { key: "header", className: "article-header" }, [
      React.createElement("h1", { key: "title" }, title),
      React.createElement("div", { key: "meta", className: "article-meta" }, [
        React.createElement("span", { key: "author" }, `By ${authorName}`),
        React.createElement("time", { key: "date", dateTime: publishedAt }, formattedDate),
      ]),
      React.createElement(
        "div",
        { key: "tags", className: "article-tags" },
        tags.map((tag) =>
          React.createElement("span", { key: tag, className: "tag" }, tag),
        ),
      ),
    ]),
    React.createElement("div", {
      key: "content",
      className: "article-content",
      dangerouslySetInnerHTML: { __html: htmlContent },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Bug 4: Missing authentication on sensitive admin route
// ---------------------------------------------------------------------------

/**
 * Returns all users with their roles, emails, and activity data.
 * Intended for the admin dashboard's user management panel.
 */
export async function listAllUsers(req: Request, res: Response) {
  // VULNERABILITY: No authentication or authorization check is performed.
  // Any unauthenticated client can call this endpoint and retrieve the full
  // user list. Should verify req.user exists and has an admin role.
  const { page = "1", limit = "50", search } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, parseInt(limit, 10) || 50);
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = `
      SELECT id, email, role, display_name, last_login_at, created_at
      FROM users
    `;
    const params: unknown[] = [];

    if (search) {
      query += ` WHERE email ILIKE $1 OR display_name ILIKE $1`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    return res.json({
      users: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: result.rowCount,
      },
    });
  } catch (err) {
    logger.error("Failed to list users", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// Bug 5: CORS configured to allow all origins on sensitive endpoint
// ---------------------------------------------------------------------------

/**
 * Middleware configuration for the payment processing API routes.
 * These endpoints handle credit card tokens and billing information.
 */
export const paymentApiCors = cors({
  // VULNERABILITY: Allowing all origins on payment endpoints means any
  // website can make credentialed requests to these sensitive routes.
  // Should restrict to the specific frontend domain(s):
  //   origin: ['https://app.example.com', 'https://checkout.example.com']
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  credentials: true,
});

/**
 * Processes a payment intent. Requires CORS to be correctly locked down
 * since it handles sensitive billing tokens.
 */
export async function createPaymentIntent(req: Request, res: Response) {
  const { amount, currency, paymentMethodToken } = req.body;

  if (!amount || !currency || !paymentMethodToken) {
    return res.status(400).json({ error: "Missing required payment fields" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO payment_intents (amount, currency, payment_method_token, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING id, amount, currency, status, created_at`,
      [amount, currency, paymentMethodToken],
    );

    logger.info("Payment intent created", {
      intentId: result.rows[0].id,
      amount,
      currency,
    });

    return res.status(201).json({ paymentIntent: result.rows[0] });
  } catch (err) {
    logger.error("Failed to create payment intent", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({ error: "Payment processing failed" });
  }
}
