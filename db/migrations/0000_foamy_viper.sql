CREATE TABLE `encrypted_files` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_filename` text NOT NULL,
	`encrypted_blob_path` text NOT NULL,
	`encrypted_thumbnail_path` text,
	`wrapped_file_key` text NOT NULL,
	`iv` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	`order_index` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `encrypted_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`encrypted_title` text,
	`encrypted_description` text,
	`iv` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `encrypted_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`chunks_received` integer DEFAULT 0 NOT NULL,
	`total_chunks` integer NOT NULL,
	`encrypted_metadata` text,
	`temp_dir` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`salt` text NOT NULL,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
