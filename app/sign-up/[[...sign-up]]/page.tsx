import { SignUp } from "@clerk/nextjs";
import { AuthScreen } from "@/components/auth-screen";
import { authAppearance } from "@/lib/auth-appearance";

export default function SignUpPage() {
  return (
    <AuthScreen mode="sign-up">
      <SignUp appearance={authAppearance} />
    </AuthScreen>
  );
}
