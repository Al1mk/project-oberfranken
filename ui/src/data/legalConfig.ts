/**
 * Facts for the legal pages. Everything about the operator, contacts and hosting is UNSET (null) on purpose:
 * none of it has been confirmed, and nothing here may be filled in by guesswork. A field is only set after the
 * responsible person confirms it. `status` keeps the pages marked as an internal draft until then.
 */
export type LegalField =
  | "operatorName" | "operatorAddress" | "operatorEmail" | "operatorPhone" | "privacyContact" | "hostingProvider" | "hostingCountry" | "accessLogRetention";

export const LEGAL_CONFIG = {
  status: "internal-demo-draft",
  // Presentation-only example. This is deliberately not an operator or privacy contact.
  demo: { sampleEmail: "example@gmail.com" },
  operator: {
    name: null as string | null,
    address: null as string | null,
    email: null as string | null,
    phone: null as string | null,
  },
  privacyContact: {
    name: null as string | null,
    email: null as string | null,
  },
  hosting: {
    provider: null as string | null,
    country: null as string | null,
    accessLogRetention: null as string | null,
  },
};
