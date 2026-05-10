import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type ToolApprovalModalProps = {
  toolName: string
  threadId: string
  toolParameters?: object
  alwaysConfirm?: boolean
  riskSummary?: string
  affectedPaths?: string[]
  commandPreview?: string
  onApprove: (allowOnce: boolean) => void
  onDeny: () => void
}

export type ToolApprovalOptions = {
  alwaysConfirm?: boolean
  riskSummary?: string
  affectedPaths?: string[]
  commandPreview?: string
}

type ToolApprovalState = {
  // Track approved tools per thread
  approvedTools: Record<string, string[]> // threadId -> toolNames[]
  // Global MCP permission toggle
  allowAllMCPPermissions: boolean
  // Modal state
  isModalOpen: boolean
  modalProps: ToolApprovalModalProps | null

  // Actions
  approveToolForThread: (threadId: string, toolName: string) => void
  isToolApproved: (threadId: string, toolName: string) => boolean
  showApprovalModal: (
    toolName: string,
    threadId: string,
    toolParameters?: object,
    options?: ToolApprovalOptions
  ) => Promise<boolean>
  closeModal: () => void
  setModalOpen: (open: boolean) => void
  setAllowAllMCPPermissions: (allow: boolean) => void
}

export const useToolApproval = create<ToolApprovalState>()(
  persist(
    (set, get) => ({
      approvedTools: {},
      allowAllMCPPermissions: false,
      isModalOpen: false,
      modalProps: null,

      approveToolForThread: (threadId: string, toolName: string) => {
        set((state) => ({
          approvedTools: {
            ...state.approvedTools,
            [threadId]: [
              ...(state.approvedTools[threadId] || []),
              toolName,
            ].filter((tool, index, arr) => arr.indexOf(tool) === index), // Remove duplicates
          },
        }))
      },

      isToolApproved: (threadId: string, toolName: string) => {
        const state = get()
        return state.approvedTools[threadId]?.includes(toolName) || false
      },

      showApprovalModal: (
        toolName: string,
        threadId: string,
        toolParameters?: object,
        options?: ToolApprovalOptions
      ) => {
        return new Promise<boolean>((resolve) => {
          const state = get()
          const alwaysConfirm = options?.alwaysConfirm === true

          // Auto-approve if the user has enabled auto-approval setting
          if (!alwaysConfirm && state.allowAllMCPPermissions) {
            resolve(true)
            return
          }

          // Check if tool is already approved for this thread
          if (!alwaysConfirm && state.isToolApproved(threadId, toolName)) {
            resolve(true)
            return
          }

          set({
            isModalOpen: true,
            modalProps: {
              toolName,
              threadId,
              toolParameters,
              alwaysConfirm,
              riskSummary: options?.riskSummary,
              affectedPaths: options?.affectedPaths,
              commandPreview: options?.commandPreview,
              onApprove: (allowOnce: boolean) => {
                if (!allowOnce && !alwaysConfirm) {
                  // If not "allow once", add to approved tools for this thread
                  get().approveToolForThread(threadId, toolName)
                }
                get().closeModal()
                resolve(true)
              },
              onDeny: () => {
                get().closeModal()
                resolve(false)
              },
            },
          })
        })
      },

      closeModal: () => {
        set({
          isModalOpen: false,
          modalProps: null,
        })
      },

      setModalOpen: (open: boolean) => {
        set({ isModalOpen: open })
        if (!open) {
          get().closeModal()
        }
      },

      setAllowAllMCPPermissions: (allow: boolean) => {
        set({ allowAllMCPPermissions: allow })
      },
    }),
    {
      name: localStorageKey.toolApproval,
      storage: createJSONStorage(() => localStorage),
      // Only persist approved tools and global permission setting, not modal state
      partialize: (state) => ({
        approvedTools: state.approvedTools,
        allowAllMCPPermissions: state.allowAllMCPPermissions,
      }),
    }
  )
)
