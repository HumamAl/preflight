// Expected findings: 3 PHANTOM_PACKAGE (critical)
//
// Phantom packages in this file:
//   1. 'zod-mini'             -- does not exist on npm; the real package is 'zod'
//   2. 'express-validator-v2' -- does not exist on npm; the real package is 'express-validator'
//   3. 'helmet-csp'           -- does not exist on npm; CSP config is part of 'helmet' itself

import { z } from "zod-mini";
import { body, validationResult } from "express-validator-v2";
import csp from "helmet-csp";
import type { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Database & config
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

const REGISTRATION_RATE_LIMIT = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Try again later." },
});

// ---------------------------------------------------------------------------
// Validation schemas (uses phantom 'zod-mini')
// ---------------------------------------------------------------------------

const registrationSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must not exceed 128 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain uppercase, lowercase, and a digit",
    ),
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(64, "Display name must not exceed 64 characters")
    .regex(/^[a-zA-Z0-9_ -]+$/, "Display name contains invalid characters"),
  acceptedTerms: z.boolean().refine((v) => v === true, {
    message: "You must accept the terms of service",
  }),
  referralCode: z.string().optional(),
});

type RegistrationPayload = z.infer<typeof registrationSchema>;

// ---------------------------------------------------------------------------
// CSP middleware (uses phantom 'helmet-csp')
// ---------------------------------------------------------------------------

export const contentSecurityPolicy = csp({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://cdn.example.com"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https://images.example.com"],
    connectSrc: ["'self'", "https://api.example.com"],
  },
});

// ---------------------------------------------------------------------------
// Validation middleware (uses phantom 'express-validator-v2')
// ---------------------------------------------------------------------------

export function validateRegistration() {
  return [
    REGISTRATION_RATE_LIMIT,
    body("email").isEmail().normalizeEmail(),
    body("password").trim(),
    body("displayName").trim().escape(),
    body("referralCode").optional().trim().escape(),

    async (req: Request, res: Response, next: NextFunction) => {
      const fieldErrors = validationResult(req);
      if (!fieldErrors.isEmpty()) {
        logger.warn("Registration field validation failed", {
          errors: fieldErrors.array(),
          ip: req.ip,
        });
        return res.status(422).json({
          error: "Validation failed",
          details: fieldErrors.array(),
        });
      }

      const result = registrationSchema.safeParse(req.body);
      if (!result.success) {
        logger.warn("Registration schema validation failed", {
          errors: result.error.issues,
          ip: req.ip,
        });
        return res.status(422).json({
          error: "Validation failed",
          details: result.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      req.body = result.data;
      next();
    },
  ];
}

// ---------------------------------------------------------------------------
// Registration handler
// ---------------------------------------------------------------------------

export async function handleRegistration(req: Request, res: Response) {
  const payload: RegistrationPayload = req.body;

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: payload.email },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "An account with this email already exists",
      });
    }

    const user = await prisma.user.create({
      data: {
        email: payload.email,
        displayName: payload.displayName,
        passwordHash: payload.password, // hashed upstream by auth middleware
        referralCode: payload.referralCode ?? null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });

    logger.info("User registered", { userId: user.id, email: user.email });

    return res.status(201).json({
      message: "Registration successful",
      user,
    });
  } catch (err) {
    logger.error("Registration failed", {
      error: err instanceof Error ? err.message : "Unknown error",
      email: payload.email,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}
