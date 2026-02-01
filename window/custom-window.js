// Little Zen Custom Window JavaScript
// CRITICAL: Set Zen Sync Flag immediately at global scope
window._zenStartupSyncFlag = "synced";

// CRITICAL: Suppress CustomizableUI "non-browser window" warnings
window.isChromeWindow = true;
window.TOOLBAR_REORDERABLE = false;

// CRITICAL: Prevent CustomizableUI errors by overriding early
(function preventCustomizableUIErrors() {
    // Override CustomizableUI methods before they can cause errors
    const originalCustomizableUI = window.CustomizableUI;
    
    // Create a more comprehensive proxy to intercept CustomizableUI calls
    window.CustomizableUI = new Proxy(originalCustomizableUI || {}, {
        get: function(target, prop) {
            // Block all widget building methods
            if (prop === 'buildWidget' || prop === 'buildWidgetNode' || prop === 'createWidget') {
                return function(...args) {
                    console.log('[Little Zen Window] Blocked CustomizableUI.' + prop + ' call');
                    return null;
                };
            }
            if (prop === 'isWindowSupported') {
                return function(win) {
                    // Return false for our window to prevent CustomizableUI from trying to manage it
                    if (win === window) {
                        console.log('[Little Zen Window] CustomizableUI.isWindowSupported called for our window - returning false');
                        return false;
                    }
                    return target[prop] ? target[prop].call(target, win) : false;
                };
            }
            // Block other potentially problematic methods
            if (prop === 'registerWindow' || prop === 'unregisterWindow') {
                return function(...args) {
                    console.log('[Little Zen Window] Blocked CustomizableUI.' + prop + ' call');
                    return;
                };
            }
            return target[prop];
        }
    });
    
    // Also override at the global level to catch any direct access
    if (typeof globalThis !== 'undefined') {
        globalThis.CustomizableUI = window.CustomizableUI;
    }
    
    console.log('[Little Zen Window] CustomizableUI error prevention initialized');
})();

// CRITICAL: Initialize gNotificationBox immediately to prevent ProcessHangMonitor crashes
window.gNotificationBox = {
    getNotificationWithValue: () => null,
    appendNotification: () => {}
};

// CRITICAL: Add PrivateBrowsingUtils for compatibility checks
try {
    if (!window.PrivateBrowsingUtils) {
        ChromeUtils.defineESModuleGetters(window, {
            PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
        });
    }
} catch (e) {
    console.warn('[Little Zen Window] Could not load PrivateBrowsingUtils:', e);
    // Create a fallback
    window.PrivateBrowsingUtils = {
        isWindowPrivate: () => false
    };
}

// CRITICAL: Mock the Zen Workspace Manager for adoptTab compatibility
window.gZenWorkspaces = {
    currentWindowIsSyncing: false,
    getSelectedWorkspace: () => ({ 
        id: window.LittleZenWindowInstance?.selectedWorkspaceId || 'default',
        uuid: window.LittleZenWindowInstance?.selectedWorkspaceId || 'default',
        name: 'Little Zen Window'
    }),
    isWorkspaceVisible: () => true,
    getActiveWorkspace: () => ({
        id: window.LittleZenWindowInstance?.selectedWorkspaceId || 'default',
        uuid: window.LittleZenWindowInstance?.selectedWorkspaceId || 'default',
        name: 'Little Zen Window'
    }),
    getWorkspaceFromId: (id) => ({
        id: id,
        uuid: id,
        name: 'Workspace'
    }),
    // Additional methods to prevent crashes
    changeWorkspace: () => Promise.resolve(),
    getWorkspaces: () => [],
    createWorkspace: () => null,
    removeWorkspace: () => null
};

