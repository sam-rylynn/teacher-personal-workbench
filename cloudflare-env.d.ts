interface Fetcher {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

type D1Database = Record<string, unknown>;

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
  };
}
