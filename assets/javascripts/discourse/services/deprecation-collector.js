import { registerDeprecationHandler } from "@ember/debug";
import { cancel } from "@ember/runloop";
import Service, { inject as service } from "@ember/service";
import { withPluginApi } from "discourse/lib/plugin-api";
import identifySource from "discourse/lib/source-identifier";
import { escapeExpression } from "discourse/lib/utilities";
import discourseDebounce from "discourse-common/lib/debounce";
import { registerDeprecationHandler as registerDiscourseDeprecationHandler } from "discourse-common/lib/deprecated";
import getURL from "discourse-common/lib/get-url";
import { bind } from "discourse-common/utils/decorators";
import I18n from "discourse-i18n";

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

const CRITICAL_DEPRECATIONS = [
  /^discourse.modal-controllers$/,
  /^(?!discourse\.)/,
];

export default class DeprecationCollector extends Service {
  @service router;
  @service currentUser;
  @service siteSettings;

  #configById = new Map();
  #counts = new Map();
  #reportDebounce;
  #adminWarned = false;

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

    const source = identifySource();
    if (source?.type === "browser-extension") {
      return;
    }

    this.maybeNotifyAdmin(options.id, source);

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

  maybeNotifyAdmin(id, source) {
    if (this.#adminWarned) {
      return;
    }

    if (!this.currentUser?.admin) {
      return;
    }

    if (!this.siteSettings?.deprecation_collector_warn_critical_deprecations) {
      return;
    }

    if (CRITICAL_DEPRECATIONS.some((pattern) => pattern.test(id))) {
      this.notifyAdmin(id, source);
    }
  }

  notifyAdmin(id, source) {
    this.#adminWarned = true;

    let notice = I18n.t("deprecation_collector.critical_deprecations");

    if (
      this.siteSettings?.deprecation_collector_critical_deprecations_message
    ) {
      notice +=
        " " +
        this.siteSettings.deprecation_collector_critical_deprecations_message;
    }

    if (source?.type === "theme") {
      notice +=
        " " +
        I18n.t("deprecation_collector.theme_source", {
          name: escapeExpression(source.name),
          path: source.path,
        });
    }

    withPluginApi("0.1", (api) => {
      api.addGlobalNotice(notice, "critical-deprecation", {
        dismissable: true,
        dismissDuration: moment.duration(1, "day"),
        level: "warn",
      });
    });
  }
}
