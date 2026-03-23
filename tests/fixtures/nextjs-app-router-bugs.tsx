// Expected findings: 5 NEXTJS_MISTAKES
//
// This file simulates a realistic Next.js App Router component that an AI
// assistant might generate. It contains five distinct mistakes that stem from
// confusing Pages Router and App Router patterns, or misunderstanding the
// Server Component / Client Component boundary.
//
//   1. useState used in a Server Component (no 'use client' directive)
//   2. useRouter imported from next/router instead of next/navigation
//   3. cookies() called synchronously (needs await in Next.js 15+)
//   4. getServerSideProps exported from an app/ directory file
//   5. Missing 'use client' directive when using onClick + hooks
//
// File path context: app/dashboard/settings/page.tsx

import { useState, useEffect } from "react";
import { useRouter } from "next/router"; // BUG #2: wrong import for App Router
import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSettings {
  id: string;
  displayName: string;
  email: string;
  theme: "light" | "dark" | "system";
  language: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  timezone: string;
  updatedAt: string;
}

interface SettingsPageProps {
  params: { orgId: string };
}

// ---------------------------------------------------------------------------
// BUG #4: getServerSideProps in app/ directory
//
// This is a Pages Router data-fetching pattern. In the App Router, Server
// Components are async by default -- data should be fetched directly in the
// component body or in a separate server action. getServerSideProps is
// completely ignored by the App Router runtime and the data will never load.
// ---------------------------------------------------------------------------

export async function getServerSideProps(context: { params: { orgId: string } }) {
  const res = await fetch(
    `${process.env.API_BASE_URL}/orgs/${context.params.orgId}/settings`,
    {
      headers: {
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
    },
  );

  if (!res.ok) {
    return { notFound: true };
  }

  const settings: UserSettings = await res.json();
  return { props: { settings } };
}

// ---------------------------------------------------------------------------
// BUG #3: Synchronous cookies() call
//
// In Next.js 15+, cookies() is async and returns a Promise<ReadonlyRequestCookies>.
// Calling it without await gives you a Promise object, so .get() returns
// undefined instead of the cookie value. The theme will always fall back to
// "system" regardless of what the user has set.
// ---------------------------------------------------------------------------

function getThemeFromCookies(): string {
  const cookieStore = cookies(); // BUG: missing await
  const themeCookie = cookieStore.get("theme");
  return themeCookie?.value ?? "system";
}

// ---------------------------------------------------------------------------
// BUG #1 & #5: Server Component using useState / hooks without 'use client'
//
// This file has no 'use client' directive at the top, so Next.js treats it as
// a Server Component. Server Components run only on the server and cannot use
// React hooks that depend on client-side state or lifecycle (useState,
// useEffect, useRef, etc.). Attempting to use them causes a build error:
//
//   Error: useState only works in Client Components. Add the "use client"
//   directive at the top of the file to use it.
//
// The component also uses onClick handlers which require client-side JS.
// ---------------------------------------------------------------------------

export default function SettingsPage({ params }: SettingsPageProps) {
  // BUG #1: useState in Server Component
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BUG #2: useRouter from next/router has no .push() in App Router context.
  // In the App Router, useRouter must come from next/navigation. The
  // next/router version also provides .query which does not exist on the
  // next/navigation version, leading to undefined values at runtime.
  const router = useRouter();
  const orgId = router.query.orgId as string; // .query doesn't exist on next/navigation's useRouter

  const currentTheme = getThemeFromCookies();

  // BUG #5 (related to #1): useEffect in a Server Component
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch(`/api/orgs/${orgId}/settings`);
        if (!res.ok) throw new Error("Failed to load settings");
        const data: UserSettings = await res.json();
        setSettings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
    loadSettings();
  }, [orgId]);

  async function handleSave(updatedSettings: Partial<UserSettings>) {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/orgs/${params.orgId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedSettings),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? "Failed to save settings");
      }

      const saved: UserSettings = await res.json();
      setSettings(saved);
      router.push(`/orgs/${params.orgId}/dashboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">Organization Settings</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          handleSave({
            displayName: formData.get("displayName") as string,
            theme: formData.get("theme") as UserSettings["theme"],
            language: formData.get("language") as string,
            timezone: formData.get("timezone") as string,
            notifications: {
              email: formData.get("notif-email") === "on",
              push: formData.get("notif-push") === "on",
              sms: formData.get("notif-sms") === "on",
            },
          });
        }}
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
              Display Name
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              defaultValue={settings.displayName}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>

          <div>
            <label htmlFor="theme" className="block text-sm font-medium text-gray-700">
              Theme (current: {currentTheme})
            </label>
            <select
              id="theme"
              name="theme"
              defaultValue={settings.theme}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>

          <div>
            <label htmlFor="language" className="block text-sm font-medium text-gray-700">
              Language
            </label>
            <select
              id="language"
              name="language"
              defaultValue={settings.language}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="ja">Japanese</option>
            </select>
          </div>

          <fieldset className="border border-gray-200 rounded-md p-4">
            <legend className="text-sm font-medium text-gray-700 px-2">Notifications</legend>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="notif-email" defaultChecked={settings.notifications.email} />
                <span className="text-sm">Email notifications</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="notif-push" defaultChecked={settings.notifications.push} />
                <span className="text-sm">Push notifications</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="notif-sms" defaultChecked={settings.notifications.sms} />
                <span className="text-sm">SMS notifications</span>
              </label>
            </div>
          </fieldset>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
