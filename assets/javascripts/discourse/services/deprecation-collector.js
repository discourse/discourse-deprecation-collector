import { cancel } from "@ember/runloop";
import Service, { service } from "@ember/service";
import DeprecationWorkflow from "discourse/deprecation-workflow";
import discourseDebounce from "discourse/lib/debounce";
import { bind } from "discourse/lib/decorators";
import {
  registerUniversalDeprecationHandler,
  unregisterUniversalDeprecationHandler,
} from "discourse/lib/deprecated";
import getURL from "discourse/lib/get-url";
import identifySource from "discourse/lib/source-identifier";

export default class DeprecationCollector extends Service {
  @service router;

  #configById = new Map();
  #counts = new Map();
  #reportDebounce;

  constructor() {
    super(...arguments);

    // buffered: true also counts deprecations fired before this service existed.
    registerUniversalDeprecationHandler(this.track, { buffered: true });

    // TODO (discourse.native-array-extensions) remove the map and related code once we get to v3.6.0.beta2-dev and can
    //   also update .discourse-compatibility accordingly.
    // populate the map if the `shouldSilence` is not defined in the deprecation workflow. it means the plugin is
    // deployed with an older version of core.
    if (!DeprecationWorkflow.shouldSilence) {
      for (const c of DeprecationWorkflow) {
        this.#configById.set(c.matchId, c.handler);
      }
    }

    document.addEventListener("visibilitychange", this.handleVisibilityChanged);
    this.router.on("routeWillChange", this.debouncedReport);
  }

  willDestroy() {
    unregisterUniversalDeprecationHandler(this.track);
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
    // TODO (discourse.native-array-extensions) keep only `if (DeprecationWorkflow.shouldSilence(options.id))` once we get to v3.6.0.beta2-dev
    if (DeprecationWorkflow.shouldSilence) {
      if (DeprecationWorkflow.shouldSilence(options.id)) {
        return;
      }
    } else {
      if (this.#configById.get(options.id) === "silence") {
        return;
      }
    }

    if ((options.source || identifySource())?.type === "browser-extension") {
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
