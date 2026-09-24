# Security boundaries

## Public browser credentials

- The Supabase `sb_publishable_...` value in the browser is a publishable/anon key. It is not an admin credential; it may only perform actions explicitly granted by Supabase table and Storage policies. Booking tables must deny anonymous reads and writes.
- The Shopify value sent in `X-Shopify-Storefront-Access-Token` is used only with the Storefront GraphQL API for public catalog/cart operations. It is not an Admin API token. Its actual Shopify app scopes are managed in Shopify and cannot be inspected from this repository; keep it limited to unauthenticated Storefront operations and rotate it if its origin or scope is uncertain.
- No service-role key, Shopify Admin token, Google private key, or Gemini key belongs in browser code. Server-side PII writes use Supabase `service_role` only in Vercel functions.

## Origins and rate limits

Browser APIs accept only `https://resoul-landing-beta.vercel.app`, `https://resoul.hk`, and `https://www.resoul.hk`. Shopify's server-to-server `orders/paid` webhook has no browser Origin and instead requires a valid Shopify HMAC; if an Origin is present it must be allowlisted.

All public POST API guards use a global fixed-window counter in Supabase: the `consume_api_quota` RPC (created by `supabase/public_api_security.sql`, executable by `service_role` only) stores counts in `api_rate_limits`. It uses the existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server environment variables; no third-party rate-limit service is required. Requests fail closed with 503 if the RPC is unavailable or unconfigured. Rate-limit keys contain only endpoint names and a one-way SHA-256 hash of the client IP; message text and booking PII are not used as keys.

Run `supabase/api_pii_security.sql` in the production Supabase project to revoke anonymous/authenticated booking reads and writes. Do not expose booking tables through client-side Supabase queries.

## Credential response

If a value has ever been an Admin API token or service-role key in frontend code, rotate it immediately in its issuing dashboard and remove it from deployment/browser bundles. The checked-in Shopify value is used as a Storefront token, but its dashboard configuration should still be confirmed.
