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
  iv: text("iv").notNull(), // Base64 IV for file content (96-bit for GCM)
  filenameIv: text("filename_iv"), // Base64 IV for filename (stored separately)
  thumbnailIv: text("thumbnail_iv"), // Base64 IV for thumbnail
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

// Encrypted chunks for streaming
export const encryptedChunks = sqliteTable("encrypted_chunks", {
  id: text("id").primaryKey(),
  fileId: text("file_id")
    .notNull()
    .references(() => encryptedFiles.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  chunkPath: text("chunk_path").notNull(),
  chunkSize: integer("chunk_size").notNull(),
  createdAt: text("created_at").notNull(),
});

// fMP4 segments for true streaming
export const fmp4Segments = sqliteTable("fmp4_segments", {
  id: text("id").primaryKey(),
  videoId: text("video_id")
    .notNull()
    .references(() => encryptedFiles.id, { onDelete: "cascade" }),
  segmentIndex: integer("segment_index").notNull(),
  segmentPath: text("segment_path").notNull(),
  segmentSize: integer("segment_size").notNull(),
  duration: integer("duration"), // Duration in milliseconds
  init: integer("init", { mode: "boolean" }).default(false).notNull(), // Is this the init segment?
  createdAt: text("created_at").notNull(),
});

// Relations
export const encryptedFilesRelations = relations(encryptedFiles, ({ one, many }) => ({
  metadata: one(encryptedMetadata, {
    fields: [encryptedFiles.id],
    references: [encryptedMetadata.fileId],
  }),
  chunks: many(encryptedChunks),
  fmp4Segments: many(fmp4Segments),
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
export type EncryptedChunk = typeof encryptedChunks.$inferSelect;
export type Fmp4Segment = typeof fmp4Segments.$inferSelect;

export type NewVaultConfig = typeof vaultConfig.$inferInsert;
export type NewEncryptedFile = typeof encryptedFiles.$inferInsert;
export type NewEncryptedMetadata = typeof encryptedMetadata.$inferInsert;
export type NewUploadSession = typeof uploadSessions.$inferInsert;
export type NewEncryptedChunk = typeof encryptedChunks.$inferInsert;
export type NewFmp4Segment = typeof fmp4Segments.$inferInsert;
