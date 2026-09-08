-- =======================================================
-- Database: roi_tracking_db
-- Schema & Migration Script for ROI Tracking System
-- =======================================================

CREATE DATABASE IF NOT EXISTS `roi_tracking_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `roi_tracking_db`;

-- 1. Table: users
CREATE TABLE IF NOT EXISTS `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL UNIQUE,
  `password_hash` varchar(255) DEFAULT NULL,
  `full_name` varchar(255) DEFAULT NULL,
  `company_name` varchar(255) DEFAULT NULL,
  `role` enum('admin','user') NOT NULL DEFAULT 'user',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Table: project_types
CREATE TABLE IF NOT EXISTS `project_types` (
  `type_id` int NOT NULL,
  `type_name` varchar(255) NOT NULL,
  `description` text,
  PRIMARY KEY (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Table: entry_types
CREATE TABLE IF NOT EXISTS `entry_types` (
  `type_id` int NOT NULL,
  `type_name` varchar(255) NOT NULL,
  `description` text,
  PRIMARY KEY (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Table: categories
CREATE TABLE IF NOT EXISTS `categories` (
  `category_id` varchar(50) NOT NULL,
  `category_name` varchar(255) NOT NULL,
  `type_id` int NOT NULL,
  PRIMARY KEY (`category_id`),
  KEY `type_id` (`type_id`),
  CONSTRAINT `categories_ibfk_1` FOREIGN KEY (`type_id`) REFERENCES `entry_types` (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Table: projects
CREATE TABLE IF NOT EXISTS `projects` (
  `project_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `project_name` varchar(255) NOT NULL,
  `project_type_id` int DEFAULT NULL,
  `duration_months` int DEFAULT NULL,
  `initial_budget` decimal(15,2) DEFAULT NULL,
  `is_public` tinyint(1) NOT NULL DEFAULT '0',
  `custom_project_type` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`),
  KEY `user_id` (`user_id`),
  KEY `project_type_id` (`project_type_id`),
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `projects_ibfk_2` FOREIGN KEY (`project_type_id`) REFERENCES `project_types` (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Table: project_ledger
CREATE TABLE IF NOT EXISTS `project_ledger` (
  `ledger_id` int NOT NULL,
  `project_id` int DEFAULT NULL,
  `phase` varchar(100) NOT NULL,
  `type_id` int DEFAULT NULL,
  `category_id` varchar(50) DEFAULT NULL,
  `amount_base` decimal(15,2) DEFAULT NULL,
  `unit_qty` decimal(10,2) DEFAULT NULL,
  `unit_cost` decimal(15,2) DEFAULT NULL,
  `total_value` decimal(15,2) DEFAULT NULL,
  `transaction_date` date NOT NULL,
  `note` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ledger_id`),
  KEY `project_id` (`project_id`),
  KEY `type_id` (`type_id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `project_ledger_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `project_ledger_ibfk_2` FOREIGN KEY (`type_id`) REFERENCES `entry_types` (`type_id`),
  CONSTRAINT `project_ledger_ibfk_3` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =======================================================
-- Seed / Master Data
-- =======================================================

-- Entry Types (1=Expense, 2=Revenue)
INSERT INTO `entry_types` (`type_id`, `type_name`, `description`)
VALUES 
  (1, 'Expense', 'Project Costs and Expenses'),
  (2, 'Revenue', 'Project Returns and Revenues')
ON DUPLICATE KEY UPDATE `type_name` = VALUES(`type_name`), `description` = VALUES(`description`);

-- Project Types (1=โปรเจกต์รายได้, 2=โปรเจกต์ลดต้นทุน, 3=โปรเจกต์ตามข้อบังคับ, 4=อื่นๆ)
INSERT INTO `project_types` (`type_id`, `type_name`, `description`)
VALUES 
  (1, 'โปรเจกต์รายได้', 'โครงการเพื่อการสร้างหรือเพิ่มรายได้'),
  (2, 'โปรเจกต์ลดต้นทุน', 'โครงการเพื่อการลดค่าใช้จ่ายหรือเพิ่มประสิทธิภาพ'),
  (3, 'โปรเจกต์ตามข้อบังคับ', 'โครงการตามกฎหมายหรือข้อบังคับขององค์กร'),
  (4, 'อื่นๆ', 'โครงการประเภทอื่นๆ ที่ระบุเพิ่มเติม')
ON DUPLICATE KEY UPDATE `type_name` = VALUES(`type_name`), `description` = VALUES(`description`);

-- Categories
INSERT INTO `categories` (`category_id`, `category_name`, `type_id`)
VALUES 
  ('REV001', 'การสร้างรายรับ', 2),
  ('REV002', 'การประหยัดต้นทุน', 2),
  ('CAT001', 'ต้นทุนดำเนินการ', 1),
  ('CAT002', 'ต้นทุนพัฒนา', 1),
  ('CAT003', 'ต้นทุนทั่วไป', 1)
ON DUPLICATE KEY UPDATE `category_name` = VALUES(`category_name`), `type_id` = VALUES(`type_id`);
