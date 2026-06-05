declare module "node:crypto";
declare namespace NodeJS {
  interface ProcessEnv {
    SCRAPER_API_KEY?: string;
    EBAY_CLIENT_ID?: string;
    EBAY_CLIENT_SECRET?: string;
    EBAY_REFRESH_TOKEN?: string;
    EBAY_SANDBOX?: string;
    EBAY_REDIRECT_URI?: string;
    EBAY_FULFILLMENT_POLICY_ID?: string;
    EBAY_PAYMENT_POLICY_ID?: string;
    EBAY_RETURN_POLICY_ID?: string;
    TURSO_DATABASE_URL?: string;
    TURSO_AUTH_TOKEN?: string;
    DATABASE_URL?: string;
    DATABASE_AUTH_TOKEN?: string;
  }
}
