// Little Zen Custom Window JavaScript
class LittleZenWindow {
    constructor() {
        this.currentUrl = '';
        this.history = [];
        this.historyIndex = -1;
        this.isLoading = false;
        
        this.initializeElements();
        this.bindEvents();
        this.setupWindowControls();
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
            workspaceChevron: document.getElementById('workspace-chevron')
        };
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
        
        // Wait for browser element to be fully initialized
        if (this.elements.webContent.docShell) {
            // Browser is ready, load immediately
            this.navigateToUrl(url);
        } else {
            // Browser not ready yet, wait a bit and try again
            console.log('[Little Zen Window] Browser not ready, waiting...');
            setTimeout(() => {
                if (this.elements.webContent.docShell) {
                    this.navigateToUrl(url);
                } else {
                    // Try one more time with a longer delay
                    setTimeout(() => {
                        this.navigateToUrl(url);
                    }, 500);
                }
            }, 100);
        }
    }
}

// Initialize when window loads
window.addEventListener('load', () => {
    console.log('[Little Zen Window] Window loaded, initializing...');
    
    window.zenWindow = new LittleZenWindow();
    
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