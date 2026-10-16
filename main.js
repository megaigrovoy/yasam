import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

/** Совпадает с dependencies в package.json — не @latest, стабильнее кэш CDN */
const MEDIAPIPE_TASKS_VISION_WASM_VER = '0.10.34';

const STORAGE_SFX_OFF = 'neon-ninja-sfx-off';
const STORAGE_MUSIC_OFF = 'neon-ninja-music-off';
/**
 * Язык интерфейса и озвучки. Сейчас записан только русский голос, поэтому
 * язык зафиксирован: сохранённое в localStorage значение намеренно игнорируется,
 * иначе игроки с ранее выбранным 'en' остались бы без переключателя на английском.
 * Английские строки и звуки в коде сохранены — вернуть можно сменой этой константы.
 */
let uiLang = 'ru';

/**
 * numPoses у PoseLandmarker. Режим на двоих сейчас не используется —
 * зафиксировано на одном игроке, это заодно разгружает распознавание.
 */
let playerModeCount = 1;

/** Добавьте ?perf=1 к URL — в консоли раз в ~2.5 с среднее время кадра (поиск фризов на проде) */
const DEBUG_FRAME_PERF =
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';

/** Профиль трекинга: Android — CPU-делегат, интерполяция 30→120 Гц, мягче пороги (см. mobile-tracking-fix.md) */
function detectTrackTuning() {
    const ua = navigator.userAgent || '';
    const android = /Android/i.test(ua);
    const iphone = /iPhone|iPod/i.test(ua);
    const mobile =
        android ||
        iphone ||
        (navigator.maxTouchPoints > 0 &&
            Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) < 820);
    return {
        android,
        mobile,
        /** Интерполяция display-landmarks между кадрами камеры на высокочастотных экранах */
        interpolatePose: android || iphone
    };
}
const trackTuning = detectTrackTuning();

/** Звуки резов */
let soundEffectsEnabled = true;
/** Фоновая музыка в меню и в игре */
let musicEnabled = true;

function loadPersistedSettings() {
    soundEffectsEnabled = localStorage.getItem(STORAGE_SFX_OFF) !== '1';
    musicEnabled = localStorage.getItem(STORAGE_MUSIC_OFF) !== '1';
    const sfxCb = document.getElementById('opt-sound-off');
    const musicCb = document.getElementById('opt-music-off');
    if (sfxCb) sfxCb.checked = !soundEffectsEnabled;
    if (musicCb) musicCb.checked = !musicEnabled;
}

/** URL звука разреза на каждый эмодзи (6 файлов на 10 типов — часть клипов переиспользуется). */
const sliceSoundUrlByEmoji = {
    '🍌': new URL('./src/assets/sounds/Sound Of Fruit Slice.mp3', import.meta.url).href,
    '🍎': new URL('./src/assets/sounds/Sound Of Fruit Slice 2.mp3', import.meta.url).href,
    '🍉': new URL('./src/assets/sounds/Sound Of Fruit Slice 3.mp3', import.meta.url).href,
    '🍊': new URL('./src/assets/sounds/Sound Of Fruit Slice 4.mp3', import.meta.url).href,
    '🍗': new URL('./src/assets/sounds/Sound Of Meat Slice.mp3', import.meta.url).href,
    '🥩': new URL('./src/assets/sounds/Sound Of Meat Slice2.mp3', import.meta.url).href,
    '🥦': new URL('./src/assets/sounds/Sound Of Fruit Slice 2.mp3', import.meta.url).href,
    '🥬': new URL('./src/assets/sounds/Sound Of Fruit Slice.mp3', import.meta.url).href,
    '🍆': new URL('./src/assets/sounds/Sound Of Fruit Slice 3.mp3', import.meta.url).href,
    '🍅': new URL('./src/assets/sounds/Sound Of Fruit Slice 3.mp3', import.meta.url).href
};

const SLICE_SFX_FALLBACK_POOL = [...new Set(Object.values(sliceSoundUrlByEmoji))].filter(Boolean);
let sliceSfxRot = 0;

function playSliceSoundForTarget(fruit) {
    if (fruit.levelMode === 'fruit' && fruit.emoji && sliceSoundUrlByEmoji[fruit.emoji]) {
        playSliceSound(fruit.emoji);
        return;
    }
    if (!SLICE_SFX_FALLBACK_POOL.length) return;
    const url = SLICE_SFX_FALLBACK_POOL[sliceSfxRot++ % SLICE_SFX_FALLBACK_POOL.length];
    playOneShotSfx(url, 0.88);
}

function playSliceSound(emoji) {
    if (!soundEffectsEnabled) return;
    playOneShotSfx(sliceSoundUrlByEmoji[emoji], 0.88);
}

/** Голос при вылете продукта: ru — stuff/*.MP3; en — «stuff en»/*.MP3 (см. стемы и fallback ниже) */
const spawnVoiceUrlByEmoji = {
    '🍌': new URL('./src/assets/sounds/stuff/banana.MP3', import.meta.url).href,
    '🍎': new URL('./src/assets/sounds/stuff/apple.MP3', import.meta.url).href,
    '🍉': new URL('./src/assets/sounds/stuff/watermelon.MP3', import.meta.url).href,
    '🍊': new URL('./src/assets/sounds/stuff/orange.MP3', import.meta.url).href,
    '🍗': new URL('./src/assets/sounds/stuff/chicken.MP3', import.meta.url).href,
    '🥩': new URL('./src/assets/sounds/stuff/meat.MP3', import.meta.url).href,
    '🥦': new URL('./src/assets/sounds/stuff/broccoli.MP3', import.meta.url).href,
    '🥬': new URL('./src/assets/sounds/stuff/cabbage.MP3', import.meta.url).href,
    '🍆': new URL('./src/assets/sounds/stuff/eggplant.MP3', import.meta.url).href,
    '🍅': new URL('./src/assets/sounds/stuff/tomat.MP3', import.meta.url).href
};

/** Совпадает с именами в stuff/*.MP3 — для «stuff en» подбирается файл по стему / fallback */
const SPAWN_VOICE_STEM_BY_EMOJI = {
    '🍌': 'banana',
    '🍎': 'apple',
    '🍉': 'watermelon',
    '🍊': 'orange',
    '🍗': 'chicken',
    '🥩': 'meat',
    '🥦': 'broccoli',
    '🥬': 'cabbage',
    '🍆': 'eggplant',
    '🍅': 'tomat'
};

/** Если в «stuff en» другое имя файла (tomato вместо tomat, steak вместо meat) */
const SPAWN_VOICE_EN_STEM_FALLBACK = {
    tomat: 'tomato',
    meat: 'steak'
};

const enSpawnVoiceUrlByStem = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/stuff en/*.MP3', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => {
        const file = path.replace(/^.*\//, '').replace(/\.MP3$/i, '');
        return [file.toLowerCase(), href];
    })
);

function spawnVoiceUrlResolve(emoji) {
    const ruUrl = spawnVoiceUrlByEmoji[emoji];
    if (uiLang !== 'en') return ruUrl;
    const stem = SPAWN_VOICE_STEM_BY_EMOJI[emoji];
    if (!stem) return ruUrl;
    const low = stem.toLowerCase();
    let url = enSpawnVoiceUrlByStem[low];
    if (!url) {
        const alt = SPAWN_VOICE_EN_STEM_FALLBACK[low];
        if (alt) url = enSpawnVoiceUrlByStem[alt.toLowerCase()];
    }
    return url || ruUrl;
}

/** Имя файла = строчная кириллица (а.MP3 … я.MP3); ключ — lowercase для lookup с буквы алфавита UI */
const ruLetterSpawnUrlByLower = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/letters/ru/*.MP3', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => {
        const file = path.replace(/^.*\//, '').replace(/\.MP3$/i, '');
        return [file.toLowerCase(), href];
    })
);

/** Латиница a.MP3 … z.MP3 для английского UI */
const enLetterSpawnUrlByLower = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/letters/en/*.MP3', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => {
        const file = path.replace(/^.*\//, '').replace(/\.MP3$/i, '');
        return [file.toLowerCase(), href];
    })
);

/** Имя файла = число 1 … 10 (.MP3); ключ строкой для совпадения с label */
const ruNumberSpawnUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/numbers/ru/*.MP3', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => {
        const file = path.replace(/^.*\//, '').replace(/\.MP3$/i, '');
        return [file, href];
    })
);

const enNumberSpawnUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/numbers/en/*.MP3', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => {
        const file = path.replace(/^.*\//, '').replace(/\.MP3$/i, '');
        return [file, href];
    })
);

/** Числовые уровни: по кругу только 1 … NUMBER_SPAWN_CYCLE_MAX (озвучка — sounds/numbers/ru|en) */
const NUMBER_SPAWN_CYCLE_MAX = 10;

/**
 * Похвала за серию (комбо) — случайная фраза текущего языка.
 * Папки sounds/praise/ru|en; файлы можно называть как угодно — проигрывается случайный.
 */
const ruPraiseUrls = Object.values(
    import.meta.glob('./src/assets/sounds/praise/ru/*.MP3', { eager: true, query: '?url', import: 'default' })
);
const enPraiseUrls = Object.values(
    import.meta.glob('./src/assets/sounds/praise/en/*.MP3', { eager: true, query: '?url', import: 'default' })
);

/** Подсказка при появлении доски — sounds/board/ru|en: hand.MP3 («Бей!»/«Рукой!»), foot.MP3 («Ногой!») */
const ruBoardHintUrlByStem = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/board/ru/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.MP3$/i, '').toLowerCase(), href])
);
const enBoardHintUrlByStem = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/board/en/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.MP3$/i, '').toLowerCase(), href])
);

/**
 * Озвучка задания в режиме сравнения — sounds/tasks/ru|en.
 * Имя файла = ключ задания: bigger, smaller, circle, square, triangle, star,
 * prefix_letter, prefix_number (+ задел longer/shorter/taller/thicker/thinner).
 */
const ruTaskUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/tasks/ru/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.mp3$/i, '').toLowerCase(), href])
);
const enTaskUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/tasks/en/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.mp3$/i, '').toLowerCase(), href])
);

/** Спрайты предметов сравнения — images/objects/pencil_long.webp и т. п. */
const objectSpriteUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/images/objects/*.{webp,png,WEBP,PNG}', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase(), href])
);

/** Задания на буквы и цифры — tasks/ru/letters/а.mp3, tasks/ru/numbers/3.mp3 */
const ruLetterTaskUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/tasks/ru/letters/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.mp3$/i, '').toLowerCase(), href])
);
const ruNumberTaskUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/tasks/ru/numbers/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.mp3$/i, '').toLowerCase(), href])
);

/** Режим счёта — tasks/ru/counting: intro_<вид>, count_1..10 (счёт вслух), total_1..10 (итог) */
const ruCountingUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/tasks/ru/counting/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.mp3$/i, '').toLowerCase(), href])
);

/** Обратная связь — sounds/feedback/ru|en: error.mp3 + praise_1..N.mp3 (случайная похвала) */
const ruFeedbackUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/feedback/ru/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.mp3$/i, '').toLowerCase(), href])
);
const enFeedbackUrlByKey = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/feedback/en/*.{mp3,MP3}', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.mp3$/i, '').toLowerCase(), href])
);

/** Фанфары/«ты победил» на экране победы — sounds/win/ru|en (любые имена, случайный) */
const ruWinUrls = Object.values(
    import.meta.glob('./src/assets/sounds/win/ru/*.MP3', { eager: true, query: '?url', import: 'default' })
);
const enWinUrls = Object.values(
    import.meta.glob('./src/assets/sounds/win/en/*.MP3', { eager: true, query: '?url', import: 'default' })
);

/** Озвучка слова целиком (режим слов) — имя файла = слово: кот.MP3 / cat.MP3 (sounds/words/ru|en) */
const ruWordUrlByText = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/words/ru/*.MP3', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.MP3$/i, '').toLowerCase(), href])
);
const enWordUrlByText = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/sounds/words/en/*.MP3', { eager: true, query: '?url', import: 'default' })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.MP3$/i, '').toLowerCase(), href])
);

/** Картинка слова (режим слов) — имя файла = слово: кот.png / cat.png (images/words/ru|en, png|jpg|jpeg|webp) */
const ruWordImageByText = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/images/words/ru/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase(), href])
);
const enWordImageByText = Object.fromEntries(
    Object.entries(
        import.meta.glob('./src/assets/images/words/en/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}', {
            eager: true,
            query: '?url',
            import: 'default'
        })
    ).map(([path, href]) => [path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase(), href])
);

function wordImageUrl(word) {
    if (!word) return null;
    const map = uiLang === 'en' ? enWordImageByText : ruWordImageByText;
    return map[String(word).toLowerCase()] || null;
}

/** Прогрев картинок слов текущего языка — чтобы первый показ был без задержки */
function preloadWordImages() {
    const map = uiLang === 'en' ? enWordImageByText : ruWordImageByText;
    for (const u of Object.values(map)) {
        const im = new Image();
        im.src = u;
    }
}

function pickRandomUrl(arr) {
    return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
}

/** Голосовая похвала на серию — рандом из набора текущего языка */
function playPraiseSound() {
    if (!soundEffectsEnabled) return;
    const u = pickRandomUrl(uiLang === 'en' ? enPraiseUrls : ruPraiseUrls);
    if (u) playOneShotSfx(u, 1.0);
}

/** «Бей!» / «Ногой!» при появлении доски в соответствующей зоне */
function playBoardHintSound(strikeKind) {
    if (!soundEffectsEnabled) return;
    const map = uiLang === 'en' ? enBoardHintUrlByStem : ruBoardHintUrlByStem;
    const u = map[strikeKind] || map[strikeKind === 'hand' ? 'hit' : 'kick'];
    if (u) playOneShotSfx(u, 1.0);
}

/** Фанфары на экране победы */
function playWinSound() {
    if (!soundEffectsEnabled) return;
    const u = pickRandomUrl(uiLang === 'en' ? enWinUrls : ruWinUrls);
    if (u) playOneShotSfx(u, 1.0);
}

/** Озвучка собранного слова целиком */
function playWordSound(word) {
    if (!soundEffectsEnabled || !word) return;
    const map = uiLang === 'en' ? enWordUrlByText : ruWordUrlByText;
    const u = map[String(word).toLowerCase()];
    if (u) playOneShotSfx(u, 1.0);
}

/**
 * Фразы-плейсхолдеры для speechSynthesis — работают, пока нет записанной озвучки.
 * Как только файл tasks/<lang>/<key>.mp3 появится, он имеет приоритет.
 */
const TASK_SPEECH_FALLBACK = {
    ru: {
        /** Фоллбэк для новых объектов, пока нет записи — род согласован вручную */
        longer_pencil: 'Покажи длинный карандаш',
        shorter_pencil: 'Покажи короткий карандаш',
        longer_rope: 'Покажи длинную верёвку',
        shorter_rope: 'Покажи короткую верёвку',
        longer_bolt: 'Покажи длинный болт',
        shorter_bolt: 'Покажи короткий болт',
        longer_sock: 'Покажи длинный носок',
        shorter_sock: 'Покажи короткий носок',
        thicker_pencil: 'Покажи толстый карандаш',
        thinner_pencil: 'Покажи тонкий карандаш',
        thicker_rope: 'Покажи толстую верёвку',
        thinner_rope: 'Покажи тонкую верёвку',
        thicker_log: 'Покажи толстое бревно',
        thinner_log: 'Покажи тонкое бревно',
        thicker_candle: 'Покажи толстую свечу',
        thinner_candle: 'Покажи тонкую свечу',
        taller_tree: 'Покажи высокую ёлку',
        lower_tree: 'Покажи низкую ёлку',
        taller_house: 'Покажи высокий дом',
        lower_house: 'Покажи низкий дом',
        taller_castle: 'Покажи высокий замок',
        lower_castle: 'Покажи низкий замок',
        bigger: 'Покажи большой',
        smaller: 'Покажи маленький',
        circle: 'Покажи круг',
        square: 'Покажи квадрат',
        triangle: 'Покажи треугольник',
        star: 'Покажи звезду'
    },
    en: {
        bigger: 'Show the big one',
        smaller: 'Show the small one',
        circle: 'Show the circle',
        square: 'Show the square',
        triangle: 'Show the triangle',
        star: 'Show the star'
    }
};

/** Медленная речь — темп важнее выразительности для целевой аудитории */
function speakFallback(text) {
    if (!text || typeof speechSynthesis === 'undefined') return;
    try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = uiLang === 'en' ? 'en-US' : 'ru-RU';
        u.rate = 0.85;
        speechSynthesis.speak(u);
    } catch {
        /* синтез речи недоступен — молча пропускаем */
    }
}

/** Озвучка задания «разрежь X» — файл из tasks/, иначе синтез речи */
/**
 * Озвучка задания. Для свойств («большой», «маленький») ищем фразу, согласованную
 * с объектом — bigger_circle, bigger_star: в русском прилагательное меняет род,
 * поэтому склеить «большой» + название нельзя, фраза записана целиком.
 */
function playTaskSound(taskKey, objectKey, taskKind) {
    if (!soundEffectsEnabled || !taskKey) return;
    if (taskKind === 'letter' || taskKind === 'number') {
        const glyphMap = taskKind === 'letter' ? ruLetterTaskUrlByKey : ruNumberTaskUrlByKey;
        const glyphUrl = glyphMap[String(taskKey).toLowerCase()];
        if (glyphUrl) playOneShotSfx(glyphUrl, 1.0);
        return;
    }
    const map = uiLang === 'en' ? enTaskUrlByKey : ruTaskUrlByKey;
    const key = String(taskKey).toLowerCase();
    const url = (objectKey && map[`${key}_${String(objectKey).toLowerCase()}`]) || map[key];
    if (url) {
        playOneShotSfx(url, 1.0);
        return;
    }
    const fb = TASK_SPEECH_FALLBACK[uiLang] || TASK_SPEECH_FALLBACK.ru;
    /** Сначала фраза под конкретный объект, иначе общая — род может не совпасть, но смысл сохранится */
    speakFallback((objectKey && fb[`${key}_${String(objectKey).toLowerCase()}`]) || fb[taskKey]);
}

/** Озвучка режима счёта: intro_<вид>, count_N, total_N */
function playCountingSound(key) {
    if (!soundEffectsEnabled || !key) return;
    const url = ruCountingUrlByKey[String(key).toLowerCase()];
    if (url) playOneShotSfx(url, 1.0);
}

/** Мягкий сигнал ошибки — не должен пугать ребёнка */
function playErrorSound() {
    if (!soundEffectsEnabled) return;
    const map = uiLang === 'en' ? enFeedbackUrlByKey : ruFeedbackUrlByKey;
    const url = map.error;
    if (url) {
        playOneShotSfx(url, 0.85);
        return;
    }
    playSynthErrorBeep();
}

/** Запасной сигнал ошибки: тихий двухнотный спуск через WebAudio, если нет error.mp3 */
function playSynthErrorBeep() {
    const ctx = getOrCreateSfxContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
}

/** Похвала за верный рез — feedback/praise_*.mp3, иначе существующий praise/ */
function playComparePraiseSound() {
    if (!soundEffectsEnabled) return;
    const map = uiLang === 'en' ? enFeedbackUrlByKey : ruFeedbackUrlByKey;
    const praise = Object.entries(map)
        .filter(([key]) => key.startsWith('praise'))
        .map(([, href]) => href);
    const url = pickRandomUrl(praise);
    if (url) {
        playOneShotSfx(url, 1.0);
        return;
    }
    playPraiseSound();
}

function playSpawnVoice(emoji) {
    if (!soundEffectsEnabled) return;
    const url = spawnVoiceUrlResolve(emoji);
    if (!url) return;
    playOneShotSfx(url, 0.95);
}

/** Озвучка буквы при появлении — ru/en по языку UI (папки sounds/letters/ru|en) */
function playLetterSpawnSound(char) {
    if (!soundEffectsEnabled || !char) return;
    const key = char.toLowerCase();
    const url =
        uiLang === 'ru' ? ruLetterSpawnUrlByLower[key] : uiLang === 'en' ? enLetterSpawnUrlByLower[key] : null;
    if (!url) return;
    playOneShotSfx(url, 0.95);
}

/** Озвучка цифры при появлении — ru/en (файлы 1.MP3 … 10.MP3) */
function playNumberSpawnSound(n) {
    if (!soundEffectsEnabled || !Number.isFinite(n)) return;
    const key = String(Math.floor(n));
    const url =
        uiLang === 'ru' ? ruNumberSpawnUrlByKey[key] : uiLang === 'en' ? enNumberSpawnUrlByKey[key] : null;
    if (!url) return;
    playOneShotSfx(url, 0.95);
}

const MENU_MUSIC_URL = new URL('./src/assets/sounds/menu.mp3', import.meta.url).href;
/** Фоновые треки в игре — все .mp3 из src/assets/sounds/OST */
const GAME_BG_TRACKS = Object.values(
    import.meta.glob('./src/assets/sounds/OST/*.mp3', { eager: true, query: '?url', import: 'default' })
);

/** Декодированные буферы для SFX: на iPad/WebKit второй HTMLAudio часто молчит, пока играет музыка */
const sfxAudioBufferByUrl = new Map();
const sfxAudioBufferPromiseByUrl = new Map();

function getOrCreateSfxContext() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!window.__ninjaAudioCtx) window.__ninjaAudioCtx = new AC();
        return window.__ninjaAudioCtx;
    } catch (_) {
        return null;
    }
}

function ensureSfxAudioBuffer(ctx, url) {
    if (!url || !ctx) return Promise.reject(new Error('no ctx/url'));
    const hit = sfxAudioBufferByUrl.get(url);
    if (hit) return Promise.resolve(hit);
    const inflight = sfxAudioBufferPromiseByUrl.get(url);
    if (inflight) return inflight;
    const p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => {
            sfxAudioBufferByUrl.set(url, buf);
            sfxAudioBufferPromiseByUrl.delete(url);
            return buf;
        })
        .catch((e) => {
            sfxAudioBufferPromiseByUrl.delete(url);
            throw e;
        });
    sfxAudioBufferPromiseByUrl.set(url, p);
    return p;
}

function playDecodedSfx(ctx, buffer, volume) {
    if (ctx.state === 'suspended') void ctx.resume();
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(0);
}

function playOneShotSfx(url, volume) {
    if (!soundEffectsEnabled || !url) return;
    const ctx = window.__ninjaAudioCtx || getOrCreateSfxContext();
    const ready = ctx && sfxAudioBufferByUrl.get(url);
    if (ctx && ready) {
        try {
            playDecodedSfx(ctx, ready, volume);
        } catch (_) {
            fallbackHtmlOneShot(url, volume);
        }
        return;
    }
    if (ctx) {
        void ensureSfxAudioBuffer(ctx, url)
            .then((buf) => {
                if (!soundEffectsEnabled) return;
                try {
                    playDecodedSfx(ctx, buf, volume);
                } catch (_) {
                    fallbackHtmlOneShot(url, volume);
                }
            })
            .catch(() => fallbackHtmlOneShot(url, volume));
        return;
    }
    fallbackHtmlOneShot(url, volume);
}

function fallbackHtmlOneShot(url, volume) {
    const a = new Audio(url);
    a.volume = volume;
    void a.play().catch(() => {});
}

/**
 * На проде (CDN, холодный кэш) одновременная подгрузка всех OST + параллельный decodeAudioData для SFX
 * даёт рывки главного потока; локально кэш/диск маскирует это.
 */
function preloadHtmlAudioUrl(url) {
    if (!url) return;
    const a = new Audio();
    a.preload = 'auto';
    a.src = url;
    void a.load();
}

function scheduleStaggeredOstPreload() {
    const tracks = GAME_BG_TRACKS.filter(Boolean);
    if (!tracks.length) return;
    let i = 0;
    const step = () => {
        if (i >= tracks.length) return;
        preloadHtmlAudioUrl(tracks[i++]);
        setTimeout(step, 120);
    };
    const kick = () => step();
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(kick, { timeout: 1800 });
    } else {
        setTimeout(kick, 400);
    }
}

/**
 * Декодирует набор URL в буферы параллельно с ограничением «в полёте».
 * Параллель (вместо строго серийного 16 мс) на iPad готовит озвучку в разы быстрее,
 * а лимит concurrency не даёт decodeAudioData «забить» главный поток.
 * ensureSfxAudioBuffer дедуплицирует — повторные вызовы по тем же URL дешёвые.
 */
function warmSfxBuffers(urls, concurrency = 6) {
    const ctx = getOrCreateSfxContext();
    if (!ctx) return Promise.resolve();
    const queue = [...new Set(urls)].filter((u) => u && !sfxAudioBufferByUrl.has(u));
    if (!queue.length) return Promise.resolve();
    let idx = 0;
    const worker = async () => {
        while (idx < queue.length) {
            const u = queue[idx++];
            try {
                await ensureSfxAudioBuffer(ctx, u);
            } catch (_) {}
        }
    };
    const n = Math.max(1, Math.min(concurrency, queue.length));
    return Promise.all(Array.from({ length: n }, () => worker()));
}

