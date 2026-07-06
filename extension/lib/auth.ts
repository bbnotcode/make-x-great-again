// GitHub identity storage for the whitelist self-service application.
// Storage keys (xss:ghToken / xss:ghLogin) are inherited from the v0.4
// cloud-auth build so a user upgrading from <=0.4 keeps their saved token.
// The token is only ever sent to GitHub (identity lookup) and to our edge
// Worker as a bearer for /v1/whitelist/apply — it never touches X.
const K = { ghToken: "xss:ghToken", ghLogin: "xss:ghLogin" } as const;

async function get(k: string): Promise<string> {
  try {
    return ((await chrome.storage.local.get(k))[k] as string) ?? "";
  } catch {
    return "";
  }
}

async function set(k: string, v: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [k]: v });
  } catch {
    /* non-fatal */
  }
}

export const getGhToken = () => get(K.ghToken);
export const getGhLogin = () => get(K.ghLogin);
export const setGh = async (token: string, login: string) => {
  await set(K.ghToken, token);
  await set(K.ghLogin, login);
};
export const clearGh = async () => {
  await set(K.ghToken, "");
  await set(K.ghLogin, "");
};

/** Validate a token against GitHub → login name, or null when rejected. */
export async function ghUserLogin(token: string): Promise<string | null> {
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
      },
    });
    if (!r.ok) return null;
    const u = (await r.json()) as { login?: string };
    return u.login ?? null;
  } catch {
    return null;
  }
}
