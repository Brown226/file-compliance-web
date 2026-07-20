import jwt
import os
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from utils.logger import setup_logger

logger = setup_logger('jwt-auth')

JWT_SECRET = os.getenv('JWT_SECRET', 'archspec-default-jwt-secret-key-2024')

# 白名单路径（不需要验证 JWT）
PUBLIC_PATHS = ['/docs', '/openapi.json', '/redoc', '/agent/test']


class JwtAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 白名单路径直接放行
        if any(path.startswith(p) or path == p for p in PUBLIC_PATHS):
            return await call_next(request)

        # OPTIONS 请求直接放行（CORS 预检）
        if request.method == 'OPTIONS':
            return await call_next(request)

        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return JSONResponse(
                status_code=401,
                content={'code': 401, 'message': '缺少认证信息'}
            )

        token = auth_header[7:]
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            request.state.user_id = payload.get('sub')
            request.state.email = payload.get('email')
        except jwt.ExpiredSignatureError:
            return JSONResponse(
                status_code=401,
                content={'code': 401, 'message': '认证信息已过期'}
            )
        except jwt.InvalidTokenError as e:
            logger.warning(f'JWT 验证失败: {e}')
            return JSONResponse(
                status_code=401,
                content={'code': 401, 'message': '认证信息无效'}
            )

        return await call_next(request)
