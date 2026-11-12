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
  const LITTLE_ZEN_XHTML_NS = "http://www.w3.org/1999/xhtml";
  const LITTLE_ZEN_SAMPLE_BAND = 24;
  const LITTLE_ZEN_SAMPLE_SCALE = 0.5;
  const LITTLE_ZEN_FULL_VIEW_SCALE = 0.125;
  const LITTLE_ZEN_MIN_COLOR_SHARE = 0.6;
  const LITTLE_ZEN_SAME_COLOR_DISTANCE = 10;
  const LITTLE_ZEN_CHECK_DISTANCE = 24;
  const LITTLE_ZEN_UNSURE_RECHECK_MS = 200;
  const LITTLE_ZEN_SCROLL_SAMPLE_MS = 50;
  const LITTLE_ZEN_SITE_COLORS_PREF = "extensions.littleZen.siteColors";
  const LITTLE_ZEN_BRIGHT_CONTROL_LUMINANCE = 0.78;
  const LITTLE_ZEN_ROUTING_DEBUG_PREF = "extensions.littleZen.debugRouting";
  const LITTLE_ZEN_WINDOW_CONTROLS_LEFT_PREF =
    "zen.view.experimental-force-window-controls-left";
  const LITTLE_ZEN_STALLED_LOAD_TIMEOUT_MS = 25000;

  const PATCH_FLAGS = {
    browserDOMWindow: "__littleZenBrowserDOMWindowPatched",
    openBrowserWindow: "__littleZenOpenBrowserWindowPatched",
    compactMode: "__littleZenCompactModePatched",
    verticalTabs: "__littleZenVerticalTabsPatched",
    zenUIManager: "__littleZenZenUIManagerPatched",
    urlbar: "__littleZenUrlbarPatched",
    urlbarDisableGuard: "__littleZenUrlbarDisableGuardAttached",
    emptyState: "__littleZenEmptyStatePatched",
    autoClose: "__littleZenAutoCloseAttached",
    doubleEscapeClose: "__littleZenDoubleEscapeCloseAttached",
    keyListener: "__littleZenKeyListenerAttached",
    tabClickListener: "__littleZenTabClickListenerAttached",
    contentLinkListener: "__littleZenContentLinkListenerAttached",
    siteColor: "__littleZenSiteColorWatchersAttached",
    window: "__littleZenBootstrapped",
  };
  const littleZenThemeCache = new Map();
  let littleZenSiteColors = null;
  let littleZenSiteColorsSaveTimer = null;

  // Keep pinned actions beside the sidebar URL bar until the bar is full.
  const overflowThresholdPrefs = Services.prefs.getDefaultBranch("");
  if (
    overflowThresholdPrefs.getIntPref(
      "zen.view.overflow-webext-toolbar-threshold",
      55
    ) < 100
  ) {
    overflowThresholdPrefs.setIntPref(
      "zen.view.overflow-webext-toolbar-threshold",
      100
    );
  }

  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs"
  );
  const { NetUtil } = ChromeUtils.importESModule(
    "resource://gre/modules/NetUtil.sys.mjs"
  );
  const { ClickHandlerParent } = ChromeUtils.importESModule(
    "resource:///actors/ClickHandlerParent.sys.mjs"
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
    if (typeof arg?.message === "string") {
      return `${arg.name ?? "Error"}: ${arg.message}`;
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
    try {
      const file = Services.dirsvc.get("ProfD", Ci.nsIFile);
      file.append("little-zen-debug.log");
      const stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
        Ci.nsIFileOutputStream
      );
      stream.init(file, 0x1a, 0o600, 0);
      const converter = Cc[
        "@mozilla.org/intl/converter-output-stream;1"
      ].createInstance(Ci.nsIConverterOutputStream);
      converter.init(stream, "UTF-8");
      converter.writeString(`${new Date().toISOString()} ${message}\n`);
      converter.close();
    } catch (error) {}
  }

  function isRoutingDebugEnabled() {
    try {
      return Services.prefs.getBoolPref(LITTLE_ZEN_ROUTING_DEBUG_PREF, false);
    } catch (error) {
      return false;
    }
  }

  function routeLog(...args) {
    if (isRoutingDebugEnabled()) {
      log(...args);
    }
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

  function matchMediaTrue(win, query) {
    try {
      return !!win.matchMedia?.(query)?.matches;
    } catch (error) {
      return false;
    }
  }

  function usesLeftWindowControls(win) {
    if (AppConstants.platform === "macosx") {
      return true;
    }

    try {
      if (Services.prefs.getBoolPref(LITTLE_ZEN_WINDOW_CONTROLS_LEFT_PREF, false)) {
        return true;
      }
    } catch (error) {}

    return matchMediaTrue(win, "(-moz-gtk-csd-reversed-placement)");
  }

  function syncLittleWindowControlSide(win) {
    const root = win?.document?.documentElement;
    if (!root) {
      return false;
    }

    const left = usesLeftWindowControls(win);
    if (left) {
      root.setAttribute("zen-window-buttons-reversed", "true");
    } else {
      root.removeAttribute("zen-window-buttons-reversed");
    }
    return left;
  }

  function getLittleWindowButtons(win) {
    try {
      const actual = win.gZenVerticalTabsManager?.actualWindowButtons;
      if (actual?.isConnected) {
        return actual;
      }
    } catch (error) {}

    return (
      win.document.querySelector("#nav-bar .titlebar-buttonbox-container") ||
      win.document.querySelector(".titlebar-buttonbox-container")
    );
  }

  function isEmptyLittleWindow(win) {
    return isLittleWindow(win) && !!win.gBrowser?.selectedTab?.hasAttribute("zen-empty-tab");
  }

  function usesEmptyLittleWindowPresentation(win) {
    return isEmptyLittleWindow(win) && !win.__littleZenStartExpanded;
  }

  function isExternalOpenContext(context) {
    return (
      context === Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL ||
      (typeof context === "number" &&
        !!(context & Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL))
    );
  }

  function isAutomaticDownloadURL(uriOrSpec) {
    let uri = uriOrSpec;
    if (!uri) {
      return false;
    }
    if (typeof uriOrSpec === "string") {
      try {
        uri = Services.io.newURI(uriOrSpec);
      } catch (error) {
        return false;
      }
    }

    let decoded = uri.spec ?? "";
    try {
      decoded = decodeURIComponent(decoded);
    } catch (error) {}
    if (/content-disposition\s*=\s*attachment/i.test(decoded)) {
      return true;
    }

    let extension = "";
    try {
      extension = uri.QueryInterface(Ci.nsIURL).fileExtension.toLowerCase();
    } catch (error) {
      return false;
    }
    if (!extension) {
      return false;
    }

    // Server-rendered pages often use these suffixes even though Firefox
    // would not treat the extension as something it can display.
    if (
      new Set([
        "html",
        "htm",
        "xhtml",
        "shtml",
        "php",
        "phtml",
        "asp",
        "aspx",
        "jsp",
        "jspx",
        "cgi",
        "cfm",
      ]).has(extension)
    ) {
      return false;
    }

    try {
      const mimeService = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
      const type = mimeService.getTypeFromExtension(extension);
      if (
        !type ||
        type === "text/html" ||
        type === "application/xhtml+xml" ||
        type === "text/plain" ||
        type === "application/pdf" ||
        type.startsWith("image/") ||
        type.startsWith("video/") ||
        type.startsWith("audio/")
      ) {
        return false;
      }

      const info = mimeService.getFromTypeAndExtension(type, extension);
      const action = info?.preferredAction;
      return (
        action === Ci.nsIHandlerInfo.saveToDisk ||
        action === Ci.nsIHandlerInfo.useHelperApp ||
        action === Ci.nsIHandlerInfo.useSystemDefault ||
        (action === Ci.nsIHandlerInfo.alwaysAsk && !!info.alwaysAskBeforeHandling)
      );
    } catch (error) {
      return false;
    }
  }

  function shouldOpenExternalLinkInLittleZen(url) {
    if (!url || isAutomaticDownloadURL(url)) {
      if (url) {
        log("Skipping Little Zen for a download link", { url });
      }
      return false;
    }
    return true;
  }

  function responseIsDirectDownload(channel) {
    let disposition = Ci.nsIChannel.DISPOSITION_INLINE;
    try {
      disposition = channel.contentDisposition;
    } catch (error) {}
    if (disposition === Ci.nsIChannel.DISPOSITION_ATTACHMENT) {
      return true;
    }

    let type = "";
    try {
      type = String(channel.contentType || "").split(";")[0].trim().toLowerCase();
    } catch (error) {}
    if (!type) {
      return false;
    }
    if (
      type === "text/html" ||
      type === "application/xhtml+xml" ||
      type === "text/plain" ||
      type === "application/pdf" ||
      type === "application/json" ||
      type === "text/xml" ||
      type === "application/xml" ||
      type.startsWith("image/") ||
      type.startsWith("video/") ||
      type.startsWith("audio/")
    ) {
      return false;
    }
    if (type === "application/octet-stream") {
      return true;
    }

    try {
      const mimeService = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
      const info = mimeService.getFromTypeAndExtension(type, "");
      const action = info?.preferredAction;
      return (
        action === Ci.nsIHandlerInfo.saveToDisk ||
        action === Ci.nsIHandlerInfo.useHelperApp ||
        action === Ci.nsIHandlerInfo.useSystemDefault ||
        (action === Ci.nsIHandlerInfo.alwaysAsk && !!info.alwaysAskBeforeHandling)
      );
    } catch (error) {
      return false;
    }
  }

  function probeDirectDownload(url) {
    return new Promise(resolve => {
      let settled = false;
      let channel = null;
      let timer = null;
      const finish = isDownload => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          timer?.cancel();
        } catch (error) {}
        try {
          channel?.cancel(Components.results.NS_BINDING_ABORTED);
        } catch (error) {}
        resolve(!!isDownload);
      };

      timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(
        () => {
          log("Download check timed out; opening Little Zen", { url });
          finish(false);
        },
        4000,
        Ci.nsITimer.TYPE_ONE_SHOT
      );

      try {
        channel = NetUtil.newChannel({
          uri: url,
          loadingPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
          contentPolicyType: Ci.nsIContentPolicy.TYPE_DOCUMENT,
        });
        channel.asyncOpen({
          onStartRequest(request) {
            let isDownload = false;
            try {
              isDownload = responseIsDirectDownload(request);
            } catch (error) {}
            log("Checked external link before opening Little Zen", {
              url,
              isDownload,
            });
            finish(isDownload);
          },
          onDataAvailable(_request, stream, _offset, count) {
            try {
              const binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
                Ci.nsIBinaryInputStream
              );
              binary.setInputStream(stream);
              binary.readBytes(count);
            } catch (error) {}
          },
          onStopRequest() {
            finish(false);
          },
        });
      } catch (error) {
        log("Could not check external link before opening Little Zen", error);
        finish(false);
      }
    });
  }

  function openExternalInLittleZenOrNormal(win, url, openLittleZen, openNormally) {
    if (!shouldOpenExternalLinkInLittleZen(url)) {
      openNormally();
      return;
    }

    probeDirectDownload(url).then(isDownload => {
      if (isDownload) {
        log("Skipping Little Zen after checking the response", { url });
        if (!win.closed) {
          openNormally();
        }
        return;
      }
      if (!win.closed) {
        openLittleZen();
      }
    });
  }

  function urlsMatch(left, right) {
    if (!left || !right) {
      return false;
    }
    try {
      return Services.io.newURI(left).specIgnoringRef === Services.io.newURI(right).specIgnoringRef;
    } catch (error) {
      return left === right;
    }
  }

  function closeLittleWindowsStuckOnDownload(url) {
    for (const win of browserWindows()) {
      if (!isLittleWindow(win) || win.closed) {
        continue;
      }
      const stillLoading = win.document?.documentElement?.hasAttribute(
        "zen-little-window-loading"
      );
      const openedForDownload =
        urlsMatch(win.__littleZenPendingURL, url) ||
        urlsMatch(win.__littleZenRoutedURL, url) ||
        urlsMatch(win.gBrowser?.selectedBrowser?.currentURI?.spec, url);
      if (!stillLoading || !openedForDownload) {
        continue;
      }
      log("Closing Little Zen window stuck on a download", { url });
      win.close();
    }
  }

  function attachDownloadBypass() {
    if (attachDownloadBypass.done) {
      return;
    }
    attachDownloadBypass.done = true;

    let downloadsModule;
    try {
      downloadsModule = ChromeUtils.importESModule(
        "resource://gre/modules/Downloads.sys.mjs"
      );
    } catch (error) {
      log("Could not watch downloads for Little Zen bypass", error);
      return;
    }

    downloadsModule.Downloads.getList(downloadsModule.Downloads.ALL)
      .then(list =>
        list.addView({
          onDownloadAdded(download) {
            closeLittleWindowsStuckOnDownload(download?.source?.url);
          },
        })
      )
      .catch(error => {
        log("Could not watch downloads for Little Zen bypass", error);
      });
  }

  function getLittleWindowState(win) {
    const root = win?.document?.documentElement;
    const tab = win?.gBrowser?.selectedTab;
    const urlbar = win?.gURLBar;

    return {
      littleWindow: isLittleWindow(win),
      startupReady: !!win?.__littleZenStartupReady,
      pendingUrl: win?.__littleZenPendingURL ?? null,
      rootEmpty: !!root?.hasAttribute("zen-has-empty-tab"),
      tabEmpty: !!tab?.hasAttribute("zen-empty-tab"),
      urlbarBreakout: !!urlbar?.hasAttribute("breakout-extend"),
      urlbarOpen: !!urlbar?.view?.isOpen,
      urlbarNewtab: !!urlbar?.hasAttribute("zen-newtab"),
      currentUrl: win?.gBrowser?.selectedBrowser?.currentURI?.spec ?? null,
      compactMode: root?.getAttribute("zen-compact-mode") ?? null,
      singleToolbar: !!root?.hasAttribute("zen-single-toolbar"),
      navbarParent: win?.document?.getElementById("nav-bar")?.parentElement?.id ?? null,
      backButtonParent:
        win?.document?.getElementById("back-button")?.parentElement?.id ?? null,
      urlbarParent:
        win?.document?.getElementById("urlbar-container")?.parentElement?.id ?? null,
    };
  }

  function isExternalStartupWindow(win) {
    try {
      const extraOptions = win.arguments?.[1];
      return (
        extraOptions instanceof Ci.nsIPropertyBag2 &&
        extraOptions.hasKey("fromExternal") &&
        extraOptions.getPropertyAsBool("fromExternal")
      );
    } catch (error) {
      return false;
    }
  }

  function getExternalStartupUrl(win) {
    const argument = win.arguments?.[0];
    if (typeof argument === "string") {
      return argument;
    }
    if (argument?.spec) {
      return argument.spec;
    }
    try {
      return argument?.queryElementAt?.(0, Ci.nsIURI)?.spec ?? null;
    } catch (error) {
      return null;
    }
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

  function markLittleWindowEarly(win, options = {}) {
    if (!win?.document?.documentElement) {
      return;
    }

    win._zenStartupLittleWindow = true;
    win.__littleZenPresentationReleased = false;
    if (options.expanded !== undefined) {
      win.__littleZenStartExpanded = !!options.expanded;
    }
    if (options.url) {
      win.__littleZenStartLoadingVeil = true;
      win.__littleZenPendingURL = options.url;
      win.__littleZenRoutedURL = options.url;
      if (options.meta) {
        win.__littleZenPendingURLMeta = options.meta;
      }
    }

    try {
      const root = win.document.documentElement;
      root.setAttribute(LITTLE_WINDOW_ATTR, "true");
      root.toggleAttribute("zen-little-window-loading", !!options.url);
      syncLittleWindowControlSide(win);
    } catch (error) {
      log("Could not mark Little Zen window early", error);
    }
  }

  // Sine injects this script on the window load event, after the new browser
  // window has already painted. The opener arms a pending mark, and this
  // observer stamps the attribute when the root element is created.
  const DOCUMENT_MARK_KEY = "__littleZenDocumentMark";

  function littleWindowDocumentMarkState() {
    if (!Services[DOCUMENT_MARK_KEY]) {
      Services[DOCUMENT_MARK_KEY] = {
        pending: null,
        observer: null,
        owner: null,
      };
    }
    return Services[DOCUMENT_MARK_KEY];
  }

  function browserDocumentURI(doc) {
    try {
      return String(doc?.documentURI || doc?.URL || "");
    } catch (error) {
      return "";
    }
  }

  function documentForInsertedSubject(subject) {
    try {
      return subject?.QueryInterface?.(Ci.nsIDocument) || subject;
    } catch (error) {
      return subject;
    }
  }

  const LITTLE_WINDOW_CHROME_SHEET = "chrome://sine/content/chrome.css";

  function ensureLittleWindowChromeSheet(win) {
    if (!win?.windowUtils || win.__littleZenChromeSheetReady) {
      return;
    }

    try {
      win.windowUtils.loadSheet(
        Services.io.newURI(LITTLE_WINDOW_CHROME_SHEET),
        win.windowUtils.USER_SHEET
      );
      win.__littleZenChromeSheetReady = true;
    } catch (error) {
      win.__littleZenChromeSheetReady = true;
    }
  }

  function setLittleWindowVisible(win, visible) {
    try {
      win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).visibility = visible;
      return true;
    } catch (error) {
      return false;
    }
  }

  function revealLittleWindow(win) {
    if (!win || win.closed || !win.__littleZenHeldHidden) {
      return;
    }

    win.__littleZenHeldHidden = false;
    setLittleWindowVisible(win, true);
    try {
      win.focus();
    } catch (error) {}
  }

  function finishPendingLittleWindow(win, options, reason) {
    if (!win || win.closed) {
      return false;
    }

    let href = "";
    try {
      href = String(win.location?.href || "");
    } catch (error) {
      return false;
    }
    if (!href.startsWith("chrome://browser/content/browser.xhtml")) {
      return false;
    }

    const state = littleWindowDocumentMarkState();
    markLittleWindowEarly(win, options);
    ensureLittleWindowChromeSheet(win);
    const marked = !!win.document?.documentElement?.hasAttribute(LITTLE_WINDOW_ATTR);
    if (!marked) {
      return false;
    }

    if (state.pending?.window === win || state.pending?.options === options) {
      state.pending = null;
    }
    revealLittleWindow(win);
    if (!win.__littleZenEarlyMarkLogged) {
      win.__littleZenEarlyMarkLogged = true;
      log("Marked Little Zen window before showing it", { reason });
    }
    return true;
  }

  function holdOpeningLittleWindow(win, options) {
    if (!win?.isChromeWindow || win.__littleZenHeldHidden) {
      return false;
    }

    let href = "";
    try {
      href = String(win.location?.href || "");
    } catch (error) {}
    if (
      href &&
      href !== "about:blank" &&
      !href.startsWith("chrome://browser/content/browser.xhtml")
    ) {
      return false;
    }

    if (!setLittleWindowVisible(win, false)) {
      return false;
    }

    win.__littleZenHeldHidden = true;
    const revealIfMarked = () => finishPendingLittleWindow(win, options, "before-first-layout");
    win.addEventListener("MozBeforeInitialXULLayout", revealIfMarked, { once: true });
    win.addEventListener("DOMContentLoaded", revealIfMarked, { once: true });
    return true;
  }

  function stampLittleWindowDocument(doc, options) {
    const root = doc?.documentElement;
    if (!root) {
      return false;
    }

    root.setAttribute(LITTLE_WINDOW_ATTR, "true");
    root.toggleAttribute("zen-little-window-loading", !!options?.url);
    const win = doc.defaultView;
    if (!win) {
      return true;
    }

    return finishPendingLittleWindow(win, options, "document-created");
  }

  function installLittleWindowDocumentMark(win) {
    const state = littleWindowDocumentMarkState();
    if (state.observers) {
      for (const entry of state.observers) {
        try {
          Services.obs.removeObserver(entry.observer, entry.topic);
        } catch (error) {}
      }
    }

    const documentObserver = {
      observe(subject) {
        const pending = state.pending;
        if (!pending) {
          return;
        }

        const doc = documentForInsertedSubject(subject);
        const href = browserDocumentURI(doc);
        if (!href.startsWith("chrome://browser/content/browser.xhtml")) {
          return;
        }

        const markedWindow = doc?.defaultView;
        if (pending.window && markedWindow && markedWindow !== pending.window) {
          return;
        }
        if (!pending.window && !pending.open) {
          return;
        }

        stampLittleWindowDocument(doc, pending.options);
      },
    };

    const windowObserver = {
      observe(subject) {
        const pending = state.pending;
        if (!pending?.open || pending.window) {
          return;
        }

        let opened = subject;
        try {
          opened = subject.QueryInterface(Ci.nsIDOMWindow);
        } catch (error) {}
        if (!opened?.isChromeWindow) {
          return;
        }

        if (!holdOpeningLittleWindow(opened, pending.options)) {
          return;
        }

        pending.window = opened;
      },
    };

    state.observers = [
      { observer: documentObserver, topic: "document-element-inserted" },
      { observer: windowObserver, topic: "domwindowopened" },
    ];
    for (const entry of state.observers) {
      Services.obs.addObserver(entry.observer, entry.topic);
    }
    state.observer = documentObserver;
    state.owner = win;
    win.__littleZenReinstallDocumentMark = () => installLittleWindowDocumentMark(win);

    if (win.__littleZenDocumentMarkUnload) {
      return;
    }

    win.__littleZenDocumentMarkUnload = true;
    win.addEventListener(
      "unload",
      () => {
        if (state.owner !== win) {
          return;
        }

        if (state.observers) {
          for (const entry of state.observers) {
            try {
              Services.obs.removeObserver(entry.observer, entry.topic);
            } catch (error) {}
          }
        }
        state.observers = null;
        state.observer = null;
        state.owner = null;

        for (const other of Services.wm.getEnumerator("navigator:browser")) {
          if (other !== win && !other.closed && other.__littleZenReinstallDocumentMark) {
            other.__littleZenReinstallDocumentMark();
            break;
          }
        }
      },
      { once: true }
    );
  }

  function releaseLittleWindowPresentation(win, reason = "unknown") {
    if (!isBrowserWindow(win) || win.__littleZenPresentationReleased) {
      return;
    }

    if (win.document?.documentElement?.hasAttribute("zen-little-window-loading")) {
      win.__littleZenReleasePresentationAfterLoading = reason;
      logLittleWindowState(win, "Deferred Little Zen presentation release while loading", {
        reason,
      });
      return;
    }

    win.__littleZenPresentationReleased = true;
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
          openExternalInLittleZenOrNormal(
            win,
            url,
            () => {
              log("Intercepting external openURI into Little Zen", { url });
              LittleZen.openLittleWindow(win, {
                url,
                source: "browserDOMWindow.openURI",
                triggeringPrincipal: aTriggeringPrincipal,
              });
            },
            () => {
              originalBrowserDOMWindow.openURI.call(
                originalBrowserDOMWindow,
                aURI,
                aOpener,
                aWhere,
                aContext,
                aTriggeringPrincipal,
                aCsp
              );
            }
          );
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
          openExternalInLittleZenOrNormal(
            win,
            url,
            () => {
              log("Intercepting external openURIInFrame into Little Zen", { url });
              LittleZen.openLittleWindow(win, {
                url,
                source: "browserDOMWindow.openURIInFrame",
              });
            },
            () => {
              originalBrowserDOMWindow.openURIInFrame?.call(
                originalBrowserDOMWindow,
                aURI,
                aParams,
                aWhere,
                aContext,
                aName
              );
            }
          );
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
      const markOptions = {
        url: options.url,
        expanded: options.expanded,
      };

      installLittleWindowDocumentMark(win);
      const state = littleWindowDocumentMarkState();
      state.pending = {
        open: true,
        window: null,
        options: markOptions,
      };

      let littleWindow = null;
      try {
        littleWindow = originalOpenBrowserWindow.call(this, nextOptions);
      } catch (error) {
        if (state.pending?.options === markOptions) {
          state.pending = null;
        }
        throw error;
      }

      if (!littleWindow) {
        if (state.pending?.options === markOptions) {
          state.pending = null;
        }
        return littleWindow;
      }

      if (state.pending?.options === markOptions && !state.pending.window) {
        state.pending.window = littleWindow;
      }
      if (state.pending?.options === markOptions) {
        state.pending.open = false;
      }

      finishPendingLittleWindow(littleWindow, markOptions, "open-returned");

      littleWindow._zenStartupSyncFlag = "unsynced";
      log("Opened Little Zen browser window", {
        startupSyncFlag: littleWindow._zenStartupSyncFlag,
        hasPendingUrl: !!littleWindow.__littleZenPendingURL,
        markedBeforeReturn: littleWindow.document?.documentElement?.hasAttribute(
          LITTLE_WINDOW_ATTR
        ),
      });
      return littleWindow;
    };

    win[PATCH_FLAGS.openBrowserWindow] = true;
    log("Patched OpenBrowserWindow for Little Zen windows");
  }

  function patchCompactModeManager(win) {
    if (!isLittleWindow(win) || !win.__littleZenStartupReady) {
      return;
    }

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

    if (manager.preference) {
      manager.preference = false;
      log("Disabled inherited compact mode in Little Zen window");
    }

    manager[PATCH_FLAGS.compactMode] = true;
  }

  function patchVerticalTabsManager(win) {
    if (!isLittleWindow(win) || !win.__littleZenStartupReady) {
      return;
    }

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

    if (typeof manager._updateEvent === "function") {
      const originalUpdateEvent = manager._updateEvent;
      manager._updateEvent = function (...args) {
        const root = win.document.documentElement;
        if (
          !root.hasAttribute(LITTLE_WINDOW_ATTR) &&
          !win._zenStartupLittleWindow
        ) {
          return originalUpdateEvent.apply(this, args);
        }
        if (root.hasAttribute("zen-single-toolbar")) {
          this._hasSetSingleToolbar = true;
          this._navbarParent ||= this._toolbarOriginalParent;
        }
        const result = originalUpdateEvent.apply(this, args);
        root.removeAttribute("zen-single-toolbar");
        positionLittleWindowNavbar(win);
        return result;
      };
    }

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
            return "default";
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

  function attachUrlbarDisableGuard(win) {
    if (!isBrowserWindow(win) || win[PATCH_FLAGS.urlbarDisableGuard]) {
      return;
    }

    const doc = win.document;
    const urlbar = win.gURLBar;
    const blockedEvents = [
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "focusin",
      "beforeinput",
      "input",
    ];
    const listeners = [];

    const addListener = (target, type, listener) => {
      if (!target?.addEventListener) {
        return;
      }
      target.addEventListener(type, listener, true);
      listeners.push([target, type, listener]);
    };

    const isUrlbarButtonTarget = target => {
      if (!target?.closest) {
        return false;
      }
      try {
        return !!target.closest(
          [
            "#identity-box",
            "#tracking-protection-icon-container",
            "#page-action-buttons",
            "#urlbar-go-button",
            "#urlbar-revert-button",
            "#reader-mode-button",
            "#picture-in-picture-button",
            ".urlbar-page-action",
            "toolbarbutton",
            "button",
          ].join(",")
        );
      } catch (error) {
        return false;
      }
    };

    const isUrlbarInputTarget = target => {
      if (!target) {
        return false;
      }
      if (target === urlbar) {
        return true;
      }
      if (isUrlbarButtonTarget(target)) {
        return false;
      }
      if (!target.closest) {
        return false;
      }
      try {
        return !!target.closest(
          [
            "#urlbar-input",
            ".urlbar-input-box",
            ".urlbar-input-container",
            ".urlbar-background",
            "#urlbar-search-mode-indicator",
          ].join(",")
        );
      } catch (error) {
        return false;
      }
    };

    const isBlockedUrlbarTarget = event => {
      if (!urlbar || !event?.target) {
        return false;
      }
      try {
        return urlbar.contains(event.target) && isUrlbarInputTarget(event.target);
      } catch (error) {
        return false;
      }
    };

    const blockUrlbarOpen = (event, reason) => {
      if (!isLittleWindow(win)) {
        return;
      }

      try {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
      } catch (error) {}

      closeLittleWindowUrlbar(win, reason);
    };

    const blockUrlbarTarget = event => {
      if (isBlockedUrlbarTarget(event)) {
        blockUrlbarOpen(event, `blocked-${event.type}`);
      }
    };

    const blockOpenLocationCommand = event => {
      blockUrlbarOpen(event, "blocked-open-location-command");
    };

    const blockOpenLocationKeys = event => {
      if (!isLittleWindow(win) || event.defaultPrevented) {
        return;
      }

      const key = event.key?.toLowerCase?.();
      const usesAccel = AppConstants.platform === "macosx" ? event.metaKey : event.ctrlKey;
      if (
        (usesAccel && (key === "l" || key === "k" || key === "t")) ||
        (event.altKey && key === "d") ||
        event.key === "F6"
      ) {
        blockUrlbarOpen(event, `blocked-key-${event.key}`);
      }
    };

    for (const type of blockedEvents) {
      addListener(urlbar, type, blockUrlbarTarget);
    }
    addListener(doc.getElementById("Browser:OpenLocation"), "command", blockOpenLocationCommand);
    addListener(doc.getElementById("cmd_newNavigatorTab"), "command", event => {
      blockUrlbarOpen(event, "blocked-new-tab-command");
    });
    addListener(win, "keydown", blockOpenLocationKeys);

    try {
      urlbar?.setAttribute("zen-little-urlbar-disabled", "true");
    } catch (error) {}

    win.addEventListener(
      "unload",
      () => {
        for (const [target, type, listener] of listeners) {
          try {
            target.removeEventListener(type, listener, true);
          } catch (error) {}
        }
        try {
          urlbar?.removeAttribute("zen-little-urlbar-disabled");
        } catch (error) {}
      },
      { once: true }
    );

    win[PATCH_FLAGS.urlbarDisableGuard] = true;
    closeLittleWindowUrlbar(win, "urlbar-disable-guard-attached");
    log("Attached Little Zen urlbar disable guard");
  }

  function syncEmptyTabState(win, reason = "unknown") {
    if (!isBrowserWindow(win)) {
      return;
    }

    const root = win.document.documentElement;
    const tab = win.gBrowser?.selectedTab;

    if (win.__littleZenStartExpanded && tab?.hasAttribute("zen-empty-tab")) {
      tab.removeAttribute("zen-empty-tab");
    }

    const hasEmptyTab = usesEmptyLittleWindowPresentation(win);

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
      for (const ms of [150, 450, 1200, 2800, 5000]) {
        win.setTimeout(() => updateLittleZenBlendedTheme(win, `${reason}:${ms}`), ms);
      }
    };

    const sync = event => {
      if (!isLittleWindow(win)) {
        return;
      }

      syncEmptyTabState(win, event?.type ?? "manual");
      scheduleThemeUpdate(event?.type ?? "manual");
      if (win.__littleZenPendingURL && win.__littleZenStartupReady) {
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
    if (!doc.body) {
      return null;
    }

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

    const fallback = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    fallback.id = "zen-little-window-load-fallback";

    const fallbackTitle = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    fallbackTitle.id = "zen-little-window-load-fallback-title";
    fallbackTitle.textContent = "Still loading";
    fallback.appendChild(fallbackTitle);

    const fallbackActions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    fallbackActions.id = "zen-little-window-load-fallback-actions";

    const makeButton = (id, label, action) => {
      const button = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      button.id = id;
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      fallbackActions.appendChild(button);
      return button;
    };

    makeButton("zen-little-window-load-retry", "Retry", () => {
      retryLittleWindowStalledLoad(win);
    });
    makeButton("zen-little-window-load-main", "Open in Main", () => {
      openLittleWindowStalledLoadInMain(win);
    });
    makeButton("zen-little-window-load-close", "Close", () => {
      win.close();
    });

    fallback.appendChild(fallbackActions);
    overlay.appendChild(fallback);

    (doc.body || doc.documentElement).appendChild(overlay);
    return overlay;
  }

  function clearLittleWindowLoadingFallback(win) {
    try {
      if (win.__littleZenStalledLoadTimer) {
        win.clearTimeout(win.__littleZenStalledLoadTimer);
      }
    } catch (error) {}
    delete win.__littleZenStalledLoadTimer;

    try {
      win.document.documentElement.removeAttribute("zen-little-window-load-stalled");
      win.document
        .getElementById("zen-little-window-loading-overlay")
        ?.setAttribute("aria-hidden", "true");
    } catch (error) {}
  }

  function showLittleWindowStalledLoadFallback(win, reason = "unknown") {
    if (!isLittleWindow(win) || win.closed) {
      return;
    }

    const root = win.document.documentElement;
    if (!root.hasAttribute("zen-little-window-loading")) {
      return;
    }

    ensureLittleWindowLoadingPulse(win);
    root.setAttribute("zen-little-window-load-stalled", "true");
    win.document
      .getElementById("zen-little-window-loading-overlay")
      ?.removeAttribute("aria-hidden");
    logLittleWindowState(win, "Little Zen stalled-load fallback shown", {
      reason,
      timeoutMs: LITTLE_ZEN_STALLED_LOAD_TIMEOUT_MS,
    });
  }

  function scheduleLittleWindowLoadingFallback(win, reason = "unknown") {
    clearLittleWindowLoadingFallback(win);
    if (!isLittleWindow(win)) {
      return;
    }

    win.__littleZenStalledLoadTimer = win.setTimeout(() => {
      delete win.__littleZenStalledLoadTimer;
      showLittleWindowStalledLoadFallback(win, reason);
    }, LITTLE_ZEN_STALLED_LOAD_TIMEOUT_MS);
  }

  function getLittleWindowFallbackUrl(win) {
    return (
      win?.__littleZenPendingURL ||
      win?.__littleZenRoutedURL ||
      getLittleWindowUrl(win)
    );
  }

  function retryLittleWindowStalledLoad(win) {
    if (!isLittleWindow(win) || win.closed) {
      return;
    }

    const url = getLittleWindowFallbackUrl(win);
    clearLittleWindowLoadingFallback(win);
    setLittleWindowLoading(win, true, "stalled-retry");

    if (win.__littleZenPendingURL) {
      schedulePendingNavigationFlush(win, "stalled-retry");
      return;
    }

    try {
      if (url && url !== "about:blank") {
        win.gBrowser?.selectedBrowser?.reload?.();
      }
    } catch (error) {
      log("Could not retry stalled Little Zen load", error);
    }
  }

  function openLittleWindowStalledLoadInMain(win) {
    const url = getLittleWindowFallbackUrl(win);
    const mainWin = getMainBrowserWindow(win);
    if (!url || url === "about:blank" || !mainWin) {
      win.close();
      return;
    }

    try {
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      if (typeof mainWin.openWebLinkIn === "function") {
        mainWin.openWebLinkIn(url, "tab", {
          triggeringPrincipal: principal,
          fromChrome: true,
        });
      } else {
        const tab = mainWin.gBrowser.addTab(url, {
          triggeringPrincipal: principal,
          skipAnimation: true,
        });
        if (tab) {
          mainWin.gBrowser.selectedTab = tab;
        }
      }
      mainWin.focus();
    } catch (error) {
      log("Could not open stalled Little Zen load in the main window", error);
    }

    win.close();
  }

  function setLittleWindowLoading(win, isLoading, reason = "unknown") {
    if (!isLittleWindow(win)) {
      return;
    }

    const root = win.document.documentElement;
    if (isLoading) {
      root.setAttribute("zen-little-window-loading", "true");
      ensureLittleWindowLoadingPulse(win);
      scheduleLittleWindowLoadingFallback(win, reason);
    } else {
      root.removeAttribute("zen-little-window-loading");
      clearLittleWindowLoadingFallback(win);
      delete win.__littleZenStartLoadingVeil;
      delete win.__littleZenSuppressUrlbarFocus;
      if (win.__littleZenReleasePresentationAfterLoading) {
        const releaseReason = win.__littleZenReleasePresentationAfterLoading;
        delete win.__littleZenReleasePresentationAfterLoading;
        releaseLittleWindowPresentation(win, `loading-complete:${releaseReason}`);
      }
    }

    logLittleWindowState(win, isLoading ? "Entered Little Zen loading veil" : "Left Little Zen loading veil", {
      reason,
    });
  }

  function positionLittleWindowButtons(win) {
    const navBar = win.document.getElementById("nav-bar");
    const buttons = getLittleWindowButtons(win);
    if (!navBar || !buttons) {
      return;
    }

    withToolbarBatchUpdate(win, () => {
      const left = syncLittleWindowControlSide(win);
      if (left) {
        if (navBar.firstElementChild !== buttons) {
          navBar.prepend(buttons);
          log("Moved Little Zen window controls to the start of the navbar");
        }
      } else if (navBar.lastElementChild !== buttons) {
        navBar.append(buttons);
        log("Moved Little Zen window controls to the end of the navbar");
      }
    });

    for (const extra of win.document.querySelectorAll(".titlebar-buttonbox-container")) {
      extra.toggleAttribute("little-zen-unused-controls", extra !== buttons);
    }
  }

  // CustomizableUI watches toolbar DOM and "repairs" areas when nodes move,
  // which throws when our shuffle lands mid-rebuild. Batch our mutations so
  // the reconciler only ever sees the settled DOM. Nesting-safe (counter).
  function withToolbarBatchUpdate(win, fn) {
    const cui = win.CustomizableUI;
    if (
      cui &&
      typeof cui.beginBatchUpdate === "function" &&
      typeof cui.endBatchUpdate === "function"
    ) {
      cui.beginBatchUpdate();
      try {
        fn();
      } finally {
        cui.endBatchUpdate();
      }
      return;
    }
    fn();
  }

  function positionLittleWindowNavbar(win) {
    if (!isLittleWindow(win)) {
      return;
    }

    withToolbarBatchUpdate(win, () => {
      const navBar = win.document.getElementById("nav-bar");
      const navContainer = win.document.getElementById(
        "zen-appcontent-navbar-container"
      );
      if (navBar && navContainer && navBar.parentElement !== navContainer) {
        navContainer.appendChild(navBar);
        log("Moved Little Zen navbar above page content");
      }

      // NOTE: registered toolbar widgets (back/forward/reload) must stay
      // inside #nav-bar-customization-target. Moving them out breaks
      // CustomizableUI area rebuilds (insertWidgetBefore throws).
      const target = win.document.getElementById("nav-bar-customization-target");
      const urlbar = win.document.getElementById("urlbar-container");
      if (target && urlbar?.parentElement === target) {
        for (const id of ["back-button", "forward-button", "stop-reload-button"]) {
          const item = win.document.getElementById(id);
          if (item) {
            target.insertBefore(item, urlbar);
          }
        }
      }

      positionLittleWindowButtons(win);
      positionLittleWindowSpacePicker(win);
    });
  }

  function attachWindowControlsPrefSync(win) {
    if (win.__littleZenWindowControlsPrefSyncAttached) {
      return;
    }
    win.__littleZenWindowControlsPrefSyncAttached = true;

    const observer = () => {
      if (!isLittleWindow(win) || win.closed) {
        return;
      }
      positionLittleWindowNavbar(win);
    };

    try {
      Services.prefs.addObserver(LITTLE_ZEN_WINDOW_CONTROLS_LEFT_PREF, observer);
      win.addEventListener(
        "unload",
        () => {
          try {
            Services.prefs.removeObserver(
              LITTLE_ZEN_WINDOW_CONTROLS_LEFT_PREF,
              observer
            );
          } catch (error) {}
        },
        { once: true }
      );
    } catch (error) {
      log("Could not attach Little Zen window-controls pref observer", error);
    }
  }

  function applyExpandedLittleWindow(win, reason) {
    if (!isBrowserWindow(win) || win.closed || win.__littleZenExpandedApplied) {
      return;
    }

    win.__littleZenExpandedApplied = true;
    win.__littleZenStartExpanded = true;
    closeLittleWindowUrlbar(win, "expanded-startup");
    leaveEmptyTabMode(win, reason);
    expandLittleWindow(win, reason);
  }

  function refreshLittleWindowLayout(win) {
    const root = win.document.documentElement;
    root.setAttribute(LITTLE_WINDOW_ATTR, "true");
    root.setAttribute("zen-compact-mode", "false");
    try {
      win.ZenThemeModifier?.updateElementSeparation?.();
    } catch (error) {
      log("Could not refresh ZenThemeModifier.", error);
    }

    if (usesEmptyLittleWindowPresentation(win)) {
      root.setAttribute("zen-no-padding", "true");
      root.style.setProperty("--zen-element-separation", "0.1px");
    } else {
      root.removeAttribute("zen-no-padding");
      root.style.removeProperty("--zen-element-separation");
      try {
        win.ZenThemeModifier?.updateElementSeparation?.();
      } catch (error) {
        log("Could not restore Zen element separation.", error);
      }
    }

    try {
      win.gZenVerticalTabsManager?._updateEvent?.();
    } catch (error) {
      log("Could not refresh vertical tabs layout.", error);
    }

    positionLittleWindowNavbar(win);
  }

  function verifyLittleWindowUrlbarPosition(win, reason = "unknown") {
    closeLittleWindowUrlbar(win, `urlbar-position-disabled:${reason}`);
  }

  function scheduleLittleWindowUrlbarPositionCheck(win, reason = "unknown") {
    closeLittleWindowUrlbar(win, `urlbar-position-check-disabled:${reason}`);
  }

  function openLittleWindowUrlbar(win) {
    closeLittleWindowUrlbar(win, "open-urlbar-disabled");
    logLittleWindowState(win, "Blocked Little Zen urlbar open");
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

    if (!win.__littleZenStartupReady) {
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

    routeLog("Loading queued Little Zen URL", {
      url: pendingUrl,
      source: pendingMeta.source ?? "unknown",
      reason,
    });

    try {
      scheduleLeaveEmptyTabMode(win, `flush:${reason}`);

      const principal =
        pendingMeta.triggeringPrincipal ||
        Services.scriptSecurityManager.getSystemPrincipal();
      const selectedTab = win.gBrowser?.selectedTab;
      const currentContainerId = getTabContainerId(selectedTab);

      routeLog("Little Zen navigation: enforcing the default container", {
        url: pendingUrl,
        reason,
        currentContainerId,
      });

      let loadedByNewTab = false;
      if (selectedTab && currentContainerId !== 0) {
        const defaultTab = win.gBrowser.addTab(pendingUrl, {
          triggeringPrincipal: principal,
          skipAnimation: true,
          skipRoute: true,
          inBackground: false,
          userContextId: 0,
        });

        if (defaultTab?.linkedBrowser) {
          loadedByNewTab = true;
          syncLittleWindowTransparentBrowsers(win);
          win.gBrowser.selectedTab = defaultTab;
          selectedBrowser = defaultTab.linkedBrowser;
          win.setTimeout(() => {
            try {
              if (
                selectedTab !== defaultTab &&
                win.gBrowser.selectedTab === defaultTab &&
                defaultTab.linkedBrowser &&
                selectedTab?.parentNode &&
                !selectedTab.closing &&
                win.gBrowser.tabs.length > 1
              ) {
                win.gBrowser.removeTab(selectedTab, { animate: false });
              }
            } catch (error) {
              log("Could not remove old Little Zen container tab", error);
            }
          }, 1000);
          routeLog("Little Zen navigation: opened URL in the default container");
        } else {
          log("Little Zen default-container tab creation failed");
          win.__littleZenPendingURL = pendingUrl;
          win.__littleZenPendingURLMeta = pendingMeta;
          setLittleWindowLoading(win, true, `retry:${reason}`);
          return false;
        }
      } else if (selectedTab) {
        syncLittleWindowTransparentBrowsers(win);
      }

      const loadFlags =
        Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP ??
        Ci.nsIWebNavigation.LOAD_FLAGS_NONE;

      if (!loadedByNewTab) {
        selectedBrowser.browsingContext.loadURI(Services.io.newURI(pendingUrl), {
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
    try {
      win.focus();
      win.gURLBar?.focus();
      win.gURLBar?.select();
      win.gURLBar?.inputField?.focus();
    } catch (error) {
      log("Could not focus the Little Zen urlbar.", error);
    }
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

  function getLittleZenOpaqueBackdrop(win) {
    const dark = win?.document?.documentElement?.hasAttribute("zen-should-be-dark-mode");
    return dark ? { r: 16, g: 18, b: 24 } : { r: 245, g: 247, b: 251 };
  }

  function flattenCssColorToOpaque(color, backdrop) {
    const rgb = parseCssRgb(color);
    if (!rgb) {
      return rgbToCss(backdrop);
    }
    const alpha = getCssColorAlpha(color);
    if (alpha === null || alpha >= 0.96) {
      return rgbToCss(rgb);
    }
    return rgbToCss({
      r: Math.round(rgb.r * alpha + backdrop.r * (1 - alpha)),
      g: Math.round(rgb.g * alpha + backdrop.g * (1 - alpha)),
      b: Math.round(rgb.b * alpha + backdrop.b * (1 - alpha)),
    });
  }

  function probeCssColor(win, cssValue) {
    const doc = win?.document;
    if (!doc?.documentElement) {
      return null;
    }
    const probe = doc.createElement("div");
    probe.style.position = "fixed";
    probe.style.pointerEvents = "none";
    probe.style.opacity = "0";
    probe.style.backgroundColor = cssValue;
    probe.style.color = "var(--toolbox-textcolor)";
    doc.documentElement.appendChild(probe);
    const style = win.getComputedStyle(probe);
    const result = {
      bg: style.backgroundColor,
      fg: style.color,
    };
    probe.remove();
    return result;
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

  function littleZenHeaderNeedsDarkControls(color) {
    const rgb = parseCssRgb(color);
    return !!rgb && getRelativeLuminance(rgb) >= LITTLE_ZEN_BRIGHT_CONTROL_LUMINANCE;
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

  function getLittleZenIdleChromeTheme(win) {
    const backdrop = getLittleZenOpaqueBackdrop(win);
    const toolbar = probeCssColor(win, "var(--zen-main-browser-background-toolbar)");
    const main = probeCssColor(win, "var(--zen-main-browser-background)");
    const rootBg = win.document
      ? win.getComputedStyle(win.document.documentElement).backgroundColor
      : null;
    const rawBg =
      [toolbar?.bg, main?.bg, rootBg].find(hasVisibleColor) || rgbToCss(backdrop);
    const bg = flattenCssColorToOpaque(rawBg, backdrop);
    return {
      bg,
      fg: getReadableForeground(bg, [toolbar?.fg, main?.fg].filter(Boolean)),
      source: "idle-chrome",
    };
  }

  function littleZenRgbToCss(rgb) {
    if (!rgb) {
      return "";
    }
    return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
  }

  function littleZenColorDistance(a, b) {
    if (!a || !b) {
      return Infinity;
    }
    return (
      Math.abs(a[0] - b[0]) +
      Math.abs(a[1] - b[1]) +
      Math.abs(a[2] - b[2])
    );
  }

  function littleZenPageShowsThrough(win, browser) {
    return (
      !browser?.isRemoteBrowser ||
      !!win.gBrowser?.getTabForBrowser(browser)?.hasAttribute("zen-empty-tab")
    );
  }

  function getLittleZenSampleCanvas(win, key) {
    const store = (win.__littleZenSampleCanvases ||= {});
    if (!store[key]) {
      store[key] = win.document.createElementNS(LITTLE_ZEN_XHTML_NS, "canvas");
    }
    return store[key];
  }

  function compositeLittleZenSample(rgb, backdrop) {
    const alpha = (rgb[3] ?? 255) / 255;
    if (alpha >= 0.96) {
      return [rgb[0], rgb[1], rgb[2]];
    }
    return [
      Math.round(rgb[0] * alpha + backdrop.r * (1 - alpha)),
      Math.round(rgb[1] * alpha + backdrop.g * (1 - alpha)),
      Math.round(rgb[2] * alpha + backdrop.b * (1 - alpha)),
    ];
  }

  function commonColorFromLittleZenPixels(data, win) {
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key =
        ((data[i] >> 3) << 13) |
        ((data[i + 1] >> 3) << 8) |
        ((data[i + 2] >> 3) << 3) |
        (data[i + 3] >> 5);
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, a: 0 };
      bucket.count++;
      bucket.r += data[i];
      bucket.g += data[i + 1];
      bucket.b += data[i + 2];
      bucket.a += data[i + 3];
      buckets.set(key, bucket);
    }

    let best = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.count > best.count) {
        best = bucket;
      }
    }
    if (!best) {
      return null;
    }

    const rgb = [best.r, best.g, best.b, best.a].map((value) =>
      Math.round(value / best.count)
    );
    const backdrop = getLittleZenOpaqueBackdrop(win);
    return {
      rgb: compositeLittleZenSample(rgb, backdrop),
      share: best.count / (data.length / 4),
    };
  }

  function sampleLittleZenShownTop(win, browser) {
    const box = browser.getBoundingClientRect();
    if (!box.width || !box.height) {
      return null;
    }
    const canvas = getLittleZenSampleCanvas(win, "shown");
    canvas.width = Math.max(1, Math.round(box.width * LITTLE_ZEN_SAMPLE_SCALE));
    canvas.height = Math.max(1, Math.round(LITTLE_ZEN_SAMPLE_BAND * LITTLE_ZEN_SAMPLE_SCALE));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(LITTLE_ZEN_SAMPLE_SCALE, 0, 0, LITTLE_ZEN_SAMPLE_SCALE, 0, 0);
    ctx.drawWindow(
      win,
      box.left,
      box.top,
      box.width,
      LITTLE_ZEN_SAMPLE_BAND,
      "rgb(0, 0, 0)",
      ctx.DRAWWINDOW_DRAW_VIEW
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return commonColorFromLittleZenPixels(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      win
    );
  }

  async function sampleLittleZenTopColor(win, browser) {
    if (!browser) {
      return null;
    }
    if (littleZenPageShowsThrough(win, browser)) {
      return sampleLittleZenShownTop(win, browser);
    }

    const windowGlobal = browser.browsingContext?.currentWindowGlobal;
    const width = browser.clientWidth;
    if (!windowGlobal || !width) {
      return sampleLittleZenShownTop(win, browser);
    }

    const backing =
      browser.getAttribute("transparent") === "true"
        ? "transparent"
        : "rgb(255, 255, 255)";
    let bitmap;
    try {
      bitmap = await windowGlobal.drawSnapshot(
        null,
        LITTLE_ZEN_FULL_VIEW_SCALE,
        backing
      );
    } catch (error) {
      log("Little Zen page snapshot failed", error);
      return sampleLittleZenShownTop(win, browser);
    }
    if (!bitmap) {
      return sampleLittleZenShownTop(win, browser);
    }

    try {
      const canvas = getLittleZenSampleCanvas(win, "snapshot");
      canvas.width = bitmap.width;
      canvas.height = Math.min(
        LITTLE_ZEN_SAMPLE_BAND * LITTLE_ZEN_FULL_VIEW_SCALE,
        bitmap.height
      );
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      return commonColorFromLittleZenPixels(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        win
      );
    } finally {
      try {
        bitmap.close?.();
      } catch (error) {}
    }
  }

  function themeFromLittleZenSample(win, reading, href, source = "page-sample") {
    if (!reading?.rgb) {
      return null;
    }
    const bg = littleZenRgbToCss(reading.rgb);
    const bgRgb = { r: reading.rgb[0], g: reading.rgb[1], b: reading.rgb[2] };
    return {
      bg,
      fg: chooseForeground(bgRgb),
      source,
      href,
      rgb: reading.rgb,
      share: reading.share,
    };
  }

  function loadLittleZenSiteColors() {
    if (littleZenSiteColors) {
      return littleZenSiteColors;
    }
    littleZenSiteColors = new Map();
    try {
      const raw = Services.prefs.getStringPref(LITTLE_ZEN_SITE_COLORS_PREF, "{}");
      littleZenSiteColors = new Map(Object.entries(JSON.parse(raw)));
    } catch (error) {}
    return littleZenSiteColors;
  }

  function persistLittleZenSiteColors() {
    if (littleZenSiteColorsSaveTimer) {
      return;
    }
    littleZenSiteColorsSaveTimer = setTimeout(() => {
      littleZenSiteColorsSaveTimer = null;
      try {
        Services.prefs.setStringPref(
          LITTLE_ZEN_SITE_COLORS_PREF,
          JSON.stringify(Object.fromEntries(loadLittleZenSiteColors()))
        );
      } catch (error) {}
    }, 20000);
  }

  function rememberLittleZenSiteColor(href, rgb) {
    try {
      const url = new URL(href);
      if (!/^https?:$/i.test(url.protocol) || !url.hostname || !rgb) {
        return;
      }
      const host = url.hostname.toLowerCase();
      const colors = loadLittleZenSiteColors();
      const value = rgb.join(",");
      if (colors.get(host) === value) {
        return;
      }
      colors.delete(host);
      colors.set(host, value);
      while (colors.size > LITTLE_ZEN_THEME_CACHE_LIMIT) {
        colors.delete(colors.keys().next().value);
      }
      persistLittleZenSiteColors();
    } catch (error) {}
  }

  function rememberedLittleZenSiteRgb(href) {
    try {
      const url = new URL(href);
      if (!/^https?:$/i.test(url.protocol) || !url.hostname) {
        return null;
      }
      const value = loadLittleZenSiteColors().get(url.hostname.toLowerCase());
      return value ? value.split(",").map(Number) : null;
    } catch (error) {
      return null;
    }
  }

  function attachLittleZenSiteColorWatchers(win) {
    if (win[PATCH_FLAGS.siteColor]) {
      return;
    }
    win[PATCH_FLAGS.siteColor] = true;

    const panels = win.document.getElementById("tabbrowser-tabpanels");
    const onScrollInput = () => {
      if (!isLittleWindow(win) || !getLittleZenThemeUrl(win)) {
        return;
      }
      const now = Date.now();
      const wait = Math.max(
        0,
        LITTLE_ZEN_SCROLL_SAMPLE_MS - (now - (win.__littleZenLastScrollSample || 0))
      );
      if (win.__littleZenScrollSampleTimer) {
        return;
      }
      win.__littleZenScrollSampleTimer = win.setTimeout(() => {
        win.__littleZenScrollSampleTimer = 0;
        win.__littleZenLastScrollSample = Date.now();
        updateLittleZenBlendedTheme(win, "scroll", { fromScroll: true });
      }, wait);
    };

    panels?.addEventListener("wheel", onScrollInput, { passive: true, capture: true });
    panels?.addEventListener("mouseup", onScrollInput, { capture: true });
    win.addEventListener("keyup", (event) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        onScrollInput();
      }
    });

    const check = () => {
      if (!isLittleWindow(win) || win.document.hidden || !getLittleZenThemeUrl(win)) {
        return;
      }
      updateLittleZenBlendedTheme(win, "drift-check", { fromScroll: true });
    };
    const intervalId = win.setInterval(check, 3000);
    win.addEventListener("focus", () => win.setTimeout(check, 400));
    win.addEventListener(
      "unload",
      () => {
        win.clearInterval(intervalId);
        if (win.__littleZenScrollSampleTimer) {
          win.clearTimeout(win.__littleZenScrollSampleTimer);
        }
      },
      { once: true }
    );
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
    if (
      !theme?.bg ||
      !href ||
      theme.source === "toolbar-fallback" ||
      theme.source === "idle-chrome" ||
      theme.source === "unknown-page"
    ) {
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
    const idle = !url;
    root.toggleAttribute("zen-little-window-idle", idle);

    if (idle) {
      const idleTheme = theme?.source === "idle-chrome" ? theme : getLittleZenIdleChromeTheme(win);
      const compactEmpty = root.hasAttribute("zen-has-empty-tab");
      const brightControls = compactEmpty && littleZenHeaderNeedsDarkControls(idleTheme.bg);
      root.toggleAttribute("little-zen-bright-controls", brightControls);
      setCssVar(root, "--little-zen-traffic-rest", brightControls ? "rgb(0 0 0 / 36%)" : null);
      setCssVar(
        root,
        "--little-zen-page-header-background",
        compactEmpty ? idleTheme.bg : null
      );
      setCssVar(
        root,
        "--little-zen-window-theme-background",
        compactEmpty ? idleTheme.bg : null
      );
      setCssVar(root, "--blended-addressbar-frame-background");
      setCssVar(root, "--blended-addressbar-window-tint-background");
      setCssVar(root, "--little-zen-page-header-foreground", idleTheme.fg);
      setCssVar(root, "--little-zen-theme-outline");
      setCssVar(root, "--little-zen-page-outline");
      setCssVar(
        win.document.getElementById("zen-browser-background"),
        "--blended-addressbar-window-tint-background"
      );
      log("Little Zen idle chrome uses Zen wallpaper and content plate", {
        reason,
        foreground: idleTheme.fg,
      });
      return;
    }

    const backdrop = getLittleZenOpaqueBackdrop(win);
    const themeColor = flattenCssColorToOpaque(theme?.bg || rgbToCss(backdrop), backdrop);
    const themeRgb = parseCssRgb(themeColor) || backdrop;
    const header = themeColor;
    const foreground = getStableHeaderForeground(themeRgb, theme?.fg);
    const windowBackground = themeColor;
    const isLightTheme = getRelativeLuminance(themeRgb) > 0.56;
    const brightControls = getRelativeLuminance(themeRgb) >= LITTLE_ZEN_BRIGHT_CONTROL_LUMINANCE;
    root.toggleAttribute("little-zen-bright-controls", brightControls);
    setCssVar(root, "--little-zen-traffic-rest", brightControls ? "rgb(0 0 0 / 36%)" : null);
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

  async function updateLittleZenBlendedTheme(win, reason = "unknown", options = {}) {
    if (!isLittleWindow(win)) {
      return;
    }

    const browser = win.gBrowser?.selectedBrowser;
    const expectedHref = getLittleZenThemeUrl(win)?.href || "";
    if (!expectedHref) {
      applyLittleZenResolvedTheme(win, getLittleZenIdleChromeTheme(win), `${reason}:idle`);
      return;
    }

    const requestId = (win.__littleZenColorRequestId || 0) + 1;
    win.__littleZenColorRequestId = requestId;

    const rememberedRgb = rememberedLittleZenSiteRgb(expectedHref);
    const rememberedTheme = getRememberedLittleZenTheme(expectedHref);
    if (rememberedTheme?.bg) {
      applyLittleZenResolvedTheme(win, rememberedTheme, `${reason}:retained`);
    } else if (rememberedRgb) {
      applyLittleZenResolvedTheme(
        win,
        themeFromLittleZenSample(
          win,
          { rgb: rememberedRgb, share: 1 },
          expectedHref,
          "host-cache"
        ),
        `${reason}:host`
      );
    }

    let reading = null;
    try {
      reading = await sampleLittleZenTopColor(win, browser);
    } catch (error) {
      log("Little Zen page color sample failed", error);
    }

    if (
      requestId !== win.__littleZenColorRequestId ||
      browser !== win.gBrowser?.selectedBrowser ||
      !isLittleWindow(win)
    ) {
      return;
    }

    const currentHref = getLittleZenThemeUrl(win)?.href || "";
    if (expectedHref && currentHref && expectedHref !== currentHref) {
      return;
    }
    if (!reading?.rgb) {
      return;
    }
    log("Little Zen sampled painted page top", {
      reason,
      href: expectedHref,
      rgb: reading.rgb,
      share: reading.share,
      transparent: browser?.getAttribute("transparent") === "true",
      remote: !!browser?.isRemoteBrowser,
    });

    if (!options.fromScroll && rememberedRgb && littleZenColorDistance(reading.rgb, rememberedRgb) > LITTLE_ZEN_CHECK_DISTANCE) {
      const unsure = win.__littleZenUnsureColor;
      if (!unsure || unsure.href !== expectedHref || littleZenColorDistance(reading.rgb, unsure.rgb) > LITTLE_ZEN_CHECK_DISTANCE) {
        win.__littleZenUnsureColor = { href: expectedHref, rgb: reading.rgb };
        win.setTimeout(
          () => updateLittleZenBlendedTheme(win, `${reason}:recheck`),
          LITTLE_ZEN_UNSURE_RECHECK_MS
        );
        return;
      }
    }
    win.__littleZenUnsureColor = null;

    if (options.fromScroll) {
      const current = win.__littleZenCurrentSampleRgb;
      if (reading.share < LITTLE_ZEN_MIN_COLOR_SHARE) {
        return;
      }
      if (current && littleZenColorDistance(reading.rgb, current) <= LITTLE_ZEN_SAME_COLOR_DISTANCE) {
        return;
      }
    }

    const sampled = themeFromLittleZenSample(win, reading, expectedHref);
    if (!sampled?.bg) {
      return;
    }
    win.__littleZenCurrentSampleRgb = reading.rgb;
    applyLittleZenResolvedTheme(win, sampled, `${reason}:sample`);
    rememberLittleZenSiteColor(expectedHref, reading.rgb);
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

  function getInitialTargetWorkspaceId(mainWin) {
    return getActiveWorkspaceId(mainWin);
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
        try {
          if (!win.closed) {
            win.close();
          }
          log("transferTabToWorkspace: little window close attempted", {
            closed: win.closed,
          });
        } catch (error) {
          log("transferTabToWorkspace: little window close failed", error);
        }
      }, 150);

      log("transferTabToWorkspace: adoptTab succeeded", {
        sourceTabId: sourceTab.id ?? null,
        adoptedTabId: adoptedTab.id ?? null,
      });
      try {
        log("transferTabToWorkspace: post-transfer browser state", {
          currentUrl: adoptedTab.linkedBrowser?.currentURI?.spec ?? null,
          transparent: adoptedTab.linkedBrowser?.hasAttribute("transparent") ?? null,
          remote: !!adoptedTab.linkedBrowser?.isRemoteBrowser,
          hidden: !!adoptedTab.hidden,
          selected: mainWin.gBrowser.selectedTab === adoptedTab,
        });
      } catch (stateError) {}
      try {
        const checkTab = adoptedTab;
        const checkWin = mainWin;
        checkWin.setTimeout(
          () => verifyAndRepairTransfer(checkWin, checkTab, "settle-400"),
          400
        );
        checkWin.setTimeout(
          () => verifyAndRepairTransfer(checkWin, checkTab, "settle-1500"),
          1500
        );
      } catch (error) {}
  // Zen's async workspace settling can leave the adopted tab selected
  // but with an inactive docshell (blank paint despite the right URL), or
  // revert selection onto a blank tab. Repair both, but never yank the user
  // off a real page they chose themselves.
  function verifyAndRepairTransfer(checkWin, checkTab, phase) {
    try {
      const stillSelected = checkWin.gBrowser?.selectedTab === checkTab;
      const selUrl =
        checkWin.gBrowser?.selectedTab?.linkedBrowser?.currentURI?.spec ?? "";
      const selIsBlank = selUrl === "about:blank" || selUrl === "about:newtab";
      if (!stillSelected && (checkTab.hidden || selIsBlank)) {
        log("transferTabToWorkspace: repairing transfer selection", {
          phase,
          hidden: !!checkTab.hidden,
          selUrl,
        });
        try {
          checkWin.gBrowser.selectedTab = checkTab;
        } catch (repairError) {}
        try {
          checkWin.focus();
        } catch (focusError) {}
      }
      try {
        const browser = checkTab.linkedBrowser;
        const active =
          checkWin.gBrowser?.selectedTab === checkTab &&
          browser &&
          !browser.docShellIsActive;
        if (active) {
          log("transferTabToWorkspace: reactivating adopted browser docshell", {
            phase,
            currentUrl: browser.currentURI?.spec ?? null,
          });
          browser.docShellIsActive = true;
        }
      } catch (activateError) {}
      let docActive = null;
      let readyState = null;
      let tabState = null;
      try {
        docActive = checkTab.linkedBrowser?.docShell?.isActive ?? null;
      } catch (e) {}
      try {
        readyState = checkTab.linkedBrowser?.contentDocument?.readyState ?? null;
      } catch (e) {}
      try {
        tabState = {
          pending: checkTab.hasAttribute("pending"),
          discarded: checkTab.hasAttribute("discarded"),
          busy: checkTab.hasAttribute("busy"),
          crashed: checkTab.hasAttribute("crashed"),
        };
      } catch (e) {}
      log("transferTabToWorkspace: delayed transfer check", {
        phase,
        connected: checkTab.isConnected,
        selected: checkWin.gBrowser?.selectedTab === checkTab,
        hidden: !!checkTab.hidden,
        currentUrl: checkTab.linkedBrowser?.currentURI?.spec ?? null,
        docActive,
        readyState,
        tabState,
      });
    } catch (error) {}
  }
      return adoptedTab;
    } catch (error) {
      log("transferTabToWorkspace: adoptTab failed", error);
      return null;
    }
  }

  async function placeTabInWorkspace(mainWin, tab, workspaceId) {
    const workspaces = mainWin?.gZenWorkspaces;
    if (!workspaces || !tab || !workspaceId) {
      return false;
    }

    try {
      // Stamp the workspace first so Zen's visibility logic never sees an
      // unassigned tab, even if the move below silently no-ops.
      tab.setAttribute("zen-workspace-id", workspaceId);
      if (typeof workspaces.moveTabToWorkspace === "function") {
        workspaces.moveTabToWorkspace(tab, workspaceId);
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

      const verified =
        mainWin.gBrowser.selectedTab === tab &&
        tab.getAttribute("zen-workspace-id") === workspaceId;
      log("placeTabInWorkspace result", {
        placed: verified,
        selected: mainWin.gBrowser.selectedTab === tab,
        workspaceAttr: tab.getAttribute("zen-workspace-id"),
        hidden: !!tab.hidden,
        workspaceId,
      });
      return verified;
    } catch (error) {
      log("placeTabInWorkspace failed", error);
      return false;
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
    picker.setAttribute("skipintoolbarset", "true");
    picker.setAttribute("removable", "false");
    picker.setAttribute("overflows", "false");
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
    arrow.setAttribute("label", "▾");
    arrow.setAttribute("orient", "horizontal");

    const arrowLabel = doc.createXULElement("label");
    arrowLabel.id = PICKER_ID + "-arrow-label";
    arrowLabel.setAttribute("value", "▾");
    arrow.appendChild(arrowLabel);

    // Popup menu
    const popup = doc.createXULElement("panel");
    popup.id = PICKER_MENU_ID;
    popup.setAttribute("type", "arrow");
    popup.setAttribute("orient", "vertical");
    popup.setAttribute("consumeoutsideclicks", "true");

    picker.appendChild(openButton);
    picker.appendChild(arrow);
    arrow.appendChild(popup);

    // State: which workspace is targeted
    let targetWorkspaceId = getInitialTargetWorkspaceId(mainWin);

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
      const activeWorkspaceId = getInitialTargetWorkspaceId(mainWin);
      if (activeWorkspaceId && activeWorkspaceId !== targetWorkspaceId) {
        targetWorkspaceId = activeWorkspaceId;
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
      searchIcon.setAttribute("src", "chrome://global/skin/icons/search-glass.svg");
      searchRow.appendChild(searchIcon);

      const searchInput = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "input"
      );
      searchInput.id = PICKER_MENU_ID + "-search";
      searchInput.className = "zen-little-window-space-menu-search";
      searchInput.setAttribute("type", "text");
      searchInput.setAttribute("placeholder", "Search spaces");
      searchInput.setAttribute("autocomplete", "off");
      searchRow.appendChild(searchInput);
      popup.appendChild(searchRow);

      const list = doc.createXULElement("vbox");
      list.id = PICKER_MENU_ID + "-list";
      list.className = "zen-little-window-space-menu-list";
      popup.appendChild(list);

      const noResults = doc.createXULElement("label");
      noResults.className = "zen-little-window-space-menu-no-results";
      noResults.setAttribute("value", "No spaces found");
      noResults.hidden = true;
      list.appendChild(noResults);

      const selectWorkspace = (ws) => {
        targetWorkspaceId = ws.uuid;
        updateLabel();
        try {
          popup.hidePopup();
        } catch (error) {}
      };

      const rows = [];
      workspaces.forEach(ws => {
        const item = doc.createXULElement("hbox");
        item.className = "zen-little-window-space-menu-item";
        item.setAttribute("align", "center");
        item.__littleZenWorkspace = ws;
        item.setAttribute("zen-workspace-id", ws.uuid);
        const icon = getWorkspaceDisplayIcon(ws);
        const iconIsSvg = !!icon && icon.endsWith(".svg");
        if (iconIsSvg) {
          const iconEl = doc.createXULElement("image");
          iconEl.className = "zen-little-window-space-menu-item-icon";
          iconEl.setAttribute("src", icon);
          item.appendChild(iconEl);
        } else if (icon) {
          const iconEl = doc.createXULElement("label");
          iconEl.className =
            "zen-little-window-space-menu-item-icon zen-little-window-space-menu-item-emoji";
          iconEl.setAttribute("value", icon);
          item.appendChild(iconEl);
        }
        const name = doc.createXULElement("label");
        name.className = "zen-little-window-space-menu-item-label";
        name.setAttribute("value", ws.name ?? "Space");
        name.setAttribute("crop", "end");
        name.setAttribute("flex", "1");
        item.appendChild(name);
        item.setAttribute("data-label", `${ws.name ?? ""} ${icon ?? ""}`.toLowerCase());
        if (ws.uuid === targetWorkspaceId) {
          item.setAttribute("selected", "true");
        }
        item.addEventListener("mouseenter", () => {
          setSelectedRow(item);
        });
        rows.push(item);
        list.appendChild(item);
      });

      list.addEventListener("mousedown", event => {
        if (event.button !== 0) {
          return;
        }
        let node = event.target;
        let item = null;
        while (node && node !== list) {
          if (node.classList?.contains("zen-little-window-space-menu-item")) {
            item = node;
            break;
          }
          node = node.parentNode;
        }
        if (!item?.__littleZenWorkspace) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        selectWorkspace(item.__littleZenWorkspace);
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
        if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
          event.preventDefault();
          moveSelection(1);
          return;
        }
        if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
          event.preventDefault();
          moveSelection(-1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          acceptSelection();
        }
      };

      searchInput.addEventListener("keydown", stopSearchEvent);
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

    // Ctrl/Cmd+O opens in the current target; Alt opens the Space picker.
    win.addEventListener("keydown", (e) => {
      if (
        !e.defaultPrevented &&
        !e.repeat &&
        (AppConstants.platform === "macosx" ? e.metaKey : e.ctrlKey) &&
        isLittleZenShortcutKey(e, "KeyO", "o")
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (e.altKey) {
          openMenu();
        } else {
          openSelectedWorkspace();
        }
      }
    }, true);

    // Keep label in sync when main window changes workspace
    try {
      mainWin.addEventListener("ZenWorkspaceChanged", () => {
        const activeWorkspaceId = getInitialTargetWorkspaceId(mainWin);
        if (activeWorkspaceId) {
          log("Little Zen picker target refreshed after workspace change", {
            activeWorkspaceId,
          });
          targetWorkspaceId = activeWorkspaceId;
          updateLabel();
        }
      });
    } catch (e) {}

    updateLabel();
    win.__littleZenRefreshSpacePickerTarget = refreshRouteTarget;
    win.setTimeout(refreshRouteTarget, 150);
    win.setTimeout(refreshRouteTarget, 750);

    positionLittleWindowSpacePicker(win, picker);

    // Popup stays inside picker — moving it to popupSet breaks single-click command events
  }

  function positionLittleWindowSpacePicker(win, createdPicker = null) {
    // The node is not in the document until this places it, so getElementById
    // misses the picker that was just created.
    const picker =
      win.document.getElementById("zen-little-window-space-picker") || createdPicker;
    if (!picker) {
      return;
    }

    const leftControls = syncLittleWindowControlSide(win);
    const navBar = win.document.getElementById("nav-bar");
    const target = win.document.getElementById("nav-bar-customization-target");
    const spring2 = win.document.querySelector(".customizableui-special-spring2");

    // Keep the picker inside the customization target, ordered page
    // controls, picker, urlbar. Registered toolbar widgets must stay in
    // their area: moving them out breaks CustomizableUI rebuilds.
    if (!leftControls && navBar && target?.parentElement === navBar) {
      withToolbarBatchUpdate(win, () => {
        const urlbar = win.document.getElementById("urlbar-container");
        if (urlbar?.parentElement === target) {
          for (const id of ["back-button", "forward-button", "stop-reload-button"]) {
            const item = win.document.getElementById(id);
            if (item) {
              target.insertBefore(item, urlbar);
            }
          }
          const needsMove =
            picker.parentElement !== target || picker.nextElementSibling !== urlbar;
          target.insertBefore(picker, urlbar);
          if (needsMove) {
            log("Moved Little Zen space picker left of the urlbar");
          }
          return;
        }
        if (picker.nextElementSibling !== target) {
          navBar.insertBefore(picker, target);
          log("Moved Little Zen space picker to the left of the navbar");
        }
      });
      return;
    }

    if (leftControls && spring2) {
      withToolbarBatchUpdate(win, () => {
        if (picker.parentElement !== spring2) {
          spring2.appendChild(picker);
          log("Moved Little Zen space picker into the right-side navbar spring");
        }
      });
      return;
    }

    if (navBar && picker.parentElement !== navBar) {
      navBar.appendChild(picker);
    }
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

  function attachDoubleEscapeClose(win) {
    if (win[PATCH_FLAGS.doubleEscapeClose]) {
      return;
    }

    let lastEscapeAt = 0;
    const onKeyDown = event => {
      if (!isLittleWindow(win) || event.defaultPrevented || event.key !== "Escape") {
        return;
      }

      const now = win.performance?.now?.() ?? Date.now();
      if (now - lastEscapeAt <= 520) {
        event.preventDefault();
        event.stopPropagation();
        logLittleWindowState(win, "Closing Little Zen window after double Escape");
        win.close();
        return;
      }

      lastEscapeAt = now;
      win.setTimeout(() => {
        if ((win.performance?.now?.() ?? Date.now()) - lastEscapeAt >= 520) {
          lastEscapeAt = 0;
        }
      }, 560);
    };

    win.addEventListener("keydown", onKeyDown, true);
    win.addEventListener(
      "unload",
      () => {
        try {
          win.removeEventListener("keydown", onKeyDown, true);
        } catch (error) {}
      },
      { once: true }
    );
    win[PATCH_FLAGS.doubleEscapeClose] = true;
    log("Attached Little Zen double Escape close listener");
  }

  function attachAutoClose(win) {
    if (win[PATCH_FLAGS.autoClose]) {
      return;
    }

    const urlbar = win.gURLBar;
    let resizeObserver = null;

    if (win.__littleZenStartExpanded) {
      markLittleWindowEarly(win, { expanded: true });
      applyExpandedLittleWindow(win, "expanded-startup");
      win[PATCH_FLAGS.autoClose] = true;
      logLittleWindowState(win, "Opened expanded Little Zen window");
      return;
    }

    const onOpened = () => {
      releaseLittleWindowPresentation(win, "floating-urlbar-opened");
      centerWindow(win);

      try {
        win.focus();
        urlbar?.focus();
        urlbar?.select();
        urlbar?.inputField?.focus();
      } catch (error) {
        log("Could not focus the Little Zen urlbar.", error);
      }

      logLittleWindowState(win, "Opened Little Zen floating urlbar");
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
      clearLittleWindowLoadingFallback(win);
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
            const windowWidth = Math.ceil(Math.max(width, URLBAR_WIDTH));
            const windowHeight = Math.ceil(Math.max(height, 40));
            win.resizeTo(windowWidth, windowHeight);
            logLittleWindowState(
              win,
              "Resized Little Zen window to urlbar bounds",
              { width: windowWidth, height: windowHeight }
            );
          } catch (error) {
            log("Could not resize the Little Zen window to match the urlbar.", error);
          }
        }
      });
      resizeObserver.observe(urlbar);
    }

    markLittleWindowEarly(win, {
      url: win.__littleZenPendingURL,
      meta: win.__littleZenPendingURLMeta,
    });
    win.document.documentElement.toggleAttribute("zen-no-padding", isEmptyLittleWindow(win));
    win.__littleZenLifecycleCleanup = cleanup;

    setWindowResizable(win, false);
    try {
      win.resizeTo(URLBAR_WIDTH, URLBAR_HEIGHT);
      win.focus();
      closeLittleWindowUrlbar(win, "attach-auto-close-disabled");
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
    attachLittleZenSiteColorWatchers(win);
    attachTransparentBrowserPrefSync(win);
    attachWindowControlsPrefSync(win);
    attachLittleWindowCloseButtonGuard(win);
    attachDoubleEscapeClose(win);
    syncLittleWindowTransparentBrowsers(win);
    ensureLittleWindowLoadingPulse(win);
    if (win.__littleZenStartLoadingVeil || win.__littleZenPendingURL) {
      setLittleWindowLoading(win, true, "apply-mode-startup");
    }
    syncEmptyTabState(win, "apply-mode");
    updateLittleZenBlendedTheme(win, "apply-mode");
    refreshLittleWindowLayout(win);
    attachAutoClose(win);
    if (win.__littleZenPendingURL) {
      schedulePendingNavigationFlush(win, "apply-mode");
    } else if (!win.__littleZenSuppressUrlbarFocus) {
      closeLittleWindowUrlbar(win, "apply-mode-urlbar-disabled");
    }
    ensureSpacePicker(win);
    logLittleWindowState(win, "Applied Little Zen mode");
  }

  function whenStartupReady(win, callback) {
    if (win.gBrowserInit?.delayedStartupFinished) {
      win.__littleZenStartupReady = true;
      callback();
      return;
    }

    const observer = new win.MutationObserver(() => {
      if (!win.gBrowserInit?.delayedStartupFinished) {
        return;
      }
      observer.disconnect();
      win.__littleZenStartupReady = true;
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
      LittleZen.openLittleWindow(win, { expanded: true, source: "command" });
    });
    commandSet.appendChild(command);
    log("Injected cmd_zenNewLittleWindow command");
  }

  function isLittleZenShortcutKey(event, code, key) {
    // Option remaps event.key on macOS (Option+N is "~"), but event.code stays KeyN.
    if (AppConstants.platform === "macosx" && event.code === code) {
      return true;
    }
    return event.key?.toLowerCase() === key;
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
        (AppConstants.platform !== "macosx" && event.getModifierState("AltGraph")) ||
        !event.altKey ||
        !isAccelPressed(event) ||
        !isLittleZenShortcutKey(event, "KeyN", "n")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      LittleZen.openLittleWindow(win, { expanded: true, source: "shortcut" });
    };

    win.addEventListener("keydown", onKeyDown, true);
    win[PATCH_FLAGS.keyListener] = true;
    log("Attached fallback Little Zen shortcut listener");
  }

  function patchContentLinkShortcut() {
    if (ClickHandlerParent[PATCH_FLAGS.contentLinkListener]) {
      return;
    }

    const originalContentAreaClick = ClickHandlerParent.prototype.contentAreaClick;
    ClickHandlerParent.prototype.contentAreaClick = function (event) {
      const usesAccel = AppConstants.platform === "macosx" ? event.metaKey : event.ctrlKey;
      if (
        event.button !== 0 ||
        event.shiftKey ||
        !event.altKey ||
        !usesAccel
      ) {
        return originalContentAreaClick.call(this, event);
      }

      const browser = this.manager.browsingContext.top.embedderElement;
      const opener = browser?.documentGlobal;
      if (!event.href || !isBrowserWindow(opener)) {
        return originalContentAreaClick.call(this, event);
      }

      LittleZen.openLittleWindow(opener, {
        url: event.href,
        source: "ctrl-alt-click",
        triggeringPrincipal: event.triggeringPrincipal,
      });
      return undefined;
    };

    ClickHandlerParent[PATCH_FLAGS.contentLinkListener] = true;
    log("Patched remote content Ctrl+Alt+click handling");
  }

  function attachMainTabShortcut(win) {
    if (isLittleWindow(win) || win[PATCH_FLAGS.tabClickListener]) {
      return;
    }

    const getShortcutTab = event => {
      const usesAccel =
        AppConstants.platform === "macosx" ? event.metaKey : event.ctrlKey;
      const tab = event.target?.closest?.(".tabbrowser-tab");
      if (
        event.button !== 0 ||
        event.shiftKey ||
        !event.altKey ||
        !usesAccel ||
        !tab
      ) {
        return null;
      }

      const url = tab.linkedBrowser?.currentURI?.spec;
      if (!url || url === "about:blank" || url === "about:newtab") {
        return null;
      }

      return { tab, url };
    };

    const onMouseDown = event => {
      const target = getShortcutTab(event);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      LittleZen.openLittleWindow(win, {
        url: target.url,
        source: "ctrl-alt-tab-click",
        triggeringPrincipal: target.tab.linkedBrowser?.contentPrincipal,
      });
    };

    const onClick = event => {
      if (!getShortcutTab(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    win.gBrowser?.tabContainer?.addEventListener("mousedown", onMouseDown, true);
    win.gBrowser?.tabContainer?.addEventListener("click", onClick, true);
    win[PATCH_FLAGS.tabClickListener] = true;
    log("Attached main-window Ctrl+Alt+tab click handling");
  }

  const LittleZen = {
    queueNavigation(win, url, meta = {}) {
      if (!url) {
        delete win.__littleZenSuppressUrlbarFocus;
        return;
      }

      win.__littleZenSuppressUrlbarFocus = true;
      markLittleWindowEarly(win, { url, meta });
      setLittleWindowLoading(win, true, "queue-navigation");
      closeLittleWindowUrlbar(win, "queue-navigation");
      routeLog("Queued Little Zen navigation", {
        url,
        source: meta.source ?? "unknown",
      });
      try {
        win.__littleZenRefreshSpacePickerTarget?.();
      } catch (error) {
        log("Could not refresh Little Zen routed workspace target", error);
      }

      if (win.__littleZenStartupReady) {
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
      const {
        url = null,
        source = "manual",
        triggeringPrincipal = null,
        expanded = false,
      } = options;
      log("Little Zen open request", {
        source,
        url,
      });

      for (const browserWindow of browserWindows()) {
        if (isEmptyLittleWindow(browserWindow)) {
          log("Reusing existing empty Little Zen window");
          if (expanded) {
            applyExpandedLittleWindow(browserWindow, "expanded-reuse");
          }
          this.queueNavigation(browserWindow, url, { source, triggeringPrincipal });
          browserWindow.focus();
          if (!url && !expanded) {
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
        url,
        expanded,
      });

      if (littleWindow) {
        this.queueNavigation(littleWindow, url, { source, triggeringPrincipal });
        if (expanded) {
          whenStartupReady(littleWindow, () => {
            applyExpandedLittleWindow(littleWindow, "expanded-request");
          });
        }
        if (!littleWindow.__littleZenHeldHidden) {
          littleWindow.focus();
        }
      }

      return littleWindow;
    },
  };

  function bootstrapWindow(win) {
    if (!isBrowserWindow(win) || win[PATCH_FLAGS.window]) {
      return;
    }

    installLittleWindowDocumentMark(win);

    const redirectExternalStartup =
      !isLittleWindow(win) &&
      isExternalStartupWindow(win) &&
      [...browserWindows()].some(
        browserWindow => browserWindow !== win && !isLittleWindow(browserWindow)
      );
    if (redirectExternalStartup) {
      patchOpenBrowserWindow(win);
      const url = getExternalStartupUrl(win);
      if (!url) {
        log("External startup URL not available yet; waiting for browser startup");
      }
    }

    win[PATCH_FLAGS.window] = true;
    win.LittleZen = LittleZen;

    patchBrowserDOMWindow(win);
    patchOpenBrowserWindow(win);
    patchContentLinkShortcut();
    attachMainTabShortcut(win);
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
      if (redirectExternalStartup) {
        let attempts = 0;
        const redirect = () => {
          if (win.closed) {
            return;
          }

          const url = getLittleWindowUrl(win);
          if (!url) {
            if (++attempts < 100) {
              win.setTimeout(redirect, 50);
            } else {
              log("External startup URL did not become available; keeping normal window");
            }
            return;
          }

          const keepNormalWindow = () => {
            patchCompactModeManager(win);
            patchVerticalTabsManager(win);
            patchZenUIManager(win);
            patchUrlbar(win);
          };
          if (!shouldOpenExternalLinkInLittleZen(url)) {
            keepNormalWindow();
            return;
          }
          probeDirectDownload(url).then(isDownload => {
            if (win.closed) {
              return;
            }
            if (isDownload) {
              log("Skipping Little Zen after checking the response", { url });
              keepNormalWindow();
              return;
            }
            LittleZen.openLittleWindow(win, {
              url,
              source: "external-startup-window",
              expanded: true,
            });
            win.close();
          });
        };
        redirect();
        return;
      }

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

  attachDownloadBypass();
  bootstrapWindow(window);
  log("Little Zen runtime backport loaded.");
})();
