const library = document.getElementById("library");
const reader = document.getElementById("reader");

const importButton = document.getElementById("importButton");
const fileInput = document.getElementById("fileInput");

const bookList = document.getElementById("bookList");

const backButton = document.getElementById("backButton");
const bookTitle = document.getElementById("bookTitle");
const bookType = document.getElementById("bookType");
const readerContent = document.getElementById("readerContent");

function resetScrollState() {
    try {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } catch (e) {
        window.scrollTo(0, 0);
    }

    try {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    } catch (e) {
        // ignore browser-only scroll reset issues
    }

    if (readerContent) {
        readerContent.scrollTop = 0;
    }
}

const DB_NAME = "ReadJS";
const DB_VERSION = 1;
const STORE_NAME = "books";

const state = {
    db: null,
    currentBookId: null,
    savePositionTimeout: null,
    pdfJsPromise: null
};

// On-screen transient indicator for save/restore status. This helps testing without DevTools.
let _readjs_indicator_timeout = null;
function createIndicatorIfNeeded() {
    if (document.getElementById('readjs-indicator')) return;
    const el = document.createElement('div');
    el.id = 'readjs-indicator';
    el.className = 'readjs-indicator';
    document.body.appendChild(el);
}

function showIndicator(text, duration = 1100) {
    try {
        createIndicatorIfNeeded();
        const el = document.getElementById('readjs-indicator');
        if (!el) return;
        el.textContent = text;
        // reset transition
        el.style.transition = 'none';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        // allow transition to run
        requestAnimationFrame(() => {
            el.style.transition = 'opacity 240ms ease, transform 240ms ease';
        });

        clearTimeout(_readjs_indicator_timeout);
        _readjs_indicator_timeout = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-6px)';
        }, duration);
    } catch (e) {
        // don't let indicator break functionality
        console.warn('Indicator error', e);
    }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, {
                    keyPath: "id",
                    autoIncrement: true
                });
            }
        };

        request.onsuccess = () => {
            state.db = request.result;
            resolve(state.db);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function getBooks() {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function getBook(id) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function saveBook(file) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const book = {
            name: file.name,
            type: file.type || "application/octet-stream",
            extension: getExtension(file.name),
            file,
            addedAt: Date.now(),
            position: 0
        };

        const request = store.add(book);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function updateBook(book) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(book);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function deleteBook(id) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

async function loadLibrary() {
    const books = await getBooks();
    books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    bookList.innerHTML = "";

    if (books.length === 0) {
        bookList.innerHTML = `
            <div class="empty-library">
                <p>Your library is empty.</p>
                <span>Import a text based file.</span>
            </div>
        `;
        return;
    }

    books.forEach((book) => createBookCard(book));
}

function createBookCard(book) {
    const card = document.createElement("article");
    card.className = "book-card";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "book-open";

    const icon = document.createElement("div");
    icon.className = "book-icon";
    icon.textContent = getBookIcon(book.extension);

    const info = document.createElement("div");
    info.className = "book-card-info";

    const title = document.createElement("h3");
    // show the file name without its extension for a cleaner title
    title.textContent = stripExtension(book.name);
    // keep the full filename as a tooltip for discoverability
    title.setAttribute('title', book.name);

    const type = document.createElement("span");
    type.textContent = (book.extension || "file").toUpperCase();

    info.append(title, type);
    openButton.append(icon, info);
    openButton.addEventListener("click", () => openSavedBook(book.id));

    // show progress bar if we have stored progress
    if (typeof book.progress === 'number') {
        const progressWrap = document.createElement('div');
        progressWrap.className = 'book-progress-wrap';
        const progressBar = document.createElement('div');
        progressBar.className = 'book-progress-bar';
        progressBar.style.width = `${Math.round((book.progress || 0) * 100)}%`;
        progressWrap.appendChild(progressBar);
        info.appendChild(progressWrap);
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "×";
    deleteButton.title = "Delete book";
    deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();

        if (!confirm(`Delete "${book.name}" from your library?`)) {
            return;
        }

        try {
            await deleteBook(book.id);

            // if this was the last-opened book, clear that record
            try {
                const last = localStorage.getItem('lastBookId');
                if (last && Number(last) === book.id) {
                    localStorage.removeItem('lastBookId');
                }
            } catch (e) {
                // ignore localStorage errors
            }

            await loadLibrary();
        } catch (error) {
            console.error("Failed to delete book:", error);
        }
    });

    card.append(openButton, deleteButton);
    bookList.appendChild(card);
}

function getBookIcon(extension) {
    switch (extension) {
        case "pdf":
            return "PDF";
        case "md":
            return "MD";
        case "txt":
            return "TXT";
        default:
            return "FILE";
    }
}

importButton.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];

    if (!file) {
        return;
    }

    try {
        const bookId = await saveBook(file);
        await loadLibrary();
        await openSavedBook(bookId);
    } catch (error) {
        console.error("Failed to import book:", error);
        alert("Could not import this file.");
    } finally {
        fileInput.value = "";
    }
});

