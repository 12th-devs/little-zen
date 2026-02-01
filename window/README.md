# Little Zen Custom Window

A minimal custom window system for Zen Browser that intercepts external tab opens and creates dedicated windows instead of tabs.

## Features

- **External Link Interception**: Automatically detects when tabs are opened from external applications
- **Custom Window UI**: Minimal, clean interface with navigation controls
- **Window Management**: Proper window controls (minimize, maximize, close)
- **Navigation**: Back/forward buttons, address bar, refresh functionality
- **Status Indicators**: Loading progress and status messages
- **Error Handling**: Graceful error handling with retry functionality

## Files

- `custom-window.html` - Main window HTML structure
- `custom-window.css` - Styling for the custom window
- `custom-window.js` - JavaScript functionality and window management
- `launcher.js` - Test launcher for development
- `README.md` - This documentation

## Installation

1. Ensure the files are placed in: `c:\Users\colej\AppData\Roaming\zen\Profiles\z6j6hiyi.Default (twilight)\chrome\sine-mods\little-zen\window\`

2. The main `littleZen.uc.js` script should be in the parent directory and will automatically handle external tab interception.

## Usage

### Automatic Usage
When a link is opened from an external application (like clicking a link in an email or another app), the system will automatically:
1. Detect the external tab creation
2. Prevent it from opening in the main browser
3. Create a custom window instead
4. Load the URL in the custom window

### Manual Testing
You can test the custom window functionality by:

1. Opening the browser console
2. Running: `LittleZenLauncher.test()`
3. Or opening a specific URL: `LittleZenLauncher.openUrl('https://example.com')`

### Window Controls

- **Navigation**: Use the back/forward buttons or address bar
- **Address Bar**: Type URLs or search terms
- **Window Controls**: Standard minimize, maximize, close buttons
- **Menu**: Access additional options via the menu button (☰)

## Customization

### Styling
Edit `custom-window.css` to customize the appearance:
- Colors and themes
- Window dimensions
- Button styles
- Layout adjustments

### Functionality
Modify `custom-window.js` to add features:
- Custom home page
- Bookmarks integration
- Additional menu options
- Keyboard shortcuts

### Detection Logic
Update `littleZen.uc.js` to change how external tabs are detected:
- Modify `isExternalTab()` function
- Add additional detection criteria
- Change fallback behavior

## Browser Compatibility

This system is designed specifically for Zen Browser and uses:
- Firefox/Gecko APIs
- UserChrome.js functionality
- Standard web technologies (HTML, CSS, JavaScript)

## Troubleshooting

### Custom Window Not Opening
1. Check file paths are correct
2. Verify permissions on the profile directory
3. Check browser console for error messages
4. Ensure UserChrome.js is enabled

### External Links Still Opening in Tabs
1. Verify `littleZen.uc.js` is loaded
2. Check the detection logic in `isExternalTab()`
3. Look for console messages about external tab detection

### Styling Issues
1. Clear browser cache
2. Check CSS file for syntax errors
3. Verify file encoding (should be UTF-8)

## Development

To modify or extend the custom window system:

1. Edit the HTML structure in `custom-window.html`
2. Update styles in `custom-window.css`
3. Add functionality in `custom-window.js`
4. Test using `launcher.js`
5. Update detection logic in `littleZen.uc.js` if needed

## Security Notes

- The custom window uses iframes which may have CORS limitations
- Some sites may not load properly in iframe contexts
- Consider implementing additional security measures for production use

## License

This code is provided as-is for use with Zen Browser modifications.