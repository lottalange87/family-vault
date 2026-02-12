CREATE TABLE `encrypted_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_path` text NOT NULL,
	`chunk_size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `encrypted_files`(`id`) ON UPDATE no action ON DELETE cascade
);
