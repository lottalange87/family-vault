import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// Vault configuration (one row per vault)
export const vaultConfig = sqliteTable("vault_config", {
  id: integer("id").primaryKey(),
  salt: text("salt").notNull(), // Base64-encoded 32-byte salt
  createdAt: text("created_at").notNull(),
  version: integer("version").default(1).notNull(),
});

// Encrypted files
export const encryptedFiles = sqliteTable("encrypted_files", {
  id: text("id").primaryKey(), // UUID v4
  encryptedFilename: text("encrypted_filename").notNull(),
  encryptedBlobPath: text("encrypted_blob_path").notNull(),
  encryptedThumbnailPath: text("encrypted_thumbnail_path"),
  wrappedFileKey: text("wrapped_file_key").notNull(), // Master key encrypted file key
  iv: text("iv").notNull(), // Base64 IV (96-bit for GCM)
  fileSize: integer("file_size"), // Unencrypted for statistics
  mimeType: text("mime_type"), // Unencrypted for content-type hints
  orderIndex: integer("order_index").default(0).notNull(),
  createdAt: text("created_at").notNull(),
});

// Encrypted metadata
export const encryptedMetadata = sqliteTable("encrypted_metadata", {
  id: text("id").primaryKey(),
  fileId: text("file_id")
    .notNull()
    .references(() => encryptedFiles.id, { onDelete: "cascade" }),
  encryptedTitle: text("encrypted_title"),
  encryptedDescription: text("encrypted_description"),
  iv: text("iv").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Upload sessions for chunked uploads
export const uploadSessions = sqliteTable("upload_sessions", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull(),
  chunksReceived: integer("chunks_received").default(0).notNull(),
  totalChunks: integer("total_chunks").notNull(),
  encryptedMetadata: text("encrypted_metadata"), // JSON blob with wrapped key, IV, etc.
  tempDir: text("temp_dir").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

// Relations
export const encryptedFilesRelations = relations(encryptedFiles, ({ one }) => ({
  metadata: one(encryptedMetadata, {
    fields: [encryptedFiles.id],
    references: [encryptedMetadata.fileId],
  }),
}));

export const encryptedMetadataRelations = relations(encryptedMetadata, ({ one }) => ({
  file: one(encryptedFiles, {
    fields: [encryptedMetadata.fileId],
    references: [encryptedFiles.id],
  }),
}));

// Types
export type VaultConfig = typeof vaultConfig.$inferSelect;
export type EncryptedFile = typeof encryptedFiles.$inferSelect;
export type EncryptedMetadata = typeof encryptedMetadata.$inferSelect;
export type UploadSession = typeof uploadSessions.$inferSelect;

export type NewVaultConfig = typeof vaultConfig.$inferInsert;
export type NewEncryptedFile = typeof encryptedFiles.$inferInsert;
export type NewEncryptedMetadata = typeof encryptedMetadata.$inferInsert;
export type NewUploadSession = typeof uploadSessions.$inferInsert;
