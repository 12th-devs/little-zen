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
            container: document.getElementById('window-container'),
            webContent: document.getElementById('web-content'),
            urlInput: document.getElementById('url-input'),
            backBtn: document.getElementById('back-btn'),
            forwardBtn: document.getElementById('forward-btn'),
            refreshBtn: document.getElementById('refresh-btn'),
            homeBtn: document.getElementById('home-btn'),
            menuBtn: document.getElementById('menu-btn'),
            statusText: document.getElementById('status-text'),
            progressBar: document.getElementById('progress-bar'),
            progressFill: document.getElementById('progress-fill'),
            minimizeBtn: document.getElementById('minimize-btn'),
            maximizeBtn: document.getElementById('maximize-btn'),
            closeBtn: document.getElementById('close-btn')
        };
    }
    
    bindEvents() {
        // Navigation events
        this.elements.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.navigateToUrl(e.target.value);
            }
        });
        
        this.elements.backBtn.addEventListener('click', () => this.goBack());
        this.elements.forwardBtn.addEventListener('click', () => this.goForward());
        this.elements.refreshBtn.addEventListener('click', () => this.refresh());
        this.elements.homeBtn.addEventListener('click', () => this.goHome());
        this.elements.menuBtn.addEventListener('click', () => this.showMenu());
        
        // Iframe events
        this.elements.webContent.addEventListener('load', () => {
            this.onPageLoad();
        });
        
        // URL input focus events
        this.elements.urlInput.addEventListener('focus', () => {
            this.elements.urlInput.select();
        });
    }
    
    setupWindowControls() {
        this.elements.minimizeBtn.addEventListener('click', () => {
            if (window.electronAPI) {
                window.electronAPI.minimize();
            }
        });
        
        this.elements.maximizeBtn.addEventListener('click', () => {
            if (window.electronAPI) {
                window.electronAPI.maximize();
            }
        });
        
        this.elements.closeBtn.addEventListener('click', () => {
            if (window.electronAPI) {
                window.electronAPI.close();
            } else {
                window.close();
            }
        });
    }
    
    navigateToUrl(url) {
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
        
        this.setLoading(true);
        this.updateStatus('Loading...');
        
        try {
            this.elements.webContent.src = url;
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
            this.showError('Failed to load page: ' + error.message);
        }
    }
    
    goBack() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const url = this.history[this.historyIndex];
            this.elements.webContent.src = url;
            this.elements.urlInput.value = url;
            this.currentUrl = url;
            this.updateNavigationButtons();
        }
    }
    
    goForward() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            const url = this.history[this.historyIndex];
            this.elements.webContent.src = url;
            this.elements.urlInput.value = url;
            this.currentUrl = url;
            this.updateNavigationButtons();
        }
    }
    
    refresh() {
        if (this.currentUrl) {
            this.setLoading(true);
            this.elements.webContent.src = this.currentUrl;
            this.updateStatus('Refreshing...');
        }
    }
    
    goHome() {
        const homeUrl = 'https://www.google.com';
        this.navigateToUrl(homeUrl);
    }
    
    showMenu() {
        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="menu-item" data-action="new-tab">New Tab</div>
            <div class="menu-item" data-action="bookmarks">Bookmarks</div>
            <div class="menu-item" data-action="history">History</div>
            <div class="menu-separator"></div>
            <div class="menu-item" data-action="settings">Settings</div>
            <div class="menu-item" data-action="about">About</div>
        `;
        
        // Position menu
        const rect = this.elements.menuBtn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = rect.bottom + 'px';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.style.zIndex = '1000';
        
        document.body.appendChild(menu);
        
        // Handle menu clicks
        menu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            this.handleMenuAction(action);
            menu.remove();
        });
        
        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }
    
    handleMenuAction(action) {
        switch (action) {
            case 'new-tab':
                // Open new window
                if (window.electronAPI) {
                    window.electronAPI.newWindow();
                }
                break;
            case 'bookmarks':
                this.navigateToUrl('chrome://bookmarks/');
                break;
            case 'history':
                this.navigateToUrl('chrome://history/');
                break;
            case 'settings':
                this.navigateToUrl('chrome://settings/');
                break;
            case 'about':
                this.showAbout();
                break;
        }
    }
    
    showAbout() {
        const aboutHtml = `
            <div style="padding: 20px; text-align: center; background: #1a1a1a; color: #fff;">
                <h2>Little Zen Window</h2>
                <p>A minimal browser window for Zen Browser</p>
                <p>Version 1.0.0</p>
            </div>
        `;
        this.elements.webContent.srcdoc = aboutHtml;
        this.elements.urlInput.value = 'about:zen';
        this.updateStatus('About Little Zen');
    }
    
    onPageLoad() {
        this.setLoading(false);
        this.updateStatus('Ready');
        
        try {
            // Try to get the actual URL from iframe (may be blocked by CORS)
            const iframeUrl = this.elements.webContent.contentWindow.location.href;
            if (iframeUrl && iframeUrl !== 'about:blank') {
                this.elements.urlInput.value = iframeUrl;
                this.currentUrl = iframeUrl;
            }
        } catch (e) {
            // CORS blocked, use the src we set
        }
    }
    
    setLoading(loading) {
        this.isLoading = loading;
        if (loading) {
            this.elements.container.classList.add('loading');
            this.animateProgress();
        } else {
            this.elements.container.classList.remove('loading');
            this.elements.progressBar.style.display = 'none';
            this.elements.progressFill.style.width = '0%';
        }
    }
    
    animateProgress() {
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 30;
            if (progress > 90) progress = 90;
            
            this.elements.progressFill.style.width = progress + '%';
            
            if (!this.isLoading || progress >= 90) {
                clearInterval(interval);
                if (!this.isLoading) {
                    this.elements.progressFill.style.width = '100%';
                    setTimeout(() => {
                        this.elements.progressBar.style.display = 'none';
                        this.elements.progressFill.style.width = '0%';
                    }, 200);
                }
            }
        }, 100);
    }
    
    updateStatus(text) {
        this.elements.statusText.textContent = text;
    }
    
    updateNavigationButtons() {
        this.elements.backBtn.disabled = this.historyIndex <= 0;
        this.elements.forwardBtn.disabled = this.historyIndex >= this.history.length - 1;
    }
    
    showError(message) {
        this.elements.container.classList.add('error');
        this.elements.webContent.style.display = 'none';
        
        const errorDiv = document.createElement('div');
        errorDiv.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <h2>Page Load Error</h2>
                <p>${message}</p>
                <button onclick="window.zenWindow.retry()" style="margin-top: 20px; padding: 8px 16px; background: #0078d4; color: white; border: none; border-radius: 4px; cursor: pointer;">Retry</button>
            </div>
        `;
        this.elements.contentArea.appendChild(errorDiv);
        
        this.setLoading(false);
        this.updateStatus('Error loading page');
    }
    
    retry() {
        this.elements.container.classList.remove('error');
        this.elements.webContent.style.display = 'block';
        const errorDiv = this.elements.contentArea.querySelector('div');
        if (errorDiv) errorDiv.remove();
        
        if (this.currentUrl) {
            this.navigateToUrl(this.currentUrl);
        }
    }
    
    // Public method to load URL from external source
    loadUrl(url) {
        this.navigateToUrl(url);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.zenWindow = new LittleZenWindow();
    
    // Check for URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const initialUrl = urlParams.get('url');
    if (initialUrl) {
        window.zenWindow.loadUrl(decodeURIComponent(initialUrl));
    }
});

// Add context menu styles
const contextMenuStyles = `
.context-menu {
    background: #2d2d2d;
    border: 1px solid #404040;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 150px;
    padding: 4px 0;
    font-size: 13px;
}

.menu-item {
    padding: 8px 16px;
    cursor: pointer;
    color: #cccccc;
    transition: background-color 0.2s ease;
}

.menu-item:hover {
    background: #404040;
}

.menu-separator {
    height: 1px;
    background: #404040;
    margin: 4px 0;
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = contextMenuStyles;
document.head.appendChild(styleSheet);