/** Звуки, нужные конкретному уровню в текущем языке (срезы + озвучка режима) — для приоритетного прогрева */
function currentLevelSfxUrls(cfg) {
    const urls = [...SLICE_SFX_FALLBACK_POOL];
    /** Похвала и фанфары нужны в любом режиме */
    urls.push(...(uiLang === 'en' ? enPraiseUrls : ruPraiseUrls));
    urls.push(...(uiLang === 'en' ? enWinUrls : ruWinUrls));
    if (cfg?.mode === 'fruit') {
        for (const e of Object.keys(spawnVoiceUrlByEmoji)) {
            urls.push(spawnVoiceUrlResolve(e));
        }
    } else if (cfg?.mode === 'letter') {
        const map = uiLang === 'en' ? enLetterSpawnUrlByLower : ruLetterSpawnUrlByLower;
        urls.push(...Object.values(map));
    } else if (cfg?.mode === 'number') {
        const map = uiLang === 'en' ? enNumberSpawnUrlByKey : ruNumberSpawnUrlByKey;
        urls.push(...Object.values(map));
    } else if (cfg?.mode === 'word') {
        const letters = uiLang === 'en' ? enLetterSpawnUrlByLower : ruLetterSpawnUrlByLower;
        urls.push(...Object.values(letters));
        urls.push(...Object.values(uiLang === 'en' ? enWordUrlByText : ruWordUrlByText));
    } else if (cfg?.mode === 'board') {
        urls.push(...Object.values(uiLang === 'en' ? enBoardHintUrlByStem : ruBoardHintUrlByStem));
    }
    return urls.filter(Boolean);
}

/** Все sfx, но с текущим языком первым — фоновой прогрев на загрузке */
function allSfxUrlsCurrentLangFirst() {
    const curLang =
        uiLang === 'en'
            ? [
                  ...Object.values(enLetterSpawnUrlByLower),
                  ...Object.values(enNumberSpawnUrlByKey),
                  ...Object.values(enSpawnVoiceUrlByStem)
              ]
            : [
                  ...Object.values(ruLetterSpawnUrlByLower),
                  ...Object.values(ruNumberSpawnUrlByKey),
                  ...Object.values(spawnVoiceUrlByEmoji)
              ];
    const praiseWin = [...ruPraiseUrls, ...enPraiseUrls, ...ruWinUrls, ...enWinUrls];
    const rest = [
        ...Object.values(spawnVoiceUrlByEmoji),
        ...Object.values(enSpawnVoiceUrlByStem),
        ...Object.values(ruLetterSpawnUrlByLower),
        ...Object.values(enLetterSpawnUrlByLower),
        ...Object.values(ruNumberSpawnUrlByKey),
        ...Object.values(enNumberSpawnUrlByKey),
        ...Object.values(ruWordUrlByText),
        ...Object.values(enWordUrlByText)
    ];
    return [...new Set([...SLICE_SFX_FALLBACK_POOL, ...praiseWin, ...curLang, ...rest])].filter(Boolean);
}

function warmSfxAudioBuffersYielding() {
    /** Срезы и звуки текущего языка — первыми; общий список идёт скромной параллелью, чтобы не дёргать загрузку */
    void warmSfxBuffers(allSfxUrlsCurrentLangFirst(), 4);
}

/** Ранняя загрузка/декод mp3 — иначе первый рез/озвучка на проде ждёт сеть/декодер */
function preloadGameAudio() {
    if (soundEffectsEnabled) {
        /** Декодируем сразу в буферы (fetch внутри ensureSfxAudioBuffer прогреет и HTTP-кэш).
         *  Сотни new Audio() на iOS не плодим — там лимит на медиа-элементы. */
        warmSfxAudioBuffersYielding();
    }
    if (musicEnabled) {
        preloadHtmlAudioUrl(MENU_MUSIC_URL);
        scheduleStaggeredOstPreload();
    }
}

/** База WASM с того же origin, что и страница (npm run prepare:wasm → public/mediapipe-wasm) */
function getMediapipeWasmUrl() {
    let base = import.meta.env.BASE_URL || '/';
    if (!base.endsWith('/')) base += '/';
    return new URL('mediapipe-wasm', window.location.origin + base).href;
}

/**
 * iOS / iPad Chrome (WebKit): нужен реальный play() по жесту; data:-WAV часто молчит.
 * Цепочка mp3 с того же origin + сброс AudioContext.
 */
let htmlAudioUnlocked = false;
let audioUnlockBusy = false;

function resumeSharedAudioContext() {
    const ctx = getOrCreateSfxContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function tryUnlockAudioOnUserGesture() {
    if (htmlAudioUnlocked || audioUnlockBusy) return;
    audioUnlockBusy = true;
    resumeSharedAudioContext();

    const srcs = [sliceSoundUrlByEmoji['🍌'], sliceSoundUrlByEmoji['🍎'], MENU_MUSIC_URL];

    const playSrcAt = (i) => {
        if (i >= srcs.length) return Promise.reject(new Error('no unlock src'));
        const a = new Audio();
        a.preload = 'auto';
        a.src = srcs[i];
        a.volume = 0.04;
        try {
            a.load();
        } catch (_) {}
        return a
            .play()
            .then(() => {
                try {
                    a.pause();
                    a.src = '';
                } catch (_) {}
            })
            .catch(() => playSrcAt(i + 1));
    };

    const busyTimer = setTimeout(() => {
        audioUnlockBusy = false;
    }, 3000);
    void playSrcAt(0)
        .then(() => {
            htmlAudioUnlocked = true;
        })
        .catch(() => {})
        .finally(() => {
            clearTimeout(busyTimer);
            audioUnlockBusy = false;
        });
}

let menuMusicAudio = null;
let gameMusicAudio = null;
let gameMusicOnEnded = null;
/** Перемешанный порядок OST на сессию игры */
let gameMusicPlaylist = [];
let gameMusicPlaylistIndex = 0;

function shuffleArrayInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function getMenuMusicAudio() {
    if (!menuMusicAudio) {
        menuMusicAudio = new Audio(MENU_MUSIC_URL);
        menuMusicAudio.loop = true;
        menuMusicAudio.volume = 0.52;
    }
    return menuMusicAudio;
}

function playMenuMusic() {
    if (!musicEnabled) return;
    void getMenuMusicAudio().play().catch(() => {});
}

function pauseMenuMusic() {
    if (menuMusicAudio) {
        menuMusicAudio.pause();
        menuMusicAudio.currentTime = 0;
    }
}

function stopGameMusic() {
    if (gameMusicAudio && gameMusicOnEnded) {
        gameMusicAudio.removeEventListener('ended', gameMusicOnEnded);
    }
    if (gameMusicAudio) {
        gameMusicAudio.pause();
        gameMusicAudio = null;
    }
    gameMusicOnEnded = null;
}

function playGameMusicTrackAt(index) {
    if (!musicEnabled) {
        stopGameMusic();
        return;
    }
    stopGameMusic();
    if (!gameMusicPlaylist.length) return;
    gameMusicPlaylistIndex = ((index % gameMusicPlaylist.length) + gameMusicPlaylist.length) % gameMusicPlaylist.length;
    const url = gameMusicPlaylist[gameMusicPlaylistIndex];
    const a = new Audio(url);
    a.volume = 0.46;
    gameMusicOnEnded = () => {
        gameMusicPlaylistIndex = (gameMusicPlaylistIndex + 1) % gameMusicPlaylist.length;
        playGameMusicTrackAt(gameMusicPlaylistIndex);
    };
    a.addEventListener('ended', gameMusicOnEnded);
    gameMusicAudio = a;
    void a.play().catch(() => {});
}

function startGameMusicPlaylist() {
    pauseMenuMusic();
    if (!musicEnabled || !GAME_BG_TRACKS.length) return;
    gameMusicPlaylist = [...GAME_BG_TRACKS];
    shuffleArrayInPlace(gameMusicPlaylist);
    gameMusicPlaylistIndex = 0;
    playGameMusicTrackAt(0);
}

const video = document.getElementById('webcam');
const canvasElement = document.getElementById('game-canvas');
const canvasCtx = canvasElement.getContext('2d');
const scoreDisplay = document.getElementById('score-display');
const loadingElement = document.getElementById('loading');
const mainMenu = document.getElementById('main-menu');
const levelGrid = document.getElementById('level-grid');
const hudGame = document.getElementById('hud-game');
const levelDisplay = document.getElementById('level-display');
const btnBackMenu = document.getElementById('btn-back-menu');
const comboDisplay = document.getElementById('combo-display');
const wordProgressEl = document.getElementById('word-progress');
const wordRevealEl = document.getElementById('word-reveal');
const wordRevealImg = document.getElementById('word-reveal-img');
const wordRevealEmoji = document.getElementById('word-reveal-emoji');
const wordRevealText = document.getElementById('word-reveal-text');
const winOverlay = document.getElementById('win-overlay');
const winStarsEl = document.getElementById('win-stars');
const winTitleEl = document.getElementById('win-title');
const winScoreEl = document.getElementById('win-score');
const btnWinNext = document.getElementById('btn-win-next');
const btnWinMenu = document.getElementById('btn-win-menu');
const winAutoTimerEl = document.getElementById('win-auto-timer');
const winAutoRingEl = document.getElementById('win-auto-ring-progress');
const winAutoCountdownEl = document.getElementById('win-auto-countdown');
const winAutoHintEl = document.getElementById('win-auto-hint');

let poseLandmarker;
let visionTasksResolver = null;
let mediapipePoseDelegate = 'CPU';
let currentPoseResults = null;
let lastVideoTime = -1;
/** Монотонный timestamp для detectForVideo (Android иногда откатывает video.currentTime) */
let lastDetectTsMs = -1;
/** Интерполяция display-landmarks между кадрами камеры (~30 fps → 120 Hz rAF) */
const posePrevTargetByKey = new Map();
const poseTargetByKey = new Map();
const poseDisplayByKey = new Map();
const displayPersonOrder = [];
let poseFrameTsPrev = -1;
let poseFrameTsCurr = -1;
let poseFrameIntervalMs = 33.33;
/** performance.now() в момент последнего commitPoseTargetsFromFrame — для lerp между кадрами камеры */
let poseFrameCommitPerfMs = 0;
let score = 0;
let fruits = [];
/** Статичные доски-мишени (режим board): разбиваются ударом руки или ноги */
let boards = [];
/** Чередование зон: высоко (рука) ↔ низко (нога) — предсказуемо для детей */
let nextBoardStrikeKind = 'hand';
/** Предыдущие экранные точки стоп/лодыжек по ключу `${personKey}:${lmIdx}` — для сегментов удара ногой */
let prevFootPointByKey = new Map();
let particles = [];
let isPlaying = false;

/** Серия (комбо): растёт за каждый успешный рез, обнуляется на промах */
let comboStreak = 0;
let comboBest = 0;
/** Прогресс уровня и точность для звёзд */
let levelGoodHits = 0;
let levelBadEvents = 0;
let levelComplete = false;
/** Всплывающие надписи («Серия x3», «Молодец!») и кратковременная вспышка экрана */
let floatingTexts = [];
let screenFlash = 0;
/** Салют на экране победы */
let winBurstTimer = 0;

/** Очко за каждый множитель серии (растёт по мере серии) */
function comboMultiplier() {
    return Math.min(5, 1 + Math.floor(comboStreak / 5));
}

/** Детские слова по языку UI (3–4 буквы). Имя звукового файла = слово в нижнем регистре. */
const WORD_LIST_RU = [
    'КОТ', 'ДОМ', 'МАМА', 'СОК', 'МЯЧ', 'СЫР',
    'ПАПА', 'ЛИСА', 'РЫБА', 'СОВА', 'ГРИБ', 'ШАР',
    'ЛЕВ', 'ТИГР', 'ВОЛК', 'ЗАЯЦ', 'УТКА', 'СЛОН',
    'КИТ', 'ЗМЕЯ', 'ПЧЕЛА', 'КОЗА', 'ОВЦА', 'КРАБ',
    'АКУЛА', 'ЛУНА', 'ВОДА', 'СНЕГ', 'РОЗА', 'ЛИМОН',
    'БАНАН', 'АРБУЗ', 'ТОРТ', 'ХЛЕБ', 'ПИЦЦА', 'МАШИНА',
    'ПОЕЗД', 'ЛОДКА', 'РАКЕТА', 'КЛЮЧ', 'КНИГА', 'ЦВЕТОК',
    'ПАУК', 'МЫШЬ', 'СОБАКА', 'ПТИЦА', 'КОРОВА', 'МЕДВЕДЬ',
    'ЛОШАДЬ', 'КУРИЦА', 'НОС', 'РОТ', 'ГЛАЗ', 'УХО',
    'РУКА', 'НОГА', 'СОЛНЦЕ', 'ДОЖДЬ', 'ОБЛАКО', 'ЗВЕЗДА',
    'ОГОНЬ', 'РАДУГА', 'СТУЛ', 'ОКНО', 'САМОЛЁТ', 'ЗОНТ',
    'МОЛОКО', 'ЯЙЦО', 'МЁД', 'МОРЕ', 'РЕКА', 'ЗАМОК',
    'МОСТ', 'ДЕРЕВО', 'ЯБЛОКО', 'ГРУША', 'МОРКОВЬ', 'СУП',
    'САХАР', 'ЧАШКА', 'ТАРЕЛКА', 'ЛОЖКА', 'ВИЛКА', 'НОЖ'
];
const WORD_LIST_EN = [
    'CAT', 'DOG', 'SUN', 'MOM', 'CUP', 'BED',
    'PIG', 'COW', 'BUS', 'HAT', 'FOX', 'FISH',
    'LION', 'TIGER', 'WOLF', 'BEAR', 'DUCK', 'FROG',
    'BEE', 'ANT', 'OWL', 'HEN', 'GOAT', 'LAMB',
    'CRAB', 'WHALE', 'SNAKE', 'STAR', 'MOON', 'RAIN',
    'SNOW', 'TREE', 'ROSE', 'APPLE', 'BANANA', 'LEMON',
    'CAKE', 'PIZZA', 'CAR', 'BOAT', 'KEY', 'BOOK',
    'MOUSE', 'HORSE', 'CHICK', 'SPIDER', 'EAGLE', 'DEER',
    'CLOUD', 'FIRE', 'HEART', 'HAND', 'FOOT', 'NOSE',
    'EAR', 'EYE', 'PLANE', 'TRAIN', 'BIKE', 'TRUCK',
    'SHIP', 'MILK', 'EGG', 'HONEY', 'SOUP', 'CORN',
    'BEAN', 'CHAIR', 'DOOR', 'LAMP', 'BELL', 'BALL',
    'DOLL', 'SEA', 'HILL', 'SAND', 'ROCK', 'LEAF',
    'WIND', 'JUICE', 'ICE', 'TOYS', 'SOCK', 'SHOE'
];

/** Эмодзи для показа собранного слова (как у фруктов). Ключ — слово в верхнем регистре. */
const WORD_EMOJI = {
    // RU
    'КОТ': '🐱', 'ДОМ': '🏠', 'МАМА': '👩', 'СОК': '🧃', 'МЯЧ': '⚽', 'СЫР': '🧀',
    'ПАПА': '👨', 'ЛИСА': '🦊', 'РЫБА': '🐟', 'СОВА': '🦉', 'ГРИБ': '🍄', 'ШАР': '🎈',
    'ЛЕВ': '🦁', 'ТИГР': '🐯', 'ВОЛК': '🐺', 'ЗАЯЦ': '🐰', 'УТКА': '🦆', 'СЛОН': '🐘',
    'КИТ': '🐳', 'ЗМЕЯ': '🐍', 'ПЧЕЛА': '🐝', 'КОЗА': '🐐', 'ОВЦА': '🐑', 'КРАБ': '🦀',
    'АКУЛА': '🦈', 'ЛУНА': '🌙', 'ВОДА': '💧', 'СНЕГ': '❄️', 'РОЗА': '🌹', 'ЛИМОН': '🍋',
    'БАНАН': '🍌', 'АРБУЗ': '🍉', 'ТОРТ': '🎂', 'ХЛЕБ': '🍞', 'ПИЦЦА': '🍕', 'МАШИНА': '🚗',
    'ПОЕЗД': '🚆', 'ЛОДКА': '⛵', 'РАКЕТА': '🚀', 'КЛЮЧ': '🔑', 'КНИГА': '📚', 'ЦВЕТОК': '🌸',
    'ПАУК': '🕷️', 'МЫШЬ': '🐭', 'СОБАКА': '🐶', 'ПТИЦА': '🐦', 'КОРОВА': '🐄', 'МЕДВЕДЬ': '🐻',
    'ЛОШАДЬ': '🐴', 'КУРИЦА': '🐔', 'НОС': '👃', 'РОТ': '👄', 'ГЛАЗ': '👁️', 'УХО': '👂',
    'РУКА': '✋', 'НОГА': '🦵', 'СОЛНЦЕ': '☀️', 'ДОЖДЬ': '🌧️', 'ОБЛАКО': '☁️', 'ЗВЕЗДА': '⭐',
    'ОГОНЬ': '🔥', 'РАДУГА': '🌈', 'СТУЛ': '🪑', 'ОКНО': '🪟', 'САМОЛЁТ': '✈️', 'ЗОНТ': '☂️',
    'МОЛОКО': '🥛', 'ЯЙЦО': '🥚', 'МЁД': '🍯', 'МОРЕ': '🌊', 'РЕКА': '🏞️', 'ЗАМОК': '🏰',
    'МОСТ': '🌉', 'ДЕРЕВО': '🌳', 'ЯБЛОКО': '🍎', 'ГРУША': '🍐', 'МОРКОВЬ': '🥕', 'СУП': '🍲',
    'САХАР': '🍬', 'ЧАШКА': '☕', 'ТАРЕЛКА': '🍽️', 'ЛОЖКА': '🥄', 'ВИЛКА': '🍴', 'НОЖ': '🔪',
    // EN
    'CAT': '🐱', 'DOG': '🐶', 'SUN': '☀️', 'MOM': '👩', 'CUP': '☕', 'BED': '🛏️',
    'PIG': '🐷', 'COW': '🐮', 'BUS': '🚌', 'HAT': '🎩', 'FOX': '🦊', 'FISH': '🐟',
    'LION': '🦁', 'TIGER': '🐯', 'WOLF': '🐺', 'BEAR': '🐻', 'DUCK': '🦆', 'FROG': '🐸',
    'BEE': '🐝', 'ANT': '🐜', 'OWL': '🦉', 'HEN': '🐔', 'GOAT': '🐐', 'LAMB': '🐑',
    'CRAB': '🦀', 'WHALE': '🐳', 'SNAKE': '🐍', 'STAR': '⭐', 'MOON': '🌙', 'RAIN': '🌧️',
    'SNOW': '❄️', 'TREE': '🌳', 'ROSE': '🌹', 'APPLE': '🍎', 'BANANA': '🍌', 'LEMON': '🍋',
    'CAKE': '🎂', 'PIZZA': '🍕', 'CAR': '🚗', 'BOAT': '⛵', 'KEY': '🔑', 'BOOK': '📚',
    'MOUSE': '🐭', 'HORSE': '🐴', 'CHICK': '🐤', 'SPIDER': '🕷️', 'EAGLE': '🦅', 'DEER': '🦌',
    'CLOUD': '☁️', 'FIRE': '🔥', 'HEART': '❤️', 'HAND': '✋', 'FOOT': '🦶', 'NOSE': '👃',
    'EAR': '👂', 'EYE': '👁️', 'PLANE': '✈️', 'TRAIN': '🚂', 'BIKE': '🚲', 'TRUCK': '🚚',
    'SHIP': '🚢', 'MILK': '🥛', 'EGG': '🥚', 'HONEY': '🍯', 'SOUP': '🍲', 'CORN': '🌽',
    'BEAN': '🫘', 'CHAIR': '🪑', 'DOOR': '🚪', 'LAMP': '💡', 'BELL': '🔔', 'BALL': '⚽',
    'DOLL': '🪆', 'SEA': '🌊', 'HILL': '⛰️', 'SAND': '🏖️', 'ROCK': '🪨', 'LEAF': '🍃',
    'WIND': '💨', 'JUICE': '🧃', 'ICE': '🧊', 'TOYS': '🧸', 'SOCK': '🧦', 'SHOE': '👟'
};

function wordEmoji(word) {
    return word ? WORD_EMOJI[String(word).toUpperCase()] || null : null;
}

function wordListForUiLang() {
    return uiLang === 'en' ? WORD_LIST_EN : WORD_LIST_RU;
}

/** Состояние режима слов */
let wordQueue = [];
let wordQueueIndex = 0;
let currentWord = '';
let wordProgress = 0;
let wordsCompleted = 0;
/** Пауза с показом картинки собранного слова */
let wordRevealActive = false;
let wordRevealTimer = 0;
const WORD_REVEAL_MS = 2000;

function resetWordState() {
    wordQueue = [...wordListForUiLang()];
    shuffleArrayInPlace(wordQueue);
    wordQueueIndex = 0;
    wordProgress = 0;
    wordsCompleted = 0;
    currentWord = wordQueue[0] || '';
}

function advanceToNextWord() {
    wordQueueIndex = (wordQueueIndex + 1) % Math.max(1, wordQueue.length);
    currentWord = wordQueue[wordQueueIndex] || '';
    wordProgress = 0;
}

/** В режиме слов выпадает только следующая нужная буква — без отвлекающих, чтобы не путать детей */
function pickWordSpawnChar() {
    const need = currentWord[wordProgress];
    if (need) return need;
    const alphabet = letterAlphabetForUiLang();
    return alphabet[Math.floor(Math.random() * alphabet.length)];
}

/** Всплывающая надпись, поднимается и затухает; компенсирует CSS-зеркало canvas (как буквы) */
class FloatingText {
    constructor(x, y, text, color) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color || '#00f3ff';
        this.life = 1;
        this.vy = -1.4;
        this.scale = 0.6;
    }
    update(dt = 1) {
        this.y += this.vy * dt;
        this.vy *= 0.96;
        this.scale += (1 - this.scale) * 0.18 * dt;
        this.life -= 0.018 * dt;
    }
    draw(ctx) {
        const a = Math.max(0, this.life);
        if (a <= 0) return;
        const { minSide } = gameLayout;
        const fontPx = Math.max(26, minSide * 0.06) * this.scale;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(-1, 1); // компенсация CSS scaleX(-1)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${fontPx}px "Outfit", "Segoe UI", system-ui, sans-serif`;
        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(4, fontPx * 0.14);
        ctx.strokeStyle = 'rgba(8,10,20,0.8)';
        ctx.strokeText(this.text, 0, 0);
        ctx.shadowColor = this.color;
        ctx.shadowBlur = fontPx * 0.5;
        ctx.fillStyle = this.color;
        ctx.fillText(this.text, 0, 0);
        ctx.restore();
    }
}

function spawnComboText(x, y, color) {
    const mult = comboMultiplier();
    let label;
    if (comboStreak > 0 && comboStreak % 5 === 0) {
        label = `${t('praiseCombo')} x${mult}!`;
    } else if (mult > 1) {
        label = `x${mult}`;
    } else {
        return;
    }
    floatingTexts.push(new FloatingText(x, y, label, color));
}

function juiceBurst(x, y, color, dots, sparks) {
    particles.push(new SliceBurst(x, y, color));
    for (let p = 0; p < dots; p++) particles.push(new Particle(x, y, color, 'dot'));
    for (let p = 0; p < sparks; p++) particles.push(new Particle(x, y, color, 'spark'));
}

function updateComboHud() {
    if (!comboDisplay) return;
    if (comboStreak >= 2) {
        comboDisplay.textContent = `${t('comboLabel')} x${comboMultiplier()} · ${comboStreak}`;
        comboDisplay.classList.remove('is-hidden');
        comboDisplay.classList.remove('combo-pop');
        void comboDisplay.offsetWidth; // перезапуск CSS-анимации
        comboDisplay.classList.add('combo-pop');
    } else {
        comboDisplay.classList.add('is-hidden');
    }
}

function registerGoodHit(fruit, points) {
    comboStreak += 1;
    if (comboStreak > comboBest) comboBest = comboStreak;
    levelGoodHits += 1;
    score += points * comboMultiplier();
    scoreDisplay.innerText = formatScore(score);
    updateComboHud();
    spawnComboText(fruit.x, fruit.y - fruit.radius * 0.6, fruit.color);
    if (comboStreak > 0 && comboStreak % 5 === 0) {
        playPraiseSound();
        screenFlash = Math.max(screenFlash, 0.22);
    } else {
        screenFlash = Math.max(screenFlash, 0.1);
    }
}

function breakCombo() {
    if (comboStreak > 0) {
        comboStreak = 0;
        updateComboHud();
    }
}

