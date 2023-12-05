import { registerDeprecationHandler } from "@ember/debug";
import { cancel } from "@ember/runloop";
import Service, { inject as service } from "@ember/service";
import discourseDebounce from "discourse-common/lib/debounce";
import { registerDeprecationHandler as registerDiscourseDeprecationHandler } from "discourse-common/lib/deprecated";
import getURL from "discourse-common/lib/get-url";
import { bind } from "discourse-common/utils/decorators";

// Deprecation handling APIs don't have any way to unregister handlers, so we set up permenant
// handlers and link them up to the application lifecycle using module-local state.
let handler;
registerDeprecationHandler((message, opts, next) => {
  handler?.(message, opts);
  return next(message, opts);
});
registerDiscourseDeprecationHandler((message, opts) =>
  handler?.(message, opts)
);

export default class DeprecationCollector extends Service {
  @service router;

  #configById = new Map();
  #counts = new Map();
  #reportDebounce;

  constructor() {
    super(...arguments);
    handler = this.track;

    const workflowConfig = window.deprecationWorkflow?.config?.workflow || {};
    for (const c of workflowConfig) {
      this.#configById.set(c.matchId, c.handler);
    }

    document.addEventListener("visibilitychange", this.handleVisibilityChanged);
    this.router.on("routeWillChange", this.debouncedReport);
  }

  willDestroy() {
    handler = null;
    window.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChanged
    );
    this.router.off("routeWillChange", this.debouncedReport);
    cancel(this.#reportDebounce);
    super.willDestroy();
  }

  @bind
  handleVisibilityChanged() {
    // Tab is going to background, or we're navigating away. Make the report immediately.
    if (document.visibilityState !== "visible") {
      this.report();
    }
  }

  @bind
  track(message, options) {
    if (this.#configById.get(options.id) === "silence") {
      return;
    }

    let count = this.#counts.get(options.id) || 0;
    count += 1;
    this.#counts.set(options.id, count);
  }

  @bind
  debouncedReport() {
    this.#reportDebounce = discourseDebounce(this.report, 10_000);
  }

  @bind
  report() {
    cancel(this.#reportDebounce);

    if (this.#counts.size === 0) {
      return;
    }

    const data = Object.fromEntries(this.#counts.entries());
    this.#counts.clear();

    const body = new FormData();
    body.append("data", JSON.stringify(data));

    navigator.sendBeacon(getURL("/deprecation-collector/log"), body);
  }
}
