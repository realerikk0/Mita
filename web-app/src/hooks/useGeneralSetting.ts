import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
type GeneralSettingState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  setSpellCheckChatInput: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

