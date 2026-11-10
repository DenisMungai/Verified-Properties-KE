import type { Metadata } from "next";
import { Bullets, Cards, ContactLine, LegalPage, OperatorLine, TextLink, type LegalSection } from "@/components/legal/LegalPage";
import { DATA_REQUEST_PATH, LEGAL, PAYMENT_RECORD_YEARS, PRIVACY_RESPONSE_DAYS } from "@/lib/legal";
import {
  RETENTION_DAYS_AFTER_END,
  RETENTION_DAYS_AFTER_REJECTION,
  RETENTION_MONTHS_AFTER_SUSPENSION,
} from "@/lib/verification/retention";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What personal data VerifiedPropertiesKE collects, why, who sees it, where it is kept and your rights.",
};

/**
 * Privacy notice (prompt S20 decision 3), written against the Kenya Data Protection Act 2019 from
 * how the app actually works. Plain-English technical guidance, not legal advice: reviewed by the
 * operator before `LEGAL.effectiveDate` is set.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p>
          <OperatorLine />, a marketplace where owners, agents and developers list property in Kenya and buyers and tenants
          find it. For the personal data described here we are the data controller.
        </p>
        {LEGAL.odpcRegistration && <p>We are registered with the Office of the Data Protection Commissioner, number {LEGAL.odpcRegistration}.</p>}
        <p>
          To ask about this notice or your data: <ContactLine />
        </p>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: (
      <Cards
        items={[
          { title: "Your account", body: "Name, email address and a password (stored only as a one-way hash). The IP address and browser of each signed-in session." },
          {
            title: "Your lister profile (if you list)",
            body: "Display name, whether you are an agent, owner or developer, phone number, optional public email, short bio, profile photo and agency.",
          },
          { title: "Your listings", body: "Everything you enter about a property, its photos, and its county, town, area and address label." },
          {
            title: "Verification (if you apply)",
            body: "The documents you upload for the check, the review decision and a record of each time an admin opened a document.",
          },
          {
            title: "Payments",
            body: "The M-Pesa phone number you pay from, amounts, receipts and invoices. For cards, only the card brand and last 4 digits; Paystack holds the card itself.",
          },
          { title: "Messages and inquiries", body: "What you send through the site, the contact details you put in an inquiry, and any blocks and reports." },
          { title: "Activity", body: "Listings you save. Listing views are kept only as a count per listing per day, not who viewed." },
          {
            title: "Technical data",
            body: "To stop abuse we count requests per account and per IP address; the key is a one-way hash and expires within a day. Payment callbacks record the sender's IP address.",
          },
        ]}
      />
    ),
  },
  {
    id: "why",
    title: "Why we use it, and on what basis",
    body: (
      <Bullets
        items={[
          <>
            <strong className="font-semibold text-ink">To run your account and the marketplace</strong>: show listings, deliver messages, take
            payments and keep subscriptions running (our contract with you).
          </>,
          <>
            <strong className="font-semibold text-ink">To verify listers</strong>: check the documents a lister chooses to submit and show the
            Profile verified badge (our contract with that lister, at their request).
          </>,
          <>
            <strong className="font-semibold text-ink">To keep people safe</strong>: moderate listings, handle reports, block abuse and rate-limit
            sign-ins and messages (our legitimate interest in a trustworthy marketplace).
          </>,
          <>
            <strong className="font-semibold text-ink">To meet the law</strong>: keep payment and tax records (a legal obligation).
          </>,
          <>
            <strong className="font-semibold text-ink">To send service messages</strong>: verification and reset emails, message alerts, receipts and
            renewal reminders by email, and by SMS to a lister&apos;s profile phone once SMS is set up (our contract with you). We
            send no marketing.
          </>,
        ]}
      />
    ),
  },
  {
    id: "who-sees-it",
    title: "Who sees it",
    body: (
      <>
        <p>Other users see only what the site shows publicly, and what you choose to share:</p>
        <Bullets
          items={[
            "Listings show the lister's display name, photo or agency logo, and the listing details. Exact addresses and coordinates are never shown.",
            "A verified lister's phone number is public. Other listers' phone numbers and emails are shown only to a signed-in person who has sent them an inquiry.",
            "Messages are seen only by the two people in the conversation. Our moderators can open a conversation when it is reported.",
            "Verification documents are seen only by our platform admins, and every view is logged.",
          ]}
        />
        <p>We use these service providers to run the site. They process data for us under their own security terms:</p>
        <Cards
          items={[
            { title: "Vercel", body: "Hosts the website (servers in Frankfurt, Germany)." },
            { title: "Neon", body: "Database and file storage, including photos and verification documents (Frankfurt, Germany)." },
            { title: "Upstash", body: "Rate limiting and scheduled background jobs (European Union)." },
            { title: "Safaricom (M-Pesa Daraja)", body: "Takes M-Pesa payments." },
            { title: "Paystack", body: "Takes card payments, if you pay by card." },
            { title: "Resend", body: "Sends our emails, once email delivery is set up." },
            { title: "Africa's Talking", body: "Sends SMS reminders, once SMS is set up." },
          ]}
        />
        <p>We do not sell personal data. We share it with authorities only when the law requires us to.</p>
      </>
    ),
  },
  {
    id: "outside-kenya",
    title: "Data stored outside Kenya",
    body: (
      <p>
        Our database, files and website run in the European Union (Frankfurt, Germany), which has strong data protection
        law (the GDPR). Our providers there protect data under their own security and data processing terms. Data travels
        there encrypted, and access is limited to the people and services that run the site.
      </p>
    ),
  },
  {
    id: "how-long",
    title: "How long we keep it",
    body: (
      <Bullets
        items={[
          "Your account, profile, listings, saved listings and messages: while your account is open, and removed when a deletion request is carried out.",
          `Verification documents: deleted ${RETENTION_DAYS_AFTER_END} days after a review ends, ${RETENTION_DAYS_AFTER_REJECTION} days after a review is declined, and ${RETENTION_MONTHS_AFTER_SUSPENSION} months after a suspension. The review decision itself is kept.`,
          `Payment records, invoices and receipts: at least ${PAYMENT_RECORD_YEARS} years, as Kenyan tax law requires. They cannot be deleted early.`,
          "Records of admin actions on billing, verification and moderation: kept so decisions can be checked later.",
          "Rate-limit counters: hashed and expire within a day.",
        ]}
      />
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <>
        <p>Under the Data Protection Act you can:</p>
        <Bullets
          items={[
            "be told how your data is used (this notice);",
            "get a copy of the data we hold about you;",
            "have wrong or incomplete data corrected;",
            "have your data deleted, except what the law makes us keep, such as payment records;",
            "object to a use of your data;",
            "get your data in a common, machine-readable format.",
          ]}
        />
        <p>
          Make a request with the <TextLink href={DATA_REQUEST_PATH}>request form</TextLink>. Because you are signed in, we know
          the request is yours, so we won&apos;t ask for ID. We reply within {PRIVACY_RESPONSE_DAYS} days. When we delete an account
          we remove what we can and tell you what we must keep and why.
        </p>
        <p>
          If you are unhappy with how we handled your data, you can complain to the Office of the Data Protection Commissioner
          (odpc.go.ke).
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    body: (
      <Bullets
        items={[
          "Passwords are stored only as one-way hashes. Sign-ins, resets and messages are rate-limited.",
          "Verification documents sit in private storage. Admins open them through short-lived links, and each view is logged.",
          "Every page and action checks who you are on our servers before showing or changing anything.",
          "Connections to the site and between our services are encrypted.",
        ]}
      />
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We set only the cookies needed to keep you signed in. There are no analytics, advertising or tracking cookies. If we ever
        add any, we will ask for your consent first and update this notice.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>You must be 18 or over to open an account. We don&apos;t knowingly collect data about children.</p>,
  },
  {
    id: "changes",
    title: "Changes to this notice",
    body: (
      <p>
        When we change this notice we update the date at the top. If a change affects how we use your data, we will let you
        know before it applies.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy notice"
      intro={<p>What personal data we collect, why, who sees it, where it is kept, how long, and your rights.</p>}
      sections={SECTIONS}
    />
  );
}