function updateWordHud() {
    if (!wordProgressEl) return;
    if (getCurrentLevelConfig().mode !== 'word') {
        wordProgressEl.classList.add('is-hidden');
        return;
    }
    wordProgressEl.classList.remove('is-hidden');
    wordProgressEl.innerHTML = '';
    const prompt = document.createElement('span');
    prompt.className = 'word-prompt';
    prompt.textContent = `${t('wordPrompt')}:`;
    wordProgressEl.appendChild(prompt);
    for (let i = 0; i < currentWord.length; i++) {
        const slot = document.createElement('span');
        slot.className = 'word-slot' + (i < wordProgress ? ' is-filled' : '');
        slot.textContent = currentWord[i];
        wordProgressEl.appendChild(slot);
    }
}

function showWordReveal(word) {
    if (!wordRevealEl) return;
    /** Приоритет — картинка (если положили файл), иначе подходящий эмодзи */
    const url = wordImageUrl(word);
    const emoji = url ? null : wordEmoji(word);
    if (wordRevealImg) {
        if (url) {
            wordRevealImg.src = url;
            wordRevealImg.alt = word;
            wordRevealImg.classList.remove('is-hidden');
        } else {
            wordRevealImg.removeAttribute('src');
            wordRevealImg.classList.add('is-hidden');
        }
    }
    if (wordRevealEmoji) {
        if (emoji) {
            wordRevealEmoji.textContent = emoji;
            wordRevealEmoji.classList.remove('is-hidden');
        } else {
            wordRevealEmoji.textContent = '';
            wordRevealEmoji.classList.add('is-hidden');
        }
    }
    if (wordRevealText) wordRevealText.textContent = word;
    wordRevealEl.classList.remove('is-hidden');
}

function hideWordReveal() {
    wordRevealEl?.classList.add('is-hidden');
}

function clearWordReveal() {
    if (wordRevealTimer) {
        clearTimeout(wordRevealTimer);
        wordRevealTimer = 0;
    }
    wordRevealActive = false;
    hideWordReveal();
}

function onWordCompleted(fruit) {
    wordsCompleted += 1;
    playWordSound(currentWord);
    floatingTexts.push(new FloatingText(fruit.x, fruit.y - fruit.radius, currentWord, '#76ff03'));
    score += 50 * comboMultiplier();
    scoreDisplay.innerText = formatScore(score);
    screenFlash = Math.max(screenFlash, 0.28);

    /** Пауза: показываем картинку собранного слова, спавн/рез на это время выключены */
    const cfg = getCurrentLevelConfig();
    const isLast = wordsCompleted >= (cfg.wordGoal || 3);
    const finishedWord = currentWord;
    wordRevealActive = true;
    showWordReveal(finishedWord);
    if (wordRevealTimer) clearTimeout(wordRevealTimer);
    wordRevealTimer = setTimeout(() => {
        wordRevealTimer = 0;
        wordRevealActive = false;
        hideWordReveal();
        if (isLast) {
            completeLevel();
            return;
        }
        /** Чистим оставшиеся буквы предыдущего слова — следующее начинаем «с нуля» */
        fruits.length = 0;
        advanceToNextWord();
        updateWordHud();
        lastSpawnTime = Date.now();
    }, WORD_REVEAL_MS);
}

function checkLevelGoal() {
    const cfg = getCurrentLevelConfig();
    if (cfg.mode === 'word') return;
    if (!levelComplete && cfg.goal && levelGoodHits >= cfg.goal) {
        completeLevel();
    }
}

/**
 * Копит прогресс удержания руки на объекте. Когда рука уходит, прогресс спадает,
 * а не обнуляется: кратковременная потеря трекинга не должна отнимать результат.
 */
/** Рука, закреплённая за текущим пересчётом: считать можно только одной */
let countingHand = null;

/**
 * Какой ровно один предмет сейчас удерживается. Выбираем ближайший к пальцу,
 * а не все попавшие в радиус: иначе одна рука между двумя котиками копит
 * прогресс обоим и засчитывает лишнее.
 *
 * В счёте обе руки равноправны, но работает только одна за раз: рука, которая
 * уже держит котика, «занята», и вторая ждёт. Как только этот котик досчитан
 * или рука ушла с него, обе руки снова свободны — считать может любая.
 */
function pickHeldFruit(list, tipPoints, mode) {
    if (!tipPoints.length) {
        if (mode === "counting") countingHand = null;
        return null;
    }

    /** Для каждой руки — ближайший несосчитанный предмет в зоне досягаемости */
    const byHand = new Map();
    for (const f of list) {
        if (f.isSliced || !f.isCompareObject) continue;
        if (f.isCountingObject && f.countNumber > 0) continue;
        const reach = f.radius + HOLD_RADIUS_BONUS_PX;
        for (const p of tipPoints) {
            const d = Math.hypot(p.x - f.x, p.y - f.y);
            if (d > reach) continue;
            const cur = byHand.get(p.hand);
            if (!cur || d < cur.dist) byHand.set(p.hand, { fruit: f, dist: d });
        }
    }

    if (mode === "counting") {
        /** Занятая рука продолжает держать своего котика — вторая в это время не активна */
        const own = countingHand && byHand.get(countingHand);
        if (own) return own.fruit;
        /** Рука освободилась (досчитала или ушла) — снова выбираем из обеих */
        countingHand = null;
    }

    let best = null;
    for (const [hand, cand] of byHand) {
        if (!best || cand.dist < best.dist) best = { ...cand, hand };
    }
    if (!best) return null;
    if (mode === "counting") countingHand = best.hand;
    return best.fruit;
}

function updateHoldProgress(fruit, touching, elapsedMs) {
    if (fruit.isSliced || levelComplete) return;
    /** Сосчитанный предмет больше не реагирует — иначе один и тот же считался бы дважды */
    if (fruit.isCountingObject ? fruit.countNumber > 0 : compareRoundResolved) return;

    /** После ошибки ждём, пока ребёнок уберёт руку — только тогда снова копим */
    if (fruit.holdLocked) {
        if (!touching) fruit.holdLocked = false;
        fruit.holdProgress = Math.max(0, fruit.holdProgress - elapsedMs / HOLD_DECAY_MS);
        return;
    }
    if (touching) {
        fruit.holdProgress = Math.min(1, fruit.holdProgress + elapsedMs / HOLD_TO_SELECT_MS);
        if (fruit.holdProgress >= 1) {
            fruit.holdProgress = 0;
            if (fruit.isCountingObject) handleCountingHold(fruit);
            else handleCompareCut(fruit, null);
        }
    } else {
        fruit.holdProgress = Math.max(0, fruit.holdProgress - elapsedMs / HOLD_DECAY_MS);
    }
}

/**
 * Предмет сосчитан. В счёте нет «неверного» выбора — есть только
 * незавершённость, поэтому ошибок здесь не бывает, только номер и голос.
 */
function handleCountingHold(fruit) {
    if (fruit.countNumber > 0 || countingFinishedAt) return;

    countingDone += 1;
    fruit.countNumber = countingDone;
    fruit.countPop = 1;
    fruit.countAnimMs = 0;
    spawnCountHearts(fruit.x, fruit.y, fruit.radius);
    playCountingSound(`count_${countingDone}`);
    juiceBurst(fruit.x, fruit.y, '#7CFFB2', 16, 10);
    registerGoodHit(fruit, 5);

    if (countingDone >= countingTotal) {
        countingFinishedAt = Date.now();
        countingRounds += 1;
        /** Итог — с паузой, чтобы не наложиться на последнее числительное */
        const kindKey = countingKind.key;
        setTimeout(() => playCountingSound(`total_${kindKey}_${countingTotal}`), COUNTING_TOTAL_DELAY_MS);
        const cfg = getCurrentLevelConfig();
        if (!levelComplete && cfg.roundGoal && countingRounds >= cfg.roundGoal) {
            /** Даём дослушать итог, прежде чем показывать экран победы */
            setTimeout(completeLevel, COUNTING_TOTAL_DELAY_MS + 1400);
        }
    }
}

/**
 * Рез в режиме сравнения. Неверный объект не разрезается — только сигнал ошибки,
 * задание остаётся в силе, чтобы ребёнок попробовал ещё раз.
 */
function handleCompareCut(fruit, hitSegment) {
    if (!compareTask || compareRoundResolved) return;

    if (!fruit.isCompareCorrect) {
        compareErrorStreak += 1;
        fruit.hitFlash = 0;
        fruit.errorFlash = 1;
        /** Блокируем накопление, пока рука не ушла: иначе счёт пойдёт сразу заново */
        fruit.holdLocked = true;
        playErrorSound();
        if (compareErrorStreak >= COMPARE_HINT_AFTER_ERRORS && !compareHintActive) {
            compareHintActive = true;
        }
        /** Подсказку сопровождаем повтором задания — ребёнок мог забыть, что просили */
        if (compareHintActive) {
            setTimeout(() => playTaskSound(compareTask?.taskKey, compareTask?.shape, compareTask?.kind), 700);
        }
        return;
    }

    compareRoundResolved = true;
    /**
     * Радостный прыжок вместо разрезания — как у котиков в счёте. Ребёнок
     * не «уничтожает» правильный ответ, а предмет радуется вместе с ним.
     */
    fruit.celebrating = true;
    fruit.countAnimMs = 0;
    spawnCountHearts(fruit.x, fruit.y, fruit.radius);

    /** Эффект награды: «сок» + вспышка; combo-текст добавит registerGoodHit */
    juiceBurst(fruit.x, fruit.y, fruit.color, 34, 20);
    registerGoodHit(fruit, 10);
    /** Похвалу — с отступом, чтобы не наложиться на комбо-фразу из registerGoodHit */
    setTimeout(playComparePraiseSound, 260);
    checkLevelGoal();

    compareNextRoundAt = Date.now() + COMPARE_NEXT_ROUND_DELAY_MS;
}

/** Рез засчитан: комбо, очки, режим слов, «сок» */
function handleSliceScoring(fruit) {
    playSliceSoundForTarget(fruit);
    if (fruit.levelMode === 'word') {
        const need = currentWord[wordProgress];
        if (need && fruit.glyphChar === need) {
            wordProgress += 1;
            registerGoodHit(fruit, 10);
            juiceBurst(fruit.x, fruit.y, fruit.color, 26 + comboMultiplier() * 6, 16);
            updateWordHud();
            if (wordProgress >= currentWord.length) onWordCompleted(fruit);
        } else {
            /** Неверная буква — мягко: без штрафа и без сброса серии (детский режим) */
            juiceBurst(fruit.x, fruit.y, 'rgba(185,195,215,1)', 8, 4);
        }
        return;
    }
    registerGoodHit(fruit, 10);
    const extra = Math.min(18, comboMultiplier() * 4);
    juiceBurst(fruit.x, fruit.y, fruit.color, 26 + extra, 16);
    checkLevelGoal();
}

/** Предмет улетел вниз несрезанным */
function handleMiss() {
    if (getCurrentLevelConfig().mode === 'word') return; // букв много — не штрафуем
    levelBadEvents += 1;
    breakCombo();
    score = Math.max(0, score - MISS_PENALTY);
    scoreDisplay.innerText = formatScore(score);
}

function computeStars() {
    const attempts = levelGoodHits + levelBadEvents;
    const acc = attempts > 0 ? levelGoodHits / attempts : 1;
    if (acc >= 0.9) return 3;
    if (acc >= 0.7) return 2;
    return 1;
}

function completeLevel() {
    if (levelComplete) return;
    levelComplete = true;
    comboDisplay?.classList.add('is-hidden');
    playWinSound();
    winBurstTimer = 0;
    showWinOverlay(computeStars());
}

const WIN_AUTO_NEXT_MS = 4000;
/** Длина окружности SVG-кольца (r=28) для визуального таймера автоперехода */
const WIN_AUTO_RING_C = 2 * Math.PI * 28;
let autoNextLevelTimer = 0;
let autoNextCountdownRaf = 0;
let autoNextDeadline = 0;

function clearAutoNextLevelTimer() {
    if (autoNextLevelTimer) {
        clearTimeout(autoNextLevelTimer);
        autoNextLevelTimer = 0;
    }
    if (autoNextCountdownRaf) {
        cancelAnimationFrame(autoNextCountdownRaf);
        autoNextCountdownRaf = 0;
    }
    autoNextDeadline = 0;
    winAutoTimerEl?.classList.add('is-hidden');
    winAutoHintEl?.classList.add('is-hidden');
    if (winAutoRingEl) winAutoRingEl.style.strokeDashoffset = '0';
}

function updateAutoNextVisual() {
    if (!autoNextDeadline) return;
    const remain = Math.max(0, autoNextDeadline - performance.now());
    const ratio = remain / WIN_AUTO_NEXT_MS;
    if (winAutoRingEl) {
        winAutoRingEl.style.strokeDashoffset = String(WIN_AUTO_RING_C * (1 - ratio));
    }
    if (winAutoCountdownEl) {
        winAutoCountdownEl.textContent = String(Math.max(1, Math.ceil(remain / 1000)));
    }
    if (remain > 0) {
        autoNextCountdownRaf = requestAnimationFrame(updateAutoNextVisual);
    } else if (winAutoCountdownEl) {
        winAutoCountdownEl.textContent = '0';
    }
}

function scheduleAutoNextLevel() {
    clearAutoNextLevelTimer();
    autoNextDeadline = performance.now() + WIN_AUTO_NEXT_MS;
    if (winAutoHintEl) winAutoHintEl.textContent = t('winAutoHint');
    winAutoTimerEl?.classList.remove('is-hidden');
    winAutoHintEl?.classList.remove('is-hidden');
    if (winAutoCountdownEl) winAutoCountdownEl.textContent = String(Math.ceil(WIN_AUTO_NEXT_MS / 1000));
    updateAutoNextVisual();
    autoNextLevelTimer = setTimeout(() => {
        autoNextLevelTimer = 0;
        if (isPlaying && levelComplete) goToNextLevel();
    }, WIN_AUTO_NEXT_MS);
}

function goToNextLevel() {
    clearAutoNextLevelTimer();
    tryUnlockAudioOnUserGesture();
    hideWinOverlay();
    startLevel(nextLevelIndexInsideMode(currentLevelIndex, selectedGameMode));
}

function showWinOverlay(stars) {
    if (winStarsEl) {
        winStarsEl.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const s = document.createElement('span');
            s.className = 'win-star' + (i < stars ? ' is-on' : '');
            s.textContent = '⭐';
            winStarsEl.appendChild(s);
        }
    }
    if (winTitleEl) winTitleEl.textContent = t('winTitle');
    if (winScoreEl) winScoreEl.textContent = `${t('winScoreLabel')}: ${score} · ${t('comboMax')}: ${comboBest}`;
    if (btnWinNext) {
        btnWinNext.textContent = t('winNextLevel');
        btnWinNext.classList.remove('is-hidden');
    }
    if (btnWinMenu) btnWinMenu.textContent = t('winToMenu');
    winOverlay?.classList.remove('is-hidden');
    scheduleAutoNextLevel();
}

function hideWinOverlay() {
    clearAutoNextLevelTimer();
    winOverlay?.classList.add('is-hidden');
}

/**
 * mode: fruit — эмодзи; letter — кириллица/латиница по языку UI; number — 1–10 по кругу; word — собрать слово.
 * goal — сколько объектов нужно срезать, чтобы пройти уровень; word: wordGoal — сколько слов собрать.
 */
const LEVELS = [
    { mode: 'fruit', maxConcurrent: 1, spawnIntervalMs: 2200, goal: 12 },
    { mode: 'fruit', maxConcurrent: 2, spawnIntervalMs: 1900, goal: 18 },
    { mode: 'fruit', maxConcurrent: 3, spawnIntervalMs: 1550, goal: 22 },
    { mode: 'number', maxConcurrent: 1, spawnIntervalMs: 2200, goal: 12 },
    { mode: 'number', maxConcurrent: 2, spawnIntervalMs: 1900, goal: 18 },
    { mode: 'number', maxConcurrent: 3, spawnIntervalMs: 1550, goal: 22 },
    { mode: 'word', maxConcurrent: 3, spawnIntervalMs: 1500, wordGoal: 12 },
    { mode: 'word', maxConcurrent: 4, spawnIntervalMs: 1350, wordGoal: 18 },
    { mode: 'word', maxConcurrent: 4, spawnIntervalMs: 1200, wordGoal: 22 },
    /** Сравнение: пара объектов на одной высоте, спавн ручной (раундами), интервал не используется */
    { mode: 'compare', maxConcurrent: 2, spawnIntervalMs: 0, goal: 10 },
    { mode: 'compareNumber', maxConcurrent: 2, spawnIntervalMs: 0, goal: 10 },
    { mode: 'compareLetter', maxConcurrent: 2, spawnIntervalMs: 0, goal: 10 },
    /** Счёт: цель в раундах, а не в предметах — иначе уровень кончится посреди пересчёта */
    { mode: 'counting', maxConcurrent: 10, spawnIntervalMs: 0, goal: 0, roundGoal: 4 },
    { mode: 'board', maxConcurrent: 1, spawnIntervalMs: 1100, goal: 20 },
    { mode: 'board', maxConcurrent: 2, spawnIntervalMs: 950, goal: 30 },
    { mode: 'board', maxConcurrent: 3, spawnIntervalMs: 800, goal: 40 }
];

/** Кадров подряд без пересечения с предметом, чтобы снова считать «новый вход» (трекинг мерцает на границе круга) */
const CONTACT_EXIT_DEBOUNCE_FRAMES = 7;
/** Штраф за предмет, улетевший вниз несрезанным (симметрично +10 за рез) */
const MISS_PENALTY = 10;
let currentLevelIndex = 0;
let selectedGameMode = 'fruit';
/**
 * Режимы, показанные в меню. Остальные уровни остаются в LEVELS и работают —
 * просто не выведены в меню. Чтобы вернуть: дописать сюда 'fruit', 'number', 'word', 'board'.
 */
const MENU_GAME_MODES = ['compareNumber', 'compareLetter', 'compare', 'counting'];

function levelIndicesForMode(mode) {
    const out = [];
    for (let i = 0; i < LEVELS.length; i++) {
        if (LEVELS[i].mode === mode) out.push(i);
    }
    return out;
}

function firstLevelIndexForMode(mode) {
    const list = levelIndicesForMode(mode);
    return list.length ? list[0] : 0;
}

function nextLevelIndexInsideMode(currentIndex, mode) {
    const list = levelIndicesForMode(mode);
    if (!list.length) return 0;
    const at = list.indexOf(currentIndex);
    if (at < 0) return list[0];
    return list[(at + 1) % list.length];
}

function getCurrentLevelConfig() {
    return LEVELS[currentLevelIndex];
}

const I18N = {
    ru: {
        tierProducts: 'Продукты',
        tierLetters: 'Буквы',
        tierNumbers: 'Цифры',
        tierWords: 'Слова',
        tierBoards: 'Доски',
        tierCompare: 'Сравнение',
        tierCompareLetters: 'Буквы',
        tierCompareNumbers: 'Цифры',
        tierCounting: 'Сосчитай',
        hudAtOnce: '',
        comboLabel: 'Серия',
        comboMax: 'Макс. серия',
        wordPrompt: 'Собери слово',
        winTitle: 'Уровень пройден!',
        winScoreLabel: 'Счёт',
        winNextLevel: 'Дальше',
        winAutoHint: 'Следующий уровень через',
        winReplay: 'Ещё раз',
        winToMenu: 'Меню',
        praiseGreat: 'Молодец!',
        praiseSuper: 'Супер!',
        praiseWow: 'Вот это да!',
        praiseCombo: 'Серия',
        hudGoal: 'Цель',
        scorePrefix: 'Счёт: ',
        menuHeading: 'Выберите тип игры',
        menuHint: 'Слушай задание и наведи руку на нужный предмет.',
        quickSettingsAria: 'Язык, звук, музыка и число игроков',
        langLabel: 'Язык',
        playersOnCamera: 'Количество игроков',
        gamesGallery: 'Галерея игр',
        gamesGalleryAria: 'Перейти в галерею игр Blago Games',
        playersOneAria: 'Один игрок',
        playersTwoAria: 'Два игрока',
        soundInGame: 'Звуки в игре',
        soundOffAria: 'Отключить звуки в игре',
        musicTitle: 'Музыка',
        musicDesc: 'Меню и игра',
        musicOffAria: 'Отключить музыку',
        fullscreenEnter: 'На весь экран',
        fullscreenExit: 'Свернуть',
        fullscreenEnterAria: 'Развернуть на весь экран',
        fullscreenExitAria: 'Выйти из полноэкранного режима',
        backToMenu: 'Меню',
        loadingModels: 'Загрузка моделей…',
        errorTitle: 'Не удалось запустить игру.',
        errorHintGeneric:
            'Откройте консоль браузера (F12 → Console) и при необходимости пришлите текст ошибки.',
        errorHintCameraBlocked:
            'Браузер заблокировал камеру для этого сайта. Нажмите на значок замка слева от адреса → разрешите камеру, обновите страницу.',
        errorHintNoCamera:
            'Камера не найдена. Проверьте, что она подключена и не занята другим приложением.',
        errorHintTimeout:
            'Камера не успела запуститься. Отключите режим эмуляции устройства в DevTools (или выберите реальное устройство с камерой), закройте другие программы, использующие камеру, и обновите страницу.'
    },
    en: {
        tierProducts: 'Products',
        tierLetters: 'Letters',
        tierNumbers: 'Numbers',
        tierWords: 'Words',
        tierBoards: 'Boards',
        tierCompare: 'Compare',
        tierCompareLetters: 'Letters',
        tierCompareNumbers: 'Numbers',
        tierCounting: 'Counting',
        hudAtOnce: 'at once',
        comboLabel: 'Combo',
        comboMax: 'Best combo',
        wordPrompt: 'Spell the word',
        winTitle: 'Level complete!',
        winScoreLabel: 'Score',
        winNextLevel: 'Next',
        winAutoHint: 'Next level in',
        winReplay: 'Replay',
        winToMenu: 'Menu',
        praiseGreat: 'Great!',
        praiseSuper: 'Super!',
        praiseWow: 'Wow!',
        praiseCombo: 'Combo',
        hudGoal: 'Goal',
        scorePrefix: 'Score: ',
        menuHeading: 'Choose game type',
        menuHint: 'Listen to the task and hold your hand over the right object.',
        quickSettingsAria: 'Language, sound, music and number of players',
        langLabel: 'Language',
        playersOnCamera: 'Number of players',
        gamesGallery: 'Game gallery',
        gamesGalleryAria: 'Go to Blago Games gallery',
        playersOneAria: 'One player',
        playersTwoAria: 'Two players',
        soundInGame: 'Game sounds',
        soundOffAria: 'Mute game sounds',
        musicTitle: 'Music',
        musicDesc: 'Menu and game',
        musicOffAria: 'Mute music',
        fullscreenEnter: 'Fullscreen',
        fullscreenExit: 'Exit fullscreen',
        fullscreenEnterAria: 'Enter fullscreen',
        fullscreenExitAria: 'Exit fullscreen',
        backToMenu: 'Menu',
        loadingModels: 'Loading models…',
        errorTitle: 'Could not start the game.',
        errorHintGeneric: 'Open the browser console (F12 → Console) and send the error text if needed.',
        errorHintCameraBlocked:
            'The browser blocked camera access for this site. Use the lock icon next to the address bar → allow camera, then refresh.',
        errorHintNoCamera: 'No camera found. Check that it is connected and not used by another app.',
        errorHintTimeout:
            'The camera did not start in time. Turn off device emulation in DevTools (or pick a real camera), close other apps using the camera, and refresh.'
    }
};

function t(key) {
    const pack = I18N[uiLang];
    if (pack && Object.prototype.hasOwnProperty.call(pack, key)) return pack[key];
    return I18N.en[key] ?? key;
}

function pluralSimultaneousRu(n) {
    const n100 = n % 100;
    const n10 = n % 10;
    if (n100 >= 11 && n100 <= 14) return `${n} объектов`;
    if (n10 === 1) return `${n} объект`;
    if (n10 >= 2 && n10 <= 4) return `${n} объекта`;
    return `${n} объектов`;
}

function pluralSimultaneousEn(n) {
    return n === 1 ? `${n} object` : `${n} objects`;
}

function levelTierTitle(levelIndex) {
    const cfg = LEVELS[levelIndex];
    if (!cfg) return '';
    /** Порядковый номер внутри своей категории — не зависит от состава LEVELS */
    let sub = 0;
    for (let i = 0; i <= levelIndex; i++) {
        if (LEVELS[i].mode === cfg.mode) sub++;
    }
    const name =
        cfg.mode === 'fruit'
            ? t('tierProducts')
            : cfg.mode === 'letter'
            ? t('tierLetters')
            : cfg.mode === 'number'
            ? t('tierNumbers')
            : cfg.mode === 'board'
            ? t('tierBoards')
            : cfg.mode === 'compare'
            ? t('tierCompare')
            : cfg.mode === 'compareLetter'
            ? t('tierCompareLetters')
            : cfg.mode === 'compareNumber'
            ? t('tierCompareNumbers')
            : cfg.mode === 'counting'
            ? t('tierCounting')
            : t('tierWords');
    return `${name} ${sub}`;
}

