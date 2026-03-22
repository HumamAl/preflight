// Expected findings: 3 DEPRECATED_API (medium)
//
// This file uses three deprecated APIs:
//   1. React componentWillMount() -- removed in React 18, use useEffect or constructor
//   2. new Buffer()               -- deprecated since Node 6, use Buffer.from()
//   3. url.parse()                -- deprecated, use new URL() / WHATWG URL API

import React from "react";
import url from "node:url";

// ---------------------------------------------------------------------------
// Bug 1: componentWillMount (deprecated React lifecycle)
// ---------------------------------------------------------------------------

interface DashboardProps {
  userId: string;
  apiBase: string;
}

interface DashboardState {
  metrics: { label: string; value: number }[];
  loading: boolean;
  error: string | null;
}

/**
 * A dashboard component that fetches user metrics on mount.
 * Uses the class component pattern.
 */
export class MetricsDashboard extends React.Component<
  DashboardProps,
  DashboardState
> {
  state: DashboardState = {
    metrics: [],
    loading: true,
    error: null,
  };

  // DEPRECATED: componentWillMount was removed in React 18.
  // Use componentDidMount or convert to a function component with useEffect.
  componentWillMount() {
    this.loadMetrics();
  }

  async loadMetrics() {
    try {
      const res = await fetch(
        `${this.props.apiBase}/users/${this.props.userId}/metrics`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const metrics = await res.json();
      this.setState({ metrics, loading: false });
    } catch (err) {
      this.setState({
        error: err instanceof Error ? err.message : "Unknown error",
        loading: false,
      });
    }
  }

  render() {
    const { metrics, loading, error } = this.state;

    if (loading) return React.createElement("p", null, "Loading metrics...");
    if (error) return React.createElement("p", { className: "error" }, error);

    return React.createElement(
      "ul",
      null,
      metrics.map((m) =>
        React.createElement("li", { key: m.label }, `${m.label}: ${m.value}`),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Bug 2: new Buffer() (deprecated Node.js API)
// ---------------------------------------------------------------------------

/**
 * Encodes a plain-text token into a Base64 string suitable for an
 * Authorization header.
 */
export function encodeAuthToken(username: string, password: string): string {
  const credentials = `${username}:${password}`;

  // DEPRECATED: new Buffer(string) has been deprecated since Node.js v6.
  // Use Buffer.from(string) instead to avoid potential security issues
  // related to uninitialized memory.
  const encoded = new Buffer(credentials).toString("base64");
  return `Basic ${encoded}`;
}

// ---------------------------------------------------------------------------
// Bug 3: url.parse() (deprecated Node.js API)
// ---------------------------------------------------------------------------

/**
 * Extracts query parameters from a callback URL after an OAuth redirect.
 */
export function extractOAuthParams(callbackUrl: string): {
  code: string | null;
  state: string | null;
} {
  // DEPRECATED: url.parse() is legacy. Use the WHATWG URL API (new URL())
  // which handles edge cases better and is the recommended approach.
  const parsed = url.parse(callbackUrl, true);

  return {
    code: (parsed.query.code as string) ?? null,
    state: (parsed.query.state as string) ?? null,
  };
}