async function openSavedBook(id) {
    try {
        const book = await getBook(id);

        if (!book) {
            return;
        }

        // remember which book was last opened so we can resume across sessions
        try {
            localStorage.setItem('lastBookId', String(id));
        } catch (e) {
            console.warn('Could not save lastBookId to localStorage:', e);
        }

        state.currentBookId = id;
        await openBook(book);
    } catch (error) {
        console.error("Failed to open book:", error);
    }
}

async function openBook(book) {
    const extension = book.extension;

    // show title without extension, keep extension displayed below
    bookTitle.textContent = stripExtension(book.name);
    bookTitle.setAttribute('title', book.name);
    bookType.textContent = (extension || "file").toUpperCase();
    readerContent.innerHTML = "";
    readerContent.style.whiteSpace = "normal";

    // show the reader first so measurements (like clientWidth) are accurate when rendering
    library.classList.add("hidden");
    reader.classList.remove("hidden");
    resetScrollState();

    switch (extension) {
        case "txt":
            await renderText(book.file);
            break;
        case "md":
            await renderMarkdown(book.file);
            break;
        case "pdf":
            await renderPDF(book.file);
            break;
        default:
            throw new Error(`Unsupported file type: ${extension}`);
    }

    // restore scroll after content has been laid out; helper will retry if needed
    restoreScrollPosition(book.position || 0);
}

async function renderText(file) {
    const text = await file.text();
    readerContent.textContent = text;
    readerContent.style.whiteSpace = "pre-wrap";
}

async function renderMarkdown(file) {
    const markdown = await file.text();

    if (typeof marked === "undefined") {
        readerContent.textContent = "Markdown support could not be loaded.";
        console.error("Marked is not loaded.");
        return;
    }

    readerContent.innerHTML = marked.parse(markdown);
    readerContent.style.whiteSpace = "normal";
}

