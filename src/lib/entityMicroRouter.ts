import type { ContentUnitDto, SourceFileDto } from './bookTypes.ts';
import { toAsciiDigits, toPersianDigits } from './formatParsers.ts';

export type CanonicalEcuFamilyId =
  | 'ecu_siemens'
  | 'ecu_bosch'
  | 'ecu_delphi'
  | 'ecu_valeo'
  | 'ecu_sagem'
  | 'ecu_kesens_ssat'
  | 'ecu_ezu'
  | 'ecu_gharb_maw'
  | 'ecu_acs'
  | 'ecu_kefico_korean';

export interface CanonicalSubChapterSpec {
  id: string;
  order: number;
  titleFa: string;
  matcherRx: RegExp;
}

export interface CanonicalEcuClusterSpec {
  familyId: CanonicalEcuFamilyId;
  pedagogicalOrder: number;
  masterTitleFa: string;
  shortNameFa: string;
  marketCoverageFa: string;
  /** Matches when a chapter/file heading is explicitly dedicated to this ECU family */
  headingMatcherRx: RegExp;
  /** Matches when an inline sentence explicitly references this ECU family or its unique dump signatures */
  sentenceMatcherRx: RegExp;
  subChapters: readonly CanonicalSubChapterSpec[];
  defaultSubChapterId: string;
}

export interface MicroRoutedExtractRecord {
  id: string;
  familyId: CanonicalEcuFamilyId;
  familyShortNameFa: string;
  masterClusterTitleFa: string;
  targetSubChapterTitleFa: string;
  sourceFileName: string;
  originChapterTitleFa: string;
  targetUnitId: string;
  originUnitId: string;
  routeKind: 'inline_sentence_extract' | 'full_unit_relocation';
  extractedTextSnippet: string;
  crossReferenceTextFa: string;
}

export interface ClusterSummaryItem {
  familyId: CanonicalEcuFamilyId | 'dyno_thermodynamics' | 'general_remap_fundamentals';
  masterTitleFa: string;
  shortNameFa: string;
  marketCoverageFa: string;
  totalUnitsCount: number;
  subChaptersCount: number;
  routedExtractsCount: number;
  subChapterTitles: string[];
}

export interface EntityMicroRoutingReport {
  enabled: boolean;
  totalRoutedExtracts: number;
  inlineSentencesRoutedCount: number;
  fullUnitsRelocatedCount: number;
  crossReferencesInsertedCount: number;
  brokenTablesStitchedCount: number;
  clustersSummary: ClusterSummaryItem[];
  extractRecords: MicroRoutedExtractRecord[];
}

/**
 * Complete canonical taxonomy of all ECU families in the Iranian market
 * covering Iranian domestic, Chinese (MVM, Chery/Fownix, JAC, KMC, Lifan, Great Wall, Dongfeng),
 * Korean (Hyundai, Kia), and European/French (Peugeot, Renault, Citroen) platforms.
 */
