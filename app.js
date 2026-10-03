/**
 * PhotoVerse — Gallery Application
 * Architecture: State Management, Cached API layer, Virtual/Batch Rendering, Event Delegation
 */

/* ==========================================================================
   1. State Management & Configuration
   ========================================================================== */
const CONFIG = {
  API_URL: 'https://jsonplaceholder.typicode.com/photos',
  CACHE_KEY: 'gallery_photos_cache_v1',
  CACHE_TTL: 3600 * 1000, // 1 hour in ms
  FAVS_KEY: 'gallery_favs_v1',
  THEME_KEY: 'gallery_theme_v1',
  LAYOUT_KEY: 'gallery_layout_v1',
  PAGE_SIZE: 24,
  SEARCH_DEBOUNCE_MS: 300,
  SLIDESHOW_INTERVAL_MS: 3500,
  FALLBACK_FULL: (id) => `https://picsum.photos/seed/${id}/600/400`,
  FALLBACK_THUMB: (id) => `https://picsum.photos/seed/${id}/150/150`,
};

const State = {
  allPhotos: [],          // Raw 5,000 photos
  filteredPhotos: [],     // After search, album, favorite filters & sorting
  renderedCount: 0,       // How many items currently rendered in DOM
  favorites: new Set(),   // Set of favorited photo IDs
  theme: 'dark',          // 'dark' | 'light'
  layout: 'masonry',      // 'masonry' | 'grid' | 'list'
  
  // Active Filter Criteria
  filters: {
    search: '',
    albumId: 'all',
    favoritesOnly: false,
    sort: 'id-asc',
  },

  // Lightbox & Slideshow State
  lightbox: {
    isOpen: false,
    currentIndex: -1,     // Index in filteredPhotos
    isSlideshow: false,
    timer: null,
    progressRaf: null,
    progressStart: null,
  }
};

// Expose on window for debugging & testing
if (typeof window !== 'undefined') {
  window.__appState = State;
}

/* ==========================================================================
   2. DOM Element Selectors
   ========================================================================== */
