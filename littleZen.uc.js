// ==UserScript==
// @name        Little Zen
// @description Runtime backport of zen-browser/desktop#13450 for Twilight builds
// @include     main
// ==/UserScript==

(function () {
  "use strict";

  const LITTLE_WINDOW_ATTR = "zen-little-window";
  const COMMAND_ID = "cmd_zenNewLittleWindow";
  const URLBAR_HEIGHT = 340;
  const URLBAR_WIDTH = 640;
  const NORMAL_WINDOW_WIDTH = 1000;
  const NORMAL_WINDOW_HEIGHT = 600;
  const OPEN_FEATURES =
    "titlebar,close,toolbar,location,personalbar=no,status,menubar=no," +
    `resizable,minimizable,scrollbars,width=${URLBAR_WIDTH},height=${URLBAR_HEIGHT},centerscreen`;
  const LITTLE_ZEN_THEME_CACHE_LIMIT = 200;
  const LITTLE_ZEN_THEME_MESSAGE_NAME = "little-zen:theme-response";
  const LITTLE_ZEN_THEME_BRIDGE_TIMEOUT_MS = 250;

  const PATCH_FLAGS = {
    browserWindowTracker: "__littleZenBrowserWindowTrackerPatched",
    uriLoadingHelper: "__littleZenUriLoadingHelperPatched",
    browserDOMWindow: "__littleZenBrowserDOMWindowPatched",
    openBrowserWindow: "__littleZenOpenBrowserWindowPatched",
    compactMode: "__littleZenCompactModePatched",
    verticalTabs: "__littleZenVerticalTabsPatched",
    zenUIManager: "__littleZenZenUIManagerPatched",
    urlbar: "__littleZenUrlbarPatched",
    emptyState: "__littleZenEmptyStatePatched",
    autoClose: "__littleZenAutoCloseAttached",
    keyListener: "__littleZenKeyListenerAttached",
    window: "__littleZenBootstrapped",
  };
  const littleZenThemeCache = new Map();
  let littleZenThemeRequestSeq = 0;

  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs"
  );
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
  );
  const { BrowserWindowTracker } = ChromeUtils.importESModule(
    "resource:///modules/BrowserWindowTracker.sys.mjs"
  );
  const { URILoadingHelper } = ChromeUtils.importESModule(
    "resource:///modules/URILoadingHelper.sys.mjs"
  );

  try {
    ChromeUtils.importESModule("resource:///modules/zen/ZenLittleWindow.sys.mjs");
    console.log("[LittleZen]", "Native Little Zen support detected; skipping backport.");
    return;
  } catch (error) {}

  function formatLogArg(arg) {
    if (arg === undefined) {
      return "undefined";
    }
    if (arg === null) {
      return "null";
    }
    if (typeof arg === "string") {
      return arg;
    }
    if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
      return String(arg);
    }
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}`;
    }
    if (typeof arg?.spec === "string") {
      return arg.spec;
    }
    try {
      return JSON.stringify(arg);
    } catch (error) {
      try {
        return String(arg);
      } catch (stringError) {
        return "[unserializable]";
      }
    }
  }

  function log(...args) {
    const message = `[LittleZen] ${args.map(formatLogArg).join(" ")}`;
    console.log("[LittleZen]", ...args);
    try {
      Services.console.logStringMessage(message);
    } catch (error) {}
  }

  function isBrowserWindow(win) {
    return (
      !!win &&
      !win.closed &&
      win.location?.href === "chrome://browser/content/browser.xhtml"
    );
  }

  function isLittleWindow(win) {
    return (
      isBrowserWindow(win) &&
      (win._zenStartupLittleWindow ||
        win.document?.documentElement?.hasAttribute(LITTLE_WINDOW_ATTR))
    );
  }

  function isEmptyLittleWindow(win) {
    return isLittleWindow(win) && !!win.gBrowser?.selectedTab?.hasAttribute("zen-empty-tab");
  }

  function isExternalOpenContext(context) {
    return (
      context === Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL ||
      (typeof context === "number" &&
        !!(context & Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL))
    );
  }

  function getLittleWindowState(win) {
    const root = win?.document?.documentElement;
    const tab = win?.gBrowser?.selectedTab;
    const urlbar = win?.gURLBar;

    return {
      littleWindow: isLittleWindow(win),
      startupReady: !!win?.gBrowserInit?.delayedStartupFinished,
      pendingUrl: win?.__littleZenPendingURL ?? null,
      rootEmpty: !!root?.hasAttribute("zen-has-empty-tab"),
      tabEmpty: !!tab?.hasAttribute("zen-empty-tab"),
      urlbarBreakout: !!urlbar?.hasAttribute("breakout-extend"),
      urlbarOpen: !!urlbar?.view?.isOpen,
      urlbarNewtab: !!urlbar?.hasAttribute("zen-newtab"),
    };
  }

  function logLittleWindowState(win, label, extra = undefined) {
    log(label, {
      ...getLittleWindowState(win),
      ...(extra ?? {}),
    });
  }

  function centerWindow(win) {
    try {
      win.docShell?.treeOwner
        ?.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIAppWindow)
        .center(null, true, true);
    } catch (error) {
      log("Could not center the Little Zen window.", error);
    }
  }

  function setWindowResizable(win, isResizable) {
    try {
      win.setResizable?.(isResizable);
    } catch (error) {
      log("Could not update the Little Zen resizable state.", error);
    }
  }

  function releaseLittleWindowPresentation(win, reason = "unknown") {
    if (!isBrowserWindow(win) || win.__littleZenPresentationReleased) {
      return;
    }

    win.__littleZenPresentationReleased = true;
    try {
      win.windowUtils?.suppressAnimation?.(false);
    } catch (error) {
      log("Could not release the Little Zen startup presentation.", error);
    }

    logLittleWindowState(win, "Released Little Zen startup presentation", {
      reason,
    });
  }

  function cleanupLittleWindowLifecycle(win, reason = "unknown") {
    const cleanup = win.__littleZenLifecycleCleanup;
    if (typeof cleanup === "function") {
      cleanup(reason);
    }
  }

  function expandLittleWindow(win, reason = "unknown") {
    cleanupLittleWindowLifecycle(win, `expand:${reason}`);
    if (!isBrowserWindow(win) || win.closed) {
      return;
    }

    try {
      win.document.documentElement.removeAttribute("zen-no-padding");
      updateLittleZenBlendedTheme(win, `expand:${reason}`);
    } catch (error) {
      log("Could not prepare Little Zen blended frame while expanding", error);
    }

    setWindowResizable(win, true);
    try {
      win.resizeTo(NORMAL_WINDOW_WIDTH, NORMAL_WINDOW_HEIGHT);
      centerWindow(win);
      logLittleWindowState(win, "Expanded Little Zen window", { reason });
    } catch (error) {
      log("Could not expand the Little Zen window.", error);
    }
  }

  function* browserWindows() {
    const windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      const browserWindow = windows.getNext();
      if (isBrowserWindow(browserWindow)) {
        yield browserWindow;
      }
    }
  }

  function getFallbackBrowserWindow(options = {}) {
    for (const browserWindow of browserWindows()) {
      if (
        !browserWindow.closed &&
        !isLittleWindow(browserWindow) &&
        (options.allowPopups || browserWindow.toolbar.visible) &&
        (!("private" in options) ||
          PrivateBrowsingUtils.permanentPrivateBrowsing ||
          PrivateBrowsingUtils.isWindowPrivate(browserWindow) === options.private) &&
        !browserWindow.document.documentElement.hasAttribute("taskbartab")
      ) {
        return browserWindow;
      }
    }
    return null;
  }

  function patchBrowserWindowTracker() {
    if (BrowserWindowTracker[PATCH_FLAGS.browserWindowTracker]) {
      return;
    }

    const originalGetTopWindow = BrowserWindowTracker.getTopWindow.bind(
      BrowserWindowTracker
    );

    BrowserWindowTracker.getTopWindow = function (options = {}) {
      const topWindow = originalGetTopWindow(options);
      if (!topWindow || options.allowTaskbarTabs || !isLittleWindow(topWindow)) {
        return topWindow;
      }
      return getFallbackBrowserWindow(options) || topWindow;
    };

    BrowserWindowTracker[PATCH_FLAGS.browserWindowTracker] = true;
  }

  function patchUriLoadingHelper() {
    if (URILoadingHelper[PATCH_FLAGS.uriLoadingHelper]) {
      return;
    }

    const originalGetTargetWindow = URILoadingHelper.getTargetWindow.bind(
      URILoadingHelper
    );

    URILoadingHelper.getTargetWindow = function (currentWindow, options = {}) {
      const { top } = currentWindow;
      if (
        options.skipTaskbarTabs &&
        isBrowserWindow(top) &&
        isLittleWindow(top)
      ) {
        return (
          BrowserWindowTracker.getTopWindow({
            private:
              !options.forceNonPrivate &&
              PrivateBrowsingUtils.isWindowPrivate(currentWindow),
            allowPopups: !options.skipPopups,
            allowTaskbarTabs: false,
          }) || top
        );
      }

      const targetWindow = originalGetTargetWindow(currentWindow, options);
      if (options.skipTaskbarTabs && isLittleWindow(targetWindow)) {
        return (
          BrowserWindowTracker.getTopWindow({
            private:
              !options.forceNonPrivate &&
              PrivateBrowsingUtils.isWindowPrivate(currentWindow),
            allowPopups: !options.skipPopups,
            allowTaskbarTabs: false,
          }) || targetWindow
        );
      }

      return targetWindow;
    };

    URILoadingHelper[PATCH_FLAGS.uriLoadingHelper] = true;
    log("Patched URILoadingHelper.getTargetWindow");
  }

  function patchBrowserDOMWindow(win) {
    if (win[PATCH_FLAGS.browserDOMWindow]) {
      return;
    }

    const originalBrowserDOMWindow = win.browserDOMWindow;
    if (!originalBrowserDOMWindow) {
      log("Skipping browserDOMWindow patch; no browserDOMWindow on window yet");
      return;
    }

    const wrappedBrowserDOMWindow = {
      __proto__: originalBrowserDOMWindow,

      openURI(aURI, aOpener, aWhere, aContext, aTriggeringPrincipal, aCsp) {
        const url = aURI?.spec ?? null;
        const isExternal = isExternalOpenContext(aContext);
        log("browserDOMWindow.openURI", {
          url,
          where: aWhere,
          context: aContext,
          isExternal,
        });

        if (isExternal && url) {
          log("Intercepting external openURI into Little Zen", { url });
          LittleZen.openLittleWindow(win, {
            url,
            source: "browserDOMWindow.openURI",
            triggeringPrincipal: aTriggeringPrincipal,
          });
          return null;
        }

        return originalBrowserDOMWindow.openURI.call(
          originalBrowserDOMWindow,
          aURI,
          aOpener,
          aWhere,
          aContext,
          aTriggeringPrincipal,
          aCsp
        );
      },

      openURIInFrame(aURI, aParams, aWhere, aContext, aName) {
        const url = aURI?.spec ?? null;
        const isExternal = isExternalOpenContext(aContext);
        log("browserDOMWindow.openURIInFrame", {
          url,
          where: aWhere,
          context: aContext,
          isExternal,
          name: aName,
        });

        if (isExternal && url) {
          log("Intercepting external openURIInFrame into Little Zen", { url });
          LittleZen.openLittleWindow(win, {
            url,
            source: "browserDOMWindow.openURIInFrame",
          });
          return null;
        }

        return originalBrowserDOMWindow.openURIInFrame?.call(
          originalBrowserDOMWindow,
          aURI,
          aParams,
          aWhere,
          aContext,
          aName
        ) ?? null;
      },

      QueryInterface(iid) {
        if (
          iid.equals(Ci.nsIBrowserDOMWindow) ||
          iid.equals(Ci.nsISupports)
        ) {
          return this;
        }
        if (typeof originalBrowserDOMWindow.QueryInterface === "function") {
          return originalBrowserDOMWindow.QueryInterface(iid);
        }
        throw Components.Exception(
          "",
          Components.results.NS_ERROR_NO_INTERFACE
        );
      },
    };

    win._littleZenOriginalBrowserDOMWindow = originalBrowserDOMWindow;
    win.browserDOMWindow = wrappedBrowserDOMWindow;
    win[PATCH_FLAGS.browserDOMWindow] = true;
    log("Patched browserDOMWindow for external-link interception");
  }

  function patchOpenBrowserWindow(win) {
    if (win[PATCH_FLAGS.openBrowserWindow] || typeof win.OpenBrowserWindow !== "function") {
      return;
    }

    const originalOpenBrowserWindow = win.OpenBrowserWindow;

    win.OpenBrowserWindow = function (options = {}) {
      if (!options?.zenLittleWindow) {
        return originalOpenBrowserWindow.call(this, options);
      }

      const nextOptions = {
        ...options,
        all: options.all ?? false,
        features: options.features ?? OPEN_FEATURES,
        zenSyncedWindow: false,
      };

      const littleWindow = originalOpenBrowserWindow.call(this, nextOptions);
      if (littleWindow) {
        littleWindow._zenStartupLittleWindow = true;
        littleWindow._zenStartupSyncFlag = "unsynced";
        littleWindow.__littleZenPresentationReleased = false;
        log("Opened Little Zen browser window", {
          startupSyncFlag: littleWindow._zenStartupSyncFlag,
          hasPendingUrl: !!littleWindow.__littleZenPendingURL,
        });
        try {
          littleWindow.windowUtils?.suppressAnimation?.(true);
        } catch (error) {
          log("Could not suppress the Little Zen startup animation.", error);
        }
        try {
          littleWindow.document?.documentElement?.setAttribute(
            LITTLE_WINDOW_ATTR,
            "true"
          );
        } catch (error) {
          log("Startup flag applied before DOM was ready.", error);
        }
      }
      return littleWindow;
    };

    win[PATCH_FLAGS.openBrowserWindow] = true;
    log("Patched OpenBrowserWindow for Little Zen windows");
  }

  function patchCompactModeManager(win) {
    const manager = win.gZenCompactModeManager;
    if (!manager || manager[PATCH_FLAGS.compactMode]) {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(manager, "shouldBeCompact");
    if (!descriptor?.get) {
      return;
    }

    Object.defineProperty(manager, "shouldBeCompact", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        if (win.document.documentElement.hasAttribute(LITTLE_WINDOW_ATTR)) {
          return false;
        }
        return descriptor.get.call(this);
      },
    });

    manager[PATCH_FLAGS.compactMode] = true;
  }

  function patchVerticalTabsManager(win) {
    const manager = win.gZenVerticalTabsManager;
    if (!manager || manager[PATCH_FLAGS.verticalTabs]) {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(manager, "hidesTabsToolbar");
    const originalGetter = descriptor?.get;
    const originalValue = originalGetter ? undefined : manager.hidesTabsToolbar;

    Object.defineProperty(manager, "hidesTabsToolbar", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() {
        if (
          win.document.documentElement.hasAttribute(LITTLE_WINDOW_ATTR) ||
          win._zenStartupLittleWindow
        ) {
          return true;
        }
        return originalGetter ? originalGetter.call(this) : originalValue;
      },
    });

    manager[PATCH_FLAGS.verticalTabs] = true;
  }

  function patchZenUIManager(win) {
    const manager = win.gZenUIManager;
    if (!manager || manager[PATCH_FLAGS.zenUIManager]) {
      return;
    }

    // Guard against closeWatermark firing before gZenUIManager.init() sets motion.
    // In the Little Zen window the async init races with delayedStartupFinished,
    // so we install a stub that silently no-ops until the real motion library loads.
    if (!manager.motion) {
      const noopAnimation = { finished: Promise.resolve(), complete: () => {}, cancel: () => {} };
      const noopFn = () => noopAnimation;
      const motionStub = {
        animate: noopFn,
        stagger: () => 0,
      };
      Object.defineProperty(manager, "motion", {
        configurable: true,
        enumerable: true,
        get() { return this._motion ?? motionStub; },
        set(v) {
          // Once the real motion library is assigned, replace the stub
          Object.defineProperty(manager, "motion", {
            configurable: true,
            enumerable: true,
            writable: true,
            value: v,
          });
        },
      });
      log("Installed gZenUIManager.motion stub for Little Zen window");
    }

    if (typeof manager.onFloatingURLBarOpen === "function") {
      const originalOnFloatingURLBarOpen = manager.onFloatingURLBarOpen;
      manager.onFloatingURLBarOpen = function (...args) {
        const result = originalOnFloatingURLBarOpen.apply(this, args);
        win.requestAnimationFrame(() => {
          if (!isLittleWindow(win) || win.closed) {
            return;
          }

          win.dispatchEvent(new win.CustomEvent("ZenFloatingURLBarOpened"));
          logLittleWindowState(
            win,
            "Dispatched Little Zen floating-urlbar opened event"
          );
        });
        return result;
      };
    }

    manager[PATCH_FLAGS.zenUIManager] = true;
    log("Patched gZenUIManager for Little Zen lifecycle events");
  }

  function patchUrlbar(win) {
    const urlbar = win.gURLBar;
    if (!urlbar || urlbar[PATCH_FLAGS.urlbar]) {
      return;
    }

    const prototype = Object.getPrototypeOf(urlbar);
    const behaviorDescriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "zenUrlbarBehavior"
    );

    if (behaviorDescriptor?.get) {
      Object.defineProperty(urlbar, "zenUrlbarBehavior", {
        configurable: true,
        enumerable: behaviorDescriptor.enumerable,
        get() {
          if (this.document.documentElement.hasAttribute(LITTLE_WINDOW_ATTR)) {
            return "float";
          }
          return behaviorDescriptor.get.call(this);
        },
      });
    }

    if (typeof urlbar._whereToOpen === "function") {
      const originalWhereToOpen = urlbar._whereToOpen;
      urlbar._whereToOpen = function (event) {
        if (this.document.documentElement.hasAttribute(LITTLE_WINDOW_ATTR)) {
          return "current";
        }
        return originalWhereToOpen.call(this, event);
      };
    }

    urlbar._zenTrimURL = function (value) {
      return formatLittleZenUrlbarValue(value);
    };

    urlbar[PATCH_FLAGS.urlbar] = true;
  }

  function formatLittleZenUrlbarValue(value) {
    if (typeof value !== "string" || !value) {
      return value;
    }
    if (!Services.prefs.getBoolPref("browser.urlbar.trimURLs", false)) {
      return value;
    }

    let formatted = value;
    if (Services.prefs.getBoolPref("browser.urlbar.trimHttps", false)) {
      formatted = formatted.replace(/^https:\/\//i, "");
    }
    formatted = formatted.replace(/^http:\/\//i, "");

    try {
      const uri = new URL(value);
      if (
        formatted.endsWith("/") &&
        uri.pathname === "/" &&
        !uri.search &&
        !uri.hash
      ) {
        formatted = formatted.slice(0, -1);
      }
    } catch (error) {}

    return formatted;
  }

  function syncEmptyTabState(win, reason = "unknown") {
    if (!isBrowserWindow(win)) {
      return;
    }

    const root = win.document.documentElement;
    const hasEmptyTab = !!win.gBrowser?.selectedTab?.hasAttribute("zen-empty-tab");

    if (hasEmptyTab) {
      root.setAttribute("zen-has-empty-tab", "true");
    } else {
      root.removeAttribute("zen-has-empty-tab");
    }

    logLittleWindowState(win, "Synced Little Zen empty-tab state", { reason });
  }

  function leaveEmptyTabMode(win, reason = "unknown") {
    if (!isBrowserWindow(win)) {
      return;
    }

    const tab = win.gBrowser?.selectedTab;
    const urlbar = win.gURLBar;
    logLittleWindowState(win, "Leaving Little Zen empty-tab mode", { reason });

    if (tab?.hasAttribute("zen-empty-tab")) {
      tab.removeAttribute("zen-empty-tab");
    }

    try {
      urlbar?.removeAttribute("zen-newtab");
      urlbar?.removeAttribute("breakout-extend");
      urlbar?.removeAttribute("open");
      urlbar?.view?.close?.();
      urlbar?.inputField?.blur?.();
      urlbar?.blur?.();
    } catch (error) {
      log("Could not clear Little Zen zen-newtab attribute.", error);
    }

    syncEmptyTabState(win, `leave-empty-tab:${reason}`);
    refreshLittleWindowLayout(win);
  }

  function scheduleLeaveEmptyTabMode(win, reason = "unknown") {
    leaveEmptyTabMode(win, `${reason}:immediate`);
    win.requestAnimationFrame(() => {
      leaveEmptyTabMode(win, `${reason}:raf`);
    });
    win.setTimeout(() => {
      leaveEmptyTabMode(win, `${reason}:timeout`);
    }, 150);
  }

  function attachEmptyTabStateTracking(win) {
    if (win[PATCH_FLAGS.emptyState]) {
      return;
    }

    const scheduleThemeUpdate = (reason) => {
      updateLittleZenBlendedTheme(win, reason);
      win.setTimeout(() => updateLittleZenBlendedTheme(win, `${reason}:settled`), 180);
      win.setTimeout(() => updateLittleZenBlendedTheme(win, `${reason}:late`), 700);
    };

    const sync = event => {
      if (!isLittleWindow(win)) {
        return;
      }

      syncEmptyTabState(win, event?.type ?? "manual");
      scheduleThemeUpdate(event?.type ?? "manual");
      if (win.__littleZenPendingURL && win.gBrowserInit?.delayedStartupFinished) {
        flushPendingNavigation(win, `state-tracker:${event?.type ?? "manual"}`);
      }
    };

    const progressListener = {
      onLocationChange(browser, _webProgress, _request, _locationURI) {
        if (browser === win.gBrowser?.selectedBrowser) {
          scheduleThemeUpdate("location-change");
        }
      },

      onStateChange(browser, webProgress, _request, stateFlags) {
        if (
          browser === win.gBrowser?.selectedBrowser &&
          (webProgress?.isTopLevel ?? true) &&
          stateFlags & Ci.nsIWebProgressListener.STATE_STOP
        ) {
          scheduleThemeUpdate("state-stop");
          const currentSpec = browser.currentURI?.spec ?? "";
          if (
            stateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK &&
            !win.__littleZenPendingURL &&
            !isEmptyLittleWindow(win) &&
            currentSpec !== "about:blank"
          ) {
            setLittleWindowLoading(win, false, "state-stop");
          }
        }
      },
    };

    win.addEventListener("TabAttrModified", sync, true);
    win.addEventListener("TabSelect", sync, true);
    win.addEventListener("TabOpen", sync, true);
    win.addEventListener("TabClose", sync, true);
    try {
      win.gBrowser?.addTabsProgressListener?.(progressListener);
      win.addEventListener(
        "unload",
        () => {
          try {
            win.gBrowser?.removeTabsProgressListener?.(progressListener);
          } catch (error) {}
        },
        { once: true }
      );
    } catch (error) {
      log("Could not attach Little Zen theme progress listener", error);
    }
    win[PATCH_FLAGS.emptyState] = true;
    log("Attached Little Zen empty-tab state tracking");
  }

  function ensureLittleWindowLoadingPulse(win) {
    if (!isBrowserWindow(win)) {
      return null;
    }

    const doc = win.document;
    let overlay = doc.getElementById("zen-little-window-loading-overlay");
    if (overlay) {
      return overlay;
    }

    overlay = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    overlay.id = "zen-little-window-loading-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const pulse = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    pulse.id = "zen-little-window-loading-pulse";
    overlay.appendChild(pulse);

    (doc.body || doc.documentElement).appendChild(overlay);
    return overlay;
  }

  function setLittleWindowLoading(win, isLoading, reason = "unknown") {
    if (!isLittleWindow(win)) {
      return;
    }

    const root = win.document.documentElement;
    if (isLoading) {
      ensureLittleWindowLoadingPulse(win);
      root.setAttribute("zen-little-window-loading", "true");
    } else {
      root.removeAttribute("zen-little-window-loading");
      delete win.__littleZenSuppressUrlbarFocus;
    }

    logLittleWindowState(win, isLoading ? "Entered Little Zen loading veil" : "Left Little Zen loading veil", {
      reason,
    });
  }

  function refreshLittleWindowLayout(win) {
    const root = win.document.documentElement;
    root.setAttribute(LITTLE_WINDOW_ATTR, "true");
    root.toggleAttribute("zen-no-padding", isEmptyLittleWindow(win));

    try {
      win.ZenThemeModifier?.updateElementSeparation?.();
    } catch (error) {
      log("Could not refresh ZenThemeModifier.", error);
    }

    try {
      win.gZenVerticalTabsManager?._updateEvent?.();
    } catch (error) {
      log("Could not refresh vertical tabs layout.", error);
    }
  }

  function verifyLittleWindowUrlbarPosition(win, reason = "unknown") {
    if (
      !isEmptyLittleWindow(win) ||
      win.__littleZenSuppressUrlbarFocus ||
      win.document?.documentElement?.hasAttribute("zen-little-window-loading")
    ) {
      return;
    }

    const urlbar = win.gURLBar;
    if (!urlbar) {
      return;
    }

    try {
      win.document.documentElement.setAttribute("zen-no-padding", "true");
      urlbar.setAttribute("zen-newtab", "true");
      if (!urlbar.hasAttribute("breakout-extend") && !urlbar.view?.isOpen) {
        urlbar.setAttribute("breakout-extend", "true");
      }
      refreshLittleWindowLayout(win);

      win.requestAnimationFrame(() => {
        if (!isEmptyLittleWindow(win) || win.closed) {
          return;
        }

        const rect = urlbar.getBoundingClientRect();
        if (rect.width > 120 && rect.height > 24) {
          win.resizeTo(Math.ceil(rect.width), Math.ceil(Math.max(rect.height, 40)));
          centerWindow(win);
        }

        logLittleWindowState(win, "Verified Little Zen urlbar position", {
          reason,
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      });
    } catch (error) {
      log("Could not verify Little Zen urlbar position.", error);
    }
  }

  function scheduleLittleWindowUrlbarPositionCheck(win, reason = "unknown") {
    if (!isEmptyLittleWindow(win) || win.__littleZenSuppressUrlbarFocus) {
      return;
    }

    verifyLittleWindowUrlbarPosition(win, `${reason}:immediate`);
    win.requestAnimationFrame(() => verifyLittleWindowUrlbarPosition(win, `${reason}:raf`));
    win.setTimeout(() => verifyLittleWindowUrlbarPosition(win, `${reason}:timeout-100`), 100);
    win.setTimeout(() => verifyLittleWindowUrlbarPosition(win, `${reason}:timeout-300`), 300);
  }

  function openLittleWindowUrlbar(win) {
    if (!isEmptyLittleWindow(win)) {
      return false;
    }

    logLittleWindowState(win, "Opening Little Zen urlbar");

    try {
      const handled = win.gZenUIManager?.handleNewTab?.(false, false, "tab", true);
      if (handled) {
        logLittleWindowState(
          win,
          "Opened Little Zen urlbar via gZenUIManager.handleNewTab"
        );
        return true;
      }
    } catch (error) {
      log("Little Zen gZenUIManager.handleNewTab failed.", error);
    }

    try {
      const urlbar = win.gURLBar;
      urlbar?.search?.("");
      urlbar?.setAttribute("zen-newtab", "true");
      win.document.getElementById("Browser:OpenLocation")?.doCommand();
      urlbar?.focus();
      urlbar?.select();
      urlbar?.inputField?.focus();
      logLittleWindowState(
        win,
        "Opened Little Zen urlbar via Browser:OpenLocation fallback"
      );
      scheduleLittleWindowUrlbarPositionCheck(win, "open-location-fallback");
      return true;
    } catch (error) {
      log("Could not open the Little Zen urlbar.", error);
    }

    return false;
  }

  function closeLittleWindowUrlbar(win, reason = "unknown") {
    const urlbar = win?.gURLBar;
    if (!urlbar) {
      return;
    }

    try {
      urlbar.view?.close?.();
      urlbar.removeAttribute("zen-newtab");
      urlbar.removeAttribute("breakout-extend");
      urlbar.removeAttribute("open");
      urlbar.inputField?.blur?.();
      urlbar.blur?.();
      win.gBrowser?.selectedBrowser?.focus?.();
      logLittleWindowState(win, "Closed Little Zen urlbar for loaded navigation", {
        reason,
      });
    } catch (error) {
      log("Could not close Little Zen urlbar for loaded navigation.", error);
    }
  }

  function flushPendingNavigation(win, reason = "unknown") {
    if (!isBrowserWindow(win)) {
      return false;
    }

    const pendingUrl = win.__littleZenPendingURL;
    if (!pendingUrl) {
      return false;
    }

    if (!win.gBrowserInit?.delayedStartupFinished) {
      logLittleWindowState(win, "Little Zen pending URL waiting for delayed startup", {
        reason,
        url: pendingUrl,
      });
      return false;
    }

    let selectedBrowser = win.gBrowser?.selectedBrowser;
    if (!selectedBrowser) {
      logLittleWindowState(win, "Little Zen pending URL waiting for selected browser", {
        reason,
        url: pendingUrl,
      });
      return false;
    }

    const pendingMeta = win.__littleZenPendingURLMeta ?? {};
    win.__littleZenSuppressUrlbarFocus = true;
    setLittleWindowLoading(win, true, `flush:${reason}`);
    closeLittleWindowUrlbar(win, `flush:${reason}`);
    delete win.__littleZenPendingURL;
    delete win.__littleZenPendingURLMeta;

    log("Loading queued Little Zen URL", {
      url: pendingUrl,
      source: pendingMeta.source ?? "unknown",
      reason,
    });

    try {
      scheduleLeaveEmptyTabMode(win, `flush:${reason}`);

      const principal =
        pendingMeta.triggeringPrincipal ||
        Services.scriptSecurityManager.getSystemPrincipal();
      const mainWin = getMainBrowserWindow(win);
      const routingDecision = mainWin
        ? resolveLittleZenRoutingDecision(
            win,
            mainWin,
            pendingUrl,
            principal,
            `flush:${reason}`
          )
        : null;
      const targetWorkspace = routingDecision?.targetWorkspace ?? null;
      const targetContainerId = routingDecision?.targetContainerId ?? 0;
      const selectedTab = win.gBrowser?.selectedTab;
      const currentContainerId = getTabContainerId(selectedTab);

      log("Little Zen routing target: preparing tab container before load", {
        url: pendingUrl,
        reason,
        targetWorkspaceId: targetWorkspace?.uuid ?? null,
        targetWorkspaceName: targetWorkspace?.name ?? null,
        targetContainerId,
        currentContainerId,
      });

      let loadedByNewTab = false;
      if (selectedTab && currentContainerId !== targetContainerId) {
        const routedTabOptions = {
          triggeringPrincipal: principal,
          skipAnimation: true,
          skipRoute: true,
          inBackground: false,
        };
        if (targetContainerId) {
          routedTabOptions.userContextId = targetContainerId;
        }
        const routedTab = win.gBrowser.addTab(pendingUrl, routedTabOptions);

        if (routedTab?.linkedBrowser) {
          loadedByNewTab = true;
          syncLittleWindowTransparentBrowsers(win);
          if (targetWorkspace?.uuid) {
            routedTab.setAttribute("zen-workspace-id", targetWorkspace.uuid);
          }
          if (routingDecision?.hasZenDefaultUserContextId) {
            routedTab.setAttribute("zenDefaultUserContextId", "true");
          }
          win.gBrowser.selectedTab = routedTab;
          selectedBrowser = routedTab.linkedBrowser;
          win.setTimeout(() => {
            try {
              if (
                selectedTab !== routedTab &&
                win.gBrowser.selectedTab === routedTab &&
                routedTab.linkedBrowser &&
                selectedTab?.parentNode &&
                !selectedTab.closing &&
                win.gBrowser.tabs.length > 1
              ) {
                win.gBrowser.removeTab(selectedTab, { animate: false });
              }
            } catch (error) {
              log("Could not remove old Little Zen container placeholder tab", error);
            }
          }, 1000);
          log("Little Zen routing target: opened routed URL in target container tab", {
            targetContainerId,
            targetWorkspaceId: targetWorkspace?.uuid ?? null,
          });
        } else {
          log("Little Zen routing target: routed container tab creation failed", {
            targetContainerId,
            targetWorkspaceId: targetWorkspace?.uuid ?? null,
          });
          win.__littleZenPendingURL = pendingUrl;
          win.__littleZenPendingURLMeta = pendingMeta;
          setLittleWindowLoading(win, true, `retry:${reason}`);
          return false;
        }
      } else if (selectedTab && targetWorkspace?.uuid) {
        syncLittleWindowTransparentBrowsers(win);
        selectedTab.setAttribute("zen-workspace-id", targetWorkspace.uuid);
        if (routingDecision?.hasZenDefaultUserContextId) {
          selectedTab.setAttribute("zenDefaultUserContextId", "true");
        } else {
          selectedTab.removeAttribute("zenDefaultUserContextId");
        }
      }

      const loadFlags =
        Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP ??
        Ci.nsIWebNavigation.LOAD_FLAGS_NONE;

      if (!loadedByNewTab) {
        selectedBrowser.fixupAndLoadURIString(pendingUrl, {
          triggeringPrincipal: principal,
          loadFlags,
        });
      }

      try {
        win.__littleZenRefreshSpacePickerTarget?.();
      } catch (error) {
        log("Could not refresh Little Zen routed workspace after dispatch", error);
      }
      updateLittleZenBlendedTheme(win, `dispatch:${reason}`);

      win.setTimeout(() => {
        expandLittleWindow(win, `pending-navigation:${reason}`);
        try {
          win.__littleZenRefreshSpacePickerTarget?.();
        } catch (error) {
          log("Could not refresh Little Zen routed workspace after expand", error);
        }
      }, 0);

      logLittleWindowState(win, "Queued Little Zen URL dispatched", {
        url: pendingUrl,
        source: pendingMeta.source ?? "unknown",
        reason,
      });
      return true;
    } catch (error) {
      log("Failed to load queued Little Zen URL", pendingUrl, error);
      win.__littleZenPendingURL = pendingUrl;
      win.__littleZenPendingURLMeta = pendingMeta;
      setLittleWindowLoading(win, true, `error:${reason}`);
      return false;
    }
  }

  function schedulePendingNavigationFlush(win, reason = "unknown") {
    if (!win?.__littleZenPendingURL || win.closed) {
      return;
    }

    logLittleWindowState(win, "Scheduling Little Zen pending navigation flush", {
      reason,
      url: win.__littleZenPendingURL,
    });

    const attemptFlush = phase => {
      if (win.closed || !win.__littleZenPendingURL) {
        return;
      }
      flushPendingNavigation(win, `${reason}:${phase}`);
    };

    attemptFlush("immediate");
    win.requestAnimationFrame(() => {
      attemptFlush("raf");
    });
    win.setTimeout(() => {
      attemptFlush("timeout-150");
    }, 150);
    win.setTimeout(() => {
      attemptFlush("timeout-500");
    }, 500);
  }

  function focusUrlbar(win) {
    if (win.__littleZenSuppressUrlbarFocus) {
      logLittleWindowState(win, "Skipping Little Zen urlbar focus while navigation is loading");
      return;
    }

    if (!isEmptyLittleWindow(win)) {
      return;
    }

    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => {
        const urlbar = win.gURLBar;
        if (!urlbar || !isEmptyLittleWindow(win) || win.__littleZenSuppressUrlbarFocus) {
          return;
        }

        if (urlbar.hasAttribute("breakout-extend") || urlbar.view?.isOpen) {
          try {
            urlbar.focus();
            urlbar.select();
            urlbar.inputField?.focus();
            logLittleWindowState(win, "Focused existing Little Zen urlbar breakout");
          } catch (error) {
            log("Could not focus the little window urlbar.", error);
          }
          return;
        }

        if (openLittleWindowUrlbar(win)) {
          scheduleLittleWindowUrlbarPositionCheck(win, "focus-opened");
          return;
        }

        try {
          urlbar.focus();
          urlbar.select();
          urlbar.inputField?.focus();
          scheduleLittleWindowUrlbarPositionCheck(win, "focus-fallback");
          logLittleWindowState(win, "Focused Little Zen urlbar without breakout");
        } catch (error) {
          log("Could not focus the little window urlbar.", error);
        }
      });
    });
  }

  // ── Workspace Picker ────────────────────────────────────────────────────────

  const PICKER_ID = "zen-little-window-space-picker";
  const PICKER_MENU_ID = "zen-little-window-space-menu";

  function getMainBrowserWindow(win) {
    for (const bw of browserWindows()) {
      if (!isLittleWindow(bw) && bw !== win && !bw.closed) {
        return bw;
      }
    }
    return null;
  }

  function getWorkspaces(mainWin) {
    try {
      return mainWin?.gZenWorkspaces?.getWorkspaces?.() ?? [];
    } catch (e) {
      return [];
    }
  }

  function getActiveWorkspaceId(mainWin) {
    try {
      return mainWin?.gZenWorkspaces?.getActiveWorkspace?.()?.uuid ?? null;
    } catch (e) {
      return null;
    }
  }

  function getWorkspaceById(mainWin, id) {
    try {
      return mainWin?.gZenWorkspaces?.getWorkspaceFromId?.(id) ?? null;
    } catch (e) {
      return null;
    }
  }

  function getWorkspaceByRouteTarget(mainWin, routeTarget) {
    if (!routeTarget || routeTarget === "most-recent-space") {
      return null;
    }

    const directMatch = getWorkspaceById(mainWin, routeTarget);
    if (directMatch) {
      return directMatch;
    }

    const normalizedTarget = String(routeTarget).toLowerCase();
    return (
      getWorkspaces(mainWin).find((workspace) => {
        return (
          workspace?.uuid === routeTarget ||
          workspace?.id === routeTarget ||
          String(workspace?.name ?? "").toLowerCase() === normalizedTarget
        );
      }) ?? null
    );
  }

  function getWorkspaceContainerId(workspace) {
    const containerId = Number.parseInt(workspace?.containerTabId ?? 0, 10);
    return Number.isFinite(containerId) ? containerId : 0;
  }

  function getTabContainerId(tab) {
    const containerId = Number.parseInt(tab?.getAttribute("usercontextid") ?? 0, 10);
    return Number.isFinite(containerId) ? containerId : 0;
  }

  function getOpenShortcutDisplay() {
    return AppConstants.platform === "macosx" ? "⌘O" : "Ctrl+O";
  }

  function getWorkspaceDisplayIcon(workspace) {
    if (workspace?.icon) {
      return workspace.icon;
    }

    const name = String(workspace?.name ?? "Space");
    try {
      return new Intl.Segmenter().segment(name).containing(0).segment.toUpperCase();
    } catch (error) {
      return Array.from(name)[0]?.toUpperCase() ?? "S";
    }
  }

  function isTransparentBrowserAllowed() {
    try {
      return Services.prefs.getBoolPref(
        "browser.tabs.allow_transparent_browser",
        false
      );
    } catch (error) {
      return false;
    }
  }

  function syncLittleWindowTransparentBrowsers(win) {
    if (!isLittleWindow(win)) {
      return;
    }

    const enabled = isTransparentBrowserAllowed();
    win.document.documentElement.toggleAttribute(
      "zen-little-window-transparent-browser",
      enabled
    );

    try {
      for (const browser of win.gBrowser?.browsers ?? []) {
        if (enabled) {
          browser.setAttribute("transparent", "true");
        } else {
          browser.removeAttribute("transparent");
        }
      }
    } catch (error) {
      log("Could not sync Little Zen transparent browser attribute", error);
    }
  }

  function attachTransparentBrowserPrefSync(win) {
    if (win.__littleZenTransparentPrefSyncAttached) {
      return;
    }
    win.__littleZenTransparentPrefSyncAttached = true;

    const observer = () => syncLittleWindowTransparentBrowsers(win);
    try {
      Services.prefs.addObserver(
        "browser.tabs.allow_transparent_browser",
        observer
      );
      win.addEventListener(
        "unload",
        () => {
          try {
            Services.prefs.removeObserver(
              "browser.tabs.allow_transparent_browser",
              observer
            );
          } catch (error) {}
        },
        { once: true }
      );
    } catch (error) {
      log("Could not attach Little Zen transparent browser pref observer", error);
    }
  }

  function attachLittleWindowCloseButtonGuard(win) {
    if (win.__littleZenCloseButtonGuardAttached) {
      return;
    }
    win.__littleZenCloseButtonGuardAttached = true;

    const isCloseButtonTarget = (target) =>
      !!(
        target?.classList?.contains("titlebar-close") ||
        target?.closest?.(".titlebar-close")
      );

    const closeFromTitlebar = (event) => {
      const closeButton =
        event.composedPath?.().some(isCloseButtonTarget) ||
        isCloseButtonTarget(event.target);
      if (!closeButton || !isLittleWindow(win)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      try {
        win.close();
      } catch (error) {
        log("Little Zen titlebar close guard failed", error);
      }
    };

    win.addEventListener("mousedown", closeFromTitlebar, true);
    win.addEventListener("click", closeFromTitlebar, true);
    win.addEventListener("command", closeFromTitlebar, true);
    win.addEventListener(
      "unload",
      () => {
        try {
          win.removeEventListener("mousedown", closeFromTitlebar, true);
          win.removeEventListener("click", closeFromTitlebar, true);
          win.removeEventListener("command", closeFromTitlebar, true);
        } catch (error) {}
      },
      { once: true }
    );
  }

  function rgbaToCss(color) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a.toFixed(3)})`;
  }

  function rgbToCss(color) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  function parseCssRgb(input) {
    if (!input) {
      return null;
    }
    const raw = String(input).trim();
    const perceptual = raw.match(/^ok(?:lab|lch)\(\s*(\d+(?:\.\d+)?%?)/i);
    if (perceptual) {
      const channel = perceptual[1];
      const lightness = channel.endsWith("%")
        ? parseFloat(channel) / 100
        : parseFloat(channel);
      if (Number.isFinite(lightness)) {
        const value = Math.max(0, Math.min(255, Math.round(lightness * 255)));
        return { r: value, g: value, b: value };
      }
    }

    const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      const value = hex[1];
      const expand = (part) => part.length === 1 ? `${part}${part}` : part;
      const r = parseInt(expand(value.length <= 4 ? value[0] : value.slice(0, 2)), 16);
      const g = parseInt(expand(value.length <= 4 ? value[1] : value.slice(2, 4)), 16);
      const b = parseInt(expand(value.length <= 4 ? value[2] : value.slice(4, 6)), 16);
      return { r, g, b };
    }

    const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgb) {
      return null;
    }
    const parts = rgb[1].replace(/\s*\/\s*[\d.]+%?$/, "").split(/[,\s]+/).filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const readChannel = (part) => {
      const value = parseFloat(part);
      const scaled = String(part).trim().endsWith("%") ? value * 2.55 : value;
      return Math.max(0, Math.min(255, Math.round(scaled)));
    };
    return {
      r: readChannel(parts[0]),
      g: readChannel(parts[1]),
      b: readChannel(parts[2]),
    };
  }

  function getCssColorAlpha(value) {
    const match = String(value || "").trim().match(/^[a-z-]+\(([^)]+)\)$/i);
    if (!match) {
      return null;
    }

    const body = match[1].trim();
    let alpha = null;
    if (body.includes("/")) {
      alpha = body.slice(body.lastIndexOf("/") + 1).trim();
    } else {
      const parts = body.split(",");
      if (parts.length === 4) {
        alpha = parts[3].trim();
      }
    }
    if (alpha === null) {
      return null;
    }

    const amount = parseFloat(alpha);
    if (!Number.isFinite(amount)) {
      return null;
    }
    return alpha.endsWith("%") ? amount / 100 : amount;
  }

  function hasVisibleColor(input) {
    if (!input) {
      return false;
    }
    const value = String(input).trim().toLowerCase();
    if (!value || value === "transparent") {
      return false;
    }
    const alpha = getCssColorAlpha(value);
    return alpha === null || alpha >= 0.08;
  }

  function extractCssColor(input) {
    const value = String(input || "").trim();
    if (!value || value === "none") {
      return null;
    }
    const candidates = value.match(/[a-z-]+\([^)]*\)|#[0-9a-f]{3,8}\b/gi) || [];
    return candidates.find(hasVisibleColor) || null;
  }

  function getStyleBackground(style) {
    if (!style) {
      return null;
    }
    if (hasVisibleColor(style.backgroundColor)) {
      return style.backgroundColor;
    }
    return extractCssColor(style.backgroundImage);
  }

  function getRelativeLuminance(color) {
    const toLinear = (channel) => {
      const value = channel / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * toLinear(color.r) +
      0.7152 * toLinear(color.g) +
      0.0722 * toLinear(color.b)
    );
  }

  function getContrastRatio(a, b) {
    const light = Math.max(getRelativeLuminance(a), getRelativeLuminance(b));
    const dark = Math.min(getRelativeLuminance(a), getRelativeLuminance(b));
    return (light + 0.05) / (dark + 0.05);
  }

  function chooseForeground(color) {
    return getRelativeLuminance(color) > 0.6
      ? "rgba(11, 13, 16, 0.92)"
      : "rgba(245, 247, 251, 0.96)";
  }

  function getReadableForeground(bg, candidates = []) {
    const bgRgb = parseCssRgb(bg);
    if (!bgRgb) {
      return candidates.find(hasVisibleColor) || "currentColor";
    }
    return candidates.find((candidate) => {
      const fgRgb = parseCssRgb(candidate);
      if (!fgRgb) {
        return false;
      }
      return getContrastRatio(bgRgb, fgRgb) >= 4.5;
    }) || chooseForeground(bgRgb);
  }

  function getStableHeaderForeground(bgRgb, foreground) {
    const fgRgb = parseCssRgb(foreground);
    if (fgRgb && getContrastRatio(bgRgb, fgRgb) >= 4.5) {
      return foreground;
    }
    return chooseForeground(bgRgb);
  }

  function getCurrentThemeColorScheme(win) {
    const rootStyle = win.getComputedStyle(win.document.documentElement);
    const colorScheme =
      rootStyle.getPropertyValue("--toolbar-color-scheme") ||
      rootStyle.colorScheme;
    const normalizedScheme = String(colorScheme || "").trim().toLowerCase();
    if (normalizedScheme === "light" || normalizedScheme === "dark") {
      return normalizedScheme;
    }
    return win.document.documentElement.hasAttribute("zen-should-be-dark-mode") ? "dark" : "light";
  }

  function getNeutralHeaderShade(win, source = "unknown-page") {
    const isLight = getCurrentThemeColorScheme(win) === "light";
    return {
      bg: isLight ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
      fg: isLight ? "rgba(11, 13, 16, 0.82)" : "rgba(245, 247, 251, 0.9)",
      source,
    };
  }

  function getThemeColorTheme(browser) {
    const doc = browser?.contentDocument;
    const view = doc?.defaultView;
    if (!doc || !view) {
      return null;
    }

    const metas = doc.querySelectorAll?.('meta[name="theme-color" i]') || [];
    for (const meta of metas) {
      const media = meta.getAttribute?.("media") || "";
      if (media) {
        try {
          if (!view.matchMedia(media).matches) {
            continue;
          }
        } catch (error) {}
      }

      const bg = meta.getAttribute?.("content") || "";
      if (!hasVisibleColor(bg)) {
        continue;
      }

      const rootStyle = doc.documentElement ? view.getComputedStyle(doc.documentElement) : null;
      const bodyStyle = doc.body ? view.getComputedStyle(doc.body) : null;
      const bgRgb = parseCssRgb(bg);
      return {
        bg,
        fg: getReadableForeground(bg, [
          bodyStyle?.color || null,
          rootStyle?.color || null,
          bgRgb ? chooseForeground(bgRgb) : null,
        ]),
        source: "theme-color",
      };
    }

    return null;
  }

  function getDocumentCanvasTheme(browser) {
    const doc = browser?.contentDocument;
    const view = doc?.defaultView;
    const root = doc?.documentElement;
    if (!doc || !view || !root) {
      return null;
    }

    const rootStyle = view.getComputedStyle(root);
    const bodyStyle = doc.body ? view.getComputedStyle(doc.body) : null;
    let canvasFg = "";
    let probe = null;
    try {
      probe = doc.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;pointer-events:none;background-color:Canvas;color:CanvasText;";
      root.appendChild(probe);
      canvasFg = view.getComputedStyle(probe).color;
    } catch (error) {
    } finally {
      try {
        probe?.remove?.();
      } catch (error) {}
    }

    const bg = [
      bodyStyle ? getStyleBackground(bodyStyle) : null,
      getStyleBackground(rootStyle),
    ].find(hasVisibleColor);
    if (!bg) {
      return null;
    }

    return {
      bg,
      fg: getReadableForeground(bg, [
        bodyStyle?.color || null,
        rootStyle?.color || null,
        canvasFg || null,
      ]),
      source: "document-canvas",
    };
  }

  function getThemeFromElement(view, element, source = "element", allowPageFallback = true) {
    if (!view || !element) {
      return null;
    }

    let fg = null;
    let bg = null;
    let current = element;
    const doc = element.ownerDocument || null;

    while (current) {
      if (!allowPageFallback && (current === doc?.body || current === doc?.documentElement)) {
        break;
      }
      const style = view.getComputedStyle(current);
      if (!fg && hasVisibleColor(style.color)) {
        fg = style.color;
      }
      const background = getStyleBackground(style);
      if (!bg && hasVisibleColor(background)) {
        bg = background;
      }
      if (bg && fg) {
        break;
      }
      current = current.parentElement;
    }

    if (!hasVisibleColor(bg)) {
      return null;
    }

    return {
      bg,
      fg: getReadableForeground(bg, [fg]),
      source,
    };
  }

  function getTopVisibleTheme(browser) {
    const doc = browser?.contentDocument;
    const view = doc?.defaultView;
    if (!doc || !view) {
      return null;
    }

    const width = view.innerWidth || doc.documentElement?.clientWidth || 0;
    const height = view.innerHeight || doc.documentElement?.clientHeight || 0;
    const xMid = Math.max(1, Math.floor((width || 2) / 2));
    const xEnd = Math.max(1, (width || 2) - 2);
    const yTop = Math.min(3, Math.max(0, (height || 4) - 1));
    const yBand = Math.min(30, Math.max(0, (height || 31) - 1));
    const points = [
      [1, yTop],
      [xMid, yTop],
      [xEnd, yTop],
      [1, yBand],
      [xMid, yBand],
    ];
    let firstRendered = null;

    const isRenderedElement = (candidate) => {
      if (!candidate) {
        return false;
      }
      const rect = candidate.getBoundingClientRect?.();
      const style = view.getComputedStyle(candidate);
      return (
        rect?.width > 0 &&
        rect?.height > 0 &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        style.display !== "none" &&
        Number(style.opacity || 1) > 0.05
      );
    };

    for (const [x, y] of points) {
      const elements = doc.elementsFromPoint?.(x, y) || [];
      for (const element of elements) {
        if (!isRenderedElement(element)) {
          continue;
        }
        firstRendered ||= element;
        const background = getStyleBackground(view.getComputedStyle(element));
        if (hasVisibleColor(background)) {
          return getThemeFromElement(view, element, "top-visible", false);
        }
      }
    }

    return getThemeFromElement(
      view,
      firstRendered || doc.elementFromPoint?.(1, 3),
      "top-visible",
      false
    );
  }

  function getChromeToolbarFallbackTheme(win) {
    const doc = win.document;
    const probe = doc.createElement("div");
    probe.style.position = "fixed";
    probe.style.pointerEvents = "none";
    probe.style.opacity = "0";
    probe.style.backgroundColor = "var(--zen-main-browser-background-toolbar)";
    probe.style.color = "var(--toolbox-textcolor)";
    doc.documentElement.appendChild(probe);
    const probeStyle = win.getComputedStyle(probe);
    const toolbarBg = probeStyle.backgroundColor;
    const toolbarFg = probeStyle.color;
    probe.remove();

    const rootStyle = win.getComputedStyle(doc.documentElement);
    const rootBg = rootStyle.backgroundColor;
    const bg = [toolbarBg, rootBg, "Canvas"].find(hasVisibleColor) || "Canvas";
    return {
      bg,
      fg: getReadableForeground(bg, [toolbarFg]),
      source: "toolbar-fallback",
    };
  }

  async function getContentTaskPageTheme(browser) {
    if (!browser || typeof ContentTask === "undefined" || !ContentTask?.spawn) {
      return null;
    }

    try {
      return await ContentTask.spawn(browser, null, () => {
        const parseCssRgb = (input) => {
          if (!input) return null;
          const raw = String(input).trim();
          const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
          if (hex) {
            const value = hex[1];
            const expand = (part) => part.length === 1 ? `${part}${part}` : part;
            return {
              r: parseInt(expand(value.length <= 4 ? value[0] : value.slice(0, 2)), 16),
              g: parseInt(expand(value.length <= 4 ? value[1] : value.slice(2, 4)), 16),
              b: parseInt(expand(value.length <= 4 ? value[2] : value.slice(4, 6)), 16),
            };
          }
          const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
          if (!rgb) return null;
          const parts = rgb[1].replace(/\s*\/\s*[\d.]+%?$/, "").split(/[,\s]+/).filter(Boolean);
          if (parts.length < 3) return null;
          const read = (part) => {
            const value = parseFloat(part);
            return Math.max(0, Math.min(255, Math.round(String(part).trim().endsWith("%") ? value * 2.55 : value)));
          };
          return { r: read(parts[0]), g: read(parts[1]), b: read(parts[2]) };
        };
        const luminance = (color) => {
          const toLinear = (channel) => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
        };
        const alpha = (value) => {
          const match = String(value || "").trim().match(/^[a-z-]+\(([^)]+)\)$/i);
          if (!match) return null;
          const body = match[1].trim();
          const raw = body.includes("/") ? body.slice(body.lastIndexOf("/") + 1).trim() : body.split(",")[3]?.trim();
          if (!raw) return null;
          const amount = parseFloat(raw);
          return Number.isFinite(amount) ? (raw.endsWith("%") ? amount / 100 : amount) : null;
        };
        const visible = (input) => {
          const value = String(input || "").trim().toLowerCase();
          if (!value || value === "transparent") return false;
          const a = alpha(value);
          return a === null || a >= 0.08;
        };
        const extractColor = (input) =>
          (String(input || "").match(/[a-z-]+\([^)]*\)|#[0-9a-f]{3,8}\b/gi) || []).find(visible) || null;
        const styleBackground = (style) => visible(style?.backgroundColor) ? style.backgroundColor : extractColor(style?.backgroundImage);
        const chooseFg = (bg) => {
          const rgb = parseCssRgb(bg);
          return rgb && luminance(rgb) > 0.6 ? "rgba(11, 13, 16, 0.92)" : "rgba(245, 247, 251, 0.96)";
        };
        const readableFg = (bg, candidates = []) =>
          candidates.find((candidate) => {
            if (!visible(candidate)) return false;
            const bgRgb = parseCssRgb(bg);
            const fgRgb = parseCssRgb(candidate);
            if (!bgRgb || !fgRgb) return false;
            const light = Math.max(luminance(bgRgb), luminance(fgRgb));
            const dark = Math.min(luminance(bgRgb), luminance(fgRgb));
            return (light + 0.05) / (dark + 0.05) >= 3;
          }) || chooseFg(bg);
        const themeFromElement = (view, element, source, allowPageFallback = true) => {
          if (!view || !element) return null;
          let fg = null;
          let bg = null;
          let current = element;
          const doc = element.ownerDocument;
          while (current) {
            if (!allowPageFallback && (current === doc.body || current === doc.documentElement)) break;
            const style = view.getComputedStyle(current);
            if (!fg && visible(style.color)) fg = style.color;
            const background = styleBackground(style);
            if (!bg && visible(background)) bg = background;
            if (bg && fg) break;
            current = current.parentElement;
          }
          return visible(bg) ? { bg, fg: readableFg(bg, [fg]), source } : null;
        };
        const themeColorTheme = (doc, view) => {
          for (const meta of doc.querySelectorAll?.('meta[name="theme-color" i]') || []) {
            const media = meta.getAttribute?.("media") || "";
            try {
              if (media && !view.matchMedia(media).matches) continue;
            } catch {}
            const bg = meta.getAttribute?.("content") || "";
            if (!visible(bg)) continue;
            const rootStyle = doc.documentElement ? view.getComputedStyle(doc.documentElement) : null;
            const bodyStyle = doc.body ? view.getComputedStyle(doc.body) : null;
            return {
              bg,
              fg: readableFg(bg, [bodyStyle?.color || null, rootStyle?.color || null]),
              source: "theme-color",
            };
          }
          return null;
        };
        const topVisibleTheme = (doc, view) => {
          const width = view.innerWidth || doc.documentElement?.clientWidth || 0;
          const height = view.innerHeight || doc.documentElement?.clientHeight || 0;
          const xMid = Math.max(1, Math.floor((width || 2) / 2));
          const xEnd = Math.max(1, (width || 2) - 2);
          const yTop = Math.min(3, Math.max(0, (height || 4) - 1));
          const yBand = Math.min(30, Math.max(0, (height || 31) - 1));
          const points = [[1, yTop], [xMid, yTop], [xEnd, yTop], [1, yBand], [xMid, yBand]];
          let firstRendered = null;
          const isRendered = (candidate) => {
            if (!candidate) return false;
            const rect = candidate.getBoundingClientRect?.();
            const style = view.getComputedStyle(candidate);
            return rect?.width > 0 && rect?.height > 0 && style.visibility !== "hidden" && style.visibility !== "collapse" && style.display !== "none" && Number(style.opacity || 1) > 0.05;
          };
          for (const [x, y] of points) {
            for (const element of doc.elementsFromPoint?.(x, y) || []) {
              if (!isRendered(element)) continue;
              firstRendered ||= element;
              const background = styleBackground(view.getComputedStyle(element));
              if (visible(background)) return themeFromElement(view, element, "top-visible", false);
            }
          }
          return themeFromElement(view, firstRendered || doc.elementFromPoint?.(1, 3), "top-visible", false);
        };
        const canvasTheme = (doc, view) => {
          const root = doc.documentElement;
          const rootStyle = view.getComputedStyle(root);
          const bodyStyle = doc.body ? view.getComputedStyle(doc.body) : null;
          const bg = [bodyStyle ? styleBackground(bodyStyle) : null, styleBackground(rootStyle)].find(visible);
          return visible(bg)
            ? { bg, fg: readableFg(bg, [bodyStyle?.color || null, rootStyle?.color || null]), source: "document-canvas" }
            : null;
        };

        try {
          const doc = content.document;
          const view = doc?.defaultView;
          if (!doc || !view || !doc.documentElement) return null;
          const href = content.location.href;
          const theme =
            topVisibleTheme(doc, view) ||
            themeColorTheme(doc, view) ||
            themeFromElement(view, doc.body, "body") ||
            themeFromElement(view, doc.documentElement, "html") ||
            canvasTheme(doc, view);
          return theme ? { ...theme, href, bridge: "content" } : null;
        } catch {
          return null;
        }
      });
    } catch (error) {
      log("Little Zen ContentTask theme lookup failed", error);
      return null;
    }
  }

  function getLittleZenBrowserMessageManager(browser) {
    return browser?.messageManager || browser?.frameLoader?.messageManager || null;
  }

  function getLittleZenThemeFrameScript(requestId) {
    return `
      (() => {
        const requestId = ${JSON.stringify(requestId)};
        const messageName = ${JSON.stringify(LITTLE_ZEN_THEME_MESSAGE_NAME)};
        const send = (payload) => sendAsyncMessage(messageName, { requestId, ...payload });
        const alpha = value => {
          const match = String(value || "").trim().match(/^[a-z-]+\\(([^)]+)\\)$/i);
          if (!match) return null;
          const body = match[1].trim();
          const raw = body.includes("/") ? body.slice(body.lastIndexOf("/") + 1).trim() : body.split(",")[3]?.trim();
          if (!raw) return null;
          const amount = parseFloat(raw);
          return Number.isFinite(amount) ? (raw.endsWith("%") ? amount / 100 : amount) : null;
        };
        const visible = input => {
          const value = String(input || "").trim().toLowerCase();
          if (!value || value === "transparent") return false;
          const a = alpha(value);
          return a === null || a >= 0.08;
        };
        const extractColor = input =>
          (String(input || "").match(/[a-z-]+\\([^)]*\\)|#[0-9a-f]{3,8}\\b/gi) || []).find(visible) || null;
        const styleBackground = style => visible(style?.backgroundColor) ? style.backgroundColor : extractColor(style?.backgroundImage);
        const parseRgb = input => {
          const raw = String(input || "").trim();
          const rgb = raw.match(/^rgba?\\(([^)]+)\\)$/i);
          if (!rgb) return null;
          const parts = rgb[1].replace(/\\s*\\/\\s*[\\d.]+%?$/, "").split(/[,\\s]+/).filter(Boolean);
          if (parts.length < 3) return null;
          const read = part => {
            const value = parseFloat(part);
            return Math.max(0, Math.min(255, Math.round(String(part).trim().endsWith("%") ? value * 2.55 : value)));
          };
          return { r: read(parts[0]), g: read(parts[1]), b: read(parts[2]) };
        };
        const luminance = color => {
          const lin = channel => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
        };
        const chooseFg = bg => {
          const rgb = parseRgb(bg);
          return rgb && luminance(rgb) > 0.6 ? "rgba(11, 13, 16, 0.92)" : "rgba(245, 247, 251, 0.96)";
        };
        const themeFromElement = (view, element, source, allowPageFallback = true) => {
          if (!view || !element) return null;
          let bg = null;
          let fg = null;
          let current = element;
          const doc = element.ownerDocument;
          while (current) {
            if (!allowPageFallback && (current === doc.body || current === doc.documentElement)) break;
            const style = view.getComputedStyle(current);
            if (!fg && visible(style.color)) fg = style.color;
            const background = styleBackground(style);
            if (!bg && visible(background)) bg = background;
            if (bg && fg) break;
            current = current.parentElement;
          }
          return visible(bg) ? { bg, fg: fg || chooseFg(bg), source } : null;
        };
        const topVisibleTheme = (doc, view) => {
          const width = view.innerWidth || doc.documentElement?.clientWidth || 0;
          const height = view.innerHeight || doc.documentElement?.clientHeight || 0;
          const xMid = Math.max(1, Math.floor((width || 2) / 2));
          const xEnd = Math.max(1, (width || 2) - 2);
          const yTop = Math.min(3, Math.max(0, (height || 4) - 1));
          const yBand = Math.min(30, Math.max(0, (height || 31) - 1));
          const points = [[1, yTop], [xMid, yTop], [xEnd, yTop], [1, yBand], [xMid, yBand]];
          let firstRendered = null;
          for (const [x, y] of points) {
            for (const element of doc.elementsFromPoint?.(x, y) || []) {
              if (!element) continue;
              const rect = element.getBoundingClientRect?.();
              const style = view.getComputedStyle(element);
              if (!(rect?.width > 0 && rect?.height > 0) || style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none" || Number(style.opacity || 1) <= 0.05) continue;
              firstRendered ||= element;
              if (visible(styleBackground(style))) return themeFromElement(view, element, "top-visible", false);
            }
          }
          return themeFromElement(view, firstRendered || doc.elementFromPoint?.(1, 3), "top-visible", false);
        };
        const themeColorTheme = (doc, view) => {
          for (const meta of doc.querySelectorAll?.('meta[name="theme-color" i]') || []) {
            const media = meta.getAttribute?.("media") || "";
            try { if (media && !view.matchMedia(media).matches) continue; } catch {}
            const bg = meta.getAttribute?.("content") || "";
            if (visible(bg)) return { bg, fg: chooseFg(bg), source: "theme-color" };
          }
          return null;
        };
        try {
          if (content.top !== content) return;
          const doc = content.document;
          const view = doc?.defaultView;
          if (!doc || !view || !doc.documentElement) return send({ ok: false });
          const theme =
            topVisibleTheme(doc, view) ||
            themeColorTheme(doc, view) ||
            themeFromElement(view, doc.body, "body") ||
            themeFromElement(view, doc.documentElement, "html");
          send({ ok: true, theme: theme ? { ...theme, href: content.location.href, bridge: "message-manager" } : null });
        } catch (error) {
          send({ ok: false, error: error?.message || String(error) });
        }
      })();
    `;
  }

  async function getMessageManagerPageTheme(browser) {
    const messageManager = getLittleZenBrowserMessageManager(browser);
    if (!browser || !messageManager?.loadFrameScript || !messageManager?.addMessageListener) {
      return null;
    }

    const requestId = `little-zen-theme-${Date.now()}-${++littleZenThemeRequestSeq}`;
    return await new Promise((resolve) => {
      let settled = false;
      let timeoutId = 0;
      const finish = (theme) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        try {
          messageManager.removeMessageListener(LITTLE_ZEN_THEME_MESSAGE_NAME, listener);
        } catch (error) {}
        resolve(theme || null);
      };
      const listener = {
        receiveMessage(message) {
          const data = message?.data;
          if (!data || data.requestId !== requestId) {
            return;
          }
          finish(data.theme || null);
        },
      };

      const ownerWindow = browser.ownerGlobal || window;
      timeoutId = ownerWindow.setTimeout(
        () => finish(null),
        LITTLE_ZEN_THEME_BRIDGE_TIMEOUT_MS
      );
      try {
        messageManager.addMessageListener(LITTLE_ZEN_THEME_MESSAGE_NAME, listener);
        const scriptUrl = `data:application/javascript;charset=utf-8,${encodeURIComponent(
          getLittleZenThemeFrameScript(requestId)
        )}`;
        messageManager.loadFrameScript(scriptUrl, false);
      } catch (error) {
        finish(null);
      }
    });
  }

  async function getLittleZenAsyncPageTheme(browser) {
    const lookups = [
      getContentTaskPageTheme(browser),
      getMessageManagerPageTheme(browser),
    ];

    return await new Promise((resolve) => {
      let pending = lookups.length;
      const finishEmpty = () => {
        pending--;
        if (pending === 0) {
          resolve(null);
        }
      };

      for (const lookup of lookups) {
        Promise.resolve(lookup)
          .then((theme) => {
            if (theme?.bg) {
              resolve(theme);
            } else {
              finishEmpty();
            }
          })
          .catch(() => finishEmpty());
      }
    });
  }

  function getLittleZenChromePageTheme(win) {
    const browser = win.gBrowser?.selectedBrowser;
    const href = getLittleZenThemeUrl(win)?.href || "";
    const browserHref = browser?.currentURI?.spec || "";
    let docHref = "";
    let theme = null;
    try {
      docHref = browser?.contentDocument?.location?.href || "";
      const chromeThemeAllowed = !docHref || !browserHref || docHref === browserHref;
      theme =
        (chromeThemeAllowed ? getTopVisibleTheme(browser) : null) ||
        (chromeThemeAllowed ? getThemeColorTheme(browser) : null) ||
        (chromeThemeAllowed ? getThemeFromElement(browser?.contentDocument?.defaultView, browser?.contentDocument?.body, "body") : null) ||
        (chromeThemeAllowed ? getThemeFromElement(browser?.contentDocument?.defaultView, browser?.contentDocument?.documentElement, "html") : null) ||
        (chromeThemeAllowed ? getDocumentCanvasTheme(browser) : null);
    } catch (error) {
      log("Little Zen page theme probe failed", error);
    }
    theme =
      theme ||
      (href ? null : getNeutralHeaderShade(win)) ||
      getChromeToolbarFallbackTheme(win);
    return {
      ...theme,
      href,
    };
  }

  function getLittleZenThemeUrl(win) {
    try {
      const spec =
        win.gBrowser?.selectedBrowser?.currentURI?.spec ||
        win.__littleZenRoutedURL ||
        win.__littleZenPendingURL;
      if (spec && !spec.startsWith("about:")) {
        return new URL(spec);
      }
    } catch (error) {}
    return null;
  }

  function getLittleZenThemeCacheKeys(href) {
    const keys = [];
    const raw = String(href || "");
    if (!raw) {
      return keys;
    }
    keys.push(`page:${raw}`);
    try {
      const url = new URL(raw);
      if (/^https?:$/i.test(url.protocol) && url.hostname) {
        keys.push(`host:${url.hostname.toLowerCase()}`);
      }
    } catch (error) {}
    return keys;
  }

  function rememberLittleZenTheme(theme, href) {
    if (!theme?.bg || !href || theme.source === "toolbar-fallback" || theme.source === "unknown-page") {
      return;
    }
    for (const key of getLittleZenThemeCacheKeys(href)) {
      littleZenThemeCache.set(key, theme);
    }
    while (littleZenThemeCache.size > LITTLE_ZEN_THEME_CACHE_LIMIT) {
      littleZenThemeCache.delete(littleZenThemeCache.keys().next().value);
    }
  }

  function getRememberedLittleZenTheme(href) {
    for (const key of getLittleZenThemeCacheKeys(href)) {
      const theme = littleZenThemeCache.get(key);
      if (theme?.bg) {
        return {
          ...theme,
          source: theme.source === "host-cache" ? "host-cache" : theme.source || "target-cache",
        };
      }
    }
    return null;
  }

  function applyLittleZenResolvedTheme(win, theme, reason = "unknown") {
    if (!isLittleWindow(win) || !theme) {
      return;
    }

    const root = win.document.documentElement;
    const url = getLittleZenThemeUrl(win);
    const themeColor = theme?.bg || (
      root.hasAttribute("zen-should-be-dark-mode")
        ? "rgb(16, 18, 24)"
        : "rgb(245, 247, 251)"
    );
    const themeRgb = parseCssRgb(themeColor) || (
      root.hasAttribute("zen-should-be-dark-mode")
        ? { r: 16, g: 18, b: 24 }
        : { r: 245, g: 247, b: 251 }
    );
    const header = themeColor;
    const foreground = getStableHeaderForeground(themeRgb, theme?.fg);
    const windowBackground = themeColor;
    const isLightTheme = getRelativeLuminance(themeRgb) > 0.56;
    const controlOutline = isLightTheme
      ? "rgba(0, 0, 0, 0.14)"
      : "rgba(255, 255, 255, 0.13)";
    const pageOutline = isLightTheme
      ? "rgba(0, 0, 0, 0.24)"
      : "rgba(255, 255, 255, 0.22)";
    const tintBackground = windowBackground;

    setCssVar(root, "--little-zen-page-header-background", header);
    setCssVar(root, "--little-zen-page-header-foreground", foreground);
    setCssVar(root, "--little-zen-window-theme-background", windowBackground);
    setCssVar(root, "--little-zen-theme-outline", controlOutline);
    setCssVar(root, "--little-zen-page-outline", pageOutline);
    setCssVar(root, "--blended-addressbar-frame-background", windowBackground);
    setCssVar(root, "--blended-addressbar-window-tint-background", tintBackground);
    setCssVar(
      win.document.getElementById("zen-browser-background"),
      "--blended-addressbar-window-tint-background",
      tintBackground
    );
    rememberLittleZenTheme(theme, theme.href || url?.href || "");

    log("Little Zen blended theme updated", {
      reason,
      href: url?.href ?? null,
      source: theme?.source ?? null,
      header,
      foreground,
      windowBackground,
      controlOutline,
      pageOutline,
      tintBackground,
    });
  }

  async function updateLittleZenBlendedTheme(win, reason = "unknown") {
    if (!isLittleWindow(win)) {
      return;
    }

    const browser = win.gBrowser?.selectedBrowser;
    const expectedHref = getLittleZenThemeUrl(win)?.href || "";
    const chromeTheme = getLittleZenChromePageTheme(win);
    const rememberedTheme = getRememberedLittleZenTheme(expectedHref);
    if (rememberedTheme?.bg && chromeTheme?.source === "toolbar-fallback") {
      applyLittleZenResolvedTheme(win, rememberedTheme, `${reason}:retained`);
    } else {
      applyLittleZenResolvedTheme(win, chromeTheme, reason);
    }

    const contentTheme = await getLittleZenAsyncPageTheme(browser);
    if (!contentTheme?.bg || !isLittleWindow(win)) {
      return;
    }
    const currentHref = getLittleZenThemeUrl(win)?.href || "";
    if (expectedHref && currentHref && expectedHref !== currentHref) {
      return;
    }
    applyLittleZenResolvedTheme(win, contentTheme, `${reason}:content`);
  }

  function getLittleWindowUrl(win) {
    try {
      const browser = win.gBrowser?.selectedBrowser;
      const spec = browser?.currentURI?.spec;
      if (spec && spec !== "about:blank" && spec !== "about:newtab") {
        return spec;
      }
    } catch (e) {}
    return null;
  }

  function getLittleWindowRouteUrl(win) {
    return (
      win?.__littleZenRoutedURL ||
      win?.__littleZenPendingURL ||
      getLittleWindowUrl(win)
    );
  }

  function getInitialTargetWorkspaceId(win, mainWin) {
    const activeWorkspaceId = getActiveWorkspaceId(mainWin);
    const url = getLittleWindowRouteUrl(win);
    const routeDebugBase = {
      routedUrl: win?.__littleZenRoutedURL ?? null,
      pendingUrl: win?.__littleZenPendingURL ?? null,
      currentUrl: getLittleWindowUrl(win),
      selectedUrl: url,
      activeWorkspaceId,
      workspaces: getWorkspaces(mainWin).map((workspace) => ({
        uuid: workspace?.uuid ?? null,
        id: workspace?.id ?? null,
        name: workspace?.name ?? null,
      })),
    };

    if (!url) {
      log("Little Zen routing target: no URL, using active workspace", routeDebugBase);
      return activeWorkspaceId;
    }

    try {
      const routingManager = mainWin.gZenSpaceRoutingManager;
      const route = mainWin.gZenSpaceRoutingManager?.routeUri?.(url, {
        fromExternal: true,
      });
      const defaultExternalRoute =
        routingManager?.getDefaultExternalRoute?.() ?? null;
      log("Little Zen routing target: routeUri result", {
        ...routeDebugBase,
        route,
        defaultExternalRoute,
      });
      if (route && route !== "most-recent-space") {
        const workspace = getWorkspaceByRouteTarget(mainWin, route);
        if (workspace) {
          log("Little Zen routing target: resolved routed workspace", {
            route,
            workspaceId: workspace.uuid,
            workspaceName: workspace.name,
          });
          return workspace.uuid;
        }
        log("Little Zen routing target: route did not match a workspace", {
          route,
          ...routeDebugBase,
        });
      }
    } catch (error) {
      log("Could not resolve Little Zen route target workspace", {
        error,
        ...routeDebugBase,
      });
    }

    log("Little Zen routing target: using active workspace fallback", routeDebugBase);
    return activeWorkspaceId;
  }

  function resolveLittleZenTargetWorkspace(win, mainWin, reason = "unknown") {
    const workspaceId = getInitialTargetWorkspaceId(win, mainWin);
    const workspace = getWorkspaceById(mainWin, workspaceId);
    log("Little Zen routing target: final workspace decision", {
      reason,
      workspaceId,
      workspaceName: workspace?.name ?? null,
      containerTabId: getWorkspaceContainerId(workspace),
      routeUrl: getLittleWindowRouteUrl(win),
    });
    return workspace;
  }

  function resolveLittleZenRoutingDecision(
    win,
    mainWin,
    url,
    triggeringPrincipal,
    reason = "unknown"
  ) {
    let beforeRouteResult = null;
    let userContextId;
    let hasZenDefaultUserContextId = false;
    let forcedWorkspaceId;

    try {
      beforeRouteResult = mainWin.gZenSpaceRoutingManager?.onBeforeAddTab?.(
        url,
        {
          fromExternal: true,
          skipRoute: false,
          pinned: false,
          tabGroup: null,
        },
        mainWin
      );
    } catch (error) {
      log("Little Zen routing target: onBeforeAddTab failed", {
        error,
        url,
        reason,
      });
    }

    if (beforeRouteResult?.isRouteFound) {
      userContextId = beforeRouteResult.userContextId;
      hasZenDefaultUserContextId = true;
      forcedWorkspaceId = beforeRouteResult.targetRoute;
    } else {
      try {
        [userContextId, hasZenDefaultUserContextId, forcedWorkspaceId] =
          mainWin.gZenWorkspaces?.getContextIdIfNeeded?.(
            undefined,
            true,
            triggeringPrincipal
          ) ?? [undefined, false, undefined];
      } catch (error) {
        log("Little Zen routing target: getContextIdIfNeeded failed", {
          error,
          url,
          reason,
        });
      }
    }

    const routeWorkspace =
      getWorkspaceByRouteTarget(mainWin, beforeRouteResult?.targetRoute) ??
      getWorkspaceById(mainWin, forcedWorkspaceId) ??
      resolveLittleZenTargetWorkspace(win, mainWin, reason);
    const targetContainerId =
      typeof userContextId === "undefined" || userContextId === null
        ? getWorkspaceContainerId(routeWorkspace)
        : Number.parseInt(userContextId, 10) || 0;

    log("Little Zen routing target: Zen routing decision", {
      reason,
      url,
      beforeRouteResult,
      forcedWorkspaceId,
      targetWorkspaceId: routeWorkspace?.uuid ?? null,
      targetWorkspaceName: routeWorkspace?.name ?? null,
      userContextId,
      targetContainerId,
      hasZenDefaultUserContextId,
    });

    return {
      beforeRouteResult,
      targetWorkspace: routeWorkspace,
      targetContainerId,
      hasZenDefaultUserContextId,
    };
  }

  function setCssVar(element, name, value) {
    if (!element?.style) {
      return;
    }
    if (value) {
      element.style.setProperty(name, value);
    } else {
      element.style.removeProperty(name);
    }
  }

  async function placeTabInWorkspace(mainWin, tab, workspaceId) {
    const workspaces = mainWin?.gZenWorkspaces;
    if (!workspaces || !tab || !workspaceId) {
      return false;
    }

    try {
      if (typeof workspaces.moveTabToWorkspace === "function") {
        workspaces.moveTabToWorkspace(tab, workspaceId);
      } else {
        tab.setAttribute("zen-workspace-id", workspaceId);
      }

      if (workspaces.lastSelectedWorkspaceTabs) {
        workspaces.lastSelectedWorkspaceTabs[workspaceId] = tab;
      }

      if (typeof workspaces.changeWorkspaceWithID === "function") {
        await workspaces.changeWorkspaceWithID(workspaceId);
      } else {
        const workspace = getWorkspaceById(mainWin, workspaceId);
        if (workspace) {
          await workspaces.changeWorkspace?.(workspace);
        }
      }

      mainWin.gBrowser.selectedTab = tab;
      mainWin.gBrowser.selectedBrowser?.focus?.();
      return true;
    } catch (error) {
      log("placeTabInWorkspace failed", error);
      return false;
    }
  }

  async function adoptLiveTabIntoWorkspace(win, mainWin, workspaceId) {
    const sourceTab = win.gBrowser?.selectedTab;
    if (
      !sourceTab ||
      !mainWin?.gBrowser ||
      typeof mainWin.gBrowser.adoptTab !== "function"
    ) {
      return null;
    }

    try {
      sourceTab.removeAttribute("zen-empty-tab");
      const adoptedTab = mainWin.gBrowser.adoptTab(sourceTab, {
        tabIndex: Infinity,
      });
      if (!adoptedTab) {
        return null;
      }

      await placeTabInWorkspace(mainWin, adoptedTab, workspaceId);
      mainWin.focus();
      win.setTimeout(() => {
        if (!win.closed) {
          win.close();
        }
      }, 150);
      log("transferTabToWorkspace: adoptTab succeeded", {
        sourceTabId: sourceTab.id ?? null,
        adoptedTabId: adoptedTab.id ?? null,
      });
      return adoptedTab;
    } catch (error) {
      log("transferTabToWorkspace: adoptTab failed", error);
      return null;
    }
  }

  async function transferTabToWorkspace(win, workspaceId) {
    const mainWin = getMainBrowserWindow(win);
    if (!mainWin) {
      log("transferTabToWorkspace: no main window found");
      return;
    }

    const workspace = getWorkspaceById(mainWin, workspaceId);
    if (!workspace) {
      log("transferTabToWorkspace: workspace not found", workspaceId);
      return;
    }

    const url = getLittleWindowUrl(win);
    log("Transferring tab to workspace", { url, workspace: workspace.name });

    // Fallback: open URL in a new tab in the target workspace (causes reload)
    const doFallback = async () => {
      if (!url) {
        mainWin.focus();
        win.close();
        return;
      }
      try {
        const addTabOptions = {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          skipAnimation: true,
          skipRoute: true,
        };
        const fallbackContainerId = getWorkspaceContainerId(workspace);
        if (fallbackContainerId) {
          addTabOptions.userContextId = fallbackContainerId;
        }
        const newTab = mainWin.gBrowser.addTab(url, addTabOptions);
        if (newTab) {
          await placeTabInWorkspace(mainWin, newTab, workspaceId);
        }
        mainWin.focus();
      } catch (e) {
        log("transferTabToWorkspace fallback error", e);
      }
      win.close();
    };

    const ourBrowser = win.gBrowser?.selectedBrowser;

    // If there's no live content to transfer, just switch workspace and close
    if (!ourBrowser || !url) {
      try {
        await mainWin.gZenWorkspaces?.changeWorkspace?.(workspace);
      } catch (e) {}
      mainWin.focus();
      win.close();
      return;
    }

    try {
      const adoptedTab = await adoptLiveTabIntoWorkspace(win, mainWin, workspaceId);
      if (!adoptedTab) {
        await doFallback();
      }

    } catch (err) {
      log("transferTabToWorkspace: live transfer failed, falling back", err);
      await doFallback();
    }
  }

  function buildSpacePicker(win) {
    const doc = win.document;
    if (doc.getElementById(PICKER_ID)) {
      return;
    }

    const mainWin = getMainBrowserWindow(win);
    if (!mainWin) {
      return;
    }

    // Split workspace control, mirroring Zen's toolbarbutton/menuitem shape.
    const picker = doc.createXULElement("toolbaritem");
    picker.id = PICKER_ID;
    picker.setAttribute("align", "center");
    picker.classList.add("chromeclass-toolbar-additional");

    const openButton = doc.createXULElement("toolbarbutton");
    openButton.id = PICKER_ID + "-open";
    openButton.classList.add(
      "toolbarbutton-1",
      "chromeclass-toolbar-additional",
      "zen-little-window-space-button"
    );
    openButton.setAttribute("crop", "end");
    openButton.setAttribute("flex", "1");
    openButton.setAttribute("orient", "horizontal");
    openButton.setAttribute("tooltip", "dynamic-shortcut-tooltip");

    const openButtonLabel = doc.createXULElement("label");
    openButtonLabel.id = PICKER_ID + "-label";
    openButtonLabel.setAttribute("crop", "end");
    openButtonLabel.setAttribute("flex", "1");
    openButton.appendChild(openButtonLabel);

    const shortcutHint = doc.createXULElement("label");
    shortcutHint.id = PICKER_ID + "-shortcut";
    shortcutHint.setAttribute("value", getOpenShortcutDisplay());
    shortcutHint.setAttribute("tooltiptext", "Open in main window");
    openButton.appendChild(shortcutHint);

    const arrow = doc.createXULElement("toolbarbutton");
    arrow.id = PICKER_ID + "-arrow";
    arrow.classList.add(
      "toolbarbutton-1",
      "chromeclass-toolbar-additional",
      "zen-little-window-space-arrow"
    );
    arrow.setAttribute("type", "menu");
    arrow.setAttribute("label", "▾");
    arrow.setAttribute("orient", "horizontal");

    const arrowLabel = doc.createXULElement("label");
    arrowLabel.id = PICKER_ID + "-arrow-label";
    arrowLabel.setAttribute("value", "▾");
    arrow.appendChild(arrowLabel);

    // Popup menu
    const popup = doc.createXULElement("menupopup");
    popup.id = PICKER_MENU_ID;

    picker.appendChild(openButton);
    picker.appendChild(arrow);
    arrow.appendChild(popup);

    // State: which workspace is targeted
    let targetWorkspaceId = getInitialTargetWorkspaceId(win, mainWin);

    const applyWorkspaceTheme = (wsId) => {
      try {
        const root = doc.documentElement;
        setCssVar(root, "--little-zen-window-background", "");
        setCssVar(root, "--little-zen-window-toolbar-background", "");
        picker.setAttribute("zen-workspace-id", wsId ?? "");
      } catch (e) {}
    };

    const updateLabel = () => {
      const ws = getWorkspaceById(mainWin, targetWorkspaceId);
      const name = ws?.name ?? "Space";
      const icon = ws?.icon && !ws.icon.endsWith(".svg") ? ws.icon + "  " : "";
      const label = `Open in ${icon}${name}`;
      openButton.setAttribute("label", label);
      openButton.setAttribute("shortcut", getOpenShortcutDisplay());
      openButtonLabel.setAttribute("value", label);
      openButton.setAttribute("tooltiptext", `Open in ${name}`);
      arrow.setAttribute("tooltiptext", name);
      applyWorkspaceTheme(targetWorkspaceId);
    };

    const refreshRouteTarget = () => {
      const routedWorkspaceId = getInitialTargetWorkspaceId(win, mainWin);
      if (routedWorkspaceId && routedWorkspaceId !== targetWorkspaceId) {
        targetWorkspaceId = routedWorkspaceId;
        updateLabel();
      }
    };

    const openMenu = () => {
      const workspaces = getWorkspaces(mainWin);
      while (popup.firstChild) popup.removeChild(popup.firstChild);
      popup.classList.add("zen-little-window-space-menu");

      const searchRow = doc.createXULElement("hbox");
      searchRow.className = "zen-little-window-space-menu-search-row";
      searchRow.setAttribute("align", "center");

      const searchIcon = doc.createXULElement("image");
      searchIcon.className = "zen-little-window-space-menu-search-icon";
      searchRow.appendChild(searchIcon);

      const searchInput = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "input"
      );
      searchInput.id = PICKER_MENU_ID + "-search";
      searchInput.className = "zen-little-window-space-menu-search";
      searchInput.setAttribute("type", "search");
      searchInput.setAttribute("placeholder", "Search spaces");
      searchInput.setAttribute("autocomplete", "off");
      searchRow.appendChild(searchInput);
      popup.appendChild(searchRow);

      const noResults = doc.createXULElement("label");
      noResults.className = "zen-little-window-space-menu-no-results";
      noResults.setAttribute("value", "No spaces found");
      noResults.hidden = true;
      popup.appendChild(noResults);

      const selectWorkspace = (ws) => {
        targetWorkspaceId = ws.uuid;
        updateLabel();
        try {
          popup.hidePopup();
        } catch (error) {}
      };

      const rows = [];
      workspaces.forEach(ws => {
        const item = doc.createXULElement("menuitem");
        item.className = "zen-workspace-context-menu-item zen-little-window-space-menu-item";
        item.__littleZenWorkspace = ws;
        item.setAttribute("zen-workspace-id", ws.uuid);
        const icon = getWorkspaceDisplayIcon(ws);
        const iconIsSvg = !!icon && icon.endsWith(".svg");
        if (iconIsSvg) {
          item.setAttribute("image", icon);
          item.classList.add("menuitem-iconic", "zen-workspace-context-icon");
          item.setAttribute("label", ws.name);
        } else {
          item.setAttribute("label", `${icon}  ${ws.name}`);
        }
        item.setAttribute("data-label", `${ws.name ?? ""} ${icon ?? ""}`.toLowerCase());
        if (ws.uuid === targetWorkspaceId) {
          item.setAttribute("selected", "true");
        }
        item.addEventListener("command", () => {
          selectWorkspace(ws);
        });
        rows.push(item);
        popup.appendChild(item);
      });

      const visibleRows = () => rows.filter(item => !item.hidden);
      const setSelectedRow = (row) => {
        rows.forEach(item => item.removeAttribute("selected"));
        row?.setAttribute("selected", "true");
        row?.scrollIntoView?.({ block: "nearest" });
      };
      const filterRows = () => {
        const query = searchInput.value.toLowerCase().trim();
        let shown = 0;
        for (const item of rows) {
          const matches = !query || item.getAttribute("data-label").includes(query);
          item.hidden = !matches;
          if (matches) {
            shown++;
          }
        }
        noResults.hidden = shown > 0;
        if (!visibleRows().some(item => item.hasAttribute("selected"))) {
          setSelectedRow(visibleRows()[0]);
        }
      };
      const moveSelection = (direction) => {
        const visible = visibleRows();
        if (!visible.length) {
          return;
        }
        const currentIndex = Math.max(
          0,
          visible.findIndex(item => item.hasAttribute("selected"))
        );
        setSelectedRow(visible[(currentIndex + direction + visible.length) % visible.length]);
      };
      const acceptSelection = () => {
        const selected = visibleRows().find(item => item.hasAttribute("selected"));
        if (selected?.__littleZenWorkspace) {
          selectWorkspace(selected.__littleZenWorkspace);
        }
      };
      const stopSearchEvent = (event) => {
        if (event.target === searchInput || searchRow.contains(event.target)) {
          if (event.type === "keydown") {
            if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
              event.preventDefault();
              event.stopPropagation();
              moveSelection(1);
              return;
            }
            if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
              event.preventDefault();
              event.stopPropagation();
              moveSelection(-1);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              acceptSelection();
              return;
            }
          }
          event.stopPropagation();
        }
      };

      for (const eventName of [
        "keydown",
        "keypress",
        "keyup",
        "mousedown",
        "mouseup",
        "click",
      ]) {
        popup.addEventListener(eventName, stopSearchEvent, true);
      }
      searchInput.addEventListener("input", filterRows);
      popup.addEventListener(
        "popupshown",
        () => {
          searchInput.focus();
          searchInput.select();
        },
        { once: true }
      );
      popup.openPopup(picker, "after_start", 0, 0, false, false);
    };

    const openSelectedWorkspace = () => {
      transferTabToWorkspace(win, targetWorkspaceId);
    };

    openButton.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      openSelectedWorkspace();
    });

    openButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    arrow.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu();
    });

    arrow.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // Ctrl/Cmd+O shortcut
    win.addEventListener("keydown", (e) => {
      if (
        !e.defaultPrevented &&
        !e.repeat &&
        (AppConstants.platform === "macosx" ? e.metaKey : e.ctrlKey) &&
        e.key?.toLowerCase() === "o"
      ) {
        e.preventDefault();
        e.stopPropagation();
        openSelectedWorkspace();
      }
    }, true);

    // Keep label in sync when main window changes workspace
    try {
      mainWin.addEventListener("ZenWorkspaceChanged", () => {
        const routedOrActiveId = getInitialTargetWorkspaceId(win, mainWin);
        if (routedOrActiveId) {
          log("Little Zen picker target refreshed after workspace change", {
            routedOrActiveId,
            activeWorkspaceId: getActiveWorkspaceId(mainWin),
            routeUrl: getLittleWindowRouteUrl(win),
          });
          targetWorkspaceId = routedOrActiveId;
          updateLabel();
        }
      });
    } catch (e) {}

    updateLabel();
    win.__littleZenRefreshSpacePickerTarget = refreshRouteTarget;
    win.setTimeout(refreshRouteTarget, 150);
    win.setTimeout(refreshRouteTarget, 750);

    // Insert into .customizableui-special-spring2 (right-side nav-bar spring)
    const spring2 = doc.querySelector(".customizableui-special-spring2");
    if (spring2) {
      spring2.appendChild(picker);
      log("Injected space picker into .customizableui-special-spring2");
    } else {
      // Fallback: right end of nav-bar
      const navBar = doc.getElementById("nav-bar") || doc.getElementById("urlbar-container");
      if (navBar) {
        navBar.appendChild(picker);
        log("Injected space picker into nav-bar (fallback)");
      }
    }

    // Popup stays inside picker — moving it to popupSet breaks single-click command events
  }

  function ensureSpacePicker(win) {
    if (!isLittleWindow(win) || win.document.getElementById(PICKER_ID)) {
      return;
    }
    const mainWin = getMainBrowserWindow(win);
    if (!mainWin?.gZenWorkspaces) {
      // Retry until workspaces are ready
      win.setTimeout(() => ensureSpacePicker(win), 500);
      return;
    }
    buildSpacePicker(win);
  }

  // ── End Workspace Picker ─────────────────────────────────────────────────────

  function attachAutoClose(win) {
    if (win[PATCH_FLAGS.autoClose]) {
      return;
    }

    const urlbar = win.gURLBar;
    let resizeObserver = null;

    const onOpened = () => {
      releaseLittleWindowPresentation(win, "floating-urlbar-opened");
      centerWindow(win);

      try {
        win.focus();
        urlbar?.focus();
        urlbar?.inputField?.focus();
        scheduleLittleWindowUrlbarPositionCheck(win, "floating-urlbar-opened");
      } catch (error) {
        log("Could not focus the opened Little Zen urlbar.", error);
      }

      logLittleWindowState(win, "Little Zen floating urlbar opened");
    };

    const onUnload = () => {
      cleanupLittleWindowLifecycle(win, "unload");
    };

    const cleanup = reason => {
      if (win.__littleZenLifecycleCleanup !== cleanup) {
        return;
      }

      delete win.__littleZenLifecycleCleanup;
      try {
        resizeObserver?.disconnect();
      } catch (error) {}
      resizeObserver = null;
      try {
        win.removeEventListener("ZenFloatingURLBarOpened", onOpened);
        win.removeEventListener("ZenURLBarClosed", onClosed);
        win.removeEventListener("unload", onUnload);
      } catch (error) {}
      releaseLittleWindowPresentation(win, `cleanup:${reason}`);
      logLittleWindowState(win, "Cleaned up Little Zen lifecycle", { reason });
    };

    const onClosed = event => {
      cleanup("urlbar-closed");

      if (win.closed) {
        return;
      }

      if (!event.detail?.onElementPicked && !win.__littleZenPendingURL) {
        logLittleWindowState(win, "Closing empty Little Zen window after urlbar close");
        win.close();
        return;
      }

      expandLittleWindow(
        win,
        event.detail?.onElementPicked ? "urlbar-picked" : "urlbar-closed"
      );
    };

    if (urlbar && typeof win.ResizeObserver === "function") {
      resizeObserver = new win.ResizeObserver(entries => {
        if (win.closed || !isEmptyLittleWindow(win)) {
          return;
        }

        for (const entry of entries) {
          if (entry.target !== urlbar) {
            continue;
          }

          const { width, height } = entry.target.getBoundingClientRect();
          if (!width || !height) {
            continue;
          }

          try {
            win.resizeTo(Math.ceil(width), Math.ceil(Math.max(height, 40)));
            logLittleWindowState(win, "Resized Little Zen window to urlbar bounds", {
              width: Math.ceil(width),
              height: Math.ceil(Math.max(height, 40)),
            });
          } catch (error) {
            log("Could not resize the Little Zen window to match the urlbar.", error);
          }
        }
      });
      resizeObserver.observe(urlbar);
    }

    win.document.documentElement.setAttribute(LITTLE_WINDOW_ATTR, "true");
    win.document.documentElement.toggleAttribute("zen-no-padding", isEmptyLittleWindow(win));
    win.__littleZenLifecycleCleanup = cleanup;

    setWindowResizable(win, false);
    try {
      win.resizeTo(URLBAR_WIDTH, URLBAR_HEIGHT);
      win.focus();
      scheduleLittleWindowUrlbarPositionCheck(win, "attach-auto-close");
    } catch (error) {
      log("Could not size the little window.", error);
    }

    win.addEventListener("ZenFloatingURLBarOpened", onOpened, { once: true });
    win.addEventListener("ZenURLBarClosed", onClosed, { once: true });
    win.addEventListener("unload", onUnload, { once: true });
    win.gZenWorkspaces?.promiseInitialized?.finally?.(() => {
      releaseLittleWindowPresentation(win, "workspaces-ready");
    });
    win[PATCH_FLAGS.autoClose] = true;
    log("Attached Little Zen lifecycle listeners");
  }

  function applyLittleWindowMode(win) {
    if (!isBrowserWindow(win)) {
      return;
    }

    win.document.documentElement.setAttribute(LITTLE_WINDOW_ATTR, "true");
    patchCompactModeManager(win);
    patchVerticalTabsManager(win);
    patchZenUIManager(win);
    patchUrlbar(win);
    attachEmptyTabStateTracking(win);
    attachTransparentBrowserPrefSync(win);
    attachLittleWindowCloseButtonGuard(win);
    syncLittleWindowTransparentBrowsers(win);
    ensureLittleWindowLoadingPulse(win);
    syncEmptyTabState(win, "apply-mode");
    updateLittleZenBlendedTheme(win, "apply-mode");
    refreshLittleWindowLayout(win);
    attachAutoClose(win);
    if (win.__littleZenPendingURL) {
      schedulePendingNavigationFlush(win, "apply-mode");
    } else if (!win.__littleZenSuppressUrlbarFocus) {
      focusUrlbar(win);
      scheduleLittleWindowUrlbarPositionCheck(win, "apply-mode");
    }
    ensureSpacePicker(win);
    logLittleWindowState(win, "Applied Little Zen mode");
  }

  function whenStartupReady(win, callback) {
    if (win.gBrowserInit?.delayedStartupFinished) {
      callback();
      return;
    }

    const observer = new win.MutationObserver(() => {
      if (!win.gBrowserInit?.delayedStartupFinished) {
        return;
      }
      observer.disconnect();
      callback();
    });

    observer.observe(win.document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    win.addEventListener(
      "unload",
      () => {
        try {
          observer.disconnect();
        } catch (error) {}
      },
      { once: true }
    );
  }

  function ensureCommand(win) {
    if (win.document.getElementById(COMMAND_ID)) {
      return;
    }

    const commandSet =
      win.document.getElementById("zenCommandSet") ||
      win.document.getElementById("mainCommandSet");
    if (!commandSet) {
      return;
    }

    const command = win.document.createXULElement("command");
    command.id = COMMAND_ID;
    command.addEventListener("command", () => {
      LittleZen.openLittleWindow(win);
    });
    commandSet.appendChild(command);
    log("Injected cmd_zenNewLittleWindow command");
  }

  function ensureFallbackShortcut(win) {
    if (win[PATCH_FLAGS.keyListener]) {
      return;
    }

    const isAccelPressed = event =>
      AppConstants.platform === "macosx" ? event.metaKey : event.ctrlKey;

    const onKeyDown = event => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.shiftKey ||
        event.getModifierState("AltGraph") ||
        !event.altKey ||
        !isAccelPressed(event) ||
        event.key?.toLowerCase() !== "n"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      LittleZen.openLittleWindow(win);
    };

    win.addEventListener("keydown", onKeyDown, true);
    win[PATCH_FLAGS.keyListener] = true;
    log("Attached fallback Little Zen shortcut listener");
  }

  const LittleZen = {
    queueNavigation(win, url, meta = {}) {
      if (!url) {
        delete win.__littleZenSuppressUrlbarFocus;
        return;
      }

      win.__littleZenSuppressUrlbarFocus = true;
      setLittleWindowLoading(win, true, "queue-navigation");
      closeLittleWindowUrlbar(win, "queue-navigation");
      win.__littleZenPendingURL = url;
      win.__littleZenRoutedURL = url;
      win.__littleZenPendingURLMeta = meta;
      log("Queued Little Zen navigation", {
        url,
        source: meta.source ?? "unknown",
      });
      try {
        win.__littleZenRefreshSpacePickerTarget?.();
      } catch (error) {
        log("Could not refresh Little Zen routed workspace target", error);
      }

      if (win.gBrowserInit?.delayedStartupFinished) {
        schedulePendingNavigationFlush(win, "queue-navigation-ready");
        return;
      }

      logLittleWindowState(win, "Little Zen navigation waiting for delayed startup", {
        url,
        source: meta.source ?? "unknown",
      });

      whenStartupReady(win, () => {
        logLittleWindowState(
          win,
          "Little Zen navigation callback reached delayed startup",
          {
            url,
            source: meta.source ?? "unknown",
          }
        );
        schedulePendingNavigationFlush(win, "queue-navigation-startup");
      });
    },

    openLittleWindow(opener = window, options = {}) {
      const { url = null, source = "manual", triggeringPrincipal = null } = options;
      log("Little Zen open request", {
        source,
        url,
      });

      for (const browserWindow of browserWindows()) {
        if (isEmptyLittleWindow(browserWindow)) {
          log("Reusing existing empty Little Zen window");
          this.queueNavigation(browserWindow, url, { source, triggeringPrincipal });
          browserWindow.focus();
          if (!url) {
            delete browserWindow.__littleZenSuppressUrlbarFocus;
            focusUrlbar(browserWindow);
          }
          return browserWindow;
        }
      }

      if (typeof opener?.OpenBrowserWindow !== "function") {
        log("Cannot open Little Zen; OpenBrowserWindow missing");
        return null;
      }

      const littleWindow = opener.OpenBrowserWindow({
        zenLittleWindow: true,
        all: false,
        features: OPEN_FEATURES,
      });

      if (littleWindow) {
        this.queueNavigation(littleWindow, url, { source, triggeringPrincipal });
        littleWindow.focus();
      }

      return littleWindow;
    },
  };

  function bootstrapWindow(win) {
    if (!isBrowserWindow(win) || win[PATCH_FLAGS.window]) {
      return;
    }

    win[PATCH_FLAGS.window] = true;
    win.LittleZen = LittleZen;

    patchBrowserWindowTracker();
    patchUriLoadingHelper();
    patchBrowserDOMWindow(win);
    patchOpenBrowserWindow(win);
    ensureFallbackShortcut(win);
    ensureCommand(win);

    // Intercept window.gZenUIManager assignment so the motion stub is installed
    // the instant Zen sets it — regardless of when that happens relative to our
    // script. ZenStartup creates gZenUIManager inside a setTimeout(..., 0) after
    // MozBeforeInitialXULLayout, so polling/event listeners are too late.
    if (!win.gZenUIManager && !win.__littleZenUIManagerIntercepted) {
      win.__littleZenUIManagerIntercepted = true;
      let _uiManager = undefined;
      Object.defineProperty(win, "gZenUIManager", {
        configurable: true,
        enumerable: true,
        get() { return _uiManager; },
        set(v) {
          _uiManager = v;
          // Restore normal property so future reads/writes are direct
          Object.defineProperty(win, "gZenUIManager", {
            configurable: true,
            enumerable: true,
            writable: true,
            value: v,
          });
          // Install the motion stub immediately
          patchZenUIManager(win);
        },
      });
    } else if (win.gZenUIManager) {
      patchZenUIManager(win);
    }

    // Block mods that crash in the little window by intercepting gZenThemePicker.
    // BetterZenGradientPicker checks for this before initializing; keeping it
    // undefined in little windows prevents it from running where it has no panel.
    if (isLittleWindow(win) && !win.__littleZenThemePickerBlocked) {
      win.__littleZenThemePickerBlocked = true;
      if (!win.gZenThemePicker) {
        Object.defineProperty(win, "gZenThemePicker", {
          configurable: true,
          enumerable: true,
          get() { return undefined; },
          set(v) {
            // Silently swallow — theme picker has no panel in little windows
            Object.defineProperty(win, "gZenThemePicker", {
              configurable: true, enumerable: true, writable: true, value: undefined,
            });
          },
        });
      }
    }

    if (isLittleWindow(win)) {
      applyLittleWindowMode(win);
    }

    whenStartupReady(win, () => {
      log("Little Zen delayed startup reached");
      patchBrowserDOMWindow(win);
      ensureCommand(win);
      patchOpenBrowserWindow(win);
      patchCompactModeManager(win);
      patchVerticalTabsManager(win);
      patchZenUIManager(win);
      patchUrlbar(win);

      if (isLittleWindow(win)) {
        applyLittleWindowMode(win);
        if (win.__littleZenPendingURL) {
          schedulePendingNavigationFlush(win, "bootstrap-delayed-startup");
        }
      }
    });
  }

  bootstrapWindow(window);
  log("Little Zen runtime backport loaded.");
})();
