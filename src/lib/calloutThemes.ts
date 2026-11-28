import type { CalloutVariant } from './bookTypes.ts';

export interface CalloutThemeSpec {
  variant: CalloutVariant;
  labelFa: string;
  subtitleFa: string;
  /** Tailwind classes for BookPreview on-screen editorial frame */
  outerBorderClass: string;
  bodyBgClass: string;
  headerBgClass: string;
  headerBorderClass: string;
  iconBgClass: string;
  accentTextClass: string;
  kickerTextClass: string;
  /** Exact hex colors (without #) for Word (.docx) matching framed callouts */
  docxBorderHex: string;
  docxHeaderBgHex: string;
  docxBodyBgHex: string;
  docxAccentHex: string;
  docxDividerHex: string;
}

/**
 * Distinct, curated editorial color themes for each callout box type.
 * Shared across both BookPreview (HTML/Tailwind) and docxGenerator (Microsoft Word)
 * so every frame looks crisp, distinct, and publication-grade.
 */
export const CALLOUT_THEMES: Record<CalloutVariant, CalloutThemeSpec> = {
  warning: {
    variant: 'warning',
    labelFa: 'هشدار و قانون طلایی',
    subtitleFa: 'الزام ایمنی و نکته بحرانی',
    outerBorderClass: 'border-[#DFAFA4]',
    bodyBgClass: 'bg-[#FFF9F7]',
    headerBgClass: 'bg-[#FCEAE5]',
    headerBorderClass: 'border-[#ECC6BC]',
    iconBgClass: 'bg-[#F8D8CF] text-[#9A2C14]',
    accentTextClass: 'text-[#8F240E]',
    kickerTextClass: 'text-[#A83820]',
    docxBorderHex: 'DFAFA4',
    docxHeaderBgHex: 'FCEAE5',
    docxBodyBgHex: 'FFF9F7',
    docxAccentHex: '8F240E',
    docxDividerHex: 'ECC6BC',
  },
  engineering: {
    variant: 'engineering',
    labelFa: 'نکته مهندسی و کارگاهی',
    subtitleFa: 'تجربه عملی و استاندارد فنی',
    outerBorderClass: 'border-[#DFC690]',
    bodyBgClass: 'bg-[#FFFDF6]',
    headerBgClass: 'bg-[#FAF0D4]',
    headerBorderClass: 'border-[#EBD5A3]',
    iconBgClass: 'bg-[#F3E1B2] text-[#7C4706]',
    accentTextClass: 'text-[#744005]',
    kickerTextClass: 'text-[#92580E]',
    docxBorderHex: 'DFC690',
    docxHeaderBgHex: 'FAF0D4',
    docxBodyBgHex: 'FFFDF6',
    docxAccentHex: '744005',
    docxDividerHex: 'EBD5A3',
  },
  concept: {
    variant: 'concept',
    labelFa: 'مبانی علمی و پیش‌نیاز',
    subtitleFa: 'توضیح مفهومی و پایه علمی',
    outerBorderClass: 'border-[#B5CAE4]',
    bodyBgClass: 'bg-[#F8FBFF]',
    headerBgClass: 'bg-[#E7F0FA]',
    headerBorderClass: 'border-[#CBDCF0]',
    iconBgClass: 'bg-[#D3E3F5] text-[#1B3B66]',
    accentTextClass: 'text-[#18355C]',
    kickerTextClass: 'text-[#2B5284]',
    docxBorderHex: 'B5CAE4',
    docxHeaderBgHex: 'E7F0FA',
    docxBodyBgHex: 'F8FBFF',
    docxAccentHex: '18355C',
    docxDividerHex: 'CBDCF0',
  },
  qa: {
    variant: 'qa',
    labelFa: 'پرسش و پاسخ کارگاهی',
    subtitleFa: 'پاسخ کاربردی به سوالات متداول',
    outerBorderClass: 'border-[#AED2BE]',
    bodyBgClass: 'bg-[#F6FCF8]',
    headerBgClass: 'bg-[#E4F4EB]',
    headerBorderClass: 'border-[#C6E3D2]',
    iconBgClass: 'bg-[#CCE8D8] text-[#124E32]',
    accentTextClass: 'text-[#10472D]',
    kickerTextClass: 'text-[#1F6A47]',
    docxBorderHex: 'AED2BE',
    docxHeaderBgHex: 'E4F4EB',
    docxBodyBgHex: 'F6FCF8',
    docxAccentHex: '10472D',
    docxDividerHex: 'C6E3D2',
  },
  revision: {
    variant: 'revision',
    labelFa: 'اصلاحیه و تدقیق علمی',
    subtitleFa: 'به‌روزرسانی و رفع ابهام فنی',
    outerBorderClass: 'border-[#C8B7E4]',
    bodyBgClass: 'bg-[#FAF7FE]',
    headerBgClass: 'bg-[#F0E8FA]',
    headerBorderClass: 'border-[#DCD0F0]',
    iconBgClass: 'bg-[#E1D4F5] text-[#521E9E]',
    accentTextClass: 'text-[#4C1A94]',
    kickerTextClass: 'text-[#6B33B8]',
    docxBorderHex: 'C8B7E4',
    docxHeaderBgHex: 'F0E8FA',
    docxBodyBgHex: 'FAF7FE',
    docxAccentHex: '4C1A94',
    docxDividerHex: 'DCD0F0',
  },
  project: {
    variant: 'project',
    labelFa: 'نقشه راه و جمع‌بندی',
    subtitleFa: 'چک‌لیست اجرا و گام‌های عملی',
    outerBorderClass: 'border-[#A3CFD4]',
    bodyBgClass: 'bg-[#F5FCFC]',
    headerBgClass: 'bg-[#E2F3F5]',
    headerBorderClass: 'border-[#C1E2E6]',
    iconBgClass: 'bg-[#C9E7EB] text-[#0E525B]',
    accentTextClass: 'text-[#0C4952]',
    kickerTextClass: 'text-[#1B6A75]',
    docxBorderHex: 'A3CFD4',
    docxHeaderBgHex: 'E2F3F5',
    docxBodyBgHex: 'F5FCFC',
    docxAccentHex: '0C4952',
    docxDividerHex: 'C1E2E6',
  },
  general: {
    variant: 'general',
    labelFa: 'یادداشت و نکته تکمیلی',
    subtitleFa: 'توضیح تکمیلی و نکته کلیدی',
    outerBorderClass: 'border-[#CFC7B8]',
    bodyBgClass: 'bg-[#FCFBF8]',
    headerBgClass: 'bg-[#F2EFE8]',
    headerBorderClass: 'border-[#DFD8CA]',
    iconBgClass: 'bg-[#E5DFD2] text-[#3F3A34]',
    accentTextClass: 'text-[#332E29]',
    kickerTextClass: 'text-[#615A52]',
    docxBorderHex: 'CFC7B8',
    docxHeaderBgHex: 'F2EFE8',
    docxBodyBgHex: 'FCFBF8',
    docxAccentHex: '332E29',
    docxDividerHex: 'DFD8CA',
  },
};