function formatHudLevelLine(levelIndex, maxConcurrent) {
    const title = levelTierTitle(levelIndex);
    const cfg = LEVELS[levelIndex];
    /** В счёте число предметов меняется каждый раунд — «одновременно N» только путает */
    if (cfg?.mode === 'word' || cfg?.mode === 'board' || cfg?.mode === 'counting') return title;
    if (uiLang === 'en') {
        return `${title} · ${pluralSimultaneousEn(maxConcurrent)} ${t('hudAtOnce')}`.trim();
    }
    return `${title} · одновременно ${pluralSimultaneousRu(maxConcurrent)}`;
}

function formatScore(n) {
    return `${t('scorePrefix')}${n}`;
}

function buildLevelGrid() {
    if (!levelGrid) return;
    levelGrid.innerHTML = '';
    MENU_GAME_MODES.forEach((mode) => {
        const i = firstLevelIndexForMode(mode);
        const cfg = LEVELS[i];
        if (!cfg) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn';
        btn.innerHTML = `<span class="level-title">${levelTierTitle(i).replace(/\s+\d+$/, '')}</span>`;
        btn.addEventListener('click', () => {
            selectedGameMode = mode;
            startLevel(firstLevelIndexForMode(mode));
        });
        levelGrid.appendChild(btn);
    });
}

function applyUiTranslations() {
    const mh = document.getElementById('menu-heading');
    if (mh) mh.textContent = t('menuHeading');
    const hint = document.getElementById('menu-hint');
    if (hint) hint.textContent = t('menuHint');
    const mq = document.getElementById('menu-quick-settings');
    if (mq) mq.setAttribute('aria-label', t('quickSettingsAria'));
    const mgl = document.getElementById('menu-games-gallery-label');
    const mga = document.getElementById('menu-games-gallery');
    if (mgl) mgl.textContent = t('gamesGallery');
    if (mga) mga.setAttribute('aria-label', t('gamesGalleryAria'));
    const st = document.getElementById('menu-opt-sound-title');
    if (st) st.textContent = t('soundInGame');
    const mt = document.getElementById('menu-opt-music-title');
    if (mt) mt.textContent = t('musicTitle');
    const md = document.getElementById('menu-opt-music-desc');
    if (md) md.textContent = t('musicDesc');
    const sfx = document.getElementById('opt-sound-off');
    if (sfx) sfx.setAttribute('aria-label', t('soundOffAria'));
    const mus = document.getElementById('opt-music-off');
    if (mus) mus.setAttribute('aria-label', t('musicOffAria'));
    const lt = document.getElementById('loading-text');
    if (lt) lt.textContent = t('loadingModels');
    if (btnBackMenu) btnBackMenu.textContent = t('backToMenu');
    const olru = document.getElementById('opt-lang-ru');
    const olen = document.getElementById('opt-lang-en');
    if (olru) olru.checked = uiLang === 'ru';
    if (olen) olen.checked = uiLang === 'en';
    syncFullscreenButton();
    buildLevelGrid();
    if (scoreDisplay) scoreDisplay.innerText = formatScore(isPlaying ? score : 0);
    if (isPlaying) {
        const cfg = getCurrentLevelConfig();
        if (levelDisplay) levelDisplay.textContent = formatHudLevelLine(currentLevelIndex, cfg.maxConcurrent);
        if (scoreDisplay) scoreDisplay.innerText = formatScore(score);
    }
}

function showMainMenu() {
    isPlaying = false;
    levelComplete = false;
    stopGameMusic();
    clearWordReveal();
    hideWinOverlay();
    comboDisplay?.classList.add('is-hidden');
    wordProgressEl?.classList.add('is-hidden');
    mainMenu.classList.remove('is-hidden');
    hudGame.classList.add('is-hidden');
    fruits.length = 0;
    boards.length = 0;
    particles.length = 0;
    floatingTexts = [];
    screenFlash = 0;
    prevFingertipsByKey.clear();
    prevFootPointByKey.clear();
    handKeyLastSeenMs.clear();
    tipVelocityByKey.clear();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    /** Полноэкранный canvas под меню всё равно участвует в композитинге — убираем из дерева отрисовки */
    canvasElement.style.visibility = "hidden";
    /** В меню кадр камеры не нужен — меньше декодер/GPU, плавнее CSS */
    void video.pause();
    playMenuMusic();
}

function startLevel(levelIndex) {
    tryUnlockAudioOnUserGesture();
    currentLevelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    const cfg = getCurrentLevelConfig();
    selectedGameMode = cfg.mode || selectedGameMode;
    /** Приоритетно декодируем озвучку именно этого уровня и языка — чтобы звук был с первого спавна */
    if (soundEffectsEnabled) void warmSfxBuffers(currentLevelSfxUrls(cfg), 8);
    score = 0;
    scoreDisplay.innerText = formatScore(score);
    levelDisplay.textContent = formatHudLevelLine(currentLevelIndex, cfg.maxConcurrent);
    fruits.length = 0;
    boards.length = 0;
    particles.length = 0;
    floatingTexts = [];
    screenFlash = 0;
    prevFootPointByKey.clear();
    comboStreak = 0;
    comboBest = 0;
    levelGoodHits = 0;
    levelBadEvents = 0;
    levelComplete = false;
    winBurstTimer = 0;
    clearWordReveal();
    hideWinOverlay();
    comboDisplay?.classList.add('is-hidden');
    if (cfg.mode === 'number') sequentialSpawnNumber = 1;
    if (cfg.mode === 'letter') sequentialLetterIndex = 0;
    if (cfg.mode === 'word') {
        resetWordState();
        updateWordHud();
        preloadWordImages();
    } else {
        wordProgressEl?.classList.add('is-hidden');
    }
    if (cfg.mode === 'board') nextBoardStrikeKind = 'hand';
    resetCompareState();
    resetCountingState();
    lastSpawnTime = Date.now();
    lastFrameTime = performance.now();
    resetPoseDisplayState();
    mainMenu.classList.add('is-hidden');
    hudGame.classList.remove('is-hidden');
    canvasElement.style.visibility = "";
    isPlaying = true;
    void video.play().catch(() => {});
    /** Музыка и первый кадр — в microtask после unlock play(), иначе iOS Chrome иногда глушит первый HTMLAudio */
    queueMicrotask(() => {
        startGameMusicPlaylist();
        ensureGameLoop();
    });
}

btnBackMenu.addEventListener('click', () => showMainMenu());

btnWinNext?.addEventListener('click', () => goToNextLevel());

btnWinMenu?.addEventListener('click', () => {
    hideWinOverlay();
    showMainMenu();
});

/**
 * Fullscreen API: на ПК и iPad/Android Chrome работает; на iPhone Safari — нет (там путь через PWA).
 * Кнопка показывается только в меню; во время игры она лишний раз отвлекает.
 */
const gameContainer = document.getElementById('game-container');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnFullscreenLabel = btnFullscreen?.querySelector('.btn-fullscreen-label');

function isFullscreenSupported() {
    const el = gameContainer || document.documentElement;
    return !!(
        document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        el.requestFullscreen ||
        el.webkitRequestFullscreen
    );
}

function getCurrentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function enterFullscreen() {
    const el = gameContainer || document.documentElement;
    try {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (_) {}
}

async function exitFullscreen() {
    try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (_) {}
}

function syncFullscreenButton() {
    if (!btnFullscreen) return;
    const isFs = !!getCurrentFullscreenElement();
    btnFullscreen.classList.toggle('is-active', isFs);
    if (btnFullscreenLabel) {
        btnFullscreenLabel.textContent = isFs ? t('fullscreenExit') : t('fullscreenEnter');
    }
    btnFullscreen.setAttribute('aria-label', isFs ? t('fullscreenExitAria') : t('fullscreenEnterAria'));
}

if (btnFullscreen) {
    if (isFullscreenSupported()) btnFullscreen.hidden = false;
    btnFullscreen.addEventListener('click', () => {
        if (getCurrentFullscreenElement()) void exitFullscreen();
        else void enterFullscreen();
    });
    document.addEventListener('fullscreenchange', syncFullscreenButton);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
    syncFullscreenButton();
}

/** Автозапуск после загрузки часто блокируется — тап по панели (не по кнопке уровня) включает меню */
mainMenu.addEventListener(
    'pointerdown',
    (e) => {
        if (isPlaying) return;
        tryUnlockAudioOnUserGesture();
        if (e.target?.closest?.('.menu-main-controls')) return;
        if (e.target?.closest?.('.level-btn')) return;
        if (e.target?.closest?.('.menu-player-row')) return;
        playMenuMusic();
    },
    { capture: true }
);

/** iPad / iOS Chrome: touchstart + touchend — часть сборок открывает аудио только на одном из них */
mainMenu.addEventListener(
    'touchstart',
    () => {
        if (!isPlaying) tryUnlockAudioOnUserGesture();
    },
    { capture: true, passive: true }
);
mainMenu.addEventListener(
    'touchend',
    () => {
        if (!isPlaying) tryUnlockAudioOnUserGesture();
    },
    { capture: true, passive: true }
);

const optSoundOff = document.getElementById('opt-sound-off');
const optMusicOff = document.getElementById('opt-music-off');
if (optSoundOff) {
    optSoundOff.addEventListener('change', () => {
        soundEffectsEnabled = !optSoundOff.checked;
        if (soundEffectsEnabled) localStorage.removeItem(STORAGE_SFX_OFF);
        else localStorage.setItem(STORAGE_SFX_OFF, '1');
    });
}
if (optMusicOff) {
    optMusicOff.addEventListener('change', () => {
        musicEnabled = !optMusicOff.checked;
        if (musicEnabled) {
            localStorage.removeItem(STORAGE_MUSIC_OFF);
            if (!isPlaying) playMenuMusic();
        } else {
            localStorage.setItem(STORAGE_MUSIC_OFF, '1');
            pauseMenuMusic();
            stopGameMusic();
        }
    });
}

async function createPoseLandmarkerInstance() {
    const vision = visionTasksResolver;
    if (!vision) {
        console.warn('[YaSam] createPoseLandmarkerInstance: vision resolver not ready');
        return;
    }
    const np = playerModeCount === 1 ? 1 : 2;
    const poseOpts = (delegate) => ({
        baseOptions: {
            modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
            delegate
        },
        runningMode: 'VIDEO',
        numPoses: np
    });

    const delegateOrder = trackTuning.mobile ? ['CPU', 'GPU'] : ['GPU', 'CPU'];
    let lastErr;
    for (const delegate of delegateOrder) {
        try {
            poseLandmarker = await PoseLandmarker.createFromOptions(vision, poseOpts(delegate));
            mediapipePoseDelegate = delegate;
            console.info(
                `[MediaPipe] pose: ${mediapipePoseDelegate}, numPoses=${np}, mobile=${trackTuning.mobile} — если CPU, игра тяжелее; в DevTools отключите throttling.`
            );
            return;
        } catch (e) {
            lastErr = e;
            console.warn(`PoseLandmarker ${delegate} failed:`, e);
        }
    }
    throw lastErr ?? new Error('PoseLandmarker init failed');
}

function resetPoseDisplayState() {
    posePrevTargetByKey.clear();
    poseTargetByKey.clear();
    poseDisplayByKey.clear();
    displayPersonOrder.length = 0;
    lastDetectTsMs = -1;
    poseFrameTsPrev = -1;
    poseFrameTsCurr = -1;
    poseFrameIntervalMs = 33.33;
    poseFrameCommitPerfMs = 0;
}

async function recreatePoseLandmarker() {
    if (!visionTasksResolver) return;
    if (poseLandmarker) {
        try {
            poseLandmarker.close();
        } catch (_) {}
        poseLandmarker = null;
    }
    lastVideoTime = -1;
    currentPoseResults = null;
    resetPoseDisplayState();
    await createPoseLandmarkerInstance();
}

loadPersistedSettings();
applyUiTranslations();

// Geometry configuration
const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

// Resize canvas to match window completely
/** Logical game size (matches canvas buffer; avoids 100vh vs innerHeight stretch on mobile) */
let gameLayout = { w: 800, h: 600, minSide: 600 };

/**
 * Потолок длинной стороны **буфера** canvas (не CSS). На широком мониторе / Responsive DevTools
 * иначе 2000+ px → тяжёлый fill+тени и заметные фризы при hand на CPU.
 */
const MAX_CANVAS_LONG_EDGE_PX = 1280;
let loggedCanvasBufferCap = false;

function readViewportSize() {
    const vv = window.visualViewport;
    const w = Math.max(1, Math.floor(vv?.width ?? window.innerWidth));
    const h = Math.max(1, Math.floor(vv?.height ?? window.innerHeight));
    return { w, h };
}

/** Последние применённые размеры — без лишнего сброса canvas */
let lastResizeW = 0;
let lastResizeH = 0;

function resizeCanvas() {
    const { w: vw, h: vh } = readViewportSize();
    if (vw === lastResizeW && vh === lastResizeH) return;
    lastResizeW = vw;
    lastResizeH = vh;

    let iw = vw;
    let ih = vh;
    const longEdge = Math.max(iw, ih);
    if (longEdge > MAX_CANVAS_LONG_EDGE_PX) {
        const s = MAX_CANVAS_LONG_EDGE_PX / longEdge;
        iw = Math.max(1, Math.floor(vw * s));
        ih = Math.max(1, Math.floor(vh * s));
    }

    if ((iw < vw || ih < vh) && !loggedCanvasBufferCap) {
        loggedCanvasBufferCap = true;
        console.info(
            `[YaSam] буфер canvas ограничен ${iw}×${ih} px (окно ${vw}×${vh}) — иначе полный размер сильно грузит GPU/CPU`
        );
    }

    gameLayout.w = iw;
    gameLayout.h = ih;
    gameLayout.minSide = Math.min(iw, ih);

    canvasElement.width = iw;
    canvasElement.height = ih;
    canvasElement.style.width = `${vw}px`;
    canvasElement.style.height = `${vh}px`;

    const gc = document.getElementById('game-container');
    if (gc) {
        gc.style.width = `${vw}px`;
        gc.style.height = `${vh}px`;
    }
    document.documentElement.style.height = `${vh}px`;
    document.body.style.height = `${vh}px`;
    document.documentElement.style.width = `${vw}px`;
    document.body.style.width = `${vw}px`;
}

/** Частые события visualViewport (адресная строка, зум) иначе десятки раз сбрасывают canvas */
let resizeCanvasDebounce = 0;
function scheduleResizeCanvas() {
    /** Во время игры отложенный ресайз ломает попадание координат → «пропадают» кисти */
    if (isPlaying) {
        clearTimeout(resizeCanvasDebounce);
        resizeCanvasDebounce = 0;
        resizeCanvas();
        return;
    }
    clearTimeout(resizeCanvasDebounce);
    resizeCanvasDebounce = setTimeout(() => {
        resizeCanvasDebounce = 0;
        resizeCanvas();
    }, 110);
}

window.addEventListener('resize', scheduleResizeCanvas);
window.visualViewport?.addEventListener('resize', scheduleResizeCanvas);
resizeCanvas();

function stopVideoTracks() {
    const s = video.srcObject;
    if (s && typeof s.getTracks === "function") {
        s.getTracks().forEach((t) => t.stop());
    }
    video.srcObject = null;
}

/** Дождаться готовности video: размеры/кадр (иначе Chrome может дать Timeout starting video source). */
function waitForVideoReady(el, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        if (el.readyState >= 2 && el.videoWidth > 0) {
            resolve();
            return;
        }
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            el.removeEventListener("loadedmetadata", onMeta);
            el.removeEventListener("loadeddata", onData);
            el.removeEventListener("canplay", onPlay);
            if (ok) resolve();
            else reject(new Error("Video metadata timeout"));
        };
        const onMeta = () => {
            if (el.videoWidth > 0) finish(true);
        };
        const onData = () => finish(true);
        const onPlay = () => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        el.addEventListener("loadedmetadata", onMeta);
        el.addEventListener("loadeddata", onData);
        el.addEventListener("canplay", onPlay);
    });
}

async function setupWebcam() {
    const nav = window.navigator;
    if (!nav.mediaDevices?.getUserMedia) {
        throw new Error("Webcam not supported.");
    }

    video.muted = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");

    const constraintSets = [];
    if (trackTuning.android) {
        constraintSets.push({
            video: {
                width: { ideal: 640, max: 640 },
                height: { ideal: 480, max: 480 },
                frameRate: { ideal: 30, max: 30 },
                facingMode: 'user'
            }
        });
    }
    constraintSets.push(
        { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } },
        { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } },
        { video: { facingMode: 'user' } },
        { video: true }
    );

    let lastErr;
    for (const constraints of constraintSets) {
        try {
            stopVideoTracks();
            const stream = await nav.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            await waitForVideoReady(video, 25000);
            await video.play();
            return;
        } catch (e) {
            lastErr = e;
            console.warn("Webcam attempt failed:", constraints, e);
            stopVideoTracks();
        }
    }
    throw lastErr ?? new Error("Could not open webcam");
}

async function initializeModels() {
    let vision;
    const wasmLocal = getMediapipeWasmUrl();
    let visionWasmSource = 'same-origin';
    try {
        vision = await FilesetResolver.forVisionTasks(wasmLocal);
    } catch (e) {
        console.warn('MediaPipe wasm с этого сайта не открылся, fallback CDN:', e);
        visionWasmSource = 'jsdelivr-fallback';
        vision = await FilesetResolver.forVisionTasks(
            `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_WASM_VER}/wasm`
        );
    }
    console.info(`[YaSam] MediaPipe WASM: ${visionWasmSource} ← ${wasmLocal}`);

    visionTasksResolver = vision;
    await createPoseLandmarkerInstance();

    preloadGameAudio();

    loadingElement.classList.remove('visible');
    showMainMenu();
}

// Game Objects
const fruitEmojiTextures = {};

/**
 * Текстура произвольного эмодзи по требованию. initFruitTextures готовит только
 * десятку продуктов; объекты сравнения (карандаш, башня…) приходят сюда.
 */
function getOrCreateEmojiTexture(emoji) {
    let hit = fruitEmojiTextures[emoji];
    if (hit) return hit;
    const size = 600;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.font = `${size * 0.8}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2 + 10);
    hit = { canvas: c, size };
    fruitEmojiTextures[emoji] = hit;
    return hit;
}

/**
 * Текстура из готового спрайта. Картинка грузится асинхронно, поэтому канвас
 * отдаём сразу пустым и дорисовываем по onload — объект уже на экране и просто
 * «проявляется», вместо того чтобы ждать загрузки перед спавном.
 */
const spriteTextureCache = new Map();
function getOrCreateSpriteTexture(key) {
    const url = objectSpriteUrlByKey[String(key).toLowerCase()];
    if (!url) return null;
    let hit = spriteTextureCache.get(key);
    if (hit) return hit;
    const size = 600;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    hit = { canvas: c, size };
    spriteTextureCache.set(key, hit);
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => c.getContext('2d').drawImage(im, 0, 0, size, size);
    im.src = url;
    return hit;
}

/** Прогрев спрайтов, чтобы первый показ не был пустым */
function preloadObjectSprites() {
    for (const key of Object.keys(objectSpriteUrlByKey)) getOrCreateSpriteTexture(key);
}

function initFruitTextures() {
    const emojis = ['🍌', '🍎', '🍉', '🍊', '🍗', '🥩', '🥦', '🥬', '🍆', '🍅'];
    const size = 600; // max size matching largest fruit radius
    for(let e of emojis) {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.font = `${size * 0.8}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e, size / 2, size / 2 + 10); // Slight vertical offset to center better
        fruitEmojiTextures[e] = { canvas: c, size: size };
    }
}
initFruitTextures();
preloadObjectSprites();

/** Русский алфавит для уровней 4–6 (озвучка при вылете — sounds/letters/ru) */
const CYRILLIC_LETTERS = [
    'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П',
    'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я'
];

/** Латиница для буквенных уровней при английском UI */
const LATIN_LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

function letterAlphabetForUiLang() {
    return uiLang === 'en' ? LATIN_LETTERS : CYRILLIC_LETTERS;
}

const GLYPH_NEON_COLORS = [
    '#ffe135', '#ff0800', '#fc3a52', '#ffa500', '#ffcc80', '#76ff03', '#00e5ff',
    '#651fff', '#ff00ea', '#00f3ff', '#e53935', '#8bc34a', '#9c27b0'
];

const glyphTextureCache = new Map();

/** Буквы/цифры на экране крупнее продуктов */
const GLYPH_RADIUS_SCALE = 1.5;
const GLYPH_RADIUS_CAP_PX = 240;

function glyphFontPx(label, canvasSize) {
    const len = label.length;
    if (len >= 3) return canvasSize * 0.37;
    if (len === 2) return canvasSize * 0.46;
    return canvasSize * 0.58;
}

/** Числовые уровни: следующее число по порядку 1 → NUMBER_SPAWN_CYCLE_MAX → 1 … */
let sequentialSpawnNumber = 1;
/** Буквенные уровни: следующая буква по алфавиту (кириллица или A–Z по языку UI) */
let sequentialLetterIndex = 0;

/* ─── Режим сравнения (compare) ──────────────────────────────────────────────
 * Два объекта на одной высоте, голос называет, какой разрезать.
 * Неверный рез не разрезает объект: звучит мягкая ошибка, задание остаётся.
 */

/** Все режимы, работающие по логике сравнения: пара объектов + задание голосом */
function isCompareMode(mode) {
    return (
        mode === 'compare' ||
        mode === 'compareLetter' ||
        mode === 'compareNumber' ||
        mode === 'counting'
    );
}

const COMPARE_SHAPES = ['circle', 'square', 'triangle', 'star'];
/**
 * Объекты для заданий на толщину и высоту. Ключ совпадает с именем файла озвучки;
 * emoji — готовая текстура, shape — процедурная фигура.
 */
/**
 * Только процедурные фигуры: сжатие эмодзи по одной оси искажает картинку —
 * банан становится нечитаемым, и задание превращается в угадайку.
 * Озвучка для banana/eggplant записана и ждёт, если решим их вернуть.
 */
/**
 * Карандаш и верёвка временно исключены: при сжатии по X читаются плохо.
 * Озвучка thicker_pencil/thinner_pencil/thicker_rope/thinner_rope лежит на месте —
 * вернуть их сюда, когда появятся отдельные картинки толстой и тонкой версии.
 */
/** Эмодзи-объекты толщины кончились — всё перешло на нарисованные пары */
const COMPARE_THICK_OBJECTS = [];
/**
 * Толщина на готовых спрайтах: две нарисованные версии вместо сжатия по X.
 * Предмет участвует, только когда обе картинки лежат в проекте.
 */
const COMPARE_THICK_SPRITES = [
    { key: 'candle', thick: 'candle_thick', thin: 'candle_thin' },
    { key: 'pencil', thick: 'pencil_thick', thin: 'pencil_thin' },
    { key: 'rope', thick: 'rope_thick', thin: 'rope_thin' },
    { key: 'log', thick: 'log_thick', thin: 'log_thin' },
    /** Линии занимают всю ширину кадра — разводим их дальше, иначе смыкаются */
    { key: 'line', thick: 'line_thick', thin: 'line_thin', spread: 0.28 }
];
/**
 * Длина: у каждого объекта два готовых спрайта — длинный и короткий.
 * Растягивать один нельзя, поэтому пара задаётся картинками, а не масштабом.
 */
const COMPARE_LONG_OBJECTS = [
    { key: 'pencil', long: 'pencil_long', short: 'pencil_short' },
    { key: 'rope', long: 'rope_long', short: 'rope_short' },
    { key: 'bolt', long: 'bolt_long', short: 'bolt_short' },
    { key: 'sock', long: 'sock_long', short: 'sock_short' },
    { key: 'stick', long: 'stick_long', short: 'stick_short' },
    { key: 'rect', long: 'rect_long', short: 'rect_short' }
];
/** Спрайты нарисованы с полями внутри кадра — компенсируем, иначе смотрятся мелко */
const COMPARE_SPRITE_SCALE = 1.2;

const COMPARE_TALL_OBJECTS = [
    { key: 'tower', emoji: '🗼' },
    { key: 'tree', emoji: '🌲' },
    { key: 'house', emoji: '🏢' },
    { key: 'castle', emoji: '🏰' }
];
/* ─── Режим счёта ───────────────────────────────────────────────────────────
 * На экране одинаковые предметы; ребёнок задерживает руку на каждом,
 * голос считает вслух. Посчитанный помечается, повторно не считается.
 */