async function renderPDF(file) {
    const pdfjs = await loadPdfJs();
        // Try to open using an object URL first (avoids allocating a second copy of the file)
        let pdf;
        let blobUrl;
        try {
            blobUrl = URL.createObjectURL(file);
            state.pdfBlobUrl = blobUrl;
            pdf = await pdfjs.getDocument(blobUrl).promise;
        } catch (err) {
            console.warn('Opening PDF via blob URL failed, falling back to ArrayBuffer:', err);
            try {
                if (blobUrl) {
                    try { URL.revokeObjectURL(blobUrl); } catch (e) { }
                    state.pdfBlobUrl = null;
                }
                const data = new Uint8Array(await file.arrayBuffer());
                pdf = await pdfjs.getDocument({ data }).promise;
            } catch (err2) {
                console.error('Failed to open PDF (both blob URL and ArrayBuffer):', err2);
                throw err2;
            }
        }

    // store doc in state for page-level rendering
    state.pdfDoc = pdf;
    state.pdfNumPages = pdf.numPages;
    state.pdfRenderedPages = new Set();
    state.pdfRenderingPages = new Set();

    readerContent.innerHTML = "";

    // Render the first page to determine scale / height
    await renderPDFPage(1, true);

    // Use estimated height from first page to create placeholders for remaining pages
    const estimatedHeight = state.pdfEstimatedPageHeight || 1000;
    const fragment = document.createDocumentFragment();

    for (let pageNumber = 2; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pageWrapper = document.createElement('section');
        pageWrapper.className = 'pdf-page';
        pageWrapper.dataset.page = String(pageNumber);

        const placeholder = document.createElement('div');
        placeholder.className = 'pdf-canvas-placeholder';
        placeholder.style.height = estimatedHeight + 'px';
        placeholder.style.display = 'flex';
        placeholder.style.alignItems = 'center';
        placeholder.style.justifyContent = 'center';
        placeholder.textContent = `Page ${pageNumber}`;

        pageWrapper.appendChild(placeholder);
        fragment.appendChild(pageWrapper);
    }

    readerContent.appendChild(fragment);
    readerContent.style.whiteSpace = 'normal';

    // Setup an IntersectionObserver to render pages on demand
    if (state.pdfPageObserver) {
        state.pdfPageObserver.disconnect();
    }

    state.pdfPageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            const pageNum = Number(el.dataset.page);
            if (!pageNum) return;
            renderPDFPage(pageNum).catch((err) => console.error('Failed to render PDF page', pageNum, err));
        });
    }, {
        root: readerContent,
        rootMargin: '1200px',
        threshold: 0.01
    });

    // Observe all page wrappers (including ones already in DOM)
    const wrappers = readerContent.querySelectorAll('.pdf-page');
    wrappers.forEach((w) => state.pdfPageObserver.observe(w));

    // Also pre-render the second page if present
    if (pdf.numPages >= 2) {
        renderPDFPage(2).catch((e) => console.error('Pre-render page 2 failed', e));
    }
}

