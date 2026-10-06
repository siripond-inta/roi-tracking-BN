// jest.config.js — แบ่ง test เป็น 2 ชุด
//   unit : ทดสอบฟังก์ชันล้วนๆ (services/, middleware) ไม่แตะ database — รันเร็ว
//   api  : integration test ยิง HTTP เข้า Express app ด้วย Supertest กับ database ทดสอบแยกต่างหาก
//          (roi_tracking_test ถูกสร้าง/migrate/seed ใหม่ทุกครั้งที่รัน — ไม่แตะข้อมูลจริง)
// ผลลัพธ์แบบ HTML อยู่ที่ test-reports/backend/ (ดู README หัวข้อ Tests)

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    },
    {
      displayName: 'api',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/api/**/*.test.js'],
      globalSetup: '<rootDir>/tests/api/global-setup.js',
      setupFiles: ['<rootDir>/tests/api/env.js'],
    },
  ],
  // test ชุด api ใช้ database ร่วมกัน — รันทีละไฟล์ กันข้อมูลชนกัน
  maxWorkers: 1,
  testTimeout: 30000,
  collectCoverageFrom: [
    'services/**/*.js',
    'controllers/**/*.js',
    'middleware/**/*.js',
    'routes/**/*.js',
  ],
  coverageDirectory: 'test-reports/backend/coverage',
  coverageReporters: ['html', 'text-summary', 'json-summary'],
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: './test-reports/backend',
        filename: 'jest-report.html',
        pageTitle: 'ROI Tracking — Backend Test Report (Jest + Supertest)',
        expand: true,
        inlineSource: true,
      },
    ],
  ],
};