/** Что считаем. Ключ совпадает с именем файла озвучки: intro_<key> */
const COUNTING_KINDS = [
    { key: 'cat', emoji: '🐱' },
    { key: 'dog', emoji: '🐶' },
    { key: 'rabbit', emoji: '🐰' },
    { key: 'bear', emoji: '🐻' },
    { key: 'panda', emoji: '🐼' },
    { key: 'frog', emoji: '🐸' },
    { key: 'pig', emoji: '🐷' },
    { key: 'fox', emoji: '🦊' },
    { key: 'tiger', emoji: '🐯' },
    { key: 'chick', emoji: '🐤' },
    { key: 'penguin', emoji: '🐧' },
    { key: 'butterfly', emoji: '🦋' },
    { key: 'fish', emoji: '🐟' },
    { key: 'snail', emoji: '🐌' }
];
/** Минимум и максимум предметов в раунде */
const COUNTING_MIN = 3;
const COUNTING_MAX = 10;
/** Пауза перед итогом — чтобы последнее «десять» не наложилось на «Десять котиков» */
const COUNTING_TOTAL_DELAY_MS = 900;
/** Пауза перед новым раундом после итога */
const COUNTING_NEXT_ROUND_MS = 2600;

let countingKind = null;
let countingTotal = 0;
let countingDone = 0;
let countingFinishedAt = 0;
/** Сколько полных пересчётов сделано — по ним считается цель уровня */
let countingRounds = 0;

function resetCountingState() {
    countingKind = null;
    countingTotal = 0;
    countingDone = 0;
    countingFinishedAt = 0;
    countingRounds = 0;
    countingHand = null;
    countHearts = [];
}

/** Длительность радостного прыжка сосчитанного котика */
const COUNT_ANIM_MS = 1100;
/** После прыжка котик плавно тускнеет — видно, что с ним закончили */
const COUNT_FADE_MS = 500;

const easeOutQuad = (u) => 1 - (1 - u) * (1 - u);

/**
 * Кривая радостного прыжка: присел → подпрыгнул, вытянувшись → приземлился
 * с пружинкой → покачался. Squash & stretch делает движение живым,
 * а не механическим подъёмом-опусканием.
 * dy — в долях радиуса (минус — вверх), sx/sy — масштаб, rot — наклон в радианах.
 */
function countJumpPose(ms) {
    const pose = { dy: 0, sx: 1, sy: 1, rot: 0 };
    if (ms >= COUNT_ANIM_MS) return pose;

    if (ms < 120) {
        /** Присел перед прыжком */
        const u = easeOutQuad(ms / 120);
        pose.sx = 1 + 0.22 * u;
        pose.sy = 1 - 0.2 * u;
    } else if (ms < 520) {
        /** Полёт: на взлёте вытянут, к вершине округляется */
        const u = (ms - 120) / 400;
        pose.dy = -Math.sin(Math.PI * u) * 0.8;
        const stretch = Math.cos(Math.PI * u);
        pose.sx = 1 - 0.14 * Math.abs(stretch);
        pose.sy = 1 + 0.2 * Math.abs(stretch);
    } else if (ms < 680) {
        /** Приземление: сплющился и отпружинил */
        const u = (ms - 520) / 160;
        const squash = Math.sin(Math.PI * u);
        pose.sx = 1 + 0.2 * squash;
        pose.sy = 1 - 0.18 * squash;
    } else {
        /** Довольно покачался из стороны в сторону, затухая */
        const u = (ms - 680) / (COUNT_ANIM_MS - 680);
        pose.rot = Math.sin(u * Math.PI * 3) * 0.2 * (1 - u);
    }
    return pose;
}

/**
 * Сердечко, вылетающее из сосчитанного котика. Отдельно от FloatingText:
 * у того тёмная обводка текста, на эмодзи она смотрится грязно.
 */
class CountHeart {
    constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size * (0.7 + Math.random() * 0.5);
        /** Разлёт веером в стороны и вверх — чтобы сердечки не кучковались на номере */
        this.vx = (Math.random() * 2 - 1) * 3.4;
        this.vy = -(3.2 + Math.random() * 2.6);
        this.phase = Math.random() * Math.PI * 2;
        this.life = 1;
        this.emoji = ['💖', '💛', '💚', '💙', '💜', '⭐'][Math.floor(Math.random() * 6)];
    }
    update(dt = 1) {
        this.phase += 0.12 * dt;
        this.x += (this.vx + Math.sin(this.phase) * 0.8) * dt;
        this.y += this.vy * dt;
        this.vy *= 0.975;
        /** ~1.5 с жизни: ребёнок должен успеть их увидеть */
        this.life -= 0.011 * dt;
    }
    draw(ctx) {
        if (this.life <= 0) return;
        const tex = getOrCreateEmojiTexture(this.emoji);
        /** Вырастает в первые мгновения, потом тает */
        const grow = Math.min(1, (1 - this.life) * 6);
        const s = this.size * grow;
        ctx.save();
        /** Полностью яркие большую часть жизни, тают только в самом конце */
        ctx.globalAlpha = Math.min(1, this.life * 3);
        ctx.drawImage(tex.canvas, this.x - s / 2, this.y - s / 2, s, s);
        ctx.restore();
    }
}
let countHearts = [];

function spawnCountHearts(x, y, radius) {
    for (let i = 0; i < 7; i++) countHearts.push(new CountHeart(x, y - radius * 0.2, radius * 0.75));
}

/**
 * Случайная раскладка по всему экрану без наложений.
 *
 * Для каждого предмета бросаем случайные точки и берём первую, где он ни с кем
 * не пересекается. Это честная случайность: способ «самый дальний из кандидатов»
 * разводил котиков слишком ровно, и они снова выстраивались сеткой.
 *
 * Между предметами гарантирован зазор. Если все не поместились, пробуем ещё
 * несколько раскладок того же размера и только потом уменьшаем.
 * Возвращает { spots, radius } — радиус мог уменьшиться.
 */
function countingLayout(n, w, h, radius) {
    /** Поля: сверху HUD со счётом, снизу кнопка «Меню», по бокам край кадра */
    const left = w * 0.06;
    const right = w * 0.94;
    const top = h * 0.17;
    const bottom = h * 0.88;
    const TRIES_PER_ITEM = 120;

    let r = radius;
    for (let attempt = 0; attempt < 60; attempt++) {
        if (attempt > 0 && attempt % 8 === 0) r *= 0.95;
        const minDist = r * 2 + Math.max(26, r * 0.35);
        const spanX = Math.max(1, right - left - r * 2);
        const spanY = Math.max(1, bottom - top - r * 2);
        const spots = [];
        for (let i = 0; i < n; i++) {
            let placed = null;
            for (let t = 0; t < TRIES_PER_ITEM && !placed; t++) {
                const x = left + r + Math.random() * spanX;
                const y = top + r + Math.random() * spanY;
                if (spots.every((s) => Math.hypot(s.x - x, s.y - y) >= minDist)) placed = { x, y };
            }
            if (!placed) break;
            spots.push(placed);
        }
        if (spots.length === n) return { spots, radius: r };
    }
    /** Крайний случай: экран совсем маленький — лучше мелкие котики, чем наложение */
    if (r < 14) return { spots: [], radius: r };
    return countingLayout(n, w, h, r * 0.8);
}

/** Контраст: 1.0 против 0.5 — различие очевидно, но предмет ещё узнаваем */
const COMPARE_AXIS_WIDE = 1.0;
const COMPARE_AXIS_NARROW = 0.5;

/**
 * Предметы для сравнения размеров — ключ совпадает с именем файла озвучки
 * (bigger_apple.mp3), эмодзи берётся из готовых текстур fruitEmojiTextures.
 */
const COMPARE_ITEMS = [
    { key: 'apple', emoji: '🍎' },
    { key: 'banana', emoji: '🍌' },
    { key: 'watermelon', emoji: '🍉' },
    { key: 'orange', emoji: '🍊' },
    { key: 'chicken', emoji: '🍗' },
    { key: 'meat', emoji: '🥩' },
    { key: 'broccoli', emoji: '🥦' },
    { key: 'cabbage', emoji: '🥬' },
    { key: 'eggplant', emoji: '🍆' },
    { key: 'tomato', emoji: '🍅' }
];
/** Контраст размеров фиксированный, не случайный — различие должно читаться однозначно */
const COMPARE_SIZE_BIG = 1.0;
const COMPARE_SIZE_SMALL = 0.5;
/**
 * Выбор удержанием вместо разрезания: ребёнок подносит руку к объекту и держит.
 * Медленное осознанное движение вместо взмаха — и случайный пронос руки
 * над предметом ничего не выбирает.
 */
const HOLD_TO_SELECT_MS = 1000;
/** Пока рука ушла, прогресс спадает плавно — короткий срыв трекинга не сбрасывает всё */
const HOLD_DECAY_MS = 700;
/** Запас к радиусу объекта: попасть точно в центр трудно, особенно мелкому объекту */
const HOLD_RADIUS_BONUS_PX = 46;

/** После стольких ошибок подряд — подсветка нужного объекта и повтор задания */
const COMPARE_HINT_AFTER_ERRORS = 5;
/** Пауза перед следующей парой: прыжок (1.1 с) должен доиграть, а сердечки — разлететься */
const COMPARE_NEXT_ROUND_DELAY_MS = 1600;

/**
 * Антиповтор: помним последние выданные задания и объекты, чтобы подряд
 * не выпадало одно и то же. Ключ задания — kind+taskKey+объект.
 */
const COMPARE_RECENT_LIMIT = 6;
const compareRecentTasks = [];
const compareRecentObjects = [];

function rememberCompareRound(taskSig, objectSig) {
    compareRecentTasks.push(taskSig);
    if (compareRecentTasks.length > 2) compareRecentTasks.shift();
    if (objectSig) {
        compareRecentObjects.push(objectSig);
        if (compareRecentObjects.length > COMPARE_RECENT_LIMIT) compareRecentObjects.shift();
    }
}

/**
 * Выбирает элемент, которого нет среди недавних. Если все недавние — берёт
 * любой, кроме самого последнего, чтобы не зациклиться на коротких списках.
 */
function pickAvoidingRecent(pool, recent, keyOf = (x) => x) {
    const last = recent[recent.length - 1];
    const fresh = pool.filter((x) => !recent.includes(keyOf(x)));
    if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
    /** Все были недавно — берём любой, кроме предыдущего: повтор подряд недопустим */
    const notLast = pool.filter((x) => keyOf(x) !== last);
    const list = notLast.length ? notLast : pool;
    return list[Math.floor(Math.random() * list.length)];
}

/** Текущее задание: { kind: 'size'|'shape', taskKey, correctId } */
let compareTask = null;
let compareErrorStreak = 0;
let compareHintActive = false;
let compareRoundResolved = false;
let compareNextRoundAt = 0;
let compareObjectSeq = 0;

function resetCompareState() {
    compareTask = null;
    compareErrorStreak = 0;
    compareHintActive = false;
    compareRoundResolved = false;
    compareNextRoundAt = 0;
}

/**
 * Собирает пару объектов для нового раунда.
 * Возвращает { objects: [{id, shape, sizeScale}, …], task }.
 */
function buildCompareRound() {
    const mode = getCurrentLevelConfig().mode;
    const idA = ++compareObjectSeq;
    const idB = ++compareObjectSeq;

    /** Буквы и цифры: пара глифов, различие только в символе */
    if (mode === 'compareLetter' || mode === 'compareNumber') {
        const isLetter = mode === 'compareLetter';
        const pool = isLetter ? CYRILLIC_LETTERS.slice() : Array.from({ length: 10 }, (_, i) => String(i + 1));
        const a = pickAvoidingRecent(pool, compareRecentObjects);
        const rest = pool.filter((x) => x !== a);
        const b = rest[Math.floor(Math.random() * rest.length)];
        const askFirst = Math.random() < 0.5;
        const objects = [
            { id: idA, glyph: a, sizeScale: COMPARE_SIZE_BIG },
            { id: idB, glyph: b, sizeScale: COMPARE_SIZE_BIG }
        ];
        const pick = askFirst ? a : b;
        rememberCompareRound(`${mode}:${pick}`, pick);
        return {
            objects,
            task: {
                kind: isLetter ? 'letter' : 'number',
                /** Ключ озвучки = сам символ: tasks/ru/letters/а.mp3, tasks/ru/numbers/3.mp3 */
                taskKey: isLetter ? pick.toLowerCase() : pick,
                correctId: askFirst ? idA : idB
            }
        };
    }

    /**
     * Объединённое сравнение: размер, форма, толщина и высота идут вперемешку.
     * Тип задания выбирается с учётом недавних, чтобы подряд не шло одно и то же.
     */
    /** В длину идут только объекты, у которых обе картинки реально лежат в проекте */
    const readyLongObjects = COMPARE_LONG_OBJECTS.filter(
        (o) => objectSpriteUrlByKey[o.long] && objectSpriteUrlByKey[o.short]
    );
    /** Толщина полностью на спрайтах — без картинок этот тип не предлагаем */
    const readyThickObjects = COMPARE_THICK_SPRITES.filter(
        (o) => objectSpriteUrlByKey[o.thick] && objectSpriteUrlByKey[o.thin]
    );
    const kinds = ['size', 'shape', 'height'];
    if (COMPARE_THICK_OBJECTS.length || readyThickObjects.length) kinds.push('thickness');
    if (readyLongObjects.length) kinds.push('length');
    const kind = pickAvoidingRecent(kinds, compareRecentTasks);

    if (kind === 'length') {
        const obj = pickAvoidingRecent(readyLongObjects, compareRecentObjects.slice(-3), (o) => o.key);
        const askLonger = Math.random() < 0.5;
        const longFirst = Math.random() < 0.5;
        /** Спрайты пары уже нарисованы в общем масштабе — своё масштабирование не нужно */
        const objects = [
            { id: idA, sprite: longFirst ? obj.long : obj.short },
            { id: idB, sprite: longFirst ? obj.short : obj.long }
        ];
        const longId = longFirst ? idA : idB;
        const shortId = longFirst ? idB : idA;
        rememberCompareRound('length', obj.key);
        return {
            objects,
            task: {
                kind: 'length',
                taskKey: askLonger ? 'longer' : 'shorter',
                shape: obj.key,
                correctId: askLonger ? longId : shortId
            }
        };
    }

    if (kind === 'thickness' || kind === 'height') {
        const isThick = kind === 'thickness';
        /** У толщины спрайтовые пары идут наравне с эмодзи — выбор из общего списка */
        const pool = isThick ? [...COMPARE_THICK_OBJECTS, ...readyThickObjects] : COMPARE_TALL_OBJECTS;
        /** Внутри своего типа: списки короткие, повтор был бы заметен */
        const obj = pickAvoidingRecent(pool, compareRecentObjects.slice(-3), (o) => o.key);
        const askMore = Math.random() < 0.5;

        /** Готовая пара картинок — масштабировать нечего, берём как есть */
        if (obj.thick) {
            const thickFirst = Math.random() < 0.5;
            const objects = [
                { id: idA, sprite: thickFirst ? obj.thick : obj.thin, spread: obj.spread },
                { id: idB, sprite: thickFirst ? obj.thin : obj.thick, spread: obj.spread }
            ];
            const thickId = thickFirst ? idA : idB;
            const thinId = thickFirst ? idB : idA;
            rememberCompareRound('thickness', obj.key);
            return {
                objects,
                task: {
                    kind: 'thickness',
                    taskKey: askMore ? 'thicker' : 'thinner',
                    shape: obj.key,
                    correctId: askMore ? thickId : thinId
                }
            };
        }

        const wideFirst = Math.random() < 0.5;
        const base = obj.emoji ? { emoji: obj.emoji } : { shape: obj.shape };

        /**
         * Толщина — сжатие по X при неизменной высоте: у вытянутых предметов это
         * читается как «тоньше», предмет остаётся узнаваемым.
         * Высота — общий масштаб, причём мягкий: 0.5 по обеим осям даёт четверть
         * площади и читается как «далеко», а не «ниже».
         */
        const tallNarrow = 0.68;
        const axis = (v) => {
            if (isThick) return { scaleX: v, scaleY: 1 };
            const k = v === COMPARE_AXIS_WIDE ? 1 : tallNarrow;
            return { scaleX: k, scaleY: k };
        };
        const objects = [
            { id: idA, ...base, ...axis(wideFirst ? COMPARE_AXIS_WIDE : COMPARE_AXIS_NARROW) },
            { id: idB, ...base, ...axis(wideFirst ? COMPARE_AXIS_NARROW : COMPARE_AXIS_WIDE) }
        ];
        const wideId = wideFirst ? idA : idB;
        const narrowId = wideFirst ? idB : idA;
        const taskKey = isThick ? (askMore ? 'thicker' : 'thinner') : askMore ? 'taller' : 'lower';
        rememberCompareRound(kind, obj.key);
        return {
            objects,
            task: { kind: isThick ? 'thickness' : 'height', taskKey, shape: obj.key, correctId: askMore ? wideId : narrowId }
        };
    }

    if (kind === 'size') {
        /**
         * Один и тот же объект — различается только размер, иначе сравнение неоднозначно.
         * Берём и геометрические фигуры, и предметы: озвучка записана для всех 14.
         */
        const useItem = Math.random() < 0.5;
        const picked = useItem
            ? pickAvoidingRecent(COMPARE_ITEMS, compareRecentObjects, (o) => o.key)
            : pickAvoidingRecent(COMPARE_SHAPES, compareRecentObjects);
        const objectKey = useItem ? picked.key : picked;
        const base = useItem ? { emoji: picked.emoji } : { shape: picked };

        const askBigger = Math.random() < 0.5;
        const bigFirst = Math.random() < 0.5;
        const objects = [
            { id: idA, ...base, sizeScale: bigFirst ? COMPARE_SIZE_BIG : COMPARE_SIZE_SMALL },
            { id: idB, ...base, sizeScale: bigFirst ? COMPARE_SIZE_SMALL : COMPARE_SIZE_BIG }
        ];
        const bigId = bigFirst ? idA : idB;
        const smallId = bigFirst ? idB : idA;
        rememberCompareRound('size', objectKey);
        return {
            objects,
            task: {
                kind: 'size',
                taskKey: askBigger ? 'bigger' : 'smaller',
                /** Объект пары — озвучка согласована по роду: «большой круг», «большую звезду» */
                shape: objectKey,
                correctId: askBigger ? bigId : smallId
            }
        };
    }

    /** Разные фигуры одного размера — различается только форма */
    const shapeA = pickAvoidingRecent(COMPARE_SHAPES, compareRecentObjects);
    const restShapes = COMPARE_SHAPES.filter((s) => s !== shapeA);
    const shapeB = restShapes[Math.floor(Math.random() * restShapes.length)];
    const askFirst = Math.random() < 0.5;
    const objects = [
        { id: idA, shape: shapeA, sizeScale: COMPARE_SIZE_BIG },
        { id: idB, shape: shapeB, sizeScale: COMPARE_SIZE_BIG }
    ];
    const pickedShape = askFirst ? shapeA : shapeB;
    rememberCompareRound('shape', pickedShape);
    return {
        objects,
        task: { kind: 'shape', taskKey: pickedShape, correctId: askFirst ? idA : idB }
    };
}

/** Раскладывает предметы для счёта и произносит вступление */
function startCountingRound() {
    const { w, h, minSide } = gameLayout;
    fruits.length = 0;
    countHearts = [];
    /** Не повторяем вид из прошлого раунда — разнообразие держит внимание */
    const prevKey = countingKind?.key;
    const pool = COUNTING_KINDS.filter((k) => k.key !== prevKey);
    countingKind = pool[Math.floor(Math.random() * pool.length)];
    countingTotal = COUNTING_MIN + Math.floor(Math.random() * (COUNTING_MAX - COUNTING_MIN + 1));
    countingDone = 0;
    countingFinishedAt = 0;

    const { spots, radius } = countingLayout(countingTotal, w, h, Math.min(150, Math.max(54, minSide * 0.105)));
    /** Если экран не вместил всех, считаем столько, сколько поставили — итог должен совпасть */
    countingTotal = spots.length;
    spots.forEach((p, i) => {
        fruits.push(new Fruit({ counting: true, id: i + 1, x: p.x, y: p.y, radius, emoji: countingKind.emoji }));
    });

    /** Пауза: сначала ребёнок видит предметы, потом слышит задание */
    setTimeout(() => playCountingSound(`intro_${countingKind.key}`), 450);
}

/** Ставит на экран новую пару и озвучивает задание */
function startCompareRound() {
    const round = buildCompareRound();
    fruits.length = 0;
    compareTask = round.task;
    compareErrorStreak = 0;
    compareHintActive = false;
    compareRoundResolved = false;

    /** Слот решает только положение по X — какой объект слева, выбирается случайно */
    const slots = [0, 1];
    shuffleArrayInPlace(slots);
    /**
     * В раундах на размер цвет одинаковый — иначе ребёнок начнёт различать по цвету,
     * а не по величине. В раундах на форму цвета разные, чтобы предметы не сливались.
     */
    const palette = GLYPH_NEON_COLORS.slice();
    shuffleArrayInPlace(palette);
    /** Разные цвета только там, где сравниваются сами объекты (формы, буквы, цифры).
     *  Для свойств цвет общий — иначе ребёнок различает по цвету, а не по признаку. */
    const sameColor = round.task.kind === 'size' || round.task.kind === 'thickness' || round.task.kind === 'height';
    round.objects.forEach((spec, idx) => {
        fruits.push(new Fruit({ ...spec, slot: slots[idx], color: sameColor ? palette[0] : palette[idx] }));
    });

    /** Небольшая пауза: сначала ребёнок видит пару, потом слышит задание */
    setTimeout(() => playTaskSound(round.task.taskKey, round.task.shape, round.task.kind), 450);
}

/** Буквы и цифры: только небольшой наклон и лёгкое качание (без полного оборота и «нечитаемых» углов) */
const GLYPH_MAX_TILT_RAD = (14 * Math.PI) / 180;
const GLYPH_ROT_SPEED_RANGE = 0.008;

function parseGlyphHex(hex) {
    const h = (hex || '#00f3ff').replace('#', '');
    if (h.length === 3) {
        return {
            r: parseInt(h[0] + h[0], 16),
            g: parseInt(h[1] + h[1], 16),
            b: parseInt(h[2] + h[2], 16)
        };
    }
    if (h.length === 6) {
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16)
        };
    }
    return { r: 0, g: 243, b: 255 };
}

function clampByte(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
}