// CRITICAL: Initialize gBrowser shim immediately to prevent race conditions
// This must happen before any Firefox services try to access window.gBrowser
(function initializeImmediateGBrowserShim() {
    // Create mock tabContainer with proper hierarchy support
    const tabContainerMock = document.getElementById("tabbrowser-tabs") || {
        addEventListener: () => {},
        removeEventListener: () => {},
        allTabs: [],
        ownerDocument: document,
        ownerGlobal: window,
        // Additional properties for extension compatibility
        childNodes: [],
        children: [],
        appendChild: function(child) {
            this.childNodes.push(child);
            this.children.push(child);
            this.allTabs.push(child);
            return child;
        },
        removeChild: function(child) {
            const index = this.childNodes.indexOf(child);
            if (index > -1) {
                this.childNodes.splice(index, 1);
                this.children.splice(index, 1);
                this.allTabs.splice(index, 1);
            }
            return child;
        }
    };

    // Create mock selectedTab object with robust Tab Proxy and proper parent hierarchy
    const mockSelectedTab = {
        get linkedBrowser() {
            const browser = document.getElementById('web-content');
            // Ensure the browser has an image property for getIcon compatibility
            if (browser && !browser.image) {
                browser.image = null; // Default to null, can be updated when favicon loads
            }
            return browser;
        },
        get parentNode() { 
            return tabContainerMock; // Crucial for ext-browser.js
        },
        ownerGlobal: window,
        ownerDocument: document,
        getAttribute: (attr) => {
            if (attr === 'zen-workspace-id') {
                return window.zenWindow?.selectedWorkspaceId || '';
            }
            if (attr === 'usercontextid') {
                return null;
            }
            if (attr === 'pending') {
                return null;
            }
            if (attr === 'remote') {
                return 'true'; // Required for adoptTab
            }
            if (attr === 'draggable') {
                return 'true'; // Required for adoptTab
            }
            return 'synced';
        },
        setAttribute: (attr, value) => {
            if (attr === 'zen-workspace-id' && window.zenWindow) {
                window.zenWindow.selectedWorkspaceId = value;
            }
        },
        hasAttribute: (attr) => {
            if (attr === 'zen-workspace-id') return true;
            if (attr === 'usercontextid') return false;
            if (attr === 'pending') return false;
            if (attr === 'remote') return true;
            if (attr === 'draggable') return true;
            return attr === 'synced';
        },
        removeAttribute: () => {},
        id: 'little-zen-mock-tab',
        selected: true,
        pinned: false,
        closing: false, // Critical for adoptTab
        _fullyOpen: true,
        _zenContentsVisible: true,
        _tPos: 0, // Critical for adoptTab - tab position
        mOverCloseButton: false, // Critical for adoptTab
        // Additional properties for extension compatibility
        container: null,
        userContextId: 0,
        multiselected: false,
        hidden: false,
        muted: false,
        soundPlaying: false,
        // Extension state properties
        image: null, // Tab favicon
        label: 'Little Zen Window', // Tab title
        tooltipText: 'Little Zen Window',
        crop: 'end',
        busy: false,
        progress: false,
        // Critical properties for tab adoption
        _tabData: {}, // Tab session data
        _zenWorkspaceId: null, // Zen workspace tracking
        // Browser element properties that might be checked during adoption
        get browser() {
            return this.linkedBrowser;
        },
        // Methods that might be called during adoption
        focus: () => {
            const browser = document.getElementById('web-content');
            if (browser) browser.focus();
        },
        blur: () => {},
        // Event handling
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        // Parent hierarchy methods
        appendChild: () => {},
        removeChild: () => {},
        insertBefore: () => {},
        // Extension compatibility methods
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
        scrollIntoView: () => {},
        // Tab state methods
        getTabModalPromptBox: () => null,
        linkedPanel: null,
        // Additional adoption compatibility methods
        cloneNode: () => mockSelectedTab, // Return self for cloning operations
        isEqualNode: (other) => other === mockSelectedTab,
        isSameNode: (other) => other === mockSelectedTab
    };

    // Attach the mock tab to the container to establish proper hierarchy
    tabContainerMock.appendChild(mockSelectedTab);
    tabContainerMock.allTabs = [mockSelectedTab];

    // Create gBrowser shim with all required properties and methods
    window.gBrowser = {
        get selectedBrowser() {
            return document.getElementById('web-content');
        },
        get tabContainer() {
            return tabContainerMock;
        },
        selectedTab: mockSelectedTab,
        
        // Progress listener management for tabs.sys.mjs
        _tabFilters: new Map(),
        _tabListeners: new Map(),
        
        addProgressListener: function() {
            // No-op for telemetry compatibility
        },
        
        removeProgressListener: function() {
            // No-op for telemetry compatibility
        },
        
        // Tab management methods
        getTabForBrowser: function(browser) {
            const webContent = document.getElementById('web-content');
            return (browser === webContent) ? mockSelectedTab : null;
        },
        
        getBrowserForTab: function(tab) {
            if (tab === mockSelectedTab) {
                return document.getElementById('web-content');
            }
            return null;
        },
        
        replaceTab: function(oldTab, newTab) {
            console.log('[Little Zen Window] gBrowser.replaceTab called (no-op in shim)');
            return newTab;
        },
        
        // WebExtension API compatibility methods
        getTabSharingState: function(tab) {
            // Return sharing state object with all permissions set to false
            return {
                camera: false,
                microphone: false,
                screen: false,
                audio: false
            };
        },
        
        getIcon: function(tab) {
            // Return the icon from the tab's linkedBrowser if available
            if (tab && tab.linkedBrowser && tab.linkedBrowser.image) {
                return tab.linkedBrowser.image;
            }
            return null;
        },
        
        addTab: function(url, options = {}) {
            console.log('[Little Zen Window] gBrowser.addTab called (redirecting to main window)');
            const mainWindow = Services.wm.getMostRecentWindow("navigator:browser");
            if (mainWindow?.gBrowser) {
                return mainWindow.gBrowser.addTab(url, options);
            }
            return null;
        },
        
        removeTab: function(tab, options = {}) {
            console.log('[Little Zen Window] gBrowser.removeTab called');
            if (tab === mockSelectedTab) {
                window.close();
            }
        },
        
        // Browser swap method for Zen Window Sync with enhanced error handling
        swapBrowsersAndCloseOther: function(ourTab, otherTab, animate = false) {
            console.log('[Little Zen Window] swapBrowsersAndCloseOther called:', {
                ourTab: ourTab?.id,
                otherTab: otherTab?.id,
                animate,
                ourTabOwnerGlobal: !!ourTab?.ownerGlobal,
                otherTabOwnerGlobal: !!otherTab?.ownerGlobal
            });
            
            try {
                // Validate tab objects have required properties
                if (!ourTab?.linkedBrowser) {
                    console.error('[Little Zen Window] ourTab missing linkedBrowser');
                    return;
                }
                
                if (!otherTab?.linkedBrowser) {
                    console.error('[Little Zen Window] otherTab missing linkedBrowser');
                    return;
                }
                
                if (!ourTab.ownerGlobal) {
                    console.error('[Little Zen Window] ourTab missing ownerGlobal');
                    return;
                }
                
                if (!otherTab.ownerGlobal) {
                    console.error('[Little Zen Window] otherTab missing ownerGlobal');
                    return;
                }
                
                const mainWindow = Services.wm.getMostRecentWindow("navigator:browser");
                if (!mainWindow?.gBrowser) {
                    console.error('[Little Zen Window] No main window gBrowser found for swap');
                    return;
                }
                
                console.log('[Little Zen Window] Performing browser swap via main window');
                
                // Ensure both tabs have the required internal structures before swap
                if (ourTab === mockSelectedTab) {
                    // Update our mock tab with current browser state
                    const browser = ourTab.linkedBrowser;
                    if (browser?.currentURI) {
                        console.log('[Little Zen Window] Updating mock tab with current URI:', browser.currentURI.spec);
                    }
                }
                
                // Perform the actual swap in the main window
                mainWindow.gBrowser.swapBrowsersAndCloseOther(ourTab, otherTab, animate);
                
                // Update local state if our tab was involved
                if (ourTab === mockSelectedTab && ourTab.linkedBrowser?.currentURI && window.zenWindow) {
                    window.zenWindow.currentUrl = ourTab.linkedBrowser.currentURI.spec;
                    const urlInput = document.getElementById('url-input');
                    if (urlInput) {
                        urlInput.value = window.zenWindow.currentUrl;
                    }
                }
                
                console.log('[Little Zen Window] Browser swap completed successfully');
                
            } catch (error) {
                console.error('[Little Zen Window] Error in swapBrowsersAndCloseOther:', error);
                console.error('[Little Zen Window] Error stack:', error.stack);
            }
        },
        
        // Type checking methods
        isTab: function(element) {
            return element === mockSelectedTab;
        },
        
        isTabGroup: function() {
            return false;
        },
        
        // Browser selection methods
        get selectedBrowsers() {
            const webContent = document.getElementById('web-content');
            return webContent ? [webContent] : [];
        },
        
        // Tab collection with consistent hierarchy
        get tabs() {
            return tabContainerMock.allTabs;
        },
        
        // Additional methods for extension compatibility
        addTabsProgressListener: function() {
            console.log('[Little Zen Window] addTabsProgressListener called (no-op)');
        },
        
        removeTabsProgressListener: function() {
            console.log('[Little Zen Window] removeTabsProgressListener called (no-op)');
        },
        
        // WebExtension tab state methods
        getTabModalPromptBox: function(tab) {
            return null; // No modal prompts in Little Zen Window
        },
        
        getNotificationBox: function(browser) {
            return window.gNotificationBox; // Return our mock notification box
        },
        
        // Tab visibility and state methods
        hideTab: function(tab) {
            console.log('[Little Zen Window] hideTab called (no-op)');
        },
        
        showTab: function(tab) {
            console.log('[Little Zen Window] showTab called (no-op)');
        },
        
        // Extension API compatibility
        getTabValue: function(tab, key) {
            return null; // No stored values in mock tabs
        },
        
        setTabValue: function(tab, key, value) {
            console.log('[Little Zen Window] setTabValue called (no-op)');
        },
        
        deleteTabValue: function(tab, key) {
            console.log('[Little Zen Window] deleteTabValue called (no-op)');
        },
        
        // Tab adoption method for Little Zen Window compatibility
        adoptTab: function(tab, index = 0, selectTab = false) {
            console.log('[Little Zen Window] adoptTab called in shim - delegating to main window');
            
            // This should never be called on the Little Zen Window's gBrowser shim
            // Instead, the main window's gBrowser.adoptTab should be called directly
            const mainWindow = Services.wm.getMostRecentWindow("navigator:browser");
            if (mainWindow?.gBrowser?.adoptTab) {
                console.log('[Little Zen Window] Delegating adoptTab to main window');
                return mainWindow.gBrowser.adoptTab(tab, index, selectTab);
            } else {
                console.error('[Little Zen Window] Main window adoptTab not available');
                return null;
            }
        },
        
        // Additional methods that extensions commonly call
        setIcon: function(tab, iconURL) {
            console.log('[Little Zen Window] setIcon called (no-op)');
            if (tab && iconURL) {
                tab.image = iconURL;
            }
        },
        
        getCachedFindBar: function(tab) {
            console.log('[Little Zen Window] getCachedFindBar called (returning null)');
            return null;
        },
        
        isFindBarInitialized: function(tab) {
            console.log('[Little Zen Window] isFindBarInitialized called (returning false)');
            return false;
        },
        
        getFindBar: function(tab) {
            console.log('[Little Zen Window] getFindBar called (returning null promise)');
            return Promise.resolve(null);
        },
        
        // Tab state methods
        getTabValue: function(tab, key) {
            return null; // No stored values in mock tabs
        },
        
        setTabValue: function(tab, key, value) {
            console.log('[Little Zen Window] setTabValue called (no-op)');
        },
        
        deleteTabValue: function(tab, key) {
            console.log('[Little Zen Window] deleteTabValue called (no-op)');
        }
    };

    // Create gBrowserInit shim for extensions with adoption tracking
    window.gBrowserInit = {
        delayedStartupFinished: true,
        isInitialWindow: false,
        getTabToAdopt: function() {
            return null;
        },
        isAdoptingTab: function() {
            return window._isAdoptingFlag || false;
        }
    };

    console.log('[Little Zen Window] Immediate gBrowser shim initialized');
})();

// CRITICAL: Initialize CustomizableUI compatibility to prevent "non-browser window" errors
(function initializeCustomizableUICompatibility() {
    // Mock CustomizableUI for this window to prevent extension errors
    if (typeof CustomizableUI !== 'undefined') {
        try {
            // Override the window type detection for CustomizableUI
            const originalIsWindowSupported = CustomizableUI.isWindowSupported;
            if (originalIsWindowSupported) {
                CustomizableUI.isWindowSupported = function(win) {
                    // Always return true for our Little Zen Window
                    if (win === window) {
                        return true;
                    }
                    return originalIsWindowSupported.call(this, win);
                };
            }
            
            // Mock the window registration if needed
            if (CustomizableUI.registerWindow) {
                CustomizableUI.registerWindow(window);
            }
            
            console.log('[Little Zen Window] CustomizableUI compatibility initialized');
        } catch (e) {
            console.warn('[Little Zen Window] Could not initialize CustomizableUI compatibility:', e);
        }
    }
    
    // Add window identification properties that CustomizableUI checks
    window.gNavToolbox = document.getElementById('navigation-bar') || {
        palette: document.createElement('toolbarpalette')
    };
    
    // Mock toolbar customization properties
    window.gCustomizeMode = {
        _handler: null,
        enter: () => {},
        exit: () => {},
        toggle: () => {}
    };
    
    // Add browser window identification
    window._gBrowser = window.gBrowser; // Reference for CustomizableUI
    
    // Add gFissionBrowser for compatibility checks
    if (typeof window.gFissionBrowser === 'undefined') {
        // Try to get it from the main window, or default to true (modern Firefox)
        const mainWindow = Services.wm.getMostRecentWindow("navigator:browser");
        window.gFissionBrowser = mainWindow?.gFissionBrowser ?? true;
        console.log('[Little Zen Window] Set gFissionBrowser to:', window.gFissionBrowser);
    }
    
    // Ensure the window element has proper browser window attributes
    const windowElement = document.documentElement;
    if (windowElement) {
        windowElement.setAttribute('chromehidden', '');
        windowElement.setAttribute('windowtype', 'navigator:browser');
        windowElement.setAttribute('id', 'main-window'); // Some extensions check for this
    }
    
    console.log('[Little Zen Window] Window identification properties set');
})();
class LittleZenWindow {
    constructor() {
        this.currentUrl = '';
        this.history = [];
        this.historyIndex = -1;
        this.isLoading = false;
        
        // Set global reference for workspace manager compatibility
        window.LittleZenWindowInstance = this;
        
        this.initializeElements();
        this.bindEvents();
        this.setupWindowControls();
        this.initializeWorkspaceUI();
        this.enhanceGBrowserShim();
    }
    
