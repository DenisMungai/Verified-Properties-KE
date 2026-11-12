import type { Metadata } from "next";
import { AlsoContact, Bullets, LegalPage, TextLink, type LegalSection } from "@/components/legal/LegalPage";
import { BILLING_PERIOD_DAYS, GRACE_DAYS } from "@/lib/billing/constants";
import { REMINDER_LEAD_DAYS } from "@/lib/jobs/reminder-window";
import { BILLING_RESPONSE_WORKING_DAYS, DATA_REQUEST_PATH } from "@/lib/legal";
import { REVIEW_VALID_MONTHS } from "@/lib/verification/rules";

export const metadata: Metadata = {
  title: "Subscription and refund policy",
  description: "How listing and verification plans are paid, renewed, paused and restored, and how refunds and disputes work.",
};

/**
 * Subscription and refund policy (prompt S20 decision 5): plan v2.0 §4 as built. Every period
 * and window comes from the code constants; prices live on /pricing.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "plans",
    title: "Plans and prices",
    body: (
      <>
        <p>
          Publishing listings needs a <strong className="font-semibold text-ink">listing plan</strong>. Each plan allows a number of
          live listings; an agency&apos;s plan is shared by its members. The{" "}
          <strong className="font-semibold text-ink">verification plan</strong> is an optional add-on that keeps the Profile
          verified badge showing after a passed review.
        </p>
        <p>
          Current prices are on our <TextLink href="/pricing">pricing page</TextLink>. The price you pay is the one shown when the
          invoice is created, and a plan&apos;s price never changes for an invoice already issued.
        </p>
      </>
    ),
  },
  {
    id: "paying",
    title: "Paying and renewing",
    body: (
      <Bullets
        items={[
          "Pay with M-Pesa (a prompt on your phone, or Paybill) or, where offered, by card through Paystack.",
          `Each payment covers ${BILLING_PERIOD_DAYS} days from the moment it is confirmed.`,
          `Plans renew manually: nothing is taken automatically. We remind you ${REMINDER_LEAD_DAYS} days and 1 day before a plan ends.`,
          "Every payment is confirmed with Safaricom or Paystack before it counts. You get a receipt with the invoice number, plan, period and amount.",
        ]}
      />
    ),
  },
  {
    id: "lapse",
    title: "If a plan lapses",
    body: (
      <Bullets
        items={[
          `Listing plan: for ${GRACE_DAYS} days after it ends your listings stay live with a reminder. After that they are paused and leave search. Drafts, photos and inquiries are kept.`,
          "When you renew, paused listings come back on their own, up to your plan's limit.",
          `Verification plan: the badge stays for ${GRACE_DAYS} days. After that the badge, priority ranking, featured slots and contact details open to every visitor are removed. They return as soon as you renew, without a new review, if your last passed review is still within its ${REVIEW_VALID_MONTHS} months.`,
          "The badge also needs an active listing plan, so it goes when listings are paused and returns when both plans are paid.",
        ]}
      />
    ),
  },
  {
    id: "changing",
    title: "Changing plans",
    body: (
      <Bullets
        items={[
          "An upgrade applies at once. The unused days of your current plan are credited towards the new one.",
          "A downgrade applies when your current period ends. You can cancel a scheduled downgrade before then.",
          `If a downgrade leaves more live listings than the new plan allows, you choose which stay live. If you don't choose within ${GRACE_DAYS} days, the newest stay live and the rest are paused.`,
        ]}
      />
    ),
  },
  {
    id: "verification",
    title: "Verification payments",
    body: (
      <Bullets
        items={[
          "Paying for verification starts a review. It never grants the badge by itself.",
          "If the review is declined, the first month's verification fee is credited to your listing plan as extra days. If that isn't possible, for example because the listing plan has lapsed, our billing team contacts you about a refund.",
          "A suspended badge ends the verification plan. See our terms.",
        ]}
      />
    ),
  },
  {
    id: "problems",
    title: "Wrong, duplicate or missing payments",
    body: (
      <Bullets
        items={[
          "A payment that doesn't match its invoice amount is held, not applied. A billing admin checks it and applies, credits or refunds it.",
          "A repeated payment confirmation is never counted twice.",
          "If you paid by Paybill and your plan didn't update, the billing team matches the payment from the M-Pesa statement.",
          "Every refund, credit and manual activation is recorded with who made it and why.",
        ]}
      />
    ),
  },
  {
    id: "refunds",
    title: "Refunds and disputes",
    body: (
      <>
        <p>
          Paid periods that have started are not refunded, except for a declined verification review (above) or a payment we
          took in error, such as a wrong amount or a duplicate.
        </p>
        <p>
          To ask for a refund or dispute a charge, use the <TextLink href={DATA_REQUEST_PATH}>request form</TextLink> and choose
          &ldquo;Billing or refund question&rdquo;. Include the invoice number or M-Pesa receipt. A billing admin replies within{" "}
          {BILLING_RESPONSE_WORKING_DAYS} working days.<AlsoContact />
        </p>
      </>
    ),
  },
];

export default function SubscriptionPolicyPage() {
  return (
    <LegalPage
      title="Subscription and refund policy"
      intro={<p>How listing and verification plans are paid, renewed, paused and restored, and how refunds and disputes work.</p>}
      sections={SECTIONS}
    />
  );
}
