const addressEl = document.getElementById("address");
const iframeEl = document.getElementById("iframe-page");

const PROXY_PREFIX = "https://corsproxy.io?";

// Helper: ensure trailing slash
function ensureTrailingSlash(url) {
  const trimmed = url.trim();
  if (!trimmed.endsWith("/")) {
    return trimmed + "/";
  }
  return trimmed;
}

/**
 * If `url` doesn’t already start with our proxy, return PROXY_PREFIX + url,
 * otherwise return url as is.
 */
function toProxiedUrl(url) {
  if (!url.startsWith(PROXY_PREFIX)) {
    return PROXY_PREFIX + url;
  }
  return url;
}

/**
 * Removes the PROXY_PREFIX from a given string if it starts with it.
 * Then ensures a trailing slash.
 */
function fromProxiedUrl(fullUrl) {
  if (fullUrl.startsWith(PROXY_PREFIX)) {
    const raw = fullUrl.slice(PROXY_PREFIX.length);
    return ensureTrailingSlash(raw);
  }
  return ensureTrailingSlash(fullUrl);
}

/* 1. When user presses Enter in the address bar, load in iframe via proxy */
addressEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();

    // Trim & ensure trailing slash
    const urlWithSlash = ensureTrailingSlash(addressEl.innerText);
    addressEl.innerText = urlWithSlash; // update the bar

    // Force the iframe to always go via corsproxy
    iframeEl.src = toProxiedUrl(urlWithSlash);
  }
});

/* 2. When iframe finishes loading, update the address bar
   and ensure it always goes back through the corsproxy. */
iframeEl.addEventListener("load", () => {
  try {
    // The new location (may be cross-origin if the proxy doesn't allow same-origin)
    const currentURL = iframeEl.contentWindow.location.href;

    // If we see it's not proxied, forcibly redirect it again
    // so that all links remain behind corsproxy.io
    if (!currentURL.startsWith(PROXY_PREFIX)) {
      // Force re-load via proxy
      iframeEl.src = toProxiedUrl(currentURL);
      // We'll return here so that we don't update the address bar yet.
      return;
    }

    // Otherwise, strip the prefix for the address bar
    const userUrl = fromProxiedUrl(currentURL);
    addressEl.innerText = userUrl;
  } catch (error) {
    console.warn("Cross-origin iframe: cannot read location.href.");
  }
});
