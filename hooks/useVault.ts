"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  deriveMasterKey,
  exportKey,
  importKey,
  generateSalt,
  uint8ArrayToBase64,
  base64ToUint8Array,
  arrayBufferToBase64,
} from "@/lib/crypto";
import {
  saveMasterKeyToSession,
  getMasterKeyFromSession,
  clearMasterKeyFromSession,
  isVaultUnlocked,
  saveSaltToSession,
  getSaltFromSession,
} from "@/lib/session-storage";

interface VaultState {
  isUnlocked: boolean;
  isInitialized: boolean | null;
  masterKey: CryptoKey | null;
  salt: string | null;
  isLoading: boolean;
  error: string | null;
  hasHydrated: boolean; // Track if store has hydrated from storage

  // Actions
  checkInitialization: () => Promise<void>;
  initializeVault: (password: string) => Promise<void>;
  unlockVault: (password: string, salt: string) => Promise<void>;
  lockVault: () => void;
  restoreFromSession: () => Promise<void>;
  clearError: () => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useVault = create<VaultState>()(
  persist(
    (set, get) => ({
      isUnlocked: false,
      isInitialized: null,
      masterKey: null,
      salt: null,
      isLoading: false,
      error: null,
      hasHydrated: false,

      setHasHydrated: (hydrated: boolean) => set({ hasHydrated: hydrated }),

      checkInitialization: async () => {
        try {
          const response = await fetch("/api/vault/init");
          const data = await response.json();
          set({ isInitialized: data.initialized });
          if (data.initialized) {
            saveSaltToSession(data.salt);
            set({ salt: data.salt });
          }
        } catch (error) {
          console.error("Failed to check vault initialization:", error);
          set({ isInitialized: false });
        }
      },

      initializeVault: async (password: string) => {
        set({ isLoading: true, error: null });
        try {
          // Generate salt
          const saltArray = generateSalt();
          const salt = uint8ArrayToBase64(saltArray);

          // Initialize vault on server
          const response = await fetch("/api/vault/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ salt }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Failed to initialize vault");
          }

          // Derive master key
          const masterKey = await deriveMasterKey(password, saltArray);

          // Save to session
          const keyBuffer = await exportKey(masterKey);
          const keyBase64 = arrayBufferToBase64(keyBuffer);
          saveMasterKeyToSession(keyBase64);
          saveSaltToSession(salt);

          set({
            isUnlocked: true,
            isInitialized: true,
            masterKey,
            salt,
            isLoading: false,
          });
        } catch (error) {
          console.error("Failed to initialize vault:", error);
          set({
            error: error instanceof Error ? error.message : "Unknown error",
            isLoading: false,
          });
        }
      },

      unlockVault: async (password: string, salt: string) => {
        console.log("[Vault] Starting unlock process...");
        set({ isLoading: true, error: null });
        try {
          if (!salt) {
            console.error("[Vault] Cannot unlock: salt is missing");
            throw new Error("Vault salt is missing. Please refresh the page.");
          }
          if (!password || password.length < 8) {
            console.error("[Vault] Cannot unlock: password too short");
            throw new Error("Password must be at least 8 characters.");
          }

          console.log("[Vault] Converting salt...");
          // Convert salt from base64 to Uint8Array
          const saltArray = base64ToUint8Array(salt);

          console.log("[Vault] Deriving master key...");
          // Derive master key from password
          const masterKey = await deriveMasterKey(password, saltArray);

          console.log("[Vault] Exporting key...");
          // Save to session
          const keyBuffer = await exportKey(masterKey);
          const keyBase64 = arrayBufferToBase64(keyBuffer);
          
          console.log("[Vault] Saving to session storage...");
          saveMasterKeyToSession(keyBase64);
          saveSaltToSession(salt);

          console.log("[Vault] Unlock successful!");
          set({
            isUnlocked: true,
            masterKey,
            salt,
            isLoading: false,
          });
        } catch (error) {
          console.error("[Vault] Failed to unlock vault:", error);
          set({
            error: error instanceof Error ? error.message : "Invalid password",
            isLoading: false,
          });
        }
      },

      lockVault: () => {
        clearMasterKeyFromSession();
        set({
          isUnlocked: false,
          masterKey: null,
        });
      },

      restoreFromSession: async () => {
        const keyBase64 = getMasterKeyFromSession();
        const salt = getSaltFromSession();
        const unlocked = isVaultUnlocked();

        if (keyBase64 && unlocked) {
          try {
            const keyBuffer = base64ToUint8Array(keyBase64);
            const masterKey = await importKey(keyBuffer, ["encrypt", "decrypt"]);
            set({
              isUnlocked: true,
              masterKey,
              salt,
            });
          } catch (error) {
            console.error("Failed to restore session:", error);
            clearMasterKeyFromSession();
          }
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: "vault-storage",
      partialize: (state) => ({
        isInitialized: state.isInitialized,
        salt: state.salt,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
        }
      },
    }
  )
);
