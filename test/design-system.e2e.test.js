/* Computed-style guards for the design system. Colours are read by painting to
   canvas: a computed oklch() string cannot be parsed as RGB. */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDiffBody } from '../render/diff.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, '..', 'chrome', 'easel.css'), 'utf8')

const MEASURE = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  window.__rgb = (v) => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = v; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  };
  window.__composite = (fg, bg) => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = bg; cx.fillRect(0, 0, 1, 1);
    cx.fillStyle = fg; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  };
  const lum = (c) => { const f = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  window.__ratio = (a, b) => { const x = lum(window.__composite(a, b)), y = lum(window.__rgb(b));
    return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
})()`

let browser
let page

async function render(bodyHtml, theme = 'light') {
  await page.setContent(
    `<!doctype html><html data-theme="${theme}"><head><style>${css}</style></head>` +
    `<body class="sf-shell"><main id="sf-content">${bodyHtml}</main></body></html>`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.evaluate(MEASURE)
}

before(async () => {
  const puppeteer = (await import('puppeteer')).default
  browser = await puppeteer.launch({ headless: 'new' })
  page = await browser.newPage()
})
after(async () => { if (browser) await browser.close() })

describe('two text tiers — prose recedes, emphasis carries', { timeout: 120000 }, () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: body prose is softer than emphasis, and both stay legible`, async () => {
      await render('<p id="p">prose <strong id="s">emphasis</strong></p>', theme)
      const got = await page.evaluate(`(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        const p = getComputedStyle(document.getElementById('p')).color;
        const s = getComputedStyle(document.getElementById('s')).color;
        return { body: window.__ratio(p, bg), emphasis: window.__ratio(s, bg), same: p === s };
      })()`)
      // The measured finding this design answers: contrast was uniformly maxed
      // and flat, so nothing receded and nothing stood out.
      assert.equal(got.same, false, 'prose and emphasis resolved to the same colour — the tiers collapsed')
      assert.ok(got.emphasis > got.body + 3, `tiers too close: body ${got.body}, emphasis ${got.emphasis}`)
      assert.ok(got.body >= 4.5, `body prose fell below 4.5:1 (${got.body})`)
      assert.ok(got.emphasis >= 7, `emphasis fell below 7:1 (${got.emphasis})`)
    })
  }

  test('muted sits below body, so the three tiers are ordered', async () => {
    await render('<p id="p">prose</p><p class="sd-muted" id="m">muted</p>', 'dark')
    const got = await page.evaluate(`(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      return { body: window.__ratio(getComputedStyle(document.getElementById('p')).color, bg),
               muted: window.__ratio(getComputedStyle(document.getElementById('m')).color, bg) };
    })()`)
    assert.ok(got.muted < got.body, `muted ${got.muted} is not below body ${got.body}`)
    assert.ok(got.muted >= 4.5, `muted fell below 4.5:1 (${got.muted})`)
  })

  test('muted survives both shapes templates emit it in', async () => {
    // A bare `.sd-muted` loses to `#sf-content p` on specificity, and templates
    // use it as a wrapper around markdown, which renders <p> children.
    await render('<p class="sd-muted" id="direct">on the paragraph</p><div class="sd-muted"><p id="wrapped">inside a wrapper</p></div>')
    const got = await page.evaluate(`(() => {
      const plain = getComputedStyle(document.querySelector('#sf-content > p:not(.sd-muted)') || document.body).color;
      return { direct: getComputedStyle(document.getElementById('direct')).color,
               wrapped: getComputedStyle(document.getElementById('wrapped')).color,
               muted: getComputedStyle(document.documentElement).getPropertyValue('--color-muted-content').trim(),
               plain };
    })()`)
    const mutedRgb = await page.evaluate(`window.__rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-muted-content').trim()).join(',')`)
    for (const [shape, value] of [['direct', got.direct], ['wrapped', got.wrapped]]) {
      const rgb = await page.evaluate(`window.__rgb(${JSON.stringify(value)}).join(',')`)
      assert.equal(rgb, mutedRgb, `${shape} .sd-muted did not resolve to --color-muted-content`)
    }
  })
})

