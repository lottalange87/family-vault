"use client";

import { useEffect } from "react";
import { useVault } from "@/hooks/useVault";
import { VaultLogin } from "@/components/auth/VaultLogin";
import { VaultInit } from "@/components/auth/VaultInit";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { isUnlocked, isInitialized, isLoading, checkInitialization, restoreFromSession } = useVault();
  const router = useRouter();

  useEffect(() => {
    // Check if vault is initialized on mount
    checkInitialization();
    // Try to restore session
    restoreFromSession();
  }, [checkInitialization, restoreFromSession]);

  useEffect(() => {
    // Redirect to gallery if unlocked
    if (isUnlocked) {
      router.push("/gallery");
    }
  }, [isUnlocked, router]);

  // Show loading state
  if (isLoading || isInitialized === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show init screen if vault not initialized
  if (isInitialized === false) {
    return <VaultInit />;
  }

  // Show login screen if vault is initialized but not unlocked
  return <VaultLogin />;
}
