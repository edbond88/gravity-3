'use strict';

// ---------------------------------------------------------------------------
// Translations. Elements opt in with data-i18n (text), data-i18n-html (markup),
// data-i18n-title (tooltip) or data-i18n-label (<optgroup>). Text set from
// main.js goes through t() and is refreshed on the 'langchange' event.
// ---------------------------------------------------------------------------
const STRINGS = {
  en: {
    'doc.title': 'The three-body problem',
    'title': 'The <span class="nowrap">three-body</span> problem',
    'stat.time': 'Time elapsed · years',
    'stat.speeds': 'Star speeds · masses',
    'unit.kms': 'km/s',
    'lang.title': 'Language',

    'start': 'Start',
    'preset.title': 'Starting configuration (1…9, 0)',
    'preset.chaos': 'Chaos',
    'preset.lagrange': 'Lagrange triangle',
    'preset.euler': 'Euler line',
    'preset.figure8': 'Figure-8',
    'preset.butterfly': 'Butterfly',
    'preset.moth': 'Moth',
    'preset.goggles': 'Goggles',
    'preset.dragonfly': 'Dragonfly',
    'preset.yinyang': 'Yin-yang',
    'preset.hierarchical': 'Binary + outer star',
    'group.classical': 'Classical',
    'group.periodic': 'Periodic orbits · equal masses',
    'group.hierarchical': 'Hierarchical',
    'note.chaos': 'Random start · chaotic',
    'note.lagrange': 'Lagrange, 1772 · equilateral triangle · unstable',
    'note.euler': 'Euler, 1767 · stars on a rotating line · unstable',
    'note.figure8': 'Moore 1993, Chenciner & Montgomery 2000 · stable',
    'note.suvakov': 'Šuvakov & Dmitrašinović, 2013 · unstable',
    'note.hierarchical': 'Tight binary + distant star · stable',

    'masses': 'Masses',
    'mass.title': 'Changing a mass restarts the simulation',
    'shuffle': 'Shuffle masses',
    'shuffle.title': 'Random masses (N)',

    'field': 'Gravity field',
    'field.title': 'Show the gravitational potential (G)',
    'field.off': 'Off',
    'field.grid': 'Rubber sheet',
    'field.heat': 'Heat map',
    'field.note': '⌖ — points where the pulls cancel out',

    'drag.hint': 'Drag a star to move it',
    'pause': 'Pause',
    'play': 'Play',
    'pause.title': 'Pause / play (Space)',
    'restart': 'Restart',
    'restart.title': 'New stars (R)',
    'sound.on': 'Sound: on',
    'sound.off': 'Sound: off',
    'sound.title': 'Sound on / off (M)',
    'speed': 'Speed',
    'speed.title': 'Time speed (− / +)',
    'help.button': 'Help (?)',
    'settings.button': 'Start and masses',

    'help.close': 'Close (Esc)',
    'help.heading': 'How it works',
    'help.intro': 'Three stars pull on each other with Newtonian gravity. There is no general ' +
      'formula for their motion — tiny differences grow until the system becomes chaotic, ' +
      'and usually one star is flung away. Then a new system starts.',
    'help.start': '<b>Start</b> — a random chaotic start, or a known solution: Lagrange\'s ' +
      'triangle, Euler\'s line, the figure-eight and other periodic orbits, or a stable binary ' +
      'with a distant star. Most solutions are unstable and fall apart after a few periods.',
    'help.masses': '<b>Masses</b> — set each star\'s mass in solar masses. Changing one ' +
      'restarts the simulation. Orbits marked “equal masses” switch back to chaos.',
    'help.drag': '<b>Drag stars</b> — pause, drag any star to a new place and press play.',
    'help.field': '<b>Gravity field</b> — show the potential the stars move in: a rubber sheet ' +
      'pulled into wells, or a heat map with isolines. Stars roll downhill; ⌖ marks the points ' +
      'between them where the pulls cancel out.',
    'help.keys': 'Keyboard shortcuts',
    'key.space': 'Space',
    'key.pause': 'Pause / play',
    'key.restart': 'Restart',
    'key.shuffle': 'Shuffle masses',
    'key.sound': 'Sound on / off',
    'key.field': 'Gravity field: off / sheet / heat map',
    'key.speed': 'Faster / slower time',
    'key.presets': 'Choose a start, in list order',
    'key.help': 'Show / hide this help',
    'key.close': 'Close help',
  },

  uk: {
    'doc.title': 'Задача трьох тіл',
    'title': 'Задача трьох тіл',
    'stat.time': 'Минуло часу · роки',
    'stat.speeds': 'Швидкості · маси зірок',
    'unit.kms': 'км/с',
    'lang.title': 'Мова',

    'start': 'Старт',
    'preset.title': 'Початкова конфігурація (1…9, 0)',
    'preset.chaos': 'Хаос',
    'preset.lagrange': 'Трикутник Лагранжа',
    'preset.euler': 'Пряма Ейлера',
    'preset.figure8': 'Вісімка',
    'preset.butterfly': 'Метелик',
    'preset.moth': 'Міль',
    'preset.goggles': 'Окуляри',
    'preset.dragonfly': 'Бабка',
    'preset.yinyang': 'Інь-ян',
    'preset.hierarchical': 'Пара + далека зірка',
    'group.classical': 'Класичні',
    'group.periodic': 'Періодичні орбіти · рівні маси',
    'group.hierarchical': 'Ієрархічні',
    'note.chaos': 'Випадковий старт · хаос',
    'note.lagrange': 'Лагранж, 1772 · рівносторонній трикутник · нестійкий',
    'note.euler': 'Ейлер, 1767 · зірки на прямій, що обертається · нестійкий',
    'note.figure8': 'Мур 1993, Ченсіне і Монтгомері 2000 · стійка',
    'note.suvakov': 'Шуваков і Дмитрашинович, 2013 · нестійка',
    'note.hierarchical': 'Тісна пара + далека зірка · стійка',

    'masses': 'Маси',
    'mass.title': 'Зміна маси перезапускає симуляцію',
    'shuffle': 'Перемішати маси',
    'shuffle.title': 'Випадкові маси (N)',

    'field': 'Поле тяжіння',
    'field.title': 'Показати гравітаційний потенціал (G)',
    'field.off': 'Вимкнено',
    'field.grid': 'Гумове полотно',
    'field.heat': 'Теплова карта',
    'field.note': '⌖ — точки, де притягання врівноважується',

    'drag.hint': 'Перетягни зірку, щоб перемістити',
    'pause': 'Пауза',
    'play': 'Пуск',
    'pause.title': 'Пауза / пуск (пробіл)',
    'restart': 'Заново',
    'restart.title': 'Нові зірки (R)',
    'sound.on': 'Звук: увімк.',
    'sound.off': 'Звук: вимк.',
    'sound.title': 'Увімкнути / вимкнути звук (M)',
    'speed': 'Швидкість',
    'speed.title': 'Швидкість часу (− / +)',
    'help.button': 'Довідка (?)',
    'settings.button': 'Старт і маси',

    'help.close': 'Закрити (Esc)',
    'help.heading': 'Як це працює',
    'help.intro': 'Три зірки притягують одна одну за законом всесвітнього тяжіння Ньютона. ' +
      'Загальної формули для їхнього руху не існує — крихітні відмінності наростають, доки ' +
      'система не стає хаотичною, і зазвичай одну зірку викидає геть. Тоді починається нова система.',
    'help.start': '<b>Старт</b> — випадковий хаотичний старт або відомий розв\'язок: трикутник ' +
      'Лагранжа, пряма Ейлера, вісімка та інші періодичні орбіти, або стійка пара з далекою ' +
      'зіркою. Більшість розв\'язків нестійкі й розпадаються через кілька періодів.',
    'help.masses': '<b>Маси</b> — задай масу кожної зірки в масах Сонця. Зміна маси ' +
      'перезапускає симуляцію. Орбіти з позначкою «рівні маси» перемикаються на хаос.',
    'help.drag': '<b>Перетягування</b> — постав на паузу, перетягни будь-яку зірку на нове ' +
      'місце й натисни пуск.',
    'help.field': '<b>Поле тяжіння</b> — покажи потенціал, у якому рухаються зірки: гумове ' +
      'полотно з ямами або теплову карту з ізолініями. Зірки «скочуються» вниз; ⌖ позначає ' +
      'точки між ними, де притягання врівноважується.',
    'help.keys': 'Клавіші',
    'key.space': 'Пробіл',
    'key.pause': 'Пауза / пуск',
    'key.restart': 'Заново',
    'key.shuffle': 'Перемішати маси',
    'key.sound': 'Увімкнути / вимкнути звук',
    'key.field': 'Поле тяжіння: вимк. / полотно / карта',
    'key.speed': 'Швидше / повільніше',
    'key.presets': 'Вибрати старт за порядком у списку',
    'key.help': 'Показати / сховати довідку',
    'key.close': 'Закрити довідку',
  },
};

const LANGS = Object.keys(STRINGS);

let lang = (() => {
  const saved = localStorage.getItem('lang');
  if (LANGS.includes(saved)) return saved;
  const browser = (navigator.languages || [navigator.language]).map((l) => l.slice(0, 2));
  return browser.find((l) => LANGS.includes(l)) || 'en';
})();

const t = (key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key;

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t('doc.title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.label = t(el.dataset.i18nLabel);
  for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('active', b.dataset.lang === lang);
  window.dispatchEvent(new Event('langchange'));
}

function setLang(l) {
  lang = l;
  localStorage.setItem('lang', l);
  applyLang();
}

for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => setLang(b.dataset.lang));
}
