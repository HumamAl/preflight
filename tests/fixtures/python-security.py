# Expected findings: 5 security issues (critical/high)
#
# This file contains five security vulnerabilities:
#   1. os.system() with f-string interpolation (command injection) -- critical
#   2. pickle.loads() on untrusted network input (insecure deserialization) -- critical
#   3. eval() on user-supplied input (arbitrary code execution) -- critical
#   4. SQL query with f-string interpolation (SQL injection) -- critical
#   5. Hardcoded database password in source code (credential exposure) -- high
#
# NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

from __future__ import annotations

import logging
import os
import pickle
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bug 1: Hardcoded database password
# ---------------------------------------------------------------------------

# VULNERABILITY: Database credentials are hardcoded in source code. They will
# end up in version control, CI logs, and container images. Should use
# environment variables (os.environ["DB_PASSWORD"]) or a secrets manager.
DB_CONFIG = {
    "host": "db.internal.prod.example.com",
    "port": 5432,
    "database": "app_production",
    "user": "app_service",
    "password": "FAKE_PASSWORD_FOR_TESTING_DO_NOT_USE",
}


def get_db_connection() -> sqlite3.Connection:
    """Return a connection to the application database.

    Uses sqlite3 for the fixture, but the hardcoded password above is the real
    vulnerability -- it would be used with psycopg2 or asyncpg in production.
    """
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            created_at TEXT NOT NULL
        )
        """
    )
    return conn


# ---------------------------------------------------------------------------
# Bug 2: SQL injection via f-string interpolation
# ---------------------------------------------------------------------------


@dataclass
class UserSearchResult:
    id: int
    username: str
    email: str
    role: str


def search_users(
    conn: sqlite3.Connection,
    query: str,
    role: str | None = None,
) -> list[UserSearchResult]:
    """Search users by username, with optional role filtering.

    Returns matching users sorted by username.
    """
    # VULNERABILITY: f-string interpolation injects user-supplied values
    # directly into the SQL string, enabling SQL injection attacks.
    # Should use parameterized queries:
    #   conn.execute("SELECT ... WHERE username LIKE ?", (f"%{query}%",))
    sql = f"""
        SELECT id, username, email, role
        FROM users
        WHERE username LIKE '%{query}%'
    """

    if role is not None:
        sql += f" AND role = '{role}'"

    sql += " ORDER BY username"

    cursor = conn.execute(sql)
    return [
        UserSearchResult(
            id=row["id"],
            username=row["username"],
            email=row["email"],
            role=row["role"],
        )
        for row in cursor.fetchall()
    ]


# ---------------------------------------------------------------------------
# Bug 3: os.system() with f-string interpolation (command injection)
# ---------------------------------------------------------------------------


def generate_report(output_dir: str, report_name: str) -> str:
    """Generate a PDF report by invoking an external tool.

    The report name is provided by the caller (often from user input in an
    admin panel).
    """
    output_path = os.path.join(output_dir, f"{report_name}.pdf")

    # VULNERABILITY: os.system() passes the string to the shell for parsing.
    # A report_name like 'sales; rm -rf /' results in arbitrary command
    # execution. Should use subprocess.run() with a list of arguments:
    #   subprocess.run(["wkhtmltopdf", template_path, output_path], check=True)
    os.system(f"wkhtmltopdf /tmp/report_template.html {output_path}")

    logger.info("Generated report at %s", output_path)
    return output_path


# ---------------------------------------------------------------------------
# Bug 4: pickle.loads() on untrusted input (insecure deserialization)
# ---------------------------------------------------------------------------


class AnalyticsHandler(BaseHTTPRequestHandler):
    """HTTP handler that accepts serialized analytics events from clients."""

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self.send_error(400, "Empty request body")
            return

        raw_body = self.rfile.read(content_length)

        # VULNERABILITY: pickle.loads() on data received from the network
        # allows arbitrary code execution. An attacker can craft a pickle
        # payload that runs arbitrary Python code during deserialization.
        # Should use a safe format like JSON:
        #   event = json.loads(raw_body)
        try:
            event = pickle.loads(raw_body)
        except Exception:
            self.send_error(400, "Failed to deserialize event payload")
            return

        logger.info("Received analytics event: %s", event.get("type", "unknown"))

        self.send_response(202)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status": "accepted"}')


# ---------------------------------------------------------------------------
# Bug 5: eval() on user input (arbitrary code execution)
# ---------------------------------------------------------------------------


class ExpressionEvaluator:
    """Evaluates mathematical expressions submitted by users.

    Used in a dashboard widget that lets users create custom metric formulas
    like 'revenue - costs' or 'signups * 0.15'.
    """

    def __init__(self, variables: dict[str, float]) -> None:
        self._variables = variables

    def evaluate(self, expression: str) -> float:
        """Evaluate a user-provided mathematical expression.

        The expression can reference any variable name registered in the
        evaluator's context.
        """
        # VULNERABILITY: eval() executes arbitrary Python code, not just math.
        # A user can submit '__import__("os").system("rm -rf /")' and it will
        # execute. Should use ast.literal_eval() for simple expressions, or a
        # proper expression parser (e.g. asteval, simpleeval) for formulas.
        try:
            result = eval(expression, {"__builtins__": {}}, self._variables)
        except Exception as exc:
            raise ValueError(f"Invalid expression '{expression}': {exc}") from exc

        if not isinstance(result, (int, float)):
            raise TypeError(
                f"Expression must evaluate to a number, got {type(result).__name__}"
            )

        return float(result)


# ---------------------------------------------------------------------------
# Application entry point
# ---------------------------------------------------------------------------


def main() -> None:
    conn = get_db_connection()

    # Seed some demo data
    now = datetime.now(timezone.utc).isoformat()
    conn.executemany(
        "INSERT INTO users (username, email, role, created_at) VALUES (?, ?, ?, ?)",
        [
            ("alice", "alice@example.com", "admin", now),
            ("bob", "bob@example.com", "editor", now),
            ("charlie", "charlie@example.com", "viewer", now),
        ],
    )
    conn.commit()

    # Demo: run a search (vulnerable to SQL injection)
    results = search_users(conn, "ali", role="admin")
    for user in results:
        logger.info("Found user: %s (%s)", user.username, user.role)

    # Demo: evaluate an expression (vulnerable to code injection)
    evaluator = ExpressionEvaluator({"revenue": 50000.0, "costs": 32000.0})
    profit = evaluator.evaluate("revenue - costs")
    logger.info("Profit: %.2f", profit)

    # Demo: generate a report (vulnerable to command injection)
    generate_report("/var/reports", "q4-summary")

    conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
