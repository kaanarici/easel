import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as review from '../templates/review.js'
import * as page from '../templates/page.js'
import { esc, markdown, widget, TemplateError } from '../templates/_html.js'
import { readerChecks } from '../daemon/reader-checks.js'
import { buildPreview } from './preview.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const sample = async (n) => JSON.parse(await readFile(join(HERE, 'samples', `${n}.json`), 'utf8'))
// A review decision as the template now requires it: the two frame lines and a basis per option.
const framed = (d) => ({
  what: 'what a person gets', why_you: 'why the reader decides', ...d,
  options: d.options.map((o) => (typeof o === 'string' ? { value: o, basis: `what ${o} changes` } : { basis: 'what it changes', ...o })),
})

const TEMPLATES = [review, page]

describe('contract: every template', () => {
  test('renders sample data to body-inner HTML with no document tags', async () => {
    for (const t of TEMPLATES) {
      const html = t.render(await sample(t.name))
      assert.equal(typeof html, 'string')
      assert.ok(html.length > 0, `${t.name} produced empty output`)
      assert.doesNotMatch(html, /<\s*(html|head|body)\b/i, `${t.name} emitted a document tag`)
    }
  })

  // The daemon allowlist, the preview harness, and the screenshot sweep each
  // enumerate templates separately, so a new one lands registered in only some.
  test('is registered in the preview harness', async () => {
    for (const t of TEMPLATES) {
      const html = await buildPreview(t.name, await sample(t.name))
      assert.ok(html.includes('<html'), `${t.name} missing from the preview template map`)
    }
  })

  test('is registered in the daemon template allowlist', async () => {
    const server = await readFile(join(HERE, '..', 'daemon', 'server.js'), 'utf8')
    const line = server.match(/const TEMPLATES = new Set\(\[([^\]]*)\]\)/)
    assert.ok(line, 'could not find the daemon TEMPLATES allowlist')
    for (const t of TEMPLATES) {
      assert.ok(line[1].includes(`'${t.name}'`), `${t.name} missing from daemon/server.js TEMPLATES`)
    }
  })

  test('never emits sf- classes or data-sid', async () => {
    for (const t of TEMPLATES) {
      const html = t.render(await sample(t.name))
      assert.doesNotMatch(html, /class\s*=\s*("[^"]*|'[^']*)\bsf-/, `${t.name} emitted an sf- class`)
      assert.doesNotMatch(html, /\sdata-sid\s*=/, `${t.name} emitted data-sid`)
    }
  })

  test('throws a readable TemplateError on invalid data', () => {
    for (const t of TEMPLATES) {
      assert.throws(() => t.render(null), TemplateError, `${t.name} did not throw on null`)
      assert.throws(() => t.render([]), TemplateError, `${t.name} did not throw on an array`)
    }
  })
})

