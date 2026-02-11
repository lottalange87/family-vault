'use client';

import { useState, useCallback } from 'react';
import { useVault } from '@/hooks/useVault';
import { encryptMetadata, arrayBufferToBase64, uint8ArrayToBase64 } from '@/lib/crypto';

interface UseVideoEditOptions {
  videoId: string;
}

export function useVideoEdit({ videoId }: UseVideoEditOptions) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const masterKey = useVault((state) => state.masterKey);

  const saveMetadata = useCallback(
    async (title: string, description: string) => {
      if (!masterKey) {
        setError('Vault not unlocked');
        return false;
      }

      setIsSaving(true);
      setError(null);

      try {
        // Encrypt title and description
        const iv = crypto.getRandomValues(new Uint8Array(12));

        let encryptedTitle = '';
        let encryptedDescription = '';

        if (title) {
          const { encryptedData } = await encryptMetadata(title, masterKey);
          encryptedTitle = arrayBufferToBase64(encryptedData);
        }

        if (description) {
          const { encryptedData } = await encryptMetadata(description, masterKey);
          encryptedDescription = arrayBufferToBase64(encryptedData);
        }

        // Save to server
        const response = await fetch(`/api/files/${videoId}/metadata`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            encryptedTitle,
            encryptedDescription,
            iv: uint8ArrayToBase64(iv),
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to save metadata');
        }

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save');
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [videoId, masterKey]
  );

  return {
    isEditing,
    setIsEditing,
    isSaving,
    error,
    saveMetadata,
  };
}
