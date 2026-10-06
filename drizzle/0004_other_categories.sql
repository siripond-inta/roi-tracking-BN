ALTER TABLE `categories` ADD `allow_custom_name` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_ledger` ADD `custom_name` varchar(255);--> statement-breakpoint
-- หมวด "อื่นๆ" ของแต่ละกลุ่ม ให้ผู้ใช้พิมพ์ชื่อรายการเองได้ (INSERT IGNORE: รันซ้ำ/มีอยู่แล้วไม่พัง)
INSERT IGNORE INTO `categories` (`category_id`, `category_name`, `type_id`, `category_group`, `unit_label`, `rate_label`, `allow_custom_name`)
SELECT 'REVOTH', 'รายได้อื่นๆ (ระบุเอง)', `type_id`, 'REV', NULL, NULL, true FROM `entry_types` WHERE `is_inflow` = 1 ORDER BY `type_id` LIMIT 1;--> statement-breakpoint
INSERT IGNORE INTO `categories` (`category_id`, `category_name`, `type_id`, `category_group`, `unit_label`, `rate_label`, `allow_custom_name`)
SELECT 'BENOTH', 'ผลประโยชน์ทางอ้อมอื่นๆ (ระบุเอง)', `type_id`, 'BEN', 'ปริมาณที่ลดได้ต่อเดือน', 'มูลค่าต่อหน่วย (บาท)', true FROM `entry_types` WHERE `is_inflow` = 1 ORDER BY `type_id` LIMIT 1;--> statement-breakpoint
INSERT IGNORE INTO `categories` (`category_id`, `category_name`, `type_id`, `category_group`, `unit_label`, `rate_label`, `allow_custom_name`)
SELECT 'INVOTH', 'เงินลงทุนอื่นๆ (ระบุเอง)', `type_id`, 'INV', NULL, NULL, true FROM `entry_types` WHERE `is_inflow` = 0 ORDER BY `type_id` LIMIT 1;--> statement-breakpoint
INSERT IGNORE INTO `categories` (`category_id`, `category_name`, `type_id`, `category_group`, `unit_label`, `rate_label`, `allow_custom_name`)
SELECT 'OPCOTH', 'ต้นทุนดำเนินงานอื่นๆ (ระบุเอง)', `type_id`, 'OPC', NULL, NULL, true FROM `entry_types` WHERE `is_inflow` = 0 ORDER BY `type_id` LIMIT 1;--> statement-breakpoint
INSERT IGNORE INTO `categories` (`category_id`, `category_name`, `type_id`, `category_group`, `unit_label`, `rate_label`, `allow_custom_name`)
SELECT 'ADCOTH', 'ค่าใช้จ่ายบริหารอื่นๆ (ระบุเอง)', `type_id`, 'ADC', NULL, NULL, true FROM `entry_types` WHERE `is_inflow` = 0 ORDER BY `type_id` LIMIT 1;
