CREATE TABLE `fmp4_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`segment_index` integer NOT NULL,
	`segment_path` text NOT NULL,
	`segment_size` integer NOT NULL,
	`duration` integer,
	`init` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `encrypted_files`(`id`) ON UPDATE no action ON DELETE cascade
);
