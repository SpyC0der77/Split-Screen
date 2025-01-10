customElements.define(
  "x-frame-bypass",
  class extends HTMLIFrameElement {
    static get observedAttributes() {
      return ["src"];
    }

    constructor() {
      super();
      // Listen for the iframe load event to attach our interceptors
      this.addEventListener("load", () => {
        // Once the DOM is there, try to rewrite links and forms
        this.attachInterceptors();
      });
    }

    attributeChangedCallback() {
      this.load(this.src);
    }

    connectedCallback() {
      // Enable sandbox features (except top-navigation)
      this.sandbox =
        "" + this.sandbox ||
        "allow-forms allow-modals allow-pointer-lock allow-popups " +
          "allow-popups-to-escape-sandbox allow-presentation allow-same-origin " +
          "allow-scripts allow-top-navigation-by-user-activation";
    }

    load(url, options) {
      if (!url || !url.startsWith("http")) {
        throw new Error(
          `X-Frame-Bypass src "${url}" does not start with http(s)://`
        );
      }
      console.log("X-Frame-Bypass loading:", url);

      // Temporary loading screen
      this.srcdoc = `
        <html>
          <head>
            <style>
              .loader {
                position: absolute;
                top: calc(50% - 25px);
                left: calc(50% - 25px);
                width: 50px;
                height: 50px;
                background-color: #333;
                border-radius: 50%;
                animation: loader 1s infinite ease-in-out;
              }
              @keyframes loader {
                0% {
                  transform: scale(0);
                }
                100% {
                  transform: scale(1);
                  opacity: 0;
                }
              }
            </style>
          </head>
          <body>
            <div class="loader"></div>
          </body>
        </html>`;

      // 1) Fetch the page through the proxy, parse it, rewrite it, then set as srcdoc
      this.fetchProxy(url, options)
        .then((res) => res.text())
        .then((html) => {
          if (!html) return;

          // Figure out the real base for relative references
          const prefix = "https://api.allorigins.win/raw?url=";
          let realBase = url;
          if (realBase.startsWith(prefix)) {
            realBase = decodeURIComponent(realBase.substring(prefix.length));
          }

          // Use DOMParser to rewrite all references
          const final = this.rewriteHTML(html, realBase);

          // Put the final HTML in srcdoc
          this.srcdoc = final;
        })
        .catch((err) => console.error("Cannot load X-Frame-Bypass:", err));
    }

    /**
     * After the iframe loads, walk its DOM and intercept clicks/submits
     * by rewriting them to use frameElement.load(...).
     */
    attachInterceptors() {
      let doc;
      try {
        doc = this.contentDocument; // The Document inside the iframe
      } catch (e) {
        console.warn("Cannot access iframe document:", e);
        return;
      }
      if (!doc) return;

      // Intercept all link clicks
      doc.querySelectorAll("a[href]").forEach((a) => {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const url = a.getAttribute("href");
          if (url) {
            this.load(url);
          }
        });
      });

      // Intercept all form submissions
      doc.querySelectorAll("form[action]").forEach((form) => {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const action = form.getAttribute("action") || "";
          if (!action) return;

          const method = (form.getAttribute("method") || "GET").toUpperCase();
          if (method === "POST") {
            const data = new FormData(form);
            this.load(action, { method: "POST", body: data });
          } else {
            // GET
            const data = new FormData(form);
            const qs = new URLSearchParams(data);
            this.load(action + "?" + qs.toString());
          }
        });
      });
    }

    rewriteHTML(htmlString, realBaseUrl) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, "text/html");

      // Remove existing <base>, then add our own
      const oldBase = doc.querySelector("base");
      if (oldBase) oldBase.remove();

      const baseEl = doc.createElement("base");
      baseEl.setAttribute("href", realBaseUrl);

      // Insert base at the top of <head> if present
      const head = doc.querySelector("head");
      if (head) {
        head.prepend(baseEl);
      } else {
        // If no <head>, create one
        const newHead = doc.createElement("head");
        newHead.appendChild(baseEl);
        if (doc.documentElement) {
          doc.documentElement.insertBefore(newHead, doc.body);
        }
      }

      // Rewrite all src/href in the DOM
      doc.querySelectorAll("[src], [href]").forEach((el) => {
        if (el.hasAttribute("src")) {
          const val = el.getAttribute("src");
          if (val && !val.toLowerCase().startsWith("javascript:")) {
            const abs = new URL(val, realBaseUrl).href;
            el.setAttribute("src", this.proxyURL(abs));
          }
        }
        if (el.hasAttribute("href")) {
          const val = el.getAttribute("href");
          if (val && !val.toLowerCase().startsWith("javascript:")) {
            const abs = new URL(val, realBaseUrl).href;
            el.setAttribute("href", this.proxyURL(abs));
          }
        }
      });

      // Also rewrite url(...) references in CSS
      doc.querySelectorAll("[style]").forEach((el) => {
        const styleVal = el.getAttribute("style");
        if (styleVal) {
          el.setAttribute("style", this.rewriteCSSUrls(styleVal, realBaseUrl));
        }
      });
      doc.querySelectorAll("style").forEach((styleEl) => {
        const oldCSS = styleEl.textContent;
        if (oldCSS) {
          styleEl.textContent = this.rewriteCSSUrls(oldCSS, realBaseUrl);
        }
      });

      return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    }

    rewriteCSSUrls(cssText, realBaseUrl) {
      return cssText.replace(
        /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
        (match, quote, rawUrl) => {
          if (
            !rawUrl ||
            rawUrl.trim().toLowerCase().startsWith("javascript:")
          ) {
            return match; // skip
          }
          let abs;
          try {
            abs = new URL(rawUrl, realBaseUrl).href;
          } catch {
            return match; // if parse fails, leave it
          }
          return `url("${this.proxyURL(abs)}")`;
        }
      );
    }

    /**
     * Rewrites any absolute URL to the https://api.allorigins.win/raw?url= form,
     * ensuring that if it's already referencing api.allorigins, we fix it.
     */
    proxyURL(absoluteUrl) {
      const prefix = "https://api.allorigins.win/raw?url=";
      if (
        absoluteUrl.startsWith("https://api.allorigins.win/") &&
        !absoluteUrl.startsWith(prefix)
      ) {
        // If it's an AllOrigins link but missing /raw?url=, fix it
        return prefix + encodeURIComponent(absoluteUrl);
      }
      if (!absoluteUrl.startsWith(prefix)) {
        // If it's not proxied, rewrite
        return prefix + encodeURIComponent(absoluteUrl);
      }
      // else it's already in correct form
      return absoluteUrl;
    }

    fetchProxy(url, options) {
      const prefix = "https://api.allorigins.win/raw?url=";
      let finalUrl = url;
      if (
        finalUrl.startsWith("https://api.allorigins.win/") &&
        !finalUrl.startsWith(prefix)
      ) {
        finalUrl = prefix + encodeURIComponent(finalUrl);
      } else if (!finalUrl.startsWith(prefix)) {
        finalUrl = prefix + encodeURIComponent(finalUrl);
      }
      console.log("fetchProxy -> final URL:", finalUrl);

      return fetch(finalUrl, options).then((res) => {
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return res;
      });
    }
  },
  { extends: "iframe" }
);
