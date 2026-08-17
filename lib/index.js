/**
 * dsh-novel-reader — host half.
 *
 * Registers a same-origin JSON API on the DSH webserver under `/novel/*`:
 *
 *   GET /novel/toc?book=<id>
 *     -> { book, title, author, status, chapters: [{ id, href, title }] }
 *   GET /novel/chapter?url=<absolute chapter url>
 *     -> { title, content, prev, next, index }
 *
 * The DSH web client runs on http://127.0.0.1:<port>; a browser-half `fetch()`
 * to the novel site is blocked by CORS (the site sends no Access-Control-Allow-
 * Origin). So the client calls back into this same-origin route and the host
 * performs the actual retrieval with a desktop User-Agent (which passes the
 * site's Cloudflare check) and a generous timeout. This keeps all CORS, mixed-
 * content and anti-bot concerns on the host, exactly like `dsh-better-sidebar`'s
 * route pattern, and mirrors DSH's "fetch on Host / display on Client" advice.
 *
 * Security: routes are restricted to the configured host (default hongmengxsw.com)
 * to avoid SSRF — no arbitrary URL proxying.
 */
const BASE_HOST = 'www.hongmengxsw.com'
const SCHEME = 'http'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

export const name = 'dsh-novel-reader'
export const inject = ['webServer']

/** Write a JSON response. Structural mirror of node ServerResponse. */
function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** Basic URL query parsing (enough for ?book=.. &url=..). */
function queryOf(rawUrl) {
  let path = rawUrl || '/'
  const q = path.indexOf('?')
  const out = {}
  if (q === -1) return { pathname: path, out }
  const search = path.slice(q + 1)
  path = path.slice(0, q)
  for (const part of search.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const k = eq === -1 ? part : part.slice(0, eq)
    const v = eq === -1 ? '' : part.slice(eq + 1)
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '))
    } catch {
      /* ignore malformed keys */
    }
  }
  return { pathname: path, out }
}

