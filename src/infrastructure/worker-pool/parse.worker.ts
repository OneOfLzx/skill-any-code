import * as workerpool from 'workerpool'
import { aggregateDirectory, parseFile, validateResult } from './parse.worker.impl'

// 注册Worker方法
workerpool.worker({
  parseFile,
  aggregateDirectory,
  validateResult
})