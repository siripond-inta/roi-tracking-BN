CREATE TABLE `users` (
	`user_id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255),
	`full_name` varchar(255),
	`role` enum('admin','project_owner','viewer') NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `project_types` (
	`type_id` int NOT NULL,
	`type_name` varchar(255) NOT NULL,
	`description` text,
	`calculation_method` enum('REVENUE','COST_SAVING','MIXED'),
	CONSTRAINT `project_types_type_id` PRIMARY KEY(`type_id`)
);
--> statement-breakpoint
CREATE TABLE `entry_types` (
	`type_id` int NOT NULL,
	`type_name` varchar(255) NOT NULL,
	`is_inflow` boolean NOT NULL,
	`description` text,
	CONSTRAINT `entry_types_type_id` PRIMARY KEY(`type_id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`category_id` varchar(50) NOT NULL,
	`category_name` varchar(255) NOT NULL,
	`type_id` int,
	`category_group` enum('INV','OPC','ADC','BEN') NOT NULL,
	CONSTRAINT `categories_category_id` PRIMARY KEY(`category_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`project_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`project_name` varchar(255) NOT NULL,
	`project_type_id` int,
	`duration_months` int,
	`initial_budget` decimal(15,2),
	`target_roi_percent` decimal(5,2),
	`discount_rate` decimal(5,2),
	`status` enum('planning','in_progress','completed','archived') NOT NULL DEFAULT 'planning',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_project_id` PRIMARY KEY(`project_id`)
);
--> statement-breakpoint
CREATE TABLE `project_access` (
	`access_id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`user_id` int NOT NULL,
	`permission_level` enum('owner','editor','viewer') NOT NULL,
	`shared_by` int,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `project_access_access_id` PRIMARY KEY(`access_id`),
	CONSTRAINT `project_access_project_user_unique` UNIQUE(`project_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `project_ledger` (
	`ledger_id` int AUTO_INCREMENT NOT NULL,
	`project_id` int,
	`phase` enum('ESTIMATED','ACTUAL') NOT NULL,
	`period_index` int NOT NULL,
	`type_id` int,
	`category_id` varchar(50),
	`amount_base` decimal(15,2),
	`unit_qty` decimal(10,2),
	`unit_cost` decimal(15,2),
	`total_value` decimal(15,2),
	`transaction_date` date NOT NULL,
	`note` text,
	`created_by` int,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `project_ledger_ledger_id` PRIMARY KEY(`ledger_id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`setting_key` varchar(100) NOT NULL,
	`setting_value` varchar(255),
	`description` text,
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_setting_key` PRIMARY KEY(`setting_key`)
);
--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_type_id_entry_types_type_id_fk` FOREIGN KEY (`type_id`) REFERENCES `entry_types`(`type_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_project_type_id_project_types_type_id_fk` FOREIGN KEY (`project_type_id`) REFERENCES `project_types`(`type_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_access` ADD CONSTRAINT `project_access_project_id_projects_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_access` ADD CONSTRAINT `project_access_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_access` ADD CONSTRAINT `project_access_shared_by_users_user_id_fk` FOREIGN KEY (`shared_by`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_ledger` ADD CONSTRAINT `project_ledger_project_id_projects_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_ledger` ADD CONSTRAINT `project_ledger_type_id_entry_types_type_id_fk` FOREIGN KEY (`type_id`) REFERENCES `entry_types`(`type_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_ledger` ADD CONSTRAINT `project_ledger_category_id_categories_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_ledger` ADD CONSTRAINT `project_ledger_created_by_users_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `project_ledger_project_phase_period_idx` ON `project_ledger` (`project_id`,`phase`,`period_index`);