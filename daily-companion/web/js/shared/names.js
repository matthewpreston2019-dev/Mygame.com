// =============================================================================
// Names used by both the app and the coach messages: workout splits, built-in
// exercises and plan blocks, in all six languages.
// Shared with the server — keep it free of browser APIs.
// =============================================================================

// Built-in exercise ids, in the order they're offered when adding an exercise.
export const EXERCISES = [
  'bench', 'incline', 'ohp', 'dbpress', 'dips', 'chestfly', 'lateral',
  'row', 'dbrow', 'pulldown', 'pullup', 'facepull',
  'curl', 'hammer', 'pushdown', 'skull',
  'squat', 'deadlift', 'rdl', 'legpress', 'lunge', 'hipthrust', 'legcurl', 'legext', 'calf', 'legraise',
];

const NAMES = {
  en: {
    split: { upper: 'Upper', lower: 'Lower' },
    ex: {
      bench: 'Bench press', incline: 'Incline dumbbell press', ohp: 'Overhead press', dbpress: 'Dumbbell shoulder press',
      dips: 'Dips', chestfly: 'Cable fly', lateral: 'Lateral raise', row: 'Barbell row', dbrow: 'Dumbbell row',
      pulldown: 'Lat pulldown', pullup: 'Pull-up', facepull: 'Face pull', curl: 'Biceps curl', hammer: 'Hammer curl',
      pushdown: 'Triceps pushdown', skull: 'Skull crusher', squat: 'Squat', deadlift: 'Deadlift', rdl: 'Romanian deadlift',
      legpress: 'Leg press', lunge: 'Lunges', hipthrust: 'Hip thrust', legcurl: 'Leg curl', legext: 'Leg extension',
      calf: 'Calf raise', legraise: 'Hanging leg raise',
    },
    block: {
      school: 'School', relax: 'Relax & eat', gym: 'Gym', refuel: 'Shower & refuel', study: 'Study',
      review: 'Light review', exam: 'Exam', checkin: 'Check-in', winddown: 'Wind down', sleep: 'Lights out',
    },
  },
  es: {
    split: { upper: 'Tren superior', lower: 'Tren inferior' },
    ex: {
      bench: 'Press de banca', incline: 'Press inclinado con mancuernas', ohp: 'Press militar', dbpress: 'Press de hombros con mancuernas',
      dips: 'Fondos', chestfly: 'Aperturas en polea', lateral: 'Elevaciones laterales', row: 'Remo con barra', dbrow: 'Remo con mancuerna',
      pulldown: 'Jalón al pecho', pullup: 'Dominadas', facepull: 'Face pull', curl: 'Curl de bíceps', hammer: 'Curl martillo',
      pushdown: 'Extensión de tríceps en polea', skull: 'Press francés', squat: 'Sentadilla', deadlift: 'Peso muerto', rdl: 'Peso muerto rumano',
      legpress: 'Prensa de piernas', lunge: 'Zancadas', hipthrust: 'Hip thrust', legcurl: 'Curl femoral', legext: 'Extensión de cuádriceps',
      calf: 'Elevación de talones', legraise: 'Elevación de piernas colgado',
    },
    block: {
      school: 'Clase', relax: 'Descanso y comida', gym: 'Gimnasio', refuel: 'Ducha y comida', study: 'Estudio',
      review: 'Repaso ligero', exam: 'Examen', checkin: 'Check-in', winddown: 'Desconectar', sleep: 'Apagar luces',
    },
  },
  de: {
    split: { upper: 'Oberkörper', lower: 'Unterkörper' },
    ex: {
      bench: 'Bankdrücken', incline: 'Schrägbankdrücken (KH)', ohp: 'Schulterdrücken', dbpress: 'Kurzhantel-Schulterdrücken',
      dips: 'Dips', chestfly: 'Kabelfliegende', lateral: 'Seitheben', row: 'Langhantelrudern', dbrow: 'Kurzhantelrudern',
      pulldown: 'Latziehen', pullup: 'Klimmzüge', facepull: 'Face Pulls', curl: 'Bizepscurls', hammer: 'Hammercurls',
      pushdown: 'Trizepsdrücken am Kabel', skull: 'Stirndrücken', squat: 'Kniebeugen', deadlift: 'Kreuzheben', rdl: 'Rumänisches Kreuzheben',
      legpress: 'Beinpresse', lunge: 'Ausfallschritte', hipthrust: 'Hip Thrust', legcurl: 'Beinbeuger', legext: 'Beinstrecker',
      calf: 'Wadenheben', legraise: 'Hängendes Beinheben',
    },
    block: {
      school: 'Schule', relax: 'Pause & essen', gym: 'Gym', refuel: 'Duschen & essen', study: 'Lernen',
      review: 'Leichte Wiederholung', exam: 'Prüfung', checkin: 'Check-in', winddown: 'Runterfahren', sleep: 'Licht aus',
    },
  },
  ru: {
    split: { upper: 'Верх', lower: 'Низ' },
    ex: {
      bench: 'Жим лёжа', incline: 'Жим гантелей на наклонной', ohp: 'Жим стоя', dbpress: 'Жим гантелей сидя',
      dips: 'Отжимания на брусьях', chestfly: 'Сведение в кроссовере', lateral: 'Махи в стороны', row: 'Тяга штанги в наклоне', dbrow: 'Тяга гантели в наклоне',
      pulldown: 'Тяга верхнего блока', pullup: 'Подтягивания', facepull: 'Тяга к лицу', curl: 'Подъём на бицепс', hammer: 'Молотковые сгибания',
      pushdown: 'Разгибания на трицепс в блоке', skull: 'Французский жим', squat: 'Приседания', deadlift: 'Становая тяга', rdl: 'Румынская тяга',
      legpress: 'Жим ногами', lunge: 'Выпады', hipthrust: 'Ягодичный мост', legcurl: 'Сгибание ног', legext: 'Разгибание ног',
      calf: 'Подъём на носки', legraise: 'Подъём ног в висе',
    },
    block: {
      school: 'Учёба в школе', relax: 'Отдых и еда', gym: 'Зал', refuel: 'Душ и еда', study: 'Учёба',
      review: 'Лёгкое повторение', exam: 'Экзамен', checkin: 'Чек-ин', winddown: 'Отбой скоро', sleep: 'Свет выкл.',
    },
  },
  zh: {
    split: { upper: '上肢', lower: '下肢' },
    ex: {
      bench: '卧推', incline: '上斜哑铃卧推', ohp: '站姿推举', dbpress: '哑铃肩推',
      dips: '双杠臂屈伸', chestfly: '绳索飞鸟', lateral: '侧平举', row: '杠铃划船', dbrow: '哑铃划船',
      pulldown: '高位下拉', pullup: '引体向上', facepull: '面拉', curl: '二头弯举', hammer: '锤式弯举',
      pushdown: '绳索三头下压', skull: '仰卧臂屈伸', squat: '深蹲', deadlift: '硬拉', rdl: '罗马尼亚硬拉',
      legpress: '腿举', lunge: '弓步蹲', hipthrust: '臀推', legcurl: '腿弯举', legext: '腿屈伸',
      calf: '提踵', legraise: '悬垂举腿',
    },
    block: {
      school: '上学', relax: '休息和吃饭', gym: '健身', refuel: '洗澡和补充', study: '学习',
      review: '轻松复习', exam: '考试', checkin: '每日打卡', winddown: '放松准备睡觉', sleep: '熄灯',
    },
  },
  ar: {
    split: { upper: 'الجزء العلوي', lower: 'الجزء السفلي' },
    ex: {
      bench: 'ضغط البنش', incline: 'ضغط مائل بالدمبل', ohp: 'ضغط الكتف بالبار', dbpress: 'ضغط الكتف بالدمبل',
      dips: 'متوازي', chestfly: 'تفتيح بالكابل', lateral: 'رفرفة جانبية', row: 'تجديف بالبار', dbrow: 'تجديف بالدمبل',
      pulldown: 'سحب علوي', pullup: 'عقلة', facepull: 'سحب للوجه', curl: 'ثني البايسبس', hammer: 'ثني المطرقة',
      pushdown: 'دفع الترايسبس بالكابل', skull: 'سكل كراشر', squat: 'سكوات', deadlift: 'الرفعة الميتة', rdl: 'الرفعة الرومانية',
      legpress: 'ضغط الأرجل', lunge: 'طعنات', hipthrust: 'دفع الورك', legcurl: 'ثني الأرجل', legext: 'مد الأرجل',
      calf: 'رفع السمانة', legraise: 'رفع الأرجل معلقًا',
    },
    block: {
      school: 'المدرسة', relax: 'راحة وأكل', gym: 'النادي', refuel: 'استحمام وأكل', study: 'مذاكرة',
      review: 'مراجعة خفيفة', exam: 'امتحان', checkin: 'تسجيل اليوم', winddown: 'استعداد للنوم', sleep: 'إطفاء الأنوار',
    },
  },
};