describe('a decision control never inherits a face from the content', { timeout: 120000 }, () => {
  test('an option inside a mono ancestor still renders sans', async () => {
    // The real shape: a template put the options container in .sd-mono and
    // `font: inherit` alone handed the button a monospace face.
    await render('<div class="sd-mono"><div data-widget><button data-option="x" id="o">choose</button></div></div>')
    const fam = await page.evaluate(`getComputedStyle(document.getElementById('o')).fontFamily`)
    assert.doesNotMatch(fam, /mono/i, `option rendered mono: ${fam}`)
  })

  test('the control is measured against an ancestor that really is mono', async () => {
    // Positive control: without it, a passing case above cannot be told apart
    // from an ancestor that was never monospace in the first place.
    await render('<div class="sd-mono" id="a">code-ish</div>')
    const fam = await page.evaluate(`getComputedStyle(document.getElementById('a')).fontFamily`)
    assert.match(fam, /mono/i, `.sd-mono is not monospace, so the guard above proves nothing: ${fam}`)
  })
})

describe('default dark follows the neutral palette', { timeout: 120000 }, () => {
  test('the dark accent is blue, not a warm fill', async () => {
    await render('<p>x</p>', 'dark')
    const got = await page.evaluate(`(() => {
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      return { primary: window.__rgb(v('--color-primary')), ground: window.__rgb(v('--color-base-200')) };
    })()`)
    const [r, g, b] = got.primary
    assert.ok(b > r && b > g, `dark accent is not blue-led: rgb(${got.primary})`)
    assert.ok(b - r > 40, `dark accent is too gray to read as accent: rgb(${got.primary})`)
    assert.ok(got.ground[0] + got.ground[1] + got.ground[2] < 80, `dark ground is not near-black: rgb(${got.ground})`)
  })

  test('dark text stays bright enough to read on the near-black ground', async () => {
    await render('<p id="p">prose <strong id="s">emphasis</strong></p>', 'dark')
    const got = await page.evaluate(`(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      return { bodyContrast: window.__ratio(getComputedStyle(document.getElementById('p')).color, bg),
               emphContrast: window.__ratio(getComputedStyle(document.getElementById('s')).color, bg) };
    })()`)
    assert.ok(got.bodyContrast >= 4.5, `dark body is still dim at ${got.bodyContrast}:1`)
    assert.ok(got.emphContrast >= 10, `dark emphasis is still dim at ${got.emphContrast}:1`)
  })

  test('sans display sits against sans body at the default scale', async () => {
    await render('<h1 id="h">Display</h1><p id="p">body</p>')
    const got = await page.evaluate(`(() => {
      const h = getComputedStyle(document.getElementById('h')), p = getComputedStyle(document.getElementById('p'));
      return { hf: h.fontFamily, pf: p.fontFamily, hs: parseFloat(h.fontSize), ps: parseFloat(p.fontSize),
               ratio: parseFloat(h.fontSize) / parseFloat(p.fontSize) };
    })()`)
    assert.doesNotMatch(got.hf, /Iowan|Palatino|Book Antiqua|Georgia/i, `h1 still uses the serif stack: ${got.hf}`)
    assert.doesNotMatch(got.pf, /Iowan|Palatino|Book Antiqua|Georgia/i, `body picked up a display serif: ${got.pf}`)
    assert.ok(got.hs === 24 && got.ps === 14, `default type is 24/14, got ${got.hs}/${got.ps}`)
    assert.ok(got.ratio >= 1.6, `display-to-body ratio only ${got.ratio.toFixed(2)}`)
  })

  test('dark chrome hover is a fill wash, not the same paint as the bar', async () => {
    await render('<button class="sf-annotate-toggle" id="b">Annotate</button>', 'dark')
    const got = await page.evaluate(`(() => {
      const root = document.documentElement
      const v = (n) => getComputedStyle(root).getPropertyValue(n).trim()
      const chrome = v('--color-base-200')
      const hover = v('--fill-hover')
      const panel = v('--color-base-300')
      return {
        hoverVsChrome: window.__ratio(hover, chrome),
        panelVsChrome: window.__ratio(panel, chrome),
        radius: getComputedStyle(document.getElementById('b')).borderRadius,
      }
    })()`)
    assert.ok(got.hoverVsChrome > 1.05, `dark hover vanished into the chrome (${got.hoverVsChrome})`)
    assert.ok(got.panelVsChrome <= 1.02, `dark base-300 is no longer the same as chrome, so this check is stale (${got.panelVsChrome})`)
    assert.equal(got.radius, '6px', `header actions are ${got.radius}, not the standard 6px`)
  })
})

