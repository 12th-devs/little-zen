// ==UserScript==
// @name        Little Zen - Custom Window Handler
// @description Intercepts external tab opens and creates custom windows
// @include     main
// ==/UserScript==

(function() {
    'use strict';
    
    const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
    
    class LittleZenHandler {
        constructor() {
            this.customWindows = new Set();
            this.init();
        }
        
        init() {
            console.log("[LittleZen] Initializing custom window handler");
            this.setupTabInterception();
            this.setupExternalLinkHandler();
        }
        
        setupTabInterception() {
            const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
            const recentWindow = wm.getMostRecentWindow("navigator:browser");
            
            if (!recentWindow) {
                console.warn("[LittleZen] No browser window found");
                return;
            }
            
            // Listen for new tabs
            recentWindow.gBrowser.tabContainer.addEventListener("TabOpen", (event) => {
                const tab = event.target;
                const browser = tab.linkedBrowser;
                
                // Check if this is an external tab (from another app)
                if (this.isExternalTab(tab)) {
                    console.log("[LittleZen] External tab detected, creating custom window");
                    
                    // Get the URL that would be loaded
                    const url = browser.currentURI?.spec || browser.getAttribute("src");
                    
                    if (url && url !== "about:blank") {
                        // Prevent the tab from loading in the main browser
                        event.preventDefault();
                        
                        // Close the tab
                        recentWindow.gBrowser.removeTab(tab);
                        
                        // Open custom window instead
                        this.openCustomWindow(url);
                    }
                }
            }, true);
        }
        
        setupExternalLinkHandler() {
            // Listen for external protocol handlers
            Services.obs.addObserver(this, "http-on-opening-request", false);
        }
        
        isExternalTab(tab) {
            // Check various indicators that this tab came from an external source
            return (
                !tab.ownerTab && // No parent tab
                tab.getAttribute("toplevel") === "true" || // Top-level navigation
                tab.hasAttribute("external") || // Explicitly marked as external
                tab.getAttribute("usercontextid") === null // No container context
            );
        }
        
        openCustomWindow(url) {
            try {
                const windowPath = this.getCustomWindowPath();
                const encodedUrl = encodeURIComponent(url);
                const windowUrl = `file://${windowPath}?url=${encodedUrl}`;
                
                console.log("[LittleZen] Opening custom window for:", url);
                
                const customWindow = window.open(
                    windowUrl,
                    "_blank",
                    "width=1200,height=800,resizable=yes,scrollbars=yes,status=yes,location=yes,menubar=no,toolbar=no"
                );
                
                if (customWindow) {
                    this.customWindows.add(customWindow);
                    
                    // Clean up reference when window closes
                    customWindow.addEventListener('beforeunload', () => {
                        this.customWindows.delete(customWindow);
                    });
                } else {
                    console.error("[LittleZen] Failed to open custom window, falling back to regular tab");
                    this.fallbackToRegularTab(url);
                }
                
            } catch (error) {
                console.error("[LittleZen] Error opening custom window:", error);
                this.fallbackToRegularTab(url);
            }
        }
        
        getCustomWindowPath() {
            // Get the profile directory path
            const profileDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
            const windowPath = profileDir.path + "\\chrome\\sine-mods\\little-zen\\window\\custom-window.html";
            return windowPath.replace(/\\/g, '/');
        }
        
        fallbackToRegularTab(url) {
            // If custom window fails, open in regular tab
            const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
            const recentWindow = wm.getMostRecentWindow("navigator:browser");
            
            if (recentWindow) {
                recentWindow.gBrowser.addTab(url);
            }
        }
        
        observe(subject, topic, data) {
            if (topic === "http-on-opening-request") {
                // Handle HTTP requests that might be from external sources
                const httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
                const loadInfo = httpChannel.loadInfo;
                
                if (loadInfo && loadInfo.externalContentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT) {
                    // This might be an external request
                    console.log("[LittleZen] External HTTP request detected:", httpChannel.URI.spec);
                }
            }
        }
        
        // Public API for manual custom window creation
        createCustomWindow(url) {
            this.openCustomWindow(url);
        }
        
        // Get all active custom windows
        getCustomWindows() {
            return Array.from(this.customWindows);
        }
        
        // Close all custom windows
        closeAllCustomWindows() {
            this.customWindows.forEach(window => {
                if (!window.closed) {
                    window.close();
                }
            });
            this.customWindows.clear();
        }
    }
    
    // Initialize the handler
    if (gBrowserInit.delayedStartupFinished) {
        window.littleZenHandler = new LittleZenHandler();
    } else {
        let observer = new MutationObserver(() => {
            if (gBrowserInit.delayedStartupFinished) {
                observer.disconnect();
                window.littleZenHandler = new LittleZenHandler();
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    }
    
    // Cleanup on window unload
    window.addEventListener('beforeunload', () => {
        if (window.littleZenHandler) {
            window.littleZenHandler.closeAllCustomWindows();
            Services.obs.removeObserver(window.littleZenHandler, "http-on-opening-request");
        }
    });
    
})();