/* dsh-novel-reader — client half.
 *
 * A floating "摸鱼" reader registered into DSH's `shell.overlay` slot,
 * styled with DSH web design tokens (--dsw-alias-* semantics) so it adapts
 * to light/dark themes exactly like native DSH UI.
 *
 * Features:
 * - Translucent-white icon launcher, freely draggable; click opens the panel.
 * - Resizable reader panel (drag any edge/corner).
 * - Reading progress + shelf (书架) persisted in localStorage.
 * - Visited-chapter history persisted (翻过的章节链接).
 * - Prefetch of prev/next chapter into an in-memory cache.
 * - Paginated TOC starting at the page of the current chapter, with direct
 *   page-number jumps.
 * - Book search to switch novels.
 *
 * All content fetching goes through the same-origin /novel routes the host
 * half owns, so the browser never hits CORS or the anti-bot wall.
 */
window.__ModuleLoader__.load({
  id: 'dsh-novel-reader',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var jsxRuntime = require('react/jsx-runtime')
    // createPortal lets us render the floating panel directly onto
    // document.body, escaping the shell.overlay layer's stacking context
    // (its container is z-index 20, so sidebar plugins at z 40 would
    // otherwise cover us).
    var reactDom = require('react-dom')
    var createPortal = reactDom.createPortal

    var DEFAULT_BOOK = '95426' // 异兽迷城
    var DEFAULT_URL =
      'http://www.hongmengxsw.com/hongmeng_95426/45985427.html'

    var API = window.location.origin + '/novel'
    var LS_PREFIX = 'dsh-novel-reader:'

    var createElement = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useRef = react.useRef
    var useCallback = react.useCallback

    /* ── localStorage helpers (safe; degrade to memory when unavailable) ── */
    var memStore = {}
    function lsGet(key) {
      try {
        var raw = window.localStorage.getItem(LS_PREFIX + key)
        return raw === null ? undefined : JSON.parse(raw)
      } catch {
        return memStore[key]
      }
    }
    function lsSet(key, value) {
      try {
        window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
      } catch {
        memStore[key] = value
      }
    }

    /* ── chapter cache: url -> {title, content, prev, next} ── */
    var chapterCache = {}
    function cacheGet(url) {
      return chapterCache[url]
    }
    function cacheSet(url, data) {
      chapterCache[url] = data
    }

    /* Extract "第N章" from a chapter title (returns N or null). */
    function chapterNoOf(title) {
      if (!title) return null
      var m = /第\s*(\d+)\s*章/.exec(title)
      return m ? parseInt(m[1], 10) : null
    }

    /* ── DSH token styles ── */
    var launcherStyle = {
      position: 'fixed',
      width: '42px',
      height: '42px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(255, 255, 255, 0.72)',
      WebkitBackdropFilter: 'blur(14px) saturate(1.4)',
      backdropFilter: 'blur(14px) saturate(1.4)',
      color: 'var(--dsw-static-neutral-bluish-950, #151517)',
      borderRadius: '50%',
      border: '1px solid rgba(255, 255, 255, 0.6)',
      cursor: 'grab',
      fontSize: '19px',
      lineHeight: '1',
      boxShadow: '0 2px 14px rgba(0,0,0,0.18)',
      zIndex: 2147483000,
      transition: 'background 180ms var(--ds-ease-in-out, ease)',
      userSelect: 'none',
    }

    var panelStyle = {
      position: 'fixed',
      width: '420px',
      height: '560px',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--dsw-alias-bg-layer-1, #232324)',
      color: 'var(--dsw-alias-label-primary, #e8e8ee)',
      border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
      borderRadius: '12px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.30)',
      zIndex: 2147483000,
      overflow: 'hidden',
    }

    var headerStyle = {
      display: 'flex',
      alignItems: 'center',
      height: '40px',
      padding: '0 8px 0 14px',
      cursor: 'move',
      userSelect: 'none',
      flex: '0 0 auto',
      borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06))',
    }

    var iconBtn = {
      background: 'transparent',
      border: 'none',
      color: 'var(--dsw-alias-label-secondary, #b0b0c0)',
      borderRadius: '6px',
      padding: '3px 8px',
      cursor: 'pointer',
      fontSize: '12px',
      flex: '0 0 auto',
      transition: 'background 150ms var(--ds-ease-in-out, ease), color 150ms var(--ds-ease-in-out, ease)',
    }

    // The scrollable body: overflowY auto, minHeight 0 (flex scroll fix),
    // and NO overflow:hidden shorthand (that would kill the scrollbar).
    var bodyTextStyle = {
      flex: '1 1 auto',
      minHeight: '0',
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '14px 18px',
      lineHeight: '1.9',
      fontSize: '15px',
      color: 'var(--dsw-alias-label-primary, #e8e8ee)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }

    function apiCall(path, params) {
      var qs = Object.keys(params || {})
        .map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]))
        })
        .join('&')
      return fetch(API + path + (qs ? '?' + qs : ''), { credentials: 'same-origin' }).then(function (r) {
        return r.json().then(function (j) {
          if (!j.ok) throw new Error((j.error && j.error.message) || 'request failed')
          return j
        })
      })
    }

    function ReaderPanel(props) {
      var posRef = useRef((function () {
        var saved = lsGet('pos')
        return saved || { x: Math.max(0, window.innerWidth - 470), y: Math.max(0, window.innerHeight - 600) }
      })())
      var sizeRef = useRef((function () {
        var saved = lsGet('size')
        return saved || { width: 420, height: 560 }
      })())
      // The scrollable reading body; scroll to top whenever the chapter changes.
      var bodyRef = useRef(null)

      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]

      var viewState = useState('reader') // reader | toc | search | shelf
      var view = viewState[0]
      var setView = viewState[1]

      var titleState = useState('')
      var title = titleState[0]
      var setTitle = titleState[1]

      var bookNameState = useState('')
      var bookName = bookNameState[0]
      var setBookName = bookNameState[1]

      var bookAuthorState = useState('')
      var bookAuthor = bookAuthorState[0]
      var setBookAuthor = bookAuthorState[1]

      var contentState = useState('')
      var content = contentState[0]
      var setContent = contentState[1]

      var loadingState = useState(false)
      var loading = loadingState[0]
      var setLoading = loadingState[1]

      var errorState = useState('')
      var error = errorState[0]
      var setError = errorState[1]

      var navState = useState(null)
      var nav = navState[0]
      var setNav = navState[1]

      // current chapter url (for progress persistence)
      var currentUrlState = useState(DEFAULT_URL)
      var currentUrl = currentUrlState[0]
      var setCurrentUrl = currentUrlState[1]

      var currentBookState = useState(DEFAULT_BOOK)
      var currentBook = currentBookState[0]
      var setCurrentBook = currentBookState[1]

      // TOC
      var tocState = useState([])
      var toc = tocState[0]
      var setToc = tocState[1]
      var tocPageState = useState(1)
      var tocPage = tocPageState[0]
      var setTocPage = tocPageState[1]
      var tocPagesState = useState(1)
      var tocPages = tocPagesState[0]
      var setTocPages = tocPagesState[1]
      var tocBookState = useState(DEFAULT_BOOK)
      var tocBook = tocBookState[0]
      var setTocBook = tocBookState[1]
      var tocLoadingState = useState(false)
      var tocLoading = tocLoadingState[0]
      var setTocLoading = tocLoadingState[1]
      var pageRangesState = useState(null)
      var pageRanges = pageRangesState[0]
      var setPageRanges = pageRangesState[1]
      var jumpInputState = useState('')
      var jumpInput = jumpInputState[0]
      var setJumpInput = jumpInputState[1]

      // shelf
      var shelfState = useState([])
      var shelf = shelfState[0]
      var setShelf = shelfState[1]
      var historyState = useState([])
      var history = historyState[0]
      var setHistory = historyState[1]

      // search
      var searchQueryState = useState('')
      var searchQuery = searchQueryState[0]
      var setSearchQuery = searchQueryState[1]
      var searchResultsState = useState([])
      var searchResults = searchResultsState[0]
      var setSearchResults = searchResultsState[1]
      var searchingState = useState(false)
      var searching = searchingState[0]
      var setSearching = searchingState[1]

      var fontState = useState(15)
      var font = fontState[0]
      var setFont = fontState[1]

      var posState = useState(posRef.current)
      var pos = posState[0]
      var setPosState = posState[1]
      var sizeState = useState(sizeRef.current)
      var size = sizeState[0]
      var setSizeState = sizeState[1]

      /* ── persistence helpers bound to state ── */
      function saveProgress(bookId, url, chapterTitle) {
        lsSet('progress:' + bookId, { url: url, title: chapterTitle, ts: Date.now() })
      }

      function recordHistory(bookId, url, chapterTitle) {
        var h = lsGet('history') || []
        h = h.filter(function (e) { return e.url !== url })
        h.unshift({ book: bookId, url: url, title: chapterTitle, ts: Date.now() })
        if (h.length > 200) h = h.slice(0, 200)
        lsSet('history', h)
        setHistory(h)
      }

      function refreshShelf() {
        setShelf(lsGet('shelf') || [])
      }
      function refreshHistory() {
        setHistory(lsGet('history') || [])
      }

      function addToShelf(bookId, bookTitle, author) {
        var s = lsGet('shelf') || []
        if (!s.some(function (e) { return e.id === bookId })) {
          s.unshift({ id: bookId, title: bookTitle, author: author || '', ts: Date.now() })
          lsSet('shelf', s)
        }
        refreshShelf()
      }
      function removeFromShelf(bookId) {
        var s = (lsGet('shelf') || []).filter(function (e) { return e.id !== bookId })
        lsSet('shelf', s)
        refreshShelf()
      }

      /* ── chapter loading + prefetch ── */
      function loadChapter(url, opts) {
        opts = opts || {}
        setLoading(true)
        setError('')
        var cached = cacheGet(url)
        if (cached) {
          applyChapter(url, cached, opts)
          setLoading(false)
          return
        }
        apiCall('/chapter', { url: url })
          .then(function (j) {
            var data = { title: j.title, content: j.content, prev: j.prev, next: j.next }
            cacheSet(url, data)
            applyChapter(url, data, opts)
          })
          .catch(function (e) {
            setError(String((e && e.message) || e))
          })
          .finally(function () {
            setLoading(false)
          })
      }

      function applyChapter(url, data, opts) {
        setView('reader')
        setTitle(data.title || '')
        setContent(data.content || '')
        setNav({ prev: data.prev, next: data.next })
        setCurrentUrl(url)
        // persist progress + history
        var bookId = bookIdFromUrl(url) || currentBook
        setCurrentBook(bookId)
        saveProgress(bookId, url, data.title)
        recordHistory(bookId, url, data.title)
        // prefetch prev/next (fire-and-forget into the cache)
        if (data.prev && !cacheGet(data.prev)) {
          apiCall('/chapter', { url: data.prev }).then(function (j) {
            cacheSet(data.prev, { title: j.title, content: j.content, prev: j.prev, next: j.next })
          }).catch(function () {})
        }
        if (data.next && !cacheGet(data.next)) {
          apiCall('/chapter', { url: data.next }).then(function (j) {
            cacheSet(data.next, { title: j.title, content: j.content, prev: j.prev, next: j.next })
          }).catch(function () {})
        }
        if (!opts.silent) {
          // remember last TOC page for this book (kept for next openToc)
          var savedTocPage = lsGet('tocPage:' + bookId)
          void savedTocPage
        }
      }

      function bookIdFromUrl(url) {
        var m = /hongmeng_(\d+)\//.exec(url || '')
        return m ? m[1] : null
      }

      /* ── TOC ── */
      function loadTocPageFrom(book, page) {
        setTocLoading(true)
        setError('')
        apiCall('/toc', { book: book, page: page })
          .then(function (j) {
            setToc(j.chapters || [])
            setTocPage(j.page || page)
            setTocPages(j.pages || 1)
            setPageRanges(j.pageRanges || null)
            if (j.book) setBookName(j.book)
            if (j.author) setBookAuthor(j.author)
            lsSet('tocPage:' + book, j.page || page)
          })
          .catch(function (e) {
            setError(String((e && e.message) || e))
          })
          .finally(function () {
            setTocLoading(false)
          })
      }

      /* Open TOC, landing on the page that contains the current chapter:
       * resolve the chapter number from the current chapter title, map it to
       * a page via pageRanges when available, else estimate ceil(no/20). */
      function openToc(bookId, pageHint) {
        var b = bookId || tocBook || currentBook
        setTocBook(b)
        setView('toc')
        var targetPage = pageHint || 1
        if (!pageHint) {
          var no = chapterNoOf(title)
          if (no !== null) {
            if (pageRanges && pageRanges.length > 0) {
              var found = null
              for (var i = 0; i < pageRanges.length; i++) {
                if (no >= pageRanges[i].start && no <= pageRanges[i].end) { found = pageRanges[i].page; break }
              }
              if (found !== null) targetPage = found
            } else {
              targetPage = Math.max(1, Math.ceil(no / 20))
            }
          } else {
            var lastToc = lsGet('tocPage:' + b)
            if (typeof lastToc === 'number') targetPage = lastToc
          }
        }
        setTocPage(targetPage)
        setJumpInput(String(targetPage))
        loadTocPageFrom(b, targetPage)
      }

      function jumpToPage() {
        var p = parseInt(jumpInput, 10)
        if (!p || p < 1 || p > tocPages) return
        loadTocPageFrom(tocBook, p)
      }

      function openSearch() {
        setSearchResults([])
        setSearchQuery('')
        setView('search')
      }

      function openShelf() {
        refreshShelf()
        refreshHistory()
        setView('shelf')
      }

      function doSearch() {
        var q = searchQuery.trim()
        if (!q) return
        setSearching(true)
        setError('')
        apiCall('/search', { q: q })
          .then(function (j) {
            setSearchResults(j.results || [])
          })
          .catch(function (e) {
            setError(String((e && e.message) || e))
          })
          .finally(function () {
            setSearching(false)
          })
      }

      /* Resume reading: load the saved chapter for a book. */
      function resumeBook(bookId, fallbackUrl, bookTitle, author) {
        var prog = lsGet('progress:' + bookId)
        setCurrentBook(bookId)
        if (prog && prog.url) {
          setBookName(bookTitle || bookName)
          loadChapter(prog.url)
        } else if (fallbackUrl) {
          setBookName(bookTitle || bookName)
          loadChapter(fallbackUrl)
        } else {
          openToc(bookId, 1)
        }
      }

      /* First open: restore progress. */
      useEffect(function () {
        if (!open) return
        var prog = lsGet('progress:' + currentBook)
        if (prog && prog.url && !title) {
          loadChapter(prog.url)
        } else if (!title) {
          loadChapter(DEFAULT_URL)
        } else {
          // Content is already in memory (panel collapsed then reopened):
          // restore the saved scroll position of the current chapter.
          var top = lsGet('scroll:' + currentBook + ':' + currentUrl)
          if (typeof top === 'number' && bodyRef.current) {
            bodyRef.current.scrollTop = top
          }
        }
        refreshShelf()
        refreshHistory()
      }, [open])

      /* Esc closes the panel. Only active while the panel is open, so it
         never steals Esc from other DSH surfaces. */
      useEffect(function () {
        if (!open) return
        function onKey(e) {
          if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }
        window.addEventListener('keydown', onKey, true)
        return function () {
          window.removeEventListener('keydown', onKey, true)
        }
      }, [open])

      /* Restore (or reset) the scroll position after a chapter's content
         renders. A saved scrollTop means "resume where I left off" (coming
         back from a prev/next hop or a fresh panel open); no saved value
         means a brand-new chapter, so start at the top. */
      useEffect(function () {
        var el = bodyRef.current
        if (!el) return
        var top = lsGet('scroll:' + currentBook + ':' + currentUrl)
        el.scrollTop = typeof top === 'number' && top > 0 ? top : 0
      }, [currentUrl, content])

      /* Persist the reading scroll position (throttled) so Esc / close /
         refresh can resume mid-chapter. */
      var scrollTimerRef = useRef(null)
      function onBodyScroll(e) {
        var el = e.currentTarget
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = setTimeout(function () {
          lsSet('scroll:' + currentBook + ':' + currentUrl, el.scrollTop)
        }, 300)
      }

      /* ── drag the launcher (click opens) ── */
      function onLauncherDown(e) {
        if (e.button !== 0) return
        e.preventDefault()
        var startX = e.clientX
        var startY = e.clientY
        var origin = { x: posRef.current.x, y: posRef.current.y }
        var moved = false
        function move(ev) {
          var dx = ev.clientX - startX
          var dy = ev.clientY - startY
          if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true
          var nx = Math.max(8, Math.min(window.innerWidth - 60, origin.x + dx))
          var ny = Math.max(8, Math.min(window.innerHeight - 60, origin.y + dy))
          posRef.current = { x: nx, y: ny }
          setPosState({ x: nx, y: ny })
        }
        function up() {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          if (!moved) setOpen(true)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }

      /* ── drag the panel header ── */
      function onHeaderDown(e) {
        if (e.button !== 0) return
        e.preventDefault()
        var startX = e.clientX
        var startY = e.clientY
        var origin = { x: posRef.current.x, y: posRef.current.y }
        function move(ev) {
          var nx = Math.max(8, Math.min(window.innerWidth - 60, origin.x + (ev.clientX - startX)))
          var ny = Math.max(8, Math.min(window.innerHeight - 60, origin.y + (ev.clientY - startY)))
          posRef.current = { x: nx, y: ny }
          setPosState({ x: nx, y: ny })
        }
        function up() {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          lsSet('pos', posRef.current)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }

      /* ── resize edges: always compute from the drag START values, never
         accumulate onto the last mousemove (that double-applied deltas). ── */
      function resizeStart(dir) {
        return function (e) {
          if (e.button !== 0) return
          e.preventDefault()
          var sx = e.clientX
          var sy = e.clientY
          var w0 = sizeRef.current.width
          var h0 = sizeRef.current.height
          var px0 = posRef.current.x
          var py0 = posRef.current.y
          function move(ev) {
            var dx = ev.clientX - sx
            var dy = ev.clientY - sy
            var w = w0
            var h = h0
            var px = px0
            var py = py0
            if (dir.indexOf('e') !== -1) w = w0 + dx
            if (dir.indexOf('w') !== -1) { w = w0 - dx; px = px0 + dx }
            if (dir.indexOf('s') !== -1) h = h0 + dy
            if (dir.indexOf('n') !== -1) { h = h0 - dy; py = py0 + dy }
            w = Math.max(280, w)
            h = Math.max(220, h)
            posRef.current = { x: px, y: py }
            sizeRef.current = { width: w, height: h }
            setPosState({ x: px, y: py })
            setSizeState({ width: w, height: h })
          }
          function up() {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
            lsSet('pos', posRef.current)
            lsSet('size', sizeRef.current)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }
      }

      var hostChildren = []

      /* ── Launcher ── */
      hostChildren.push(
        createElement(
          'button',
          {
            key: 'launcher',
            onMouseDown: onLauncherDown,
            style: Object.assign({}, launcherStyle, { left: pos.x + 'px', top: pos.y + 'px', display: open ? 'none' : 'flex' }),
            title: '\u6253\u5F00\u5C0F\u8BF4\u9605\u8BFB\u5668',
          },
          '\uD83D\uDCD6',
        ),
      )

      if (open) {
        var panelPosStyle = Object.assign({}, panelStyle, {
          left: pos.x + 'px',
          top: pos.y + 'px',
          width: size.width + 'px',
          height: size.height + 'px',
        })

        var header = createElement(
          'div',
          { key: 'h', onMouseDown: onHeaderDown, style: headerStyle },
          createElement(
            'span',
            { style: { flex: '1 1 auto', minWidth: '0', display: 'flex', alignItems: 'center', gap: '8px' } },
            view !== 'reader'
              ? createElement('button', { onClick: function () { setView('reader') }, style: Object.assign({}, iconBtn, { fontSize: '14px', padding: '3px 6px' }) }, '\u2190')
              : null,
            createElement(
              'span',
              { style: { fontWeight: '600', fontSize: '13px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } },
              view === 'reader' ? (title || '\u5C0F\u8BF4\u9605\u8BFB\u5668')
                : view === 'toc' ? ('\u76EE\u5F55 \u00B7 ' + (bookName || ''))
                : view === 'shelf' ? '\u4E66\u67B6'
                : '\u641C\u7D22\u6362\u4E66',
            ),
          ),
          view === 'reader'
            ? createElement(react.Fragment, null,
                createElement('button', { onClick: function () { addToShelf(currentBook, bookName || title, bookAuthor); }, style: iconBtn, title: '\u6536\u85CF\u672C\u4E66' }, '\u2606'),
                createElement('button', { onClick: openShelf, style: iconBtn, title: '\u4E66\u67B6' }, '\u4E66\u67B6'),
                createElement('button', { onClick: function () { openToc(currentBook) }, style: iconBtn, title: '\u76EE\u5F55' }, '\u76EE\u5F55'),
                createElement('button', { onClick: openSearch, style: iconBtn, title: '\u641C\u7D22\u6362\u4E66' }, '\u641C\u7D22'),
                createElement('button', { onClick: function () { setFont(Math.max(13, font - 1)) }, style: iconBtn, title: '\u5B57\u53F7-' }, 'A-'),
                createElement('button', { onClick: function () { setFont(Math.min(24, font + 1)) }, style: iconBtn, title: '\u5B57\u53F7+' }, 'A+'),
              )
            : null,
          createElement('button', { onClick: function () { setOpen(false) }, style: iconBtn, title: '\u6536\u8D77' }, '\u2715'),
        )

        var bodyBox
        if (view === 'reader') {
          var bodyText = String(content || (loading ? '\u52A0\u8F7D\u4E2D\u2026' : error || ''))
          bodyBox = createElement(
            'div',
            { key: 'c', ref: bodyRef, onScroll: onBodyScroll, style: Object.assign({}, bodyTextStyle, { fontSize: font + 'px' }) },
            bodyText,
          )
        } else if (view === 'toc') {
          var tocRowChildren = []
          if (tocLoading) {
            tocRowChildren.push(createElement('div', { key: 'tl', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '13px' } }, '\u52A0\u8F7D\u4E2D\u2026'))
          } else if (toc.length === 0) {
            tocRowChildren.push(createElement('div', { key: 'te', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '13px' } }, (error || '\u65E0\u7AE0\u8282')))
          } else {
            toc.forEach(function (ch) {
              tocRowChildren.push(
                createElement(
                  'button',
                  {
                    key: ch.href,
                    onClick: function () { loadChapter(ch.href) },
                    onMouseEnter: function (ev) {
                      ev.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))'
                      ev.currentTarget.style.color = 'var(--dsw-alias-label-primary, #e8e8ee)'
                    },
                    onMouseLeave: function (ev) {
                      ev.currentTarget.style.background = 'transparent'
                      ev.currentTarget.style.color = 'var(--dsw-alias-label-secondary, #b0b0c0)'
                    },
                    style: {
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--dsw-alias-label-secondary, #b0b0c0)',
                      padding: '7px 16px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    },
                  },
                  ch.title,
                ),
              )
            })
          }
          var tocBody = createElement(
            'div',
            { key: 'tb', style: { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '6px 0' } },
            tocRowChildren,
          )
          var tocFooter = createElement(
            'div',
            { key: 'tf', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', flex: '0 0 auto', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06))' } },
            createElement('button', {
              onClick: function () { if (tocPage > 1) loadTocPageFrom(tocBook, tocPage - 1) },
              disabled: tocPage <= 1,
              style: Object.assign({}, iconBtn, { opacity: tocPage <= 1 ? 0.4 : 1 }),
            }, '\u4E0A\u4E00\u9875'),
            createElement(
              'span',
              { style: { flex: '0 0 auto', textAlign: 'center', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
              String(tocPage) + ' / ' + String(tocPages),
            ),
            createElement('input', {
              value: jumpInput,
              onChange: function (e) { setJumpInput(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') jumpToPage() },
              placeholder: '\u9875\u7801',
              style: {
                width: '44px',
                background: 'var(--dsw-specific-input-major, rgba(255,255,255,0.06))',
                border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
                borderRadius: '6px',
                color: 'var(--dsw-alias-label-primary, #e8e8ee)',
                padding: '4px 6px',
                fontSize: '12px',
                textAlign: 'center',
                outline: 'none',
                flex: '0 0 auto',
              },
            }),
            createElement('button', { onClick: jumpToPage, style: Object.assign({}, iconBtn, { padding: '3px 6px' }) }, '\u8DF3\u8F6C'),
            createElement('button', {
              onClick: function () { if (tocPage < tocPages) loadTocPageFrom(tocBook, tocPage + 1) },
              disabled: tocPage >= tocPages,
              style: Object.assign({}, iconBtn, { opacity: tocPage >= tocPages ? 0.4 : 1 }),
            }, '\u4E0B\u4E00\u9875'),
          )
          bodyBox = createElement(react.Fragment, null, tocBody, tocFooter)
        } else if (view === 'shelf') {
          var shelfChildren = []
          if (shelf.length === 0) {
            shelfChildren.push(createElement('div', { key: 'se', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '13px' } }, '\u4E66\u67B6\u8FD8\u6CA1\u6709\u4E66\uFF0C\u9605\u8BFB\u65F6\u70B9\u2192 \u2606 \u6536\u85CF'))
          }
          shelf.forEach(function (b) {
            var prog = lsGet('progress:' + b.id)
            var sub = prog ? (prog.title || '') : '\u5DF2\u6536\u85CF'
            shelfChildren.push(
              createElement(
                'div',
                {
                  key: b.id,
                  onMouseEnter: function (ev) { ev.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))' },
                  onMouseLeave: function (ev) { ev.currentTarget.style.background = 'transparent' },
                  style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 14px', cursor: 'pointer' },
                  onClick: function () { resumeBook(b.id, b.firstUrl, b.title, b.author) },
                },
                createElement(
                  'span',
                  { style: { flex: '1 1 auto', minWidth: '0' } },
                  createElement('div', { style: { fontSize: '13px', fontWeight: '500', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, b.title),
                  createElement('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, sub),
                ),
                createElement('button', {
                  onClick: function (e) { e.stopPropagation(); removeFromShelf(b.id) },
                  style: Object.assign({}, iconBtn, { color: 'var(--dsw-alias-label-tertiary, #888)' }),
                  title: '\u79FB\u9664',
                }, '\u2715'),
              ),
            )
          })
          var historyTitle = createElement('div', { key: 'ht', style: { padding: '10px 14px 4px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06))' } }, '\u6700\u8FD1\u9605\u8BFB')
          shelfChildren.push(historyTitle)
          if (history.length === 0) {
            shelfChildren.push(createElement('div', { key: 'he', style: { padding: '8px 14px', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } }, '\u65E0\u8BB0\u5F55'))
          }
          history.forEach(function (h) {
            shelfChildren.push(
              createElement(
                'button',
                {
                  key: h.url,
                  onClick: function () { setCurrentBook(h.book); loadChapter(h.url) },
                  onMouseEnter: function (ev) { ev.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))' },
                  onMouseLeave: function (ev) { ev.currentTarget.style.background = 'transparent' },
                  style: {
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--dsw-alias-label-secondary, #b0b0c0)',
                    padding: '7px 14px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  },
                },
                h.title || h.url,
              ),
            )
          })
          bodyBox = createElement(
            'div',
            { key: 'sh', style: { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '6px 0' } },
            shelfChildren,
          )
        } else {
          /* search view */
          var searchBox = createElement(
            'div',
            { key: 'sb', style: { display: 'flex', gap: '6px', padding: '10px 12px', flex: '0 0 auto', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06))' } },
            createElement('input', {
              value: searchQuery,
              onChange: function (e) { setSearchQuery(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') doSearch() },
              placeholder: '\u8F93\u5165\u4E66\u540D\u641C\u7D22\uFF0C\u5982\u300A\u5B8C\u7F8E\u4E16\u754C\u300B',
              style: {
                flex: '1 1 auto',
                background: 'var(--dsw-specific-input-major, rgba(255,255,255,0.06))',
                border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
                borderRadius: '7px',
                color: 'var(--dsw-alias-label-primary, #e8e8ee)',
                padding: '6px 10px',
                fontSize: '13px',
                outline: 'none',
              },
            }),
            createElement('button', {
              onClick: doSearch,
              disabled: searching,
              style: {
                flex: '0 0 auto',
                padding: '6px 14px',
                borderRadius: '7px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                background: 'var(--dsw-alias-button-info-fill, #4d6bfe)',
                color: '#fff',
                border: '1px solid transparent',
                opacity: searching ? 0.6 : 1,
              },
            }, searching ? '\u641C\u7D22\u4E2D\u2026' : '\u641C\u7D22'),
          )
          var resultChildren = []
          if (searchResults.length === 0 && !searching) {
            resultChildren.push(createElement('div', { key: 'se', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '13px' } }, error || '\u8F93\u5165\u4E66\u540D\u5F00\u59CB\u641C\u7D22'))
          }
          searchResults.forEach(function (r) {
            resultChildren.push(
              createElement(
                'button',
                {
                  key: r.href,
                  onClick: function () {
                    setTocBook(r.id)
                    setBookName(r.title)
                    setBookAuthor(r.author)
                    addToShelf(r.id, r.title, r.author)
                    openToc(r.id, 1)
                  },
                  onMouseEnter: function (ev) { ev.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))' },
                  onMouseLeave: function (ev) { ev.currentTarget.style.background = 'transparent' },
                  style: {
                    display: 'flex',
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    gap: '10px',
                    color: 'var(--dsw-alias-label-primary, #e8e8ee)',
                    padding: '9px 14px',
                    cursor: 'pointer',
                    fontSize: '13px',
                  },
                },
                createElement('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.title),
                createElement('span', { style: { flex: '0 0 auto', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } }, (r.author || '') + (r.category ? ' \u00B7 ' + r.category : '')),
              ),
            )
          })
          bodyBox = createElement(react.Fragment, null,
            searchBox,
            createElement('div', { key: 'sr', style: { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '6px 0' } }, resultChildren),
          )
        }

        var footer = null
        if (view === 'reader') {
          var prevDisabled = !nav || !nav.prev
          var nextDisabled = !nav || !nav.next
          footer = createElement(
            'div',
            { key: 'f', style: { display: 'flex', gap: '8px', padding: '10px 14px', flex: '0 0 auto', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06))' } },
            createElement('button', {
              onClick: function () { if (nav && nav.prev) loadChapter(nav.prev) },
              disabled: prevDisabled,
              style: {
                flex: '1 1 0',
                padding: '7px 6px',
                borderRadius: '7px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary, #e8e8ee)',
                border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
                opacity: prevDisabled ? 0.4 : 1,
              },
            }, '\u4E0A\u4E00\u7AE0'),
            createElement('button', {
              onClick: function () { if (nav && nav.next) loadChapter(nav.next) },
              disabled: nextDisabled,
              style: {
                flex: '1 1 0',
                padding: '7px 6px',
                borderRadius: '7px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                background: 'var(--dsw-alias-button-info-fill, #4d6bfe)',
                color: '#fff',
                border: '1px solid transparent',
                opacity: nextDisabled ? 0.4 : 1,
              },
            }, '\u4E0B\u4E00\u7AE0'),
          )
        }

        var children = [header, bodyBox]
        if (footer) children.push(footer)

        /* ── resize hit-zones ── */
        var edges = [
          { dir: 'e', cursor: 'ew-resize' },
          { dir: 's', cursor: 'ns-resize' },
          { dir: 'se', cursor: 'nwse-resize' },
          { dir: 'w', cursor: 'ew-resize' },
          { dir: 'n', cursor: 'ns-resize' },
          { dir: 'sw', cursor: 'nesw-resize' },
          { dir: 'ne', cursor: 'nesw-resize' },
          { dir: 'nw', cursor: 'nwse-resize' },
        ]
        var resizeZones = edges.map(function (ed) {
          var s = { position: 'fixed', zIndex: 2147483001, cursor: ed.cursor }
          if (ed.dir === 'e') { s.left = pos.x + size.width - 3 + 'px'; s.top = pos.y + 40 + 'px'; s.width = '6px'; s.height = size.height - 56 + 'px' }
          else if (ed.dir === 's') { s.left = pos.x + 8 + 'px'; s.top = pos.y + size.height - 3 + 'px'; s.width = size.width - 16 + 'px'; s.height = '6px' }
          else if (ed.dir === 'se') { s.left = pos.x + size.width - 4 + 'px'; s.top = pos.y + size.height - 4 + 'px'; s.width = '14px'; s.height = '14px' }
          else if (ed.dir === 'w') { s.left = pos.x - 3 + 'px'; s.top = pos.y + 40 + 'px'; s.width = '6px'; s.height = size.height - 56 + 'px' }
          else if (ed.dir === 'n') { s.left = pos.x + 8 + 'px'; s.top = pos.y - 3 + 'px'; s.width = size.width - 16 + 'px'; s.height = '6px' }
          else if (ed.dir === 'sw') { s.left = pos.x - 4 + 'px'; s.top = pos.y + size.height - 4 + 'px'; s.width = '14px'; s.height = '14px' }
          else if (ed.dir === 'ne') { s.left = pos.x + size.width - 4 + 'px'; s.top = pos.y - 4 + 'px'; s.width = '14px'; s.height = '14px' }
          else { s.left = pos.x - 4 + 'px'; s.top = pos.y - 4 + 'px'; s.width = '14px'; s.height = '14px' }
          return createElement('div', { key: 'rz-' + ed.dir, onMouseDown: resizeStart(ed.dir), style: s })
        })

        hostChildren.push(
          createElement('div', { key: 'panel', style: panelPosStyle }, children),
          createElement(react.Fragment, { key: 'rz' }, resizeZones),
        )
      }

      // Render onto document.body via a portal so the floating panel escapes
      // the shell.overlay container's stacking context (z-index 20) and can
      // stay above sidebar plugins (z-index 40) and every other surface.
      return createPortal(
        createElement(react.Fragment, null, hostChildren),
        document.body,
      )
    }

    /* ---------- plugin entry ---------- */
    exports.name = 'dsh-novel-reader'
    exports.inject = ['slots', 'locale']
    exports.apply = function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('shell.overlay', function () {
        return slots.register(
          {
            name: 'shell.overlay',
            id: 'novel-reader',
            label: function () { return '\u5C0F\u8BF4\u9605\u8BFB\u5668' },
          },
          ReaderPanel,
        )
      })
    }

    return module.exports
  },
})