/** Decode HTML entities and replace <br>/<p> boundaries with newlines. */
function htmlToText(html) {
  if (typeof html !== 'string') return ''
  let s = html
  // block boundaries -> newline
  s = s.replace(/<\/(?:p|div|br|h[1-6]|li|tr)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  // strip scripts/style/iframe
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '')
  // strip all remaining tags
  s = s.replace(/<[^>]*>/g, '')
  // decode common entities
  s = s.replace(/&nbsp;/gi, ' ')
  s = s.replace(/&lt;/g, '<')
  s = s.replace(/&gt;/g, '>')
  s = s.replace(/&quot;/g, '"')
  s = s.replace(/&#39;|&apos;/g, "'")
  s = s.replace(/&amp;/g, '&')
  s = s.replace(/\u3000/g, '　')
  // collapse >2 blank lines -> 1
  s = s.replace(/\n[ \t\u3000]*\n[ \t\u3000]*\n+/g, '\n\n')
  // trim leading/trailing whitespace per line and the whole block
  s = s.split('\n').map((line) => line.trim()).join('\n')
  return s.replace(/^\s*\n/, '').trim()
}

/** Pull the text content out of a <div class="content" id="content"> block. */
function extractContent(html) {
  const m = /<div[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*id=["']content["'][\s\S]*?<\/div>/i.exec(html)
  if (!m) return ''
  let text = htmlToText(m[0])
  // strip a leading "第x章 xxx (第y/z页)" page-marker line (the site repeats
  // the chapter title inside the content with a page counter)
  text = text.replace(/^第[\s\S]{0,40}?\(第\d+\/\d+页\)\s*/, '')
  // strip the "本章未完，请点击下一页继续阅读" trailer keeps the page join clean
  text = text.replace(/（本章未完，请点击下一页继续阅读）\s*$/, '')
  return text.trim()
}

/** Pull <h1 class="title">…</h1>. */
function extractTitle(html) {
  const m = /<h1\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return m ? htmlToText(m[1]) : ''
}

/** Find the <a> for 上一章 / 下一页 / 章节列表 relative URLs. */
function extractNav(html, base) {
  const out = { prev: undefined, next: undefined, index: undefined }
  // explicit windows vars the page prints: prevpage / nextpage / index_page
  const pv = /var\s+prevpage\s*=\s*['"]([^'"]+)['"]/.exec(html)
  const nx = /var\s+nextpage\s*=\s*['"]([^'"]+)['"]/.exec(html)
  const ix = /var\s+index_page\s*=\s*['"]([^'"]+)['"]/.exec(html)
  if (pv) out.prev = new URL(pv[1], base).href
  if (nx) out.next = new URL(nx[1], base).href
  if (ix) out.index = new URL(ix[1], base).href
  if (out.prev === undefined) {
    const a = /class=["'][^"']*section-opt[^"']*["'][\s\S]*?href=["']([^"']+)["'][^>]*>上一章</.exec(html)
    if (a) out.prev = new URL(a[1], base).href
  }
  if (out.next === undefined) {
    const a = /class=["'][^"']*section-opt[^"']*["'][\s\S]*?href=["']([^"']+)["'][^>]*>下一页</.exec(html)
    if (a) out.next = new URL(a[1], base).href
  }
  if (out.index === undefined) {
    const a = /class=["'][^"']*section-opt[^"']*["'][\s\S]*?href=["']([^"']+)["'][^>]*>章节列表</.exec(html)
    if (a) out.index = new URL(a[1], base).href
  }
  return out
}

/** List-like title from og: tags or <title>. */
function extractMeta(html) {
  const out = {}
  const book = /meta[^>]+property=["']og:novel:book_name["'][^>]+content=["']([^"']+)["']/.exec(html)
  const author = /meta[^>]+property=["']og:novel:author["'][^>]+content=["']([^"']+)["']/.exec(html)
  const status = /meta[^>]+property=["']og:novel:status["'][^>]+content=["']([^"']+)["']/.exec(html)
  if (book) out.book = htmlToText(book[1])
  if (author) out.author = htmlToText(author[1])
  if (status) out.status = htmlToText(status[1])
  return out
}

/** Parse chapter-list from a TOC page. The site has two section-list blocks:
 *  "最新章节" (latest 10, repeated on every page) and "正文" (this page's
 *  chapters). Only the 正文 block is the real page content; prefer the
 *  section-list that follows the "正文" <h2>, and fall back to every block
 *  (so a page without the heading still yields its chapters). */
function parseChapters(html, base) {
  const chapters = []
  const parseUl = (inner) => {
    const re = /<li>\s*<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi
    let m
    while ((m = re.exec(inner)) !== null) {
      const title = htmlToText(m[2])
      if (!title) continue
      const href = new URL(m[1], base).href
      // Only keep links that look like chapter pages (/hongmeng_<book>/<id>.html)
      const pathname = new URL(href).pathname
      const idMatch = /\/(\d{4,10})\.html(?:_\d+)?$/.exec(pathname)
      if (!idMatch) continue
      chapters.push({ id: idMatch[1], href, title })
    }
  }
  // Find the 正文 heading, then take the section-list right after it.
  const zhengRe = /<h2[^>]*>[\s\S]{0,40}?正文[\s\S]{0,20}?<\/h2>[\s\S]*?<ul\b[^>]*class=["'][^"']*\bsection-list\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i
  const zm = zhengRe.exec(html)
  if (zm) {
    parseUl(zm[1])
    return chapters
  }
  // Fallback: every section-list block.
  const ulRe = /<ul\b[^>]*class=["'][^"']*\bsection-list\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/gi
  let ulm
  while ((ulm = ulRe.exec(html)) !== null) parseUl(ulm[1])
  return chapters
}

/** Parse search results: <ul class="txt-list …"><li> rows with span.s1/span.s2/span.s4. */
function parseSearchResults(html, base) {
  const results = []
  const rowRe = /<li>[\s\S]*?<span class="s1">\[([^\]]*)\]<\/span>[\s\S]*?<span class="s2">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/span>[\s\S]*?<span class="s4">([\s\S]*?)<\/span>/gi
  let m
  while ((m = rowRe.exec(html)) !== null) {
    const category = htmlToText(m[1])
    const href = new URL(m[2], base).href
    const pathname = new URL(href).pathname
    const idMatch = /\/hong_(\d+)\//.exec(pathname)
    if (!idMatch) continue
    const title = htmlToText(m[3])
    if (!title) continue
    const author = htmlToText(m[4])
    results.push({ id: idMatch[1], href, title, author, category })
  }
  return results
}

/** Fetch and parse ONE TOC page; also return the total page count, the last
 *  chapter number, and every page's [start,end] chapter range from the site's
 *  pageselect dropdown (every TOC page carries the full dropdown, so any page
 *  request also yields the whole pagination map). */
async function fetchTocPage(book, page) {
  const basePage = Math.max(1, Math.floor(Number(page) || 1))
  const firstUrl = `${SCHEME}://${BASE_HOST}/hong_${book}/`
  const url = basePage <= 1 ? firstUrl : `${SCHEME}://${BASE_HOST}/hong_${book}_${basePage}/`
  const r = await trustedFetch(url)
  if (r.status !== 200) throw new Error(`toc http ${r.status}`)
  const meta = extractMeta(r.text)
  const chapters = parseChapters(r.text, url)
  // The <select name="pageselect"> lists every page: /hong_<book>_<n>/ for
  // n>=2, and the bare /hong_<book>/ for page 1. Collect the [start,end]
  // chapter range of every page (from its "第X章-第Y章" label) plus the max
  // page count and the last chapter number.
  const pageRanges = []
  let pages = 1
  let lastChapter = undefined
  const re = /<option[^>]*value="\/(hong_\d+(_\d+)?\/)"[^>]*>第(\d+)章\s*[-–]\s*(\d+)章/g
  let m
  while ((m = re.exec(r.text)) !== null) {
    const suffix = m[2] // "_N" for pages > 1, undefined for page 1
    const num = suffix ? parseInt(suffix.slice(1), 10) : 1
    const start = parseInt(m[3], 10)
    const end = parseInt(m[4], 10)
    if (num > pages) pages = num
    if (num === pages) lastChapter = end
    pageRanges.push({ page: num, start, end })
  }
  pageRanges.sort((a, b) => a.page - b.page)
  return { meta, chapters, pages, lastChapter, pageRanges }
}

/** One trusted fetch with a browser UA and timeout, auto-retrying 429/5xx. */
async function trustedFetch(url, signal, retries = 3) {
  let last
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const onAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort)
    }
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      })
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        last = { status: res.status }
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
        continue
      }
      const text = await res.text()
      return { status: res.status, url: res.url, text }
    } catch (err) {
      if (attempt < retries) {
        last = { error: String(err && err.message ? err.message : err) }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
  throw new Error(last && last.error ? last.error : `upstream reject ${last ? last.status : ''}`)
}

/** A tiny per-(book,page) TOC cache (10 min) so page flipping is instant. */
const tocCache = new Map()
const TOC_CACHE_TTL = 10 * 60 * 1000
function tocCacheKey(book, page) {
  return book + ':' + Math.max(1, Math.floor(Number(page) || 1))
}
function tocCacheGet(key) {
  const hit = tocCache.get(key)
  if (hit && Date.now() - hit.at < TOC_CACHE_TTL) return hit.value
  if (hit) tocCache.delete(key)
  return undefined
}
function tocCacheSet(key, value) {
  tocCache.set(key, { value, at: Date.now() })
  if (tocCache.size > 96) {
    const oldest = tocCache.keys().next().value
    if (oldest !== undefined) tocCache.delete(oldest)
  }
}

/** Enforce the SSRF guard: only the allowed base host is proxiable. */
function allowHost(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  return host === BASE_HOST || host.endsWith('.' + BASE_HOST)
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/novel',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'GET only' } })
          return
        }
        const { pathname, out } = queryOf(req.url)
        try {
          if (pathname === '/novel/toc') {
            const book = String(out.book || '').trim()
            if (!/^\d{1,10}$/.test(book)) {
              writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'book id is a number' } })
              return
            }
            const page = Math.max(1, Math.floor(Number(out.page) || 1))
            const key = tocCacheKey(book, page)
            const cached = tocCacheGet(key)
            if (cached) {
              writeJson(res, 200, { ok: true, ...cached })
              return
            }
            const { meta, chapters, pages, lastChapter, pageRanges } = await fetchTocPage(book, page)
            const payload = {
              book: meta.book || String(book),
              author: meta.author,
              status: meta.status,
              page,
              pages,
              lastChapter,
              pageRanges,
              chapters,
            }
            tocCacheSet(key, payload)
            writeJson(res, 200, { ok: true, ...payload })
            return
          }
          if (pathname === '/novel/search') {
            const q = String(out.q || '').trim()
            if (!q || q.length > 40) {
              writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'q is a short keyword' } })
              return
            }
            const searchUrl = `${SCHEME}://${BASE_HOST}/search.php?keyWord=${encodeURIComponent(q)}`
            const r = await trustedFetch(searchUrl)
            if (r.status !== 200) {
              writeJson(res, 502, { ok: false, error: { code: 'upstream', message: `search http ${r.status}` } })
              return
            }
            const results = parseSearchResults(r.text, searchUrl)
            writeJson(res, 200, { ok: true, results })
            return
          }
          if (pathname === '/novel/chapter') {
            const raw = String(out.url || '').trim()
            if (!raw) {
              writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'url required' } })
              return
            }
            if (!allowHost(raw)) {
              writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'untrusted host' } })
              return
            }
            // Merge multi-page chapters: the site splits a chapter into
            // <id>.html, <id>_2.html, … (possibly more). Keep following the
            // page's own "下一页" while it points at another page of the SAME
            // chapter, concatenating the content.
            let page = raw
            let title = ''
            const parts = []
            let prev
            let next
            let index
            let guard = 0
            for (;;) {
              if (++guard > 12) break
              const r = await trustedFetch(page)
              if (r.status !== 200 && r.status !== 206) {
                writeJson(res, 502, { ok: false, error: { code: 'upstream', message: `chapter http ${r.status}` } })
                return
              }
              if (!title) title = extractTitle(r.text)
              const meta = extractMeta(r.text)
              const nav = extractNav(r.text, r.url)
              const content = extractContent(r.text)
              if (content) parts.push(content)
              prev = prev || nav.prev
              next = nav.next
              index = nav.index || index
              if (!nav.next) break
              // Same chapter pagination = the next page URL is "<id>_N.html"
              // (only merge pages of one chapter — never the next chapter).
              const pagePath = new URL(page).pathname
              const nextPath = new URL(nav.next).pathname
              const nextIsSameChapter =
                /\/(\d+)_\d+\.html$/.test(nextPath) &&
                pagePath.replace(/_\d+\.html$/, '.html') === nextPath.replace(/_\d+\.html$/, '.html')
              const rawHtml = r.text
              const unfinished = /本章未完，请点击下一页继续阅读/.test(rawHtml)
              if (!unfinished || !nextIsSameChapter) break
              page = nav.next
            }
            writeJson(res, 200, {
              ok: true,
              title: title || '',
              content: parts.join('\n'),
              prev: prev || undefined,
              next: next || undefined,
              index: index || undefined,
            })
            return
          }
          writeJson(res, 404, { ok: false, error: { code: 'not-found', message: pathname } })
        } catch (err) {
          writeJson(res, 502, { ok: false, error: { code: 'fetch-failed', message: String(err && err.message ? err.message : err) } })
        }
      },
    }),
    'dsh-novel-reader: /novel routes',
  )
}
