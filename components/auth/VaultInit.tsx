"use client";

import { useState, useEffect } from "react";
import { useVault } from "@/hooks/useVault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Eye, EyeOff, KeyRound, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { isCryptoAvailable, getCryptoErrorMessage } from "@/lib/crypto";

export function VaultInit() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptedWarning, setAcceptedWarning] = useState(false);
  const [cryptoAvailable, setCryptoAvailable] = useState<boolean | null>(null);
  const { initializeVault, isLoading, error, clearError } = useVault();

  // Check crypto availability on mount
  useEffect(() => {
    setCryptoAvailable(isCryptoAvailable());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (password === confirmPassword && password.length >= 8 && acceptedWarning) {
      await initializeVault(password);
    }
  };

  const getPasswordStrength = (pwd: string) => {
    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[A-Z]/.test(pwd)) strength++;
    if (/[0-9]/.test(pwd)) strength++;
    if (/[^A-Za-z0-9]/.test(pwd)) strength++;
    return strength;
  };

  const strength = getPasswordStrength(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Initialize Vault</CardTitle>
          <CardDescription>
            Create a master password to secure your family videos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Security Context Warning - Show when crypto is not available */}
            {cryptoAvailable === false && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 p-4">
                <div className="flex items-start gap-3">
                  <Lock className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-red-400 mb-1">Secure Connection Required</p>
                    <p className="text-muted-foreground">
                      {getCryptoErrorMessage()}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Warning box */}
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-1">Important Security Notice</p>
                  <p className="text-muted-foreground">
                    Your master password is used to encrypt all videos. <strong>There is no password recovery.</strong> If you forget your password, your data will be permanently lost.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedWarning}
                  onChange={(e) => setAcceptedWarning(e.target.checked)}
                  className="rounded border-amber-500/30 bg-transparent"
                />
                <span className="text-sm text-amber-200">I understand and accept</span>
              </label>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Master Password</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="space-y-1">
                  <div className="flex h-1 gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-full flex-1 rounded-full transition-colors ${
                          i < strength
                            ? strength >= 4
                              ? "bg-green-500"
                              : strength >= 3
                              ? "bg-yellow-500"
                              : "bg-red-500"
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${
                    strength >= 4 ? "text-green-500" : strength >= 3 ? "text-yellow-500" : "text-red-500"
                  }`}>
                    {strength >= 5 ? "Excellent" : strength >= 4 ? "Strong" : strength >= 3 ? "Good" : strength >= 2 ? "Fair" : "Weak"}
                    {strength < 3 && " - Use 8+ chars with mixed case, numbers, and symbols"}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Confirm Password</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type={showConfirm ? "text" : "password"}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword.length > 0 && (
                <div className={`text-xs flex items-center gap-1 ${passwordsMatch ? "text-green-500" : "text-red-500"}`}>
                  {passwordsMatch ? (
                    <><CheckCircle2 className="h-3 w-3" /> Passwords match</>
                  ) : (
                    "Passwords do not match"
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !acceptedWarning || !passwordsMatch || password.length < 8 || cryptoAvailable === false}
            >
              {isLoading ? "Initializing..." : cryptoAvailable === false ? "Secure Connection Required" : "Create Vault"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