/** Геометрия фигур в долях от половины стороны текстуры — единый визуальный вес */
function traceShapePath(ctx, shape, cx, cy, r) {
    ctx.beginPath();
    if (shape === 'stick') {
        /** Палочка: скруглённый брусок с «древесными» торцами */
        const w = r * 1.25;
        const h = r * 1.95;
        ctx.roundRect(cx - w / 2, cy - h / 2, w, h, w * 0.42);
        ctx.closePath();
        return;
    }
    if (shape === 'line') {
        /**
         * Вертикальная полоса, а не горизонтальная: толщину задаёт scaleX,
         * и у лежачей линии он менял бы длину — «толще» выглядело бы как «длиннее».
         */
        const w = r * 0.95;
        const h = r * 1.95;
        ctx.rect(cx - w / 2, cy - h / 2, w, h);
        ctx.closePath();
        return;
    }
    if (shape === 'tower') {
        /** Башня: корпус, зубцы наверху и основание — силуэт узнаваем без подписи */
        const w = r * 1.22;
        const h = r * 1.9;
        const top = cy - h / 2;
        const bot = cy + h / 2;
        const merlon = w / 5;
        ctx.moveTo(cx - w / 2, bot);
        ctx.lineTo(cx - w / 2, top + merlon * 0.8);
        /** Пять зубцов: вверх-вправо-вниз-вправо, как на крепостной стене */
        for (let i = 0; i < 5; i++) {
            const x0 = cx - w / 2 + i * merlon;
            if (i % 2 === 0) {
                ctx.lineTo(x0, top);
                ctx.lineTo(x0 + merlon, top);
            } else {
                ctx.lineTo(x0, top + merlon * 0.8);
                ctx.lineTo(x0 + merlon, top + merlon * 0.8);
            }
        }
        ctx.lineTo(cx + w / 2, top + merlon * 0.8);
        ctx.lineTo(cx + w / 2, bot);
        ctx.closePath();
        return;
    }
    if (shape === 'column') {
        /** Столбик: ствол с расширенными базой и капителью */
        const w = r * 0.86;
        const h = r * 1.9;
        const capH = h * 0.13;
        const capW = w * 1.5;
        const top = cy - h / 2;
        const bot = cy + h / 2;
        ctx.roundRect(cx - capW / 2, top, capW, capH, capH * 0.3);
        ctx.roundRect(cx - w / 2, top + capH * 0.85, w, h - capH * 1.7, w * 0.12);
        ctx.roundRect(cx - capW / 2, bot - capH, capW, capH, capH * 0.3);
        return;
    }
    if (shape === 'rect') {
        const w = r * 1.5;
        const h = r * 1.9;
        ctx.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.1);
        ctx.closePath();
        return;
    }
    if (shape === 'circle') {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (shape === 'square') {
        const s = r * 1.72;
        ctx.rect(cx - s / 2, cy - s / 2, s, s);
    } else if (shape === 'triangle') {
        /** Равносторонний, центр тяжести в cy — иначе визуально «падает» вниз */
        const h = r * 1.86;
        ctx.moveTo(cx, cy - h * 0.58);
        ctx.lineTo(cx + h * 0.5, cy + h * 0.42);
        ctx.lineTo(cx - h * 0.5, cy + h * 0.42);
        ctx.closePath();
    } else {
        const spikes = 5;
        const outer = r;
        const inner = r * 0.46;
        for (let i = 0; i < spikes * 2; i++) {
            const rad = i % 2 === 0 ? outer : inner;
            const a = (Math.PI / spikes) * i - Math.PI / 2;
            const px = cx + Math.cos(a) * rad;
            const py = cy + Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }
}

/**
 * Красный силуэт фигуры для вспышки ошибки. Рисуется в отдельном буфере через
 * source-atop, чтобы подкрасить только саму фигуру, а не видео под ней.
 */
const errorTintCache = new WeakMap();
function getErrorTintTexture(textureRef) {
    let hit = errorTintCache.get(textureRef);
    if (hit) return hit;
    const size = textureRef.size;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const tctx = c.getContext('2d');
    tctx.drawImage(textureRef.canvas, 0, 0);
    tctx.globalCompositeOperation = 'source-atop';
    tctx.fillStyle = '#ff2d55';
    tctx.fillRect(0, 0, size, size);
    errorTintCache.set(textureRef, c);
    return c;
}

/** Текстура геометрической фигуры — тот же неоновый стиль, что у букв/цифр */
function getOrCreateShapeTexture(shape, color) {
    const versionedKey = `s1:${shape}:${color}`;
    let hit = glyphTextureCache.get(versionedKey);
    if (hit) return hit;
    const size = 600;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.36;
    const rgb = parseGlyphHex(color);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.092;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    traceShapePath(ctx, shape, cx, cy, r);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(
        0,
        `rgb(${clampByte(rgb.r * 1.28)},${clampByte(rgb.g * 1.28)},${clampByte(rgb.b * 1.28)})`
    );
    grad.addColorStop(1, `rgb(${clampByte(rgb.r * 0.72)},${clampByte(rgb.g * 0.72)},${clampByte(rgb.b * 0.72)})`);
    ctx.fillStyle = grad;
    traceShapePath(ctx, shape, cx, cy, r);
    ctx.fill();

    /** Без тёмной обводки: она выглядела чужеродно и «утяжеляла» предметы */

    hit = { canvas: c, size };
    glyphTextureCache.set(versionedKey, hit);
    return hit;
}

function getOrCreateGlyphTexture(cacheKey, label, color) {
    const versionedKey = `g3:${cacheKey}`;
    let hit = glyphTextureCache.get(versionedKey);
    if (hit) return hit;
    const size = 600;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const fp = glyphFontPx(label, size);
    ctx.font = `900 ${fp}px "Outfit", "Segoe UI", system-ui, sans-serif`;
    const dy = 10;
    const cx = size / 2;
    const cy = size / 2 + dy;
    const rgb = parseGlyphHex(color);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.092;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fillText(label, cx, cy);
    ctx.restore();
    ctx.globalAlpha = 1;

    /** Без контура: от видео букву отделяет неоновое свечение под заливкой */

    const grad = ctx.createLinearGradient(cx - fp * 0.38, cy - fp * 0.42, cx + fp * 0.34, cy + fp * 0.48);
    grad.addColorStop(
        0,
        `rgb(${clampByte(rgb.r * 1.28)},${clampByte(rgb.g * 1.28)},${clampByte(rgb.b * 1.28)})`
    );
    grad.addColorStop(0.5, color);
    grad.addColorStop(
        1,
        `rgb(${clampByte(rgb.r * 0.5)},${clampByte(rgb.g * 0.5)},${clampByte(rgb.b * 0.5)})`
    );
    ctx.fillStyle = grad;
    ctx.fillText(label, cx, cy);

    hit = { canvas: c, size };
    glyphTextureCache.set(versionedKey, hit);
    return hit;
}

class Fruit {
    /** compareSpec — объект из buildCompareRound(); задаёт статичную пару вместо подброса */
    constructor(compareSpec = null) {
        const { w, h, minSide } = gameLayout;
        const levelCfg = getCurrentLevelConfig();
        this.levelMode = levelCfg.mode || 'fruit';

        if (compareSpec?.counting) {
            this.initCounting(compareSpec, minSide);
            return;
        }
        if (compareSpec) {
            this.initCompare(compareSpec, w, h, minSide);
            return;
        }

        this.x = Math.random() * w * 0.8 + w * 0.1;
        this.y = h + 50;
        const span = Math.min(w, h * 1.35);
        this.vx = (Math.random() - 0.5) * span * 0.009;
        this.gravity = 0.4;
        const maxRise = h * 0.88 + 48;
        const vyCap = Math.sqrt(2 * this.gravity * maxRise);
        const vyWant = Math.random() * 14 + 16;
        this.vy = -Math.min(vyWant, vyCap);
        const rLo = minSide * 0.068;
        const rHi = minSide * 0.108;
        let r = Math.min(160, Math.max(36, rLo + Math.random() * (rHi - rLo)));
        if (this.levelMode !== 'fruit') {
            r = Math.min(GLYPH_RADIUS_CAP_PX, Math.max(54, r * GLYPH_RADIUS_SCALE));
        }
        this.radius = r;

        if (this.levelMode === 'fruit') {
            const fruitTypes = [
                { emoji: '🍌', color: '#ffe135' }, // Banana yellow
                { emoji: '🍎', color: '#ff0800' }, // Apple red
                { emoji: '🍉', color: '#fc3a52' }, // Watermelon pink/red
                { emoji: '🍊', color: '#ffa500' }, // Orange
                { emoji: '🍗', color: '#ffcc80' }, // Chicken leg beige
                { emoji: '🥩', color: '#d32f2f' }, // Steak red
                { emoji: '🥦', color: '#4caf50' }, // Broccoli green
                { emoji: '🥬', color: '#8bc34a' }, // Cabbage light green
                { emoji: '🍆', color: '#9c27b0' }, // Eggplant purple
                { emoji: '🍅', color: '#e53935' }  // Tomato red
            ];
            const type = fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
            this.emoji = type.emoji;
            this.color = type.color;
            this.textureRef = fruitEmojiTextures[this.emoji];
            playSpawnVoice(this.emoji);
        } else if (this.levelMode === 'letter') {
            this.emoji = null;
            const alphabet = letterAlphabetForUiLang();
            const ch = alphabet[sequentialLetterIndex];
            sequentialLetterIndex = (sequentialLetterIndex + 1) % alphabet.length;
            this.glyphChar = ch;
            this.color = GLYPH_NEON_COLORS[Math.floor(Math.random() * GLYPH_NEON_COLORS.length)];
            const cacheKey = `ltr:${ch}:${this.color}`;
            this.textureRef = getOrCreateGlyphTexture(cacheKey, ch, this.color);
            playLetterSpawnSound(ch);
        } else if (this.levelMode === 'word') {
            this.emoji = null;
            const ch = pickWordSpawnChar();
            this.glyphChar = ch;
            this.color = GLYPH_NEON_COLORS[Math.floor(Math.random() * GLYPH_NEON_COLORS.length)];
            const cacheKey = `ltr:${ch}:${this.color}`;
            this.textureRef = getOrCreateGlyphTexture(cacheKey, ch, this.color);
            playLetterSpawnSound(ch);
        } else {
            this.emoji = null;
            const n = sequentialSpawnNumber;
            sequentialSpawnNumber =
                sequentialSpawnNumber >= NUMBER_SPAWN_CYCLE_MAX ? 1 : sequentialSpawnNumber + 1;
            const label = String(n);
            this.color = GLYPH_NEON_COLORS[Math.floor(Math.random() * GLYPH_NEON_COLORS.length)];
            const cacheKey = `num:${n}:${this.color}`;
            this.textureRef = getOrCreateGlyphTexture(cacheKey, label, this.color);
            playNumberSpawnSound(n);
        }

        this.isSliced = false;
        this.sliceOffsetX = 0;
        this.hitFlash = 0;
        /** Путь «вошёл в предмет» vs «ещё внутри» — один рез на один проход руки */
        this._wasTouchingHand = false;
        /** Сколько кадров подряд нет пересечения (сброс _wasTouchingHand только после дебаунса) */
        this._noContactFrames = 0;

        if (this.levelMode === 'fruit') {
            this.rotation = Math.random() * Math.PI * 2;
            this.rotationSpeed = (Math.random() - 0.5) * 0.1;
        } else {
            this.rotation = (Math.random() * 2 - 1) * GLYPH_MAX_TILT_RAD * 0.9;
            this.rotationSpeed = (Math.random() * 2 - 1) * GLYPH_ROT_SPEED_RANGE;
        }

        this.cutAngle = 0;
        this.rot1 = 0;
        this.rot2 = 0;
        this.rotSpeed1 = 0;
        this.rotSpeed2 = 0;
    }

    /**
     * Статичный объект пары: висит на месте, без гравитации и подброса.
     * Позиция по X задаётся слотом (левый/правый), Y общий — различие только в предмете.
     */
    /**
     * Счётный предмет. Переиспользует isCompareObject, чтобы работала та же
     * механика удержания; отличается тем, что после счёта не исчезает,
     * а помечается номером — ребёнок должен видеть, что уже сосчитано.
     */
    initCounting(spec, minSide) {
        this.isCompareObject = true;
        this.isCountingObject = true;
        this.compareId = spec.id;
        this.x = spec.x;
        this.y = spec.y;
        this.vx = 0;
        this.vy = 0;
        this.gravity = 0;
        /** Радиус задаёт раскладка: на тесном экране она могла его уменьшить */
        this.radius = spec.radius ?? Math.min(150, Math.max(54, minSide * 0.105));
        this.emoji = spec.emoji;
        this.textureRef = getOrCreateEmojiTexture(spec.emoji);
        this.color = '#7CFFB2';

        this.isSliced = false;
        this.sliceOffsetX = 0;
        this.hitFlash = 0;
        this._wasTouchingHand = false;
        this._noContactFrames = 0;
        this.hintPulse = 0;
        this.errorFlash = 0;
        this.holdProgress = 0;
        this.holdLocked = false;
        /** Номер, под которым предмет сосчитан; 0 — ещё не считали */
        this.countNumber = 0;
        /** Всплытие номера после счёта: 1 → 0 */
        this.countPop = 0;
        /** Сколько мс прошло с момента счёта — двигает анимацию прыжка */
        this.countAnimMs = 0;

        this.rotation = 0;
        this.rotationSpeed = 0;
        this.scaleX = 1;
        this.scaleY = 1;
        this.cutAngle = 0;
        this.rot1 = 0;
        this.rot2 = 0;
        this.rotSpeed1 = 0;
        this.rotSpeed2 = 0;
    }

    initCompare(spec, w, h, minSide) {
        /** Помечаем объект как участника сравнения — режимов сравнения несколько */
        this.isCompareObject = true;
        this.compareId = spec.id;
        this.compareShape = spec.shape;
        /** Разнесены шире, чтобы не наезжать на игрока в центре кадра, но оба в поле зрения */
        /** spread — насколько пара разведена от центра; широким объектам нужно больше */
        const spread = spec.spread ?? 0.2;
        this.x = w * (spec.slot === 0 ? 0.5 - spread : 0.5 + spread);
        this.y = h * 0.46;
        this.vx = 0;
        this.vy = 0;
        this.gravity = 0;
        /**
         * Пол и потолок применяем к большому объекту, а маленький берём долей от него.
         * Иначе на узких экранах оба упирались бы в минимум и разница в размере исчезала.
         */
        const baseRadius = Math.min(235, Math.max(66, minSide * 0.173));
        this.radius = baseRadius * (spec.sizeScale ?? 1);
        /**
         * Толщина и высота меняются по одной оси: «толще» — шире при той же высоте,
         * «выше» — длиннее при той же ширине. Радиус для коллизии берём по большей стороне.
         */
        this.scaleX = spec.scaleX ?? 1;
        this.scaleY = spec.scaleY ?? 1;
        if (spec.scaleX || spec.scaleY) {
            this.radius = baseRadius * Math.max(this.scaleX, this.scaleY) * 0.75;
        }
        this.emoji = null;
        this.color = spec.color || GLYPH_NEON_COLORS[Math.floor(Math.random() * GLYPH_NEON_COLORS.length)];
        if (spec.sprite) {
            /** Готовая картинка: зеркало не компенсируем, как и у эмодзи */
            this.emoji = spec.sprite;
            this.textureRef = getOrCreateSpriteTexture(spec.sprite);
            this.radius *= COMPARE_SPRITE_SCALE;
        } else if (spec.emoji) {
            this.emoji = spec.emoji;
            this.textureRef = getOrCreateEmojiTexture(spec.emoji);
        } else if (spec.glyph) {
            this.glyphChar = spec.glyph;
            this.textureRef = getOrCreateGlyphTexture(`cmp:${spec.glyph}:${this.color}`, spec.glyph, this.color);
        } else {
            this.textureRef = getOrCreateShapeTexture(spec.shape, this.color);
        }

        this.isSliced = false;
        this.sliceOffsetX = 0;
        this.hitFlash = 0;
        this._wasTouchingHand = false;
        this._noContactFrames = 0;
        /** Фаза пульсации подсказки — растёт только когда подсветка включена */
        this.hintPulse = 0;
        /** Красная вспышка при неверном выборе: 1 → 0, затухает за ~0.5 с */
        this.errorFlash = 0;
        /** Прогресс удержания руки на объекте: 0 → 1, при 1 выбор засчитан */
        this.holdProgress = 0;
        /** После ошибки накопление заблокировано, пока рука не уйдёт с объекта */
        this.holdLocked = false;

        this.rotation = 0;
        this.rotationSpeed = 0;
        this.cutAngle = 0;
        this.rot1 = 0;
        this.rot2 = 0;
        this.rotSpeed1 = 0;
        this.rotSpeed2 = 0;
    }

    /**
     * Кольцо прогресса удержания. Рисуется отдельным проходом, вне draw(),
     * потому что там действуют поворот объекта и компенсация зеркала —
     * кольцо от них бы перекосилось и поехало.
     */
    /**
     * Номер сосчитанного предмета. Ребёнок должен видеть, что уже посчитано,
     * иначе он теряет место и пересчитывает по кругу — в тетради ту же роль
     * играет карандашная пометка. Номер, а не галочка: связывает предмет с числом.
     */
    drawCountBadge(ctx) {
        if (!this.isCountingObject || this.countNumber <= 0) return;
        const pop = this.countPop;
        const r = this.radius * 0.42 * (1 + pop * 0.35);
        const cx = this.x;
        /** Номер подпрыгивает вместе с котиком */
        const cy = this.y - this.radius * 0.72 + countJumpPose(this.countAnimMs).dy * this.radius;

        ctx.save();
        ctx.translate(cx, cy);
        /** Canvas зеркалится через CSS scaleX(-1) — компенсируем, иначе цифра задом наперёд */
        ctx.scale(-1, 1);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 28, 20, 0.86)';
        ctx.fill();
        ctx.lineWidth = Math.max(3, r * 0.16);
        ctx.strokeStyle = '#7CFFB2';
        ctx.shadowColor = '#7CFFB2';
        ctx.shadowBlur = 14 + pop * 22;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#eafff2';
        ctx.font = `900 ${Math.round(r * 1.25)}px "Outfit", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(this.countNumber), 0, r * 0.04);
        ctx.restore();
    }

    drawHoldRing(ctx) {
        if (!this.isCompareObject || this.isSliced || this.holdProgress <= 0.01) return;
        /** Кольцо шире самого объекта — иначе оно липнет к картинке и мешает её рассмотреть */
        const r = this.radius + HOLD_RADIUS_BONUS_PX * 0.9;
        const p = this.holdProgress;

        ctx.save();
        ctx.translate(this.x, this.y);

        /** Тёмная подложка — кольцо должно читаться на любом фоне камеры */
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(8, 12, 22, 0.55)';
        ctx.lineWidth = 14;
        ctx.stroke();

        /**
         * Радуга вдоль дуги. Canvas не умеет градиент по окружности, поэтому
         * рисуем короткими сегментами с нахлёстом — стыков не видно.
         */
        const start = -Math.PI / 2;
        const total = p * Math.PI * 2;
        const steps = Math.max(8, Math.round(p * 56));
        const stepAng = total / steps;
        ctx.lineCap = 'round';
        ctx.lineWidth = 11;
        ctx.shadowBlur = 16;
        for (let i = 0; i < steps; i++) {
            /** Оттенок берём по доле всей дуги: радуга целиком укладывается в заполненную часть */
            const hue = (i / steps) * 300;
            const color = `hsl(${hue}, 92%, 62%)`;
            ctx.beginPath();
            /** Нахлёст в полсегмента — иначе на стыках просвечивает подложка */
            const to = Math.min(start + total, start + (i + 1.5) * stepAng);
            ctx.arc(0, 0, r, start + i * stepAng, to);
            ctx.strokeStyle = color;
            ctx.shadowColor = color;
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Нужный объект в текущем задании — для подсветки и проверки реза */
    get isCompareCorrect() {
        return compareTask != null && this.compareId === compareTask.correctId;
    }

    update(dt = 1) {
        if (this.isCompareObject) {
            if (this.hitFlash > 0) this.hitFlash -= 0.35 * dt;
            /** ~0.9 с на затухание: ребёнку нужно время заметить и связать с действием */
            if (this.errorFlash > 0) this.errorFlash = Math.max(0, this.errorFlash - 0.0185 * dt);
            if (this.countPop > 0) this.countPop = Math.max(0, this.countPop - 0.045 * dt);
            if ((this.countNumber > 0 || this.celebrating) && this.countAnimMs < COUNT_ANIM_MS + COUNT_FADE_MS) {
                this.countAnimMs += dt * (1000 / 60);
            }
            if (compareHintActive && this.isCompareCorrect && !this.isSliced) {
                this.hintPulse += 0.09 * dt;
            }
            if (this.isSliced) {
                this.sliceOffsetX += 6 * dt;
                this.rot1 += this.rotSpeed1 * dt;
                this.rot2 += this.rotSpeed2 * dt;
            }
            return;
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy += this.gravity * dt;

        if (this.hitFlash > 0) this.hitFlash -= 0.35 * dt;

        if (!this.isSliced) {
            this.rotation += this.rotationSpeed * dt;
            if (this.levelMode !== 'fruit') {
                if (this.rotation > GLYPH_MAX_TILT_RAD) {
                    this.rotation = GLYPH_MAX_TILT_RAD;
                    this.rotationSpeed = -Math.abs(this.rotationSpeed);
                } else if (this.rotation < -GLYPH_MAX_TILT_RAD) {
                    this.rotation = -GLYPH_MAX_TILT_RAD;
                    this.rotationSpeed = Math.abs(this.rotationSpeed);
                }
            }
        } else {
            this.sliceOffsetX += 6 * dt;
            this.rot1 += this.rotSpeed1 * dt;
            this.rot2 += this.rotSpeed2 * dt;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        /** Canvas на экране зеркалится через CSS scaleX(-1) — компенсируем только текст/буквы, чтобы читалось нормально */
        /** Компенсируем зеркало только для текста и фигур; эмодзи от разворота «ломаются» */
        const compensateCssMirror = this.levelMode !== 'fruit' && !this.emoji;
        if (compensateCssMirror) ctx.scale(-1, 1);

        const texture = this.textureRef.canvas;
        const texSize = this.textureRef.size;
        const drawSize = this.radius * 2;
        
        if (!this.isSliced) {
            ctx.rotate(this.rotation);
            /** Растяжение по одной оси — для заданий на толщину и высоту */
            const sx = this.scaleX ?? 1;
            const sy = this.scaleY ?? 1;
            if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
            /** Красная вспышка ошибки перекрывает подсказку — это ответ на действие прямо сейчас */
            if (this.isCompareObject && this.errorFlash > 0) {
                ctx.shadowColor = '#ff2d55';
                ctx.shadowBlur = 26 + this.errorFlash * 44;
            } else if (this.isCompareObject && compareHintActive && this.isCompareCorrect) {
                const pulse = 0.5 + 0.5 * Math.sin(this.hintPulse);
                ctx.shadowColor = '#7CFFB2';
                ctx.shadowBlur = 30 + pulse * 34;
            } else if (this.hitFlash > 0) {
                ctx.shadowColor = '#00f3ff';
                const blurBase = this.levelMode === 'fruit' ? 18 : 26;
                ctx.shadowBlur = blurBase + this.hitFlash * 2;
            }
            if ((this.isCountingObject && this.countNumber > 0) || this.celebrating) {
                /** Прыжок с опорой на «пол»: сплющивание идёт от нижнего края, как у мячика */
                const pose = countJumpPose(this.countAnimMs);
                ctx.translate(0, drawSize / 2 + pose.dy * this.radius);
                ctx.rotate(pose.rot);
                ctx.scale(pose.sx, pose.sy);
                ctx.translate(0, -drawSize / 2);
                /** Сосчитанный котик после прыжка тускнеет — отметка «готово». В сравнении раунд и так сменится */
                if (this.isCountingObject) {
                    const fadeU = Math.min(1, Math.max(0, (this.countAnimMs - COUNT_ANIM_MS) / COUNT_FADE_MS));
                    ctx.globalAlpha = 1 - 0.55 * fadeU;
                }
            }
            ctx.drawImage(texture, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            /** Подкрашиваем сам силуэт — на яркой фигуре одного свечения не видно */
            if (this.isCompareObject && this.errorFlash > 0) {
                const tint = getErrorTintTexture(this.textureRef);
                ctx.save();
                ctx.globalAlpha = 0.65 * this.errorFlash;
                ctx.drawImage(tint, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
                ctx.restore();
            }
        } else {
            ctx.save();
            ctx.translate(Math.cos(this.cutAngle + Math.PI) * this.sliceOffsetX, Math.sin(this.cutAngle + Math.PI) * this.sliceOffsetX);
            ctx.rotate(this.rot1);
            ctx.drawImage(
                texture,
                0, 0, texSize / 2, texSize,
                -drawSize / 2, -drawSize / 2,
                drawSize / 2, drawSize
            );
            ctx.restore();

            ctx.save();
            ctx.translate(Math.cos(this.cutAngle) * this.sliceOffsetX, Math.sin(this.cutAngle) * this.sliceOffsetX);
            ctx.rotate(this.rot2);
            ctx.drawImage(
                texture,
                texSize / 2, 0, texSize / 2, texSize,
                0, -drawSize / 2,
                drawSize / 2, drawSize
            );
            ctx.restore();
        }
        ctx.restore();
    }
}

/**
 * Режим «Доски»: статичная деревянная доска-мишень в случайном месте экрана.
 * Разбивается только ударом (быстрым движением) руки ИЛИ ноги — медленное касание не считается,
 * чтобы доска не ломалась, просто появившись рядом с игроком.
 */
const BOARD_MIN_STRIKE_SPEED_PX = 7;      // минимальный сдвиг за кадр 60fps (~420 px/с) для засчёта удара
const BOARD_SPAWN_ARM_FRAMES = 20;        // ~0.33 с pop-in анимации, в это время доска не бьётся
const BOARD_LIFETIME_FRAMES = 60 * 9;     // ~9 с: не разбили — мягко исчезает и появляется в другом месте
/** Вертикальные зоны появления досок (доля высоты экрана): hand — верх, foot — низ */
const BOARD_ZONE_Y = {
    hand: { yMin: 0.20, yMax: 0.40 },
    foot: { yMin: 0.58, yMax: 0.78 }
};
/** Лодыжки и носки обеих ног (BlazePose): сегменты удара ногой строятся по этим точкам */
const FOOT_STRIKE_INDICES = [27, 28, 31, 32];

const BOARD_BREAK_SFX = [sliceSoundUrlByEmoji['🍗'], sliceSoundUrlByEmoji['🥩']].filter(Boolean);
let boardBreakSfxRot = 0;

function playBoardBreakSound() {
    if (!soundEffectsEnabled || !BOARD_BREAK_SFX.length) return;
    playOneShotSfx(BOARD_BREAK_SFX[boardBreakSfxRot++ % BOARD_BREAK_SFX.length], 0.95);
}

class Board {
    constructor(x, y, strikeKind) {
        const { minSide } = gameLayout;
        this.x = x;
        this.y = y;
        /** 'hand' — бить рукой (верхняя зона); 'foot' — ногой (нижняя) */
        this.strikeKind = strikeKind === 'foot' ? 'foot' : 'hand';
        this.w = Math.min(300, Math.max(130, minSide * 0.30));
        this.h = this.w * 0.30;
        /** Круг для lineCircleCollide — чуть шире доски, детям проще попасть */
        this.radius = this.w * 0.46;
        this.color = this.strikeKind === 'hand' ? '#66e8ff' : '#ff8fd4';
        this.tilt = (Math.random() * 2 - 1) * 0.10;
        this.age = 0;
        this.isBroken = false;
        this.breakT = 0;
        this.fade = 0;
        /** Мягкая встряска, если ударили «не той» частью тела */
        this.nudgeFlash = 0;
    }

    isArmed() {
        return this.age >= BOARD_SPAWN_ARM_FRAMES && this.fade <= 0;
    }

    isGone() {
        return (this.isBroken && this.breakT >= 1.5) || this.fade >= 1;
    }

    update(dt = 1) {
        this.age += dt;
        if (this.nudgeFlash > 0) this.nudgeFlash = Math.max(0, this.nudgeFlash - 0.06 * dt);
        if (this.isBroken) {
            this.breakT += 0.035 * dt;
        } else if (this.age > BOARD_LIFETIME_FRAMES) {
            this.fade = Math.min(1, this.fade + 0.05 * dt);
        }
    }

    neonStroke() {
        return this.strikeKind === 'hand' ? 'rgba(0, 243, 255, 0.9)' : 'rgba(255, 110, 200, 0.92)';
    }

    strikeIcon() {
        return this.strikeKind === 'hand' ? '🖐' : '🦶';
    }

    drawPlank(ctx, half) {
        /** half: 0 — целая; -1 — левая половина; 1 — правая */
        const w = half === 0 ? this.w : this.w / 2;
        const x0 = half === 1 ? 0 : -this.w / 2;
        const g = ctx.createLinearGradient(0, -this.h / 2, 0, this.h / 2);
        g.addColorStop(0, '#c68b4e');
        g.addColorStop(0.5, '#a96e38');
        g.addColorStop(1, '#7c4f26');
        ctx.fillStyle = g;
        ctx.strokeStyle = this.neonStroke();
        ctx.lineWidth = 3;
        ctx.shadowColor = this.strikeKind === 'hand' ? '#00f3ff' : '#ff6ec7';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x0, -this.h / 2, w, this.h, 8);
        else ctx.rect(x0, -this.h / 2, w, this.h);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        /** Волокна дерева */
        ctx.strokeStyle = 'rgba(70, 42, 18, 0.55)';
        ctx.lineWidth = 1.6;
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(x0 + 8, i * this.h * 0.22);
            ctx.lineTo(x0 + w - 8, i * this.h * 0.22 + i * 2);
            ctx.stroke();
        }
    }

    draw(ctx) {
        ctx.save();
        const shake = this.nudgeFlash > 0 ? Math.sin(this.age * 0.9) * 8 * this.nudgeFlash : 0;
        ctx.translate(this.x + shake, this.y);
        ctx.rotate(this.tilt);
        const pop = Math.min(1, this.age / BOARD_SPAWN_ARM_FRAMES);
        const scale = 0.6 + 0.4 * (1 - (1 - pop) * (1 - pop)); // ease-out
        ctx.scale(scale, scale);
        ctx.globalAlpha = Math.max(0, 1 - this.fade) * (0.35 + 0.65 * pop);

        if (!this.isBroken) {
            /** Крупная подсказка: чем бить */
            const iconPulse = 1 + 0.08 * Math.sin(this.age * 0.14);
            ctx.save();
            ctx.scale(iconPulse, iconPulse);
            ctx.font = `bold ${Math.round(this.w * 0.34)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.shadowColor = this.strikeKind === 'hand' ? '#00f3ff' : '#ff6ec7';
            ctx.shadowBlur = 16;
            ctx.fillText(this.strikeIcon(), 0, -this.h * 0.42);
            ctx.shadowBlur = 0;
            ctx.restore();

            this.drawPlank(ctx, 0);
            /** Мишень по центру — приглашение ударить */
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, this.h * 0.28, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, this.h * 0.10, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            const bt = Math.min(1.5, this.breakT);
            ctx.globalAlpha *= Math.max(0, 1 - bt / 1.5);
            const drop = bt * bt * 46;
            /** Левая половина падает влево-вниз, правая — вправо-вниз (классическое «карате») */
            ctx.save();
            ctx.translate(-this.w * 0.08 - bt * 14, drop);
            ctx.rotate(-0.55 * bt);
            this.drawPlank(ctx, -1);
            ctx.restore();
            ctx.save();
            ctx.translate(this.w * 0.08 + bt * 14, drop);
            ctx.rotate(0.55 * bt);
            this.drawPlank(ctx, 1);
            ctx.restore();
        }
        ctx.restore();
    }
}

