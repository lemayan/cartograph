import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth-header";
import { StartWorkspace } from "@/components/start-workspace";

export default async function StartPage() {
  const { orgId } = await auth.protect();
  if (orgId) redirect("/");
  return (
    <>
      <AuthHeader />
      <main id="main-content" className="auth-content"><StartWorkspace /></main>
    </>
  );
}