const DOM = {
  html: document.documentElement,
  galleryGrid: document.getElementById('gallery-grid'),
  searchInput: document.getElementById('search-input'),
  clearSearchBtn: document.getElementById('clear-search-btn'),
  albumFilter: document.getElementById('album-filter'),
  sortSelect: document.getElementById('sort-select'),
  favFilterBtn: document.getElementById('fav-filter-btn'),
  favCountBadge: document.getElementById('fav-count-badge'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  iconSun: document.querySelector('.icon-sun'),
  iconMoon: document.querySelector('.icon-moon'),
  shortcutsBtn: document.getElementById('shortcuts-btn'),
  layoutBtns: document.querySelectorAll('.layout-btn'),
  resultsCount: document.getElementById('results-count'),
  filterFeedbackBar: document.getElementById('filter-feedback-bar'),
  filterFeedbackText: document.getElementById('filter-feedback-text'),
  resetFiltersBtn: document.getElementById('reset-filters-btn'),
  emptyState: document.getElementById('empty-state'),
  emptyStateMessage: document.getElementById('empty-state-message'),
  clearFiltersBtn: document.getElementById('clear-filters-btn'),
  errorState: document.getElementById('error-state'),
  errorStateMessage: document.getElementById('error-state-message'),
  retryFetchBtn: document.getElementById('retry-fetch-btn'),
  scrollSentinel: document.getElementById('scroll-sentinel'),
  infiniteScrollLoader: document.getElementById('infinite-scroll-loader'),
  backToTopBtn: document.getElementById('back-to-top-btn'),
  toastContainer: document.getElementById('toast-container'),

  // Lightbox
  lightboxDialog: document.getElementById('lightbox-dialog'),
  lightboxCounter: document.getElementById('lightbox-counter'),
  lightboxAlbumBadge: document.getElementById('lightbox-album-badge'),
  lightboxIdBadge: document.getElementById('lightbox-id-badge'),
  lightboxTitle: document.getElementById('lightbox-title'),
  lightboxImg: document.getElementById('lightbox-img'),
  lightboxSkeleton: document.getElementById('lightbox-skeleton'),
  lightboxPrevBtn: document.getElementById('lightbox-prev-btn'),
  lightboxNextBtn: document.getElementById('lightbox-next-btn'),
  lightboxCloseBtn: document.getElementById('lightbox-close-btn'),
  lightboxFavBtn: document.getElementById('lightbox-fav-btn'),
  lightboxSlideshowBtn: document.getElementById('lightbox-slideshow-btn'),
  iconPlay: document.querySelector('.icon-play'),
  iconPause: document.querySelector('.icon-pause'),
  slideshowProgressBar: document.getElementById('slideshow-progress-bar'),
  lightboxCopyBtn: document.getElementById('lightbox-copy-btn'),
  lightboxDownloadBtn: document.getElementById('lightbox-download-btn'),
  lightboxTouchArea: document.getElementById('lightbox-touch-area'),

  // Shortcuts Dialog
  shortcutsDialog: document.getElementById('shortcuts-dialog'),
  shortcutsCloseBtn: document.getElementById('shortcuts-close-btn'),
  shortcutsDismissBtn: document.getElementById('shortcuts-dismiss-btn'),
};

/* ==========================================================================
   3. API & LocalStorage Cache Layer
   ========================================================================== */
const API = {
  /**
   * Fetches photos from JSONPlaceholder with localStorage caching and 1-hour TTL
   */
  async fetchPhotos() {
    // 1. Check localStorage Cache
    try {
      const cached = localStorage.getItem(CONFIG.CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const age = Date.now() - (parsed.timestamp || 0);
        if (age < CONFIG.CACHE_TTL && Array.isArray(parsed.data) && parsed.data.length > 0) {
          console.log(`[API] Loaded ${parsed.data.length} photos from localStorage cache.`);
          return parsed.data;
        }
      }
    } catch (err) {
      console.warn('[API] Failed reading localStorage cache:', err);
    }

    // 2. Network Fetch
    console.log('[API] Fetching 5,000 photos from JSONPlaceholder...');
    const response = await fetch(CONFIG.API_URL);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    // 3. Write back to localStorage safely
    try {
      localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (err) {
      console.warn('[API] Unable to persist cache to localStorage (quota or private mode):', err);
    }

    return data;
  },

  /**
   * Loads favorites from localStorage
   */
  loadFavorites() {
    try {
      const favs = localStorage.getItem(CONFIG.FAVS_KEY);
      if (favs) {
        const parsed = JSON.parse(favs);
        return new Set(parsed);
      }
    } catch (err) {
      console.warn('[API] Could not load favorites:', err);
    }
    return new Set();
  },

  /**
   * Saves favorites to localStorage
   */
  saveFavorites(favoritesSet) {
    try {
      localStorage.setItem(CONFIG.FAVS_KEY, JSON.stringify([...favoritesSet]));
    } catch (err) {
      console.warn('[API] Could not save favorites:', err);
    }
  },

  /**
   * Loads saved theme preference or detects OS scheme
   */
  loadTheme() {
    try {
      const savedTheme = localStorage.getItem(CONFIG.THEME_KEY);
      if (savedTheme === 'dark' || savedTheme === 'light') {
        return savedTheme;
      }
    } catch (e) {}

    // Respect prefers-color-scheme
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches 
      ? 'light' 
      : 'dark';
  },

  /**
   * Saves theme preference
   */
  saveTheme(theme) {
    try {
      localStorage.setItem(CONFIG.THEME_KEY, theme);
    } catch (e) {}
  },

  /**
   * Loads saved layout view
   */
  loadLayout() {
    try {
      const savedLayout = localStorage.getItem(CONFIG.LAYOUT_KEY);
      if (['masonry', 'grid', 'list'].includes(savedLayout)) {
        return savedLayout;
      }
    } catch (e) {}
    return 'masonry';
  },

  /**
   * Saves layout view
   */
  saveLayout(layout) {
    try {
      localStorage.setItem(CONFIG.LAYOUT_KEY, layout);
    } catch (e) {}
  }
};

/* ==========================================================================
   4. Rendering & UI Layer
   ========================================================================== */
const Render = {
  /**
   * Highlights matched search query substring in text
   */
  highlightText(text, query) {
    if (!query || !query.trim()) {
      return escapeHTML(text);
    }
    const cleanQuery = query.trim();
    // Escape regex characters
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return escapeHTML(text).replace(regex, '<mark class="highlight">$1</mark>');
  },

  /**
   * Populates the Album dropdown with 1..100
   */
  populateAlbumDropdown() {
    if (DOM.albumFilter.options.length > 1) return;
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= 100; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `Album #${i}`;
      fragment.appendChild(option);
    }
    DOM.albumFilter.appendChild(fragment);
  },

  /**
   * Builds an individual photo card DOM element
   */
  createCardElement(photo, index) {
    const isFav = State.favorites.has(photo.id);
    const highlightedTitle = Render.highlightText(photo.title, State.filters.search);

    const card = document.createElement('article');
    card.className = 'photo-card';
    card.dataset.id = String(photo.id);
    card.dataset.index = String(index);
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Photo: ${photo.title}. Press Enter to view in lightbox.`);

    // Staggered aspect ratio for masonry feel (seeded by ID)
    const aspectRatios = ['4/3', '1/1', '3/4', '16/10'];
    const assignedRatio = aspectRatios[photo.id % aspectRatios.length];

    card.innerHTML = `
      <div class="card-media-wrapper shimmer-effect" style="${State.layout === 'masonry' ? `aspect-ratio: ${assignedRatio};` : ''}">
        <div class="card-top-actions">
          <span class="card-badge">Album #${photo.albumId}</span>
          <button 
            type="button" 
            class="card-fav-btn ${isFav ? 'favorited' : ''}" 
            data-fav-id="${photo.id}" 
            aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}"
            title="${isFav ? 'Favorited' : 'Add to favorites'}"
          >
            <svg class="heart-icon" viewBox="0 0 24 24" width="16" height="16" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
        </div>
        <img 
          class="card-img" 
          src="${photo.thumbnailUrl}" 
          alt="${escapeHTML(photo.title)}" 
          loading="lazy" 
          decoding="async"
        >
        <div class="card-overlay">
          <span class="overlay-view-text">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
            Click to view photo
          </span>
        </div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${highlightedTitle}</h3>
        <div class="card-footer">
          <span>Photo #${photo.id}</span>
          <span>Album #${photo.albumId}</span>
        </div>
      </div>
    `;

    const img = card.querySelector('.card-img');
    const mediaWrapper = card.querySelector('.card-media-wrapper');

    // Onload handler: reveals image and removes skeleton shimmer
    img.addEventListener('load', () => {
      img.classList.add('loaded');
      mediaWrapper.classList.remove('shimmer-effect');
    }, { once: true });

    // Onerror fallback: via.placeholder can be down or slow, fall back to Picsum
    img.addEventListener('error', () => {
      img.onerror = null;
      img.src = CONFIG.FALLBACK_THUMB(photo.id);
    }, { once: true });

    return card;
  },

  /**
   * Appends the next batch (24 photos) to the gallery grid
   */
  renderNextBatch() {
    const total = State.filteredPhotos.length;
    if (State.renderedCount >= total) {
      DOM.infiniteScrollLoader.classList.add('hidden');
      return;
    }

    DOM.infiniteScrollLoader.classList.remove('hidden');

    const nextBatchEnd = Math.min(State.renderedCount + CONFIG.PAGE_SIZE, total);
    const fragment = document.createDocumentFragment();

    for (let i = State.renderedCount; i < nextBatchEnd; i++) {
      const card = Render.createCardElement(State.filteredPhotos[i], i);
      fragment.appendChild(card);
    }

    DOM.galleryGrid.appendChild(fragment);
    State.renderedCount = nextBatchEnd;

    Render.updateResultsStatus();

    // Hide loader if we reached the end
    if (State.renderedCount >= total) {
      DOM.infiniteScrollLoader.classList.add('hidden');
    }
  },

  /**
   * Completely resets and re-renders the gallery from index 0
   */
  resetAndRender() {
    DOM.galleryGrid.innerHTML = '';
    State.renderedCount = 0;

    const total = State.filteredPhotos.length;

    // Check empty state
    if (total === 0) {
      DOM.emptyState.classList.remove('hidden');
      DOM.infiniteScrollLoader.classList.add('hidden');
      DOM.scrollSentinel.classList.add('hidden');

      if (State.filters.favoritesOnly && State.favorites.size === 0) {
        DOM.emptyStateMessage.textContent = "You haven't added any photos to your favorites yet. Click the heart icon on any photo to save it!";
      } else {
        DOM.emptyStateMessage.textContent = "We couldn't find any photos matching your current search or filter criteria.";
      }
    } else {
      DOM.emptyState.classList.add('hidden');
      DOM.scrollSentinel.classList.remove('hidden');
      Render.renderNextBatch();
    }

    Render.updateResultsStatus();
    Render.updateFilterFeedbackBar();
  },

  /**
   * Updates header count, feedback bar, and active filter info
   */
  updateResultsStatus() {
    const totalFiltered = State.filteredPhotos.length;
    const totalAll = State.allPhotos.length;

    if (totalFiltered === 0) {
      DOM.resultsCount.textContent = '0 photos';
    } else {
      DOM.resultsCount.textContent = `Showing ${Math.min(State.renderedCount, totalFiltered).toLocaleString()} of ${totalFiltered.toLocaleString()} photos`;
    }

    // Update Favorites Badge
    DOM.favCountBadge.textContent = String(State.favorites.size);
  },

  /**
   * Displays or hides active filter chip bar
   */
  updateFilterFeedbackBar() {
    const activeFilters = [];
    if (State.filters.search.trim()) {
      activeFilters.push(`Search: "${State.filters.search.trim()}"`);
    }
    if (State.filters.albumId !== 'all') {
      activeFilters.push(`Album #${State.filters.albumId}`);
    }
    if (State.filters.favoritesOnly) {
      activeFilters.push('Favorites only');
    }

    if (activeFilters.length > 0) {
      DOM.filterFeedbackBar.classList.remove('hidden');
      DOM.filterFeedbackText.textContent = `Active Filters: ${activeFilters.join(' • ')}`;
    } else {
      DOM.filterFeedbackBar.classList.add('hidden');
    }
  },

  /**
   * Toast notification helper with stackable animations
   */
  showToast(message, iconSvg = '') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `${iconSvg}<span>${escapeHTML(message)}</span>`;
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 2800);
  },

  /**
   * Preloads adjacent images for snappy lightbox navigation
   */
  preloadAdjacent(index) {
    const prev = State.filteredPhotos[index - 1];
    const next = State.filteredPhotos[index + 1];

    if (prev) {
      const imgPrev = new Image();
      imgPrev.src = prev.url;
      imgPrev.onerror = () => { imgPrev.src = CONFIG.FALLBACK_FULL(prev.id); };
    }
    if (next) {
      const imgNext = new Image();
      imgNext.src = next.url;
      imgNext.onerror = () => { imgNext.src = CONFIG.FALLBACK_FULL(next.id); };
    }
  },

  /**
   * Opens or updates the Lightbox viewer
   */
  openLightbox(index) {
    if (index < 0 || index >= State.filteredPhotos.length) return;

    State.lightbox.currentIndex = index;
    State.lightbox.isOpen = true;
    const photo = State.filteredPhotos[index];

    // Counter e.g. "12 / 5,000"
    DOM.lightboxCounter.textContent = `${(index + 1).toLocaleString()} / ${State.filteredPhotos.length.toLocaleString()}`;
    DOM.lightboxAlbumBadge.textContent = `Album #${photo.albumId}`;
    DOM.lightboxIdBadge.textContent = `ID: #${photo.id}`;
    DOM.lightboxTitle.textContent = photo.title;

    // Reset image display & show skeleton
    DOM.lightboxImg.classList.remove('loaded');
    DOM.lightboxSkeleton.classList.remove('hidden');
    DOM.lightboxImg.src = '';
    DOM.lightboxImg.alt = photo.title;

    // Load full-resolution image
    const fullImg = new Image();
    fullImg.onload = () => {
      DOM.lightboxImg.src = fullImg.src;
      DOM.lightboxImg.classList.add('loaded');
      DOM.lightboxSkeleton.classList.add('hidden');
    };
    fullImg.onerror = () => {
      // Fallback to Picsum seed
      DOM.lightboxImg.src = CONFIG.FALLBACK_FULL(photo.id);
      DOM.lightboxImg.classList.add('loaded');
      DOM.lightboxSkeleton.classList.add('hidden');
    };
    fullImg.src = photo.url;

    // Update favorite button in lightbox
    const isFav = State.favorites.has(photo.id);
    DOM.lightboxFavBtn.classList.toggle('favorited', isFav);
    DOM.lightboxFavBtn.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
    DOM.lightboxFavBtn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');

    // Preload next and previous
    Render.preloadAdjacent(index);

    // Open modal if not already open
    if (!DOM.lightboxDialog.open) {
      DOM.lightboxDialog.showModal();
    }
  },

  /**
   * Navigates lightbox prev/next
   */
  navigateLightbox(direction) {
    if (!State.lightbox.isOpen) return;

    let newIndex = State.lightbox.currentIndex + direction;
    const total = State.filteredPhotos.length;

    if (newIndex < 0) {
      newIndex = total - 1; // loop back
    } else if (newIndex >= total) {
      newIndex = 0; // loop to start
    }

    Render.openLightbox(newIndex);

    // If slideshow active, reset progress
    if (State.lightbox.isSlideshow) {
      Slideshow.resetProgress();
    }
  },

  /**
   * Applies the theme ('dark' | 'light')
   */
  applyTheme(theme) {
    State.theme = theme;
    DOM.html.setAttribute('data-theme', theme);
    if (theme === 'light') {
      DOM.iconSun.classList.add('hidden');
      DOM.iconMoon.classList.remove('hidden');
      DOM.themeToggleBtn.setAttribute('title', 'Switch to dark theme (t)');
    } else {
      DOM.iconSun.classList.remove('hidden');
      DOM.iconMoon.classList.add('hidden');
      DOM.themeToggleBtn.setAttribute('title', 'Switch to light theme (t)');
    }
    API.saveTheme(theme);
  },

  /**
   * Applies layout ('masonry' | 'grid' | 'list')
   */
  applyLayout(layout) {
    State.layout = layout;
    DOM.galleryGrid.className = `gallery-container layout-${layout}`;
    DOM.layoutBtns.forEach(btn => {
      const isActive = btn.dataset.layout === layout;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
    });
    API.saveLayout(layout);

    // Update aspect ratios if needed
    document.querySelectorAll('.card-media-wrapper').forEach((wrapper, idx) => {
      if (layout === 'masonry') {
        const aspectRatios = ['4/3', '1/1', '3/4', '16/10'];
        wrapper.style.aspectRatio = aspectRatios[idx % aspectRatios.length];
      } else {
        wrapper.style.aspectRatio = '';
      }
    });
  }
};