/** Чередует руку и ногу — ребёнок знает, что будет дальше */
function pickBoardStrikeKind() {
    const kind = nextBoardStrikeKind;
    nextBoardStrikeKind = kind === 'hand' ? 'foot' : 'hand';
    return kind;
}

/** Случайное место для новой доски в нужной зоне (верх — рука, низ — нога) */
function spawnBoardAtFreeSpot(strikeKind) {
    const { w, h } = gameLayout;
    const zone = BOARD_ZONE_Y[strikeKind] || BOARD_ZONE_Y.hand;
    for (let attempt = 0; attempt < 12; attempt++) {
        const x = w * (0.14 + Math.random() * 0.72);
        const y = h * (zone.yMin + Math.random() * (zone.yMax - zone.yMin));
        let clear = true;
        for (const b of boards) {
            if (Math.hypot(b.x - x, b.y - y) < b.radius * 2.1) {
                clear = false;
                break;
            }
        }
        if (clear) return new Board(x, y, strikeKind);
    }
    return null;
}

/** Иконки зон «рука / нога» — ориентир для ребёнка без цветной подложки */
function drawBoardZoneGuides(ctx, layout) {
    const { w, h } = layout;
    ctx.save();
    ctx.globalAlpha = 0.72;
    const fontPx = Math.min(36, w * 0.055);
    ctx.font = `bold ${fontPx}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f3ff';
    ctx.shadowBlur = 12;
    ctx.fillText('🖐', w * 0.08, h * ((BOARD_ZONE_Y.hand.yMin + BOARD_ZONE_Y.hand.yMax) / 2));
    ctx.shadowColor = '#ff6ec7';
    ctx.fillText('🦶', w * 0.08, h * ((BOARD_ZONE_Y.foot.yMin + BOARD_ZONE_Y.foot.yMax) / 2));
    ctx.restore();
}

function boardSegmentsHitBoard(segments, board) {
    if (!segments?.length) return false;
    for (const seg of segments) {
        if (lineCircleCollide(seg.a, seg.b, board)) return true;
    }
    return false;
}

/** Radial “splash” at slice: rays + ring, decays quickly */
class SliceBurst {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.life = 1;
        this.rot = Math.random() * Math.PI * 2;
    }
    update(dt = 1) {
        this.life -= 0.1 * dt;
    }
    draw(ctx) {
        const t = Math.max(0, this.life);
        if (t <= 0) return;
        const u = 1 - t;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);
        const rays = 14;
        ctx.globalAlpha = t * 0.95;
        for (let r = 0; r < rays; r++) {
            const a = (r / rays) * Math.PI * 2;
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2.2;
            ctx.shadowBlur = 16;
            ctx.shadowColor = '#00f3ff';
            ctx.beginPath();
            const inner = 10 + u * 28;
            const outer = 32 + u * 120;
            ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
            ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = t * 0.55;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 12 + u * 85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = t * 0.35;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, 8 + u * 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

/** kind: 'dot' — мягкое светящееся пятно; 'spark' — короткая яркая полоска-всплеск */
class Particle {
    constructor(x, y, color, kind = 'dot') {
        this.x = x;
        this.y = y;
        this.color = color;
        this.kind = kind;
        this.life = 1;
        const ang = Math.random() * Math.PI * 2;
        if (kind === 'spark') {
            const spd = 16 + Math.random() * 22;
            this.vx = Math.cos(ang) * spd;
            this.vy = Math.sin(ang) * spd;
            this.sparkAngle = ang;
            this.sparkLen = 14 + Math.random() * 20;
            this.drag = 0.9;
        } else {
            this.vx = Math.cos(ang) * (3 + Math.random() * 10);
            this.vy = Math.sin(ang) * (3 + Math.random() * 10);
            this.r = 3.5 + Math.random() * 6;
            this.drag = 0.985;
        }
    }
    update(dt = 1) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= this.drag;
        this.vy *= this.drag;
        this.life -= (this.kind === 'spark' ? 0.07 : 0.042) * dt;
    }
    draw(ctx) {
        const a = Math.max(0, this.life);
        if (a <= 0) return;
        ctx.save();
        if (this.kind === 'spark') {
            ctx.globalAlpha = a;
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2.8;
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ffffff';
            const L = this.sparkLen * (0.4 + 0.6 * a);
            ctx.beginPath();
            ctx.moveTo(
                this.x - Math.cos(this.sparkAngle) * L * 0.35,
                this.y - Math.sin(this.sparkAngle) * L * 0.35
            );
            ctx.lineTo(this.x + Math.cos(this.sparkAngle) * L, this.y + Math.sin(this.sparkAngle) * L);
            ctx.stroke();
            ctx.restore();
            return;
        }
        const rad = this.r * (0.55 + 0.45 * a);
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.25, this.color);
        g.addColorStop(0.7, this.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = a;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.x, this.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, rad * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.restore();
    }
}

// Intersect a line segment and a circle
function lineCircleCollide(a, b, circle) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    // Tip barely moved: treat as point vs circle (avoids div-by-zero)
    if (lenSq < 4) {
        const acx = circle.x - a.x;
        const acy = circle.y - a.y;
        return acx * acx + acy * acy < circle.radius * circle.radius;
    }
    const ab = { x: abx, y: aby };
    const ac = { x: circle.x - a.x, y: circle.y - a.y };

    // Project c onto ab, computing parameterized position d(t) = a + t*(b - a)
    let t = (ac.x * ab.x + ac.y * ab.y) / lenSq;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment
    
    const closest = {
        x: a.x + t * ab.x,
        y: a.y + t * ab.y
    };
    
    const distanceSq = (closest.x - circle.x) * (closest.x - circle.x) + (closest.y - circle.y) * (closest.y - circle.y);
    return distanceSq < (circle.radius * circle.radius);
}

/**
 * Из BlazePose (33 точки) собираем «псевдо-кисть» (21 точка),
 * чтобы дальше работал тот же конвейер слайс-сегментов и клешней.
 * Заполняем только нужное: 0 (запястье), 4 (большой), 7 (PIP индекса), 8 (индекс), 19 (DIP мизинца), 20 (мизинец).
 * Остальные индексы дублируем валидными значениями, чтобы getScreenPoint никогда не падал.
 */
const POSE_BODY_HANDS = [
    { key: 'PoseLeft',  wristIdx: 15, indexIdx: 19, pinkyIdx: 17, thumbIdx: 21 },
    { key: 'PoseRight', wristIdx: 16, indexIdx: 20, pinkyIdx: 18, thumbIdx: 22 }
];
/** В режиме pose-hands сегменты считаем только по индексу + мизинцу: они стабильнее всего у BlazePose */
const POSE_HAND_TIP_INDICES = [8, 20];
/** Минимальная видимость запястья BlazePose, ниже которой кисть не используем */
const POSE_HAND_MIN_VISIBILITY = 0.55;

function midpoint(a, b) {
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function buildSyntheticHandFromPose(poseLandmarks, def) {
    const wrist = poseLandmarks[def.wristIdx];
    const indexT = poseLandmarks[def.indexIdx];
    const pinkyT = poseLandmarks[def.pinkyIdx];
    const thumbT = poseLandmarks[def.thumbIdx];
    if (!wrist || !indexT || !pinkyT) return null;
    const vis = wrist.visibility ?? 1;
    if (vis < POSE_HAND_MIN_VISIBILITY) return null;

    const indexPip = midpoint(wrist, indexT);
    const pinkyDip = midpoint(wrist, pinkyT);
    const middleT = midpoint(indexT, pinkyT);
    const middlePip = midpoint(wrist, middleT);
    const ringT = midpoint(middleT, pinkyT);
    const ringPip = midpoint(wrist, ringT);
    const thumb = thumbT || midpoint(wrist, indexT);

    const lm = new Array(21);
    for (let i = 0; i < 21; i++) lm[i] = wrist;
    lm[0] = wrist;
    lm[1] = midpoint(wrist, thumb);
    lm[2] = midpoint(wrist, thumb);
    lm[3] = midpoint(wrist, thumb);
    lm[4] = thumb;
    lm[5] = midpoint(wrist, indexT);
    lm[6] = midpoint(wrist, indexT);
    lm[7] = indexPip;
    lm[8] = indexT;
    lm[9]  = middlePip;
    lm[10] = middlePip;
    lm[11] = middlePip;
    lm[12] = middleT;
    lm[13] = ringPip;
    lm[14] = ringPip;
    lm[15] = ringPip;
    lm[16] = ringT;
    lm[17] = pinkyDip;
    lm[18] = pinkyDip;
    lm[19] = pinkyDip;
    lm[20] = pinkyT;
    return lm;
}

/**
 * Порядок persons между кадрами у MediaPipe не гарантирован, поэтому сортируем
 * по средней X запястий (15+16) — левый игрок всегда #0, правый #1.
 * Это держит prevFingertipsByKey / tipVelocityByKey стабильными для двух игроков.
 */
function getOrderedPersons(poseResults) {
    const persons = poseResults?.landmarks;
    if (!persons?.length) return [];
    return persons
        .map((lm, idx) => {
            const lw = lm[15];
            const rw = lm[16];
            const xs = [];
            if (lw) xs.push(lw.x);
            if (rw) xs.push(rw.x);
            return { lm, idx, sortX: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : idx };
        })
        .sort((a, b) => a.sortX - b.sortX)
        .map((p, i) => ({ lm: p.lm, key: `Pose#${i}` }));
}

/**
 * BlazePose у второго человека (вторичный детект) даёт заметно более шумные точки кистей
 * (15..22) — клешни «дёргаются». Делаем лёгкое EMA-сглаживание именно ВХОДНЫХ точек кисти,
 * per-person, до построения синтетической кисти. Высокий alpha = маленькая задержка
 * (1–2 кадра), но достаточно, чтобы убрать пиксельный jitter.
 */
const HAND_INPUT_INDICES = [15, 16, 17, 18, 19, 20, 21, 22];
const HAND_INPUT_ALPHA = 0.55;
const HAND_INPUT_TELEPORT = 0.20;
const HAND_INPUT_TTL_MS = 600;
const handInputSmoothByKey = new Map();

function smoothHandInputLm(personKey, rawLm, nowMs) {
    let state = handInputSmoothByKey.get(personKey);
    if (!state) {
        state = { lm: {}, lastSeenMs: nowMs };
        handInputSmoothByKey.set(personKey, state);
    }
    state.lastSeenMs = nowMs;
    const out = rawLm.slice();
    for (const i of HAND_INPUT_INDICES) {
        const r = rawLm[i];
        if (!r) continue;
        const prev = state.lm[i];
        if (!prev || Math.hypot(r.x - prev.x, r.y - prev.y) > HAND_INPUT_TELEPORT) {
            state.lm[i] = { x: r.x, y: r.y, z: r.z, visibility: r.visibility };
        } else {
            const a = HAND_INPUT_ALPHA;
            state.lm[i] = {
                x: prev.x * (1 - a) + r.x * a,
                y: prev.y * (1 - a) + r.y * a,
                z: (prev.z ?? 0) * (1 - a) + (r.z ?? 0) * a,
                visibility: r.visibility
            };
        }
        out[i] = state.lm[i];
    }
    return out;
}

function pruneHandInputSmoothState(activeKeys, nowMs) {
    for (const k of [...handInputSmoothByKey.keys()]) {
        if (activeKeys.has(k)) continue;
        const s = handInputSmoothByKey.get(k);
        if (!s || nowMs - s.lastSeenMs > HAND_INPUT_TTL_MS) {
            handInputSmoothByKey.delete(k);
        }
    }
}

function buildKeyedHandsFromPose(displayPersons) {
    const ordered = displayPersons ?? getDisplayOrderedPersons();
    if (!ordered.length) return [];
    const nowMs = performance.now();
    const activeKeys = new Set(ordered.map((p) => p.key));
    pruneHandInputSmoothState(activeKeys, nowMs);
    const out = [];
    for (let p = 0; p < ordered.length; p++) {
        const suffix = ordered.length > 1 ? `#${p}` : '';
        /** При интерполяции display уже сглажен между кадрами — лишний EMA на каждом rAF даёт «30 fps» */
        const stableLm = trackTuning.interpolatePose
            ? ordered[p].lm
            : smoothHandInputLm(ordered[p].key, ordered[p].lm, nowMs);
        for (const def of POSE_BODY_HANDS) {
            const lm = buildSyntheticHandFromPose(stableLm, def);
            if (!lm) continue;
            out.push({ key: `${def.key}${suffix}`, landmarks: lm });
        }
    }
    return out;
}

/**
 * BlazePose выдаёт лендмарки с заметным шумом — особенно лицо (0..10) и кисти-«огрызки» (17..22).
 * Для **отрисовки** скелета и маски используем экспоненциально сглаженные точки
 * (per-person, в нормализованных координатах, до проекции на canvas).
 * Для построения кистей под коллизию остаются СЫРЫЕ лендмарки —
 * иначе появляется заметная задержка между взмахом и резом.
 *
 * Лицу нужно тише (маска маленькая, шум виден), телу — чуть резче, чтобы не «уезжало».
 * При телепорте (резкий скачок) стейт сбрасываем, чтобы не «ползло».
 */
const FACE_LM_INDICES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const POSE_FACE_ALPHA = 0.28;
const POSE_BODY_ALPHA = 0.40;
const POSE_TELEPORT_THRESHOLD = 0.22;
const POSE_STATE_TTL_MS = 600;
/** Map<personKey, { lm: { [idx]: {x, y, z, visibility} }, lastSeenMs }> */
const poseSmoothByKey = new Map();

function smoothPoseLandmarks(personKey, rawLm, nowMs) {
    let state = poseSmoothByKey.get(personKey);
    if (!state) {
        state = { lm: {}, lastSeenMs: nowMs };
        poseSmoothByKey.set(personKey, state);
    }
    state.lastSeenMs = nowMs;
    const out = new Array(rawLm.length);
    for (let i = 0; i < rawLm.length; i++) {
        const r = rawLm[i];
        if (!r) {
            out[i] = r;
            continue;
        }
        const prev = state.lm[i];
        const alpha = FACE_LM_INDICES.has(i) ? POSE_FACE_ALPHA : POSE_BODY_ALPHA;
        if (!prev || Math.hypot(r.x - prev.x, r.y - prev.y) > POSE_TELEPORT_THRESHOLD) {
            state.lm[i] = { x: r.x, y: r.y, z: r.z, visibility: r.visibility };
        } else {
            state.lm[i] = {
                x: prev.x * (1 - alpha) + r.x * alpha,
                y: prev.y * (1 - alpha) + r.y * alpha,
                z: (prev.z ?? 0) * (1 - alpha) + (r.z ?? 0) * alpha,
                visibility: r.visibility
            };
        }
        out[i] = state.lm[i];
    }
    return out;
}

function prunePoseSmoothState(activeKeys, nowMs) {
    for (const k of [...poseSmoothByKey.keys()]) {
        if (activeKeys.has(k)) continue;
        const s = poseSmoothByKey.get(k);
        if (!s || nowMs - s.lastSeenMs > POSE_STATE_TTL_MS) {
            poseSmoothByKey.delete(k);
        }
    }
}

function cloneLandmarks(lm) {
    return lm.map((p) => (p ? { x: p.x, y: p.y, z: p.z, visibility: p.visibility } : p));
}

function lerpLandmarks(lmA, lmB, t) {
    const n = Math.max(lmA.length, lmB.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const a = lmA[i];
        const b = lmB[i];
        if (!a && !b) {
            out[i] = undefined;
            continue;
        }
        if (!a) {
            out[i] = cloneLandmarks([b])[0];
            continue;
        }
        if (!b) {
            out[i] = cloneLandmarks([a])[0];
            continue;
        }
        out[i] = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
            visibility: a.visibility ?? b.visibility
        };
    }
    return out;
}

function poseSmoothstep(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

/** Сглаживание только на новом кадре камеры; prev/target — для интерполяции на rAF */
function commitPoseTargetsFromFrame(orderedPersons, nowMs) {
    const activeKeys = new Set();
    displayPersonOrder.length = 0;

    const frameTsMs = Number.isFinite(video.currentTime) ? video.currentTime * 1000 : nowMs;
    if (poseFrameTsCurr >= 0 && frameTsMs > poseFrameTsCurr) {
        poseFrameIntervalMs = Math.max(16, Math.min(120, frameTsMs - poseFrameTsCurr));
    }
    if (poseFrameTsCurr >= 0) poseFrameTsPrev = poseFrameTsCurr;
    else poseFrameTsPrev = frameTsMs;
    poseFrameTsCurr = frameTsMs;

    for (const { lm: rawLm, key } of orderedPersons) {
        activeKeys.add(key);
        displayPersonOrder.push(key);
        const smoothed = smoothPoseLandmarks(key, rawLm, nowMs);
        const prevTarget = poseTargetByKey.get(key);
        if (prevTarget) posePrevTargetByKey.set(key, cloneLandmarks(prevTarget));
        else posePrevTargetByKey.set(key, cloneLandmarks(smoothed));
        poseTargetByKey.set(key, cloneLandmarks(smoothed));
        if (!poseDisplayByKey.has(key) || !trackTuning.interpolatePose) {
            poseDisplayByKey.set(key, cloneLandmarks(smoothed));
        }
    }

    prunePoseSmoothState(activeKeys, nowMs);

    for (const k of [...poseDisplayByKey.keys()]) {
        if (activeKeys.has(k)) continue;
        const s = poseSmoothByKey.get(k);
        if (!s || nowMs - s.lastSeenMs > POSE_STATE_TTL_MS) {
            poseDisplayByKey.delete(k);
            poseTargetByKey.delete(k);
            posePrevTargetByKey.delete(k);
            const idx = displayPersonOrder.indexOf(k);
            if (idx >= 0) displayPersonOrder.splice(idx, 1);
        }
    }

    poseFrameCommitPerfMs = performance.now();
}

function updatePoseDisplayLandmarks(nowMs) {
    if (!trackTuning.interpolatePose) {
        for (const [key, target] of poseTargetByKey) {
            poseDisplayByKey.set(key, cloneLandmarks(target));
        }
        return;
    }

    if (!poseFrameCommitPerfMs || !displayPersonOrder.length) return;

    /** video.currentTime на Android меняется только с новым кадром (~30 fps) — t по wall clock после commit */
    const wallNow = performance.now();
    const interval = Math.max(20, poseFrameIntervalMs || 33.33);
    let t = (wallNow - poseFrameCommitPerfMs) / interval;
    t = Math.max(0, Math.min(1, t));
    const te = poseSmoothstep(t);

    for (const key of displayPersonOrder) {
        const prev = posePrevTargetByKey.get(key);
        const target = poseTargetByKey.get(key);
        if (!target) continue;
        if (!prev || te >= 1) {
            poseDisplayByKey.set(key, cloneLandmarks(target));
        } else {
            poseDisplayByKey.set(key, lerpLandmarks(prev, target, te));
        }
    }
}

function getDisplayOrderedPersons() {
    return displayPersonOrder
        .map((key) => {
            const lm = poseDisplayByKey.get(key);
            return lm ? { key, lm } : null;
        })
        .filter(Boolean);
}

/** After hand drops from detection, keep extrapolating this long (ms) */
const HAND_LOST_GRACE_MS = 220;
/** Max px per collision sub-segment so fast swipes do not tunnel through fruits */
const COLLISION_SUBSTEP_PX = 72;
/** Low-pass on fingertip delta for velocity (ghost extrapolation) */
const TIP_VELOCITY_SMOOTH = 0.42;
/** Ignore velocity update on implausible one-frame jumps (lost track / teleport) */
const MAX_JUMP_FOR_VELOCITY_PX = 280;
/** Damp fingertip velocity each ghost frame */
const GHOST_VELOCITY_DAMP = 0.86;

/**
 * Append many short segments along [a→b] so lineCircleCollide cannot miss wide bodies
 * when the tip moves a large distance in one frame.
 */
/**
 * Угол, под которым разъезжаются половинки. Берём направление взмаха и
 * поворачиваем на 90°: половинки расходятся поперёк линии реза, а не вдоль неё.
 * Без сегмента (например, программный рез) падаем на угол самого предмета.
 */
function sliceAngleFromSwipe(fruit, segment) {
    if (!segment) return fruit.rotation;
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    if (Math.hypot(dx, dy) < 1) return fruit.rotation;
    /**
     * draw() компенсирует CSS-зеркало для текста и фигур через scale(-1,1) —
     * в такой системе координат X направлен в другую сторону, отражаем угол.
     */
    const mirrored = fruit.levelMode !== 'fruit' && !fruit.emoji;
    const swipe = Math.atan2(dy, mirrored ? -dx : dx);
    return swipe + Math.PI / 2;
}

function appendSweepCollisionSegments(segments, a, b, maxStepPx = COLLISION_SUBSTEP_PX) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const steps = Math.max(1, Math.ceil(len / maxStepPx));
    let x0 = a.x;
    let y0 = a.y;
    for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const x1 = a.x + dx * t;
        const y1 = a.y + dy * t;
        segments.push({ a: { x: x0, y: y0 }, b: { x: x1, y: y1 } });
        x0 = x1;
        y0 = y1;
    }
}