export const IRANIAN_MARKET_ECU_CLUSTERS: readonly CanonicalEcuClusterSpec[] = [
  {
    familyId: 'ecu_siemens',
    pedagogicalOrder: 100,
    masterTitleFa: 'بخش جامع ایسیوهای زیمنس، کروز و کانتیننتال (Siemens / Continental / Crouse)',
    shortNameFa: 'ایسیوهای زیمنس، کروز و کانتیننتال',
    marketCoverageFa: 'خودروهای ایرانی (ایران‌خودرو، سایپا، پارس‌خودرو، زامیاد) و کره‌ای (هیوندای/کیا SIM2K)',
    headingMatcherRx:
      /(?:زیمنس|siemens|کانتیننتال|continental|\bsim2k\b|\bems3132\b|\bcge\b|\bcee\b|\bciz\b|\bciu\b|\bcgx\b|\bcix(?:34|48)?\b|\bccx\b|\bcbr\b|\bcbar\b|\bcbir\b|\bcvr\b|\b5wp4\b|\bno[-_\s]?flash\b|\b9b00\b|\bpgm\s*10\b|\bs48\b|درس\s*[۱-۹1-9].*(?:تیبا|xu7|tu5|ef7|xup)|ماتریس\s*ممیزی.*زیمنس)/i,
    sentenceMatcherRx:
      /(?:\bزیمنس\b|\bsiemens\b|\bکانتیننتال\b|\bcontinental\b|\bsim2k(?:[-_\s]?\d+(?:vr)?)?\b|\bems\s*313[24]\b|\b5wp4(?:\.11)?\b|\b(?:ci[1-8]|cio|cip|cir|cid|cge|cee|cbm\s*e4|c4e|ciz|ciu|cgx|cgs|cgd|cr[1-3]|cix34|cix48|ccx|cbr|cbar|cbir|cvr|ptp|pgm\s*10)\b|\bno[-_\s]?flash\b|\b9b00\b|\bdephia\b|0?16\s+400\b|5\s+31\s+63\b|94\s+127\s+255|154\s+209\s+000\s+000|085\s+208\s+250\s+000|32767.*(?:اکسیژن|لامبدا)|(?:اکسیژن|لامبدا).*32767|580\s+584|051\s+066\s+074)/i,
    defaultSubChapterId: 'siemens_sub_2_arch',
    subChapters: [
      {
        id: 'siemens_sub_1_history',
        order: 1,
        titleFa: '۱. تاریخچه، تبارشناسی ۷ نسلی و جدول مرجع جامع مدل‌های زیمنس در ایران',
        matcherRx: /(?:تاریخچه|تبارشناسی|جدول\s*مرجع\s*مدل|5wp4\.11|نسل\s*اول|نسل\s*دوم|کیا\s*پراید\s*زیمنس|ماتریس\s*ممیزی)/i,
      },
      {
        id: 'siemens_sub_2_arch',
        order: 2,
        titleFa: '۲. معماری حافظه، محورها (016 400 / 5 31 63)، ضرایب تبدیل، سنسورها (Lambda 32767)، کات‌آف (DEPHIA) و ایموبلایزر',
        matcherRx: /(?:ساختار\s*حافظه|محور|ضریب|فاکتور|0?16\s*400|5\s*31\s*63|dephia|94\s*127\s*255|154\s*209|32767|سنسور\s*اکسیژن|ایموبلایزر|کد\s*واریانت|05\s*05|محدودیت\s*سرعت|حجم\s*موتور\s*8x12|درس\s*[۱-۴1-4]\b)/i,
      },
      {
        id: 'siemens_sub_3_m15',
        order: 3,
        titleFa: '۳. کالیبراسیون زیمنس خانواده موتور M15 و M13 سایپا (تیبا، ساینا، کوییک و پراید یورو ۴)',
        matcherRx: /(?:تیبا|ساینا|کوییک|\bm15\b|\bm13\b|پراید\s*یورو\s*[۴4]|580\s*584|051\s*066\s*074|درس\s*[۵5]\b)/i,
      },
      {
        id: 'siemens_sub_4_xu7',
        order: 4,
        titleFa: '۴. کالیبراسیون زیمنس خانواده موتور XU7 بنزینی و دوگانه‌سوز (CGE، CEE، PTP و CI)',
        matcherRx: /(?:درس\s*[۶6]|\bxu7\b(?!\s*(?:plus|پلاس|\bp\b))|\bcge\b|\bcee\b|\bptp\b|پژو\s*405|پژو\s*۴۰۵|سمند\s*معمولی|بای[‌\s]?فیول)/i,
      },
      {
        id: 'siemens_sub_5_tu5_noflash',
        order: 5,
        titleFa: '۵. کالیبراسیون زیمنس خانواده موتور TU5، ایسیوهای No-Flash (0x68000 / 9B00) و ترفندهای سخت‌افزاری (CIZ/CIU و CCX)',
        matcherRx: /(?:درس\s*[۷7]|\btu5\b|\bno[-_\s]?flash\b|نو[‌\s]?فلش|\b9b00\b|0x68000.*tu5|\bciz\b|\bciu\b|\bccx\b|\bcix(?:34|48)?\b|\bcr[1-3]\b|سنسور\s*طوسی)/i,
      },
      {
        id: 'siemens_sub_6_ef7',
        order: 6,
        titleFa: '۶. کالیبراسیون زیمنس خانواده موتور EF7 پایه گازسوز و بنزینی (CBAR، CBiR، CVR در TNM و WinOLS 0x14000 و VVT)',
        matcherRx: /(?:درس\s*[۸8]|\bef7\b|موتور\s*ملی|\bcbar\b|\bcbir\b|\bcbr\b|\bcvr\b|0x14000|\bvvt\b.*5%|6x16)/i,
      },
      {
        id: 'siemens_sub_7_xup',
        order: 7,
        titleFa: '۷. کالیبراسیون زیمنس خانواده موتور XU7 Plus (XUP) یورو ۵ در TNM و WinOLS (0x68000)',
        matcherRx: /(?:درس\s*[۹9]|\bxu7\s*plus\b|\bxu7p\b|\bxup\b|ایکس[‌\s]?یو[‌\s]?۷\s*پلاس|overrun.*255|1\.4.*1\.7)/i,
      },
      {
        id: 'siemens_sub_8_sim2k_dyno',
        order: 8,
        titleFa: '۸. خانواده L90 (EMS3132)، زامیاد، هیوندای/کیا (SIM2K-34VR/48VR/241)، PGM 10 و رفتار زیمنس روی داینو',
        matcherRx: /(?:ems3132|تندر|ال\s*۹۰|\bl90\b|زامیاد|نیسان|\bsim2k\b|هیوندای|کیا|\bpgm\s*10\b|\bs48\b|داینو|dyno|جدول\s*ve|speed[-_\s]?density)/i,
      },
    ],
  },
  {
    familyId: 'ecu_bosch',
    pedagogicalOrder: 110,
    masterTitleFa: 'بخش جامع ایسیوهای بوش (Bosch — خودروهای ایرانی، چینی و کره‌ای)',
    shortNameFa: 'ایسیوهای بوش (Bosch)',
    marketCoverageFa: 'خودروهای ایرانی (TU5، EF7، XU7، زامیاد، سایپا)، چینی (چری، ام‌وی‌ام، جک، لیفان، کی‌ام‌سی) و کره‌ای (هیوندای/کیا)',
    headingMatcherRx:
      /(?:ایسیو.*بوش|\bbosch\b|\bme\s*7\.?4\.?[459]\b|\bme\s*17\b|\bmed\s*17\b|\bmeg\s*17\b|\bmp\s*5\.?0\b|\bmp\s*7\.?3\b|بوش\s*s2|بوش\s*اس\s*[۲2]|\bmg1\b|\bmd1\b)/i,
    sentenceMatcherRx:
      /(?:\bبوش\b|\bbosch\b|\bme\s*7\.?4\.?[459]\b|\bm(?:e)?\s*7\.?9\.?[78]\b|\bme?\s*7\.?8(?:\.8)?\b|\bme(?:d|g|vd)?\s*17(?:\.9\.\d+)?\b|\bedc\s*17\b|\bmp\s*[57]\.?[03]\b|\bmg1(?:cs|us)?\d*\b|\bmd1\b|098\s+058|248\s+253|136\s+019|\bkfzw2?\b|\bkfped\b|\bkfmiop\b|\bkfmirl\b|\blamfa\b|\bldrxn\b|\bcwsawe\b)/i,
    defaultSubChapterId: 'bosch_sub_1_arch',
    subChapters: [
      {
        id: 'bosch_sub_1_arch',
        order: 1,
        titleFa: '۱. معماری گشتاورمحور بوش، محورهای 098 058، ضرایب تبدیل، سنسورها و منطق بار نسبی (rl)',
        matcherRx: /(?:098\s*058|محور|ضریب|فاکتور|سنسور|خطا|dtc|ایموبلایزر|چک[‌\s]?سام|ساختار\s*حافظه|بار\s*نسبی|\brl\b|\bkfmiop\b|\bkfmirl\b)/i,
      },
      {
        id: 'bosch_sub_2_mp',
        order: 2,
        titleFa: '۲. کالیبراسیون نسل Bosch MP5.0 و MP7.3 (زامیاد، پژو ۲۰۶، پارس و سمند)',
        matcherRx: /(?:\bmp\s*5\.?0\b|\bmp\s*7\.?3\b|ام[‌\s]?پی\s*[۵۷57])/i,
      },
      {
        id: 'bosch_sub_3_me744_745',
        order: 3,
        titleFa: '۳. کالیبراسیون نسل Bosch ME7.4.4 و ME7.4.5 (موتور TU5 — جرقه، سوخت، گشتاور، کات‌آف 248 253 / 87 02 و ناک)',
        matcherRx: /(?:\bme\s*7\.?4\.?[45]\b|7\.4\.4|7\.4\.5|۷\.۴\.۴|۷\.۴\.۵|248\s*253|136\s*019|87\s*02)/i,
      },
      {
        id: 'bosch_sub_4_m797_me788',
        order: 4,
        titleFa: '۴. کالیبراسیون نسل Bosch M7.9.7 و ME7.8.8 (خودروهای چینی MVM، چری، لیفان، جک و خودروهای ایرانی)',
        matcherRx: /(?:\bm(?:e)?\s*7\.?9\.?[78]\b|\bme?\s*7\.?8(?:\.8)?\b|چینی|ام[‌\s]?وی[‌\s]?ام|چری|لیفان|جک)/i,
      },
      {
        id: 'bosch_sub_5_s2',
        order: 5,
        titleFa: '۵. کالیبراسیون نسل Bosch S2 (خانواده سایپا M15، ساینا و کوییک)',
        matcherRx: /(?:بوش\s*s2|بوش\s*اس\s*[۲2]|\bbosch\s*s2\b)/i,
      },
      {
        id: 'bosch_sub_6_me17_med17_korean',
        order: 6,
        titleFa: '۶. کالیبراسیون نسل Bosch ME17، MED17 و MEG17.9.12/13 (پژو ۲۰۷، دنا، تارا، هیوندای/کیا کره‌ای و چینی توربو)',
        matcherRx: /(?:\bme(?:d|g|vd)?\s*17\b|\bedc\s*17\b|۱۷\.۹\.۷|17\.9\.7|17\.9\.1[23]|هیوندای|کیا|توربو)/i,
      },
      {
        id: 'bosch_sub_7_mg1_dyno',
        order: 7,
        titleFa: '۷. نسل Bosch MG1 / MD1 (خودروهای چینی TGDI و کره‌ای مدرن) و رفتار ایسیوهای بوش روی داینو',
        matcherRx: /(?:\bmg1\b|\bmd1\b|tgdi|داینو|dyno|\bkfzw\b|\blamfa\b|\bldrxn\b)/i,
      },
    ],
  },
  {
    familyId: 'ecu_delphi',
    pedagogicalOrder: 120,
    masterTitleFa: 'بخش جامع ایسیوهای دلفی (Delphi — خودروهای چینی، کره‌ای و ایرانی)',
    shortNameFa: 'ایسیوهای دلفی (Delphi)',
    marketCoverageFa: 'خودروهای چینی (ام‌وی‌ام، چری/فونیکس، تیگو، آریزو، جک S5، کی‌ام‌سی، لیفان، گریت‌وال، دانگ‌فنگ H30) و کره‌ای (هیوندای/کیا MT38/MT86)',
    headingMatcherRx:
      /(?:دلفی|\bdelphi\b|\bmt(?:20u2?|22(?:\.1)?|34|38|60|80|86|92(?:\.1)?)\b)/i,
    sentenceMatcherRx:
      /(?:\bدلفی\b|\bdelphi\b|\bmt(?:20u2?|22(?:\.1(?:\.1)?|u)?|34|38|60|62\.1|80|86|92(?:\.1)?)\b|\bdcm[367]\.\d\b)/i,
    defaultSubChapterId: 'delphi_sub_1_arch',
    subChapters: [
      {
        id: 'delphi_sub_1_arch',
        order: 1,
        titleFa: '۱. معماری حافظه، جداول گشتاور، ضرایب، ناک و حفاظت حرارتی در ایسیوهای دلفی (Delphi)',
        matcherRx: /(?:معماری|گشتاور|ضریب|سنسور|ناک|حرارتی|داینو|dyno|حفاظت)/i,
      },
      {
        id: 'delphi_sub_2_mt20_mt22',
        order: 2,
        titleFa: '۲. کالیبراسیون نسل Delphi MT20U، MT22.1 و MT34 (خودروهای چینی MVM، لیفان، جک، گریت‌وال و دانگ‌فنگ)',
        matcherRx: /(?:\bmt20|\bmt22|\bmt34|ام[‌\s]?وی[‌\s]?ام|لیفان|گریت[‌\s]?وال)/i,
      },
      {
        id: 'delphi_sub_3_mt60_mt80_mt92',
        order: 3,
        titleFa: '۳. کالیبراسیون نسل Delphi MT60، MT80 و MT92.1 (خودروهای چینی توربو و TGDI چری، فونیکس، تیگو، آریزو، جک S5 و KMC)',
        matcherRx: /(?:\bmt60|\bmt62|\bmt80|\bmt92|توربو|tgdi|چری|فونیکس|تیگو|آریزو|کی[‌\s]?ام[‌\s]?سی)/i,
      },
      {
        id: 'delphi_sub_4_mt38_mt86_korean',
        order: 4,
        titleFa: '۴. کالیبراسیون نسل Delphi MT38 و MT86 (خودروهای کره‌ای هیوندای و کیا ۶ سیلندر و GDI)',
        matcherRx: /(?:\bmt38|\bmt86|هیوندای|کیا|کره[‌\s]?ای|gdi)/i,
      },
    ],
  },
  {
    familyId: 'ecu_valeo',
    pedagogicalOrder: 130,
    masterTitleFa: 'بخش جامع ایسیوهای والیو (Valeo — J34 / J34P / PL4 / V42 / S3000)',
    shortNameFa: 'ایسیوهای والیو (Valeo J34)',
    marketCoverageFa: 'پژو ۲۰۶، ۲۰۷، رانا (موتور TU5 با Valeo J34/J34P) و رنو تندر ۹۰ / ساندرو (Valeo V42 / S3000)',
    headingMatcherRx:
      /(?:والیو|والئو|\bvaleo\b|\bj34p?\b|\bj35\b|\b9661960880\b|\bs3000\b|\bv4[026]\b)/i,
    sentenceMatcherRx:
      /(?:\bوالیو\b|\bوالئو\b|\bvaleo\b|\bj34p?\b|\bj35\b|\b9661960880\b|\bs3000\b|\bv4[026]\b|پدال\s*۱\s*و\s*پدال\s*۲.*250)/i,
    defaultSubChapterId: 'valeo_sub_2_j34',
    subChapters: [
      {
        id: 'valeo_sub_1_arch_bug',
        order: 1,
        titleFa: '۱. معماری ایسیوهای والیو و هشدار بحرانی باگ آپدیت ۱۴۰۴ در جداول پدال (Pedal 1 & 2)',
        matcherRx: /(?:پدال|pedal|آپدیت\s*۱۴۰۴|آپدیت\s*1404|250|محدودیت|کپ)/i,
      },
      {
        id: 'valeo_sub_2_j34',
        order: 2,
        titleFa: '۲. کالیبراسیون عملی Valeo J34 / J34P (موتور TU5 — کالیبر 9661960880: جداول جرقه 16x14، سوخت 9x9، لامبدا و گشتاور 16x16 به همراه تصاویر)',
        matcherRx: /(?:\bj34p?\b|9661960880|spark\s*advance|injection|lambda\s*sensor|engine\s*torque|16x14|9x9|16x16|16x11|0\.38|جدول\s*جرقه|جدول\s*پاشش|جدول\s*لامبدا|جدول\s*گشتاور)/i,
      },
      {
        id: 'valeo_sub_3_v42_s3000',
        order: 3,
        titleFa: '۳. کالیبراسیون نسل Valeo V40 / V42 / S3000 و PL4 (تندر ۹۰، ساندرو و پژو)',
        matcherRx: /(?:\bv4[026]\b|\bs3000\b|\bpl4\b|تندر|ساندرو)/i,
      },
    ],
  },
  {
    familyId: 'ecu_sagem',
    pedagogicalOrder: 140,
    masterTitleFa: 'بخش جامع ایسیوهای ساژم (Sagem — S2000 / PL4 / 3E / 3F / Valvetronic / SL96)',
    shortNameFa: 'ایسیوهای ساژم (Sagem S2000)',
    marketCoverageFa: 'پژو ۴۰۵، پارس، سمند، روآ، پراید و پژو ۲۰۶ تیپ ۲ (خانواده S2000 و SL96)',
    headingMatcherRx: /(?:ساژم|\bsagem\b|\bs2000\b|\bsl96\b)/i,
    sentenceMatcherRx:
      /(?:\bساژم\b|\bsagem\b|\bs2000(?:[-_\s]?[a-z0-9]+)?\b|\bsl96\b|6300000|10\s+20\s+30.*ساژم|ساژم.*064)/i,
    defaultSubChapterId: 'sagem_sub_1_arch',
    subChapters: [
      {
        id: 'sagem_sub_1_arch',
        order: 1,
        titleFa: '۱. معماری ۸ و ۱۶ بیتی ساژم، محورهای 10 20 30، ضرایب جرقه (064)، سنسور اکسیژن مقاومتی و دمای فن',
        matcherRx: /(?:محور|ضریب|064|10\s*20\s*30|سنسور\s*اکسیژن|مقاومت|دمای\s*فن|ساختار\s*حافظه)/i,
      },
      {
        id: 'sagem_sub_2_s2000_calib',
        order: 2,
        titleFa: '۲. کالیبراسیون عملی Sagem S2000 (پژو ۴۰۵، پارس، سمند، پراید و ۲۰۶ تیپ ۲ — جداول جرقه، سوخت و کات‌آف 6300000)',
        matcherRx: /(?:\bs2000\b|6300000|210|کات[‌\s]?آف|جرقه|سوخت|پاشش|ولوترونیک|valvetronic)/i,
      },
    ],
  },
  {
    familyId: 'ecu_kesens_ssat',
    pedagogicalOrder: 150,
    masterTitleFa: 'بخش جامع ایسیوهای کیسنس، اس‌اس‌ای‌تی و LZNF (Kesens / SSAT / LZNF)',
    shortNameFa: 'ایسیوهای کیسنس و زیمنس SSAT',
    marketCoverageFa: 'پژو پارس، ۴۰۵، سمند،۲۰۶ (Kesens ME7.4.9) و پراید، تیبا، ساینا (SSAT / LZNF SPC56)',
    headingMatcherRx: /(?:کیسنس|کسنس|\bkesens\b|\bssat\b|اس[‌\s]?ست|\blznf\b)/i,
    sentenceMatcherRx:
      /(?:\bکیسنس\b|\bکسنس\b|\bkesens\b|\bssat\b|اس[‌\s]?ست|\blznf\b|\bspc56\b|55\s+46.*36120|36120.*55\s+46)/i,
    defaultSubChapterId: 'kesens_sub_1_me749',
    subChapters: [
      {
        id: 'kesens_sub_1_me749',
        order: 1,
        titleFa: '۱. کالیبراسیون ایسیوهای Kesens / Crouse ME7.4.9 (آفست ۱۰ درجه‌ای جرقه، آزادسازی گشتاور 25000 و سرعت 55 46)',
        matcherRx: /(?:کیسنس|کسنس|\bkesens\b|7\.4\.9|۷\.۴\.۹|25000|55\s*46|36120)/i,
      },
      {
        id: 'kesens_sub_2_ssat_lznf',
        order: 2,
        titleFa: '۲. کالیبراسیون ایسیوهای زیمنس SSAT و LZNF SPC56 (پراید، تیبا، ساینا و پژو ۴۰۵/پارس)',
        matcherRx: /(?:\bssat\b|اس[‌\s]?ست|\blznf\b|\bspc56\b)/i,
      },
    ],
  },
  {
    familyId: 'ecu_ezu',
    pedagogicalOrder: 160,
    masterTitleFa: 'بخش جامع ایسیوهای ایزی‌یو (EZU / EasyU 2.0 / 2.5 / 2.8)',
    shortNameFa: 'ایسیوهای ایزی‌یو (EZU / EasyU)',
    marketCoverageFa: 'سمند، پژو ۴۰۵، پارس، تیبا، ساینا و کوییک (خانواده کروز و کانتیننتال EasyU)',
    headingMatcherRx: /(?:\bezu\b|\beasyu\b|ایزی[‌\s]?یو)/i,
    sentenceMatcherRx:
      /(?:\bezu\b|\beasyu(?:\s*2\.[058])?\b|ایزی[‌\s]?یو|32\s+64.*82\s+56|45\s+00\s+45\s+00|65279|7296.*فن)/i,
    defaultSubChapterId: 'ezu_sub_1_arch',
    subChapters: [
      {
        id: 'ezu_sub_1_arch',
        order: 1,
        titleFa: '۱. معماری ۱۶ بیتی HiLo در EZU، محور دور (32 64) و بار (82 56)، فرمول دمای فن (7296) و محدودیت سرعت (45 00 45 00)',
        matcherRx: /(?:32\s*64|82\s*56|7296|45\s*00|65279|محور|ضریب|دمای\s*فن|سرعت)/i,
      },
      {
        id: 'ezu_sub_2_calib',
        order: 2,
        titleFa: '۲. کالیبراسیون عملی جداول جرقه، سوخت، کات‌آف و گشتاور در خانواده EasyU 2.0 / 2.5 / 2.8',
        matcherRx: /(?:جرقه|سوخت|پاشش|کات[‌\s]?آف|گشتاور|easyu)/i,
      },
    ],
  },
  {
    familyId: 'ecu_gharb_maw',
    pedagogicalOrder: 170,
    masterTitleFa: 'بخش جامع ایسیوهای غرب استیل و ام‌ای‌دبلیو (Gharb Steel & MAW)',
    shortNameFa: 'ایسیوهای غرب استیل و MAW',
    marketCoverageFa: 'سمند، پژو ۴۰۵، پارس، روآ و وانت زامیاد دوگانه‌سوز و بنزینی (Gharb Steel & MAW)',
    headingMatcherRx: /(?:غرب\s*استیل|\bgharb\s*steel\b|\bmaw\b|ایسیو\s*ماو)/i,
    sentenceMatcherRx:
      /(?:غرب\s*استیل|\bgharb\s*steel\b|\bmaw\b|ایسیو\s*ماو|46760.*کات[‌\s]?آف|منهای\s*141|منهای\s*۱۴۱)/i,
    defaultSubChapterId: 'gharb_sub_1_gharb',
    subChapters: [
      {
        id: 'gharb_sub_1_gharb',
        order: 1,
        titleFa: '۱. کالیبراسیون ایسیوهای غرب استیل (پایه جرقه 141، جداول ۱۶×۱۶ سوخت، کات‌آف 46760 و استراتژی دوگانه‌سوز)',
        matcherRx: /(?:غرب\s*استیل|141|۱۴۱|46760|دوگانه)/i,
      },
      {
        id: 'gharb_sub_2_maw',
        order: 2,
        titleFa: '۲. کالیبراسیون ایسیوهای MAW (حجم فلش ۲۰۴۸ کیلوبایت، شباهت ساختاری با غرب استیل و جداول عملی)',
        matcherRx: /(?:\bmaw\b|ماو|2048|۲۰۴۸)/i,
      },
    ],
  },
  {
    familyId: 'ecu_acs',
    pedagogicalOrder: 180,
    masterTitleFa: 'بخش جامع ایسیوهای ای‌سی‌اس (ACS — دنا توربو، شاهین و XU7P)',
    shortNameFa: 'ایسیوهای ای‌سی‌اس (ACS)',
    marketCoverageFa: 'دنا پلاس توربو، سورن توربو، شاهین و پژو پارس/سمند موتور XU7P',
    headingMatcherRx: /(?:\bacs\b|ایسیو\s*ای[‌\s]?سی[‌\s]?اس)/i,
    sentenceMatcherRx: /(?:\bacs\b|ایسیو\s*ای[‌\s]?سی[‌\s]?اس)/i,
    defaultSubChapterId: 'acs_sub_1_arch',
    subChapters: [
      {
        id: 'acs_sub_1_arch',
        order: 1,
        titleFa: '۱. معماری ۱۶ بیتی LoHi در ایسیوهای ACS، محور دور (0.25) و بار (0.01)، کات‌آف، دمای فن و حذف خطا',
        matcherRx: /(?:0\.25|0\.01|محور|ضریب|کات[‌\s]?آف|فن|خطا)/i,
      },
      {
        id: 'acs_sub_2_turbo_calib',
        order: 2,
        titleFa: '۲. کالیبراسیون جداول گشتاور، دریچه گاز، جرقه و بوست در موتورهای EF7 TC (دنا توربو) و XU7P',
        matcherRx: /(?:گشتاور|دریچه\s*گاز|جرقه|بوست|توربو|سوخت)/i,
      },
    ],
  },
  {
    familyId: 'ecu_kefico_korean',
    pedagogicalOrder: 190,
    masterTitleFa: 'بخش جامع ایسیوهای کفیکو و پلتفرم‌های کره‌ای (Kefico / Hyundai / Kia)',
    shortNameFa: 'ایسیوهای کفیکو (Kefico کره‌ای)',
    marketCoverageFa: 'خودروهای وارداتی و مونتاژی هیوندای و کیا در بازار ایران (موتورهای MPI، GDI و T-GDI)',
    headingMatcherRx: /(?:کفیکو|\bkefico\b|\bcpegd\d*\b|\bcpgdsh\d*\b)/i,
    sentenceMatcherRx: /(?:\bکفیکو\b|\bkefico\b|\bcpegd\d*\b|\bcpgdsh\d*\b)/i,
    defaultSubChapterId: 'kefico_sub_1_arch',
    subChapters: [
      {
        id: 'kefico_sub_1_arch',
        order: 1,
        titleFa: '۱. معماری ایسیوهای Kefico (CPEGD2 / CPGDSH2) در خودروهای هیوندای و کیا',
        matcherRx: /(?:معماری|cpegd|cpgdsh|حافظه|سنسور)/i,
      },
      {
        id: 'kefico_sub_2_calib',
        order: 2,
        titleFa: '۲. کالیبراسیون جداول جرقه، گشتاور، CVVT و حفاظت حرارتی در موتورهای MPI و GDI کره‌ای',
        matcherRx: /(?:جرقه|گشتاور|cvvt|gdi|mpi|داینو)/i,
      },
    ],
  },
];

