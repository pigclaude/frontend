// 负责为管理后台页面测试安装最小的浏览器 API 和稳定的测试清理逻辑。
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => cleanup())
