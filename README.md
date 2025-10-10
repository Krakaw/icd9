# ICD-9 Lookup - Offline Enabled

A fully offline-enabled Progressive Web App (PWA) for searching ICD-9 medical codes with favorites functionality.

## Features

### 🔍 **Search & Browse**
- Fuzzy search across ICD-9 codes, names, and synonyms
- Real-time search with instant results
- Browse all codes when no search term is entered

### ⭐ **Favorites System**
- Star/unstar codes to add to favorites
- Favorites are pinned at the top of results
- Favorites persist across sessions using localStorage
- Recently used favorites appear first

### 📱 **Progressive Web App (PWA)**
- **Installable**: Can be installed on mobile devices and desktop
- **Offline-first**: Works completely offline after initial load
- **Responsive**: Optimized for mobile and desktop
- **Fast**: Instant loading from cache

### 🔄 **Offline Capabilities**
- **Service Worker**: Caches all resources for offline use
- **Cache-first strategy**: Always serves from cache when available
- **Background sync**: Updates data when connection is restored
- **Offline indicator**: Shows connection status to user
- **Graceful degradation**: Works with cached data when offline

## Technical Implementation

### Service Worker (`sw.js`)
- Implements cache-first strategy for all resources
- Caches static files (HTML, CSS, JS, icons)
- Caches data files (JSON)
- Handles offline scenarios gracefully
- Background sync for data updates

### Web App Manifest (`manifest.json`)
- Defines PWA metadata
- Provides app icons for different sizes
- Enables installation prompts
- Sets display mode and theme colors

### Offline Detection
- Real-time online/offline status detection
- Visual indicators for connection state
- Automatic data refresh when back online
- User-friendly offline messaging

### Data Management
- **IndexedDB**: Stores dataset with versioning
- **localStorage**: Stores user favorites and preferences
- **Cache API**: Stores static resources
- **Background sync**: Updates data when possible

## File Structure

```
icd9/
├── index.html              # Main application
├── sw.js                   # Service Worker
├── manifest.json           # PWA manifest
├── fuse.min.js            # Local Fuse.js library
├── icd9.json         # ICD-9 dataset
├── icon-*.png             # PWA icons (various sizes)
├── test-offline.html      # Offline functionality test page
└── README.md              # This documentation
```

## Installation & Usage

### For Users
1. **Open the app** in a modern web browser
2. **Install as PWA** (optional):
   - Look for install prompt or browser menu
   - Click "Install" to add to home screen/apps
3. **Use offline**:
   - App works offline after first load
   - Data syncs when connection is available

### For Developers
1. **Serve the files** from a web server (required for Service Worker)
2. **Test offline functionality**:
   - Open `test-offline.html` to verify setup
   - Use browser DevTools to simulate offline
3. **Customize**:
   - Modify `manifest.json` for PWA settings
   - Update `sw.js` for caching strategies
   - Customize icons in `icon-*.png` files

## Browser Support

- **Chrome/Edge**: Full PWA support
- **Firefox**: Full PWA support
- **Safari**: Basic PWA support (iOS 11.3+)
- **Mobile browsers**: Full support on modern devices

## Testing Offline Functionality

1. **Open** `test-offline.html` in your browser
2. **Run tests** to verify all components work
3. **Test offline**:
   - Open Chrome DevTools
   - Go to Network tab
   - Check "Offline" checkbox
   - Navigate to main app
4. **Verify**:
   - App loads from cache
   - Search works with cached data
   - Favorites persist
   - Offline indicator appears

## Performance

- **First load**: Downloads and caches all resources
- **Subsequent loads**: Instant from cache
- **Offline performance**: Same as online
- **Data size**: ~2MB for full ICD-9 dataset
- **Cache size**: ~3MB total (includes all resources)

## Security & Privacy

- **No external dependencies**: All resources served locally
- **No tracking**: No analytics or external requests
- **Local storage only**: Data stays on device
- **HTTPS required**: For Service Worker and PWA features

## Troubleshooting

### Service Worker Issues
- Ensure files are served over HTTPS (or localhost)
- Check browser console for Service Worker errors
- Clear browser cache and reload

### Offline Issues
- Verify Service Worker is registered
- Check cache storage in DevTools
- Ensure all resources are cached

### PWA Installation Issues
- Check manifest.json is valid
- Verify icons are accessible
- Ensure HTTPS is used

## Future Enhancements

- [ ] ICD-10 support
- [ ] Advanced search filters
- [ ] Export functionality
- [ ] Dark mode
- [ ] Keyboard shortcuts
- [ ] Voice search
- [ ] Offline data updates via background sync

## License

This project is open source and available under the MIT License.