describe('escaping', () => {
  test('escapes the five HTML-significant characters', () => {
    assert.equal(esc(`<script>&"'`), '&lt;script&gt;&amp;&quot;&#39;')
  })

  test('user data cannot break out into a live element', () => {
    const html = review.render({
      title: '</h1><script>alert(1)</script>',
      about: 'the work',
      sections: [{ heading: '"><img src=x onerror=alert(1)>', body: 'ok' }],
    })
    // The payload may appear as escaped text; what must not exist is a real tag.
    assert.doesNotMatch(html, /<script\b/)
    assert.doesNotMatch(html, /<img\b/)
    assert.match(html, /&lt;script&gt;/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  })

  test('markdown rejects javascript: and data: links', () => {
    const out = markdown('[x](javascript:alert(1)) [y](data:text/html,hi) [ok](https://example.com)')
    assert.doesNotMatch(out, /href="javascript:/)
    assert.doesNotMatch(out, /href="data:/)
    assert.match(out, /href="https:\/\/example\.com"/)
  })
})

describe('markdown tables', () => {
  const TABLE = [
    '| Attempt | Base delay | Cumulative |',
    '|---|---:|:---:|',
    '| 1 | 0s | 0s |',
    '| 2 | **1s** | `2s` |',
  ].join('\n')

  test('renders a real table, not a paragraph of pipes', () => {
    const out = markdown(TABLE)
    assert.match(out, /<table>/)
    assert.equal((out.match(/<tr>/g) || []).length, 3, 'header + 2 body rows')
    assert.equal((out.match(/<th\b/g) || []).length, 3)
    assert.doesNotMatch(out, /<p>\s*\|/, 'fell back to pipe soup')
    assert.doesNotMatch(out, /\|/, 'a literal pipe leaked into the output')
  })

  test('ships inside the horizontal scroll wrapper', () => {
    assert.match(markdown(TABLE), /<div class="sd-tablewrap"><table>/)
  })

  test('carries alignment as a class, because publish strips style attributes', () => {
    const out = markdown(TABLE)
    assert.doesNotMatch(out, /style\s*=/, 'alignment via style would be sanitized away at publish')
    assert.match(out, /<th class="sd-align-right">Base delay<\/th>/)
    assert.match(out, /<th class="sd-align-center">Cumulative<\/th>/)
    assert.match(out, /<th>Attempt<\/th>/, 'an unaligned column must stay unclassed')
    assert.match(out, /<td class="sd-align-right">0s<\/td>/)
  })

  test('every alignment marker maps to its own class', () => {
    const out = markdown('| a | b | c | d |\n| :--- | ---: | :---: | --- |\n| 1 | 2 | 3 | 4 |')
    assert.match(out, /<th class="sd-align-left">a<\/th>/)
    assert.match(out, /<th class="sd-align-right">b<\/th>/)
    assert.match(out, /<th class="sd-align-center">c<\/th>/)
    assert.match(out, /<th>d<\/th>/)
  })

  test('renders inline formatting inside cells', () => {
    const out = markdown(TABLE)
    assert.match(out, /<td[^>]*><strong>1s<\/strong><\/td>/)
    assert.match(out, /<td[^>]*><code>2s<\/code><\/td>/)
  })

  test('escapes cell content — a table is not an HTML escape hatch', () => {
    for (const src of [
      '| h |\n|---|\n| <img src=x onerror=alert(1)> |',
      '| <img src=x onerror=alert(1)> |\n|---|\n| body |',
    ]) {
      const out = markdown(src)
      assert.doesNotMatch(out, /<img\b/, `live element survived in: ${src}`)
      assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/)
    }
  })

  test('accepts rows without leading or trailing pipes', () => {
    const out = markdown('a | b\n--- | ---\n1 | 2')
    assert.match(out, /<th>a<\/th><th>b<\/th>/)
    assert.match(out, /<td>1<\/td><td>2<\/td>/)
  })

  test('an escaped pipe is content, not a column break', () => {
    const out = markdown('| h |\n|---|\n| a \\| b |')
    assert.equal((out.match(/<td/g) || []).length, 1, 'split on an escaped pipe')
    assert.match(out, /<td>a \| b<\/td>/)
  })

  test('an escaped pipe ending the last cell survives', () => {
    // With no trailing delimiter, the final `\|` is content — stripping it
    // leaves a stray backslash where the pipe should be.
    assert.match(markdown('| h | i |\n|---|---|\n| a | ends \\| |'), /<td>ends \|<\/td>/)
    assert.match(markdown('| h | i |\n|---|---|\n| a | ends \\|'), /<td>ends \|<\/td>/)
  })

  /* A single hyphen is a valid GFM delimiter — verified against `marked`, which
     renders `-|-` as a table. Requiring three would drop valid tables. */
  test('separator cells accept one hyphen, matching GFM', () => {
    for (const sep of ['-|-', '--|--', '---|---', ':-|-:']) {
      assert.match(markdown(`a | b\n${sep}\n1 | 2`), /<table>/, `rejected separator: ${sep}`)
    }
  })

  test('a short row is padded to the header width, never dropped', () => {
    const out = markdown('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 |')
    assert.equal((out.match(/<tr>/g) || []).length, 3, 'a short row was dropped')
    assert.match(out, /<tr><td>1<\/td><td><\/td><td><\/td><\/tr>/)
  })

  /* Surplus cells in a long row are dropped silently. That is GFM behaviour —
     `marked` does the same — so it is pinned, not fixed. */
  test('a long row is truncated to the header width', () => {
    const out = markdown('| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 | SURPLUS |')
    assert.doesNotMatch(out, /SURPLUS/)
    assert.equal((out.match(/<td/g) || []).length, 3)
  })

  test('pipes without a separator row stay prose', () => {
    const out = markdown('this | that | other')
    assert.match(out, /<p>/)
    assert.doesNotMatch(out, /<table>/)
  })

  test('a table ends at a blank line and prose after it still renders', () => {
    const out = markdown('| h |\n|---|\n| 1 |\n\nAfter the table.')
    assert.match(out, /<\/table><\/div>\s*<p>After the table\.<\/p>/)
  })
})

describe('markdown', () => {
  // Child with a hard deadline: a non-advancing loop is a sync spin, so an
  // in-process assertion would wedge the runner instead of going red.
  const renderInChild = (src) =>
    execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { markdown } from ${JSON.stringify(new URL('../templates/_html.js', import.meta.url).href)}
       process.stdout.write(markdown(${JSON.stringify(src)}))`,
    ], { encoding: 'utf8', timeout: 5000 })

  test('an info-string fence terminates and is parsed as a fence', () => {
    const out = renderInChild('```js title="example"\nconst a = 1\n```')
    assert.match(out, /<pre><code class="language-js">/)
    assert.doesNotMatch(out, /<p>/, 'the fence line leaked into a paragraph')
  })

  // Deep-review finding 0's exact repro shape.
  test('a ```ts {1,3} fence terminates and is parsed as a fence', () => {
    const out = renderInChild('```ts {1,3}\nconst a = 1\n```')
    assert.match(out, /<pre><code class="language-ts">/)
    assert.doesNotMatch(out, /<p>/)
  })

  test('an unterminated info-string fence still terminates', () => {
    assert.match(renderInChild('```ts {1,3}'), /<pre><code class="language-ts">/)
  })

  test('a brace-list with no language does not become a bogus language class', () => {
    const out = renderInChild('``` {1,3}\nb\n```')
    assert.match(out, /<pre><code>/)
    assert.doesNotMatch(out, /language-/)
  })

  test('a mermaid fence with an info string still renders as pre.mermaid', () => {
    assert.match(renderInChild('```mermaid theme=dark\nflowchart LR\n  A --> B\n```'), /<pre class="mermaid">/)
  })

  test('prose after an unparsed fence line still terminates', () => {
    assert.match(renderInChild('~~~\nweird\n~~~\ntail'), /tail/)
  })

  test('a mermaid fence becomes a pre.mermaid element with escaped source', () => {
    const out = markdown('```mermaid\nflowchart LR\n  A[a<br/>b] --> B\n```')
    assert.match(out, /<pre class="mermaid">/)
    assert.match(out, /&lt;br\/&gt;/, 'source must stay escaped until publish-time render')
  })

  test('a plain fence becomes pre > code, not pre.mermaid', () => {
    const out = markdown('```js\nconst a = 1 < 2\n```')
    assert.match(out, /<pre><code class="language-js">/)
    assert.doesNotMatch(out, /class="mermaid"/)
    assert.match(out, /1 &lt; 2/)
  })

  test('a blockquote keeps its lists and paragraphs as blocks', () => {
    const out = markdown('> **The day**\n> - one\n> - two\n>\n> tail')
    assert.match(out, /<blockquote><p><strong>The day<\/strong><\/p>/)
    assert.match(out, /<ul><li>one<\/li><li>two<\/li><\/ul>/)
    assert.match(out, /<p>tail<\/p><\/blockquote>/)
  })

  test('a nested blockquote nests', () => {
    assert.match(renderInChild('> outer\n> > inner'), /<blockquote><p>outer<\/p>\n<blockquote><p>inner<\/p><\/blockquote><\/blockquote>/)
  })
})

