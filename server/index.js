import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import SqliteDatabase from './db/sqlite.js';

// 加载环境变量
config();

// 自动生成 COOKIE_SECRET (如果未设置)
const COOKIE_SECRET = process.env.COOKIE_SECRET || randomBytes(32).toString('base64');
if (!process.env.COOKIE_SECRET) {
    console.log('⚠️  COOKIE_SECRET 未设置,已自动生成随机密钥');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 初始化 Express 应用
const app = express();
const PORT = process.env.PORT || 3200;

// 初始化 SQLite 数据库
const dbPath = process.env.DB_PATH || join(__dirname, '../data/misub.db');
const db = new SqliteDatabase(dbPath);

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));

// 信任代理 (如果在反向代理后面)
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// 将数据库实例和 COOKIE_SECRET 存储到 app.locals
app.locals.db = db;
app.locals.cookieSecret = COOKIE_SECRET;

// 健康检查端点
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// 动态导入 Cloudflare Functions 路由
const loadCloudflareRoutes = async () => {
    try {
        // 导入适配器
        const { adaptCloudflareFunction } = await import('./middleware/cloudflare-adapter.js');

        // 导入 Cloudflare Functions 的主处理器
        const functionsModule = await import('../functions/[[path]].js');

        // 使用适配器将 Cloudflare Functions 转换为 Express 中间件
        const cloudflareHandler = adaptCloudflareFunction(functionsModule.onRequest);

        // API 路由
        app.use('/api', cloudflareHandler);

        // 订阅路由
        app.use('/sub', cloudflareHandler);

        console.log('✅ Cloudflare Functions 路由已加载');
    } catch (error) {
        console.error('❌ 加载 Cloudflare Functions 路由失败:', error);

        // 降级处理 - 返回错误信息
        app.use('/api', (req, res) => {
            res.status(503).json({
                error: 'Service Unavailable',
                message: 'API routes failed to load',
                details: error.message
            });
        });
    }
};

// 加载路由
await loadCloudflareRoutes();

// 静态文件服务 (前端构建产物)
app.use(express.static(join(__dirname, '../dist')));

// SPA 回退路由
app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../dist/index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 启动服务器
const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🚀 MiSub Docker Server                             ║
║                                                       ║
║   📍 Server running on: http://localhost:${PORT}      ║
║   🗄️  Database: SQLite (${dbPath})                   ║
║   🌍 Environment: ${process.env.NODE_ENV || 'development'}                       ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
  `);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        db.close();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        db.close();
        process.exit(0);
    });
});

export default app;
