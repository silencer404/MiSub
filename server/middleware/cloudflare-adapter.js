/**
 * Cloudflare Functions 到 Express 的适配器
 * 将 Cloudflare 的 env 和 context 适配到 Express 的 req/res
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 创建 Cloudflare 兼容的 env 对象
 * @param {Object} db - SQLite 数据库实例
 * @param {Object} req - Express request
 * @returns {Object} Cloudflare 兼容的 env 对象
 */
export function createCloudflareEnv(db, req) {
    return {
        // 使用 SQLite 数据库适配器模拟 KV/D1
        MISUB_KV: db,
        MISUB_DB: db,

        // 环境变量
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
        COOKIE_SECRET: process.env.COOKIE_SECRET || req.app.locals.cookieSecret,
        CRON_SECRET: process.env.CRON_SECRET,

        // 其他配置
        NODE_ENV: process.env.NODE_ENV || 'production'
    };
}

/**
 * 创建 Cloudflare 兼容的 context 对象
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Object} env - Cloudflare env 对象
 * @returns {Object} Cloudflare 兼容的 context 对象
 */
export function createCloudflareContext(req, res, env) {
    // 创建一个 Request 对象
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = new Headers();
    Object.keys(req.headers).forEach(key => {
        headers.set(key, req.headers[key]);
    });

    const request = new Request(url, {
        method: req.method,
        headers: headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    });

    return {
        request,
        env,
        params: req.params,
        data: {},
        next: async () => {
            // Express 的 next 函数适配
            return new Response('Not Found', { status: 404 });
        }
    };
}

/**
 * 将 Cloudflare Response 转换为 Express 响应
 * @param {Response} cfResponse - Cloudflare Response 对象
 * @param {Object} res - Express response
 */
export async function sendCloudflareResponse(cfResponse, res) {
    // 设置状态码
    res.status(cfResponse.status);

    // 设置响应头
    cfResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
    });

    // 发送响应体
    const contentType = cfResponse.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        const data = await cfResponse.json();
        res.json(data);
    } else if (contentType.includes('text/')) {
        const text = await cfResponse.text();
        res.send(text);
    } else {
        const buffer = await cfResponse.arrayBuffer();
        res.send(Buffer.from(buffer));
    }
}

/**
 * 创建 Express 中间件来处理 Cloudflare Functions
 * @param {Function} cloudflareHandler - Cloudflare onRequest 函数
 * @returns {Function} Express 中间件
 */
export function adaptCloudflareFunction(cloudflareHandler) {
    return async (req, res, next) => {
        try {
            const db = req.app.locals.db;
            const env = createCloudflareEnv(db, req);
            const context = createCloudflareContext(req, res, env);

            const cfResponse = await cloudflareHandler(context);
            await sendCloudflareResponse(cfResponse, res);
        } catch (error) {
            console.error('[Cloudflare Adapter Error]', error);
            next(error);
        }
    };
}

export default {
    createCloudflareEnv,
    createCloudflareContext,
    sendCloudflareResponse,
    adaptCloudflareFunction
};
