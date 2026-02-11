// Session storage helpers for vault state
// Master key is ONLY stored in sessionStorage (never localStorage)

const MASTER_KEY_KEY = "vault:masterKey";
const SALT_KEY = "vault:salt";
const UNLOCKED_KEY = "vault:isUnlocked";

// Check if we're in a browser environment
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// Save master key to session storage (base64 encoded)
export function saveMasterKeyToSession(keyBase64: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(MASTER_KEY_KEY, keyBase64);
    sessionStorage.setItem(UNLOCKED_KEY, "true");
  } catch (error) {
    console.error("Failed to save master key:", error);
  }
}

// Get master key from session storage
export function getMasterKeyFromSession(): string | null {
  if (!isBrowser()) return null;
  try {
    return sessionStorage.getItem(MASTER_KEY_KEY);
  } catch (error) {
    console.error("Failed to get master key:", error);
    return null;
  }
}

// Clear master key from session storage (lock vault)
export function clearMasterKeyFromSession(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(MASTER_KEY_KEY);
    sessionStorage.removeItem(UNLOCKED_KEY);
    sessionStorage.removeItem(SALT_KEY);
  } catch (error) {
    console.error("Failed to clear master key:", error);
  }
}

// Check if vault is unlocked
export function isVaultUnlocked(): boolean {
  if (!isBrowser()) return false;
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) === "true";
  } catch (error) {
    return false;
  }
}

// Save salt to session storage
export function saveSaltToSession(salt: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(SALT_KEY, salt);
  } catch (error) {
    console.error("Failed to save salt:", error);
  }
}

// Get salt from session storage
export function getSaltFromSession(): string | null {
  if (!isBrowser()) return null;
  try {
    return sessionStorage.getItem(SALT_KEY);
  } catch (error) {
    console.error("Failed to get salt:", error);
    return null;
  }
}

// Clear all vault data from session
export function clearVaultSession(): void {
  if (!isBrowser()) return;
  clearMasterKeyFromSession();
}