let lastSpawnTime = Date.now();
let lastFrameTime = performance.now();
/** Previous-frame fingertip positions: Map<handKey, { 8: {x,y}, ... }> */
let prevFingertipsByKey = new Map();
/** Last time this hand key was present in MediaPipe results (performance.now) */
let handKeyLastSeenMs = new Map();
/** Smoothed screen-space velocity per tip for short dropout extrapolation */
let tipVelocityByKey = new Map();

let perfFrameSumMs = 0;
let perfFrameCount = 0;
let perfLastLogMs = 0;

/** Единственный владелец rAF-цикла: на экране победы цикл продолжается (салют), не плодим второй */
let rafActive = false;

function ensureGameLoop() {
    if (!rafActive) {
        rafActive = true;
        requestAnimationFrame(gameLoop);
    }
}

function gameLoop(nowTime) {
    if (!isPlaying) {
        rafActive = false;
        return;
    }

    const levelCfg = getCurrentLevelConfig();

    if (!nowTime) nowTime = performance.now();
    let dt = (nowTime - lastFrameTime) / (1000 / 60); // Normalize to 60fps
    /**
     * Удержанию нужно настоящее время, а не физическое: dt ниже режется до 3,
     * и при fps < 20 секунда удержания растягивалась бы вдвое. Потолок 250 мс
     * лишь отсекает паузы вроде свёрнутой вкладки.
     */
    const holdFrameMs = Math.max(0, Math.min(250, nowTime - lastFrameTime));
    if (dt > 3) dt = 3; // Cap lag spikes
    if (dt < 0) dt = 0; // Prevent reverse time
    lastFrameTime = nowTime;

    let startTimeMs = performance.now();
    let gotNewVideoFrame = false;

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        gotNewVideoFrame = true;
        /** Время кадра видео (мс) — строго монотонное для VIDEO mode */
        let frameTsMs = Number.isFinite(video.currentTime) ? video.currentTime * 1000 : startTimeMs;
        if (frameTsMs <= lastDetectTsMs) frameTsMs = lastDetectTsMs + 1;
        lastDetectTsMs = frameTsMs;
        try {
            const pRes = poseLandmarker.detectForVideo(video, frameTsMs);
            if (pRes) currentPoseResults = pRes;
        } catch (err) {
            console.warn("PoseLandmarker detectForVideo:", err);
        }
    }

    if (gotNewVideoFrame && currentPoseResults?.landmarks?.length) {
        commitPoseTargetsFromFrame(getOrderedPersons(currentPoseResults), nowTime);
    } else if (gotNewVideoFrame) {
        const activeKeys = new Set();
        prunePoseSmoothState(activeKeys, nowTime);
        for (const k of [...poseDisplayByKey.keys()]) {
            const s = poseSmoothByKey.get(k);
            if (!s || nowTime - s.lastSeenMs > POSE_STATE_TTL_MS) {
                poseDisplayByKey.delete(k);
                poseTargetByKey.delete(k);
                posePrevTargetByKey.delete(k);
            }
        }
        for (let i = displayPersonOrder.length - 1; i >= 0; i--) {
            if (!poseDisplayByKey.has(displayPersonOrder[i])) displayPersonOrder.splice(i, 1);
        }
    }
    updatePoseDisplayLandmarks(nowTime);

    const displayPersons = getDisplayOrderedPersons();

    // --- DRAWING ---
    // 1. Draw Camera Frame to Canvas (Remember canvas is mirrored via CSS, so we just draw normal image, but coordinates will logically mirror for collisions? Wait, CSS mirroring only visually flips the content. Let's fix this!)
    // Wait, if canvas is CSS-scaled by -1, point (x,y) visually appears at (width-x, y). 
    // MediaPipe points are normalized 0-1 from left to right.
    // Let's just draw on the canvas normally, and calculate collisions in canvas coordinates. CSS scaleX(-1) handles the mirror visual!
    
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Calculate aspect ratio covering
    const vRatio = canvasElement.width / video.videoWidth;
    const hRatio = canvasElement.height / video.videoHeight;
    const ratio  = Math.max(vRatio, hRatio);
    const centerShift_x = (canvasElement.width - video.videoWidth*ratio) / 2;
    const centerShift_y = (canvasElement.height - video.videoHeight*ratio) / 2;  

    canvasCtx.drawImage(
        video, 0, 0, video.videoWidth, video.videoHeight,
        centerShift_x, centerShift_y, video.videoWidth*ratio, video.videoHeight*ratio
    );

    // Apply a dark tint
    canvasCtx.fillStyle = 'rgba(0,0,0,0.6)';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    if (levelCfg.mode === 'board') drawBoardZoneGuides(canvasCtx, gameLayout);

    function getScreenPoint(landmark) {
        return {
            x: (landmark.x * video.videoWidth * ratio) + centerShift_x,
            y: (landmark.y * video.videoHeight * ratio) + centerShift_y
        };
    }

    // Prepare line segments for collision detection
    const handSegments = [];
    /** Позиции кончиков пальцев в этом кадре — для режима «поднеси и удержи» */
    const handTipPoints = [];
    /** Виртуальный палец для автотестов — камера в них не даёт рук */
    if (import.meta.env?.DEV && window.__holdProbe) {
        handTipPoints.push({ ...window.__holdProbe, hand: window.__holdProbe.hand || 'probe' });
    }
    if (import.meta.env?.DEV && Array.isArray(window.__holdProbes)) {
        for (const p of window.__holdProbes) handTipPoints.push({ ...p, hand: p.hand || 'probe' });
    }
    /** Режим «Доски»: сегменты ударов рук и ног отдельно — доска ломается только «своей» частью тела */
    const boardHandStrikeSegments = levelCfg.mode === 'board' ? [] : null;
    const boardFootStrikeSegments = levelCfg.mode === 'board' ? [] : null;
    const boardStrikeMinPx = BOARD_MIN_STRIKE_SPEED_PX * Math.max(0.3, Math.min(dt, 3));

    // Draw Pose (display-landmarks: сглажены на кадре камеры + интерполяция на rAF)
    if (displayPersons.length > 0) {
        for (const { lm: landmarks } of displayPersons) {
            canvasCtx.strokeStyle = 'rgba(0, 243, 255, 0.8)';
            canvasCtx.lineWidth = 6;
            canvasCtx.shadowColor = 'rgba(0, 243, 255, 1)';
            canvasCtx.shadowBlur = 15;
            
            for (const connection of POSE_CONNECTIONS) {
                // Skip drawing face lines to replace them with Ninja Mask 
                if (connection.start <= 10 && connection.end <= 10) continue;

                const a = getScreenPoint(landmarks[connection.start]);
                const b = getScreenPoint(landmarks[connection.end]);
                canvasCtx.beginPath();
                canvasCtx.moveTo(a.x, a.y);
                canvasCtx.lineTo(b.x, b.y);
                canvasCtx.stroke();
            }
            canvasCtx.shadowBlur = 0; // reset glow

            // Draw Ninja Mask using face landmarks (0 to 10)
            const nose = getScreenPoint(landmarks[0]);
            const eyeL = getScreenPoint(landmarks[2]);  // Left eye
            const eyeR = getScreenPoint(landmarks[5]);  // Right eye
            const earL = getScreenPoint(landmarks[7]);  // Left ear
            const earR = getScreenPoint(landmarks[8]);  // Right ear

            // Up vector on the face plane
            const eyeCenterX = (eyeL.x + eyeR.x) / 2;
            const eyeCenterY = (eyeL.y + eyeR.y) / 2;
            const upX = eyeCenterX - nose.x;
            const upY = eyeCenterY - nose.y;

            // Extrapolate key face bounds using the up vector
            const forehead = { x: eyeCenterX + upX * 1.5, y: eyeCenterY + upY * 1.5 };
            const chin = { x: nose.x - upX * 2.5, y: nose.y - upY * 2.5 };
            
            const faceWidth = Math.sqrt((earR.x - earL.x)**2 + (earR.y - earL.y)**2);
            const faceHeight = Math.sqrt(upX**2 + upY**2);
            // User's physical right ear (earR) is on the visual left of the mirrored view.
            // Vector from earR to earL points right. This keeps the angle ~0 and UP correct.
            const angle = Math.atan2(earL.y - earR.y, earL.x - earR.x);

            canvasCtx.save();
            // Transform canvas to center firmly between the eyes!
            canvasCtx.translate(eyeCenterX, eyeCenterY);
            canvasCtx.rotate(angle);
            
            // In these coordinates, X goes from Left to Right. 
            // Y goes from Eyes DOWN towards the chin. So negative Y is towards the top of the head.

            // Neon Wireframe Mask Style
            const W = faceWidth;
            const H = faceHeight;
            
            canvasCtx.strokeStyle = '#00f3ff';
            canvasCtx.lineWidth = 4; // Thick glowing neon lines
            canvasCtx.shadowColor = '#00f3ff';
            canvasCtx.shadowBlur = 20;
            canvasCtx.beginPath();

            /**
             * Контур лица — рамка маски. Внутренние линии (прорезь глаз, сетка щёк
             * и челюсти, лоб, усы) убраны: они закрывали лицо ребёнка.
             */
            canvasCtx.ellipse(0, H * 0.5, W * 0.9, H * 3.5, 0, 0, Math.PI * 2);

            canvasCtx.stroke();

            canvasCtx.restore();
        }
    }

    const keyedHands = buildKeyedHandsFromPose(displayPersons);
    /** Из BlazePose валидные только два «кончика» — индекс и мизинец */
    const activeTipIndices = POSE_HAND_TIP_INDICES;

    const tPerf = performance.now();
    const activeKeys = new Set(keyedHands.map((h) => h.key));
    for (const { key } of keyedHands) {
        handKeyLastSeenMs.set(key, tPerf);
    }

    // Slice collision: fingertip motion with sub-steps + short grace when track drops
    for (const { key, landmarks } of keyedHands) {
        let prev = prevFingertipsByKey.get(key);
        if (!prev) {
            prev = {};
            prevFingertipsByKey.set(key, prev);
        }
        let velMap = tipVelocityByKey.get(key);
        if (!velMap) {
            velMap = {};
            tipVelocityByKey.set(key, velMap);
        }
        for (const tipIdx of activeTipIndices) {
            const tip = getScreenPoint(landmarks[tipIdx]);
            /**
             * Текущие позиции кончиков — для механики удержания (в отличие от путей для реза).
             * key различает руки: в счёте считать можно только одной.
             */
            handTipPoints.push({ x: tip.x, y: tip.y, hand: key });
            if (prev[tipIdx]) {
                appendSweepCollisionSegments(handSegments, prev[tipIdx], tip);
                const jx = tip.x - prev[tipIdx].x;
                const jy = tip.y - prev[tipIdx].y;
                const jump = Math.hypot(jx, jy);
                if (boardHandStrikeSegments && jump >= boardStrikeMinPx && jump < MAX_JUMP_FOR_VELOCITY_PX) {
                    appendSweepCollisionSegments(boardHandStrikeSegments, prev[tipIdx], tip);
                }
                if (jump < MAX_JUMP_FOR_VELOCITY_PX) {
                    if (!velMap[tipIdx]) velMap[tipIdx] = { vx: 0, vy: 0 };
                    const sm = TIP_VELOCITY_SMOOTH;
                    velMap[tipIdx].vx = velMap[tipIdx].vx * (1 - sm) + jx * sm;
                    velMap[tipIdx].vy = velMap[tipIdx].vy * (1 - sm) + jy * sm;
                }
            }
            prev[tipIdx] = tip;
        }
    }

    for (const key of prevFingertipsByKey.keys()) {
        if (activeKeys.has(key)) continue;
        const lastSeen = handKeyLastSeenMs.get(key);
        if (lastSeen === undefined || tPerf - lastSeen > HAND_LOST_GRACE_MS) continue;

        const prev = prevFingertipsByKey.get(key);
        const velMap = tipVelocityByKey.get(key);
        if (!prev || !velMap) continue;

        for (const tipIdx of activeTipIndices) {
            if (!prev[tipIdx]) continue;
            const v = velMap[tipIdx];
            if (!v) continue;
            const tip = { x: prev[tipIdx].x + v.vx, y: prev[tipIdx].y + v.vy };
            v.vx *= GHOST_VELOCITY_DAMP;
            v.vy *= GHOST_VELOCITY_DAMP;
            appendSweepCollisionSegments(handSegments, prev[tipIdx], tip);
            prev[tipIdx] = tip;
        }
    }

    for (const key of [...prevFingertipsByKey.keys()]) {
        const lastSeen = handKeyLastSeenMs.get(key);
        if (lastSeen !== undefined && tPerf - lastSeen > HAND_LOST_GRACE_MS) {
            prevFingertipsByKey.delete(key);
            tipVelocityByKey.delete(key);
            handKeyLastSeenMs.delete(key);
        }
    }

    /** Режим «Доски»: удары ногами — сегменты по лодыжкам и носкам + подсветка ступней */
    if (boardFootStrikeSegments) {
        for (const { key, lm } of displayPersons) {
            for (const idx of FOOT_STRIKE_INDICES) {
                const p = lm[idx];
                if (!p || (p.visibility !== undefined && p.visibility < 0.5)) continue;
                const pt = getScreenPoint(p);
                const footKey = `${key}:${idx}`;
                const prevPt = prevFootPointByKey.get(footKey);
                if (prevPt) {
                    const jump = Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
                    if (jump >= boardStrikeMinPx && jump < MAX_JUMP_FOR_VELOCITY_PX) {
                        appendSweepCollisionSegments(boardFootStrikeSegments, prevPt, pt);
                    }
                }
                prevFootPointByKey.set(footKey, pt);
            }
        }
    }

    // Update and draw fruits
    const now = Date.now();
    const unslicedCount = fruits.filter((f) => !f.isSliced).length;
    /** В режиме слов — строго одна нужная буква на экране, чтобы ребёнок видел ровно ту, что нужна */
    const effectiveMaxConcurrent = levelCfg.mode === 'word' ? 1 : levelCfg.maxConcurrent;
    if (levelCfg.mode !== 'board' && !isCompareMode(levelCfg.mode) && !levelComplete && !wordRevealActive && now - lastSpawnTime >= levelCfg.spawnIntervalMs && unslicedCount < effectiveMaxConcurrent) {
        fruits.push(new Fruit());
        lastSpawnTime = now;
    }

    /** Счёт: раунд живёт, пока все предметы не пересчитаны, потом новый набор */
    if (levelCfg.mode === 'counting' && !levelComplete) {
        if (!countingTotal) {
            startCountingRound();
        } else if (countingFinishedAt && now - countingFinishedAt >= COUNTING_NEXT_ROUND_MS) {
            startCountingRound();
        }
    } else if (isCompareMode(levelCfg.mode) && !levelComplete) {
        if (!compareTask) {
            startCompareRound();
        } else if (compareRoundResolved && now >= compareNextRoundAt) {
            startCompareRound();
        }
    }

    /** Режим «Доски»: обновление, удары рук/ног, спавн новых досок */
    if (levelCfg.mode === 'board') {
        for (let i = boards.length - 1; i >= 0; i--) {
            const board = boards[i];
            board.update(dt);
            board.draw(canvasCtx);
            if (!board.isBroken && board.isArmed() && !levelComplete) {
                const rightSegs = board.strikeKind === 'hand' ? boardHandStrikeSegments : boardFootStrikeSegments;
                const wrongSegs = board.strikeKind === 'hand' ? boardFootStrikeSegments : boardHandStrikeSegments;
                const hit = boardSegmentsHitBoard(rightSegs, board);
                if (!hit && boardSegmentsHitBoard(wrongSegs, board)) {
                    board.nudgeFlash = 1;
                }
                if (hit) {
                    board.isBroken = true;
                    playBoardBreakSound();
                    registerGoodHit(board, 15);
                    juiceBurst(board.x, board.y, board.color, 30, 20);
                    checkLevelGoal();
                }
            }
            if (board.isGone()) boards.splice(i, 1);
        }
        const activeBoards = boards.filter((b) => !b.isBroken && b.fade <= 0).length;
        if (!levelComplete && now - lastSpawnTime >= levelCfg.spawnIntervalMs && activeBoards < levelCfg.maxConcurrent) {
            const kind = pickBoardStrikeKind();
            const b = spawnBoardAtFreeSpot(kind);
            if (b) {
                boards.push(b);
                playBoardHintSound(kind);
                lastSpawnTime = now;
            }
        }
    }

    /** Ровно один удерживаемый предмет на кадр — считаем до цикла, чтобы сравнить с каждым */
    const heldFruit = pickHeldFruit(fruits, handTipPoints, levelCfg.mode);

    for (let i = fruits.length - 1; i >= 0; i--) {
        let fruit = fruits[i];
        fruit.update(dt);
        fruit.draw(canvasCtx);
        fruit.drawHoldRing(canvasCtx);
        fruit.drawCountBadge(canvasCtx);

        // Рез: путь кончиков пересёк круг предмета (любой сегмент), но засчёт — на «входе» в контакт, не каждый кадр
        if (!fruit.isSliced) {
            let pathIntersectsFruit = false;
            /** Запоминаем сегмент взмаха — по нему выставим угол разреза */
            let hitSegment = null;
            for (const seg of handSegments) {
                if (lineCircleCollide(seg.a, seg.b, fruit)) {
                    pathIntersectsFruit = true;
                    hitSegment = seg;
                    break;
                }
            }
            if (pathIntersectsFruit) {
                fruit._noContactFrames = 0;
            } else {
                fruit._noContactFrames += 1;
                if (fruit._noContactFrames >= CONTACT_EXIT_DEBOUNCE_FRAMES) {
                    fruit._wasTouchingHand = false;
                }
            }
            const cutStroke = !levelComplete && !wordRevealActive && pathIntersectsFruit && !fruit._wasTouchingHand;
            if (pathIntersectsFruit) {
                fruit._wasTouchingHand = true;
            }

            if (fruit.isCompareObject) {
                /** Выбор удержанием: взмах здесь ничего не решает, важна задержка руки */
                updateHoldProgress(fruit, fruit === heldFruit, holdFrameMs);
                continue;
            }

            if (cutStroke) {
                fruit.isSliced = true;
                fruit.cutAngle = sliceAngleFromSwipe(fruit, hitSegment);
                fruit.rot1 = fruit.rotation;
                fruit.rot2 = fruit.rotation;
                if (fruit.levelMode === 'fruit') {
                    fruit.rotSpeed1 = fruit.rotationSpeed - 0.05;
                    fruit.rotSpeed2 = fruit.rotationSpeed + 0.05;
                } else {
                    fruit.rotSpeed1 = fruit.rotationSpeed - 0.014;
                    fruit.rotSpeed2 = fruit.rotationSpeed + 0.014;
                }

                handleSliceScoring(fruit);
            }
        }

        // Remove if out of bounds (bottom)
        if (fruit.y > gameLayout.h + 100) {
            if (!fruit.isSliced && !levelComplete) handleMiss();
            fruits.splice(i, 1);
        }
    }

    /** Салют на экране победы */
    if (levelComplete) {
        winBurstTimer -= dt;
        if (winBurstTimer <= 0) {
            winBurstTimer = 16 + Math.random() * 12;
            const fx = gameLayout.w * (0.18 + Math.random() * 0.64);
            const fy = gameLayout.h * (0.18 + Math.random() * 0.42);
            const col = GLYPH_NEON_COLORS[Math.floor(Math.random() * GLYPH_NEON_COLORS.length)];
            juiceBurst(fx, fy, col, 30, 18);
        }
    }

    // Update and draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update(dt);
        p.draw(canvasCtx);
        if (p.life <= 0) particles.splice(i, 1);
    }

    // Всплывающие надписи (серия / похвала / собранное слово)
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.update(dt);
        ft.draw(canvasCtx);
        if (ft.life <= 0) floatingTexts.splice(i, 1);
    }

    /** Сердечки от сосчитанных котиков */
    for (let i = countHearts.length - 1; i >= 0; i--) {
        const hp = countHearts[i];
        hp.update(dt);
        hp.draw(canvasCtx);
        if (hp.life <= 0) countHearts.splice(i, 1);
    }

    // Мягкая вспышка-«сок» на удачный рез
    if (screenFlash > 0) {
        canvasCtx.save();
        canvasCtx.globalAlpha = Math.min(0.22, screenFlash);
        canvasCtx.fillStyle = '#ffffff';
        canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.restore();
        screenFlash -= 0.05 * dt;
    }

    if (DEBUG_FRAME_PERF) {
        const elapsed = performance.now() - startTimeMs;
        perfFrameSumMs += elapsed;
        perfFrameCount += 1;
        const t = performance.now();
        if (t - perfLastLogMs >= 2500) {
            perfLastLogMs = t;
            const avg = perfFrameSumMs / perfFrameCount;
            console.info(
                `[perf] среднее за кадр ${avg.toFixed(1)} ms (n=${perfFrameCount}). >22 ms — риск фризов; вкладка Performance.`
            );
            perfFrameSumMs = 0;
            perfFrameCount = 0;
        }
    }

    if (isPlaying) {
        requestAnimationFrame(gameLoop);
    } else {
        rafActive = false;
    }
}

function showStartError(e) {
    console.error(e);
    const name = e?.name || "";
    const msg = e?.message || String(e);
    let hint = t("errorHintGeneric");
    if (name === "NotAllowedError" || /Permission/i.test(msg)) {
        hint = t("errorHintCameraBlocked");
    } else if (name === "NotFoundError" || /DevicesNotFound/i.test(msg)) {
        hint = t("errorHintNoCamera");
    } else if (
        name === "AbortError" ||
        /Timeout starting video source|metadata timeout/i.test(msg)
    ) {
        hint = t("errorHintTimeout");
    }
    loadingElement.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width:28rem;margin:0 auto;text-align:left;line-height:1.45;font-size:0.95rem;";
    const titleP = document.createElement("p");
    titleP.textContent = t("errorTitle");
    titleP.style.fontWeight = "700";
    titleP.style.marginBottom = "0.5rem";
    wrap.appendChild(titleP);
    const d = document.createElement("p");
    d.style.opacity = "0.9";
    d.style.fontSize = "0.85rem";
    d.style.wordBreak = "break-word";
    d.textContent = msg ? `${name ? `[${name}] ` : ""}${msg}` : hint;
    wrap.appendChild(d);
    const h = document.createElement("p");
    h.style.marginTop = "0.75rem";
    h.style.fontSize = "0.82rem";
    h.style.opacity = "0.75";
    h.textContent = hint;
    wrap.appendChild(h);
    loadingElement.appendChild(wrap);
    loadingElement.classList.add("visible");
}

// Start sequence
async function start() {
    try {
        await setupWebcam();
        await initializeModels();
    } catch (e) {
        showStartError(e);
    }
}

/**
 * Отладочный хук для автотестов режима сравнения: позволяет проверить логику
 * «верный/неверный рез» без камеры и распознавания рук.
 */
if (import.meta.env?.DEV) {
    /** Стенд фигур: позволяет посмотреть все объекты в разных масштабах без запуска игры */
    window.__shapeTex = (shape, color) => getOrCreateShapeTexture(shape, color);
    window.__compareDebug = {
        state: () => ({
            task: compareTask,
            errorStreak: compareErrorStreak,
            hintActive: compareHintActive,
            resolved: compareRoundResolved,
            objects: fruits.map((f) => ({
                id: f.compareId,
                shape: f.compareShape,
                radius: Math.round(f.radius),
                x: Math.round(f.x),
                correct: f.isCompareCorrect,
                sliced: f.isSliced,
                errorFlash: Number((f.errorFlash || 0).toFixed(2)),
                holdProgress: Number((f.holdProgress || 0).toFixed(2)),
                countNumber: f.countNumber || 0,
                x: Math.round(f.x),
                y: Math.round(f.y)
            }))
        }),
        /** Новый раунд счёта — чтобы в тестах посмотреть разные раскладки */
        restartCounting: () => startCountingRound(),
        countingKind: () => (countingKind ? `${countingKind.emoji} ${countingKind.key}` : null),
        /** Имитирует рез объекта рукой */
        cut: (id) => {
            const target = fruits.find((f) => f.compareId === id);
            if (!target) return 'not-found';
            handleCompareCut(target);
            return 'ok';
        }
    };
}

start();