async function renderPDFPage(pageNumber, isInitial = false) {
    if (!state.pdfDoc) return;
    if (state.pdfRenderedPages && state.pdfRenderedPages.has(pageNumber)) return;
    if (state.pdfRenderingPages && state.pdfRenderingPages.has(pageNumber)) return;

    state.pdfRenderingPages.add(pageNumber);
    try {
        const page = await state.pdfDoc.getPage(pageNumber);

        // find or create wrapper for this page
        let wrapper = readerContent.querySelector(`.pdf-page[data-page="${pageNumber}"]`);
        if (!wrapper) {
            wrapper = document.createElement('section');
            wrapper.className = 'pdf-page';
            wrapper.dataset.page = String(pageNumber);

            // insert in correct order if other wrappers exist
            const all = Array.from(readerContent.querySelectorAll('.pdf-page'));
            const next = all.find(el => Number(el.dataset.page) > pageNumber);
            if (next) readerContent.insertBefore(wrapper, next);
            else readerContent.appendChild(wrapper);
        }

        // compute scale to fit CSS container while rendering at higher pixel density
        const containerWidth = Math.min(readerContent.clientWidth || 800, 800);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const cssScale = containerWidth / unscaledViewport.width;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2); // cap for performance
        const renderScale = cssScale * pixelRatio;
        const viewport = page.getViewport({ scale: renderScale });

        // create high-resolution canvas (backing store sized to device pixels)
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // set CSS size to container width so canvas scales down visually
        canvas.style.width = containerWidth + 'px';
        canvas.style.height = (viewport.height / pixelRatio) + 'px';
        canvas.style.display = 'block';
        canvas.style.maxWidth = '100%';

        // render into canvas
        try {
            await page.render({ canvasContext: context, viewport }).promise;
        } catch (renderErr) {
            console.warn('PDF page render failed at high resolution, retrying at CSS scale:', pageNumber, renderErr);
            // try again at CSS scale (no device pixel boost)
            try {
                const fallbackViewport = page.getViewport({ scale: cssScale });
                canvas.width = Math.floor(fallbackViewport.width);
                canvas.height = Math.floor(fallbackViewport.height);
                canvas.style.width = containerWidth + 'px';
                canvas.style.height = (fallbackViewport.height) + 'px';
                await page.render({ canvasContext: context, viewport: fallbackViewport }).promise;
            } catch (fallbackErr) {
                console.error('PDF page render failed at fallback scale for page', pageNumber, fallbackErr);
                // show an error placeholder so the user knows this page couldn't be rendered
                const placeholder = wrapper.querySelector('.pdf-canvas-placeholder');
                if (placeholder) {
                    placeholder.textContent = `Unable to render page ${pageNumber}`;
                    placeholder.style.color = '#ccc';
                } else {
                    const errEl = document.createElement('div');
                    errEl.className = 'pdf-canvas-placeholder';
                    errEl.textContent = `Unable to render page ${pageNumber}`;
                    wrapper.insertBefore(errEl, wrapper.firstChild);
                }

                state.pdfRenderingPages.delete(pageNumber);
                return;
            }
        }

        // replace placeholder if present
        const placeholder = wrapper.querySelector('.pdf-canvas-placeholder');
        if (placeholder) wrapper.removeChild(placeholder);

        // append canvas at top of wrapper
        wrapper.insertBefore(canvas, wrapper.firstChild);

        // store estimated CSS height from this page for placeholders
        state.pdfEstimatedPageHeight = Math.round(viewport.height / pixelRatio);

        state.pdfRenderedPages.add(pageNumber);
        // disconnect observer for this wrapper — no need to observe further
        if (state.pdfPageObserver) {
            state.pdfPageObserver.unobserve(wrapper);
        }

        // optionally indicate restore for initial page
        if (isInitial) {
            // nothing else here
        }

    } finally {
        state.pdfRenderingPages.delete(pageNumber);
    }
}

async function loadPdfJs() {
    if (!state.pdfJsPromise) {
        state.pdfJsPromise = import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs").then((pdfjs) => {
            pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
            return pdfjs;
        });
    }

    return state.pdfJsPromise;
}

// Update only position and progress for a stored book id to avoid re-putting large file objects
function saveBookPosition(id, position, progress) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = state.db.transaction(STORE_NAME, "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const getReq = store.get(id);

            getReq.onsuccess = () => {
                const book = getReq.result;
                if (!book) {
                    resolve();
                    return;
                }

                book.position = position;
                book.progress = progress;

                const putReq = store.put(book);
                                putReq.onsuccess = () => resolve();
                                putReq.onerror = () => reject(putReq.error);
            };

            getReq.onerror = () => reject(getReq.error);
        } catch (e) {
            reject(e);
        }
    });
}

// Try to restore scrollTop to a given position; retry a few times while content is still laying out
function restoreScrollPosition(position) {
    const maxAttempts = 30; // try for longer (~0.5-1s depending on frame rate)
    let attempts = 0;

    function attempt() {
        attempts += 1;

        const elementMax = Math.max(0, readerContent.scrollHeight - readerContent.clientHeight);
        const doc = document.documentElement;
        const windowMax = Math.max(0, doc.scrollHeight - window.innerHeight);

        // prefer element scroll if it can scroll
        if (elementMax > 0) {
            const top = Math.min(position || 0, elementMax);
            readerContent.scrollTop = top;
            console.debug('Restored scroll position on element', { requested: position, applied: top, elementMax, attempts });
                        try { showIndicator('Restored'); } catch (e) { }
                        return;
        }

        // otherwise apply to window if page can scroll
        if (windowMax > 0) {
            const top = Math.min(position || 0, windowMax);
            window.scrollTo(0, top);
            console.debug('Restored scroll position on window', { requested: position, applied: top, windowMax, attempts });
                        try { showIndicator('Restored'); } catch (e) { }
                        return;
        }

        if (attempts >= maxAttempts) {
            // nothing scrollable yet — just set element scrollTop anyway
            readerContent.scrollTop = position || 0;
            console.debug('Restored scroll position (final attempt)', { requested: position, applied: readerContent.scrollTop, attempts });
                        try { showIndicator('Restored'); } catch (e) { }
                        return;
        }

        requestAnimationFrame(attempt);
    }

    attempt();
}

