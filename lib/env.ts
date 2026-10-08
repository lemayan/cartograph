function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local before starting Cartograph.`);
  }
  return value;
}

export function validateEnvironment() {
  const clerkPublishableKey = required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const clerkSecretKey = required("CLERK_SECRET_KEY");
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const supabasePublishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  if (!/^pk_(test|live)_/.test(clerkPublishableKey)) {
    throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key.");
  }
  if (!/^sk_(test|live)_/.test(clerkSecretKey)) {
    throw new Error("CLERK_SECRET_KEY must be a Clerk secret key.");
  }
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an absolute HTTP or HTTPS URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.");
  }
  if (!supabasePublishableKey.startsWith("sb_publishable_")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key.");
  }
  return { clerkPublishableKey, clerkSecretKey, supabaseUrl, supabasePublishableKey };
}
