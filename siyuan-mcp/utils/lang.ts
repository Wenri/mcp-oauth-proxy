/**
 * Internationalization utility
 * Matches upstream pattern - loads from i18n JSON files
 */

import en_US from '../i18n/en_US.json';
import zh_CN from '../i18n/zh_CN.json';

const languages: Record<string, Record<string, string>> = {
  en_US,
  zh_CN,
};

let language: Record<string, string> | null = en_US; // Default to English
let emptyLanguageKey: string[] = [];

export function setLanguage(langCode: string) {
  if (languages[langCode]) {
    language = languages[langCode];
  } else {
    console.warn(`Language ${langCode} not found, using en_US`);
    language = languages.en_US;
  }
}

export function lang(key: string): string {
  if (language != null && language[key] != null) {
    return language[key];
  } else {
    if (!emptyLanguageKey.includes(key)) {
      emptyLanguageKey.push(key);
      console.error('Language key not defined:', key);
    }
  }
  return key;
}

/**
 * Get setting language strings
 * @param key key
 * @returns [settingName, settingDesc, settingBtnName]
 */
export function settingLang(key: string): [string, string, string] {
  const settingName = lang(`setting_${key}_name`);
  const settingDesc = lang(`setting_${key}_desp`);
  const settingBtnName = lang(`setting_${key}_btn`);
  if (settingName === 'Undefined' || settingDesc === 'Undefined') {
    throw new Error(`Setting text ${key} not defined`);
  }
  return [settingName, settingDesc, settingBtnName];
}

export function settingPageLang(key: string): [string] {
  const pageSettingName = lang(`settingpage_${key}_name`);
  return [pageSettingName];
}