// Unified scroll handler that works whether the reader content scrolls or the window scrolls
function getScrollMetrics() {
    // prefer an element scroll if content overflows the readerContent element
    if (readerContent.scrollHeight > readerContent.clientHeight) {
        const scrollTop = readerContent.scrollTop || 0;
        const maxScroll = Math.max(0, readerContent.scrollHeight - readerContent.clientHeight);
        return { target: 'element', scrollTop, maxScroll };
    }

    // otherwise use the page/window scroll
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const maxScroll = Math.max(0, doc.scrollHeight - window.innerHeight);
    return { target: 'window', scrollTop, maxScroll };
}

let scrollSaveTimer = null;
function handleScrollEvent() {
    if (state.currentBookId === null) return;

    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(async () => {
        try {
            const { scrollTop, maxScroll } = getScrollMetrics();
            const progress = maxScroll > 0 ? Math.min(1, scrollTop / maxScroll) : 0;

            await saveBookPosition(state.currentBookId, scrollTop, progress);
            console.debug('Saved position for book', state.currentBookId, { scrollTop, progress });
        } catch (error) {
            console.error('Failed to save reading position:', error);
        }
    }, 250);
}

// attach listeners to both the reader content and window to catch whichever scrolls
readerContent.addEventListener('scroll', handleScrollEvent, { passive: true });
window.addEventListener('scroll', handleScrollEvent, { passive: true });

// --- Pinch-to-zoom (two-finger) for PDF pages ---
// Per-page scaling: detect midpoint of pinch and scale the page wrapper nearest that point.
state.pdfPinch = {
    active: false,
    startDist: 0,
    startScale: 1,
    targetWrapper: null
};

// pan state for one-finger panning when a page is zoomed
state.pdfPan = {
    active: false,
    startX: 0,
    startY: 0,
    wrapper: null,
    startTranslateX: 0,
    startTranslateY: 0
};

function getDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

function getMidpoint(touches) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    };
}

function findPdfWrapperAtPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== readerContent) {
        if (el.classList && el.classList.contains('pdf-page')) return el;
        el = el.parentElement;
    }
    return null;
}

function handleTouchStartPinch(e) {
    if (!state.pdfDoc) return; // only for PDFs
    if (!e.touches || e.touches.length !== 2) return;

    // initialize pinch
    state.pdfPinch.active = true;
    state.pdfPinch.startDist = getDistance(e.touches);

    const mid = getMidpoint(e.touches);
    const wrapper = findPdfWrapperAtPoint(mid.x, mid.y);
    state.pdfPinch.targetWrapper = wrapper;

    if (wrapper) {
        // get current scale from dataset or default
        const cur = parseFloat(wrapper.dataset.scale || '1') || 1;
        state.pdfPinch.startScale = cur;

        // compute transform origin relative to wrapper
        const rect = wrapper.getBoundingClientRect();
        const ox = ((mid.x - rect.left) / rect.width) * 100;
        const oy = ((mid.y - rect.top) / rect.height) * 100;
        wrapper.style.transformOrigin = `${ox}% ${oy}%`;

        // raise z-index so scaled page overlays neighbors
        wrapper.style.zIndex = 20;
        wrapper.style.willChange = 'transform';

        // ensure panning state is reset
        state.pdfPan.active = false;
        state.pdfPan.targetWrapper = null;
    }
}

