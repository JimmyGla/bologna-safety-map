import { redirect } from "next/navigation";
import { adminConfigured } from "@/lib/admin-auth";
import { isAdmin } from "@/lib/admin-session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin login · Bologna Safety Map", robots: { index: false } };

const MESSAGES: Record<string, string> = {
  invalid: "Wrong password.",
  locked: "Too many attempts. Try again in 15 minutes.",
  disabled: "Admin is disabled: set ADMIN_PASSWORD (at least 12 characters).",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect("/admin");
  const { error } = await searchParams;
  const disabled = !adminConfigured(process.env.ADMIN_PASSWORD);
  const message = disabled ? MESSAGES.disabled : error ? MESSAGES[error] : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 p-4 text-gray-900">
      <form method="post" action="/api/admin/login" className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow">
        <h1 className="text-lg font-semibold">Bologna Safety Map · Admin</h1>
        {message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>}
        <label className="block text-sm">
          <span className="text-gray-600">Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            disabled={disabled}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={disabled}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