describe('widgets', () => {
  test('emits the declarative protocol the chrome binds against', () => {
    const html = widget({ type: 'vote', id: 'w1', prompt: 'Ship?', options: ['yes', 'no'] })
    assert.match(html, /data-widget="vote"/)
    assert.match(html, /data-widget-id="w1"/)
    assert.match(html, /data-option="yes"/)
    assert.match(html, /data-option="no"/)
  })

  test('options are native buttons — the annotation layer swallows non-native clicks', () => {
    const html = widget({ type: 'vote', id: 'w1', prompt: 'Ship?', options: ['yes'] })
    assert.match(html, /<button type="button" data-option="yes">/)
  })

  test('help is prose — it renders as markdown, still escaped', () => {
    const html = widget({ type: 'vote', id: 'w1', prompt: 'Ship?', help: '```diff\n-old\n+new\n```\n\n<b>a</b> **b**', options: ['yes'] })
    assert.match(html, /<div class="sd-widget-help"><pre class="sd-diff">-old\n\+new<\/pre>/)
    assert.match(html, /<p>&lt;b&gt;a&lt;\/b&gt; <strong>b<\/strong><\/p>/)
  })

  test('rejects an unknown widget type and empty options', () => {
    assert.throws(() => widget({ type: 'slider', id: 'w', prompt: 'p', options: ['a'] }), TemplateError)
    assert.throws(() => widget({ type: 'vote', id: 'w', prompt: 'p', options: [] }), TemplateError)
  })

  test('option objects render the basis list above the buttons', () => {
    const html = widget({ type: 'decision', id: 'w1', prompt: 'Retry?', options: [
      { value: 'yes', label: 'Do it', basis: 'Adds 50ms per call', recommended: true },
      { value: 'no', label: 'Skip it', basis: 'Saves the latency' },
    ] })
    const basisIdx = html.indexOf('sd-widget-basis')
    const optionsIdx = html.indexOf('sd-widget-options')
    assert.ok(basisIdx !== -1, 'no sd-widget-basis list')
    assert.ok(optionsIdx !== -1, 'no sd-widget-options')
    assert.ok(basisIdx < optionsIdx, 'basis list must appear before the buttons')
    assert.match(html, /sd-widget-pick/)
    assert.match(html, /recommended/)
  })

  test('two recommended options throw', () => {
    assert.throws(() => widget({ type: 'decision', id: 'w1', prompt: 'p', options: [
      { value: 'a', recommended: true },
      { value: 'b', recommended: true },
    ] }), TemplateError)
  })

  test('plain string options render without a basis list, same shape as before', () => {
    const html = widget({ type: 'vote', id: 'w1', prompt: 'Ship?', options: ['yes', 'no'] })
    assert.doesNotMatch(html, /sd-widget-basis/)
    assert.match(html, /<button type="button" data-option="yes">yes<\/button>/)
    assert.match(html, /<button type="button" data-option="no">no<\/button>/)
  })
})

