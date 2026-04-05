/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Windows 下大量文件/子进程/临时目录操作容易触发 EBUSY，串行执行更稳定
  maxWorkers: 1,
  testMatch: [
    '<rootDir>/tests/**/*.test.ts'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  coverageDirectory: '<rootDir>/tests/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  cacheDirectory: '<rootDir>/tests/.cache/jest',
  testTimeout: 300000, // 5分钟超时，适配大型项目测试
  // 旧版 OpenCode/Skill 的测试辅助已废弃（V2.x 使用 CLI + LLM Mock Server）
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
