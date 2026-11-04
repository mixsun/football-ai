import { defineConfig, type Connect, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { getLiveMatches, getMatchDetail } from './server/titan'

function apiHandler(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const detail = req.url?.match(/^\/detail\/(\d+)/)
    if (!req.url?.startsWith('/live') && !detail) return next()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    try {
      res.statusCode = 200
      res.end(JSON.stringify(detail ? await getMatchDetail(Number(detail[1])) : await getLiveMatches()))
    } catch (error) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Titan 数据获取失败' }))
    }
  }
}

function titanApi(): Plugin {
  return {
    name: 'titan-live-api',
    configureServer(server) { server.middlewares.use('/api', apiHandler()) },
    configurePreviewServer(server) { server.middlewares.use('/api', apiHandler()) },
  }
}

export default defineConfig({
  plugins: [vue(), titanApi()],
  server: { port: 4173 },
  preview: { port: 4173 },
})