/* ==========================================================================
   5. Slideshow Controller
   ========================================================================== */
const Slideshow = {
  start() {
    State.lightbox.isSlideshow = true;
    DOM.iconPlay.classList.add('hidden');
    DOM.iconPause.classList.remove('hidden');
    DOM.lightboxSlideshowBtn.setAttribute('title', 'Pause slideshow (Space)');
    DOM.lightboxSlideshowBtn.setAttribute('aria-label', 'Pause slideshow');

    Slideshow.resetProgress();
  },

  pause() {
    State.lightbox.isSlideshow = false;
    DOM.iconPlay.classList.remove('hidden');
    DOM.iconPause.classList.add('hidden');
    DOM.lightboxSlideshowBtn.setAttribute('title', 'Play slideshow (Space)');
    DOM.lightboxSlideshowBtn.setAttribute('aria-label', 'Play slideshow');

    if (State.lightbox.timer) {
      clearTimeout(State.lightbox.timer);
      State.lightbox.timer = null;
    }
    if (State.lightbox.progressRaf) {
      cancelAnimationFrame(State.lightbox.progressRaf);
      State.lightbox.progressRaf = null;
    }
    DOM.slideshowProgressBar.style.width = '0%';
  },

  toggle() {
    if (State.lightbox.isSlideshow) {
      Slideshow.pause();
    } else {
      Slideshow.start();
    }
  },

  resetProgress() {
    if (!State.lightbox.isSlideshow) return;

    if (State.lightbox.timer) clearTimeout(State.lightbox.timer);
    if (State.lightbox.progressRaf) cancelAnimationFrame(State.lightbox.progressRaf);

    DOM.slideshowProgressBar.style.width = '0%';
    const startTime = performance.now();
    const duration = CONFIG.SLIDESHOW_INTERVAL_MS;

    function frame(now) {
      const elapsed = now - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);
      DOM.slideshowProgressBar.style.width = `${progress}%`;

      if (elapsed < duration) {
        State.lightbox.progressRaf = requestAnimationFrame(frame);
      }
    }

    State.lightbox.progressRaf = requestAnimationFrame(frame);

    State.lightbox.timer = setTimeout(() => {
      Render.navigateLightbox(1);
    }, duration);
  }
};

