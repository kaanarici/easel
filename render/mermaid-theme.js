/* Stock gantt bars fail AA (2.95:1, 4.0:1); two text colours cover four states.
   Every hex is a 6-digit shipped token. Category greens miss AA on light with
   white labels, so done shares ink with plain. */
const THEMES = {
  light: {
    text: '#fcfcfc',
    outside: '#141414',
    plain: '#141414',
    done: '#141414',
    active: '#2e76ab',
    crit: '#cf2d56',
    edge: '#f3f3f3',
    section: ['#fcfcfc', '#f8f8f8'],
    title: '#141414',
  },
  dark: {
    text: '#191c22',
    outside: '#7bafe9',
    plain: '#e4e4e4',
    done: '#3fa266',
    active: '#599ce7',
    crit: '#fc6b83',
    edge: '#141414',
    section: ['#181818', '#141414'],
    title: '#e4e4e4',
  },
}

/** Every value is a shipped easel.css token, resolved to hex. */
export function ganttThemeVariables(theme) {
  const t = THEMES[theme === 'dark' ? 'dark' : 'light']
  return {
    taskTextColor: t.text,
    taskTextDarkColor: t.text,
    taskTextLightColor: t.text,
    taskTextOutsideColor: t.outside,
    taskBkgColor: t.plain,
    taskBorderColor: t.edge,
    doneTaskBkgColor: t.done,
    doneTaskBorderColor: t.edge,
    activeTaskBkgColor: t.active,
    activeTaskBorderColor: t.edge,
    critBkgColor: t.crit,
    critBorderColor: t.edge,
    gridColor: t.edge,
    todayLineColor: t.active,
    sectionBkgColor: t.section[0],
    altSectionBkgColor: t.section[1],
    sectionBkgColor2: t.section[0],
    titleColor: t.title,
  }
}

/* Front matter, init directives and comments may all precede the keyword. */
export function isGantt(source) {
  const body = String(source)
    .replace(/^\s*---[\s\S]*?---\s*/, '')
    .replace(/^\s*(?:%%\{[\s\S]*?\}%%\s*)+/, '')
  const first = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%'))
  return /^gantt\b/i.test(first ?? '')
}