describe('lantern and fig keep a literary palette', { timeout: 120000 }, () => {
  for (const theme of ['lantern-light', 'fig-light', 'lantern-dark', 'fig-dark']) {
    test(`${theme}: primary and page ground carry a hue`, async () => {
      await render('<p>x</p>', theme)
      const got = await page.evaluate(`(() => {
        const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        return { primary: window.__rgb(v('--color-primary')), ground: window.__rgb(v('--color-base-200')) };
      })()`)
      const spread = (c) => Math.max(...c) - Math.min(...c)
      assert.ok(spread(got.primary) > 24, `${theme} primary collapsed to gray: rgb(${got.primary})`)
      assert.ok(spread(got.ground) > 8, `${theme} ground collapsed to gray: rgb(${got.ground})`)
    })
  }

  test('lantern headings use the serif stack', async () => {
    await render('<h1 id="h">Display</h1>', 'lantern-light')
    const fam = await page.evaluate(`getComputedStyle(document.getElementById('h')).fontFamily`)
    assert.match(fam, /Iowan|Palatino|Book Antiqua|Georgia/i, `lantern h1 is not serif: ${fam}`)
  })
})

describe('inline code stays legible on its own raised ground', { timeout: 120000 }, () => {
  // Stacking the softened body tier on the raised code background is what put
  // muted code at 4.27:1 in dark. Both themes, and inside a muted wrapper.
  for (const theme of ['light', 'dark']) {
    test(`${theme}: code clears AA inside muted text and in plain prose`, async () => {
      await render('<p>plain <code id="plain">token</code></p><div class="sd-muted"><p>note <code id="muted">token</code></p></div>', theme)
      const got = await page.evaluate(`(() => {
        const bgOf = (el) => { for (let e = el; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; } return 'white'; };
        const at = (id) => { const el = document.getElementById(id);
          return window.__ratio(getComputedStyle(el).color, bgOf(el)); };
        return { plain: at('plain'), muted: at('muted') };
      })()`)
      assert.ok(got.muted >= 4.5, `code inside muted text is ${got.muted}:1`)
      assert.ok(got.plain >= 4.5, `code in plain prose is ${got.plain}:1`)
    })
  }

  test('the code ground really is raised, or the check above proves nothing', async () => {
    await render('<p>plain <code id="c">token</code></p>', 'dark')
    const got = await page.evaluate(`(() => {
      const code = getComputedStyle(document.getElementById('c')).backgroundColor;
      const body = getComputedStyle(document.body).backgroundColor;
      const transparent = /rgba\\(0, 0, 0, 0\\)|transparent/.test(code);
      return { code, body, transparent, same: code === body };
    })()`)
    // Transparent is the case that matters: it "differs from body" while
    // meaning code has no ground at all, so the contrast check tests nothing.
    assert.equal(got.transparent, false, 'code has no background of its own, so there is no stacking to test')
    assert.equal(got.same, false, 'code background is identical to the page ground')
  })
})