function handleTouchMovePinch(e) {
    if (!state.pdfPinch.active) return;
    if (!e.touches || e.touches.length !== 2) return;
    // prevent default browser pinch-zoom
    e.preventDefault();

    const dist = getDistance(e.touches);
    const scale = state.pdfPinch.startScale * (dist / state.pdfPinch.startDist);
    const minScale = 1; // do not allow zooming out smaller than original
    const maxScale = 3;
    const clamped = Math.min(maxScale, Math.max(minScale, scale));

    const wrapper = state.pdfPinch.targetWrapper;
    if (wrapper) {
        // preserve any existing translate while scaling
        const tx = parseFloat(wrapper.dataset.translateX || '0') || 0;
        const ty = parseFloat(wrapper.dataset.translateY || '0') || 0;
        wrapper.style.transform = `translate(${tx}px, ${ty}px) scale(${clamped})`;
        wrapper.dataset.scale = String(clamped);
    }
}

function handleTouchEndPinch(e) {
    if (!state.pdfPinch.active) return;

    // if less than two touches remain, finish pinch
    if (!e.touches || e.touches.length < 2) {
        const wrapper = state.pdfPinch.targetWrapper;
        if (wrapper) {
            // if the user scaled below 1, reset to 1 (do not allow zooming out past original)
            let final = parseFloat(wrapper.dataset.scale || '1') || 1;
            if (final <= 1 || Math.abs(final - 1) < 0.02) {
                // Reset to original size and center the page
                wrapper.style.transform = '';
                wrapper.dataset.scale = '1';
                wrapper.dataset.translateX = '0';
                wrapper.dataset.translateY = '0';

                // ensure wrapper content is centered
                wrapper.style.justifyContent = 'center';
            } else {
                // leave the scaled transform; user can scroll to pan
            }
            wrapper.style.zIndex = '';
            wrapper.style.willChange = '';
        }

        state.pdfPinch.active = false;
        state.pdfPinch.startDist = 0;
        state.pdfPinch.startScale = 1;
        state.pdfPinch.targetWrapper = null;
    }
}

// Pan handlers for single-finger panning when zoomed
function handleTouchStartPan(e) {
    if (!state.pdfDoc) return;
    if (!e.touches || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const wrapper = findPdfWrapperAtPoint(touch.clientX, touch.clientY);
    if (!wrapper) return;

    const scale = parseFloat(wrapper.dataset.scale || '1') || 1;
    if (scale <= 1) return; // only pan when zoomed

    state.pdfPan.active = true;
    state.pdfPan.startX = touch.clientX;
    state.pdfPan.startY = touch.clientY;
    state.pdfPan.wrapper = wrapper;
    state.pdfPan.startTranslateX = parseFloat(wrapper.dataset.translateX || '0') || 0;
    state.pdfPan.startTranslateY = parseFloat(wrapper.dataset.translateY || '0') || 0;
    wrapper.style.willChange = 'transform';
    // ensure transform-origin is center for panning to feel consistent
    wrapper.style.transformOrigin = wrapper.style.transformOrigin || '50% 50%';
}

function handleTouchMovePan(e) {
    if (!state.pdfPan.active) return;
    if (!e.touches || e.touches.length !== 1) return;

    // prevent default so the page doesn't also scroll while panning horizontally
    e.preventDefault();

    const touch = e.touches[0];
    const dx = touch.clientX - state.pdfPan.startX;
    const dy = touch.clientY - state.pdfPan.startY;

    const wrapper = state.pdfPan.wrapper;
    if (!wrapper) return;

    const scale = parseFloat(wrapper.dataset.scale || '1') || 1;
    const newX = state.pdfPan.startTranslateX + dx;
    const newY = state.pdfPan.startTranslateY + dy;

    // compute approximate clamping bounds so user cannot pan away from content entirely
    const cssWidth = wrapper.clientWidth || wrapper.offsetWidth || 0;
    const cssHeight = wrapper.clientHeight || wrapper.offsetHeight || 0;
    const scaledWidth = cssWidth * scale;
    const scaledHeight = cssHeight * scale;

    const maxOffsetX = Math.max(0, (scaledWidth - cssWidth) / 2);
    const maxOffsetY = Math.max(0, (scaledHeight - cssHeight) / 2);

    const clampedX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newX));
    const clampedY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newY));

    wrapper.style.transform = `translate(${clampedX}px, ${clampedY}px) scale(${scale})`;
    wrapper.dataset.translateX = String(clampedX);
    wrapper.dataset.translateY = String(clampedY);
}