    initializeElements() {
        this.elements = {
            webContent: document.getElementById('web-content'),
            urlInput: document.getElementById('url-input'),
            backBtn: document.getElementById('back-btn'),
            forwardBtn: document.getElementById('forward-btn'),
            refreshBtn: document.getElementById('refresh-btn'),
            statusText: document.getElementById('status-text'),
            progressBar: document.getElementById('progress-bar'),
            minimizeBtn: document.getElementById('minimize-btn'),
            maximizeBtn: document.getElementById('maximize-btn'),
            closeBtn: document.getElementById('close-btn'),
            workspaceIndicator: document.getElementById('workspace-indicator'),
            workspaceChevron: document.getElementById('workspace-chevron'),
            tabContainer: document.getElementById('tabbrowser-tabs')
        };
        
        // Ensure the browser element is properly initialized
        if (this.elements.webContent) {
            console.log('[Little Zen Window] Initializing browser element...');
            
            // Force browser initialization by accessing key properties
            try {
                // Check if docShell is already available
                if (this.elements.webContent.docShell) {
                    console.log('[Little Zen Window] Browser docShell already available');
                } else {
                    console.log('[Little Zen Window] Browser docShell not available, forcing initialization...');
                    
                    // Try multiple approaches to force docShell creation
                    
                    // Approach 1: Ensure proper attributes are set
                    this.elements.webContent.setAttribute('type', 'content');
                    this.elements.webContent.setAttribute('remote', 'true');
                    
                    // Approach 2: Try to construct the browser frame
                    try {
                        // Force the browser to construct its frame
                        if (typeof this.elements.webContent.construct === 'function') {
                            this.elements.webContent.construct();
                            console.log('[Little Zen Window] Browser construct() called');
                        } else {
                            console.log('[Little Zen Window] Browser construct() method not available');
                        }
                    } catch (e) {
                        console.log('[Little Zen Window] Browser construct() failed:', e);
                    }
                    
                    // Approach 3: Force webNavigation access to trigger initialization
                    try {
                        const webNav = this.elements.webContent.webNavigation;
                        if (webNav) {
                            console.log('[Little Zen Window] Browser webNavigation available');
                            // Try to access docShell through webNavigation
                            if (webNav.QueryInterface) {
                                const docShell = webNav.QueryInterface(Ci.nsIDocShell);
                                if (docShell) {
                                    console.log('[Little Zen Window] DocShell available through webNavigation QI');
                                }
                            }
                        }
                    } catch (e) {
                        console.log('[Little Zen Window] Could not access webNavigation or QI to docShell:', e);
                    }
                    
                    // Approach 4: Try to access browsingContext
                    try {
                        const bc = this.elements.webContent.browsingContext;
                        if (bc) {
                            console.log('[Little Zen Window] Browser browsingContext available');
                            if (bc.docShell) {
                                console.log('[Little Zen Window] DocShell available through browsingContext');
                            }
                        }
                    } catch (e) {
                        console.log('[Little Zen Window] browsingContext not yet available:', e);
                    }
                    
                    // Approach 5: Ensure permanentKey is properly set as unique object
                    if (!this.elements.webContent.permanentKey || typeof this.elements.webContent.permanentKey !== 'object') {
                        this.elements.webContent.permanentKey = {
                            id: 'little-zen-browser-' + Date.now(),
                            created: Date.now(),
                            adoptable: true
                        };
                        console.log('[Little Zen Window] Set unique permanentKey object during initialization');
                    }
                    
                    // Approach 6: Force frame loading by setting src
                    try {
                        // Temporarily set src to force frame construction
                        const originalSrc = this.elements.webContent.getAttribute('src');
                        this.elements.webContent.setAttribute('src', 'about:blank');
                        
                        // Reset to original src after a brief delay
                        setTimeout(() => {
                            if (originalSrc) {
                                this.elements.webContent.setAttribute('src', originalSrc);
                            }
                        }, 10);
                    } catch (e) {
                        console.log('[Little Zen Window] Could not set src for frame construction:', e);
                    }
                    
                    // Give it a moment to initialize
                    setTimeout(() => {
                        console.log('[Little Zen Window] Post-initialization docShell check:', !!this.elements.webContent.docShell);
                        if (this.elements.webContent.docShell) {
                            console.log('[Little Zen Window] DocShell successfully initialized!');
                        } else {
                            console.warn('[Little Zen Window] DocShell still not available after initialization attempts');
                            
                            // Try one more approach - force a layout flush
                            try {
                                this.elements.webContent.getBoundingClientRect();
                                console.log('[Little Zen Window] Forced layout flush');
                                
                                setTimeout(() => {
                                    console.log('[Little Zen Window] Post-flush docShell check:', !!this.elements.webContent.docShell);
                                }, 50);
                            } catch (e) {
                                console.log('[Little Zen Window] Could not force layout flush:', e);
                            }
                        }
                    }, 100);
                }
            } catch (e) {
                console.warn('[Little Zen Window] Error during browser initialization:', e);
            }
        }
        
        // Ensure the web-content element has a permanent key for extension compatibility
        if (this.elements.webContent && !this.elements.webContent.permanentKey) {
            // permanentKey must be a unique object, not a boolean
            this.elements.webContent.permanentKey = {
                id: 'little-zen-browser-' + Date.now(),
                created: Date.now()
            };
            console.log('[Little Zen Window] Set permanentKey object for web-content element');
        }
        
        // Add additional browser properties for extension compatibility
        if (this.elements.webContent) {
            // Ensure browser has required properties for tab adoption
            if (!this.elements.webContent.outerWindowID) {
                this.elements.webContent.outerWindowID = Date.now();
            }
            
            // Ensure permanentKey is properly structured for adoption (must be unique object)
            if (!this.elements.webContent.permanentKey || typeof this.elements.webContent.permanentKey !== 'object') {
                this.elements.webContent.permanentKey = {
                    id: 'little-zen-browser-' + Date.now(),
                    created: Date.now(),
                    adoptable: true,
                    zenCompatible: true
                };
                console.log('[Little Zen Window] Fixed permanentKey to be unique object');
            }
            
            // Add browser identification properties
            this.elements.webContent._zenLittleWindow = true;
            this.elements.webContent._zenCompatible = true;
            
            // Fix: Use Object.defineProperty for read-only properties like isRemoteBrowser
            try {
                Object.defineProperty(this.elements.webContent, 'isRemoteBrowser', {
                    get: () => true,
                    configurable: true
                });
            } catch (e) {
                console.warn('[Little Zen Window] Could not define isRemoteBrowser property:', e);
            }
            
            // Add extension compatibility properties safely
            try {
                // Use Object.defineProperty for read-only properties like hasContentOpener
                Object.defineProperty(this.elements.webContent, 'hasContentOpener', {
                    get: () => false,
                    configurable: true
                });
            } catch (e) {
                console.warn('[Little Zen Window] Could not define hasContentOpener property:', e);
            }
            
            // Add additional properties that might be checked during adoption
            try {
                // Ensure the browser has a frameLoader for adoption compatibility
                if (!this.elements.webContent.frameLoader) {
                    Object.defineProperty(this.elements.webContent, 'frameLoader', {
                        get: () => ({
                            browsingContext: {
                                id: Date.now(),
                                embedderElement: this.elements.webContent
                            }
                        }),
                        configurable: true
                    });
                }
                
                // Add messageManager compatibility
                if (!this.elements.webContent.messageManager) {
                    this.elements.webContent.messageManager = {
                        loadFrameScript: () => {},
                        removeDelayedFrameScript: () => {},
                        sendAsyncMessage: () => {},
                        addMessageListener: () => {},
                        removeMessageListener: () => {}
                    };
                }
                
                // Add docShellIsActive property
                Object.defineProperty(this.elements.webContent, 'docShellIsActive', {
                    get: () => true,
                    set: () => {},
                    configurable: true
                });
                
            } catch (e) {
                console.warn('[Little Zen Window] Could not add additional browser properties:', e);
            }
            
            console.log('[Little Zen Window] Enhanced web-content element for adoption compatibility');
        }
    }
    
