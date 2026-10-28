import type { ListerProfileDefaults } from "@/components/account/ListerProfileForm";
import type { ListerProfile } from "@/db/queries/lister-profiles";
import { displayKenyanPhone } from "@/lib/kenya";

export function profileDefaults(profile: ListerProfile | null, fallbackName: string): ListerProfileDefaults {
  return {
    listerType: profile?.listerType ?? "agent",
    displayName: profile?.displayName ?? fallbackName,
    phone: profile?.phone ? displayKenyanPhone(profile.phone) : "",
    publicEmail: profile?.publicEmail ?? "",
    bio: profile?.bio ?? "",
  };
}
