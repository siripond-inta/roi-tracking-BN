// โหลดก่อนทุกไฟล์ใน tests/api — สลับให้ app ใช้ database ทดสอบ (dotenv ไม่ทับค่าที่ตั้งไว้แล้ว)
process.env.DB_NAME = process.env.TEST_DB_NAME || 'roi_tracking_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