    bindEvents() {
        // Navigation events
        this.elements.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.navigateToUrl(e.target.value);
            }
        });
        
        this.elements.backBtn.addEventListener('command', () => this.goBack());
        this.elements.forwardBtn.addEventListener('command', () => this.goForward());
        this.elements.refreshBtn.addEventListener('command', () => this.refresh());
        
        // Browser events - use proper browser element events
        this.elements.webContent.addEventListener('DOMContentLoaded', () => {
            this.onPageLoad();
        });
        
        // Also listen for load event as backup
        this.elements.webContent.addEventListener('load', () => {
            this.onPageLoad();
        });
        
        // URL input focus events
        this.elements.urlInput.addEventListener('focus', () => {
            this.elements.urlInput.select();
        });
    }
    
    setupWindowControls() {
        this.elements.minimizeBtn.addEventListener('command', () => {
            window.minimize();
        });
        
        this.elements.maximizeBtn.addEventListener('command', () => {
            this.toggleMaximize();
        });
        
        this.elements.closeBtn.addEventListener('command', () => {
            window.close();
        });
    }
    
    toggleMaximize() {
        if (window.windowState === window.STATE_MAXIMIZED) {
            window.restore();
        } else {
            window.maximize();
        }
    }
    
    navigateToUrl(url) {
        console.log('[Little Zen Window] navigateToUrl called with:', url);
        if (!url) return;
        
        // Add protocol if missing
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
            if (url.includes('.') && !url.includes(' ')) {
                url = 'https://' + url;
            } else {
                // Treat as search query
                url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
            }
        }
        
        console.log('[Little Zen Window] Final URL to load:', url);
        
        this.setLoading(true);
        this.updateStatus('Loading...');
        
        try {
            console.log('[Little Zen Window] Browser docShell available:', !!this.elements.webContent.docShell);
            console.log('[Little Zen Window] Browser webNavigation available:', !!this.elements.webContent.webNavigation);
            
            // Try using fixupAndLoadURIString which is more reliable
            this.elements.webContent.fixupAndLoadURIString(url, {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_NONE
            });
            
            console.log('[Little Zen Window] fixupAndLoadURIString called successfully');
            
            this.currentUrl = url;
            this.elements.urlInput.value = url;
            
            // Add to history
            if (this.historyIndex < this.history.length - 1) {
                this.history = this.history.slice(0, this.historyIndex + 1);
            }
            this.history.push(url);
            this.historyIndex = this.history.length - 1;
            
            this.updateNavigationButtons();
        } catch (error) {
            console.error('[Little Zen Window] Error in navigateToUrl:', error);
            
            // Fallback: try the old loadURI method
            try {
                console.log('[Little Zen Window] Trying fallback loadURI method...');
                const uri = Services.io.newURI(url);
                this.elements.webContent.loadURI(uri, {
                    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                    loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_NONE
                });
                console.log('[Little Zen Window] Fallback loadURI successful');
            } catch (fallbackError) {
                console.error('[Little Zen Window] Fallback also failed:', fallbackError);
                this.showError('Failed to load page: ' + error.message);
            }
        }
    }
    
    goBack() {
        try {
            if (this.elements.webContent.canGoBack) {
                this.elements.webContent.goBack();
                this.updateNavigationButtons();
            }
        } catch (e) {
            console.warn('Error going back:', e);
        }
    }
    
    goForward() {
        try {
            if (this.elements.webContent.canGoForward) {
                this.elements.webContent.goForward();
                this.updateNavigationButtons();
            }
        } catch (e) {
            console.warn('Error going forward:', e);
        }
    }
    
    refresh() {
        try {
            if (this.elements.webContent) {
                this.setLoading(true);
                this.elements.webContent.reload();
                this.updateStatus('Refreshing...');
            }
        } catch (e) {
            console.warn('Error refreshing:', e);
        }
    }
    
    onPageLoad() {
        this.setLoading(false);
        this.updateStatus('Ready');
        this.updateNavigationButtons();
        
        try {
            // Update URL input with current location
            const currentURI = this.elements.webContent.currentURI;
            if (currentURI && currentURI.spec !== 'about:blank') {
                this.elements.urlInput.value = currentURI.spec;
                this.currentUrl = currentURI.spec;
            }
        } catch (e) {
            // Error getting current URI, this is normal during loading
        }
    }
    
    setLoading(loading) {
        this.isLoading = loading;
        if (loading) {
            this.elements.progressBar.hidden = false;
            this.elements.progressBar.value = 0;
            this.animateProgress();
        } else {
            this.elements.progressBar.hidden = true;
            this.elements.progressBar.value = 0;
        }
    }
    
    animateProgress() {
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 30;
            if (progress > 90) progress = 90;
            
            this.elements.progressBar.value = progress;
            
            if (!this.isLoading || progress >= 90) {
                clearInterval(interval);
                if (!this.isLoading) {
                    this.elements.progressBar.value = 100;
                    setTimeout(() => {
                        this.elements.progressBar.hidden = true;
                        this.elements.progressBar.value = 0;
                    }, 200);
                }
            }
        }, 100);
    }
    
    updateStatus(text) {
        this.elements.statusText.setAttribute('label', text);
    }
    
    updateNavigationButtons() {
        try {
            // Use try-catch since canGoBack/canGoForward might not be immediately available
            this.elements.backBtn.disabled = !this.elements.webContent.canGoBack;
            this.elements.forwardBtn.disabled = !this.elements.webContent.canGoForward;
        } catch (e) {
            // Browser element might not be fully initialized yet
            this.elements.backBtn.disabled = true;
            this.elements.forwardBtn.disabled = true;
        }
    }
    
    showError(message) {
        this.setLoading(false);
        this.updateStatus('Error loading page');
        console.error('Little Zen Window Error:', message);
    }
    
    // Public method to load URL from external source
    loadUrl(url) {
        console.log('[Little Zen Window] loadUrl called with:', url);
        
        // Check if browser is immediately ready (both webNavigation and docShell)
        const browser = this.elements.webContent;
        if (browser && browser.docShell && browser.webNavigation) {
            console.log('[Little Zen Window] Browser ready, loading URL immediately:', url);
            this.navigateToUrl(url);
        } else {
            // Wait for browser readiness with timeout
            console.log('[Little Zen Window] Browser not ready, waiting for docShell and webNavigation...');
            let attempts = 0;
            const maxAttempts = 50; // Increased attempts
            
            const tryLoad = () => {
                attempts++;
                if (browser && browser.docShell && browser.webNavigation) {
                    console.log('[Little Zen Window] Browser ready after', attempts, 'attempts, loading URL:', url);
                    this.navigateToUrl(url);
                } else if (attempts < maxAttempts) {
                    // Log current state for debugging
                    if (attempts % 10 === 0) {
                        console.log('[Little Zen Window] Browser state check:', {
                            attempt: attempts,
                            hasDocShell: !!browser?.docShell,
                            hasWebNavigation: !!browser?.webNavigation,
                            browserType: browser?.getAttribute?.('type'),
                            browserRemote: browser?.getAttribute?.('remote')
                        });
                    }
                    setTimeout(tryLoad, 100);
                } else {
                    console.warn('[Little Zen Window] Browser readiness timeout, trying to load anyway:', url);
                    this.navigateToUrl(url);
                }
            };
            
            setTimeout(tryLoad, 50);
        }
    }
    
    // Initialize Zen Workspace UI integration
    initializeWorkspaceUI() {
        console.log('[Little Zen Window] Initializing workspace UI...');
        
        // Use a short delay to allow DOM to be ready, but don't wait for browser
        setTimeout(() => {
            this.setupWorkspaceUIAfterReady();
        }, 100);
    }
    
    setupWorkspaceUIAfterReady() {
        try {
            // Get reference to main window's gZenWorkspaces with better detection
            const mainWindow = this.findMainBrowserWindow();
            if (!mainWindow) {
                console.warn('[Little Zen Window] No main browser window found');
                // Retry after a delay
                setTimeout(() => {
                    this.setupWorkspaceUIAfterReady();
                }, 1000);
                return;
            }
            
            // Wait for gZenWorkspaces to be available
            if (!mainWindow.gZenWorkspaces) {
                console.log('[Little Zen Window] Waiting for gZenWorkspaces to initialize...');
                setTimeout(() => {
                    this.setupWorkspaceUIAfterReady();
                }, 500);
                return;
            }
            
            this.gZenWorkspaces = mainWindow.gZenWorkspaces;
            this.mainWindow = mainWindow;
            
            // Track the selected workspace for tab diversion (starts with active workspace)
            this.selectedWorkspaceId = this.gZenWorkspaces.getActiveWorkspace()?.uuid;
            
            const indicator = this.elements.workspaceIndicator;
            const chevron = this.elements.workspaceChevron;
            const menu = document.getElementById("workspace-menu-popup");
            
            if (!indicator || !chevron || !menu) {
                console.warn('[Little Zen Window] Workspace UI elements not found');
                return;
            }
            
            // Update indicator text with selected workspace
            const updateIndicator = () => {
                try {
                    const selectedWorkspace = this.gZenWorkspaces.getWorkspaceFromId(this.selectedWorkspaceId);
                    const workspaceName = selectedWorkspace ? selectedWorkspace.name : "Space";
                    indicator.setAttribute('value', workspaceName);
                    console.log('[Little Zen Window] Updated workspace indicator:', workspaceName);
                } catch (e) {
                    console.warn('[Little Zen Window] Error updating workspace indicator:', e);
                    indicator.setAttribute('value', 'Space');
                }
            };
            
            // Populate workspace menu when chevron is clicked
            chevron.addEventListener('click', () => {
                console.log('[Little Zen Window] Workspace chevron clicked');
                this.populateWorkspaceMenu(menu);
            });
            
            // Handle workspace indicator click (divert tab to selected workspace)
            indicator.addEventListener('click', () => {
                console.log('[Little Zen Window] Workspace indicator clicked - diverting tab via sync');
                this.divertTabToSelectedWorkspaceViaSync();
            });
            
            // Handle keyboard shortcut (Ctrl/Cmd + O)
            window.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
                    e.preventDefault();
                    console.log('[Little Zen Window] Keyboard shortcut triggered - diverting tab via sync');
                    this.divertTabToSelectedWorkspaceViaSync();
                }
            });
            
            // Listen for workspace changes in main window to update the default selection
            if (this.mainWindow.addEventListener) {
                this.mainWindow.addEventListener('ZenWorkspaceChanged', () => {
                    // Update selected workspace to current active workspace when main window changes
                    const activeWorkspace = this.gZenWorkspaces.getActiveWorkspace();
                    if (activeWorkspace) {
                        this.selectedWorkspaceId = activeWorkspace.uuid;
                        updateIndicator();
                    }
                });
            }
            
            // Initial update
            updateIndicator();
            
            console.log('[Little Zen Window] Workspace UI initialized successfully');
            
        } catch (error) {
            console.error('[Little Zen Window] Error initializing workspace UI:', error);
        }
    }
    
    // Better main window detection
    findMainBrowserWindow() {
        try {
            // Try multiple methods to find the main browser window
            let mainWindow = null;
            
            // Method 1: Most recent navigator:browser window
            mainWindow = Services.wm.getMostRecentWindow("navigator:browser");
            if (mainWindow && mainWindow !== window && mainWindow.gZenWorkspaces) {
                return mainWindow;
            }
            
            // Method 2: Enumerate all browser windows
            const windowEnumerator = Services.wm.getEnumerator("navigator:browser");
            while (windowEnumerator.hasMoreElements()) {
                const win = windowEnumerator.getNext();
                if (win !== window && win.gZenWorkspaces && !win.closed) {
                    return win;
                }
            }
            
            // Method 3: Check BrowserWindowTracker if available
            if (typeof BrowserWindowTracker !== 'undefined') {
                const orderedWindows = BrowserWindowTracker.orderedWindows;
                for (const win of orderedWindows) {
                    if (win !== window && win.gZenWorkspaces && !win.closed) {
                        return win;
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('[Little Zen Window] Error finding main browser window:', error);
            return null;
        }
    }
    
    // Populate the workspace menu with available workspaces
    populateWorkspaceMenu(menu) {
        try {
            // Clear existing menu items
            while (menu.firstChild) {
                menu.removeChild(menu.firstChild);
            }
            
            // Get all workspaces
            const workspaces = this.gZenWorkspaces.getWorkspaces();
            
            console.log('[Little Zen Window] Populating menu with', workspaces.length, 'workspaces');
            
            workspaces.forEach(workspace => {
                const menuItem = document.createXULElement('menuitem');
                menuItem.setAttribute('label', workspace.name);
                menuItem.setAttribute('type', 'radio');
                
                // Mark selected workspace as checked
                if (workspace.uuid === this.selectedWorkspaceId) {
                    menuItem.setAttribute('checked', 'true');
                }
                
                // Add workspace icon if available
                const iconIsSvg = workspace.icon && workspace.icon.endsWith('.svg');
                if (workspace.icon && workspace.icon !== '' && !iconIsSvg) {
                    menuItem.setAttribute('label', `${workspace.icon}  ${workspace.name}`);
                }
                if (iconIsSvg) {
                    menuItem.setAttribute('image', workspace.icon);
                    menuItem.classList.add('zen-workspace-context-icon');
                }
                
                // Handle workspace selection - just update the indicator
                menuItem.addEventListener('command', () => {
                    console.log('[Little Zen Window] Selected workspace for diversion:', workspace.name);
                    this.selectedWorkspaceId = workspace.uuid;
                    this.elements.workspaceIndicator.setAttribute('value', workspace.name);
                });
                
                menu.appendChild(menuItem);
            });
            
        } catch (error) {
            console.error('[Little Zen Window] Error populating workspace menu:', error);
        }
    }
    
    // Divert current tab to the selected workspace
    divertTabToSelectedWorkspace() {
        try {
            if (!this.mainWindow || !this.currentUrl || !this.selectedWorkspaceId) {
                console.warn('[Little Zen Window] Cannot divert - missing main window, URL, or selected workspace');
                return;
            }
            
            console.log('[Little Zen Window] Diverting tab to selected workspace:', this.selectedWorkspaceId, 'URL:', this.currentUrl);
            
            // First, switch to the selected workspace in the main window
            const selectedWorkspace = this.gZenWorkspaces.getWorkspaceFromId(this.selectedWorkspaceId);
            if (!selectedWorkspace) {
                console.error('[Little Zen Window] Selected workspace not found:', this.selectedWorkspaceId);
                return;
            }
            
            // Switch to the workspace first, then create the tab
            this.gZenWorkspaces.changeWorkspace(selectedWorkspace).then(() => {
                // Create new tab in the now-active workspace
                const newTab = this.mainWindow.gBrowser.addTab(this.currentUrl, {
                    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
                });
                
                // Ensure the tab has the correct workspace ID
                if (newTab) {
                    newTab.setAttribute('zen-workspace-id', this.selectedWorkspaceId);
                }
                
                // Focus the main window and new tab
                this.mainWindow.focus();
                this.mainWindow.gBrowser.selectedTab = newTab;
                
                console.log('[Little Zen Window] Tab diverted successfully to workspace:', selectedWorkspace.name);
                
                // Close this custom window
                setTimeout(() => {
                    window.close();
                }, 100);
            }).catch(error => {
                console.error('[Little Zen Window] Error switching workspace:', error);
            });
            
        } catch (error) {
            console.error('[Little Zen Window] Error diverting tab to selected workspace:', error);
        }
    }
    
    // Enhance the pre-initialized gBrowser shim with instance-specific functionality
    enhanceGBrowserShim() {
        console.log('[Little Zen Window] Enhancing gBrowser shim with instance functionality...');
        
        try {
            // Update the mock tab's workspace reference
            if (window.gBrowser && window.gBrowser.selectedTab) {
                window.gBrowser.selectedTab.zenWindow = this;
                // Store reference to mock tab for easier access
                this.mockSelectedTab = window.gBrowser.selectedTab;
            }
            
            // Set up browser readiness monitoring (non-blocking)
            this.monitorBrowserReadiness();
            
            console.log('[Little Zen Window] gBrowser shim enhancement complete');
            
        } catch (error) {
            console.error('[Little Zen Window] Error enhancing gBrowser shim:', error);
        }
    }
    
    // Non-blocking browser readiness monitoring
    monitorBrowserReadiness() {
        let attempts = 0;
        const maxAttempts = 50;
        
        const checkReadiness = () => {
            attempts++;
            const browser = this.elements.webContent;
            
            if (browser && browser.docShell && browser.webNavigation) {
                console.log('[Little Zen Window] Browser ready after', attempts, 'attempts');
                this.onBrowserReady();
                return;
            }
            
            if (attempts < maxAttempts) {
                setTimeout(checkReadiness, 100);
            } else {
                console.warn('[Little Zen Window] Browser readiness timeout, continuing anyway');
                this.onBrowserReady();
            }
        };
        
        // Start monitoring
        setTimeout(checkReadiness, 50);
    }
    
    // Called when browser is ready (or timeout reached)
    onBrowserReady() {
        try {
            // Initialize browser security context if docShell is available
            const browser = this.elements.webContent;
            if (browser.docShell) {
                browser.docShell.createAboutBlankContentViewer(
                    Services.scriptSecurityManager.getSystemPrincipal(),
                    Services.scriptSecurityManager.getSystemPrincipal()
                );
                console.log('[Little Zen Window] Browser security context initialized');
            }
            
            // Set compositor ready flag
            window._zenCompositorReady = true;
            
            // Dispatch ready event
            window.dispatchEvent(new CustomEvent('ZenWindowReady', {
                detail: { compositorReady: true }
            }));
            
        } catch (error) {
            console.warn('[Little Zen Window] Error in onBrowserReady:', error);
        }
    }
    
    // Enhanced divert method using Zen Window Sync infrastructure
    divertTabToSelectedWorkspaceViaSync() {
        try {
            if (!this.mainWindow || !this.currentUrl || !this.selectedWorkspaceId) {
                console.warn('[Little Zen Window] Cannot divert via sync - missing requirements');
                return this.divertTabToSelectedWorkspace(); // Fallback to original method
            }
            
            console.log('[Little Zen Window] Diverting tab via Zen Window Sync infrastructure');
            
            // Get the selected workspace
            const selectedWorkspace = this.gZenWorkspaces.getWorkspaceFromId(this.selectedWorkspaceId);
            if (!selectedWorkspace) {
                console.error('[Little Zen Window] Selected workspace not found:', this.selectedWorkspaceId);
                return;
            }
            
            // Switch to the selected workspace first
            this.gZenWorkspaces.changeWorkspace(selectedWorkspace).then(() => {
                console.log('[Little Zen Window] Workspace switched, attempting tab adoption');
                
                try {
                    // Get our mock tab with proper structure for adoption
                    const mockTab = window.gBrowser.selectedTab;
                    
                    // Ensure the mock tab has all required properties for adoption
                    if (!mockTab.ownerGlobal) {
                        console.error('[Little Zen Window] Mock tab missing ownerGlobal');
                        return this.divertTabToSelectedWorkspace();
                    }
                    
                    if (!mockTab.linkedBrowser) {
                        console.error('[Little Zen Window] Mock tab missing linkedBrowser');
                        return this.divertTabToSelectedWorkspace();
                    }
                    
                    // Set the workspace ID on the mock tab before adoption
                    mockTab.setAttribute('zen-workspace-id', this.selectedWorkspaceId);
                    
                    // Set adoption flags to indicate we're performing a tab adoption
                    window._isAdoptingFlag = true;
                    window.gZenWorkspaces.currentWindowIsSyncing = true;
                    
                    // Ensure the browser has a permanentKey that the target window can track
                    const browserElement = mockTab.linkedBrowser;
                    if (browserElement && !browserElement.permanentKey) {
                        browserElement.permanentKey = {
                            id: 'little-zen-browser-' + Date.now(),
                            created: Date.now(),
                            adoptable: true
                        };
                    }
                    
                    console.log('[Little Zen Window] Attempting tab adoption with mock tab:', {
                        tabId: mockTab.id,
                        hasOwnerGlobal: !!mockTab.ownerGlobal,
                        hasLinkedBrowser: !!mockTab.linkedBrowser,
                        hasParentNode: !!mockTab.parentNode,
                        workspaceId: this.selectedWorkspaceId,
                        browserPermanentKey: typeof mockTab.linkedBrowser?.permanentKey,
                        permanentKeyId: mockTab.linkedBrowser?.permanentKey?.id,
                        isAdoptingTab: window.gBrowserInit.isAdoptingTab(),
                        tPos: mockTab._tPos,
                        closing: mockTab.closing,
                        mOverCloseButton: mockTab.mOverCloseButton,
                        remoteAttr: mockTab.getAttribute('remote'),
                        draggableAttr: mockTab.getAttribute('draggable')
                    });
                    
                    // Use adoptTab to physically move the browser content
                    console.log('[Little Zen Window] Calling main window adoptTab...');
                    
                    // Validate that the main window has adoptTab method
                    if (!this.mainWindow.gBrowser.adoptTab) {
                        console.error('[Little Zen Window] Main window gBrowser missing adoptTab method');
                        throw new Error('adoptTab method not available');
                    }
                    
                    // Add detailed logging before adoption attempt
                    console.log('[Little Zen Window] Pre-adoption state:', {
                        mockTabValid: !!mockTab,
                        mockTabId: mockTab?.id,
                        mockTabOwnerGlobal: !!mockTab?.ownerGlobal,
                        mockTabLinkedBrowser: !!mockTab?.linkedBrowser,
                        mockTabParentNode: !!mockTab?.parentNode,
                        mainWindowValid: !!this.mainWindow,
                        mainWindowGBrowser: !!this.mainWindow?.gBrowser,
                        mainWindowAdoptTab: typeof this.mainWindow?.gBrowser?.adoptTab,
                        currentUrl: this.currentUrl,
                        selectedWorkspaceId: this.selectedWorkspaceId
                    });
                    
                    // Validate compatibility for swapBrowsersAndCloseOther
                    const ourBrowser = mockTab.linkedBrowser;
                    const mainWindowPrivate = this.mainWindow.PrivateBrowsingUtils?.isWindowPrivate(this.mainWindow) || false;
                    const ourWindowPrivate = (window.PrivateBrowsingUtils?.isWindowPrivate(window)) || false;
                    const mainWindowFission = this.mainWindow.gFissionBrowser || false;
                    const ourWindowFission = window.gFissionBrowser || false;
                    
                    console.log('[Little Zen Window] Compatibility check:', {
                        mainWindowPrivate,
                        ourWindowPrivate,
                        privateBrowsingMatch: mainWindowPrivate === ourWindowPrivate,
                        mainWindowFission,
                        ourWindowFission,
                        fissionMatch: mainWindowFission === ourWindowFission,
                        ourBrowserRemote: ourBrowser?.isRemoteBrowser,
                        ourBrowserType: ourBrowser?.getAttribute?.('type'),
                        ourBrowserRemoteType: ourBrowser?.remoteType
                    });
                    
                    // Check for potential adoption blockers
                    if (mainWindowPrivate !== ourWindowPrivate) {
                        console.warn('[Little Zen Window] Private browsing mismatch - adoption will likely fail');
                    }
                    
                    if (mainWindowFission !== ourWindowFission) {
                        console.warn('[Little Zen Window] Fission mismatch - adoption will likely fail');
                    }
                    
                    let adoptedTab;
                    try {
                        adoptedTab = this.mainWindow.gBrowser.adoptTab(mockTab, 0, false);
                        console.log('[Little Zen Window] adoptTab call completed, result:', !!adoptedTab);
                    } catch (adoptError) {
                        console.error('[Little Zen Window] adoptTab call threw error:', adoptError);
                        console.error('[Little Zen Window] adoptTab error stack:', adoptError.stack);
                        throw adoptError;
                    }
                    
                    if (adoptedTab) {
                        console.log('[Little Zen Window] Tab adoption successful, adopted tab:', {
                            id: adoptedTab.id,
                            hasLinkedBrowser: !!adoptedTab.linkedBrowser,
                            hasOwnerGlobal: !!adoptedTab.ownerGlobal
                        });
                        
                        // Ensure the adopted tab has the correct workspace ID
                        adoptedTab.setAttribute('zen-workspace-id', this.selectedWorkspaceId);
                        
                        // Focus the main window and adopted tab
                        this.mainWindow.focus();
                        this.mainWindow.gBrowser.selectedTab = adoptedTab;
                        
                        console.log('[Little Zen Window] Tab adopted successfully to workspace:', selectedWorkspace.name);
                        
                        // Reset adoption flags
                        window._isAdoptingFlag = false;
                        window.gZenWorkspaces.currentWindowIsSyncing = false;
                        
                        // Close this custom window after successful adoption
                        setTimeout(() => {
                            window.close();
                        }, 50);
                    } else {
                        console.error('[Little Zen Window] Tab adoption failed - adoptTab returned null/undefined');
                        console.error('[Little Zen Window] This usually means the tab could not be adopted due to incompatible state');
                        console.error('[Little Zen Window] Common causes: private browsing mismatch, fission mismatch, or browser type incompatibility');
                        
                        // Reset adoption flags on failure
                        window._isAdoptingFlag = false;
                        window.gZenWorkspaces.currentWindowIsSyncing = false;
                        
                        // Use manual swapDocShells implementation
                        this.performManualDocShellSwap(selectedWorkspace);
                    }
                    
                } catch (adoptError) {
                    console.error('[Little Zen Window] Error during tab adoption:', adoptError);
                    console.error('[Little Zen Window] Adoption error stack:', adoptError.stack);
                    
                    // Reset adoption flags on error
                    window._isAdoptingFlag = false;
                    window.gZenWorkspaces.currentWindowIsSyncing = false;
                    
                    // Use manual docShell swap as fallback
                    this.performManualDocShellSwap(selectedWorkspace);
                }
                
            }).catch(error => {
                console.error('[Little Zen Window] Error switching workspace for adoption:', error);
                
                // Reset adoption flags on error
                window._isAdoptingFlag = false;
                window.gZenWorkspaces.currentWindowIsSyncing = false;
                
                this.performManualDocShellSwap(selectedWorkspace); // Manual swap fallback
            });
            
        } catch (error) {
            console.error('[Little Zen Window] Error in sync-based tab diversion:', error);
            
            // Reset adoption flags on error
            window._isAdoptingFlag = false;
            if (window.gZenWorkspaces) {
                window.gZenWorkspaces.currentWindowIsSyncing = false;
            }
            
            // Try to get the selected workspace for manual swap
            const selectedWorkspace = this.gZenWorkspaces?.getWorkspaceFromId(this.selectedWorkspaceId);
            if (selectedWorkspace) {
                this.performManualDocShellSwap(selectedWorkspace); // Manual swap fallback
            } else {
                this.divertTabToSelectedWorkspaceEnhanced(); // Enhanced fallback
            }
        }
    }
    
    // Enhanced fallback method for when tab adoption fails
    divertTabToSelectedWorkspaceEnhanced() {
        console.log('[Little Zen Window] Using enhanced fallback for tab diversion');
        
        try {
            if (!this.mainWindow || !this.selectedWorkspaceId) {
                console.error('[Little Zen Window] Enhanced fallback missing requirements');
                return this.divertTabToSelectedWorkspace(); // Final fallback
            }
            
            // Get the current URL from the browser element
            let urlToTransfer = this.currentUrl;
            const browser = this.elements.webContent;
            
            // Try to get the most current URL from the browser
            if (browser?.currentURI?.spec && browser.currentURI.spec !== 'about:blank') {
                urlToTransfer = browser.currentURI.spec;
                console.log('[Little Zen Window] Using browser currentURI:', urlToTransfer);
            } else if (browser?.documentURI?.spec && browser.documentURI.spec !== 'about:blank') {
                urlToTransfer = browser.documentURI.spec;
                console.log('[Little Zen Window] Using browser documentURI:', urlToTransfer);
            }
            
            if (!urlToTransfer || urlToTransfer === 'about:blank') {
                console.warn('[Little Zen Window] No valid URL to transfer, using about:newtab');
                urlToTransfer = 'about:newtab';
            }
            
            console.log('[Little Zen Window] Enhanced fallback transferring URL:', urlToTransfer);
            
            // Get the selected workspace
            const selectedWorkspace = this.gZenWorkspaces.getWorkspaceFromId(this.selectedWorkspaceId);
            if (!selectedWorkspace) {
                console.error('[Little Zen Window] Selected workspace not found:', this.selectedWorkspaceId);
                return this.divertTabToSelectedWorkspace();
            }
            
            // Switch to the selected workspace first
            this.gZenWorkspaces.changeWorkspace(selectedWorkspace).then(() => {
                console.log('[Little Zen Window] Workspace switched for enhanced fallback');
                
                try {
                    let newTab;
                    
                    // Try Zen-specific addWebTab first
                    if (this.mainWindow.gBrowser.addWebTab) {
                        console.log('[Little Zen Window] Using addWebTab for enhanced fallback');
                        
                        // Create a content principal for the URL instead of using system principal
                        let principal;
                        try {
                            const uri = Services.io.newURI(urlToTransfer);
                            principal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
                        } catch (e) {
                            console.warn('[Little Zen Window] Could not create content principal, using null principal');
                            principal = Services.scriptSecurityManager.createNullPrincipal({});
                        }
                        
                        newTab = this.mainWindow.gBrowser.addWebTab(urlToTransfer, {
                            workspaceId: this.selectedWorkspaceId,
                            triggeringPrincipal: principal,
                            userContextId: 0 // Default container
                        });
                    } else {
                        console.log('[Little Zen Window] Using addTab for enhanced fallback');
                        newTab = this.mainWindow.gBrowser.addTab(urlToTransfer, {
                            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
                        });
                        
                        // Set workspace ID manually if addTab was used
                        if (newTab) {
                            newTab.setAttribute('zen-workspace-id', this.selectedWorkspaceId);
                        }
                    }
                    
                    if (newTab) {
                        console.log('[Little Zen Window] Enhanced fallback tab created successfully');
                        
                        // Focus the main window and new tab
                        this.mainWindow.focus();
                        this.mainWindow.gBrowser.selectedTab = newTab;
                        
                        // Close this window after successful transfer
                        setTimeout(() => {
                            window.close();
                        }, 100);
                    } else {
                        console.error('[Little Zen Window] Enhanced fallback failed to create tab');
                        this.divertTabToSelectedWorkspace();
                    }
                    
                } catch (tabCreationError) {
                    console.error('[Little Zen Window] Error creating tab in enhanced fallback:', tabCreationError);
                    this.divertTabToSelectedWorkspace();
                }
                
            }).catch(workspaceError => {
                console.error('[Little Zen Window] Error switching workspace in enhanced fallback:', workspaceError);
                this.divertTabToSelectedWorkspace();
            });
            
        } catch (error) {
            console.error('[Little Zen Window] Error in enhanced fallback:', error);
            this.divertTabToSelectedWorkspaceEnhanced(); // Final fallback
        }
    }
    
    // Manual docShell swap implementation to bypass adoptTab limitations
    async performManualDocShellSwap(selectedWorkspace) {
        console.log('[Little Zen Window] Performing manual docShell swap');
        
        try {
            const ourLittleZenBrowser = this.elements.webContent;
            if (!ourLittleZenBrowser) {
                console.error('[Little Zen Window] No Little Zen browser element found');
                return this.divertTabToSelectedWorkspaceEnhanced();
            }
            
            // Extract security context from current browser
            let triggeringPrincipal = null;
            let csp = null;
            let currentURL = this.currentUrl;
            
            try {
                if (ourLittleZenBrowser.contentPrincipal) {
                    triggeringPrincipal = ourLittleZenBrowser.contentPrincipal;
                    console.log('[Little Zen Window] Extracted contentPrincipal for security context');
                }
                
                if (ourLittleZenBrowser.csp) {
                    csp = ourLittleZenBrowser.csp;
                    console.log('[Little Zen Window] Extracted CSP for security context');
                }
                
                // Get the most current URL
                if (ourLittleZenBrowser.currentURI?.spec && ourLittleZenBrowser.currentURI.spec !== 'about:blank') {
                    currentURL = ourLittleZenBrowser.currentURI.spec;
                    console.log('[Little Zen Window] Using current URI for swap:', currentURL);
                }
            } catch (e) {
                console.warn('[Little Zen Window] Could not extract security context:', e);
            }
            
            // Fallback to content principal for the URL if no content principal available
            if (!triggeringPrincipal) {
                try {
                    const uri = Services.io.newURI(currentURL);
                    triggeringPrincipal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
                    console.log('[Little Zen Window] Created content principal for URL');
                } catch (e) {
                    triggeringPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
                    console.log('[Little Zen Window] Using system principal as final fallback');
                }
            }
            
            // Step 1: Create a new real tab in the main window
            let destinationTab;
            try {
                if (this.mainWindow.gBrowser.addWebTab) {
                    // Use addWebTab if available (Zen-specific method)
                    destinationTab = this.mainWindow.gBrowser.addWebTab(currentURL, {
                        workspaceId: this.selectedWorkspaceId,
                        triggeringPrincipal: triggeringPrincipal,
                        csp: csp,
                        userContextId: 0
                    });
                    console.log('[Little Zen Window] Created destination tab with addWebTab');
                } else {
                    // Use standard addTab
                    destinationTab = this.mainWindow.gBrowser.addTab(currentURL, {
                        triggeringPrincipal: triggeringPrincipal,
                        csp: csp
                    });
                    if (destinationTab) {
                        destinationTab.setAttribute('zen-workspace-id', this.selectedWorkspaceId);
                    }
                    console.log('[Little Zen Window] Created destination tab with addTab');
                }
            } catch (tabCreationError) {
                console.error('[Little Zen Window] Failed to create destination tab:', tabCreationError);
                return this.divertTabToSelectedWorkspaceEnhanced();
            }
            
            if (!destinationTab) {
                console.error('[Little Zen Window] Destination tab creation returned null');
                return this.divertTabToSelectedWorkspaceEnhanced();
            }
            
            // Step 2: Get the linkedBrowser from the destination tab
            const destinationBrowser = destinationTab.linkedBrowser;
            if (!destinationBrowser) {
                console.error('[Little Zen Window] Destination tab has no linkedBrowser');
                return this.divertTabToSelectedWorkspaceEnhanced();
            }
            
            console.log('[Little Zen Window] Destination browser ready for swap');
            
            // Wait for destination browser to be fully initialized before swap
            const waitForDestinationReady = () => {
                return new Promise((resolve, reject) => {
                    let attempts = 0;
                    const maxAttempts = 20;
                    
                    const checkReady = () => {
                        attempts++;
                        
                        // Check if destination browser is ready for swap
                        if (destinationBrowser.docShell && destinationBrowser.webNavigation) {
                            console.log('[Little Zen Window] Destination browser ready after', attempts, 'attempts');
                            resolve();
                        } else if (attempts < maxAttempts) {
                            setTimeout(checkReady, 100);
                        } else {
                            console.warn('[Little Zen Window] Destination browser readiness timeout, proceeding anyway');
                            resolve(); // Proceed anyway
                        }
                    };
                    
                    checkReady();
                });
            };
            
            // Wait for destination to be ready, then perform swap
            await waitForDestinationReady();
            
            // Step 3: Ensure both browsers are properly configured for swap
            this.prepareForDocShellSwap(ourLittleZenBrowser, destinationBrowser);
            
            // Step 4: Perform the docShell swap
            try {
                console.log('[Little Zen Window] Performing docShell swap...');
                destinationBrowser.swapDocShells(ourLittleZenBrowser);
                console.log('[Little Zen Window] DocShell swap completed successfully');
                
                // Step 5: Update UI state in the main window
                try {
                    destinationBrowser.updateCommands();
                    console.log('[Little Zen Window] Updated commands in destination browser');
                } catch (e) {
                    console.warn('[Little Zen Window] Could not update commands:', e);
                }
                
                // Step 6: Focus the main window and new tab
                this.mainWindow.focus();
                this.mainWindow.gBrowser.selectedTab = destinationTab;
                
                console.log('[Little Zen Window] Manual docShell swap completed successfully');
                
                // Step 7: Clean up - close the Little Zen window
                setTimeout(() => {
                    console.log('[Little Zen Window] Closing Little Zen window after successful swap');
                    window.close();
                }, 100);
                
            } catch (swapError) {
                console.error('[Little Zen Window] DocShell swap failed:', swapError);
                console.error('[Little Zen Window] Swap error stack:', swapError.stack);
                
                // Clean up the destination tab we created
                try {
                    this.mainWindow.gBrowser.removeTab(destinationTab);
                } catch (e) {
                    console.warn('[Little Zen Window] Could not clean up destination tab:', e);
                }
                
                // Fall back to enhanced method
                return this.divertTabToSelectedWorkspaceEnhanced();
            }
            
        } catch (error) {
            console.error('[Little Zen Window] Error in manual docShell swap:', error);
            console.error('[Little Zen Window] Manual swap error stack:', error.stack);
            return this.divertTabToSelectedWorkspaceEnhanced();
        }
    }
    
    // Prepare browsers for docShell swap by ensuring remote state compatibility
    prepareForDocShellSwap(ourBrowser, destinationBrowser) {
        console.log('[Little Zen Window] Preparing browsers for docShell swap');
        
        try {
            // Get destination browser's remote state
            const destinationRemoteType = destinationBrowser.remoteType;
            const destinationIsRemote = destinationBrowser.isRemoteBrowser;
            
            console.log('[Little Zen Window] Destination browser state:', {
                remoteType: destinationRemoteType,
                isRemoteBrowser: destinationIsRemote
            });
            
            // Ensure our Little Zen browser matches the remote state
            try {
                // Set isRemoteBrowser to match destination
                Object.defineProperty(ourBrowser, 'isRemoteBrowser', {
                    get: () => destinationIsRemote,
                    configurable: true
                });
                console.log('[Little Zen Window] Set isRemoteBrowser to:', destinationIsRemote);
            } catch (e) {
                console.warn('[Little Zen Window] Could not set isRemoteBrowser:', e);
            }
            
            try {
                // Set remoteType to match destination
                Object.defineProperty(ourBrowser, 'remoteType', {
                    get: () => destinationRemoteType,
                    configurable: true
                });
                console.log('[Little Zen Window] Set remoteType to:', destinationRemoteType);
            } catch (e) {
                console.warn('[Little Zen Window] Could not set remoteType:', e);
            }
            
            // Ensure both browsers have the remote attribute set correctly
            try {
                if (destinationIsRemote) {
                    ourBrowser.setAttribute('remote', 'true');
                    destinationBrowser.setAttribute('remote', 'true');
                } else {
                    ourBrowser.removeAttribute('remote');
                    destinationBrowser.removeAttribute('remote');
                }
                console.log('[Little Zen Window] Synchronized remote attributes');
            } catch (e) {
                console.warn('[Little Zen Window] Could not synchronize remote attributes:', e);
            }
            
            // Log final state for verification
            console.log('[Little Zen Window] Pre-swap browser states:', {
                our: {
                    isRemoteBrowser: ourBrowser.isRemoteBrowser,
                    remoteType: ourBrowser.remoteType,
                    remoteAttr: ourBrowser.getAttribute('remote')
                },
                destination: {
                    isRemoteBrowser: destinationBrowser.isRemoteBrowser,
                    remoteType: destinationBrowser.remoteType,
                    remoteAttr: destinationBrowser.getAttribute('remote')
                }
            });
            
        } catch (error) {
            console.error('[Little Zen Window] Error preparing browsers for swap:', error);
            // Continue anyway - the swap might still work
        }
    }
}

// Initialize when window loads
window.addEventListener('load', () => {
    console.log('[Little Zen Window] Window loaded, initializing...');
    
    // CRITICAL: Prevent CustomizableUI from trying to build widgets in this window
    try {
        if (typeof CustomizableUI !== 'undefined') {
            // Override buildWidget to prevent it from running in our window
            const originalBuildWidget = CustomizableUI.buildWidget;
            if (originalBuildWidget) {
                CustomizableUI.buildWidget = function(aWidgetData) {
                    // Skip widget building for Little Zen Window
                    if (window.document.documentElement.getAttribute('windowtype') === 'navigator:browser' && 
                        window.document.getElementById('littleZenWindow')) {
                        console.log('[Little Zen Window] Skipping CustomizableUI widget build for Little Zen Window');
                        return null;
                    }
                    return originalBuildWidget.apply(this, arguments);
                };
            }
            
            // Also override buildWidgetNode
            const originalBuildWidgetNode = CustomizableUI.buildWidgetNode;
            if (originalBuildWidgetNode) {
                CustomizableUI.buildWidgetNode = function(aWidgetData, aWindow) {
                    // Skip widget node building for Little Zen Window
                    if (aWindow === window) {
                        console.log('[Little Zen Window] Skipping CustomizableUI widget node build for Little Zen Window');
                        return null;
                    }
                    return originalBuildWidgetNode.apply(this, arguments);
                };
            }
        }
    } catch (e) {
        console.warn('[Little Zen Window] Could not override CustomizableUI methods:', e);
    }
    
    window.zenWindow = new LittleZenWindow();
    
    // Additional browser initialization after window is fully loaded
    setTimeout(() => {
        const browser = document.getElementById('web-content');
        if (browser && !browser.docShell) {
            console.log('[Little Zen Window] Performing delayed browser initialization...');
            
            try {
                // Try to force browser construction through various methods
                
                // Method 1: Check frameLoader and force construction
                if (browser.frameLoader) {
                    console.log('[Little Zen Window] Browser frameLoader available');
                    try {
                        // Try to access the remote tab through frameLoader
                        const remoteTab = browser.frameLoader.remoteTab;
                        if (remoteTab) {
                            console.log('[Little Zen Window] Remote tab available through frameLoader');
                        }
                    } catch (e) {
                        console.log('[Little Zen Window] Could not access remoteTab:', e);
                    }
                } else {
                    console.log('[Little Zen Window] Browser frameLoader not available');
                    
                    // Try to force frameLoader creation
                    try {
                        browser.setAttribute('src', 'about:blank');
                        browser.removeAttribute('src');
                        console.log('[Little Zen Window] Attempted to force frameLoader creation');
                    } catch (e) {
                        console.log('[Little Zen Window] Could not force frameLoader creation:', e);
                    }
                }
                
                // Method 2: Try to access the docShell through different paths
                if (browser.browsingContext?.docShell) {
                    console.log('[Little Zen Window] DocShell available through browsingContext');
                } else if (browser.webNavigation?.QueryInterface) {
                    try {
                        const docShell = browser.webNavigation.QueryInterface(Ci.nsIDocShell);
                        if (docShell) {
                            console.log('[Little Zen Window] DocShell available through webNavigation QI');
                        }
                    } catch (e) {
                        console.log('[Little Zen Window] Could not QI webNavigation to docShell:', e);
                    }
                }
                
                // Method 3: Try to force a reflow to trigger construction
                try {
                    const rect = browser.getBoundingClientRect();
                    console.log('[Little Zen Window] Forced reflow, browser rect:', rect.width, 'x', rect.height);
                    
                    // Force style computation
                    const computedStyle = window.getComputedStyle(browser);
                    console.log('[Little Zen Window] Browser display style:', computedStyle.display);
                } catch (e) {
                    console.log('[Little Zen Window] Could not force reflow:', e);
                }
                
                // Method 4: Try to manually trigger browser construction
                try {
                    if (browser.construct && typeof browser.construct === 'function') {
                        browser.construct();
                        console.log('[Little Zen Window] Manual browser.construct() called');
                    }
                } catch (e) {
                    console.log('[Little Zen Window] Manual construct() failed:', e);
                }
                
                // Final check after all attempts
                setTimeout(() => {
                    console.log('[Little Zen Window] Final docShell status:', !!browser.docShell);
                    if (browser.docShell) {
                        console.log('[Little Zen Window] SUCCESS: DocShell finally available!');
                    } else {
                        console.warn('[Little Zen Window] DocShell still not available after all attempts');
                        console.log('[Little Zen Window] Browser state:', {
                            hasFrameLoader: !!browser.frameLoader,
                            hasWebNavigation: !!browser.webNavigation,
                            hasBrowsingContext: !!browser.browsingContext,
                            type: browser.getAttribute('type'),
                            remote: browser.getAttribute('remote'),
                            src: browser.getAttribute('src')
                        });
                    }
                }, 100);
                
            } catch (e) {
                console.warn('[Little Zen Window] Error in delayed browser initialization:', e);
            }
        } else if (browser?.docShell) {
            console.log('[Little Zen Window] DocShell already available in delayed check');
        }
    }, 200);
    
    // Check for URL parameter (for file:// URLs)
    const urlParams = new URLSearchParams(window.location.search);
    let initialUrl = urlParams.get('url');
    console.log('[Little Zen Window] URL from search params:', initialUrl);
    
    // Check for window arguments (for chrome:// URLs)
    if (!initialUrl && window.arguments && window.arguments.length > 0) {
        console.log('[Little Zen Window] Checking window arguments, length:', window.arguments.length);
        try {
            // Get URL from window arguments
            const urlArg = window.arguments[0];
            console.log('[Little Zen Window] First argument:', urlArg, typeof urlArg);
            
            if (urlArg && urlArg.QueryInterface) {
                // It's an nsISupportsString
                initialUrl = urlArg.QueryInterface(Components.interfaces.nsISupportsString).data;
                console.log('[Little Zen Window] URL from nsISupportsString:', initialUrl);
            } else if (typeof urlArg === 'string') {
                // It's a plain string
                initialUrl = urlArg;
                console.log('[Little Zen Window] URL from string:', initialUrl);
            }
        } catch (e) {
            console.warn('[Little Zen Window] Error reading window arguments:', e);
        }
    } else {
        console.log('[Little Zen Window] No window arguments found');
    }
    
    if (initialUrl) {
        console.log('[Little Zen Window] Loading initial URL:', initialUrl);
        window.zenWindow.loadUrl(decodeURIComponent(initialUrl));
    } else {
        console.log('[Little Zen Window] No initial URL found');
    }
});