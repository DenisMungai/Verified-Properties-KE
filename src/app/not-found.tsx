import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState, buttonClasses } from "@/components/ui";

export default function NotFound() {
  return (
    <PageContainer className="py-10">
      <EmptyState
        icon={<SearchX />}
        title="Page not found"
        description="The page you are looking for does not exist or is no longer available."
        action={
          <Link href="/" className={buttonClasses()}>
            Go to the home page
          </Link>
        }
      />
    </PageContainer>
  );
}
