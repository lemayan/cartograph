import { SignIn } from "@clerk/nextjs";
import { AuthScreen } from "@/components/auth-screen";
import { authAppearance } from "@/lib/auth-appearance";

export default function SignInPage() {
  return (
    <AuthScreen mode="sign-in">
      <SignIn appearance={authAppearance} />
    </AuthScreen>
  );
}