describe('review', () => {
  describe('tabs', () => {
    const sec = (heading, tab) => (tab === undefined ? { heading, body: heading } : { heading, body: heading, tab })

    test('sections before the first tab stay above it; each tab wraps its run of sections', () => {
      const html = review.render({
        title: 't',
        about: 'the work',
        sections: [sec('intro'), sec('a1', 'A'), sec('a2', 'A'), sec('b1', 'B')],
        decisions: [framed({ id: 'final', question: 'ship?', options: ['yes', 'no'] })],
      })
      const panels = [...html.matchAll(/<div data-tab="([^"]+)">([\s\S]*?)\n<\/div>/g)].map((m) => [m[1], (m[2].match(/<h2>[^<]+/g) || []).length])
      assert.deepEqual(panels, [['A', 2], ['B', 1]])
      assert.ok(html.indexOf('intro') < html.indexOf('data-tab'), 'the untabbed lead section renders above the tabs')
      assert.ok(html.lastIndexOf('data-tab') < html.indexOf('data-widget-id="final"'), 'board-wide decisions stay outside every tab')
    })

    test('a board with no tab field renders exactly as before', () => {
      assert.doesNotMatch(review.render({ title: 't', about: 'the work', sections: [sec('a'), sec('b')] }), /data-tab/)
    })

    test('labels are escaped into the attribute', () => {
      const html = review.render({ title: 't', about: 'the work', sections: [sec('x', 'R&D "plan"'), sec('y', 'Other')] })
      assert.match(html, /data-tab="R&amp;D &quot;plan&quot;"/)
    })

    for (const [name, sections, message] of [
      ['an untabbed section after tabs start', [sec('a', 'A'), sec('b', 'B'), sec('c')], /sections\[2\]\.tab must be a non-empty string/],
      ['a tab reopened after another', [sec('a', 'A'), sec('b', 'B'), sec('c', 'A')], /reopens an earlier tab/],
      ['a single tab', [sec('a', 'A'), sec('b', 'A')], /at least two different labels/],
    ]) {
      test(`throws on ${name}`, () => {
        assert.throws(() => review.render({ title: 't', about: 'the work', sections }), (err) => err instanceof TemplateError && message.test(err.message))
      })
    }
  })

  test('a section never ships pre-closed — an old collapse key is inert, not an error', () => {
    const html = review.render({
      title: 't',
      about: 'the work',
      sections: [{ heading: 'Background', body: 'the derivation', collapse: 'the full derivation' }],
    })
    assert.doesNotMatch(html, /<details/, 'the author cannot hand the reader a closed section')
    assert.match(html, /the derivation/, 'the body still renders')
    assert.doesNotMatch(html, /the full derivation/, 'the old summary label is not emitted')
  })

  test('renders decisions and votes as widgets', async () => {
    const html = review.render(await sample('review'))
    assert.match(html, /data-widget="decision"/)
    assert.match(html, /data-widget-id="budget-location"/)
    assert.match(html, /data-widget="approve"/)
  })

  test('renders section-inline decisions and votes inside the section', () => {
    const html = review.render({
      title: 't',
      about: 'the work',
      sections: [{
        heading: 'Retry budget',
        body: 'context',
        decisions: [framed({ id: 'inline-d', question: 'q', options: ['a', 'b'] })],
        votes: [{ id: 'inline-v', question: 'ok?', type: 'approve' }],
      }],
    })
    const section = html.slice(html.indexOf('<section'), html.indexOf('</section>'))
    assert.match(section, /data-widget-id="inline-d"/)
    assert.match(section, /data-widget-id="inline-v"/)
  })

  test('rejects duplicate widget ids between inline and top-level', () => {
    assert.throws(() => review.render({
      title: 't',
      about: 'the work',
      sections: [{ heading: 'h', decisions: [framed({ id: 'dup', question: 'q', options: ['a'] })] }],
      decisions: [framed({ id: 'dup', question: 'q', options: ['a'] })],
    }), TemplateError)
  })

  test('rejects duplicate widget ids across decisions and votes', () => {
    assert.throws(() => review.render({
      title: 't',
      about: 'the work',
      decisions: [framed({ id: 'dup', question: 'q', options: ['a'] })],
      votes: [{ id: 'dup', question: 'q', options: ['a'] }],
    }), TemplateError)
  })

  test('requires at least one of sections, decisions, or votes', () => {
    assert.throws(() => review.render({ title: 'empty' }), TemplateError)
  })

  describe('decision frame', () => {
    const board = (d) => ({ title: 't', about: 'the work', sections: [{ heading: 'h', body: 'b', decisions: [d] }] })

    test('renders what and why-you above the question, and the basis per option', () => {
      const html = review.render(board(framed({ id: 'd', question: 'Which?', options: ['a', 'b'] })))
      assert.match(html, /<strong>What this is:<\/strong> what a person gets/)
      assert.match(html, /<strong>Why you decide:<\/strong> why the reader decides/)
      assert.ok(html.indexOf('sd-widget-frame') < html.indexOf('sd-widget-prompt'), 'the frame precedes the question')
      assert.match(html, /what a changes/)
    })

    for (const [name, mutate, message] of [
      ['what', (d) => { delete d.what }, /sections\[0\]\.decisions\[0\]\.what/],
      ['why_you', (d) => { delete d.why_you }, /sections\[0\]\.decisions\[0\]\.why_you/],
      ['an option basis', (d) => { d.options[1] = { value: 'b', label: 'B' } }, /sections\[0\]\.decisions\[0\]\.options\[1\]\.basis/],
      ['a string option', (d) => { d.options[0] = 'a' }, /options\[0\]\.basis/],
    ]) {
      test(`a decision missing ${name} fails with the path`, () => {
        const d = framed({ id: 'd', question: 'q', options: ['a', 'b'] })
        mutate(d)
        assert.throws(() => review.render(board(d)), (err) => err instanceof TemplateError && message.test(err.message))
      })
    }

    test('a vote carries no frame and still renders with string options', () => {
      const html = review.render({ title: 't', about: 'the work', votes: [{ id: 'v', question: 'ok?', type: 'approve' }] })
      assert.match(html, /data-widget="approve"/)
      assert.doesNotMatch(html, /sd-widget-frame/)
    })

    test('legacy mode renders a frameless decision as before, and a framed one with its frame', () => {
      const bare = review.render(board({ id: 'd', question: 'q', options: ['a'] }), { legacy: true })
      assert.match(bare, /data-widget-id="d"/)
      assert.doesNotMatch(bare, /sd-widget-frame/)
      const full = review.render(board(framed({ id: 'd', question: 'q', options: ['a'] })), { legacy: true })
      assert.match(full, /sd-widget-frame/)
    })
  })

  describe('about: what the work is, before any ask', () => {
    const board = (extra) => ({ title: 't', sections: [{ heading: 'h', body: 'b' }], ...extra })

    test('renders as a "What this is" block between the summary and the first section', () => {
      const html = review.render(board({ summary: 'Two decisions.', about: 'The chat finds a tool it was not given.\n\nThis round changes how it runs one.' }))
      const at = html.indexOf('class="sd-about')
      assert.ok(at > html.indexOf('Two decisions.'), 'after the summary')
      assert.ok(at < html.indexOf('<section'), 'before the first section')
      assert.match(html, /<div class="sd-about-title">What this is<\/div><p>The chat finds a tool/)
    })

    test('a board without it fails with the path', () => {
      assert.throws(() => review.render(board({})), (err) => err instanceof TemplateError && /review\.about/.test(err.message))
      assert.throws(() => review.render(board({ about: '  ' })), (err) => err instanceof TemplateError && /review\.about/.test(err.message))
    })

    test('legacy mode renders without it, and with it when given', () => {
      assert.doesNotMatch(review.render(board({}), { legacy: true }), /sd-about/)
      assert.match(review.render(board({ about: 'the work' }), { legacy: true }), /sd-about/)
    })
  })

  describe('one "Why you decide" line per decision', () => {
    const two = (a, b) => ({
      title: 't', about: 'the work',
      sections: [{ heading: 'h', body: 'b', decisions: [
        framed({ id: 'first', question: 'q1', options: ['a'], why_you: a }),
        framed({ id: 'second', question: 'q2', options: ['a'], why_you: b }),
      ] }],
    })

    test('two decisions sharing one line fail naming both paths', () => {
      const line = 'Every line a model reads is yours to approve before merge.'
      assert.throws(() => review.render(two(line, ` ${line.toUpperCase()} `)), (err) =>
        err instanceof TemplateError && /decisions\[1\]\.why_you repeats .*decisions\[0\]\.why_you/.test(err.message))
    })

    test('two decisions with their own lines render', () => {
      const html = review.render(two('If the reply shape is wrong the model calls a tool it no longer has.', 'If the key accepts a re-search, a model that forgets the tool passes.'))
      assert.match(html, /data-widget-id="second"/)
    })
  })

  describe('blocks', () => {
    const board = (blocks) => ({ title: 't', about: 'the work', sections: [{ heading: 'H', body: 'prose', blocks }] })

    test('cards render side by side in one grid, each with a title and badges', () => {
      const html = review.render(board([{ kind: 'cards', items: [
        { title: 'Goal', body: 'x', badges: [{ label: 'approved', tone: 'success' }] },
        { title: 'Non-goals', body: 'y' },
      ] }]))
      assert.equal((html.match(/class="sd-grid"/g) || []).length, 1)
      assert.equal((html.match(/class="sd-card"/g) || []).length, 2)
      assert.match(html, /<div class="sd-card-title">Goal<\/div><div class="sd-row"><span class="sd-badge sd-badge-success">approved<\/span><\/div><p>x<\/p>/)
    })

    test('callouts carry their tone; two share a grid, one stands alone', () => {
      const two = review.render(board([{ kind: 'callouts', items: [
        { tone: 'success', title: 'A2', body: 'a' },
        { tone: 'warning', title: 'A3', body: 'b' },
      ] }]))
      assert.match(two, /<div class="sd-grid"><div class="sd-callout sd-callout-success"><div class="sd-callout-title">A2<\/div><p>a<\/p><\/div><div class="sd-callout sd-callout-warning">/)
      const one = review.render(board([{ kind: 'callouts', items: [{ tone: 'info', title: 'A2', body: 'a' }] }]))
      assert.doesNotMatch(one, /sd-grid/)
      assert.match(one, /<div class="sd-callout sd-callout-info">/)
    })

    test('island passes its html through verbatim with title and height', () => {
      const html = review.render(board([{ kind: 'island', title: 'Mockup', height: 360, html: '<div class="sd-grid"><b>raw</b></div>' }]))
      assert.match(html, /<div data-island data-island-title="Mockup" data-island-height="360"><div class="sd-grid"><b>raw<\/b><\/div><\/div>/)
    })

    test('blocks render after the prose and before the inline decisions', () => {
      const html = review.render({
        title: 't',
        about: 'the work',
        sections: [{
          heading: 'H',
          body: 'prose',
          blocks: [{ kind: 'callouts', items: [{ title: 'boxed', body: 'b' }] }],
          decisions: [framed({ id: 'd', question: 'q', options: ['a'] })],
        }],
      })
      assert.ok(html.indexOf('<p>prose</p>') < html.indexOf('sd-callout'))
      assert.ok(html.indexOf('sd-callout') < html.indexOf('data-widget-id="d"'))
    })

    test('dense or many boxes stack into one column; two or three short ones sit side by side', () => {
      const short = (n) => Array.from({ length: n }, (_, i) => ({ title: `c${i}`, body: 'a few words of body' }))
      assert.match(review.render(board([{ kind: 'cards', items: short(3) }])), /class="sd-grid">/)
      assert.match(review.render(board([{ kind: 'cards', items: short(4) }])), /class="sd-grid sd-grid-stack">/)
      const table = { title: 't', body: 'see\n\n| a | b |\n|---|---|\n| 1 | 2 |' }
      assert.match(review.render(board([{ kind: 'cards', items: [short(1)[0], table] }])), /sd-grid-stack/)
      const long = { title: 'l', body: 'word '.repeat(91).trim() }
      assert.match(review.render(board([{ kind: 'cards', items: [short(1)[0], long] }])), /sd-grid-stack/)
      assert.match(review.render(board([{ kind: 'callouts', items: [{ body: 'x ```\ncode\n```' }, { body: 'y' }] }])), /sd-grid-stack/)
      assert.doesNotMatch(review.render(board([{ kind: 'callouts', items: [{ body: 'x' }, { body: 'y' }] }])), /sd-grid-stack/)
    })

    test('an unknown kind, a bad tone, and an empty items list each throw naming the path', () => {
      assert.throws(() => review.render(board([{ kind: 'table' }])), /review\.sections\[0\]\.blocks\[0\]\.kind must be cards, callouts, or island/)
      assert.throws(() => review.render(board([{ kind: 'callouts', items: [{ tone: 'loud', body: 'x' }] }])), /review\.sections\[0\]\.blocks\[0\]\.items\[0\]\.tone must be one of/)
      assert.throws(() => review.render(board([{ kind: 'cards', items: [] }])), /review\.sections\[0\]\.blocks\[0\]\.items must not be empty/)
      assert.throws(() => review.render(board([{ kind: 'cards', items: [{ body: 'no title' }] }])), TemplateError)
    })
  })
})


