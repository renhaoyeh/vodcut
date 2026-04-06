import Groq from 'groq-sdk';

const clients = new Map<string, Groq>();

export function getGroqClient(apiKey: string): Groq {
  let client = clients.get(apiKey);
  if (!client) {
    client = new Groq({ apiKey, timeout: 300_000 });
    clients.set(apiKey, client);
  }
  return client;
}

/** Convert fetch Response.headers to a plain record for saveGroqRateLimits. */
export function extractRateLimitHeaders(response: Response): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}