/* ==========================================================================
   6. Data Filtering & Sorting Logic
   ========================================================================== */
const Data = {
  applyFilters() {
    const { search, albumId, favoritesOnly, sort } = State.filters;
    const cleanSearch = search.trim().toLowerCase();

    // 1. Filter
    let result = State.allPhotos.filter(photo => {
      // Album filter
      if (albumId !== 'all' && String(photo.albumId) !== albumId) {
        return false;
      }
      // Favorites filter
      if (favoritesOnly && !State.favorites.has(photo.id)) {
        return false;
      }
      // Search filter
      if (cleanSearch && !photo.title.toLowerCase().includes(cleanSearch)) {
        return false;
      }
      return true;
    });

    // 2. Sort
    if (sort === 'id-asc') {
      result.sort((a, b) => a.id - b.id);
    } else if (sort === 'id-desc') {
      result.sort((a, b) => b.id - a.id);
    } else if (sort === 'title-asc') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'title-desc') {
      result.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sort === 'shuffle') {
      // Fisher-Yates shuffle
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
    }

    State.filteredPhotos = result;
    Render.resetAndRender();
  },

  toggleFavorite(photoId) {
    const id = Number(photoId);
    let isNowFav = false;

    if (State.favorites.has(id)) {
      State.favorites.delete(id);
      isNowFav = false;
    } else {
      State.favorites.add(id);
      isNowFav = true;
    }

    API.saveFavorites(State.favorites);
    DOM.favCountBadge.textContent = String(State.favorites.size);

    // Update in-place card hearts
    document.querySelectorAll(`[data-fav-id="${id}"]`).forEach(btn => {
      btn.classList.toggle('favorited', isNowFav);
      btn.setAttribute('aria-label', isNowFav ? 'Remove from favorites' : 'Add to favorites');
      btn.querySelector('svg').setAttribute('fill', isNowFav ? 'currentColor' : 'none');
    });

    // Update lightbox heart if current
    if (State.lightbox.isOpen && State.filteredPhotos[State.lightbox.currentIndex]?.id === id) {
      DOM.lightboxFavBtn.classList.toggle('favorited', isNowFav);
      DOM.lightboxFavBtn.setAttribute('aria-label', isNowFav ? 'Remove from favorites' : 'Add to favorites');
      DOM.lightboxFavBtn.querySelector('svg').setAttribute('fill', isNowFav ? 'currentColor' : 'none');
    }

    // Feedback toast
    Render.showToast(isNowFav ? 'Added to favorites' : 'Removed from favorites', `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="${isNowFav ? '#f43f5e' : 'none'}" stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
      </svg>
    `);

    // If favoritesOnly filter is active and item was unfavorited, re-filter
    if (State.filters.favoritesOnly) {
      Data.applyFilters();
    }
  },

  resetAllFilters() {
    State.filters.search = '';
    State.filters.albumId = 'all';
    State.filters.favoritesOnly = false;
    State.filters.sort = 'id-asc';

    DOM.searchInput.value = '';
    DOM.clearSearchBtn.classList.add('hidden');
    DOM.albumFilter.value = 'all';
    DOM.sortSelect.value = 'id-asc';
    DOM.favFilterBtn.setAttribute('aria-pressed', 'false');

    Data.applyFilters();
  }
};