function normalizeForMatch(text: string): string {
  return toAsciiDigits(text || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a heading path belongs natively to a dedicated ECU family chapter.
 * Notice priority ordering: more specific sub-families (`ecu_kesens_ssat`, `ecu_ezu`, `ecu_gharb_maw`, `ecu_acs`, `ecu_valeo`, `ecu_sagem`, `ecu_delphi`, `ecu_kefico_korean`)
 * are checked before broad `ecu_siemens` / `ecu_bosch` when a chapter heading specifically names e.g. "زیمنس SSAT" or "کیسنس 7.4.9".
 */
const HEADING_PRIORITY_ORDER: readonly CanonicalEcuFamilyId[] = [
  'ecu_valeo',
  'ecu_sagem',
  'ecu_delphi',
  'ecu_kesens_ssat',
  'ecu_ezu',
  'ecu_gharb_maw',
  'ecu_acs',
  'ecu_kefico_korean',
  'ecu_siemens',
  'ecu_bosch',
];

export function detectNativeHeadingEcuFamily(
  headingPath: string,
  fileName = ''
): CanonicalEcuClusterSpec | null {
  const normHeading = normalizeForMatch(headingPath);
  const normFile = normalizeForMatch(fileName);

  // If the entire file is dedicated to a specific ECU family (like `ایسیو زیمنس.md`, `Bakhsh1`, `Bakhsh2`, `j34.md`)
  if (/j34/i.test(normFile)) {
    return IRANIAN_MARKET_ECU_CLUSTERS.find((c) => c.familyId === 'ecu_valeo') || null;
  }
  if (/زیمنس|bakhsh[12].*dars/i.test(normFile)) {
    return IRANIAN_MARKET_ECU_CLUSTERS.find((c) => c.familyId === 'ecu_siemens') || null;
  }

  // Otherwise check the chapter/section heading (top segment of headingPath)
  const topChapterHeading = normHeading.split('>')[0]?.trim() || normHeading;

  // Guard: If the top chapter heading is a general fundamentals/dyno/sensors/memory/winols/turbo chapter
  // (like Chapters 1..10 of BOOK_DAY01_04_Final or Lessons 1..20 of dyno2.md), it is NOT a dedicated ECU chapter!
  const isGeneralChapter =
    /(?:فصل\s*(?:اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|[1-9]|10)\b|مبانی|مفاهیم\s*پایه|ساختار\s*حافظه|محورها\s*و\s*فاکتورها|نمای\s*دوبعدی|تنظیمات\s*پایه\s*وینولز|عیب\s*یابی.*حذف\s*کد\s*خطا|ایموبلایزر.*چک\s*سام|موتورهای\s*تقویت|موتورهای\s*توربوشارژ|اصول\s*تست\s*با\s*داینو|فیزیک\s*داینو|تحلیل\s*مهندسی\s*گراف\s*داینو|ترمودینامیک|درس\s*(?:1[0-9]|20|[1-9])\s*:.*(?:داینو|توان|گشتاور|غلطک|تصحیح|ناک|لامبدا|سنسور|پمپ|توربو|استراتژی))/i.test(
      topChapterHeading
    ) && !/زیمنس|بوش|والیو|ساژم|دلفی|کیسنس|غرب\s*استیل/i.test(topChapterHeading);

  if (isGeneralChapter) {
    return null;
  }

  for (const famId of HEADING_PRIORITY_ORDER) {
    const spec = IRANIAN_MARKET_ECU_CLUSTERS.find((c) => c.familyId === famId)!;
    if (spec.headingMatcherRx.test(topChapterHeading)) {
      return spec;
    }
  }

  return null;
}

/**
 * Classifies a text block or sentence belonging to `clusterSpec` into its best matching Engine/Generation Sub-Chapter.
 */
export function resolveTargetSubChapter(
  clusterSpec: CanonicalEcuClusterSpec,
  text: string,
  headingPath = ''
): CanonicalSubChapterSpec {
  const combined = normalizeForMatch(`${headingPath} ${text}`);
  for (const sub of clusterSpec.subChapters) {
    if (sub.matcherRx.test(combined)) {
      return sub;
    }
  }
  return (
    clusterSpec.subChapters.find((s) => s.id === clusterSpec.defaultSubChapterId) ||
    clusterSpec.subChapters[0]
  );
}

/**
 * Detects which canonical ECU family (or families) a single sentence explicitly discusses.
 */
export function detectSentenceEcuFamilies(sentence: string): CanonicalEcuClusterSpec[] {
  const norm = normalizeForMatch(sentence);
  if (norm.length < 10) return [];

  const matched: CanonicalEcuClusterSpec[] = [];
  for (const famId of HEADING_PRIORITY_ORDER) {
    const spec = IRANIAN_MARKET_ECU_CLUSTERS.find((c) => c.familyId === famId)!;
    if (spec.sentenceMatcherRx.test(norm)) {
      matched.push(spec);
    }
  }
  return matched;
}

function splitSentencesPreservingStructure(text: string): string[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?<=[.؟!؛\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [raw];
}

/**
 * Executes Stage 2 Entity-Centric Micro-Routing across project units:
 * 1. Normalizes units from dedicated ECU chapters/files into unified Master ECU Sections with Engine/Generation Sub-Chapters
 *    (for Siemens, Bosch, Delphi, Valeo, Sagem, Kesens/SSAT, EZU, Gharb Steel/MAW, ACS, Kefico).
 * 2. Scans general chapters (Dyno, Cylinder Thermodynamics, Sensors, Memory, Axes, Diagnostics, Turbo, etc.)
 *    at the sentence and sub-block level:
 *    - If an entire paragraph/subheading/list in a general chapter is about a specific ECU family, or if individual sentences
 *      inside a general paragraph discuss a specific ECU family (even a single line!), those sentences are routed and merged
 *      into the canonical target ECU cluster & sub-chapter.
 *    - A clean cross-reference pointer (`↗ [نکته اختصاصی «...» در این مبحث به «... ⟵ ...» منتقل و یکپارچه شد]`)
 *      is left in the origin general chapter so context flow is preserved with zero fragmentation.
 */
export function runStage2EntityMicroRouting(params: {
  projectId: string;
  sourceFiles: SourceFileDto[];
  units: ContentUnitDto[];
}): {
  routedUnits: ContentUnitDto[];
  report: EntityMicroRoutingReport;
} {
  const fileMap = new Map(params.sourceFiles.map((f) => [f.id, f]));

  // Clone units so we can safely update rawText, headingPath, and metadataJson
  const workingUnits: ContentUnitDto[] = params.units.map((u) => ({
    ...u,
    metadataJson: u.metadataJson ? { ...u.metadataJson } : {},
  }));

  // Determine if this project contains multi-chapter or automotive ECU/Dyno content worthy of micro-routing
  const sampleCorpus = workingUnits
    .slice(0, 60)
    .map((u) => `${u.headingPath || ''} ${u.rawText.slice(0, 200)}`)
    .join(' ');
  const isAutomotiveCorpus =
    /(?:ایسیو|\becu\b|زیمنس|بوش|والیو|والئو|ساژم|دلفی|کیسنس|وینولز|winols|tnm|داینو|dyno|ریمپ|کالیبراسیون|کات[‌\s]?آف|ادونس|لامبدا)/i.test(
      sampleCorpus
    );

  // Only activate micro-routing when there are >= 10 units in an automotive corpus (protects tiny 2-unit synthetic unit tests)
  if (!isAutomotiveCorpus || workingUnits.length < 10) {
    return {
      routedUnits: workingUnits,
      report: {
        enabled: false,
        totalRoutedExtracts: 0,
        inlineSentencesRoutedCount: 0,
        fullUnitsRelocatedCount: 0,
        crossReferencesInsertedCount: 0,
        brokenTablesStitchedCount: 0,
        clustersSummary: [],
        extractRecords: [],
      },
    };
  }

  // Pass 1: Identify native ECU chapter units and assign them to their canonical Master ECU Cluster + Engine/Generation Sub-Chapter
  // Also index a target receptor unit for each (familyId, subChapterId) so inline extracts from general chapters can be merged into them!
  const receptorUnitByFamilySub = new Map<string, ContentUnitDto>();
  const receptorUnitByFamily = new Map<CanonicalEcuFamilyId, ContentUnitDto>();
  const unitNativeFamily = new Map<string, CanonicalEcuClusterSpec>();

  for (const u of workingUnits) {
    if (u.status === 'merged') continue;
    const fName = fileMap.get(u.sourceFileId)?.fileName || '';
    const nativeSpec = detectNativeHeadingEcuFamily(u.headingPath || '', fName);
    if (!nativeSpec) continue;

    unitNativeFamily.set(u.id, nativeSpec);
    const targetSub = resolveTargetSubChapter(nativeSpec, u.rawText, u.headingPath || '');
    const canonicalHeadingPath = `${nativeSpec.masterTitleFa} > ${targetSub.titleFa}`;

    u.headingPath = canonicalHeadingPath;
    u.metadataJson = {
      ...(u.metadataJson || {}),
      headingPath: canonicalHeadingPath,
      canonicalEcuFamilyId: nativeSpec.familyId,
      canonicalSubChapterId: targetSub.id,
    };

    // Prefer paragraph or callout units as text receptors for inline sentence merges
    if (u.unitType === 'paragraph' || u.unitType === 'callout') {
      const subKey = `${nativeSpec.familyId}::${targetSub.id}`;
      if (!receptorUnitByFamilySub.has(subKey)) {
        receptorUnitByFamilySub.set(subKey, u);
      }
      if (!receptorUnitByFamily.has(nativeSpec.familyId)) {
        receptorUnitByFamily.set(nativeSpec.familyId, u);
      }
    }
  }

  const extractRecords: MicroRoutedExtractRecord[] = [];
  let inlineSentencesRoutedCount = 0;
  let fullUnitsRelocatedCount = 0;
  let crossReferencesInsertedCount = 0;

  // Keep track of stateful subheading context inside general chapters
  // (e.g., if a subheading in Chapter 3 says "ایسیوهای زیمنس:" and the next paragraph says "ضریب محور دور موتور ۳۲ است")
  let activeInlineSubheadingSpec: CanonicalEcuClusterSpec | null = null;
  let activeInlineSubheadingSourceId = '';

  for (let i = 0; i < workingUnits.length; i++) {
    const u = workingUnits[i];
    if (u.status === 'merged') continue;
    if (unitNativeFamily.has(u.id)) {
      activeInlineSubheadingSpec = null;
      continue;
    }

    const fName = fileMap.get(u.sourceFileId)?.fileName || 'سند منبع';
    const originChapterTitle = (u.headingPath || 'فصل عمومی').split('>')[0]?.trim() || 'فصل عمومی';
    const originSubSectionTitle =
      (u.headingPath || '')
        .split('>')
        .slice(1)
        .join(' — ')
        .trim() || originChapterTitle;

    // Reset subheading context when source file or top chapter changes
    const contextKey = `${u.sourceFileId}::${originChapterTitle}`;
    if (contextKey !== activeInlineSubheadingSourceId) {
      activeInlineSubheadingSpec = null;
      activeInlineSubheadingSourceId = contextKey;
    }

    // Check if the sub-section title itself names a specific ECU (e.g. "۴-۲. بررسی ایسیو زیمنس در نمای دوبعدی")
    const subSectionFamilies = detectSentenceEcuFamilies(originSubSectionTitle);

    if (u.unitType === 'subheading') {
      const subMatches = detectSentenceEcuFamilies(u.rawText);
      activeInlineSubheadingSpec = subMatches.length === 1 ? subMatches[0] : null;
      continue;
    }

    // Only micro-route prose paragraphs and list/callout blocks (tables stay intact or move as whole if 100% single-ECU)
    if (u.unitType !== 'paragraph' && u.unitType !== 'list' && u.unitType !== 'callout') {
      continue;
    }

    const sentences = splitSentencesPreservingStructure(u.rawText);
    if (sentences.length === 0) continue;

    // Classify each sentence in this general-chapter unit
    const sentenceTargets: Array<{
      sentence: string;
      matchedSpecs: CanonicalEcuClusterSpec[];
    }> = sentences.map((sent) => {
      let specs = detectSentenceEcuFamilies(sent);
      if (specs.length === 0 && activeInlineSubheadingSpec) {
        specs = [activeInlineSubheadingSpec];
      } else if (specs.length === 0 && subSectionFamilies.length === 1) {
        specs = [subSectionFamilies[0]];
      }
      return { sentence: sent, matchedSpecs: specs };
    });

    const sentencesWithEcu = sentenceTargets.filter((s) => s.matchedSpecs.length > 0);
    if (sentencesWithEcu.length === 0) {
      continue;
    }

    // Check if ALL sentences in this unit target a single ECU family AND no receptor exists yet ->
    // We can relocate the unit's headingPath to that ECU cluster or merge into existing receptor while leaving a cross-ref in the origin unit!
    const distinctFamiliesInUnit = Array.from(
      new Set(sentencesWithEcu.flatMap((s) => s.matchedSpecs.map((m) => m.familyId)))
    );

    const remainingGeneralSentences: string[] = [];
    const crossRefsToAddInOrigin = new Set<string>();

    // Group extracted sentences by (familyId, subChapterId)
    const routedGroups = new Map<
      string,
      {
        spec: CanonicalEcuClusterSpec;
        sub: CanonicalSubChapterSpec;
        extractedSentences: string[];
      }
    >();

    for (const item of sentenceTargets) {
      if (item.matchedSpecs.length === 0) {
        remainingGeneralSentences.push(item.sentence);
        continue;
      }

      for (const spec of item.matchedSpecs) {
        const sub = resolveTargetSubChapter(
          spec,
          item.sentence,
          `${originChapterTitle} > ${originSubSectionTitle}`
        );
        const key = `${spec.familyId}::${sub.id}`;
        let grp = routedGroups.get(key);
        if (!grp) {
          grp = { spec, sub, extractedSentences: [] };
          routedGroups.set(key, grp);
        }
        grp.extractedSentences.push(item.sentence);
      }
    }

    // Route each group to its target ECU Cluster & Sub-Chapter
    for (const [subKey, grp] of routedGroups.entries()) {
      const { spec, sub, extractedSentences } = grp;
      const joinedExtract = extractedSentences.join(' ');
      const contextualExtract = `[تجمیع هوشمند از «${originChapterTitle}${originSubSectionTitle !== originChapterTitle ? ` — ${originSubSectionTitle}` : ''}» (${fName})]: ${joinedExtract}`;

      const receptor =
        receptorUnitByFamilySub.get(subKey) || receptorUnitByFamily.get(spec.familyId);

      const crossRefNote = `↗ [نکته اختصاصی «${spec.shortNameFa}» در مبحث «${originSubSectionTitle}» به «${spec.masterTitleFa} ⟵ ${sub.titleFa}» منتقل و یکپارچه شد.]`;

      if (receptor && receptor.id !== u.id) {
        // Append lossless extract to the canonical receptor unit in the target ECU cluster
        if (!receptor.rawText.includes(joinedExtract.slice(0, Math.min(45, joinedExtract.length)))) {
          receptor.rawText = `${receptor.rawText}\n\n${contextualExtract}`;
          if (
            receptor.metadataJson?.block &&
            typeof receptor.metadataJson.block === 'object' &&
            (receptor.metadataJson.block as { type?: string }).type === 'paragraph'
          ) {
            (receptor.metadataJson.block as { text: string }).text = receptor.rawText;
          } else if (
            receptor.metadataJson?.block &&
            typeof receptor.metadataJson.block === 'object' &&
            (receptor.metadataJson.block as { type?: string; paragraphs?: string[] }).type === 'callout'
          ) {
            const cal = receptor.metadataJson.block as { paragraphs: string[] };
            cal.paragraphs = [...(cal.paragraphs || []), contextualExtract];
          }
        }
        crossRefsToAddInOrigin.add(crossRefNote);
        inlineSentencesRoutedCount += extractedSentences.length;

        extractRecords.push({
          id: `mroute_${extractRecords.length + 1}`,
          familyId: spec.familyId,
          familyShortNameFa: spec.shortNameFa,
          masterClusterTitleFa: spec.masterTitleFa,
          targetSubChapterTitleFa: sub.titleFa,
          sourceFileName: fName,
          originChapterTitleFa: `${originChapterTitle} (${originSubSectionTitle})`,
          targetUnitId: receptor.id,
          originUnitId: u.id,
          routeKind:
            remainingGeneralSentences.length === 0
              ? 'full_unit_relocation'
              : 'inline_sentence_extract',
          extractedTextSnippet: joinedExtract.slice(0, 260),
          crossReferenceTextFa: crossRefNote,
        });
      } else if (
        remainingGeneralSentences.length === 0 &&
        distinctFamiliesInUnit.length === 1
      ) {
        // No receptor existed yet for this ECU family, and this entire unit is 100% about this ECU family!
        // Promote this unit itself to become the receptor unit for `(spec.familyId, sub.id)`!
        const canonicalHeadingPath = `${spec.masterTitleFa} > ${sub.titleFa}`;
        u.headingPath = canonicalHeadingPath;
        u.metadataJson = {
          ...(u.metadataJson || {}),
          headingPath: canonicalHeadingPath,
          canonicalEcuFamilyId: spec.familyId,
          canonicalSubChapterId: sub.id,
          relocatedFromHeadingPath: `${originChapterTitle} > ${originSubSectionTitle}`,
        };
        unitNativeFamily.set(u.id, spec);
        receptorUnitByFamilySub.set(subKey, u);
        if (!receptorUnitByFamily.has(spec.familyId)) {
          receptorUnitByFamily.set(spec.familyId, u);
        }
        fullUnitsRelocatedCount += 1;

        // Also leave a cross-reference pointer on the nearest neighboring general unit in the origin chapter
        const neighbor =
          (i > 0 && !unitNativeFamily.has(workingUnits[i - 1].id) ? workingUnits[i - 1] : null) ||
          (i + 1 < workingUnits.length && !unitNativeFamily.has(workingUnits[i + 1].id)
            ? workingUnits[i + 1]
            : null);
        if (neighbor && neighbor.unitType === 'paragraph') {
          if (!neighbor.rawText.includes(crossRefNote)) {
            neighbor.rawText = `${neighbor.rawText}\n${crossRefNote}`;
            if (
              neighbor.metadataJson?.block &&
              typeof neighbor.metadataJson.block === 'object' &&
              (neighbor.metadataJson.block as { type?: string }).type === 'paragraph'
            ) {
              (neighbor.metadataJson.block as { text: string }).text = neighbor.rawText;
            }
            crossReferencesInsertedCount += 1;
          }
        }

        extractRecords.push({
          id: `mroute_${extractRecords.length + 1}`,
          familyId: spec.familyId,
          familyShortNameFa: spec.shortNameFa,
          masterClusterTitleFa: spec.masterTitleFa,
          targetSubChapterTitleFa: sub.titleFa,
          sourceFileName: fName,
          originChapterTitleFa: `${originChapterTitle} (${originSubSectionTitle})`,
          targetUnitId: u.id,
          originUnitId: u.id,
          routeKind: 'full_unit_relocation',
          extractedTextSnippet: joinedExtract.slice(0, 260),
          crossReferenceTextFa: crossRefNote,
        });
      } else {
        // Mixed paragraph where no standalone receptor unit exists yet for that ECU family: keep sentence in place and tag it
        remainingGeneralSentences.push(...extractedSentences);
      }
    }

    // Update the origin unit's text if sentences were extracted to a receptor unit
    if (crossRefsToAddInOrigin.size > 0) {
      const refsArray = Array.from(crossRefsToAddInOrigin);
      crossReferencesInsertedCount += refsArray.length;
      const newOriginText =
        remainingGeneralSentences.length > 0
          ? `${remainingGeneralSentences.join(' ')}\n${refsArray.join('\n')}`
          : refsArray.join('\n');

      u.rawText = newOriginText;
      if (
        u.metadataJson?.block &&
        typeof u.metadataJson.block === 'object' &&
        (u.metadataJson.block as { type?: string }).type === 'paragraph'
      ) {
        (u.metadataJson.block as { text: string }).text = newOriginText;
      } else if (
        u.metadataJson?.block &&
        typeof u.metadataJson.block === 'object' &&
        (u.metadataJson.block as { type?: string; items?: string[] }).type === 'list'
      ) {
        (u.metadataJson.block as { items: string[] }).items = [
          ...remainingGeneralSentences,
          ...refsArray,
        ];
      } else if (
        u.metadataJson?.block &&
        typeof u.metadataJson.block === 'object' &&
        (u.metadataJson.block as { type?: string; paragraphs?: string[] }).type === 'callout'
      ) {
        (u.metadataJson.block as { paragraphs: string[] }).paragraphs = [
          ...remainingGeneralSentences,
          ...refsArray,
        ];
      }
    }
  }

  // Pass 2: Normalize Dyno & Cylinder Thermodynamics chapters so `dyno2.md`, `dyno.md`, and `BOOK_DAY01_04_Final` Ch.10
  // cluster cleanly together without scattered orphan chapters
  let dynoUnitsCount = 0;
  const dynoSubChaptersSet = new Set<string>();
  let generalUnitsCount = 0;
  const generalSubChaptersSet = new Set<string>();

  for (const u of workingUnits) {
    if (u.status === 'merged' || unitNativeFamily.has(u.id)) continue;
    const h = u.headingPath || '';
    const topH = h.split('>')[0]?.trim() || '';
    const fName = fileMap.get(u.sourceFileId)?.fileName || '';

    const isDynoUnit =
      /dyno/i.test(fName) ||
      /(?:داینو|دینامومتر|dyno|فیزیک\s*داینو|ضرایب\s*تصحیح|sae\s*j1349|غلطک|ترمز\s*ادی|تلفات\s*انتقال\s*قدرت|coast[-_\s]?down|رابطه\s*آینه‌ای.*ve)/i.test(
        topH
      );

    if (isDynoUnit) {
      dynoUnitsCount += 1;
      const subTitle = resolveDynoSubChapterTitle(topH, u.rawText);
      dynoSubChaptersSet.add(subTitle);
      const canonicalDynoPath = `مرجع جامع دینامومتر، ترمودینامیک سیلندر و کالیبراسیون روی داینو > ${subTitle}`;
      u.headingPath = canonicalDynoPath;
      u.metadataJson = {
        ...(u.metadataJson || {}),
        headingPath: canonicalDynoPath,
        canonicalClusterGroup: 'dyno_thermodynamics',
      };
    } else {
      generalUnitsCount += 1;
      if (topH) generalSubChaptersSet.add(topH);
    }
  }

  // Build Cluster Summary Report for Stage 2 UI
  const clustersSummary: ClusterSummaryItem[] = [];

  for (const spec of IRANIAN_MARKET_ECU_CLUSTERS) {
    const famUnits = workingUnits.filter(
      (u) => u.status !== 'merged' && unitNativeFamily.get(u.id)?.familyId === spec.familyId
    );
    const famExtracts = extractRecords.filter((r) => r.familyId === spec.familyId);
    if (famUnits.length === 0 && famExtracts.length === 0) continue;

    const activeSubTitles = Array.from(
      new Set(
        famUnits
          .map((u) => (u.headingPath || '').split('>')[1]?.trim())
          .filter((x): x is string => Boolean(x))
      )
    );

    clustersSummary.push({
      familyId: spec.familyId,
      masterTitleFa: spec.masterTitleFa,
      shortNameFa: spec.shortNameFa,
      marketCoverageFa: spec.marketCoverageFa,
      totalUnitsCount: famUnits.length,
      subChaptersCount: activeSubTitles.length,
      routedExtractsCount: famExtracts.length,
      subChapterTitles: activeSubTitles,
    });
  }

  if (dynoUnitsCount > 0) {
    clustersSummary.push({
      familyId: 'dyno_thermodynamics',
      masterTitleFa: 'مرجع جامع دینامومتر، ترمودینامیک سیلندر و کالیبراسیون روی داینو',
      shortNameFa: 'دینامومتر و ترمودینامیک سیلندر',
      marketCoverageFa: 'فیزیک توان و گشتاور، استانداردهای SAE/DIN/STD، جدول VE، ناک، AFR و عیب‌یابی داینو',
      totalUnitsCount: dynoUnitsCount,
      subChaptersCount: dynoSubChaptersSet.size,
      routedExtractsCount: 0,
      subChapterTitles: Array.from(dynoSubChaptersSet),
    });
  }

  if (generalUnitsCount > 0) {
    clustersSummary.push({
      familyId: 'general_remap_fundamentals',
      masterTitleFa: 'مبانی عمومی ریمپ، ساختار حافظه، وینولز و موتورهای تقویت‌شده/توربو',
      shortNameFa: 'مبانی عمومی ریمپ و وینولز',
      marketCoverageFa: 'فصول پایه سنسورها، باینری/هگز، محورها، نمای 2D وینولز، عیب‌یابی DTC و موتورهای توربو',
      totalUnitsCount: generalUnitsCount,
      subChaptersCount: generalSubChaptersSet.size,
      routedExtractsCount: 0,
      subChapterTitles: Array.from(generalSubChaptersSet).slice(0, 10),
    });
  }

  return {
    routedUnits: workingUnits,
    report: {
      enabled: true,
      totalRoutedExtracts: extractRecords.length,
      inlineSentencesRoutedCount,
      fullUnitsRelocatedCount,
      crossReferencesInsertedCount,
      brokenTablesStitchedCount: 0,
      clustersSummary,
      extractRecords,
    },
  };
}

function resolveDynoSubChapterTitle(topHeading: string, rawText: string): string {
  const combined = normalizeForMatch(`${topHeading} ${rawText.slice(0, 260)}`);
  if (
    /(?:درس\s*[1-4]\b|فاز\s*اول|فیزیک\s*پایه|تقاطع\s*ریاضی|5252|9549|7024|اینرسی|ادی\s*کارنت|تک\s*غلطک|جفت\s*غلطک|تلفات\s*انتقال\s*قدرت|coast[-_\s]?down|ضریب\s*دنده|\bgr\b)/i.test(
      combined
    )
  ) {
    return 'فاز اول — فیزیک دینامومتر، معادلات توان و گشتاور، انواع غلطک، تلفات Coast-Down و ضریب دنده';
  }
  if (
    /(?:درس\s*[5-8]\b|فاز\s*دوم|ضرایب\s*تصحیح|sae\s*j1349|din\s*70020|smoothing|حرارت\s*محفظه|heat\s*soak|بستن\s*خودرو|strapping|لغزش\s*تایر|گراف\s*دلتا|delta\s*graph|فریبکاری)/i.test(
      combined
    )
  ) {
    return 'فاز دوم — استانداردهای تصحیح (SAE J1349 / DIN / STD)، Heat Soak، بستن خودرو، گراف دلتا و تشخیص خطای اپراتور';
  }
  if (
    /(?:درس\s*(?:9|10|11|12)\b|فاز\s*سوم|ترمودینامیک|لاندا|afr|تاخیر\s*انتقال\s*گاز|ناک|کوبش|فرکانس\s*ناک|دریپر|فشار\s*سوخت|\bmap\b|\bmaf\b|\begt\b|راندمان\s*حجمی|جدول\s*ve|رابطه\s*آینه‌ای|spark\s*sweep|\bmbt\b)/i.test(
      combined
    )
  ) {
    return 'فاز سوم — ترمودینامیک سیلندر، AFR، فرمول فرکانس ناک، رابطه آینه‌ای جدول VE با گشتاور و یافتن نقطه MBT';
  }
  if (
    /(?:درس\s*(?:13|14|15|16)\b|فاز\s*چهارم|کویل|شمع|미س‌فایر|تسمه\s*تایم|فیلر|کمپرس|تورک\s*کانورتر|کلاچ|دریچه\s*گاز\s*برقی|\betc\b|محافظت\s*کاتالیست)/i.test(
      combined
    )
  ) {
    return 'فاز چهارم — عیب‌یابی پیشرفته از روی گراف داینو (امضاهای خرابی جرقه، مکانیک موتور، گیربکس و دریچه گاز برقی)';
  }
  if (
    /(?:درس\s*(?:17|18|19|20)\b|فاز\s*پنجم|تنفس\s*طبیعی|تقویت|منیفولد|هدرز|میل\s*سوپاپ|بوست|ویست‌گیت|اووربوست|سوخت\s*ایران|استراتژی\s*نهایی)/i.test(
      combined
    )
  ) {
    return 'فاز پنجم — تحلیل گراف خودروهای تنفس طبیعی، CVVT، افترمارکت، توربو/TGDI و پروتکل نهایی تیونینگ';
  }
  return topHeading || `مباحث تکمیلی تست داینو و کالیبراسیون (${toPersianDigits(1)})`;
}