const pick = (lang) => NAMES[lang] || NAMES.en;

/** Display name of an exercise entry ({ id, name }) or id. */
export function exerciseName(ex, lang) {
  const id = typeof ex === 'string' ? ex : ex?.id;
  if (typeof ex === 'object' && ex?.name) return ex.name;
  return pick(lang).ex[id] || NAMES.en.ex[id] || String(id || '').replace(/^c:/, '');
}

/** Display name of a workout template row (built-ins are translated). */
export function templateName(tpl, lang) {
  if (!tpl) return '';
  if (tpl.name) return tpl.name;
  return pick(lang).split[tpl.key] || NAMES.en.split[tpl.key] || tpl.key || '';
}

/** Name for a split reference from the schedule (template key or id). */
export function splitName(ref, templates, lang) {
  if (!ref) return '';
  const tpl = (templates || []).find((t) => !t.deleted && (t.key === ref || t.id === ref));
  if (tpl) return templateName(tpl, lang);
  return pick(lang).split[ref] || NAMES.en.split[ref] || ref;
}

/** Find the template row for a split reference. */
export function findTemplate(ref, templates) {
  return (templates || []).find((t) => !t.deleted && (t.key === ref || t.id === ref)) || null;
}

/** Label of a plan block (long-day study is called "light review"). */
export function blockName(block, planType, lang) {
  const kind = block.kind === 'study' && planType === 'long' ? 'review' : block.kind;
  return pick(lang).block[kind] || NAMES.en.block[kind] || kind;
}
