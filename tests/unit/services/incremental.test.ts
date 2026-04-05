import { IncrementalService } from '@/domain/services/incremental.service';
import { IGitService, IStorageService } from '@/domain/interfaces';

describe('IncrementalService (UT-INC-*)', () => {
  let incrementalService: IncrementalService;
  let mockGitService: jest.Mocked<IGitService>;
  let mockStorageService: jest.Mocked<IStorageService>;

  beforeEach(() => {
    mockGitService = {
      isGitProject: jest.fn(),
      getCurrentCommit: jest.fn(),
      getProjectSlug: jest.fn().mockResolvedValue('test-project'),
      getUncommittedChanges: jest.fn(),
      diffCommits: jest.fn()
    } as any;

    mockStorageService = {
      getMetadata: jest.fn()
    } as any;

    incrementalService = new IncrementalService(mockGitService, mockStorageService);
  });

  test('UT-INC-001: 有历史记录时增量可用', async () => {
    mockGitService.isGitProject.mockResolvedValue(true);
    mockGitService.getCurrentCommit.mockResolvedValue('a1b2c3d4e5f6');
    mockStorageService.getMetadata.mockResolvedValue({
      gitCommits: [{
        hash: 'a1b2c3d4e5f6',
        branch: 'main',
        analyzedAt: '2026-03-09T12:00:00.000Z'
      }]
    } as any);

    const result = await incrementalService.canDoIncremental('/test/project');
    expect(result.available).toBe(true);
    expect(result.baseCommit).toBe('a1b2c3d4e5f6');
  });

  test('UT-INC-002: 无历史记录时增量不可用', async () => {
    mockGitService.isGitProject.mockResolvedValue(true);
    mockGitService.getCurrentCommit.mockResolvedValue('a1b2c3d4e5f6');
    mockStorageService.getMetadata.mockResolvedValue(null);

    const result = await incrementalService.canDoIncremental('/test/project');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('No historical analysis records');
  });

  test('UT-INC-003: 获取变更文件列表成功', async () => {
    mockGitService.diffCommits.mockResolvedValue([
      'src/utils/date.ts',
      'src/components/Button.tsx'
    ]);

    const changedFiles = await incrementalService.getChangedFiles(
      '/test/project',
      'commit1',
      'commit2'
    );

    expect(changedFiles).toEqual([
      'src/utils/date.ts',
      'src/components/Button.tsx'
    ]);
    expect(mockGitService.diffCommits).toHaveBeenCalledWith('/test/project', 'commit1', 'commit2');
  });

  test('UT-INC-004: 计算受影响目录成功', async () => {
    const changedFiles = [
      'src/utils/date.ts',
      'src/components/Button.tsx'
    ];

    const affectedDirs = incrementalService.getAffectedDirectories(changedFiles);
    expect(affectedDirs).toEqual(expect.arrayContaining([
      'src/utils',
      'src/components',
      'src'
    ]));
    expect(affectedDirs.length).toBe(4);
  });

  test('UT-INC-005: 非Git项目增量不可用', async () => {
    mockGitService.isGitProject.mockResolvedValue(false);

    const result = await incrementalService.canDoIncremental('/test/project');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('Not a git project');
  });
});
