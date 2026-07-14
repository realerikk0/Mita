export const DEFAULT_APP_NAME = 'Biyan'
export const SIMPLIFIED_CHINESE_APP_NAME = '彼岩'

export const getLocalizedAppName = (language: string) =>
  language === 'zh-CN' ? SIMPLIFIED_CHINESE_APP_NAME : DEFAULT_APP_NAME
