// ==UserScript==
// @name        Little Zen - Custom Window Handler
// @description Intercepts external tab opens and creates custom windows
// @include     main
// ==/UserScript==

(function() {
    'use strict';
    
    // Services is available globally in Firefox chrome context
    
    class LittleZenHandler {
        constructor() {
            this.customWindows = new Set();
            this.originalBrowserDOMWindow = null;
            this.browserWindow = null;
            this.init();
        }
        
        init() {
            console.log("[LittleZen] Initializing custom window handler");
            this.setupBrowserDOMWindowInterception();
        }
        
        setupBrowserDOMWindowInterception() {
            const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
            const recentWindow = wm.getMostRecentWindow("navigator:browser");
            
            if (!recentWindow) {
                console.warn("[LittleZen] No browser window found");
                return;
            }
            
            this.browserWindow = recentWindow;
            
            // Store reference to original browserDOMWindow
            this.originalBrowserDOMWindow = recentWindow.browserDOMWindow;
            
            if (!this.originalBrowserDOMWindow) {
                console.warn("[LittleZen] No browserDOMWindow found");
                return;
            }
            
            // Create wrapper object that implements nsIBrowserDOMWindow
            const self = this;
            const wrappedBrowserDOMWindow = {
                // Delegate all properties to original
                __proto__: this.originalBrowserDOMWindow,
                
                // Override openURI method
                openURI: function(aURI, aOpener, aWhere, aContext, aTriggeringPrincipal, aCsp) {
                    console.log("[LittleZen] openURI called with:", {
                        uri: aURI ? aURI.spec : "null",
                        where: aWhere,
                        context: aContext,
                        isExternalContext: aContext === Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL,
                        whereNewWindow: aWhere === Ci.nsIBrowserDOMWindow.OPEN_NEWWINDOW,
                        whereNewTab: aWhere === Ci.nsIBrowserDOMWindow.OPEN_NEWTAB
                    });
                    
                    // Primary check: context parameter (most reliable for external calls)
                    const isExternalContext = (aContext === Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL);
                    
                    // Secondary check: flags parameter (fallback for some cases)
                    // Note: aContext might actually be aFlags in some Firefox versions
                    const hasExternalFlag = (typeof aContext === 'number' && 
                        (aContext & Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL));
                    
                    const isExternalCall = isExternalContext || hasExternalFlag;
                    
                    if (isExternalCall) {
                        console.log("[LittleZen] External URI detected, intercepting:", aURI.spec);
                        console.log("[LittleZen] Detection method:", isExternalContext ? "context" : "flags");
                        
                        // Prevent focus stealing by not calling the original method
                        // Instead, open our custom window
                        self.openCustomWindow(aURI.spec);
                        
                        // Return null to indicate we handled the request
                        // This prevents the main browser from opening a tab
                        return null;
                    }
                    
                    // For non-external requests, delegate to original implementation
                    return self.originalBrowserDOMWindow.openURI.call(
                        self.originalBrowserDOMWindow,
                        aURI, aOpener, aWhere, aContext, aTriggeringPrincipal, aCsp
                    );
                },
                
                // Override openURIInFrame method if it exists
                openURIInFrame: function(aURI, aParams, aWhere, aContext, aName) {
                    // Primary check: context parameter
                    const isExternalContext = (aContext === Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL);
                    
                    // Secondary check: flags parameter (fallback)
                    const hasExternalFlag = (typeof aContext === 'number' && 
                        (aContext & Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL));
                    
                    const isExternalCall = isExternalContext || hasExternalFlag;
                    
                    if (isExternalCall) {
                        console.log("[LittleZen] External URI in frame detected, intercepting:", aURI.spec);
                        self.openCustomWindow(aURI.spec);
                        return null;
                    }
                    
                    // Delegate to original if it exists
                    if (self.originalBrowserDOMWindow.openURIInFrame) {
                        return self.originalBrowserDOMWindow.openURIInFrame.call(
                            self.originalBrowserDOMWindow,
                            aURI, aParams, aWhere, aContext, aName
                        );
                    }
                    
                    return null;
                },
                
                // Ensure we implement the nsIBrowserDOMWindow interface properly
                QueryInterface: function(iid) {
                    if (iid.equals(Ci.nsIBrowserDOMWindow) || 
                        iid.equals(Ci.nsISupports)) {
                        return this;
                    }
                    throw Components.Exception("", Cr.NS_ERROR_NO_INTERFACE);
                }
            };
            
            // Replace the browserDOMWindow with our wrapper
            recentWindow.browserDOMWindow = wrappedBrowserDOMWindow;
            
            console.log("[LittleZen] browserDOMWindow interception setup complete");
        }
        
        openCustomWindow(url) {
            try {
                console.log("[LittleZen] Opening custom window for:", url);
                
                // For chrome:// URLs, we need to pass the URL as window arguments
                const args = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
                const urlString = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
                urlString.data = url;
                args.appendElement(urlString);
                
                console.log("[LittleZen] Created arguments array with URL:", urlString.data);
                
                const windowURL = this.getCustomWindowURL();
                console.log("[LittleZen] Window URL:", windowURL);
                
                // Use Services.ww.openWindow for proper chrome window creation
                const customWindow = Services.ww.openWindow(
                    null, // parent window (null for top-level)
                    windowURL, // chrome URL
                    "_blank", // window name
                    "chrome,resizable=yes,scrollbars=yes,status=yes,width=1200,height=800", // features
                    args // arguments containing the URL
                );
                
                if (customWindow) {
                    this.customWindows.add(customWindow);
                    console.log("[LittleZen] Custom window created successfully");
                    
                    // Set the sync flag immediately after window creation
                    customWindow._zenStartupSyncFlag = "synced";
                    
                    // Ensure the custom window gets focus instead of the main browser
                    customWindow.addEventListener('load', () => {
                        try {
                            // Set focus to the new window
                            customWindow.focus();
                            
                            // Bring window to front without setting read-only properties
                            if (customWindow.gBrowser) {
                                customWindow.gBrowser.selectedBrowser.focus();
                            }
                            
                            console.log("[LittleZen] Custom window focused successfully");
                        } catch (e) {
                            // Focus management is not critical, just log and continue
                            console.log("[LittleZen] Focus set via window.focus()");
                        }
                    });
                    
                    // Clean up reference when window closes
                    customWindow.addEventListener('beforeunload', () => {
                        this.customWindows.delete(customWindow);
                    });
                    
                    return customWindow;
                } else {
                    console.error("[LittleZen] Failed to open custom window");
                    return null;
                }
                
            } catch (error) {
                console.error("[LittleZen] Error opening custom window:", error);
                return null;
            }
        }
        
        getCustomWindowURL() {
            // Use chrome:// protocol for proper chrome window creation
            return "chrome://sine/content/little-zen/window/custom-window.xhtml";
        }
        
        observe(subject, topic, _data) {
            // This method can be removed or used for other purposes
            // since we're now intercepting at the browserDOMWindow level
        }
        
        // Restore original browserDOMWindow on cleanup
        restoreBrowserDOMWindow() {
            if (this.browserWindow && this.originalBrowserDOMWindow) {
                try {
                    this.browserWindow.browserDOMWindow = this.originalBrowserDOMWindow;
                    console.log("[LittleZen] browserDOMWindow restored");
                } catch (e) {
                    console.warn("[LittleZen] Error restoring browserDOMWindow:", e);
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
        
        // Method to test external tab detection (for debugging)
        testExternalDetection(url) {
            console.log("[LittleZen] Testing external detection with URL:", url);
            this.openCustomWindow(url);
        }
        
        // Get information about the current browserDOMWindow setup
        getBrowserDOMWindowInfo() {
            return {
                hasOriginal: !!this.originalBrowserDOMWindow,
                isWrapped: this.browserWindow && this.browserWindow.browserDOMWindow !== this.originalBrowserDOMWindow,
                customWindowsCount: this.customWindows.size
            };
        }
        
        // Method to manually restore browserDOMWindow (for debugging)
        manualRestore() {
            this.restoreBrowserDOMWindow();
        }
        
        // Debug method to log browserDOMWindow constants
        logBrowserDOMWindowConstants() {
            console.log("[LittleZen] browserDOMWindow Constants:", {
                OPEN_DEFAULTWINDOW: Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW,
                OPEN_CURRENTWINDOW: Ci.nsIBrowserDOMWindow.OPEN_CURRENTWINDOW,
                OPEN_NEWWINDOW: Ci.nsIBrowserDOMWindow.OPEN_NEWWINDOW,
                OPEN_NEWTAB: Ci.nsIBrowserDOMWindow.OPEN_NEWTAB,
                OPEN_EXTERNAL: Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL,
                LOAD_FLAGS_FROM_EXTERNAL: Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL
            });
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
            window.littleZenHandler.restoreBrowserDOMWindow();
        }
    });
    
})();