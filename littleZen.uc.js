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

    urlbar[PATCH_FLAGS.urlbar] = true;
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

    const sync = event => {
      if (!isLittleWindow(win)) {
        return;
      }

      syncEmptyTabState(win, event?.type ?? "manual");
      if (win.__littleZenPendingURL && win.gBrowserInit?.delayedStartupFinished) {
        flushPendingNavigation(win, `state-tracker:${event?.type ?? "manual"}`);
      }
    };

    win.addEventListener("TabAttrModified", sync, true);
    win.addEventListener("TabSelect", sync, true);
    win.addEventListener("TabOpen", sync, true);
    win.addEventListener("TabClose", sync, true);
    win[PATCH_FLAGS.emptyState] = true;
    log("Attached Little Zen empty-tab state tracking");
  }

  function refreshLittleWindowLayout(win) {
    const root = win.document.documentElement;
    root.setAttribute(LITTLE_WINDOW_ATTR, "true");
    root.setAttribute("zen-no-padding", "true");

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
      return true;
    } catch (error) {
      log("Could not open the Little Zen urlbar.", error);
    }

    return false;
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

    const selectedBrowser = win.gBrowser?.selectedBrowser;
    if (!selectedBrowser) {
      logLittleWindowState(win, "Little Zen pending URL waiting for selected browser", {
        reason,
        url: pendingUrl,
      });
      return false;
    }

    const pendingMeta = win.__littleZenPendingURLMeta ?? {};
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
      const loadFlags =
        Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP ??
        Ci.nsIWebNavigation.LOAD_FLAGS_NONE;

      selectedBrowser.fixupAndLoadURIString(pendingUrl, {
        triggeringPrincipal: principal,
        loadFlags,
      });

      win.setTimeout(() => {
        expandLittleWindow(win, `pending-navigation:${reason}`);
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
    if (!isEmptyLittleWindow(win)) {
      return;
    }

    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => {
        const urlbar = win.gURLBar;
        if (!urlbar || !isEmptyLittleWindow(win)) {
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
          return;
        }

        try {
          urlbar.focus();
          urlbar.select();
          urlbar.inputField?.focus();
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
    const doFallback = () => {
      if (!url) {
        mainWin.focus();
        win.close();
        return;
      }
      try {
        const newTab = mainWin.gBrowser.addTab(url, {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          skipAnimation: true,
        });
        if (newTab) {
          newTab.setAttribute("zen-workspace-id", workspaceId);
        }
        mainWin.gBrowser.selectedTab = newTab;
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
      // 1. Switch the main window to the target workspace first
      await mainWin.gZenWorkspaces?.changeWorkspace?.(workspace);

      // 2. Open an about:blank tab as the destination — no navigation yet
      const destTab = mainWin.gBrowser.addTab("about:blank", {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        skipAnimation: true,
      });
      if (!destTab) {
        return doFallback();
      }
      destTab.setAttribute("zen-workspace-id", workspaceId);

      const destBrowser = destTab.linkedBrowser;

      // 3. Wait for the destination browser frame to be ready
      await new Promise(resolve => {
        let attempts = 0;
        const check = () => {
          if (destBrowser.webNavigation || ++attempts >= 30) {
            resolve();
          } else {
            win.setTimeout(check, 50);
          }
        };
        check();
      });

      // 4. Stop any pending load so swapDocShells doesn't race
      try { destBrowser.stop(); } catch (e) {}

      // 5. Match the remote process type of our source browser (Fission compat)
      try {
        const remoteType = ourBrowser.remoteType;
        if (remoteType && destBrowser.remoteType !== remoteType) {
          await mainWin.gBrowser.updateBrowserRemoteness(destBrowser, { remoteType });
        }
      } catch (e) {
        log("transferTabToWorkspace: could not match remoteness, continuing", e);
      }

      // 6. Atomically move the live docShell — session history, scroll, forms, all of it
      destBrowser.swapDocShells(ourBrowser);

      // 6b. Load about:blank into the now-empty source browser so Zen's tab
      //     close path doesn't walk a detached DOM and throw on parentElement.
      try {
        ourBrowser.loadURI(Services.io.newURI("about:blank"), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      } catch (e) {
        try {
          ourBrowser.fixupAndLoadURIString("about:blank", {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        } catch (_) {}
      }

      // 7. Sync tab metadata
      try {
        const title = destBrowser.contentTitle;
        if (title) {
          destTab.label = title;
          mainWin.gBrowser._tabAttrModified?.(destTab, ["label"]);
        }
      } catch (e) {}

      try { mainWin.gZenWorkspaces?.updateTabsContainers?.(); } catch (e) {}

      mainWin.gBrowser.selectedTab = destTab;
      mainWin.focus();

      log("transferTabToWorkspace: swapDocShells succeeded");
      win.setTimeout(() => win.close(), 50);

    } catch (err) {
      log("transferTabToWorkspace: swapDocShells failed, falling back", err);
      doFallback();
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

    // Container button
    const picker = doc.createXULElement("hbox");
    picker.id = PICKER_ID;
    picker.setAttribute("align", "center");

    // Space name label (click = live transfer)
    const label = doc.createXULElement("label");
    label.id = PICKER_ID + "-label";
    label.setAttribute("crop", "end");
    label.setAttribute("flex", "1");

    // Dropdown arrow (click = open menu)
    const arrow = doc.createXULElement("label");
    arrow.id = PICKER_ID + "-arrow";
    arrow.setAttribute("value", "▾");

    // Popup menu
    const popup = doc.createXULElement("menupopup");
    popup.id = PICKER_MENU_ID;

    picker.appendChild(label);
    picker.appendChild(arrow);
    // Keep popup inside picker so XUL command events fire on single click
    picker.appendChild(popup);

    // State: which workspace is targeted
    let targetWorkspaceId = getActiveWorkspaceId(mainWin);

    const applyWorkspaceTheme = (wsId) => {
      try {
        const ws = getWorkspaceById(mainWin, wsId);
        const color = ws?.color ?? null;
        const root = doc.documentElement;
        if (color) {
          root.style.setProperty("--zen-primary-color", color);
        } else {
          // Fall back to the main window's current --zen-primary-color
          const mainColor = mainWin.document.documentElement.style
            .getPropertyValue("--zen-primary-color");
          if (mainColor) {
            root.style.setProperty("--zen-primary-color", mainColor);
          } else {
            root.style.removeProperty("--zen-primary-color");
          }
        }
      } catch (e) {}
    };

    const updateLabel = () => {
      const ws = getWorkspaceById(mainWin, targetWorkspaceId);
      const name = ws?.name ?? "Space";
      const icon = ws?.icon && !ws.icon.endsWith(".svg") ? ws.icon + "  " : "";
      label.setAttribute("value", icon + name);
      label.setAttribute("tooltiptext", name);
      applyWorkspaceTheme(targetWorkspaceId);
    };

    const openMenu = () => {
      const workspaces = getWorkspaces(mainWin);
      while (popup.firstChild) popup.removeChild(popup.firstChild);
      workspaces.forEach(ws => {
        const item = doc.createXULElement("menuitem");
        const icon = ws.icon && !ws.icon.endsWith(".svg") ? ws.icon + "  " : "";
        item.setAttribute("label", icon + ws.name);
        item.setAttribute("type", "radio");
        if (ws.uuid === targetWorkspaceId) {
          item.setAttribute("checked", "true");
        }
        item.addEventListener("command", () => {
          targetWorkspaceId = ws.uuid;
          updateLabel();
        });        popup.appendChild(item);
      });
      popup.openPopup(picker, "after_start", 0, 0, false, false);
    };

    label.addEventListener("click", () => {
      transferTabToWorkspace(win, targetWorkspaceId);
    });

    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu();
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
        transferTabToWorkspace(win, targetWorkspaceId);
      }
    }, true);

    // Keep label in sync when main window changes workspace
    try {
      mainWin.addEventListener("ZenWorkspaceChanged", () => {
        const newId = getActiveWorkspaceId(mainWin);
        if (newId) {
          targetWorkspaceId = newId;
          updateLabel();
        }
      });
    } catch (e) {}

    updateLabel();

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
    win.document.documentElement.setAttribute("zen-no-padding", "true");
    win.__littleZenLifecycleCleanup = cleanup;

    setWindowResizable(win, false);
    try {
      win.resizeTo(URLBAR_WIDTH, URLBAR_HEIGHT);
      win.focus();
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
    syncEmptyTabState(win, "apply-mode");
    refreshLittleWindowLayout(win);
    attachAutoClose(win);
    if (win.__littleZenPendingURL) {
      schedulePendingNavigationFlush(win, "apply-mode");
    } else {
      focusUrlbar(win);
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
        return;
      }

      win.__littleZenPendingURL = url;
      win.__littleZenPendingURLMeta = meta;
      log("Queued Little Zen navigation", {
        url,
        source: meta.source ?? "unknown",
      });

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