describe('page', () => {
  test('passes hand-authored HTML through unchanged', () => {
    const html = '<h1>Hi</h1><p>body</p>'
    assert.equal(page.render({ html }), html)
  })

  test('rejects document tags, data-sid, and sf- classes', () => {
    assert.throws(() => page.render({ html: '<body>x</body>' }), TemplateError)
    assert.throws(() => page.render({ html: '<div data-sid="3">x</div>' }), TemplateError)
    assert.throws(() => page.render({ html: '<div class="sf-queue">x</div>' }), TemplateError)
  })

  test('rejects sf- classes in every legal attribute syntax', () => {
    for (const html of [
      '<div class=sf-queue>x</div>',
      "<div class='sf-queue'>x</div>",
      '<div class = sf-queue>x</div>',
      '<div class="sd-card sf-toast">x</div>',
    ]) {
      assert.throws(() => page.render({ html }), TemplateError, `accepted: ${html}`)
    }
  })

  test('does not over-reject legitimate content', () => {
    for (const html of [
      '<div class=sd-card>x</div>',
      '<div class="sd-card sd-tablewrap">x</div>',
      '<p>the sf- prefix is reserved</p>',
      '<div data-surface="sf-ish">x</div>',
    ]) {
      assert.equal(page.render({ html }), html, `wrongly rejected: ${html}`)
    }
  })

  test('rejects a non-string or empty html field', () => {
    assert.throws(() => page.render({ html: 42 }), TemplateError)
    assert.throws(() => page.render({ html: '   ' }), TemplateError)
  })
})




