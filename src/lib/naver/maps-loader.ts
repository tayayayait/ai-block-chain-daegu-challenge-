export type NaverMapsLoadState =
  "IDLE" | "LOADING" | "READY" | "MISSING_KEY_ID" | "AUTH_FAILED" | "LOAD_FAILED";

export type NaverMapsLoadErrorCode = Extract<
  NaverMapsLoadState,
  "MISSING_KEY_ID" | "AUTH_FAILED" | "LOAD_FAILED"
>;

export class NaverMapsLoadError extends Error {
  readonly code: NaverMapsLoadErrorCode;

  constructor(code: NaverMapsLoadErrorCode) {
    super(`Naver Maps unavailable: ${code}`);
    this.name = "NaverMapsLoadError";
    this.code = code;
  }
}

type MapsWindow = Window & {
  naver?: { maps?: unknown };
  navermap_authFailure?: () => void;
};

type LoaderOptions = Readonly<{
  ncpKeyId: string;
  document?: Document;
  window?: Window;
}>;

const SCRIPT_SELECTOR = "script[data-onjung-naver-maps]";

/**
 * Loads the browser-visible NAVER Maps identifier once. The Client Secret is
 * deliberately absent from this boundary and remains server-only.
 */
export class NaverMapsLoader {
  readonly #ncpKeyId: string;
  readonly #document: Document;
  readonly #window: MapsWindow;
  readonly #listeners = new Set<(state: NaverMapsLoadState) => void>();
  #state: NaverMapsLoadState = "IDLE";
  #pending: Promise<void> | null = null;

  constructor(options: LoaderOptions) {
    this.#ncpKeyId = options.ncpKeyId.trim();
    this.#document = options.document ?? document;
    this.#window = (options.window ?? window) as MapsWindow;
  }

  getState(): NaverMapsLoadState {
    return this.#state;
  }

  subscribe(listener: (state: NaverMapsLoadState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setState(state: NaverMapsLoadState): void {
    this.#state = state;
    this.#listeners.forEach((listener) => listener(state));
  }

  load(): Promise<void> {
    if (this.#pending) return this.#pending;
    if (this.#window.naver?.maps) {
      this.#setState("READY");
      return Promise.resolve();
    }
    if (!this.#ncpKeyId) {
      this.#setState("MISSING_KEY_ID");
      return Promise.reject(new NaverMapsLoadError("MISSING_KEY_ID"));
    }

    this.#setState("LOADING");
    this.#pending = new Promise<void>((resolve, reject) => {
      let promiseSettled = false;
      let failed = false;
      const finishWithError = (code: NaverMapsLoadErrorCode) => {
        if (failed) return;
        failed = true;
        this.#setState(code);
        if (!promiseSettled) {
          promiseSettled = true;
          reject(new NaverMapsLoadError(code));
        }
      };

      this.#window.navermap_authFailure = () => finishWithError("AUTH_FAILED");

      const existing = this.#document.head.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
      const script = existing ?? this.#document.createElement("script");
      if (!existing) {
        const url = new URL("https://oapi.map.naver.com/openapi/v3/maps.js");
        url.searchParams.set("ncpKeyId", this.#ncpKeyId);
        script.src = url.toString();
        script.async = true;
        script.dataset["onjungNaverMaps"] = "true";
        this.#document.head.append(script);
      }

      script.addEventListener(
        "load",
        () => {
          if (failed) return;
          if (!this.#window.naver?.maps) {
            finishWithError("LOAD_FAILED");
            return;
          }
          if (promiseSettled) return;
          promiseSettled = true;
          this.#setState("READY");
          resolve();
        },
        { once: true },
      );
      script.addEventListener("error", () => finishWithError("LOAD_FAILED"), { once: true });
    });

    return this.#pending;
  }
}