export interface SpecialFrameThemeSpec {
  id: 'web_enrichment' | 'conflict_note' | 'equation' | 'figure' | 'chapter_meta' | 'suggestions';
  labelFa: string;
  outerBorderClass: string;
  bodyBgClass: string;
  headerBgClass: string;
  headerBorderClass: string;
  iconBgClass: string;
  accentTextClass: string;
  docxBorderHex: string;
  docxHeaderBgHex: string;
  docxBodyBgHex: string;
  docxAccentHex: string;
}

export const SPECIAL_FRAME_THEMES: Record<SpecialFrameThemeSpec['id'], SpecialFrameThemeSpec> = {
  web_enrichment: {
    id: 'web_enrichment',
    labelFa: 'تکمیل‌شده از وب (جستجوی گوگل)',
    outerBorderClass: 'border-[#C2B7E8]',
    bodyBgClass: 'bg-[#F9F7FE]',
    headerBgClass: 'bg-[#ECE7FA]',
    headerBorderClass: 'border-[#D7CEF2]',
    iconBgClass: 'bg-[#DDD4F7] text-[#4338CA]',
    accentTextClass: 'text-[#3730A3]',
    docxBorderHex: 'C2B7E8',
    docxHeaderBgHex: 'ECE7FA',
    docxBodyBgHex: 'F9F7FE',
    docxAccentHex: '3730A3',
  },
  conflict_note: {
    id: 'conflict_note',
    labelFa: 'مقایسه دو روایت منبع (تناقض حفظ‌شده)',
    outerBorderClass: 'border-[#E2B4AA]',
    bodyBgClass: 'bg-[#FFF8F6]',
    headerBgClass: 'bg-[#FCE7E2]',
    headerBorderClass: 'border-[#EEC6BC]',
    iconBgClass: 'bg-[#F8D4CB] text-[#9A3412]',
    accentTextClass: 'text-[#9A3412]',
    docxBorderHex: 'E2B4AA',
    docxHeaderBgHex: 'FCE7E2',
    docxBodyBgHex: 'FFF8F6',
    docxAccentHex: '9A3412',
  },
  equation: {
    id: 'equation',
    labelFa: 'رابطه و فرمول فنی',
    outerBorderClass: 'border-[#C7D0DC]',
    bodyBgClass: 'bg-[#F8FAFC]',
    headerBgClass: 'bg-[#EDF2F7]',
    headerBorderClass: 'border-[#D6DFE9]',
    iconBgClass: 'bg-[#DCE5F0] text-[#1E3A5F]',
    accentTextClass: 'text-[#1E3A5F]',
    docxBorderHex: 'C7D0DC',
    docxHeaderBgHex: 'EDF2F7',
    docxBodyBgHex: 'F8FAFC',
    docxAccentHex: '1E3A5F',
  },
  figure: {
    id: 'figure',
    labelFa: 'پیشنهاد تصویر یا نمودار',
    outerBorderClass: 'border-[#B9CCE0]',
    bodyBgClass: 'bg-[#F7FAFD]',
    headerBgClass: 'bg-[#E9F1F9]',
    headerBorderClass: 'border-[#D0DFEE]',
    iconBgClass: 'bg-[#D6E5F4] text-[#1E3A5F]',
    accentTextClass: 'text-[#1E3A5F]',
    docxBorderHex: 'B9CCE0',
    docxHeaderBgHex: 'E9F1F9',
    docxBodyBgHex: 'F7FAFD',
    docxAccentHex: '1E3A5F',
  },
  chapter_meta: {
    id: 'chapter_meta',
    labelFa: 'شناسنامه فصل',
    outerBorderClass: 'border-[#D7CFC0]',
    bodyBgClass: 'bg-[#FDFBF7]',
    headerBgClass: 'bg-[#F3EFE6]',
    headerBorderClass: 'border-[#E2DACB]',
    iconBgClass: 'bg-[#E7E0D2] text-[#1E3A5F]',
    accentTextClass: 'text-[#1E3A5F]',
    docxBorderHex: 'D7CFC0',
    docxHeaderBgHex: 'F3EFE6',
    docxBodyBgHex: 'FDFBF7',
    docxAccentHex: '1E3A5F',
  },
  suggestions: {
    id: 'suggestions',
    labelFa: 'پیشنهادهای جدول و تصویر آموزشی فصل',
    outerBorderClass: 'border-[#B8CFE0]',
    bodyBgClass: 'bg-[#F6FAFD]',
    headerBgClass: 'bg-[#E6F1F8]',
    headerBorderClass: 'border-[#CADFEA]',
    iconBgClass: 'bg-[#D3E6F3] text-[#154A6B]',
    accentTextClass: 'text-[#154A6B]',
    docxBorderHex: 'B8CFE0',
    docxHeaderBgHex: 'E6F1F8',
    docxBodyBgHex: 'F6FAFD',
    docxAccentHex: '154A6B',
  },
};

export function getCalloutTheme(variant: CalloutVariant): CalloutThemeSpec {
  return CALLOUT_THEMES[variant] || CALLOUT_THEMES.concept;
}
