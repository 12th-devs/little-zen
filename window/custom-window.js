// Little Zen Custom Window JavaScript
// CRITICAL: Set Zen Sync Flag immediately at global scope
window._zenStartupSyncFlag = "synced";

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

        // Set a unique permanentKey object for extension/adoption compatibility
        if (this.elements.webContent) {
            this.elements.webContent.permanentKey = {
                id: 'little-zen-browser-' + Date.now(),
                created: Date.now()
            };
            this.elements.webContent._zenLittleWindow = true;
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
        if (!url) return;
        
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
            if (url.includes('.') && !url.includes(' ')) {
                url = 'https://' + url;
            } else {
                url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
            }
        }
        
        this.setLoading(true);
        this.updateStatus('Loading...');
        
        try {
            this.elements.webContent.fixupAndLoadURIString(url, {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_NONE
            });
            
            this.currentUrl = url;
            this.elements.urlInput.value = url;
            
            if (this.historyIndex < this.history.length - 1) {
                this.history = this.history.slice(0, this.historyIndex + 1);
            }
            this.history.push(url);
            this.historyIndex = this.history.length - 1;
            
            this.updateNavigationButtons();
        } catch (error) {
            console.error('[Little Zen Window] Error loading URL:', error);
            this.showError('Failed to load page: ' + error.message);
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
        const browser = this.elements.webContent;
        // webNavigation is available on remote browsers (docShell lives in the content process)
        if (browser?.webNavigation) {
            this.navigateToUrl(url);
        } else {
            // Browser frame not yet attached — wait one tick and retry
            let attempts = 0;
            const tryLoad = () => {
                if (browser?.webNavigation) {
                    this.navigateToUrl(url);
                } else if (++attempts < 20) {
                    setTimeout(tryLoad, 50);
                } else {
                    this.navigateToUrl(url); // try anyway
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
        if (window.gBrowser?.selectedTab) {
            window.gBrowser.selectedTab.zenWindow = this;
            this.mockSelectedTab = window.gBrowser.selectedTab;
        }
        // Dispatch ready event so anything waiting on ZenWindowReady can proceed
        window._zenCompositorReady = true;
        window.dispatchEvent(new CustomEvent('ZenWindowReady', { detail: { compositorReady: true } }));
    }
    
    // Transfer live browser content to main window via swapDocShells (no reload)
    // This mirrors how Zen's drag-and-drop moves tabs between windows.
    async divertTabToSelectedWorkspaceViaSync() {
        if (!this.mainWindow || !this.selectedWorkspaceId) {
            console.warn('[Little Zen Window] Cannot divert - missing main window or workspace');
            return this.divertTabToSelectedWorkspace();
        }

        const selectedWorkspace = this.gZenWorkspaces.getWorkspaceFromId(this.selectedWorkspaceId);
        if (!selectedWorkspace) {
            console.error('[Little Zen Window] Selected workspace not found:', this.selectedWorkspaceId);
            return;
        }

        const ourBrowser = this.elements.webContent;
        if (!ourBrowser) {
            console.error('[Little Zen Window] No browser element found');
            return;
        }

        console.log('[Little Zen Window] Starting live tab transfer via swapDocShells');

        try {
            // Switch workspace first so the new tab lands in the right space
            await this.gZenWorkspaces.changeWorkspace(selectedWorkspace);

            // Create destination tab with about:blank — we need a real browser element
            // but we do NOT want it to start loading the real URL (that would cause a
            // reload). We swap the live docShell in before any navigation happens.
            const destTab = this.mainWindow.gBrowser.addTab('about:blank', {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                skipAnimation: true,
            });

            if (!destTab) {
                console.error('[Little Zen Window] Failed to create destination tab');
                return this.divertTabToSelectedWorkspace();
            }

            destTab.setAttribute('zen-workspace-id', this.selectedWorkspaceId);

            const destBrowser = destTab.linkedBrowser;

            // Wait for the destination browser frame to be attached (webNavigation available)
            await new Promise((resolve) => {
                let attempts = 0;
                const check = () => {
                    if (destBrowser.webNavigation || ++attempts >= 30) resolve();
                    else setTimeout(check, 50);
                };
                check();
            });

            // Stop any pending navigation in the destination browser before swapping,
            // so we don't end up with two concurrent loads after the swap.
            try { destBrowser.stop(); } catch (e) { /* ok */ }

            // swapDocShells atomically moves the live content — process, session
            // history, scroll position, form state — from ourBrowser into destBrowser.
            // This only works reliably when both browsers are in the same content
            // process. With Fission, about:blank starts in the parent process while
            // our https:// page is in a web content process, so we need to ensure
            // the destination browser is in the right process first.
            //
            // We do this by calling updateBrowserRemoteness on the destination tab
            // to move it into the same process type as our source browser.
            try {
                const remoteType = ourBrowser.remoteType;
                if (remoteType && destBrowser.remoteType !== remoteType) {
                    await this.mainWindow.gBrowser.updateBrowserRemoteness(destBrowser, {
                        remoteType,
                    });
                }
            } catch (e) {
                console.warn('[Little Zen Window] Could not update remoteness:', e);
            }

            destBrowser.swapDocShells(ourBrowser);

            // Sync tab metadata from the transferred content
            try {
                const title = destBrowser.contentTitle;
                if (title) destTab.label = title;
                if (this.mainWindow.gBrowser._tabAttrModified) {
                    this.mainWindow.gBrowser._tabAttrModified(destTab, ['label']);
                }
            } catch (e) { /* non-critical */ }

            destTab.setAttribute('zen-workspace-id', this.selectedWorkspaceId);
            try { this.mainWindow.gZenWorkspaces?.updateTabsContainers?.(); } catch (e) { /* ok */ }

            this.mainWindow.gBrowser.selectedTab = destTab;
            this.mainWindow.focus();

            console.log('[Little Zen Window] swapDocShells succeeded, closing Little Zen window');
            setTimeout(() => window.close(), 50);

        } catch (err) {
            console.error('[Little Zen Window] swapDocShells transfer failed:', err);
            this.divertTabToSelectedWorkspace();
        }
    }
}

// Initialize when window loads
window.addEventListener('load', () => {
    window.zenWindow = new LittleZenWindow();

    // Read initial URL from window arguments (chrome://) or search params (file://)
    let initialUrl = new URLSearchParams(window.location.search).get('url');

    if (!initialUrl && window.arguments?.length > 0) {
        try {
            const urlArg = window.arguments[0];
            if (urlArg?.QueryInterface) {
                initialUrl = urlArg.QueryInterface(Components.interfaces.nsISupportsString).data;
            } else if (typeof urlArg === 'string') {
                initialUrl = urlArg;
            }
        } catch (e) {
            console.warn('[Little Zen Window] Error reading window arguments:', e);
        }
    }

    if (initialUrl) {
        window.zenWindow.loadUrl(decodeURIComponent(initialUrl));
    }
});