let listenersAttached = false;
function setupEventListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  // --- Live Search with Debounce ---
  let debounceTimeout = null;
  DOM.searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    DOM.clearSearchBtn.classList.toggle('hidden', val.length === 0);

    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      State.filters.search = val;
      Data.applyFilters();
    }, CONFIG.SEARCH_DEBOUNCE_MS);
  });

  DOM.clearSearchBtn.addEventListener('click', () => {
    DOM.searchInput.value = '';
    DOM.clearSearchBtn.classList.add('hidden');
    State.filters.search = '';
    DOM.searchInput.focus();
    Data.applyFilters();
  });

  // --- Album Filter ---
  DOM.albumFilter.addEventListener('change', (e) => {
    State.filters.albumId = e.target.value;
    Data.applyFilters();
  });

  // --- Sort Selector ---
  DOM.sortSelect.addEventListener('change', (e) => {
    State.filters.sort = e.target.value;
    Data.applyFilters();
  });

  // --- Favorites Only Filter ---
  DOM.favFilterBtn.addEventListener('click', () => {
    const currentlyPressed = DOM.favFilterBtn.getAttribute('aria-pressed') === 'true';
    const nextState = !currentlyPressed;
    DOM.favFilterBtn.setAttribute('aria-pressed', String(nextState));
    State.filters.favoritesOnly = nextState;
    Data.applyFilters();
  });

  // --- Reset Filter Buttons ---
  DOM.resetFiltersBtn.addEventListener('click', Data.resetAllFilters);
  DOM.clearFiltersBtn.addEventListener('click', Data.resetAllFilters);

  // --- Layout Switcher ---
  DOM.layoutBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const chosen = btn.dataset.layout;
      if (chosen !== State.layout) {
        Render.applyLayout(chosen);
      }
    });
  });

  // --- Theme Toggle ---
  DOM.themeToggleBtn.addEventListener('click', () => {
    const nextTheme = State.theme === 'dark' ? 'light' : 'dark';
    Render.applyTheme(nextTheme);
  });

  // --- Gallery Card Clicks (Event Delegation) ---
  DOM.galleryGrid.addEventListener('click', (e) => {
    const favBtn = e.target.closest('.card-fav-btn');
    if (favBtn) {
      e.stopPropagation();
      Data.toggleFavorite(favBtn.dataset.favId);
      return;
    }

    const card = e.target.closest('.photo-card');
    if (card && card.dataset.id) {
      const id = parseInt(card.dataset.id, 10);
      const index = State.filteredPhotos.findIndex(p => p.id === id);
      if (index !== -1) {
        Render.openLightbox(index);
      }
    }
  });

  // Keyboard navigation on cards (Enter or Space to open)
  DOM.galleryGrid.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('photo-card') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const id = parseInt(e.target.dataset.id, 10);
      const index = State.filteredPhotos.findIndex(p => p.id === id);
      if (index !== -1) {
        Render.openLightbox(index);
      }
    }
  });

  // --- Infinite Scroll with IntersectionObserver ---
  const scrollObserver = new IntersectionObserver((entries) => {
    const [entry] = entries;
    if (entry.isIntersecting && State.filteredPhotos.length > State.renderedCount) {
      Render.renderNextBatch();
    }
  }, {
    rootMargin: '400px 0px',
  });
  scrollObserver.observe(DOM.scrollSentinel);

  // --- Floating "Back to Top" Button ---
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      DOM.backToTopBtn.classList.remove('hidden');
    } else {
      DOM.backToTopBtn.classList.add('hidden');
    }
  }, { passive: true });

  DOM.backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    DOM.searchInput.focus({ preventScroll: true });
  });

  // --- Lightbox Controls ---
  DOM.lightboxPrevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Render.navigateLightbox(-1);
  });

  DOM.lightboxNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Render.navigateLightbox(1);
  });

  DOM.lightboxCloseBtn.addEventListener('click', () => {
    DOM.lightboxDialog.close();
  });

  DOM.lightboxDialog.addEventListener('close', () => {
    State.lightbox.isOpen = false;
    Slideshow.pause();
  });

  DOM.lightboxFavBtn.addEventListener('click', () => {
    const currentPhoto = State.filteredPhotos[State.lightbox.currentIndex];
    if (currentPhoto) {
      Data.toggleFavorite(currentPhoto.id);
    }
  });

  DOM.lightboxSlideshowBtn.addEventListener('click', () => {
    Slideshow.toggle();
  });

  // Copy Image Link
  DOM.lightboxCopyBtn.addEventListener('click', async () => {
    const currentPhoto = State.filteredPhotos[State.lightbox.currentIndex];
    if (!currentPhoto) return;

    try {
      await navigator.clipboard.writeText(currentPhoto.url);
      Render.showToast('Image link copied to clipboard!', `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `);
    } catch (err) {
      Render.showToast('Could not copy link to clipboard');
    }
  });

  // Download Button (Fetch Blob with Fallback)
  DOM.lightboxDownloadBtn.addEventListener('click', async () => {
    const currentPhoto = State.filteredPhotos[State.lightbox.currentIndex];
    if (!currentPhoto) return;

    Render.showToast('Preparing download...', `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `);

    try {
      const response = await fetch(DOM.lightboxImg.src);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `photoverse-${currentPhoto.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      Render.showToast('Download complete!');
    } catch (err) {
      // Direct anchor click fallback
      const a = document.createElement('a');
      a.href = DOM.lightboxImg.src;
      a.download = `photoverse-${currentPhoto.id}.jpg`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });

  // Touch Swipe for Lightbox (Mobile)
  let touchStartX = 0;
  let touchStartY = 0;

  DOM.lightboxTouchArea.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  DOM.lightboxTouchArea.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    // Minimum swipe threshold 50px, and horizontal dominant
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        Render.navigateLightbox(1); // Swipe left = next
      } else {
        Render.navigateLightbox(-1); // Swipe right = prev
      }
    }
  }, { passive: true });

  // --- Keyboard Shortcuts Help Dialog ---
  DOM.shortcutsBtn.addEventListener('click', () => {
    DOM.shortcutsDialog.showModal();
  });
  DOM.shortcutsCloseBtn.addEventListener('click', () => {
    DOM.shortcutsDialog.close();
  });
  DOM.shortcutsDismissBtn.addEventListener('click', () => {
    DOM.shortcutsDialog.close();
  });

  // --- Global Keyboard Shortcuts ---
  window.addEventListener('keydown', (e) => {
    // If typing in input/select, don't trigger global shortcuts except Escape
    const isTyping = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);

    if (e.key === 'Escape') {
      if (DOM.shortcutsDialog.open) {
        DOM.shortcutsDialog.close();
        return;
      }
      if (DOM.lightboxDialog.open) {
        DOM.lightboxDialog.close();
        return;
      }
    }

    if (isTyping) return;

    // '/' focuses search
    if (e.key === '/') {
      e.preventDefault();
      DOM.searchInput.focus();
      return;
    }

    // 't' toggles theme
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      const nextTheme = State.theme === 'dark' ? 'light' : 'dark';
      Render.applyTheme(nextTheme);
      return;
    }

    // '?' opens shortcuts modal
    if (e.key === '?') {
      e.preventDefault();
      if (DOM.shortcutsDialog.open) {
        DOM.shortcutsDialog.close();
      } else {
        DOM.shortcutsDialog.showModal();
      }
      return;
    }

    // 'f' favorites the open lightbox photo or currently focused photo card
    if (e.key === 'f' || e.key === 'F') {
      if (State.lightbox.isOpen) {
        e.preventDefault();
        const currentPhoto = State.filteredPhotos[State.lightbox.currentIndex];
        if (currentPhoto) {
          Data.toggleFavorite(currentPhoto.id);
        }
        return;
      } else if (document.activeElement && document.activeElement.classList.contains('photo-card')) {
        e.preventDefault();
        const cardId = document.activeElement.dataset.id;
        if (cardId) {
          Data.toggleFavorite(cardId);
        }
        return;
      }
    }

    // Lightbox open navigation shortcuts
    if (State.lightbox.isOpen) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        Render.navigateLightbox(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        Render.navigateLightbox(1);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        Slideshow.toggle();
      }
    }
  });

  // --- Error Retry Button ---
  DOM.retryFetchBtn.addEventListener('click', () => {
    DOM.errorState.classList.add('hidden');
    initializeApp();
  });
}

/* ==========================================================================
   8. Application Initialization
   ========================================================================== */
async function initializeApp() {
  try {
    // 1. Restore Preferences
    State.favorites = API.loadFavorites();
    DOM.favCountBadge.textContent = String(State.favorites.size);

    const savedTheme = API.loadTheme();
    Render.applyTheme(savedTheme);

    const savedLayout = API.loadLayout();
    Render.applyLayout(savedLayout);

    // 2. Setup Dropdowns and Events
    Render.populateAlbumDropdown();
    setupEventListeners();

    // 3. Fetch Photos
    const photos = await API.fetchPhotos();
    State.allPhotos = photos;
    State.filteredPhotos = [...photos];

    // 4. Render Initial Batch
    Render.resetAndRender();

  } catch (error) {
    console.error('[App] Failed to initialize:', error);
    DOM.galleryGrid.innerHTML = '';
    DOM.emptyState.classList.add('hidden');
    DOM.errorState.classList.remove('hidden');
    DOM.errorStateMessage.textContent = error.message || 'Failed to fetch photos from JSONPlaceholder.';
    DOM.resultsCount.textContent = 'Error loading photos';
  }
}

// Helper: Escape HTML
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Boot application
initializeApp();
