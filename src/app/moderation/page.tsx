import type { Metadata } from "next";
import { AlsoContact, Bullets, LegalPage, TextLink, type LegalSection } from "@/components/legal/LegalPage";
import { DATA_REQUEST_PATH } from "@/lib/legal";
import { REPORT_REASONS, REPORT_REASON_LABELS } from "@/lib/validation/engagement";
import { MESSAGE_REPORT_REASONS, MESSAGE_REPORT_REASON_LABELS } from "@/lib/validation/messaging";
import { REVIEW_TARGET_WORKING_DAYS } from "@/lib/verification/rules";

export const metadata: Metadata = {
  title: "Moderation and reports",
  description: "Which listings we review, how to report a listing or a message, what happens next and how to appeal.",
};

/**
 * Moderation and listing-report process (plan v2.0 §12 "Moderation and listing-report process
 * published"; prompt S20). Report reasons come from the same lists the report forms use.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "listings",
    title: "Which listings we review",
    body: (
      <>
        <p>
          Listings from listers who aren&apos;t verified are checked by a moderator before they appear in search. We approve them,
          or reject them with a reason the lister can fix and resubmit. If a lister makes a material change to a live listing,
          such as its title, description, type or location, it goes back for review.
        </p>
        <p>
          Listings from verified listers go live without this step, because we have already checked who they are. They can still
          be reported and taken down.
        </p>
        <p>
          Verification reviews have a target of {REVIEW_TARGET_WORKING_DAYS} working days. Listings and reports are reviewed in
          the order they arrive.
        </p>
      </>
    ),
  },
  {
    id: "report-listing",
    title: "Reporting a listing",
    body: (
      <>
        <p>
          Signed in, open the listing and choose <strong className="font-semibold text-ink">Report listing</strong>. Pick the
          reason that fits best:
        </p>
        <Bullets items={REPORT_REASONS.map((reason) => REPORT_REASON_LABELS[reason])} />
        <p>You can have one open report per listing, and you can&apos;t report your own.</p>
      </>
    ),
  },
  {
    id: "report-message",
    title: "Reporting a message",
    body: (
      <>
        <p>
          In a conversation, choose <strong className="font-semibold text-ink">Report</strong> on the message. Only the person who
          received a message can report it. You can block the sender at the same time; blocking stops messages both ways until
          you unblock. Reasons:
        </p>
        <Bullets items={MESSAGE_REPORT_REASONS.map((reason) => MESSAGE_REPORT_REASON_LABELS[reason])} />
      </>
    ),
  },
  {
    id: "what-happens",
    title: "What happens next",
    body: (
      <Bullets
        items={[
          "A moderator looks at the report. For a reported message, they can read that conversation; every view is logged.",
          "If the report is not upheld, it is dismissed and nothing changes.",
          `If it is, we take the listing down, or remove the message and can close the conversation. We may also suspend the account or the Profile verified badge, as our terms allow.`,
          "Every moderation decision is recorded with who made it, when and why.",
        ]}
      />
    ),
  },
  {
    id: "appeals",
    title: "Appeals",
    body: (
      <p>
        If you think we got a decision wrong, for example a rejected listing or a takedown, use the{" "}
        <TextLink href={DATA_REQUEST_PATH}>request form</TextLink> and choose &ldquo;Something else&rdquo;. Say which listing and
        why. A different moderator looks at it where we can.<AlsoContact />
      </p>
    ),
  },
  {
    id: "safety",
    title: "Staying safe",
    body: (
      <p>
        Visit a property and check its documents before paying anything. Never pay a viewing fee or deposit to someone you
        haven&apos;t met and checked. If someone asks you to, report the listing as a scam. More on what the badge does and
        doesn&apos;t mean is in{" "}
        <TextLink href="/how-it-works#limits">How it works</TextLink>.
      </p>
    ),
  },
];

export default function ModerationPage() {
  return (
    <LegalPage
      title="Moderation and reports"
      intro={<p>Which listings we review, how to report a listing or a message, what happens next, and how to appeal.</p>}
      sections={SECTIONS}
    />
  );
}