function handleTouchEndPan(e) {
    if (!state.pdfPan.active) return;

    // finish pan
    const wrapper = state.pdfPan.wrapper;
    if (wrapper) {
        wrapper.style.willChange = '';
    }

    state.pdfPan.active = false;
    state.pdfPan.wrapper = null;
}

// Use non-passive listeners so preventDefault() works on touchmove
// touchstart must be non-passive to allow preventDefault in move handlers
readerContent.addEventListener('touchstart', (e) => { handleTouchStartPinch(e); handleTouchStartPan(e); }, { passive: false });
readerContent.addEventListener('touchmove', (e) => { handleTouchMovePinch(e); handleTouchMovePan(e); }, { passive: false });
readerContent.addEventListener('touchend', (e) => { handleTouchEndPinch(e); handleTouchEndPan(e); }, { passive: false });
readerContent.addEventListener('touchcancel', (e) => { handleTouchEndPinch(e); handleTouchEndPan(e); }, { passive: false });

backButton.addEventListener("click", async () => {
    reader.classList.add("hidden");
    library.classList.remove("hidden");
    resetScrollState();

    // disconnect PDF observer and destroy loaded doc to free memory
    try {
        if (state.pdfPageObserver) {
            state.pdfPageObserver.disconnect();
            state.pdfPageObserver = null;
        }
        if (state.pdfDoc && typeof state.pdfDoc.destroy === 'function') {
            state.pdfDoc.destroy();
        }
        if (state.pdfBlobUrl) {
            try { URL.revokeObjectURL(state.pdfBlobUrl); } catch (e) { /* ignore */ }
            state.pdfBlobUrl = null;
        }
    } catch (e) {
        console.warn('Error cleaning up PDF resources:', e);
    }

    readerContent.innerHTML = "";
    state.currentBookId = null;
    state.pdfDoc = null;
    state.pdfNumPages = null;
    state.pdfRenderedPages = null;
    state.pdfRenderingPages = null;
    state.pdfEstimatedPageHeight = null;

    await loadLibrary();
});

function stripExtension(filename) {
    if (!filename) return filename || '';
    const idx = filename.lastIndexOf('.');
    if (idx <= 0) return filename; // no extension or hidden files like .gitignore
    return filename.substring(0, idx);
}

function getExtension(filename) {
    if (!filename || !filename.includes('.')) {
        return '';
    }

    return filename.split('.').pop().toLowerCase();
}

async function start() {
    try {
        await openDatabase();
        await loadLibrary();
        resetScrollState();

            // replace feather icons (if loaded) so icon markup turns into SVGs
            try {
                if (window.feather && typeof window.feather.replace === 'function') {
                    window.feather.replace();
                }
            } catch (e) {
                console.warn('Feather icons replace failed:', e);
            }

            // Do not auto-open the last book on start — always show the library screen.
            // This keeps the app predictable and avoids reopening a book when the user
            // previously closed the app while on the library.
            // If auto-resume is desired later, add a user preference toggle and re-enable here.
        } catch (error) {
            console.error("Failed to start Read.js:", error);
        }
}

start();