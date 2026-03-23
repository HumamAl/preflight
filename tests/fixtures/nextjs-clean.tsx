// Expected findings: 0 (this file should pass preflight cleanly)
//
// This file demonstrates correct Next.js App Router patterns:
//   - A proper async Server Component that fetches data without hooks
//   - A properly marked Client Component with 'use client' and hooks
//   - A proper Route Handler exporting named HTTP method functions
//
// All imports are correct for App Router, cookies() is awaited (Next.js 15+),
// and the Server/Client Component boundary is respected throughout.

import { Suspense } from "react";

// ============================================================================
// Part 1: Server Component (app/projects/page.tsx)
//
// This is a proper Server Component: no 'use client', no hooks, async function
// that fetches data directly. Uses await on cookies() for Next.js 15+.
// ============================================================================

import { cookies } from "next/headers";

interface Project {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived" | "draft";
  lastUpdated: string;
  memberCount: number;
}

interface ProjectsPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

async function getAuthToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get("auth-token")?.value;
}

async function fetchProjects(
  token: string,
  status?: string,
  page?: number,
): Promise<{ projects: Project[]; totalPages: number }> {
  const url = new URL(`${process.env.API_BASE_URL}/projects`);
  if (status) url.searchParams.set("status", status);
  url.searchParams.set("page", String(page ?? 1));
  url.searchParams.set("limit", "20");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch projects: ${res.status}`);
  }

  return res.json();
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const token = await getAuthToken();

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-gray-500">
        <p>Please sign in to view your projects.</p>
      </div>
    );
  }

  const resolvedParams = await searchParams;
  const statusFilter = resolvedParams.status;
  const currentPage = parseInt(resolvedParams.page ?? "1", 10);

  const { projects, totalPages } = await fetchProjects(token, statusFilter, currentPage);

  return (
    <main className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Suspense fallback={<div className="h-10 w-32 bg-gray-100 rounded animate-pulse" />}>
          <ProjectFilterBar currentStatus={statusFilter} />
        </Suspense>
      </div>

      {projects.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No projects found.</p>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-8 flex justify-center gap-2" aria-label="Pagination">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <a
              key={page}
              href={`/projects?page=${page}${statusFilter ? `&status=${statusFilter}` : ""}`}
              className={`px-3 py-1 rounded ${
                page === currentPage
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              aria-current={page === currentPage ? "page" : undefined}
            >
              {page}
            </a>
          ))}
        </nav>
      )}
    </main>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const statusColors: Record<Project["status"], string> = {
    active: "bg-green-100 text-green-800",
    archived: "bg-gray-100 text-gray-600",
    draft: "bg-yellow-100 text-yellow-800",
  };

  return (
    <a
      href={`/projects/${project.id}`}
      className="block p-4 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{project.name}</h2>
          <p className="text-gray-600 text-sm mt-1 line-clamp-2">{project.description}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColors[project.status]}`}>
          {project.status}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
        <span>{project.memberCount} members</span>
        <span>Updated {new Date(project.lastUpdated).toLocaleDateString()}</span>
      </div>
    </a>
  );
}

// Server Component used in Suspense boundary -- also correct without 'use client'
async function ProjectFilterBar({ currentStatus }: { currentStatus?: string }) {
  const statuses: { value: string; label: string }[] = [
    { value: "", label: "All" },
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "draft", label: "Draft" },
  ];

  return (
    <div className="flex gap-2">
      {statuses.map((s) => (
        <a
          key={s.value}
          href={s.value ? `/projects?status=${s.value}` : "/projects"}
          className={`px-3 py-1 rounded-full text-sm ${
            (currentStatus ?? "") === s.value
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {s.label}
        </a>
      ))}
    </div>
  );
}

// ============================================================================
// Part 2: Client Component (app/projects/[id]/project-actions.tsx)
//
// This is a proper Client Component: has 'use client', uses hooks, uses
// useRouter from next/navigation (not next/router), and uses useSearchParams
// instead of router.query.
// ============================================================================

// In a real codebase this would be a separate file with its own 'use client'
// directive at the very top. Shown inline here for the test fixture.

// 'use client'
// import { useState, useTransition } from "react";
// import { useRouter, useSearchParams } from "next/navigation";

// Simulating the client component inline since TSX doesn't allow multiple
// module-level directives. The key patterns are demonstrated below.

export function ProjectActionsClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  // NOTE: In a real file, 'use client' would be at the top and these imports
  // would be from "next/navigation", not "next/router":
  //
  //   const router = useRouter();              // from next/navigation
  //   const searchParams = useSearchParams();   // no .query -- use .get()
  //   const [isPending, startTransition] = useTransition();
  //
  // The following is a placeholder to show the correct structure without
  // actually importing client hooks in this server-compatible fixture file.

  return (
    <div className="flex gap-2">
      <button
        className="px-3 py-1 text-sm bg-red-50 text-red-700 rounded hover:bg-red-100"
        data-project-id={projectId}
      >
        Archive {projectName}
      </button>
    </div>
  );
}

// ============================================================================
// Part 3: Route Handler (app/api/projects/route.ts)
//
// Proper Route Handler: exports named HTTP method functions (GET, POST), not
// a default export. Uses NextRequest/NextResponse correctly.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  try {
    // In a real app, this would query a database
    const mockProjects: Project[] = [
      {
        id: "proj_1",
        name: "Dashboard Redesign",
        description: "Overhaul the main dashboard with new analytics widgets",
        status: "active",
        lastUpdated: new Date().toISOString(),
        memberCount: 5,
      },
    ];

    const filtered = status
      ? mockProjects.filter((p) => p.status === status)
      : mockProjects;

    const paginated = filtered.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      projects: paginated,
      totalPages: Math.ceil(filtered.length / limit),
    });
  } catch (err) {
    console.error("Failed to fetch projects:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "Project name is required" },
        { status: 400 },
      );
    }

    const project: Project = {
      id: `proj_${crypto.randomUUID()}`,
      name: body.name.trim(),
      description: body.description?.trim() ?? "",
      status: "draft",
      lastUpdated: new Date().toISOString(),
      memberCount: 1,
    };

    // In a real app, save to database here

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error("Failed to create project:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