describe('highlight is accent text, not a painted block', { timeout: 120000 }, () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: mark carries no fill and clears AA`, async () => {
      await render('<p>before <mark id="m">redacted</mark> after</p>', theme)
      const got = await page.evaluate(`(() => {
        const m = document.getElementById('m'), s = getComputedStyle(m);
        const bg = getComputedStyle(document.body).backgroundColor;
        return { display: s.display, bg: s.backgroundColor, contrast: window.__ratio(s.color, bg),
                 transparent: /rgba\\(0, 0, 0, 0\\)|transparent/.test(s.backgroundColor) };
      })()`)
      assert.equal(got.transparent, true, `mark still paints a block: ${got.bg}`)
      assert.equal(got.display, 'inline', `mark is ${got.display}, which breaks the line box`)
      assert.ok(got.contrast >= 4.5, `mark text is ${got.contrast}:1`)
    })
  }

  test('a mark stays on the same line as the text around it', async () => {
    await render('<p id="p">before <mark id="m">redacted</mark> after</p>')
    const got = await page.evaluate(`(() => {
      const p = document.getElementById('p'), m = document.getElementById('m');
      return { lines: p.getClientRects().length, markTop: m.getBoundingClientRect().top,
               paraTop: p.getBoundingClientRect().top, paraHeight: p.getBoundingClientRect().height };
    })()`)
    assert.equal(got.lines, 1, 'the paragraph wrapped, so the mark cannot be shown to sit inline')
    assert.ok(got.markTop - got.paraTop < got.paraHeight, 'the mark left its line')
  })
})

describe('callout and inline-code components', { timeout: 120000 }, () => {
  test('a callout holds prose at readable contrast, unlike a stretched badge', async () => {
    await render('<div class="sd-callout sd-callout-warning"><div class="sd-callout-title" id="t">Heads up</div><p id="b">A whole paragraph of explanation.</p></div>', 'dark')
    const got = await page.evaluate(`(() => {
      const c = document.querySelector('.sd-callout'), s = getComputedStyle(c);
      const bg = s.backgroundColor;
      return { radius: parseFloat(s.borderTopLeftRadius), edge: parseFloat(s.borderTopWidth),
               leftEdge: parseFloat(s.borderLeftWidth),
               title: window.__ratio(getComputedStyle(document.getElementById('t')).color, bg),
               body: window.__ratio(getComputedStyle(document.getElementById('b')).color, bg) };
    })()`)
    assert.ok(got.radius > 0, 'callout has square corners')
    assert.ok(got.edge >= 1 && got.edge < 3, `callout top edge is a candy bar (${got.edge}px), not a hairline`)
    // A thick coloured left edge is the round-diff mark's shape, not a callout's.
    assert.ok(got.leftEdge < 3, 'callout accent moved back to the left edge, colliding with diff marks')
    assert.ok(got.body >= 4.5, `callout body text is ${got.body}:1`)
    assert.ok(got.title >= 4.5, `callout title is ${got.title}:1`)
  })

  test('badges are tighter than they were, and still fit their text', async () => {
    await render('<span class="sd-badge" id="b">status</span>')
    const got = await page.evaluate(`(() => {
      const b = document.getElementById('b'), r = b.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(b).fontSize);
      return { h: r.height, fs, scroll: b.scrollHeight, client: b.clientHeight };
    })()`)
    assert.ok(got.h < 28, `badge is ${got.h}px tall, no tighter than before`)
    assert.ok(got.h >= got.fs, 'badge is shorter than its own text, so it clips')
    assert.ok(got.scroll <= got.client + 1, 'badge content overflows its box')
  })

  test('the table reads in two internal weights, inside a frame', async () => {
    await render('<div class="sd-tablewrap" id="w"><table><thead><tr><th id="h">head</th></tr></thead>' +
      '<tbody><tr><td id="d">middle</td></tr><tr><td id="last">last</td></tr></tbody></table></div>')
    const got = await page.evaluate(`(() => {
      const col = (id) => getComputedStyle(document.getElementById(id)).borderBottomColor;
      const w = getComputedStyle(document.getElementById('w'));
      return { headRule: col('h'), rowRule: col('d'),
               wrapTop: parseFloat(w.borderTopWidth), wrapBottom: parseFloat(w.borderBottomWidth) };
    })()`)
    assert.notEqual(got.headRule, got.rowRule, 'the header rule and the internal row rule are the same weight')
    assert.equal(got.wrapTop, 1, 'the frame must close the top')
    assert.equal(got.wrapBottom, 1, 'the frame must close the bottom')
  })

  test('accent classes do not paint a left bar — that shape is a diff mark', async () => {
    await render('<div class="sd-entry sd-accent" id="a"></div><div class="sd-entry sd-accent-alt" id="b"></div><div class="sd-entry" id="c"></div><div class="sd-card sd-accent" id="d"></div><div class="sd-card" id="e"></div>')
    const got = await page.evaluate(`(() => {
      const w = (id) => parseFloat(getComputedStyle(document.getElementById(id)).borderLeftWidth);
      return { a: w('a'), b: w('b'), c: w('c'), d: w('d'), e: w('e') };
    })()`)
    assert.ok(got.a < 3, `sd-accent still draws a left bar (${got.a}px)`)
    assert.ok(got.b < 3, `sd-accent-alt still draws a left bar (${got.b}px)`)
    assert.ok(got.c < 3, `a plain entry picked up a left bar (${got.c}px)`)
    assert.equal(got.a, got.c, 'sd-accent must not strip the frame\'s left edge')
    assert.equal(got.b, got.c, 'sd-accent-alt must not strip the frame\'s left edge')
    assert.equal(got.d, got.e, 'an accented card must keep the same left edge as a plain card')
    assert.ok(got.d > 0, 'an accented card lost its left border')
  })

  // Geometry, not a computed property: the previous float reported float:right
  // while sitting entirely below its paragraph.
  const GUTTER = `(() => {
    const m = document.getElementById('m').getBoundingClientRect();
    const b = document.getElementById('b').getBoundingClientRect();
    return { beside: m.top < b.bottom && m.bottom > b.top && b.left > m.right - 1,
             stacked: b.top >= m.bottom - 1, metaLeft: Math.round(m.left), bodyLeft: Math.round(b.left) };
  })()`
  const LONG = 'Why this source matters, at enough length that the body column really wraps. '.repeat(3)
  const citeMarkup = `<div class="sd-cites"><div class="sd-cite">` +
    `<div class="sd-cite-meta" id="m"><span class="sd-cite-date">2026-07-14</span><span class="sd-cite-label">payload 40</span></div>` +
    `<div class="sd-cite-body" id="b"><div class="sd-cite-title">Contrast regression</div><p>${LONG}</p></div></div></div>`

  test('date and source sit in a gutter beside the content, not inline', async () => {
    await page.setViewport({ width: 1200, height: 900 })
    await render(citeMarkup)
    const got = await page.evaluate(GUTTER)
    assert.equal(got.beside, true, `meta is not beside the body (meta left ${got.metaLeft}, body left ${got.bodyLeft})`)
    assert.equal(got.stacked, false, 'the body dropped below its own meta on a wide viewport')
  })

  test('the gutter collapses to one column when it no longer fits', async () => {
    await page.setViewport({ width: 640, height: 900 })
    await render(citeMarkup)
    const got = await page.evaluate(GUTTER)
    await page.setViewport({ width: 1200, height: 900 })
    assert.equal(got.beside, false, 'the gutter survived at a width too narrow to hold it')
  })

  test('the gutter check can fail — stacked blocks must not read as beside', async () => {
    // Without .sd-cite the same two blocks stack. If this reports "beside",
    // the assertion above is measuring something other than the layout.
    await page.setViewport({ width: 1200, height: 900 })
    await render(`<div><div id="m">2026-07-14</div><div id="b"><p>${LONG}</p></div></div>`)
    const got = await page.evaluate(GUTTER)
    assert.equal(got.beside, false, 'stacked blocks reported as side-by-side, so the check cannot discriminate')
  })

  test('a status cell keeps its label on one line', async () => {
    await render('<div class="sd-tablewrap"><table><tbody>' +
      '<tr><td id="s"><span class="sd-badge sd-badge-error">RED 3/3 runs</span></td>' +
      '<td>a much longer prose cell that should absorb the remaining width and wrap normally</td></tr>' +
      '</tbody></table></div>')
    const got = await page.evaluate(`(() => {
      const b = document.querySelector('#s .sd-badge');
      const s = getComputedStyle(b);
      const cell = document.getElementById('s').getBoundingClientRect();
      return { lines: b.getClientRects().length, ws: s.whiteSpace,
               fits: b.scrollWidth <= b.clientWidth + 1,
               cellW: Math.round(cell.width), badgeW: Math.round(b.getBoundingClientRect().width) };
    })()`)
    assert.equal(got.lines, 1, 'the status label wrapped onto a second line')
    assert.equal(got.ws, 'nowrap', `badge white-space is ${got.ws}`)
    assert.equal(got.fits, true, 'the label is clipped by its own box')
    // The column must size to the label, not take an equal share — otherwise a
    // status cell steals width the prose column needs.
    assert.ok(got.cellW < got.badgeW + 70, `status column is ${got.cellW}px for a ${got.badgeW}px label`)
  })

  test('badges no longer break words mid-character', async () => {
    // The reported shape: "Vacuously green" rendered as "Vacuou s green".
    await render('<span class="sd-badge" id="b">Vacuously green</span>')
    const got = await page.evaluate(`(() => {
      const b = document.getElementById('b');
      return { lines: b.getClientRects().length, wrap: getComputedStyle(b).overflowWrap };
    })()`)
    assert.equal(got.lines, 1, 'badge still wraps')
    assert.notEqual(got.wrap, 'anywhere', 'badge still allows mid-word breaks')
  })

  test('a long hyphenated badge wraps inside its card instead of colliding with the pill', async () => {
    await render('<div class="sd-card" id="c" style="width:240px"><div class="sd-row">' +
      '<span class="sd-badge" id="b">a-badge-with-a-deliberately-long-label-that-must-wrap-not-clip</span>' +
      '</div></div>')
    const got = await page.evaluate(`(() => {
      const b = document.getElementById('b'), c = document.getElementById('c');
      const br = b.getBoundingClientRect(), cr = c.getBoundingClientRect();
      return {
        lines: b.getClientRects().length,
        textOverflow: b.scrollWidth - b.clientWidth,
        cardOverflow: Math.round(br.right - cr.right),
      };
    })()`)
    assert.ok(got.textOverflow <= 1, `label overflows the pill by ${got.textOverflow}px`)
    assert.ok(got.cardOverflow <= 1, `badge overflows its card by ${got.cardOverflow}px`)
  })

  test('the table is closed top and bottom', async () => {
    await render('<div class="sd-tablewrap" id="w"><table><thead><tr><th id="h">head</th></tr></thead>' +
      '<tbody><tr><td>a</td></tr><tr><td id="last">b</td></tr></tbody></table></div>')
    const got = await page.evaluate(`(() => {
      const px = (id, p) => parseFloat(getComputedStyle(document.getElementById(id))[p]);
      return { wrapTop: px('w', 'borderTopWidth'), wrapBottom: px('w', 'borderBottomWidth'),
               headBottom: px('h', 'borderBottomWidth') };
    })()`)
    assert.ok(got.wrapTop > 0, 'no rule above the table')
    assert.ok(got.wrapBottom > 0, 'the table does not close at the bottom')
    assert.ok(got.headBottom > 0, 'no rule below the header')
  })

  test('the table edges are a single rule, not a doubled one', async () => {
    await render('<div class="sd-tablewrap" id="w"><table><thead><tr><th id="h">head</th></tr></thead>' +
      '<tbody><tr><td>a</td></tr><tr><td id="last">b</td></tr></tbody></table></div>')
    const got = await page.evaluate(`(() => {
      const px = (id, p) => parseFloat(getComputedStyle(document.getElementById(id))[p]);
      return { wrapTop: px('w', 'borderTopWidth'), wrapBottom: px('w', 'borderBottomWidth'),
               headTop: px('h', 'borderTopWidth'), lastBottom: px('last', 'borderBottomWidth') };
    })()`)
    assert.equal(got.wrapTop, 1, 'the frame must be the top edge')
    assert.equal(got.wrapBottom, 1, 'the frame must be the bottom edge')
    assert.equal(got.headTop, 0, 'the header still draws a top edge beside the frame')
    assert.equal(got.lastBottom, 0, 'the last row still draws a bottom edge beside the frame')
  })

  // Collapsed borders do not show up in computed style, so the top edge has to be
  // counted in painted pixels: one line for a headed table, one for a headerless one.
  for (const [label, rows] of [
    ['a header', '<thead><tr><th>head</th></tr></thead><tbody><tr><td>a</td></tr></tbody>'],
    ['no header', '<tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody>'],
  ]) {
    test(`the top edge is exactly one painted rule with ${label}`, async () => {
      await render(`<div class="sd-tablewrap" id="w"><table>${rows}</table></div>`)
      const box = await page.evaluate(`(() => {
        const r = document.getElementById('w').getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left) };
      })()`)
      const shot = (await page.screenshot({
        clip: { x: box.left + 20, y: box.top - 4, width: 6, height: 14 },
      })).toString('base64')
      const lines = await page.evaluate(`(async () => {
        const img = new Image(); img.src = 'data:image/png;base64,${shot}'; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
        const lum = [];
        for (let y = 0; y < img.height; y++) {
          const d = cx.getImageData(0, y, img.width, 1).data;
          let s = 0; for (let i = 0; i < img.width; i++) s += (d[i*4] + d[i*4+1] + d[i*4+2]) / 3;
          lum.push(s / img.width);
        }
        const bg = Math.max(...lum);
        const out = [];
        lum.forEach((v, i) => {
          if (bg - v <= 12) return;
          const last = out[out.length - 1];
          if (last && i === last.end + 1) last.end = i; else out.push({ start: i, end: i });
        });
        return out;
      })()`)
      assert.equal(lines.length, 1,
        `expected one painted top rule with ${label}, saw ${lines.length}`)
      const thick = lines[0].end - lines[0].start + 1
      assert.equal(thick, 1, `the top rule paints ${thick}px, not 1px — it is doubled`)
    })
  }
})

describe('classes listed as painted-when-empty really paint', { timeout: 120000 }, () => {
  // differ.js grants these a sid with no text in them. If one paints nothing,
  // the reader gets a zero-height block that still accepts an annotation.
  const CLASSES = ['sd-card', 'sd-metric', 'sd-badge', 'sd-tag', 'sd-flag', 'sd-entry', 'sd-focus', 'sd-tablewrap']

  for (const cls of CLASSES) {
    test(`.${cls} paints with no content`, async () => {
      await render(`<div class="${cls}" id="t"></div>`)
      const got = await page.evaluate(`(() => {
        const el = document.getElementById('t'), s = getComputedStyle(el), r = el.getBoundingClientRect();
        const painted = (v) => v && v !== 'none' && !/rgba\\(0, 0, 0, 0\\)/.test(v) && v !== '0px';
        return { h: r.height, w: r.width,
                 bg: painted(s.backgroundColor), border: parseFloat(s.borderTopWidth) + parseFloat(s.borderLeftWidth),
                 padding: parseFloat(s.paddingTop) + parseFloat(s.paddingLeft) };
      })()`)
      assert.ok(got.h > 0, `.${cls} collapsed to zero height`)
      assert.ok(got.bg || got.border > 0, `.${cls} has neither a background nor a border when empty`)
    })
  }

  test('the paint check can fail — a bare div is not painted', async () => {
    // Mutation of the observation path itself: if this passes as "painted",
    // every case above is meaningless.
    await render('<div id="t"></div>')
    const got = await page.evaluate(`(() => {
      const el = document.getElementById('t'), s = getComputedStyle(el), r = el.getBoundingClientRect();
      const painted = (v) => v && v !== 'none' && !/rgba\\(0, 0, 0, 0\\)/.test(v);
      return { h: r.height, bg: painted(s.backgroundColor), border: parseFloat(s.borderTopWidth) };
    })()`)
    assert.equal(got.h, 0, 'a bare empty div took height, so height proves nothing')
    assert.equal(got.bg, false, 'a bare div reported a background, so the paint check is broken')
    assert.equal(got.border, 0, 'a bare div reported a border')
  })
})

describe('rendered diffs — tints carry meaning in both themes', { timeout: 120000 }, () => {
  const LONG = 'a sentence long enough to wrap more than once in the content column, '.repeat(8).trim()
  const diff = (src) => `<pre class="sd-diff">${renderDiffBody(src)}</pre>`

  for (const theme of ['light', 'dark']) {
    test(`${theme}: text stays readable on both tints`, async () => {
      await render(diff(['-removed line', '+added line'].join('\n')), theme)
      const got = await page.evaluate(`(() => {
        const cs = (s) => getComputedStyle(document.querySelector(s));
        const del = cs('.sd-diff-del'), add = cs('.sd-diff-add');
        return { del: window.__ratio(del.color, del.backgroundColor),
                 add: window.__ratio(add.color, add.backgroundColor),
                 mark: window.__ratio(cs('.sd-diff-del .sd-diff-mark').color, del.backgroundColor) };
      })()`)
      assert.ok(got.del >= 4.5, `text on the removed tint is ${got.del}`)
      assert.ok(got.add >= 4.5, `text on the added tint is ${got.add}`)
      // De-emphasised, but the glyph is the only add/del signal that does not
      // depend on hue — it may not be dimmed below the readable bar.
      assert.ok(got.mark >= 4.5, `the diff marker fell to ${got.mark}`)
    })

    test(`${theme}: each tint separates from the block ground`, async () => {
      await render(diff(['-removed', '+added', ' context'].join('\n')), theme)
      const got = await page.evaluate(`(() => {
        const cs = (s) => getComputedStyle(document.querySelector(s));
        const ground = cs('pre.sd-diff').backgroundColor;
        return { del: window.__ratio(cs('.sd-diff-del').backgroundColor, ground),
                 add: window.__ratio(cs('.sd-diff-add').backgroundColor, ground) };
      })()`)
      assert.ok(got.del >= 1.15, `the removed tint is ${got.del} against the block — invisible`)
      assert.ok(got.add >= 1.15, `the added tint is ${got.add} against the block — invisible`)
    })
  }

  // The whole point of the per-line block: a paragraph-length removed line in a
  // markdown body must be tinted all the way down, not one line box deep.
  test('a wrapped prose line is tinted to its last line box, not just the first', async () => {
    await render(diff(`-${LONG}`))
    const got = await page.evaluate(`(() => {
      const el = document.querySelector('.sd-diff-del');
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const bg = getComputedStyle(el).backgroundColor;
      const bottom = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
      return { lines: Math.round(r.height / lh), bg,
               bottomBg: bottom ? getComputedStyle(bottom).backgroundColor : null };
    })()`)
    assert.ok(got.lines >= 3, `the fixture did not wrap (${got.lines} line box) — it proves nothing`)
    assert.equal(got.bottomBg, got.bg, 'the last wrapped line box is not covered by the tint')
  })

  test('a wrapped line aligns past the marker, not under it', async () => {
    await render(diff(`-${LONG}`))
    const got = await page.evaluate(`(() => {
      const el = document.querySelector('.sd-diff-del');
      // Trailing-space fragments produce narrow rects at the end of a line; only
      // the full line boxes say where a wrapped line actually starts.
      const lefts = [...el.querySelector('.sd-diff-text').getClientRects()]
        .filter((r) => r.width > 40).map((r) => Math.round(r.left));
      return { lines: lefts.length, spread: Math.max(...lefts) - Math.min(...lefts) };
    })()`)
    assert.ok(got.lines >= 3, `the fixture did not wrap (${got.lines} line boxes)`)
    assert.ok(got.spread <= 1,
      `wrapped lines start ${got.spread}px apart — the hanging indent is off`)
  })

  test('a blank context line holds its height but paints nothing', async () => {
    await render(diff(['@@ -1 +1 @@', ' kept', '', ' also'].join('\n')))
    const got = await page.evaluate(`(() => {
      const blank = [...document.querySelectorAll('.sd-diff-ctx')]
        .find((e) => e.querySelector('.sd-diff-text').textContent === '');
      const s = getComputedStyle(blank);
      return { h: blank.getBoundingClientRect().height, bg: s.backgroundColor };
    })()`)
    assert.ok(got.h > 0, 'a blank diff line collapsed, so the gap in the diff disappears')
    assert.match(got.bg, /rgba\(0, 0, 0, 0\)/, 'a blank context line paints, so it needs a sid')
  })

  test('the word mark reads as a deeper tint, not the accent-text treatment', async () => {
    await render(diff(['-the quick brown fox', '+the quick red fox'].join('\n')))
    const got = await page.evaluate(`(() => {
      const w = document.querySelector('.sd-diff-del .sd-diff-word');
      const line = document.querySelector('.sd-diff-del');
      const ws = getComputedStyle(w), ls = getComputedStyle(line);
      return { sameColour: ws.color === ls.color,
               separation: window.__ratio(ws.backgroundColor, ls.backgroundColor),
               onWord: window.__ratio(ls.color, ws.backgroundColor) };
    })()`)
    assert.equal(got.sameColour, true, 'the word mark recoloured the text instead of tinting behind it')
    assert.ok(got.separation >= 1.15, `the word mark is ${got.separation} against its line — invisible`)
    assert.ok(got.onWord >= 4.5, `text on the word mark is ${got.onWord}`)
  })
})

describe('unbroken tokens never widen the page', { timeout: 120000 }, () => {
  const MONSTER = 'x'.repeat(300)
  const URL_TOKEN = `https://example.com/${'segment/'.repeat(80)}end`

  test('a monster token wraps inside a card and in plain prose', async () => {
    await render(`<div class="sd-card"><p>token: ${MONSTER}</p></div><p>url: ${URL_TOKEN}</p>`)
    const got = await page.evaluate(`(() => ({
      scroll: document.scrollingElement.scrollWidth,
      viewport: window.innerWidth,
    }))()`)
    assert.ok(got.scroll <= got.viewport, `page scrolls sideways: ${got.scroll} > ${got.viewport}`)
  })

  test('a monster token in a heading and a list item also wraps', async () => {
    await render(`<h2>${MONSTER}</h2><ul><li>${URL_TOKEN}</li></ul>`)
    const got = await page.evaluate(`(() => ({
      scroll: document.scrollingElement.scrollWidth,
      viewport: window.innerWidth,
    }))()`)
    assert.ok(got.scroll <= got.viewport, `page scrolls sideways: ${got.scroll} > ${got.viewport}`)
  })
})
