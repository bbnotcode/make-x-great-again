import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Make X Great Again (MXGA) — passive by default. The public blocklist is
// NOT bundled: the background syncs the compact lite artifact from the
// official source over plain CORS (a read-only GET of public data — nothing
// about the user is ever uploaded) and caches it locally.
// X-native actions (mute / block) are opt-in: only when the user switches
// settings.actionMode does the extension request the optional x.com host
// permission and act on their account via X's own first-party endpoints,
// using their existing session. Nothing is ever sent to our own backend.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  // Don't spawn a throwaway browser profile on `wxt dev`. Load the built
  // .output/chrome-mv3 into your own Chrome (logged into X) manually; WXT
  // still watches + hot-reloads it.
  webExt: { disabled: true },
  // Force Manifest V3 for all browsers (including Firefox).
  manifestVersion: 3,
  // We declare Firefox data collection below, so silence WXT's reminder that
  // new AMO listings need the taxonomy in the manifest.
  suppressWarnings: { firefoxDataCollection: true },
  manifest: ({ browser }) => ({
    name: "Make X Great Again (MXGA)",
    description:
      "Passive spam / porn-bot badges for X, using a synced public blacklist and local matching. No browsing or scan data uploads. Open source.",
    // alarms: periodic list refresh; unlimitedStorage: the cached list
    // (~5MB) plus local records would otherwise crowd the 10MB default
    // quota. Neither adds an install-time permission warning.
    permissions: ["storage", "alarms", "unlimitedStorage"],
    // Requested at runtime (chrome.permissions.request) only when the user
    // turns on X mute/block mode — keeps the default install storage-only.
    // Chrome uses optional_host_permissions; Firefox only added that key in
    // 127, so for our 109+ target the host patterns go in optional_permissions.
    // github.com: requested only when the user clicks 用 GitHub 登录 in the
    // whitelist section (Device Flow endpoints don't serve CORS).
    ...(browser === "firefox"
      ? {
          optional_permissions: [
            "*://x.com/*",
            "*://twitter.com/*",
            "https://github.com/*",
          ],
        }
      : {
          optional_host_permissions: [
            "*://x.com/*",
            "*://twitter.com/*",
            "https://github.com/*",
          ],
        }),
    action: { default_title: "Make X Great Again (MXGA)" },
    options_ui: { open_in_tab: true },
    // Firefox / AMO requirements (ignored by the Chrome build):
    //  - gecko.id: stable add-on ID, keyed to a domain we control.
    //  - strict_min_version 109.0: the first Firefox release with Manifest V3
    //    support (we no longer ship any MAIN-world content script).
    //  - Routine protection transmits no personal data. The optional
    //    whitelist application sends GitHub authentication and the user's
    //    public X handle only after an explicit runtime opt-in. AMO requires
    //    these optional categories for new listings since 2025-11-03.
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "x-spam-sentinel@zuoluo.tv",
              strict_min_version: "109.0",
              data_collection_permissions: {
                required: ["none"],
                optional: ["authenticationInfo", "personallyIdentifyingInfo"],
              },
            },
          },
        }
      : {}),
  }),
});
