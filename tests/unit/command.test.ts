import { AnalyzeProjectCommandSchema } from '../../src/adapters/command.schemas';
import { invokeCommand } from '../utils/test-helpers';
import { TestProjectFactory } from '../utils/test-project-factory';
import { AssertUtils } from '../utils/assert-utils';

describe('/analyze-project command (UT-COM-*)', () => {
  test('UT-COM-001: 无参数调用成功', async () => {
    const testProject = await TestProjectFactory.create('small');
    
    const result = await invokeCommand('/analyze-project', {
      path: testProject.path,
    });
    
    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    expect(result.data!.mode).toBe('full');
    expect(result.data!.analyzedFilesCount).toBe(testProject.fileCount);
    
    await testProject.cleanup();
  });

  test('UT-COM-002: 带全量参数调用成功', async () => {
    const testProject = await TestProjectFactory.create('small');
    
    const result = await invokeCommand('/analyze-project', {
      path: testProject.path,
      mode: 'full',
      depth: 3,
      concurrency: 4,
    });
    
    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    expect(result.data!.mode).toBe('full');
    
    await testProject.cleanup();
  });

  test('UT-COM-003: 非法参数返回错误', async () => {
    const result = await invokeCommand('/analyze-project', {
      depth: -1,
      concurrency: 0
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe(4000);
  });

  test('UT-COM-004: 不存在的路径参数返回错误', async () => {
    const result = await invokeCommand('/analyze-project', {
      path: '/not/exist/path/123456'
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe(4001);
  });

  test('参数校验符合Zod Schema定义', () => {
    const validParams = {
      path: '/test',
      mode: 'full',
      depth: 5,
      concurrency: 8
    };
    
    const validationResult = AnalyzeProjectCommandSchema.safeParse(validParams);
    expect(validationResult.success).toBe(true);
    
    const invalidParams = {
      depth: -1,
      mode: 'invalid'
    };
    
    const invalidResult = AnalyzeProjectCommandSchema.safeParse(invalidParams);
    expect(invalidResult.success).toBe(false);
  });
});
