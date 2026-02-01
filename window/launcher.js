// Little Zen Window Launcher
// This script can be used to test the custom window functionality

(function() {
    'use strict';
    
    // Function to create a test custom window
    function createTestWindow(url = 'https://www.google.com') {
        const windowPath = 'custom-window.html';
        const encodedUrl = encodeURIComponent(url);
        const windowUrl = `${windowPath}?url=${encodedUrl}`;
        
        const customWindow = window.open(
            windowUrl,
            'littleZenWindow',
            'width=1200,height=800,resizable=yes,scrollbars=yes,status=yes,location=yes,menubar=no,toolbar=no'
        );
        
        if (customWindow) {
            console.log('Little Zen custom window opened successfully');
            return customWindow;
        } else {
            console.error('Failed to open Little Zen custom window');
            return null;
        }
    }
    
    // Export for global use
    window.LittleZenLauncher = {
        createWindow: createTestWindow,
        
        // Quick test function
        test: () => {
            console.log('Testing Little Zen custom window...');
            return createTestWindow('https://example.com');
        },
        
        // Open with specific URL
        openUrl: (url) => {
            if (!url) {
                console.error('URL is required');
                return null;
            }
            return createTestWindow(url);
        }
    };
    
    console.log('Little Zen Launcher loaded. Use LittleZenLauncher.test() to test.');
    
})();