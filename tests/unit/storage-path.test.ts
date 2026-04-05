import { LocalStorageService } from '../../src/infrastructure/storage.service';
import * as path from 'path';
import * as os from 'os';

describe('StorageService路径测试 (UT-STORAGE-PATH-*)', () => {
  const testProjectRoot = path.join(os.tmpdir(), 'test-project');
  const testSlug = 'test-project-123456';

  test('UT-STORAGE-PATH-001: 默认输出路径正确，为项目根目录下的.skill-any-code-result', () => {
    const storageService = new LocalStorageService(testProjectRoot);
    const storageRoot = storageService.getStoragePath(testSlug);
    
    // 预期路径：项目根目录/.skill-any-code-result
    const expectedPath = path.join(testProjectRoot, '.skill-any-code-result');
    expect(storageRoot).toBe(expectedPath);
  });

  test('UT-STORAGE-PATH-002: 自定义相对输出路径正确，相对于项目根目录', () => {
    const customOutputDir = './my-output';
    const storageService = new LocalStorageService(testProjectRoot, customOutputDir);
    const storageRoot = storageService.getStoragePath(testSlug);
    
    // 预期路径：项目根目录/my-output
    const expectedPath = path.join(testProjectRoot, customOutputDir);
    expect(storageRoot).toBe(expectedPath);
  });

  test('UT-STORAGE-PATH-003: 自定义绝对输出路径正确，直接使用绝对路径', () => {
    const customOutputDir = path.join(os.tmpdir(), 'global-output');
    const storageService = new LocalStorageService(testProjectRoot, customOutputDir);
    const storageRoot = storageService.getStoragePath(testSlug);
    
    // 预期路径就是自定义的绝对路径
    expect(storageRoot).toBe(customOutputDir);
  });

  test('UT-STORAGE-PATH-004: 不会出现两级.skill-any-code-result目录', () => {
    // 模拟配置文件里output_dir是./.skill-any-code-result的情况
    const customOutputDir = './.skill-any-code-result';
    const storageService = new LocalStorageService(testProjectRoot, customOutputDir);
    const storageRoot = storageService.getStoragePath(testSlug);
    
    // 预期路径：项目根目录/.skill-any-code-result，不会有两层
    const expectedPath = path.join(testProjectRoot, '.skill-any-code-result');
    expect(storageRoot).toBe(expectedPath);
    expect(storageRoot).not.toBe(path.join(testProjectRoot, '.skill-any-code-result', '.skill-any-code-result'));
  });

  test('UT-STORAGE-PATH-005: 默认projectRoot为当前工作目录', () => {
    const storageService = new LocalStorageService();
    const storageRoot = storageService.getStoragePath(testSlug);
    
    // 预期路径：当前工作目录/.skill-any-code-result
    const expectedPath = path.join(process.cwd(), '.skill-any-code-result');
    expect(storageRoot).toBe(expectedPath);
  });
});
