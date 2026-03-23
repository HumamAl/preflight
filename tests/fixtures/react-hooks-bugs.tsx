// Expected findings: 4 REACT_MISTAKES
//
// This file simulates a realistic React component for a team member directory
// that an AI assistant might generate. It contains four violations of React's
// rules that cause infinite loops, stale data, or runtime warnings.
//
//   1. Conditional hook call (useState inside an if block)
//   2. useEffect with a missing dependency in its dependency array
//   3. useState setter called directly during render (infinite re-render loop)
//   4. Missing key prop in a .map() that renders a list
//
// These are NOT Next.js-specific issues -- they apply to any React project.

"use client";

import { useState, useEffect, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  department: string;
  avatarUrl: string | null;
  joinedAt: string;
  isActive: boolean;
}

interface TeamDirectoryProps {
  organizationId: string;
  showInactive: boolean;
  searchQuery: string;
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

async function fetchTeamMembers(orgId: string): Promise<TeamMember[]> {
  const res = await fetch(`/api/orgs/${orgId}/members`, {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch team members: ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// BUG #1: Conditional hook call
//
// React hooks must be called in the exact same order on every render. Placing
// useState inside an if block means the hook is only called when showInactive
// is true. When showInactive changes from true to false, the hook call order
// changes and React's internal state tracking breaks -- subsequent hooks get
// the wrong state values, causing unpredictable behavior or a crash with:
//
//   Error: Rendered fewer hooks than expected.
// ---------------------------------------------------------------------------

export default function TeamDirectory({
  organizationId,
  showInactive,
  searchQuery,
}: TeamDirectoryProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // BUG #1: Conditional hook -- useState called inside an if block
  if (showInactive) {
    const [inactiveCount, setInactiveCount] = useState(0);
    // In real code this would be used to display an "N inactive members" badge
    void inactiveCount;
    void setInactiveCount;
  }

  // -------------------------------------------------------------------------
  // BUG #2: Missing dependency in useEffect
  //
  // The effect references `searchQuery` inside its body (via the filtering
  // logic) but the dependency array only includes `organizationId`. When
  // searchQuery changes, the effect does NOT re-run, so the displayed list
  // becomes stale. The user types a new search query and nothing happens
  // until organizationId changes.
  //
  // Fix: add searchQuery to the dependency array, or move the filtering
  // outside the effect.
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchTeamMembers(organizationId)
      .then((data) => {
        if (cancelled) return;

        // searchQuery is used here but NOT listed in the dependency array
        const filtered = searchQuery
          ? data.filter(
              (m) =>
                m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                m.department.toLowerCase().includes(searchQuery.toLowerCase()),
            )
          : data;

        setMembers(filtered);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load team");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]); // BUG: missing searchQuery

  // -------------------------------------------------------------------------
  // BUG #3: useState setter called during render
  //
  // Calling setError() directly in the render body (outside of useEffect, an
  // event handler, or a callback) triggers an immediate state update while
  // React is still rendering. This causes an infinite re-render loop:
  //
  //   render -> setError -> re-render -> setError -> re-render -> ...
  //
  // React will throw:
  //   Error: Too many re-renders. React limits the number of renders to
  //   prevent an infinite loop.
  //
  // Fix: move this validation into the useEffect or use a ref to track
  // whether the error has been set.
  // -------------------------------------------------------------------------

  if (members.length === 0 && !loading) {
    setError("No team members found. Try adjusting your filters."); // BUG: setter during render
  }

  // Computed statistics
  const stats = useMemo(() => {
    const byRole = {
      admin: members.filter((m) => m.role === "admin").length,
      editor: members.filter((m) => m.role === "editor").length,
      viewer: members.filter((m) => m.role === "viewer").length,
    };

    const departments = [...new Set(members.map((m) => m.department))];

    return { byRole, departments, total: members.length };
  }, [members]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
        <span className="ml-3 text-gray-500">Loading team members...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-medium">Error loading team</p>
        <p className="text-sm mt-1">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-sm underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{stats.total}</p>
          <p className="text-sm text-gray-500">Total Members</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{stats.byRole.admin}</p>
          <p className="text-sm text-gray-500">Admins</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-gray-600">{stats.departments.length}</p>
          <p className="text-sm text-gray-500">Departments</p>
        </div>
      </div>

      {/* ---------------------------------------------------------------------------
          BUG #4: Missing key prop in .map()

          React requires a unique `key` prop on each element produced by .map()
          so it can efficiently reconcile the virtual DOM. Without keys, React
          falls back to index-based reconciliation, which causes incorrect
          component reuse when items are reordered, inserted, or deleted. This
          leads to stale state in child components and visual glitches.

          React logs the following warning:
            Warning: Each child in a list should have a unique "key" prop.

          Fix: add key={member.id} to the outer <div> in the .map() callback.
          --------------------------------------------------------------------------- */}

      <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
        {members.map((member) => (
          <div className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {member.avatarUrl ? (
                <img
                  src={member.avatarUrl}
                  alt={`${member.name}'s avatar`}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-indigo-700 font-medium text-sm">
                    {member.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)}
                  </span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900 truncate">{member.name}</p>
                {!member.isActive && (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                    Inactive
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 truncate">{member.email}</p>
            </div>

            {/* Department */}
            <div className="hidden sm:block text-sm text-gray-500">{member.department}</div>

            {/* Role badge */}
            <div>
              <span
                className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                  member.role === "admin"
                    ? "bg-purple-100 text-purple-800"
                    : member.role === "editor"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-gray-100 text-gray-600"
                }`}
              >
                {member.role}
              </span>
            </div>

            {/* Joined date */}
            <div className="hidden md:block text-xs text-gray-400">
              Joined {new Date(member.joinedAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
