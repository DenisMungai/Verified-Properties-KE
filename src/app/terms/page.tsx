import type { Metadata } from "next";
import { Bullets, ContactLine, LegalPage, OperatorLine, TextLink, type LegalSection } from "@/components/legal/LegalPage";
import { REVIEW_VALID_MONTHS } from "@/lib/verification/rules";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The rules for using VerifiedPropertiesKE: accounts, listings, verification, paid ranking, messaging and liability.",
};

/**
 * Terms of use (prompt S20 decision 4). Includes the badge-suspension right plan §4 says the
 * terms must state. Plain-English technical guidance, not legal advice.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <>
        <p>
          <OperatorLine />. These terms apply when you use the site, with or without an account. By creating an account you
          agree to them and confirm you have read our <TextLink href="/privacy">privacy notice</TextLink>.
        </p>
        <p>
          We are a marketplace. We are not a party to any sale, rental or viewing, and we are not an agent, valuer or lawyer for
          any side.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Your account",
    body: (
      <Bullets
        items={[
          "You must be 18 or over and give a real name and an email address you can receive mail at.",
          "Keep your password to yourself. You are responsible for what is done with your account.",
          "One person, one account. Agencies add each member under their own account.",
          "Roles such as admin are never granted through the site, and you may not try to get access you weren't given.",
        ]}
      />
    ),
  },
  {
    id: "listings",
    title: "Listing a property",
    body: (
      <>
        <p>If you list, you promise that:</p>
        <Bullets
          items={[
            "you own the property or have the owner's permission to market it;",
            "the price, location, size and features are accurate, and you update or withdraw the listing when they change or it is sold or let;",
            "the photos are of that property and you have the right to publish them;",
            "the listing is lawful and doesn't mislead, for example with a bait price or a wrong location.",
          ]}
        />
        <p>
          Listings need an active listing plan; see our <TextLink href="/subscription-policy">subscription and refund policy</TextLink>.
          Listings from listers who aren&apos;t verified are reviewed by us before they go live.
        </p>
      </>
    ),
  },
  {
    id: "not-allowed",
    title: "What isn't allowed",
    body: (
      <Bullets
        items={[
          "Fake, duplicate or misleading listings, or listings for property you have no right to market.",
          "Asking for deposits, viewing fees or payments outside the law, or any scam.",
          "Harassment, threats, hate speech or spam in messages or listings.",
          "Collecting other users' contact details to contact them outside the purpose they shared them for.",
          "Trying to get around our security, rate limits, ranking or payments, or scraping the site.",
        ]}
      />
    ),
  },
  {
    id: "moderation",
    title: "Moderation and takedown",
    body: (
      <p>
        We may refuse, pause or remove a listing, close a conversation, or suspend or close an account that breaks these terms,
        with or without notice where there is a risk to others. How we review listings and reports, and how to appeal, is set
        out on our <TextLink href="/moderation">moderation page</TextLink>.
      </p>
    ),
  },
  {
    id: "verification",
    title: "The Profile verified badge",
    body: (
      <>
        <p>
          Listers can pay for a review of their identity and, for agents, their professional documents. If the review passes,
          their profile shows <strong className="font-semibold text-ink">Profile verified</strong> for {REVIEW_VALID_MONTHS} months
          while both their listing plan and verification plan are paid. What the check covers is explained in{" "}
          <TextLink href="/how-it-works#verification">How it works</TextLink>.
        </p>
        <Bullets
          items={[
            "Paying starts a review. Payment alone never makes anyone verified.",
            "The badge says we checked the lister's documents. It does not mean we inspected the property, checked its title or guarantee any deal.",
            <>
              <strong className="font-semibold text-ink">
                We may suspend a badge at any time for fraud, abuse or a breach of these terms, whether or not the lister has paid.
              </strong>{" "}
              A suspension also ends the verification plan.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "ranking",
    title: "Paid ranking",
    body: (
      <p>
        In the default sort, listings from verified listers appear first, and the home page features verified listers. This is
        paid placement and we label it as such. It only reorders listings that match your search; it never adds ones that
        don&apos;t. The full rules are in <TextLink href="/how-it-works#ranking">How it works</TextLink>.
      </p>
    ),
  },
  {
    id: "messaging",
    title: "Messages and inquiries",
    body: (
      <p>
        Use messages for genuine questions about a listing. Messages are plain text, are rate-limited, and can be reported and
        blocked. When a conversation is reported, our moderators can read it. Never send money or ID documents to someone you
        haven&apos;t met and checked.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Our responsibility",
    body: (
      <>
        <p>
          We work to keep the site accurate and available, but listings are written by listers and we can&apos;t promise they are
          complete or correct. Inspect a property and check its documents before you pay anything.
        </p>
        <p>
          As far as the law allows, we are not responsible for losses from deals between users or from a listing being wrong.
          Nothing here limits rights you have by law that can&apos;t be limited.
        </p>
      </>
    ),
  },
  {
    id: "ending",
    title: "Ending your account",
    body: (
      <p>
        You can ask us to close your account and delete your data at any time through the{" "}
        <TextLink href="/privacy/request">request form</TextLink>. Paid periods already started are not refunded except as our{" "}
        <TextLink href="/subscription-policy">subscription and refund policy</TextLink> says.
      </p>
    ),
  },
  {
    id: "law",
    title: "Law and changes",
    body: (
      <>
        <p>These terms are governed by the laws of Kenya, and the courts of Kenya decide any dispute about them.</p>
        <p>
          We may change these terms. We update the date at the top, and for changes that matter we will let you know before they
          apply. Questions: <ContactLine />
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro={<p>The rules for using VerifiedPropertiesKE: accounts, listings, verification, paid ranking, messaging and liability.</p>}
      sections={SECTIONS}
    />
  );
}
